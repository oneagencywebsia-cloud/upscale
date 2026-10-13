import { randomInt } from "node:crypto";
import { pool, query, one } from "./db.js";
import { esAdmin } from "./auth.js";
import {
  PLANS,
  PLAN_LIST,
  esPlan,
  REFERRAL_BONUS_INVITED,
  REFERRAL_BONUS_INVITER,
  REFERRAL_MAX_REWARDED,
  type Plan,
  type PlanId,
} from "./plans.js";

export interface Profile {
  user_id: string;
  plan: string;
  plan_until: Date | null;
  bonus_bytes: string;
  referral_code: string;
  referred_by: string | null;
  referral_rewarded_at: Date | null;
}

// sin 0/O/1/I/L: se dicta y se teclea sin equivocarse
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function nuevoCodigo(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

/** Perfil de la persona; se crea la primera vez que hace falta. */
export async function ensureProfile(userId: string): Promise<Profile> {
  for (let i = 0; i < 6; i++) {
    try {
      await query(
        "insert into profiles (user_id, referral_code) values ($1, $2) on conflict (user_id) do nothing",
        [userId, nuevoCodigo()],
      );
      break;
    } catch (e) {
      // choque (rarísimo) en referral_code: se reintenta con otro código
      if ((e as { code?: string }).code !== "23505" || i === 5) throw e;
    }
  }
  const p = await one<Profile>("select * from profiles where user_id = $1", [userId]);
  if (!p) throw new Error("no se pudo crear el perfil");
  return p;
}

/** Plan que vale AHORA: un plan de prueba caducado vuelve a Gratis. */
export function planEfectivo(p: Pick<Profile, "plan" | "plan_until">): Plan {
  const caducado = p.plan_until !== null && p.plan_until.getTime() < Date.now();
  return caducado || !esPlan(p.plan) ? PLANS.free : PLANS[p.plan];
}

export async function bytesUsados(userId: string): Promise<number> {
  const r = await one<{ n: string }>(
    "select coalesce(sum(bytes + coalesce(live_video_bytes, 0)), 0) as n from assets where user_id = $1 and deleted_at is null",
    [userId],
  );
  return Number(r?.n ?? 0);
}

export interface Cuota {
  plan: Plan;
  /** el administrador no tiene tope */
  unlimited: boolean;
  limitBytes: number;
  usedBytes: number;
  remainingBytes: number;
  maxFileBytes: number;
}

export async function cuotaDe(p: { userId: string; email: string | null }): Promise<Cuota> {
  const [profile, used, admin] = await Promise.all([ensureProfile(p.userId), bytesUsados(p.userId), esAdmin(p)]);
  const plan = planEfectivo(profile);
  const limit = plan.bytes + Number(profile.bonus_bytes);
  return {
    plan,
    unlimited: admin,
    limitBytes: limit,
    usedBytes: used,
    // pasarse de cuota (p. ej. por bajar de plan) no borra nada: solo impide subir más
    remainingBytes: admin ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used),
    maxFileBytes: admin ? Number.MAX_SAFE_INTEGER : plan.maxFileBytes,
  };
}

// ---------------------------------------------------------------------------
// Invita y gana
// ---------------------------------------------------------------------------

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const normalizaCodigo = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9_-]{3,40}$/.test(c) ? c : null;
};

/** Enlaza a esta persona con quien la invitó. Solo si es nueva (sin archivos) y no tiene ya invitador. */
export async function enlazarInvitacion(userId: string, rawCode: unknown): Promise<Resultado> {
  const code = normalizaCodigo(rawCode);
  if (!code) return { ok: false, status: 400, error: "Ese enlace de invitación no es válido." };
  await ensureProfile(userId);
  const inviter = await one<{ user_id: string }>("select user_id from profiles where referral_code = $1", [code]);
  if (!inviter) return { ok: false, status: 404, error: "Ese enlace de invitación no existe." };
  if (inviter.user_id === userId) return { ok: false, status: 400, error: "No puedes invitarte a ti mismo." };
  const tiene = await one<{ n: string }>("select count(*) n from assets where user_id = $1", [userId]);
  if (Number(tiene?.n ?? 0) > 0) {
    return { ok: false, status: 409, error: "La invitación solo vale para cuentas nuevas." };
  }
  const r = await query(
    "update profiles set referred_by = $1 where user_id = $2 and referred_by is null",
    [inviter.user_id, userId],
  );
  if (!r.rowCount) return { ok: false, status: 409, error: "Ya tenías una invitación." };
  return { ok: true };
}

