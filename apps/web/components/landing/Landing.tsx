import Link from "next/link";
import AuthButtons from "./AuthButtons";

const FEATURES = [
  {
    t: "El original, intacto",
    d: "Subimos el archivo tal y como sale de tu iPhone. Misma resolución, mismos fotogramas, mismo bitrate. Verificado con SHA-256.",
  },
  {
    t: "En la nube, siempre",
    d: "Tus fotos y vídeos guardados fuera del móvil. Accedes desde el navegador o instalas Upscale como app.",
  },
  {
    t: "Con tu cuenta",
    d: "Entra con Google, con Apple o con tu email. Cada quien ve lo suyo, y queda registro de lo que abres.",
  },
  {
    t: "Descarga idéntica",
    d: "Cuando lo necesites para editar, te devolvemos el original byte a byte. Nada de recompresión.",
  },
];

/** Las animaciones de entrada son CSS puro (`.rise`): con `motion` + `initial`
 *  el HTML del servidor llegaba con todo en opacidad 0 y la portada se veía en
 *  blanco hasta que el JS terminaba de hidratar. */
export default function Landing({ loggedIn, next }: { loggedIn: boolean; next: string }) {
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true" />

      <header className="landing-nav">
        <div className="brand">
          <h1><span className="wm-up">up</span>scale</h1>
        </div>
        {loggedIn ? (
          <Link className="btn primary sm" href="/app">
            Entrar a tu biblioteca
          </Link>
        ) : (
          <Link className="btn sm" href="#registrar">
            Registrar
          </Link>
        )}
      </header>

      <section className="hero">
        <p className="eyebrow rise">NUBE DE FOTOS PERSONAL</p>
        <h2 className="rise" style={{ ["--d" as string]: "0.08s" }}>
          Tus fotos, <span className="ul">al máximo</span>.
        </h2>
        <p className="lede rise" style={{ ["--d" as string]: "0.16s" }}>
          Sube el carrete de tu iPhone a la nube y guárdalo en su calidad original.
          Descárgalo idéntico cuando quieras.
        </p>

        <div id="registrar" className="hero-cta rise" style={{ ["--d" as string]: "0.24s" }}>
          {loggedIn ? (
            <Link className="btn primary" href={next}>
              Entrar a tu biblioteca
            </Link>
          ) : (
            <AuthButtons next={next} label="Registrar" />
          )}
        </div>
      </section>

      <section className="features">
        {FEATURES.map((f, i) => (
          <article key={f.t} className="feature rise rise-scroll" style={{ ["--d" as string]: `${i * 0.05}s` }}>
            <span className="feature-n">{String(i + 1).padStart(2, "0")}</span>
            <h3>{f.t}</h3>
            <p>{f.d}</p>
          </article>
        ))}
      </section>

      <footer className="landing-foot">
        <span>Upscale</span>
        <span>Diseño iOS 26 · Liquid Glass</span>
      </footer>
    </div>
  );
}
