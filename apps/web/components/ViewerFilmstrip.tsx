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
  const lastReported = useRef(index);
  // true mientras SOMOS nosotros quienes movemos el scroll (centrar tras
  // llegar el índice por fuera) — para no reaccionar a nuestro propio scrollTo
  // como si fuera al usuario arrastrando y liarla.
  const programmatic = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);

  const from = Math.max(0, index - WINDOW);
  const to = Math.min(assets.length, index + WINDOW + 1);
  // `assets` va de más reciente a más antigua (index 0 = la última foto) y se
  // pinta en ese mismo orden: lo más reciente a la izquierda.
  const visible = assets.slice(from, to).map((a, i) => ({ a, realIndex: from + i }));

  /**
   * Centro de cada miniatura (en px de scroll), medido UNA vez por pintado en
   * vez de en cada evento de scroll. Antes se recorrían las ~160 miniaturas
   * leyendo `offsetLeft`/`clientWidth` de cada una dentro del `onScroll`: eso
   * son ~320 lecturas que fuerzan recálculo de layout, 60 veces por segundo
   * mientras el dedo arrastra. Era la causa del tirón del carrete en el móvil.
   */
  const centers = useRef<{ i: number; c: number }[]>([]);
  const measure = () => {
    const rail = railRef.current;
    if (!rail) return;
    const out: { i: number; c: number }[] = [];
    for (const el of Array.from(rail.children) as HTMLElement[]) {
      const raw = el.dataset.i;
      if (raw === undefined) continue; // los dos rellenos de los extremos
      out.push({ i: Number(raw), c: el.offsetLeft + el.offsetWidth / 2 });
    }
    centers.current = out;
  };

  const centerOf = (i: number) => centers.current.find((p) => p.i === i)?.c;

  // `reportWhenSettled`: al TOCAR una miniatura directamente, no se avisa del
  // índice hasta que termine de centrarse del todo — no a mitad de camino.
  // En un móvil real un toque casi nunca está 100% quieto: ese pelín de
  // movimiento puede arrancar el scroll nativo, y si se informa antes de
  // tiempo, el ajuste de encaje final (más abajo) puede aterrizar en la
  // miniatura de al lado y pisar el toque con la vecina — "lleva a otra foto".
  const centerOn = (i: number, smooth: boolean, reportWhenSettled = false) => {
    const rail = railRef.current;
    const c = centerOf(i);
    if (!rail || c === undefined) return;
    programmatic.current = true;
    rail.scrollTo({ left: c - rail.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(
      () => {
        programmatic.current = false;
        if (reportWhenSettled) {
          lastReported.current = i;
          onIndex(i);
        }
      },
      smooth ? 450 : 60,
    );
  };

  /**
   * Un solo efecto de layout, en cada pintado, y en este orden:
   *
   *  1. Se re-miden los centros (el contenido de la tira cambia con la ventana
   *     de ±80 y con las páginas que va cargando la galería).
   *  2. Al MONTAR (se abre el visor), la tira arranca en scrollLeft:0 — el
   *     extremo de lo más reciente, no la foto que se acaba de tocar. Sin este
   *     centrado instantáneo, el primer scroll (el propio navegador ajustando
   *     el scroll-snap al layout inicial) detecta "lo más cercano al centro
   *     desde 0" y avisa de ESE índice, PISANDO la foto que realmente se tocó.
   *  3. En los siguientes pintados, si la ventana se ha desplazado (pasas de
   *     la miniatura 80 y entra una por la derecha y sale otra por la
   *     izquierda), el contenido se mueve 45 px BAJO el dedo mientras el
   *     scrollLeft sigue igual: la tira daba un salto por cada foto a partir
   *     de la 80. Se compensa el scroll con lo que se haya movido el ancla.
   */
  const anchor = useRef<{ i: number; c: number } | null>(null);
  // huella de lo que hay pintado ahora mismo en la tira: si no cambia, las
  // posiciones tampoco pueden haber cambiado (el resaltado de la miniatura
  // activa es un `transform`, que no mueve el layout) y no hay que re-medir.
  const sig = `${from}:${to}:${visible[0]?.a.id ?? ""}:${visible[visible.length - 1]?.a.id ?? ""}`;
  const lastSig = useRef<string | null>(null);
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const refreshAnchor = () => {
      const c = centerOf(index);
      if (c !== undefined) anchor.current = { i: index, c };
    };
    if (lastSig.current === sig) {
      refreshAnchor();
      return;
    }
    const first = lastSig.current === null;
    lastSig.current = sig;
    const prev = anchor.current;
    measure();
    if (first) {
      centerOn(index, false);
    } else if (prev) {
      const now = centerOf(prev.i);
      if (now !== undefined && now !== prev.c) rail.scrollLeft += now - prev.c;
    }
    refreshAnchor();
  });

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
    for (const { i, c } of centers.current) {
      const d = Math.abs(c - center);
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
    // se asienta solo; en cuanto pasan 220 ms sin uno nuevo, se ha parado de
    // verdad — ahí se ajusta el encaje final al centro exacto. Con
    // `scroll-snap-type: mandatory` el navegador ya encaja solo casi siempre;
    // esto es red de seguridad, no el mecanismo principal — por eso el plazo
    // es generoso: con 120ms este reencaje a veces se adelantaba a que la
    // propia inercia nativa terminase de frenar, y el salto a "smooth" cortaba
    // en seco ese frenado natural (se sentía como que se plantaba de golpe).
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      if (best !== -1) centerOn(best, true);
    }, 220);
  };

  // girar el móvil cambia el ancho de la tira y el de los rellenos: hay que
  // volver a medir o el centro calculado se queda con las medidas viejas.
  useEffect(() => {
    const onResize = () => {
      measure();
      centerOn(lastReported.current, false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al desmontar hay que dejar el temporizador de "ya se ha asentado" limpio…
  // y `programmatic` en false: ese temporizador es justo quien lo baja. Si se
  // corta con la bandera alta (pasa con el Strict Mode de React, que monta,
  // desmonta y vuelve a montar), la tira se queda ignorando TODO scroll del
  // usuario porque cree que sigue centrándose ella sola.
  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      programmatic.current = false;
      // y se olvida lo medido, para que un montaje nuevo vuelva a medir y a
      // centrarse en la foto que toca (no en el extremo de la tira).
      lastSig.current = null;
      anchor.current = null;
    },
    [],
  );

  return (
    <div ref={railRef} className="vm-film" role="listbox" aria-label="Miniaturas — desliza para recorrer" onScroll={onScroll}>
      <div className="vm-film-pad" aria-hidden="true" />
      {visible.map(({ a, realIndex }) => (
        <button
          key={a.id}
          data-i={realIndex}
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