/** Paga la invitación UNA vez, cuando la persona invitada guarda su primer archivo. */
export async function premiarInvitacion(userId: string): Promise<void> {
  const r = await one<{ referred_by: string }>(
    `update profiles set referral_rewarded_at = now()
      where user_id = $1 and referred_by is not null and referral_rewarded_at is null
      returning referred_by`,
    [userId],
  );
  if (!r) return;
  await query("update profiles set bonus_bytes = bonus_bytes + $1 where user_id = $2", [REFERRAL_BONUS_INVITED, userId]);
  // el tope cuenta esta invitación incluida (ya está marcada como premiada)
  const n = await one<{ n: string }>(
    "select count(*) n from profiles where referred_by = $1 and referral_rewarded_at is not null",
    [r.referred_by],
  );
  if (Number(n?.n ?? 0) <= REFERRAL_MAX_REWARDED) {
    await query("update profiles set bonus_bytes = bonus_bytes + $1 where user_id = $2", [REFERRAL_BONUS_INVITER, r.referred_by]);
  }
}

export async function resumenInvitaciones(userId: string): Promise<{ invited: number; rewarded: number; earnedBytes: number }> {
  const r = await one<{ invited: string; rewarded: string }>(
    `select count(*) invited, count(referral_rewarded_at) rewarded from profiles where referred_by = $1`,
    [userId],
  );
  const rewarded = Math.min(Number(r?.rewarded ?? 0), REFERRAL_MAX_REWARDED);
  return { invited: Number(r?.invited ?? 0), rewarded: Number(r?.rewarded ?? 0), earnedBytes: rewarded * REFERRAL_BONUS_INVITER };
}

// ---------------------------------------------------------------------------
// Códigos de canje
// ---------------------------------------------------------------------------

export async function canjearCodigo(userId: string, raw: unknown): Promise<Resultado<{ message: string }>> {
  const code = normalizaCodigo(raw);
  if (!code) return { ok: false, status: 400, error: "Escribe un código válido." };
  const profile = await ensureProfile(userId);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const c = (await client.query("select * from redeem_codes where code = $1 for update", [code])).rows[0] as
      | { kind: "bonus" | "plan"; bonus_bytes: string | null; plan: string | null; plan_days: number | null; max_uses: number | null; uses: number; expires_at: Date | null }
      | undefined;
    const fallo = async (status: number, error: string): Promise<Resultado<{ message: string }>> => {
      await client.query("rollback");
      return { ok: false, status, error };
    };
    if (!c) return await fallo(404, "Ese código no existe. Revisa que esté bien escrito.");
    if (c.expires_at && c.expires_at.getTime() < Date.now()) return await fallo(410, "Ese código ha caducado.");
    if (c.max_uses !== null && c.uses >= c.max_uses) return await fallo(410, "Ese código ya se ha agotado.");
    const ya = await client.query(
      "insert into code_redemptions (code, user_id) values ($1, $2) on conflict do nothing returning 1",
      [code, userId],
    );
    if (!ya.rowCount) return await fallo(409, "Ya has canjeado este código.");

    let message: string;
    if (c.kind === "bonus") {
      const extra = Number(c.bonus_bytes ?? 0);
      await client.query("update profiles set bonus_bytes = bonus_bytes + $1 where user_id = $2", [extra, userId]);
      message = `¡Listo! Tienes ${(extra / 1024 ** 3).toLocaleString("es-ES", { maximumFractionDigits: 1 })} GB más.`;
    } else {
      const destino = c.plan && esPlan(c.plan) ? PLANS[c.plan] : null;
      if (!destino || !c.plan_days) return await fallo(500, "Ese código está mal configurado.");
      const actual = planEfectivo(profile);
      if (actual.rank > destino.rank) return await fallo(409, `Ya tienes un plan mejor (${actual.name}).`);
      // mismo plan vigente: se suma tiempo; si no, empieza hoy
      const base = actual.id === destino.id && profile.plan_until && profile.plan_until.getTime() > Date.now()
        ? profile.plan_until
        : new Date();
      const hasta = new Date(base.getTime() + c.plan_days * 86_400_000);
      await client.query("update profiles set plan = $1, plan_until = $2 where user_id = $3", [destino.id, hasta, userId]);
      message = `¡Listo! Plan ${destino.name} activo ${c.plan_days} días.`;
    }
    await client.query("update redeem_codes set uses = uses + 1 where code = $1", [code]);
    await client.query("commit");
    return { ok: true, message };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function apuntarListaEspera(userId: string, plan: unknown): Promise<Resultado> {
  if (!esPlan(plan) || plan === "free") return { ok: false, status: 400, error: "Ese plan no existe." };
  await query("insert into waitlist (user_id, plan) values ($1, $2) on conflict do nothing", [userId, plan]);
  return { ok: true };
}

export { PLAN_LIST };
export type { PlanId };
