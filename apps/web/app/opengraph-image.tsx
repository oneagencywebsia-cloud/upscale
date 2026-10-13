import { ImageResponse } from "next/og";

export const alt = "Upscale — guarda tus fotos y vídeos en calidad original";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Tarjeta que se ve al compartir el enlace (WhatsApp, X, iMessage…). */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          color: "#eef2fb",
          backgroundColor: "#0a0d14",
          backgroundImage:
            "radial-gradient(circle at 85% 95%, rgba(255,214,150,0.32), rgba(10,13,20,0) 55%), radial-gradient(circle at 8% 0%, rgba(79,197,220,0.32), rgba(10,13,20,0) 50%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginBottom: 36 }}>
          {[56, 92, 128].map((h) => (
            <div key={h} style={{ width: 34, height: h, borderRadius: 9, background: "linear-gradient(#b6f1fb,#3fb4cf)" }} />
          ))}
          <div style={{ marginLeft: 22, fontSize: 64, fontWeight: 800, letterSpacing: -2, display: "flex" }}>
            <span style={{ color: "#7adcec" }}>up</span>scale
          </div>
        </div>
        <div style={{ fontSize: 80, lineHeight: 1.05, letterSpacing: -3, display: "flex", flexDirection: "column" }}>
          <span>Guarda todo.</span>
          <span style={{ color: "#7adcec" }}>Sin perder nada.</span>
        </div>
        <div style={{ marginTop: 26, fontSize: 34, color: "#98a2b8", display: "flex" }}>
          Fotos, vídeos y música en calidad original · 5 GB gratis
        </div>
      </div>
    ),
    size,
  );
}
