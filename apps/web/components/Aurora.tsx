"use client";

import { usePathname } from "next/navigation";

/** Sección → paleta de luces del fondo (ver `.aurora-gl[data-s]` en globals.css). */
function sectionOf(path: string): string {
  if (path.startsWith("/app/albumes")) return "albumes";
  if (path.startsWith("/app/espacio")) return "espacio";
  if (path.startsWith("/app/perfil")) return "perfil";
  if (path.startsWith("/app/ajustes")) return "ajustes";
  return "lib";
}

/** Fondo vivo de toda la app: degradado azul marino + cuatro luces que se
 *  desplazan despacio. CSS puro; solo anima `transform` (se compone en la GPU,
 *  sin repintar) y cambia de color al cambiar de sección. */
export default function Aurora({ section }: { section?: string }) {
  const pathname = usePathname();
  const s = section ?? sectionOf(pathname ?? "");
  return (
    <div className="aurora-gl" data-s={s} aria-hidden="true">
      <span className="ab ab1" />
      <span className="ab ab2" />
      <span className="ab ab3" />
      <span className="ab ab4" />
    </div>
  );
}
