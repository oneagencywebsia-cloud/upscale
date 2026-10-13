import type { FastifyInstance } from "fastify";
import { requireUser, principalOf, esAdmin, hayAdminsConfigurados } from "../auth.js";
import { ingestBindUser, ingestBoundUser } from "../ingest.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/auth/me", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    return { userId: p.userId, email: p.email };
  });

  // "recibir aquí los vídeos de Telegram": ata la ingesta a esta cuenta.
  //
  // La ingesta es GLOBAL (un único inbox de Telegram para todo el servidor), así
  // que atarla a una cuenta es cosa del ADMINISTRADOR. Antes la podía hacer
  // cualquier cuenta con sesión: bastaba una petición para que todo lo que
  // llegara al inbox del dueño fuera a la biblioteca de otra persona.
  //
  // Excepción de arranque: en una instalación NUEVA (nadie atado y sin lista de
  // administradores en el entorno) la primera cuenta puede atarla — así sigue
  // funcionando la puesta en marcha. En cuanto hay dueño, solo él.
  async function puedeAtar(p: { userId: string; email: string | null }): Promise<boolean> {
    if (await esAdmin(p)) return true;
    return !hayAdminsConfigurados() && !(await ingestBoundUser());
  }

  app.post("/v1/ingest/bind", { preHandler: requireUser }, async (req, reply) => {
    const p = principalOf(req);
    if (!(await puedeAtar(p))) {
      req.log.warn({ userId: p.userId, email: p.email }, "ingesta: intento de atar el inbox SIN ser administrador (rechazado)");
      return reply.code(403).send({ error: "solo el administrador puede cambiar dónde llega lo de Telegram" });
    }
    const previo = await ingestBoundUser();
    if (previo && previo !== p.userId) {
      req.log.warn({ previo, nuevo: p.userId, email: p.email }, "ingesta: CAMBIO de usuario destino del inbox");
    }
    await ingestBindUser(p.userId);
    return { ok: true, boundTo: p.userId, email: p.email };
  });

  // Ya NO devuelve el id de la cuenta atada (era un dato ajeno): solo lo que le
  // importa a quien pregunta.
  app.get("/v1/ingest/bind", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    const bound = await ingestBoundUser();
    return { isYou: bound === p.userId, canBind: await puedeAtar(p) };
  });
}
