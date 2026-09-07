"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import AuthButtons from "./AuthButtons";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

const FEATURES = [
  {
    t: "El original, intacto",
    d: "Subimos el archivo tal y como sale de tu iPhone. Misma resolución, mismos fotogramas, mismo bitrate. Verificado con SHA-256.",
  },
  {
    t: "En la nube, siempre",
    d: "Tus fotos y vídeos en almacenamiento de objetos. Accedes desde el navegador o instalas Upscale como app.",
  },
  {
    t: "Con tu cuenta",
    d: "Entra con Google o con tu cuenta de Apple (iCloud). Cada quien ve lo suyo, y queda registro de lo que abres.",
  },
  {
    t: "Descarga idéntica",
    d: "Cuando lo necesites para editar, te devolvemos el original byte a byte. Nada de recompresión.",
  },
];

export default function Landing({ loggedIn, next }: { loggedIn: boolean; next: string }) {
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true">
        <HeroScene />
      </div>

      <header className="landing-nav">
        <div className="brand">
          <h1>upscale</h1>
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
        <motion.p
          className="eyebrow"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          NUBE DE FOTOS PERSONAL
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08 }}
        >
          Tus fotos, <span className="ul">al máximo</span>.
        </motion.h2>
        <motion.p
          className="lede"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16 }}
        >
          Sube el carrete de tu iPhone a la nube y guárdalo en su calidad original.
          Descárgalo idéntico cuando quieras.
        </motion.p>

        <motion.div
          id="registrar"
          className="hero-cta"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24 }}
        >
          {loggedIn ? (
            <Link className="btn primary" href={next}>
              Entrar a tu biblioteca
            </Link>
          ) : (
            <AuthButtons next={next} label="Registrar" />
          )}
          <p className="fineprint">Gratis para empezar · Google o Apple · sin tarjeta</p>
        </motion.div>
      </section>

      <section className="features">
        {FEATURES.map((f, i) => (
          <motion.article
            key={f.t}
            className="feature"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: i * 0.05 }}
          >
            <span className="feature-n">{String(i + 1).padStart(2, "0")}</span>
            <h3>{f.t}</h3>
            <p>{f.d}</p>
          </motion.article>
        ))}
      </section>

      <footer className="landing-foot">
        <span>Upscale</span>
        <span>Diseño iOS 26 · Liquid Glass</span>
      </footer>
    </div>
  );
}
