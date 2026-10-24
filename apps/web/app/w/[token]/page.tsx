import type { Metadata } from "next";
import MarcoFotos from "@/components/widgets/MarcoFotos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Marco de fotos",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  manifest: undefined,
};

/** Pantalla completa de un widget (marco de fotos). Pública: la «llave» va en la dirección. */
export default async function MarcoPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ seg?: string; reloj?: string }> }) {
  const { token } = await params;
  const { seg, reloj } = await searchParams;
  const segundos = Math.min(300, Math.max(5, Number(seg) || 20));
  return <MarcoFotos token={/^[A-Za-z0-9_-]{32,64}$/.test(token) ? token : ""} segundos={segundos} reloj={reloj === "1"} />;
}
