"use client";

import { useEffect } from "react";
import BrandMark from "@/components/BrandMark";

/**
 * Apertura de marca (solo CSS, ~2,5 s, una vez por visita): el símbolo se construye peldaño a peldaño,
 * la línea se traza, el punto de luz se enciende, la palabra «upscale» sube letra a letra y todo se
 * disuelve en la portada. Es decorativa (aria-hidden, no recibe toques) y se salta con «reducir
 * movimiento», con las animaciones apagadas y en las visitas siguientes de la misma sesión.
 * Aunque no cargue el JavaScript, el propio CSS la retira.
 */
const INICIO = `try{var d=document.documentElement,m=d.getAttribute('data-motion'),r=matchMedia('(prefers-reduced-motion: reduce)').matches;if(m==='off'||(m!=='on'&&r)||sessionStorage.getItem('up-intro')){d.setAttribute('data-intro','0')}else{sessionStorage.setItem('up-intro','1');d.classList.add('up-intro')}}catch(e){}`;

export default function BrandIntro() {
  useEffect(() => {
    // el texto de la portada espera a que termine la apertura; después vuelve a su ritmo normal
    const t = window.setTimeout(() => document.documentElement.classList.remove("up-intro"), 2600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INICIO }} />
      <div className="bi" aria-hidden="true">
        <div className="bi-marca">
          <BrandMark size={144} className="bi-mark" />
          <i className="bi-ping" />
          <i className="bi-ping bi-ping2" />
        </div>
        <div className="bi-wm">
          {"upscale".split("").map((l, i) => (
            <span key={i} className={i < 2 ? "bi-l bi-up" : "bi-l"} style={{ ["--i" as string]: i }}>{l}</span>
          ))}
        </div>
        <p className="bi-tag">Lo que más quieres, a salvo.</p>
      </div>
    </>
  );
}
