"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { AccountInfo } from "@upscale/shared";
import { PLANS, gbHuman, priceHuman, type PlanId } from "@/lib/plans";

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { error: "Sin conexión. Inténtalo otra vez." } };
  }
}

/** Tu espacio, tu plan, invitar amigos y canjear un código — todo en una pantalla, sin tecnicismos. */
export default function PlanPanel({ account }: { account: AccountInfo }) {
  const [a, setA] = useState(account);
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waiting, setWaiting] = useState<Set<PlanId>>(new Set());

  const pct = a.limitBytes ? Math.min(100, Math.round((a.usedBytes / a.limitBytes) * 100)) : 0;
  const cerca = !a.unlimited && pct >= 80;
  const link = typeof window === "undefined" ? "" : `${location.origin}/?ref=${a.referral.code}`;

  async function refresh() {
    const r = await fetch("/api/account", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setA((await r.json()) as AccountInfo);
  }

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    const r = await post("/api/redeem", { code });
    setBusy(false);
    setCodeMsg({ ok: r.ok, text: String(r.ok ? r.data.message : r.data.error ?? "No se pudo canjear.") });
    if (r.ok) {
      setCode("");
      void refresh();
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* el navegador no deja copiar: el enlace está visible para hacerlo a mano */
    }
  }

  async function share() {
    const text = `Guarda tus fotos y vídeos en su calidad original con Upscale. Con mi enlace tienes ${gbHuman(a.referral.invitedBonusBytes)} extra:`;
    if (navigator.share) await navigator.share({ title: "Upscale", text, url: link }).catch(() => {});
    else void copy();
  }

  async function avisame(plan: PlanId) {
    setWaiting((w) => new Set(w).add(plan));
    const r = await post("/api/waitlist", { plan });
    if (!r.ok) setWaiting((w) => { const n = new Set(w); n.delete(plan); return n; });
  }

  const dots = Array.from({ length: a.referral.maxRewarded }, (_, i) => i < a.referral.rewarded);

  return (
    <>
      <section className="panel plan-card" aria-labelledby="plan-h">
        <div className="plan-head">
          <h3 id="plan-h">Tu espacio</h3>
          <span className="plan-badge">Plan {a.plan.name}</span>
        </div>
        {a.unlimited ? (
          <p className="plan-big">
            {gbHuman(a.usedBytes)} <small>usados · sin límite</small>
          </p>
        ) : (
          <>
            <p className="plan-big">
              {gbHuman(Math.max(0, a.remainingBytes ?? 0))} <small>libres de {gbHuman(a.limitBytes ?? 0)}</small>
            </p>
            <div className="space-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% usado`}>
              <motion.div
                className="space-bar-fill"
                data-warn={cerca}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 90, damping: 20 }}
              />
              <span>{pct}%</span>
            </div>
            {a.plan.maxFileBytes && (
              <p className="panel-lede">Cada archivo puede pesar hasta {gbHuman(a.plan.maxFileBytes)}.</p>
            )}
            {a.plan.until && a.plan.id !== "free" && (
              <p className="panel-lede">Tu plan {a.plan.name} dura hasta el {new Date(a.plan.until).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}.</p>
            )}
            {cerca && (
              <p className="plan-nudge">
                Te estás quedando sin espacio. Invita a un amigo, canjea un código o mira los planes: abajo lo tienes todo.
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="inv-h">
        <h3 id="inv-h">Invita y gana espacio</h3>
        <p className="panel-lede">
          Por cada amigo que guarde su primera foto: <b>tú +{gbHuman(a.referral.inviterBonusBytes)}</b> y <b>él +{gbHuman(a.referral.invitedBonusBytes)}</b>.
          Hasta +{gbHuman(a.referral.maxRewarded * a.referral.inviterBonusBytes)}.
        </p>
        <div className="plan-link">
          <input readOnly value={link} aria-label="Tu enlace de invitación" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn primary sm" type="button" onClick={copy}>{copied ? "¡Copiado!" : "Copiar"}</button>
          <button className="btn sm" type="button" onClick={share}>Compartir</button>
        </div>
        <div className="plan-dots" aria-label={`${a.referral.rewarded} de ${a.referral.maxRewarded} invitaciones premiadas`}>
          {dots.map((on, i) => <i key={i} className={on ? "on" : ""} />)}
        </div>
        <p className="panel-lede">
          {a.referral.invited === 0
            ? "Aún no has invitado a nadie. ¡El primero es el más fácil!"
            : `${a.referral.invited} ${a.referral.invited === 1 ? "amigo se ha unido" : "amigos se han unido"} · ${gbHuman(a.referral.earnedBytes)} ganados`}
        </p>
      </section>

      <section className="panel" aria-labelledby="cod-h">
        <h3 id="cod-h">¿Tienes un código?</h3>
        <form className="plan-code" onSubmit={redeem}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Escríbelo aquí"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            aria-label="Código"
          />
          <button className="btn primary sm" type="submit" disabled={!code.trim() || busy}>{busy ? "…" : "Canjear"}</button>
        </form>
        {codeMsg && <p className={`plan-msg ${codeMsg.ok ? "ok" : "err"}`} role="status">{codeMsg.ok ? "🎉 " : ""}{codeMsg.text}</p>}
      </section>

      <section className="panel" aria-labelledby="pl-h">
        <h3 id="pl-h">Planes</h3>
        <div className="plan-grid">
          {PLANS.map((p) => {
            const actual = p.id === a.plan.id;
            return (
              <article key={p.id} className={`plan-opt ${p.highlight ? "hl" : ""} ${actual ? "cur" : ""}`}>
                {p.highlight && <span className="plan-flag">Recomendado</span>}
                <h4>{p.name}</h4>
                <p className="plan-price">{priceHuman(p.priceMonthEur)}<small>{p.priceMonthEur ? " /mes" : ""}</small></p>
                <p className="plan-size">{gbHuman(p.bytes)}</p>
                <ul>{p.perks.map((x) => <li key={x}>{x}</li>)}</ul>
                {actual ? (
                  <span className="plan-here">Tu plan</span>
                ) : p.id === "free" ? null : waiting.has(p.id) ? (
                  <span className="plan-here">¡Apuntado! Te avisamos</span>
                ) : (
                  <button className="btn sm" type="button" onClick={() => avisame(p.id)}>Avísame</button>
                )}
              </article>
            );
          })}
        </div>
        <p className="panel-lede">Los planes de pago llegan muy pronto. Pulsa «Avísame» y serás de los primeros.</p>
      </section>
    </>
  );
}
