import type { Metadata, Viewport } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import Aurora from "@/components/Aurora";
import Mark3D from "@/components/Mark3D";
import { publicViewport } from "@/lib/seo";

export const viewport: Viewport = publicViewport;
// no se indexa: es la respuesta a una dirección que no existe
export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false, follow: false } };

/** 404 de las páginas públicas: con la marca, en español y con una salida clara. */
export default function NotFound() {
  return (
    <div className="landing legal">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <Aurora section="landing" />
      <header className="landing-nav">
        <Link href="/" className="landing-logo" aria-label="Upscale — inicio">
          <BrandMark size={34} />
          <div className="brand"><div className="wm"><span className="wm-up">up</span>scale</div></div>
        </Link>
      </header>
      <main id="contenido" tabIndex={-1} className="nf">
        <div className="hero-mark" aria-hidden="true">
          <Mark3D size={150} />
        </div>
        <p className="eyebrow">ERROR 404</p>
        <h1>No encontramos esa página</h1>
        <p className="lede">Puede que el enlace esté mal escrito o que la página ya no exista. Tus archivos no han cambiado.</p>
        <div className="nf-actions">
          <Link className="btn primary" href="/">Ir al inicio</Link>
          <Link className="btn" href="/app">Mi biblioteca</Link>
        </div>
      </main>
    </div>
  );
}
