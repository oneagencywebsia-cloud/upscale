"use client";

/**
 * Elegir una opción entre pocas: botones grandes en rejilla (mínimo 48 px de alto, fáciles de
 * tocar con el pulgar), no una tira de botoncitos apretados. Es un grupo de radios accesible.
 */
export default function Opciones<T extends string | number>({
  etiqueta,
  valor,
  opciones,
  onChange,
  columnas,
}: {
  etiqueta: string;
  valor: T | undefined;
  opciones: [T, string][];
  onChange: (v: T) => void;
  /** columnas fijas (por defecto: se ajustan al ancho) */
  columnas?: number;
}) {
  return (
    <div className="wo" role="radiogroup" aria-label={etiqueta} style={columnas ? { gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` } : undefined}>
      {opciones.map(([v, t]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={valor === v} className={valor === v ? "on" : ""} onClick={() => onChange(v)}>
          {t}
        </button>
      ))}
    </div>
  );
}
