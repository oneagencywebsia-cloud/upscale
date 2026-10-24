import type { Metadata } from "next";
import NuevaNota from "@/components/notes/NuevaNota";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nueva nota" };

/** Acceso rápido «Nueva nota» (mantener pulsado el icono de la app). */
export default function NuevaNotaPage() {
  return <NuevaNota />;
}
