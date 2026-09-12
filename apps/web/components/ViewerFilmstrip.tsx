"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { AssetListItem } from "@upscale/shared";

// vecinos a cada lado de la foto actual: de sobra para poder recorrer la tira
// sin quedarse corto, y ligero (≤160 miniaturas en el DOM aunque la
// biblioteca tenga decenas de miles).
const WINDOW = 80;

interface Props {
  assets: AssetListItem[];
  index: number;
  onIndex: (i: number) => void;
}

/**
 * El carrete de Fotos. A propósito NO reinventa el gesto a mano (eso fue lo
 * que se quedaba "plantado" al soltar y a veces invertía el sentido — mi
 * recentrado peleaba con el propio dedo mientras arrastrabas): se deja que el
 * navegador haga el scroll NATIVO de verdad, con su inercia — y solo se
 * escucha a qué miniatura corresponde el centro en cada momento, incluida la
 * fase de deceleración tras soltar el dedo.
 */
export default function ViewerFilmstrip({ assets, index, onIndex }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const lastReported = useRef(index);
  // true mientras SOMOS nosotros quienes movemos el scroll (centrar tras
  // llegar el índice por fuera) — para no reaccionar a nuestro propio scrollTo
  // como si fuera al usuario arrastrando y liarla.
  const programmatic = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);

  // `reportWhenSettled`: al TOCAR una miniatura directamente, no se avisa del
  // índice hasta que termine de centrarse del todo — no a mitad de camino.
  // En un móvil real un toque casi nunca está 100% quieto: ese pelín de
  // movimiento puede arrancar el scroll nativo, y si se informa antes de
  // tiempo, el ajuste de encaje final (más abajo) puede aterrizar en la
  // miniatura de al lado y pisar el toque con la vecina — "lleva a otra foto".
  const centerOn = (i: number, smooth: boolean, reportWhenSettled = false) => {
    const rail = railRef.current;
    const el = itemRefs.current.get(i);
    if (!rail || !el) return;
    programmatic.current = true;
    rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      programmatic.current = false;
      if (reportWhenSettled) {
        lastReported.current = i;
        onIndex(i);
      }
    }, smooth ? 450 : 60);
  };

  // Al MONTAR (se abre el visor), la tira arranca en scrollLeft:0 — el
  // extremo de lo más reciente, no la foto que se acaba de tocar. Sin este
  // centrado instantáneo, el primer scroll (el propio navegador ajustando el
  // scroll-snap al layout inicial) detecta "lo más cercano al centro desde
  // 0" y avisa de ESE índice, PISANDO la foto que realmente se tocó — por
  // eso siempre abría la más reciente pasara lo que pasara. Se hace ANTES de
  // pintar (useLayoutEffect) y con programmatic ya en marcha, para que ese
  // primer ajuste del navegador no llegue a reportarse nunca.
  useLayoutEffect(() => {
    centerOn(index, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // el índice cambió por otra vía (deslizar la foto grande, flechas, tocar
  // una miniatura ya centra sola) → recentrar la tira sobre él
  useEffect(() => {
    if (lastReported.current === index) return;
    lastReported.current = index;
    centerOn(index, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const onScroll = () => {
    if (programmatic.current) return; // eco de nuestro propio centrado, ignorar
    const rail = railRef.current;
    if (!rail) return;
    const center = rail.scrollLeft + rail.clientWidth / 2;
    let best = -1;
    let bestDist = Infinity;
    for (const [i, el] of itemRefs.current) {
      const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== -1 && best !== lastReported.current) {
      lastReported.current = best;
      onIndex(best);
    }
    // el scroll nativo (con su inercia) sigue disparando este evento hasta que
    // se asienta solo; en cuanto pasan 120 ms sin uno nuevo, se ha parado de
    // verdad — ahí se ajusta el encaje final al centro exacto.
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      if (best !== -1) centerOn(best, true);
    }, 120);
  };

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const from = Math.max(0, index - WINDOW);
  const to = Math.min(assets.length, index + WINDOW + 1);
  // `assets` va de más reciente a más antigua (index 0 = la última foto) y se
  // pinta en ese mismo orden: lo más reciente a la izquierda.
  const visible = assets.slice(from, to).map((a, i) => ({ a, realIndex: from + i }));

  return (
    <div ref={railRef} className="vm-film" role="listbox" aria-label="Miniaturas — desliza para recorrer" onScroll={onScroll}>
      <div className="vm-film-pad" aria-hidden="true" />
      {visible.map(({ a, realIndex }) => (
        <button
          key={a.id}
          ref={(el) => {
            if (el) itemRefs.current.set(realIndex, el);
            else itemRefs.current.delete(realIndex);
          }}
          type="button"
          className={`vm-film-item ${realIndex === index ? "on" : ""}`}
          role="option"
          aria-selected={realIndex === index}
          aria-label={a.filename}
          onClick={() => centerOn(realIndex, true, true)}
        >
          <img src={a.thumbUrl} alt="" draggable={false} loading="lazy" decoding="async" />
        </button>
      ))}
      <div className="vm-film-pad" aria-hidden="true" />
    </div>
  );
}
