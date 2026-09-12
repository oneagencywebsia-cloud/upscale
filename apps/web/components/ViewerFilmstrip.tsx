"use client";

import { useEffect, useRef } from "react";
import type { AssetListItem } from "@upscale/shared";

// vecinos a cada lado de la foto actual: de sobra para poder arrastrar el
// dedo por la tira sin quedarse corto, y ligero (≤160 miniaturas en el DOM
// aunque la biblioteca tenga decenas de miles).
const WINDOW = 80;

interface Props {
  assets: AssetListItem[];
  index: number;
  onIndex: (i: number) => void;
}

/**
 * El carrete de Fotos: una tira de miniaturas que se recorre arrastrando el
 * dedo por ENCIMA — la que quede bajo el dedo se convierte en la foto actual
 * al instante, no hace falta soltar. Se recentra sola cuando el índice cambia
 * por otra vía (deslizar la foto grande, las flechas, tocar una miniatura).
 */
export default function ViewerFilmstrip({ assets, index, onIndex }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const dragging = useRef(false);
  const lastPicked = useRef(index);

  useEffect(() => {
    lastPicked.current = index;
    const rail = railRef.current;
    const el = itemRefs.current.get(index);
    if (!rail || !el) return;
    const target = el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2;
    rail.scrollTo({ left: target, behavior: dragging.current ? "auto" : "smooth" });
  }, [index]);

  const pick = (clientX: number) => {
    for (const [i, el] of itemRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        if (i !== lastPicked.current) {
          lastPicked.current = i;
          onIndex(i);
        }
        return;
      }
    }
  };

  const from = Math.max(0, index - WINDOW);
  const to = Math.min(assets.length, index + WINDOW + 1);
  const visible = assets.slice(from, to);

  return (
    <div
      ref={railRef}
      className="vm-film"
      role="listbox"
      aria-label="Miniaturas — arrastra para recorrer"
      onPointerDown={(e) => {
        dragging.current = true;
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) pick(e.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div className="vm-film-pad" aria-hidden="true" />
      {visible.map((a, i) => {
        const realIndex = from + i;
        return (
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
            onClick={() => onIndex(realIndex)}
          >
            <img src={a.thumbUrl} alt="" draggable={false} loading="lazy" decoding="async" />
          </button>
        );
      })}
      <div className="vm-film-pad" aria-hidden="true" />
    </div>
  );
}
