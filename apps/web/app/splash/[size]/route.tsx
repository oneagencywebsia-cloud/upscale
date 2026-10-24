import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SPLASHES } from "@/lib/splash";

export const runtime = "nodejs";

let marca: Promise<string> | null = null;
const marcaDataUrl = () =>
  (marca ??= readFile(join(process.cwd(), "public", "brand", "upscale-mark.svg")).then(
    (b) => `data:image/svg+xml;base64,${b.toString("base64")}`,
  ));

/**
 * Pantalla de arranque de iOS generada a medida (solo los tamaños de la lista:
 * nunca un tamaño arbitrario, para que nadie pueda pedir imágenes enormes).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const hallada = SPLASHES.find((s) => s.nombre === size.replace(/\.png$/, ""));
  if (!hallada) return new Response("no existe", { status: 404 });

  const { p, t } = hallada;
  const ancho = p.w * p.r;
  const alto = p.h * p.r;
  const oscuro = t === "dark";
  const lado = Math.round(Math.min(ancho, alto) * 0.34);
  const src = await marcaDataUrl();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: oscuro ? "linear-gradient(160deg, #1d3068 0%, #14224f 55%, #0f1a3f 100%)" : "linear-gradient(160deg, #f6f8ff 0%, #e6ecfa 60%, #dfe8ff 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={lado} height={lado} alt="" />
      </div>
    ),
    { width: ancho, height: alto, headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
