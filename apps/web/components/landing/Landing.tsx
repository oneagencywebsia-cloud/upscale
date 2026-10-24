import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import StartBox from "./StartBox";
import Steps from "./Steps";
import BibliotecaVideo from "./BibliotecaVideo";
import Scrolly from "./Scrolly";
import Pricing from "./Pricing";
import Demo from "./Demo";
import StickyCta from "./StickyCta";
import { FAQ } from "./content";
import { REFERRAL, gbHuman } from "@/lib/plans";
import Aurora from "@/components/Aurora";
import MotionToggle from "@/components/MotionToggle";
import { PAGINAS } from "@/lib/seo";

/**
 * La portada es UN recorrido: al hacer scroll, las mismas formas (círculos que se
 * vuelven escalones, marcos, pantallas, una cerradura, una red de amigos…) se
 * transforman de un capítulo al siguiente, como un vídeo que avanza con el dedo.
 *
 * Estrategia (de menos a más compromiso, sin mentir ni inventar cifras):
 *  1 promesa + UN botón · 2 pérdida («¿tienes copia?») · 3 alivio (un toque) ·
 *  4 prueba de calidad · 5 en todas tus pantallas · 6 confianza (solo tuyo) ·
 *  7 recompensa social (invita y gana) · 8 cierre con el mismo botón.
 *  Después, ya con la persona implicada: cómo es, planes con calculadora, la función
 *  inesperada (capturas → notas), dudas y botón fijo en el móvil.
 */
