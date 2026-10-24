/** Parte un texto en palabras que aparecen una a una (CSS, ver `.sc-w`). `i0` = turno de la primera palabra. */
export default function Pal({ children, i0 = 0 }: { children: string; i0?: number }) {
  const palabras = children.split(" ");
  return (
    <>
      {palabras.map((p, n) => (
        <span key={n}>
          <span className="sc-w" style={{ ["--i" as string]: i0 + n }}>{p}</span>
          {n < palabras.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}
