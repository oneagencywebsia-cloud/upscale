"use client";

import { motion } from "motion/react";

const CELLS = [
  [2, 2], // grandes
  [3, 3], // medio
  [4, 4], // pequeñas
];

export default function DensityControl({ value, onChange }: { value: number; onChange: (i: number) => void }) {
  return (
    <div className="density" role="group" aria-label="Tamaño de las fotos">
      {CELLS.map(([cols, rows], i) => (
        <button
          key={i}
          type="button"
          aria-pressed={value === i}
          aria-label={["Fotos grandes", "Tamaño medio", "Fotos pequeñas"][i]}
          onClick={() => onChange(i)}
        >
          {value === i && (
            <motion.span layoutId="density-pill" className="density-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
          )}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {Array.from({ length: rows }).flatMap((_, r) =>
              Array.from({ length: cols }).map((__, c) => {
                const gap = 2;
                const size = (24 - gap * (cols + 1)) / cols;
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={gap + c * (size + gap)}
                    y={gap + r * (size + gap)}
                    width={size}
                    height={size}
                    rx={Math.min(1.6, size / 3)}
                    fill="currentColor"
                  />
                );
              }),
            )}
          </svg>
        </button>
      ))}
    </div>
  );
}
