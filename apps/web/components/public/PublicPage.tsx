import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import Aurora from "@/components/Aurora";
import { PAGINAS, ldJson, breadcrumbLd, organizationLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/** Marco común de las páginas públicas de contenido (cómo funciona, planes,
 *  formatos, preguntas, guías): navegación, migas de pan visibles y en datos
 *  estructurados, aviso para empezar y enlaces internos a todas las demás. */
export default async function PublicPage({
  path,
  title,
  lead,
  crumbs,
  jsonLd = [],
  children,
}: {
  path: string;
  title: string;
  lead: string;
  /** migas intermedias (la página actual se añade sola) */
  crumbs?: { name: string; path: string }[];
  jsonLd?: unknown[];
  children: React.ReactNode;
}) {
  const base = await siteUrl();
  const me = PAGINAS.find((p) => p.path === path);
  const trail = [...(crumbs ?? []), { name: me?.label ?? title, path }];
  const graph = [organizationLd(base), breadcrumbLd(base, trail), ...jsonLd];

  return (
    <div className="landing legal pub">
      <Aurora section="landing" />
      <header className="landing-nav">
        <Link href="/" className="landing-logo" aria-label="Upscale — inicio">
          <BrandMark size={34} />
          <div className="brand"><div className="wm"><span className="wm-up">up</span>scale</div></div>
        </Link>
        <Link className="btn primary sm" href="/#empezar">Empezar gratis</Link>
      </header>

      <main className="legal-body pub-body">
        <nav className="crumbs" aria-label="Migas de pan">
          <ol>
            <li><Link href="/">Inicio</Link></li>
            {trail.map((c, i) => (
              <li key={c.path} aria-current={i === trail.length - 1 ? "page" : undefined}>
                {i === trail.length - 1 ? c.name : <Link href={c.path}>{c.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>
        <h1>{title}</h1>
        <p className="pub-lead">{lead}</p>
        {children}

        <aside className="pub-cta" aria-label="Empieza gratis">
          <b>Guarda todo, sin perder nada</b>
          <p>5 GB gratis, sin tarjeta. Tus fotos, vídeos y música en su calidad original.</p>
          <Link className="btn primary" href="/#empezar">Empezar gratis</Link>
        </aside>

        <nav className="pub-more" aria-label="Más sobre Upscale">
          <b>Sigue leyendo</b>
          <ul>
            {PAGINAS.filter((p) => p.kind !== "legal" && p.path !== path).map((p) => (
              <li key={p.path}><Link href={p.path}>{p.label}</Link></li>
            ))}
          </ul>
        </nav>
      </main>

      <footer className="landing-foot">
        <span>© Upscale</span>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/terminos">Términos</Link>
        <a href="/llms.txt">Info para IAs</a>
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(graph) }} />
    </div>
  );
}