export default function Landing({
  loggedIn,
  next,
  invited,
  goodbye = false,
  authError = false,
}: {
  loggedIn: boolean;
  next: string;
  invited: boolean;
  goodbye?: boolean;
  authError?: boolean;
}) {
  // Regla del texto: un titular corto y UNA línea de apoyo. Cada capítulo pulsa una sola emoción.
  const escenaA = [
    // 0 · promesa (esperanza)
    <div key="0" className="sc-txt" id="empezar">
      {authError && !loggedIn && (
        <p className="gift gift-err" role="alert">No pudimos dejarte entrar. Inténtalo otra vez o entra con tu correo.</p>
      )}
      {goodbye && !loggedIn && (
        <p className="gift" role="status">Tu cuenta y tus archivos se han borrado. ¡Gracias por probar Upscale!</p>
      )}
      {invited && !loggedIn && !goodbye && (
        <p className="gift">🎁 Un amigo te regala <b>+{gbHuman(REFERRAL.invitedBonusBytes)}</b> de espacio</p>
      )}
      <p className="sc-eyebrow">TUS RECUERDOS</p>
      <h1 className="sc-h">Guarda todo. <span className="ul">Sin perder nada</span>.</h1>
      <p className="sc-p">El original, tal cual. Siempre a mano.</p>
      <StartBox loggedIn={loggedIn} next={next} invited={invited} />
      <a className="sc-hint" href="#planes" data-sc-next>Desliza: te lo enseño en 20 segundos ↓</a>
    </div>,
    // 1 · pérdida (miedo a perder)
    <div key="1" className="sc-txt">
      <p className="sc-eyebrow">¿TE SUENA?</p>
      <h2 className="sc-h">¿Y si se rompe <span className="ul">tu móvil</span>?</h2>
      <p className="sc-p">¿Tienes copia de tus recuerdos?</p>
    </div>,
    // 2 · alivio (un solo paso)
    <div key="2" className="sc-txt" id="como">
      <p className="sc-eyebrow">UN TOQUE</p>
      <h2 className="sc-h">Todo a salvo. <span className="ul">Sin esfuerzo.</span></h2>
      <p className="sc-p">Fotos, vídeos y música, a la vez.</p>
    </div>,
    // 3 · prueba (calidad)
    <div key="3" className="sc-txt">
      <p className="sc-eyebrow">SIN PERDER CALIDAD</p>
      <h2 className="sc-h">Ni un píxel <span className="ul">menos</span></h2>
      <p className="sc-p">Lo que bajas es idéntico a lo que subiste.</p>
    </div>,
  ];
  const escenaB = [
    // 0 · comodidad
    <div key="4" className="sc-txt">
      <p className="sc-eyebrow">EN TODAS PARTES</p>
      <h2 className="sc-h">En <span className="ul">tus pantallas</span></h2>
      <p className="sc-p">Móvil, tableta u ordenador.</p>
    </div>,
    // 1 · confianza
    <div key="5" className="sc-txt">
      <p className="sc-eyebrow">PRIVADO</p>
      <h2 className="sc-h">Solo <span className="ul">tuyo</span></h2>
      <p className="sc-p">Nadie más lo ve. Te lo llevas cuando quieras.</p>
    </div>,
    // 2 · reciprocidad
    <div key="6" className="sc-txt">
      <p className="sc-eyebrow">GANÁIS LOS DOS</p>
      <h2 className="sc-h">Invita y <span className="ul">gana</span></h2>
      <p className="sc-p">
        <b>+{gbHuman(REFERRAL.inviterBonusBytes)}</b> para ti, <b>+{gbHuman(REFERRAL.invitedBonusBytes)}</b> para tu amigo.
      </p>
    </div>,
  ];
  const escenaC = [
    // 0 · el tiempo pasa (urgencia sin presión falsa)
    <div key="c0" className="sc-txt">
      <p className="sc-eyebrow">PIÉNSALO</p>
      <h2 className="sc-h">Mañana querrás <span className="ul">las de hoy</span></h2>
      <p className="sc-p">Guárdalas antes de que se pierdan.</p>
    </div>,
    // 1 · cierre (el mismo botón)
    <div key="7" className="sc-txt" id="final">
      <p className="sc-eyebrow">EMPIEZA HOY</p>
      <h2 className="sc-h">Tu carrete <span className="ul">te espera</span></h2>
      <StartBox loggedIn={loggedIn} next={next} invited={invited} label="Guardar mis fotos" />
      <p className="sc-garantia">Descargas todo o borras tu cuenta cuando quieras. Sin letra pequeña.</p>
    </div>,
  ];

  return (
    <div className="landing">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <noscript>
        <style>{`.sc{height:auto!important}.sc-escenario{position:static!important;height:auto!important;overflow:visible!important}.sc-formas,.sc-barra,.sc-escenario::after{display:none!important}.sc-cap{position:relative!important;inset:auto!important;opacity:1!important;transform:none!important;pointer-events:auto!important;padding-top:48px!important;padding-bottom:48px!important}`}</style>
      </noscript>
      <Aurora section="landing" />

      <header className="landing-nav">
        <Link href="/" className="landing-logo" aria-label="Upscale — inicio">
          <BrandMark size={34} />
          <div className="brand"><div className="wm"><span className="wm-up">up</span>scale</div></div>
        </Link>
        <div className="landing-nav-r">
          <MotionToggle />
          {loggedIn ? (
            <Link className="btn primary sm" href="/app">Mi biblioteca</Link>
          ) : (
            <a className="btn sm" href="#empezar" data-sc-top>Entrar</a>
          )}
        </div>
      </header>

      <main id="contenido" tabIndex={-1}>
        <Scrolly escena="a" capitulos={escenaA} />

        <section className="lsec bib" aria-labelledby="bib-h">
          <div className="bib-tel" aria-hidden="false">
            <BibliotecaVideo />
          </div>
          <div className="bib-txt">
            <h2 id="bib-h" className="lsec-h">Tu biblioteca, <span className="ul">a tu manera</span></h2>
            <ul className="bib-lista">
              <li><b>Verticales u horizontales,</b> con un toque.</li>
              <li><b>Busca</b> por nombre, fecha o cámara.</li>
              <li><b>Siempre el original.</b></li>
            </ul>
            <div className="bib-chips" aria-hidden="true">
              <span className="on">Todas</span><span>Verticales</span><span>Horizontales</span>
            </div>
          </div>
        </section>

        <section className="lsec" aria-labelledby="pasos-h">
          <h2 id="pasos-h" className="lsec-h">Tan fácil como <span className="ul">1, 2, 3</span></h2>
          <Steps />
        </section>

        <Scrolly escena="b" capitulos={escenaB} />

        <section className="lsec" id="planes" aria-labelledby="pl-h">
          <h2 id="pl-h" className="lsec-h">Empieza gratis. <span className="ul">Crece cuando quieras.</span></h2>
          <Pricing loggedIn={loggedIn} next={next} invited={invited} />
        </section>

        <section className="lsec" aria-labelledby="notas-h">
          <h2 id="notas-h" className="lsec-h">Y también guarda <span className="ul">tus notas</span></h2>
          <p className="lede lsec-lede">Haz una captura de algo importante: Upscale lee el texto y lo deja listo para editar.</p>
          <Demo />
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

        <Scrolly escena="c" capitulos={escenaC} />
      </main>

      <StickyCta label="Empezar gratis" />

      <nav className="pub-more landing-more" aria-label="Más sobre Upscale">
        <b>Aprende más</b>
        <ul>
          {PAGINAS.filter((p) => p.kind !== "legal").map((p) => (
            <li key={p.path}><Link href={p.path}>{p.label}</Link></li>
          ))}
        </ul>
      </nav>

      <footer className="landing-foot">
        <span>© Upscale</span>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/terminos">Términos</Link>
        <a href="/llms.txt">Info para IAs</a>
      </footer>
    </div>
  );
}
