import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import Aurora from "@/components/Aurora";

/** Marco común de las páginas legales: claro, corto y con resumen arriba. */
export default function LegalPage({
  title,
  updated,
  summary,
  children,
}: {
  title: string;
  updated: string;
  summary: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="landing legal">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <Aurora section="landing" />
      <header className="landing-nav">
        <Link href="/" className="landing-logo" aria-label="Upscale — inicio">
          <BrandMark size={34} />
          <div className="brand"><div className="wm"><span className="wm-up">up</span>scale</div></div>
        </Link>
        <Link className="btn sm" href="/">Volver</Link>
      </header>
      <main id="contenido" tabIndex={-1} className="legal-body">
        <h1>{title}</h1>
        <p className="legal-updated">Última actualización: {updated}</p>
        <aside className="legal-summary" aria-label="En pocas palabras">
          <b>En pocas palabras</b>
          <ul>
            {summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </aside>
        {children}
      </main>
      <footer className="landing-foot">
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/terminos">Términos</Link>
      </footer>
    </div>
  );
}
