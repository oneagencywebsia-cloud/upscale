"use client";

import type { NoteStyle } from "@/lib/notes";
import { PRESETS, FUENTE_NOMBRES, estiloCss, contrasteNota } from "@/lib/notes";

type Borde = NonNullable<NoteStyle["border"]>;
const BORDE0: Borde = { width: 1, style: "solid", color: "#7a8fc4", radius: 14 };

function Seg<T extends string>({ label, value, opciones, onChange }: { label: string; value: T | undefined; opciones: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="sp-seg" role="group" aria-label={label}>
      {opciones.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>
      ))}
    </div>
  );
}
function Rango({ label, min, max, step = 1, value, unidad = "", onChange }: { label: string; min: number; max: number; step?: number; value: number; unidad?: string; onChange: (v: number) => void }) {
  return (
    <label className="sp-range">
      <span>{label}<b>{value}{unidad}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="sp-color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <span>{label}</span>
      <code>{value}</code>
    </label>
  );
}

/** Panel de personalización: predefinidos + fondo, texto, recuadro, sombra y tipografía. Todo en vivo. */
export default function StylePanel({ style, onChange, onClose }: { style: NoteStyle; onChange: (s: NoteStyle) => void; onClose: () => void }) {
  const bg = style.bg;
  const set = (p: Partial<NoteStyle>) => onChange({ ...style, preset: undefined, ...p });
  const contr = contrasteNota(style);
  const borde = style.border ?? BORDE0;

  return (
    <aside className="spanel" aria-label="Personalizar nota">
      <div className="sp-head">
        <h2>Personalizar</h2>
        <button type="button" className="btn ghost sm" onClick={onClose}>Listo</button>
      </div>

      <section>
        <h3>Estilos</h3>
        <div className="sp-presets" role="group" aria-label="Estilos predefinidos">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="sp-preset" aria-pressed={(style.preset ?? "tema") === p.id} onClick={() => onChange({ ...p.style })} title={p.name}>
              <span className="sp-sw ncard" style={estiloCss(p.style, { compacto: true })}>Aa</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Fondo</h3>
        <Seg
          label="Tipo de fondo"
          value={bg?.type ?? ("none" as never)}
          opciones={[["solid", "Color"], ["gradient", "Degradado"]]}
          onChange={(t) => set({ bg: t === "solid" ? { type: "solid", color: bg?.type === "solid" ? bg.color : bg?.type === "gradient" ? bg.from : "#fff3b0" } : { type: "gradient", from: bg?.type === "solid" ? bg.color : "#7adcec", to: "#8d9bff", angle: 145 } })}
        />
        {bg?.type === "solid" && <Color label="Color" value={bg.color} onChange={(c) => set({ bg: { type: "solid", color: c } })} />}
        {bg?.type === "gradient" && (
          <>
            <Color label="Desde" value={bg.from} onChange={(c) => set({ bg: { ...bg, from: c } })} />
            <Color label="Hasta" value={bg.to} onChange={(c) => set({ bg: { ...bg, to: c } })} />
            <Rango label="Ángulo" min={0} max={360} step={5} value={bg.angle} unidad="°" onChange={(a) => set({ bg: { ...bg, angle: a } })} />
          </>
        )}
        {bg && (
          <button type="button" className="btn ghost sm" onClick={() => { const { bg: _b, ...r } = style; void _b; onChange({ ...r, preset: undefined }); }}>
            Usar el fondo del tema
          </button>
        )}
      </section>

      <section>
        <h3>Texto</h3>
        <Color label="Color del texto" value={style.text ?? "#1d2a4a"} onChange={(c) => set({ text: c })} />
        {style.text && (
          <button type="button" className="btn ghost sm" onClick={() => { const { text: _t, ...r } = style; void _t; onChange({ ...r, preset: undefined }); }}>
            Usar el color del tema
          </button>
        )}
        {contr !== null && contr < 4.5 && (
          <p className="sp-warn" role="status">
            Poco contraste ({contr.toFixed(1)}:1). Se leerá mal; prueba otro color de texto o de fondo.
          </p>
        )}
      </section>

      <section>
        <h3>Recuadro</h3>
        <Seg
          label="Estilo del borde"
          value={borde.style}
          opciones={[["none", "Sin"], ["solid", "Línea"], ["dashed", "Guiones"], ["dotted", "Puntos"], ["double", "Doble"]]}
          onChange={(s) => set({ border: { ...borde, style: s, width: s !== "none" && borde.width === 0 ? 1 : borde.width } })}
        />
        {borde.style !== "none" && (
          <>
            <Color label="Color del borde" value={borde.color} onChange={(c) => set({ border: { ...borde, color: c } })} />
            <Rango label="Grosor" min={0} max={8} value={borde.width} unidad=" px" onChange={(w) => set({ border: { ...borde, width: w } })} />
          </>
        )}
        <Rango label="Esquinas" min={0} max={40} value={borde.radius} unidad=" px" onChange={(r) => set({ border: { ...borde, radius: r } })} />
        <h4>Sombra</h4>
        <Seg label="Sombra" value={style.shadow} opciones={[["none", "Sin"], ["soft", "Suave"], ["medium", "Media"], ["strong", "Fuerte"]]} onChange={(s) => set({ shadow: s })} />
      </section>

      <section>
        <h3>Tipografía</h3>
        <Seg label="Fuente" value={style.font ?? "sans"} opciones={(Object.keys(FUENTE_NOMBRES) as (keyof typeof FUENTE_NOMBRES)[]).map((k) => [k, FUENTE_NOMBRES[k]] as [typeof k, string])} onChange={(f) => set({ font: f })} />
        <Rango label="Tamaño" min={13} max={24} value={style.size ?? 16} unidad=" px" onChange={(v) => set({ size: v })} />
        <Rango label="Interlineado" min={1.2} max={2} step={0.1} value={style.lineHeight ?? 1.6} onChange={(v) => set({ lineHeight: Math.round(v * 10) / 10 })} />
        <Seg label="Alineación" value={style.align ?? "left"} opciones={[["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]]} onChange={(a) => set({ align: a })} />
        <Rango label="Margen interior" min={8} max={48} value={style.padding ?? 24} unidad=" px" onChange={(v) => set({ padding: v })} />
      </section>

      <button type="button" className="btn ghost" onClick={() => onChange({})}>Restablecer todo</button>
    </aside>
  );
}
