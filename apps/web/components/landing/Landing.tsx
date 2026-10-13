import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import StartBox from "./StartBox";
import Steps from "./Steps";
import { BENEFITS, FAQ } from "./content";
import { PLANS, REFERRAL, gbHuman, priceHuman } from "@/lib/plans";

/** Las animaciones de entrada son CSS puro (`.rise`): con `motion` + `initial`
 *  el HTML del servidor llegaba con todo en opacidad 0 y la portada se veía en
 *  blanco hasta que el JS terminaba de hidratar.
 *
 *  Estructura (una idea por pantalla, de menos a más compromiso):
 *  1 promesa + UN botón · 2 cómo funciona (3 pasos) · 3 por qué · 4 precio
 *  (gratis primero, el resto plegado) · 5 invita y gana · 6 dudas · 7 botón. */
export default function Landing({
  loggedIn,
  next,
  invited,
  goodbye = false,
}: {
  loggedIn: boolean;
  next: string;
  invited: boolean;
  goodbye?: boolean;
}) {
  const free = PLANS[0];
  const paid = PLANS.slice(1);

  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true" />

      <header className="landing-nav">
        <Link href="/" className="landing-logo" aria-label="Upscale — inicio">
          <BrandMark size={34} />
          <div className="brand"><div className="wm"><span className="wm-up">up</span>scale</div></div>
        </Link>
        {loggedIn ? (
          <Link className="btn primary sm" href="/app">Mi biblioteca</Link>
        ) : (
          <a className="btn sm" href="#empezar">Entrar</a>
        )}
      </header>

      <main>
        <section className="hero" id="empezar" aria-labelledby="hero-h">
          {goodbye && !loggedIn && (
            <p className="gift rise" role="status">Tu cuenta y tus archivos se han borrado. ¡Gracias por probar Upscale!</p>
          )}
          {invited && !loggedIn && !goodbye && (
            <p className="gift rise">🎁 Un amigo te regala <b>+{gbHuman(REFERRAL.invitedBonusBytes)}</b> de espacio</p>
          )}
          <p className="eyebrow rise">TUS FOTOS, VÍDEOS Y MÚSICA</p>
          <h1 id="hero-h" className="rise" style={{ ["--d" as string]: "0.06s" }}>
            Guarda todo. <span className="ul">Sin perder nada</span>.
          </h1>
          <p className="lede rise" style={{ ["--d" as string]: "0.12s" }}>
            Tu móvil se llena. Upscale guarda el original de lo que grabas, tal cual, y lo tienes siempre a mano.
          </p>
          <div className="hero-cta rise" style={{ ["--d" as string]: "0.18s" }}>
            <StartBox loggedIn={loggedIn} next={next} invited={invited} />
          </div>
          <a className="scroll-hint rise" style={{ ["--d" as string]: "0.3s" }} href="#como">
            Cómo funciona ↓
          </a>
        </section>

        <section className="lsec" id="como" aria-labelledby="como-h">
          <h2 id="como-h" className="lsec-h">Tan fácil como <span className="ul">1, 2, 3</span></h2>
          <Steps />
        </section>

        <section className="lsec" aria-labelledby="por-h">
          <h2 id="por-h" className="lsec-h">Por qué Upscale</h2>
          <div className="features">
            {BENEFITS.map((b, i) => (
              <article key={b.t} className="feature rise-scroll">
                <span className="feature-n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{b.t}</h3>
                <p>{b.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lsec" id="planes" aria-labelledby="pl-h">
          <h2 id="pl-h" className="lsec-h">Empieza gratis</h2>
          <article className="plan-hero">
            <span className="plan-tag">{free.name}</span>
            <p className="plan-price">{gbHuman(free.bytes)}<small> para ti, ya</small></p>
            <ul>
              {free.perks.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </article>

          <details className="more-plans">
            <summary>¿Necesitas más espacio? Ver planes</summary>
            <div className="plan-row">
              {paid.map((p) => (
                <article key={p.id} className={`plan-mini ${p.highlight ? "hl" : ""}`}>
                  {p.highlight && <span className="plan-pop">Más elegido</span>}
                  <h3>{p.name}</h3>
                  <p className="plan-gb">{gbHuman(p.bytes)}</p>
                  <p className="plan-eur">{priceHuman(p.priceMonthEur)}<small>/mes</small></p>
                  <p className="plan-tl">{p.tagline}</p>
                  <span className="plan-soon">Muy pronto</span>
                </article>
              ))}
            </div>
            <p className="fineprint">Los planes de pago se activan pronto. Mientras, ¡gana espacio gratis con amigos!</p>
          </details>
        </section>

        <section className="lsec" aria-labelledby="inv-h">
          <div className="invite-card">
            <h2 id="inv-h">Invita y gana espacio</h2>
            <div className="invite-eq" aria-hidden="true">
              <span><b>+{gbHuman(REFERRAL.inviterBonusBytes)}</b> para ti</span>
              <i>+</i>
              <span><b>+{gbHuman(REFERRAL.invitedBonusBytes)}</b> para tu amigo</span>
            </div>
            <p>
              Por cada amigo que guarde su primera foto. Hasta <b>+{gbHuman(REFERRAL.maxRewarded * REFERRAL.inviterBonusBytes)}</b> gratis.
            </p>
          </div>
        </section>

        <section className="lsec" aria-labelledby="faq-h">
          <h2 id="faq-h" className="lsec-h">Dudas rápidas</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lsec final" aria-labelledby="fin-h">
          <h2 id="fin-h" className="lsec-h">Tu carrete te está esperando</h2>
          <p className="lede">Cada día que pasa, más fotos sin copia. Guárdalas hoy.</p>
          <div className="hero-cta">
            <StartBox loggedIn={loggedIn} next={next} invited={invited} label="Guardar mis fotos" />
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span>© Upscale</span>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/terminos">Términos</Link>
        <a href="/llms.txt">Info para IAs</a>
      </footer>
    </div>
  );
}
