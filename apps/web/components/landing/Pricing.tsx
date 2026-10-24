"use client";

import { useMemo, useState } from "react";
import StartBox from "./StartBox";
import { PLANS, gbHuman, priceHuman, type PlanCopy } from "@/lib/plans";

/** Medias de uso para la calculadora (estimación honesta, no una promesa). */
const MB_FOTO = 3; // una foto de móvil: 2–5 MB
const MB_MIN_VIDEO = 100; // un minuto de vídeo de móvil: ~60 MB (1080p) a ~170 MB (4K)
const MARGEN = 1.1; // un 10 % de holgura para que no se quede justo

function cuanto(fotos: number, minVideo: number): number {
  return (fotos * MB_FOTO + minVideo * MB_MIN_VIDEO) / 1024; // GB
}
function recomendado(gb: number): PlanCopy {
  return PLANS.find((p) => p.bytes / 1024 ** 3 >= gb) ?? PLANS[PLANS.length - 1];
}
function alDia(eur: number): string {
  const c = (eur / 30) * 100;
  return c < 10 ? `${c.toLocaleString("es-ES", { maximumFractionDigits: 1 })} céntimos` : `${Math.round(c)} céntimos`;
}

/**
 * Precios SIEMPRE a la vista y con una pregunta antes: «¿cuánto pesa tu carrete?».
 * Quien contesta ya se ha implicado y ve el plan que le toca marcado; todos los
 * planes se leen de un vistazo (el precio por día suaviza el «pago»). Los de pago
 * dicen la verdad: «muy pronto» (de momento se entra gratis y se avisa).
 */
export default function Pricing({ loggedIn, next, invited }: { loggedIn: boolean; next: string; invited: boolean }) {
  const [fotos, setFotos] = useState(4000);
  const [minutos, setMinutos] = useState(120);
  const gb = useMemo(() => cuanto(fotos, minutos), [fotos, minutos]);
  const rec = useMemo(() => recomendado(gb * MARGEN), [gb]);
  const cap = rec.bytes / 1024 ** 3;
  const uso = Math.min(100, Math.round(((gb * MARGEN) / cap) * 100));
  const gbTxt = gb < 10 ? gb.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : Math.round(gb).toLocaleString("es-ES");

  return (
    <div className="pz">
      <div className="pz-calc">
        <h3 className="pz-q">¿Cuánto pesa tu carrete?</h3>
        <div className="pz-sliders">
          <label className="pz-s">
            <span>
              Fotos <b>{fotos.toLocaleString("es-ES")}</b>
            </span>
            <input type="range" min={0} max={60000} step={500} value={fotos} onChange={(e) => setFotos(Number(e.target.value))} />
          </label>
          <label className="pz-s">
            <span>
              Vídeo <b>{minutos.toLocaleString("es-ES")} min</b>
            </span>
            <input type="range" min={0} max={3000} step={30} value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} />
          </label>
        </div>
        <div className="pz-out" role="status" aria-live="polite">
          <p>
            Tu carrete pesa unos <b>{gbTxt} GB</b>
            {rec.id === "free" ? (
              <>
                {" "}
                y <b>cabe en el plan Gratis</b> 🎉
              </>
            ) : (
              <>
                {" "}
                → te encaja <b>{rec.name}</b> ({gbHuman(rec.bytes)})
              </>
            )}
          </p>
          <div className="pz-bar" aria-hidden="true">
            <i style={{ transform: `scaleX(${uso / 100})` }} />
          </div>
          <small>Estimación media: {MB_FOTO} MB por foto y {MB_MIN_VIDEO} MB por minuto de vídeo, con un {Math.round((MARGEN - 1) * 100)} % de holgura.</small>
        </div>
      </div>

      <div className="pz-grid">
        {PLANS.map((p) => {
          const es = p.id === rec.id;
          const gratis = p.priceMonthEur === 0;
          return (
            <article key={p.id} className={`pz-card${p.highlight ? " hl" : ""}${es ? " mine" : ""}`} aria-label={`Plan ${p.name}`}>
              {es ? <span className="pz-flag mine">Para tu carrete</span> : p.highlight ? <span className="pz-flag">Recomendado</span> : null}
              <h3>{p.name}</h3>
              <p className="pz-tl">{p.tagline}</p>
              <p className="pz-price">
                {priceHuman(p.priceMonthEur)}
                <small>{gratis ? " para siempre" : "/mes"}</small>
              </p>
              <p className="pz-day">{gratis ? "Sin tarjeta, sin caducidad" : `≈ ${alDia(p.priceMonthEur)} al día`}</p>
              <p className="pz-gb">{gbHuman(p.bytes)}</p>
              <ul>
                {p.perks.slice(1).filter((x) => !/^Archivos de hasta/.test(x)).map((x) => (
                  <li key={x}>{x}</li>
                ))}
                <li>Archivos de hasta {gbHuman(p.maxFileBytes)}</li>
              </ul>
              {gratis ? (
                <StartBox loggedIn={loggedIn} next={next} invited={invited} label="Empezar gratis" proof={false} />
              ) : (
                <>
                  <StartBox loggedIn={loggedIn} next="/app/espacio" invited={invited} label={`Quiero ${p.name}`} proof={false} />
                  <p className="pz-soon">Muy pronto. Entras gratis hoy y te avisamos.</p>
                </>
              )}
            </article>
          );
        })}
      </div>
      <p className="fineprint pz-fine">Hoy no hay cobro: entras gratis. ¿Quieres más espacio ya? Invita a tus amigos y gana hasta +20 GB gratis.</p>
    </div>
  );
}
