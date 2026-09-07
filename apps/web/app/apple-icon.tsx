import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0d14",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 118, fontWeight: 800, color: "#eef2fb", lineHeight: 1, marginTop: 10 }}>u</div>
        <div style={{ width: 92, height: 9, borderRadius: 6, background: "#4fc5dc", marginTop: 6 }} />
      </div>
    ),
    { ...size },
  );
}
