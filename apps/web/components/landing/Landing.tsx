import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import StartBox from "./StartBox";
import Steps from "./Steps";
import BibliotecaVideo from "./BibliotecaVideo";
import Pal from "./Pal";
import { Confeti, Corazones, Destello, Escudo, Latido, Motas, Ondas, Rayos } from "./Efectos";
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
  // Regla del texto: un titular corto y UNA línea de apoyo. Cada capítulo toca UNA emoción, en este orden
  // (arco emocional): ternura → miedo a perder (resuelto al instante) → alivio → orgullo por la calidad →
  // comodidad → intimidad → legado → gratitud → arrepentimiento futuro → alegría de empezar.
  // Nada de cifras ni testimonios inventados; el miedo siempre va seguido de una acción fácil.
  const escenaA = [
    // 0 · ternura y nostalgia
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
      <h1 className="sc-h"><Pal i0={1}>Lo que más quieres,</Pal> <span className="ul"><Pal i0={5}>a salvo.</Pal></span></h1>
      <p className="sc-p">Sus risas. Sus primeros pasos. Tus mejores días.</p>
      <StartBox loggedIn={loggedIn} next={next} invited={invited} label="Guardar mis recuerdos" />
      <a className="sc-hint" href="#planes" data-sc-next>Desliza ↓</a>
    </div>,
    // 1 · miedo a perder (se resuelve en el siguiente capítulo)
    <div key="1" className="sc-txt">
      <p className="sc-eyebrow">ES FRÁGIL</p>
      <h2 className="sc-h"><Pal i0={1}>Tu móvil puede romperse.</Pal> <span className="ul"><Pal i0={5}>Tus recuerdos, no.</Pal></span></h2>
      <p className="sc-p">Hay fotos que no se repiten.</p>
    </div>,
    // 2 · alivio
    <div key="2" className="sc-txt" id="como">
      <p className="sc-eyebrow">UN TOQUE</p>
      <h2 className="sc-h"><Pal i0={1}>Hecho.</Pal> <span className="ul"><Pal i0={2}>Ya están a salvo.</Pal></span></h2>
      <p className="sc-p">Fotos, vídeos y música, todo a la vez.</p>
    </div>,
    // 3 · orgullo por conservarlo igual (calidad)
    <div key="3" className="sc-txt">
      <p className="sc-eyebrow">SIN PERDER CALIDAD</p>
      <h2 className="sc-h"><Pal i0={1}>Cada risa,</Pal> <span className="ul"><Pal i0={3}>tal como fue.</Pal></span></h2>
      <p className="sc-p">Ni un píxel menos. Para volver a verla dentro de veinte años.</p>
    </div>,
  ];
  const escenaB = [
    // 0 · comodidad
    <div key="4" className="sc-txt">
      <p className="sc-eyebrow">EN TODAS PARTES</p>
      <h2 className="sc-h"><Pal i0={1}>Tus recuerdos</Pal> <span className="ul"><Pal i0={3}>te siguen.</Pal></span></h2>
      <p className="sc-p">Móvil, tableta u ordenador.</p>
    </div>,
    // 1 · intimidad y confianza
    <div key="5" className="sc-txt">
      <p className="sc-eyebrow">PRIVADO</p>
      <h2 className="sc-h"><span className="ul"><Pal i0={1}>Solo tuyo.</Pal></span></h2>
      <p className="sc-p">Nadie más lo ve. Te lo llevas cuando quieras.</p>
    </div>,
    // 2 · legado
    <div key="6" className="sc-txt">
      <p className="sc-eyebrow">LO QUE DEJAS</p>
      <h2 className="sc-h"><Pal i0={1}>Que tus hijos conozcan</Pal> <span className="ul"><Pal i0={5}>tu historia.</Pal></span></h2>
      <p className="sc-p">Fotos, vídeos, música y notas, para quien venga después.</p>
    </div>,
    // 3 · gratitud y reciprocidad
    <div key="7" className="sc-txt">
      <p className="sc-eyebrow">GANÁIS LOS DOS</p>
      <h2 className="sc-h"><Pal i0={1}>Regala</Pal> <span className="ul"><Pal i0={2}>espacio.</Pal></span></h2>
      <p className="sc-p">
        <b>+{gbHuman(REFERRAL.inviterBonusBytes)}</b> para ti y <b>+{gbHuman(REFERRAL.invitedBonusBytes)}</b> para quien invites.
      </p>
    </div>,
  ];
  const escenaC = [
    // 0 · arrepentimiento anticipado (honesto: sin urgencia falsa)
    <div key="c0" className="sc-txt">
      <p className="sc-eyebrow">PIÉNSALO</p>
      <h2 className="sc-h"><Pal i0={1}>Dentro de veinte años,</Pal> <span className="ul"><Pal i0={5}>las querrás.</Pal></span></h2>
      <p className="sc-p">Hoy es el día de ponerlas a salvo.</p>
    </div>,
    // 1 · alegría y cierre: el mismo botón
    <div key="c1" className="sc-txt" id="final">
      <p className="sc-eyebrow">EMPIEZA CON UNO</p>
      <h2 className="sc-h"><Pal i0={1}>Tu primer recuerdo,</Pal> <span className="ul"><Pal i0={4}>a salvo hoy.</Pal></span></h2>
      <StartBox loggedIn={loggedIn} next={next} invited={invited} label="Guardar mis recuerdos" />
      <p className="sc-garantia">Descargas todo o borras tu cuenta cuando quieras. Sin letra pequeña.</p>
    </div>,
  ];
  // animaciones propias de cada capítulo (viven en su fondo y solo corren mientras se ven)
  const fxA = [
    <><Rayos /><Motas n={14} dir="sube" tono="calido" /></>,
    <><Latido /><Motas n={16} dir="cae" tono="frio" /></>,
    <><Ondas /><Motas n={12} dir="sube" tono="calido" /></>,
    <><Destello /><Motas n={8} dir="sube" tono="neutro" /></>,
  ];
  const fxB = [
    <Motas key="b0" n={10} dir="sube" tono="neutro" />,
    <Escudo key="b1" />,
    <><Rayos suave /><Motas n={24} dir="sube" tono="dorado" /></>,
    <Corazones key="b3" />,
  ];
  const fxC = [
    <Motas key="c0" n={20} dir="cae" tono="sepia" />,
    <><Rayos /><Confeti /><Motas n={12} dir="sube" tono="dorado" /></>,
  ];

  return (
    <div className="landing">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <noscript>
        <style>{`.sc{height:auto!important}.sc-escenario{position:static!important;height:auto!important;overflow:visible!important}.sc-formas,.sc-escenario::after{display:none!important}.sc-w,.sc-eyebrow,.sc-p,.sc-garantia,.sc-hint,.sc-cap .start{opacity:1!important;transform:none!important}.sc-cap{position:relative!important;inset:auto!important;opacity:1!important;transform:none!important;pointer-events:auto!important;padding-top:48px!important;padding-bottom:48px!important}`}</style>
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
        <Scrolly escena="a" capitulos={escenaA} efectos={fxA} />

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

        <Scrolly escena="b" capitulos={escenaB} efectos={fxB} />

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

        <Scrolly escena="c" capitulos={escenaC} efectos={fxC} />
      </main>

      <StickyCta label="Guardar mis recuerdos" />

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
