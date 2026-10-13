import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";
import { one } from "./db.js";

export interface Principal {
  userId: string;
  email: string | null;
}

// caché corta de tokens verificados para no llamar a Supabase en cada request
const cache = new Map<string, { p: Principal; exp: number }>();

/**
 * Verifica un access token de Supabase preguntando a `/auth/v1/user`.
 * Funciona con cualquier algoritmo de firma (HS256 legacy o claves asimétricas nuevas).
 */
export async function verifySupabaseToken(token: string): Promise<Principal | null> {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.p;

  try {
    const res = await fetch(`${env.SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY! },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string; email?: string | null };
    if (!user.id) return null;
    const p: Principal = { userId: user.id, email: user.email ?? null };
    cache.set(token, { p, exp: Date.now() + 60_000 });
    // evicción del más antiguo (Map conserva orden de inserción) — evita el vaciado en masa
    while (cache.size > 500) cache.delete(cache.keys().next().value!);
    return p;
  } catch {
    return null;
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const principal = token ? await verifySupabaseToken(token) : null;
  if (!principal) {
    await reply.code(401).send({ error: "no autorizado" });
    return;
  }
  (req as FastifyRequest & { principal?: Principal }).principal = principal;
}

/**
 * preHandler para subir: acepta el `X-Upload-Token` del Atajo de iOS
 * (tabla `upload_tokens`) O una sesión Supabase (`Authorization: Bearer`) desde la web.
 */
export async function requireUploadToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const fromSession = bearer ? await verifySupabaseToken(bearer) : null;
  if (fromSession) {
    (req as FastifyRequest & { principal?: Principal }).principal = fromSession;
    return;
  }

  const t = req.headers["x-upload-token"];
  if (typeof t === "string" && t.length >= 12) {
    const row = await one<{ user_id: string }>("select user_id from upload_tokens where token = $1", [t]);
    if (row) {
      (req as FastifyRequest & { principal?: Principal }).principal = { userId: row.user_id, email: null };
      return;
    }
  }
  await reply.code(401).send({ error: "necesitas sesión o un X-Upload-Token válido" });
}

const lista = (v: string | undefined) =>
  (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** ¿Hay una lista de administradores explícita en el entorno? */
export function hayAdminsConfigurados(): boolean {
  return lista(env.ADMIN_USER_IDS).length > 0 || lista(env.ADMIN_EMAILS).length > 0;
}

/**
 * ¿Es administrador? (lo GLOBAL: ingesta de Telegram y diagnóstico del servidor).
 *  1) ADMIN_USER_IDS / ADMIN_EMAILS, si están definidos, mandan.
 *  2) Si no, el admin es la cuenta a la que ya está atada la ingesta de Telegram
 *     — el dueño, que fue quien la configuró. Así, al activar esto en un
 *     despliegue que ya existe, no hace falta tocar ninguna variable.
 *  3) Sin lista y sin cuenta atada (instalación nueva) nadie lo es todavía.
 */
export async function esAdmin(p: { userId: string; email: string | null }): Promise<boolean> {
  if (hayAdminsConfigurados()) {
    return lista(env.ADMIN_USER_IDS).includes(p.userId.toLowerCase()) ||
      (!!p.email && lista(env.ADMIN_EMAILS).includes(p.email.toLowerCase()));
  }
  const bound = await one<{ v: string }>("select v from kv where k = 'ingest:user_id'").catch(() => null);
  return !!bound?.v && bound.v === p.userId;
}

/** Como requireUploadToken (sesión o X-Upload-Token), pero solo admins. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireUploadToken(req, reply);
  if (reply.sent) return;
  const p = principalOf(req);
  if (!(await esAdmin(p))) {
    await reply.code(403).send({ error: "solo el administrador puede hacer esto" });
  }
}

export function principalOf(req: FastifyRequest): Principal {
  return (req as FastifyRequest & { principal?: Principal }).principal as Principal;
}
