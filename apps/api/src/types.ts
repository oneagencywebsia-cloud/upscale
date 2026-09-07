/** Tipos usados por la API. Coinciden con packages/shared (que consume la web). */

export type AssetKind = "photo" | "video";

export interface Asset {
  id: string;
  kind: AssetKind;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  fps: number | null;
  videoBitrate: number | null;
  codec: string | null;
  capturedAt: string;
  uploadedAt: string;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  lat: number | null;
  lon: number | null;
  isLive: boolean;
  liveVideoBytes: number | null;
}

export interface AssetListItem extends Asset {
  thumbUrl: string;
  posterUrl: string | null;
  liveVideoUrl: string | null;
}
