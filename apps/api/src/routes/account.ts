import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser, requireAdmin, principalOf, esAdmin } from "../auth.js";
import { iniciarBorradoCuenta, borrandoCuenta, puedeBorrarAuth } from "../deleteAccount.js";
import {
  PLAN_LIST,
  PLANS,
  esPlan,
  REFERRAL_BONUS_INVITED,
  REFERRAL_BONUS_INVITER,
  REFERRAL_MAX_REWARDED,
} from "../plans.js";
import {
  cuotaDe,
  ensureProfile,
  resumenInvitaciones,
  enlazarInvitacion,
  canjearCodigo,
  apuntarListaEspera,
} from "../accounts.js";

const GB = 1024 ** 3;
/** Freno a quien prueba códigos al azar. */
const LIMITE_CODIGOS = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } } as const;

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo público (lo pinta la portada y la página del plan).
  app.get("/v1/plans", async () => ({
    plans: PLAN_LIST.map((p) => ({
      id: p.id, name: p.name, bytes: p.bytes, maxFileBytes: p.maxFileBytes, priceMonthEur: p.priceMonthEur,
    })),
    referral: {
      invitedBonusBytes: REFERRAL_BONUS_INVITED,
      inviterBonusBytes: REFERRAL_BONUS_INVITER,
      maxRewarded: REFERRAL_MAX_REWARDED,
    },
  }));

  // Todo lo de «mi espacio y mi plan» en una sola llamada.
  app.get("/v1/me/account", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    const [cuota, profile, inv] = await Promise.all([cuotaDe(p), ensureProfile(p.userId), resumenInvitaciones(p.userId)]);
    return {
      plan: {
        id: cuota.plan.id,
        name: cuota.plan.name,
        until: cuota.plan.id === "free" ? null : profile.plan_until,
        maxFileBytes: cuota.unlimited ? null : cuota.maxFileBytes,
      },
      unlimited: cuota.unlimited,
      usedBytes: cuota.usedBytes,
      limitBytes: cuota.unlimited ? null : cuota.limitBytes,
      remainingBytes: cuota.unlimited ? null : cuota.remainingBytes,
      bonusBytes: Number(profile.bonus_bytes),
      referral: {
        code: profile.referral_code,
        invited: inv.invited,
        rewarded: inv.rewarded,
        earnedBytes: inv.earnedBytes,
        maxRewarded: REFERRAL_MAX_REWARDED,
        invitedBonusBytes: REFERRAL_BONUS_INVITED,
        inviterBonusBytes: REFERRAL_BONUS_INVITER,
      },
    };
  });

  app.post("/v1/me/redeem", { preHandler: requireUser, ...LIMITE_CODIGOS }, async (req, reply) => {
    const { userId } = principalOf(req);
    const r = await canjearCodigo(userId, (req.body as { code?: unknown } | undefined)?.code);
    return r.ok ? r : reply.code(r.status).send({ error: r.error });
  });

  app.post("/v1/me/referral", { preHandler: requireUser, ...LIMITE_CODIGOS }, async (req, reply) => {
    const { userId } = principalOf(req);
    const r = await enlazarInvitacion(userId, (req.body as { code?: unknown } | undefined)?.code);
    return r.ok ? r : reply.code(r.status).send({ error: r.error });
  });

  app.post("/v1/me/waitlist", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const r = await apuntarListaEspera(userId, (req.body as { plan?: unknown } | undefined)?.plan);
    return r.ok ? r : reply.code(r.status).send({ error: r.error });
  });

  // Borrar la cuenta y TODO lo suyo. Pide escribir BORRAR (evita toques por error).
  // Responde 202 al instante: el borrado de archivos sigue en segundo plano.
  app.post(
    "/v1/me/delete",
    { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const p = principalOf(req);
      const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
      if (typeof confirm !== "string" || confirm.trim().toUpperCase() !== "BORRAR") {
        return reply.code(400).send({ error: "escribe BORRAR para confirmar" });
      }
      // la cuenta del dueño tiene atada la ingesta de Telegram: no se borra por accidente
      if (await esAdmin(p)) {
        return reply.code(403).send({ error: "la cuenta de administración no se puede borrar desde aquí" });
      }
      if (borrandoCuenta(p.userId)) return reply.code(202).send({ ok: true, yaEnCurso: true });
      iniciarBorradoCuenta(p.userId, req.log);
      return reply.code(202).send({ ok: true, accesoTambien: puedeBorrarAuth() });
    },
  );

  // ---- administración de códigos (solo administrador) ----
  app.get("/v1/admin/codes", { preHandler: requireAdmin }, async () => ({
    codes: (await query("select code, kind, bonus_bytes, plan, plan_days, max_uses, uses, expires_at, note from redeem_codes order by created_at desc")).rows,
  }));

  app.post("/v1/admin/codes", { preHandler: requireAdmin }, async (req, reply) => {
    const b = (req.body ?? {}) as {
      code?: string; kind?: string; bonusGb?: number; plan?: string; planDays?: number;
      maxUses?: number | null; expiresAt?: string | null; note?: string;
    };
    const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return reply.code(400).send({ error: "código inválido (3-40 letras, números, - o _)" });
    const maxUses = b.maxUses == null ? null : Math.max(1, Math.floor(Number(b.maxUses)));
    const expiresAt = b.expiresAt && !Number.isNaN(Date.parse(b.expiresAt)) ? b.expiresAt : null;
    if (b.kind === "bonus") {
      const gb = Number(b.bonusGb);
      if (!Number.isFinite(gb) || gb <= 0 || gb > 2048) return reply.code(400).send({ error: "bonusGb debe estar entre 0 y 2048" });
      await query(
        `insert into redeem_codes (code, kind, bonus_bytes, max_uses, expires_at, note) values ($1,'bonus',$2,$3,$4,$5)
         on conflict (code) do update set bonus_bytes = excluded.bonus_bytes, max_uses = excluded.max_uses, expires_at = excluded.expires_at, note = excluded.note`,
        [code, Math.round(gb * GB), maxUses, expiresAt, b.note ?? null],
      );
    } else if (b.kind === "plan") {
      const days = Math.floor(Number(b.planDays));
      if (!esPlan(b.plan) || b.plan === "free" || !(days > 0 && days <= 3650)) {
        return reply.code(400).send({ error: "plan (plus|pro|max) y planDays (1-3650) obligatorios" });
      }
      await query(
        `insert into redeem_codes (code, kind, plan, plan_days, max_uses, expires_at, note) values ($1,'plan',$2,$3,$4,$5,$6)
         on conflict (code) do update set plan = excluded.plan, plan_days = excluded.plan_days, max_uses = excluded.max_uses, expires_at = excluded.expires_at, note = excluded.note`,
        [code, b.plan, days, maxUses, expiresAt, b.note ?? null],
      );
    } else {
      return reply.code(400).send({ error: "kind debe ser 'bonus' o 'plan'" });
    }
    return { ok: true, code, plans: Object.keys(PLANS) };
  });
}
