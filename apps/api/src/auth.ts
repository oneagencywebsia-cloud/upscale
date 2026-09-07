import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";
import { one } from "./db.js";

export interface Principal {
  userId: string;
  email: string | null;
}

/** Verifica un access token de Supabase (HS256 con el JWT Secret del proyecto). */
export function verifySupabaseToken(token: string): Principal | null {
  try {
    const p = jwt.verify(token, env.SUPABASE_JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (typeof p.sub !== "string") return null;
    return { userId: p.sub, email: typeof p.email === "string" ? p.email : null };
  } catch {
    return null;
  }
}

/** preHandler: exige un usuario autenticado por Supabase (cabecera Authorization: Bearer). */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const principal = token ? verifySupabaseToken(token) : null;
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
  const fromSession = bearer ? verifySupabaseToken(bearer) : null;
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

export function principalOf(req: FastifyRequest): Principal {
  return (req as FastifyRequest & { principal?: Principal }).principal as Principal;
}
