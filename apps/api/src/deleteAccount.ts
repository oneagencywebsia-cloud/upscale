import { env } from "./env.js";
import { query } from "./db.js";
import { remove } from "./storage.js";

/**
 * «Borrar mi cuenta»: elimina TODO lo de una persona.
 *
 *  1. Marca todos sus archivos como borrados (desaparecen y liberan cupo ya).
 *  2. En segundo plano, por tandas, borra los objetos del almacenamiento y las
 *     filas. Tarda más con muchos archivos (Telegram limita el ritmo), por eso la
 *     petición responde 202 enseguida y esto sigue solo.
 *  3. Borra el resto de sus datos (álbumes, tokens, registro de accesos, canjes,
 *     lista de espera, perfil) y suelta a quienes ella invitó.
 *  4. Si hay SUPABASE_SERVICE_ROLE_KEY, borra también el usuario de Supabase.
 */
const enCurso = new Set<string>();

export function borrandoCuenta(userId: string): boolean {
  return enCurso.has(userId);
}

export const puedeBorrarAuth = (): boolean => Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

interface FilaClaves {
  id: string;
  original_key: string;
  thumb_key: string | null;
  preview_key: string | null;
  poster_key: string | null;
  live_video_key: string | null;
}

async function borrarUsuarioSupabase(userId: string): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const res = await fetch(`${env.SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

/** Lanza el borrado sin esperarlo. Devuelve false si ya había uno en marcha. */
export function iniciarBorradoCuenta(userId: string, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): boolean {
  if (enCurso.has(userId)) return false;
  enCurso.add(userId);
  void (async () => {
    try {
      await query("update assets set deleted_at = coalesce(deleted_at, now()) where user_id = $1", [userId]);

      let borrados = 0;
      // vuelve a mirar al terminar: si subió algo durante el borrado, también se va
      for (;;) {
        const { rows } = await query<FilaClaves>(
          `select id, original_key, thumb_key, preview_key, poster_key, live_video_key
             from assets where user_id = $1 order by id limit 100`,
          [userId],
        );
        if (!rows.length) break;
        for (const a of rows) {
          const keys = [a.original_key, a.thumb_key, a.preview_key, a.poster_key, a.live_video_key].filter(
            (k): k is string => Boolean(k),
          );
          for (const k of keys) await remove(k).catch(() => {});
        }
        await query("delete from assets where id = any($1::uuid[])", [rows.map((r) => r.id)]);
        borrados += rows.length;
      }

      await query("delete from albums where user_id = $1", [userId]);
      await query("delete from upload_tokens where user_id = $1", [userId]);
      await query("delete from access_log where user_id = $1", [userId]);
      await query("delete from code_redemptions where user_id = $1", [userId]);
      await query("delete from waitlist where user_id = $1", [userId]);
      await query("update profiles set referred_by = null where referred_by = $1", [userId]);
      await query("delete from profiles where user_id = $1", [userId]);

      const authBorrado = await borrarUsuarioSupabase(userId).catch(() => false);
      log.info({ userId, borrados, authBorrado }, "cuenta borrada");
    } catch (err) {
      log.error({ userId, err }, "fallo al borrar la cuenta");
    } finally {
      enCurso.delete(userId);
    }
  })();
  return true;
}
