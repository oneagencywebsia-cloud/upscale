import type { FastifyInstance } from "fastify";
import { requireUser, principalOf } from "../auth.js";
import { ingestBindUser, ingestBoundUser } from "../ingest.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/auth/me", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    return { userId: p.userId, email: p.email };
  });

  // "recibir aquí los vídeos de Telegram": ata la ingesta a esta cuenta.
  //
  // OJO (decisión de producto, no se cambia aquí): esto es GLOBAL, no por
  // usuario — CUALQUIER cuenta con sesión válida puede redirigir a su propia
  // biblioteca todo lo que llegue al inbox de Telegram a partir de ese
  // momento. Hoy la app es de un solo usuario y no pasa nada; el día que haya
  // una segunda cuenta, esto es un secuestro de la ingesta en una sola
  // petición. Como mínimo, que quede registrado el cambio de dueño.
  app.post("/v1/ingest/bind", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    const previo = await ingestBoundUser();
    if (previo && previo !== p.userId) {
      req.log.warn({ previo, nuevo: p.userId, email: p.email }, "ingesta: CAMBIO de usuario destino del inbox");
    }
    await ingestBindUser(p.userId);
    return { ok: true, boundTo: p.userId, email: p.email };
  });
  app.get("/v1/ingest/bind", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    const bound = await ingestBoundUser();
    return { boundTo: bound, you: p.userId, isYou: bound === p.userId };
  });
}
