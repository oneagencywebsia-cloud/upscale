/** Tipos compartidos entre la API y la web de Upscale. */

export type AssetKind = "photo" | "video";

/** Fila de la tabla `assets` tal y como la sirve la API (camelCase, fechas ISO). */
export interface Asset {
  id: string;
  kind: AssetKind;
  filename: string;
  mime: string;
  bytes: number;
  /** SHA-256 del archivo original — el "sello" de integridad. */
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
  isFavorite: boolean;
  /** Tamaño del .MOV del Live Photo (bytes), si lo hay. */
  liveVideoBytes: number | null;
}

export interface AssetListItem extends Asset {
  thumbUrl: string;
  posterUrl: string | null;
  /** URL firmada del .MOV del Live Photo, si lo hay. */
  liveVideoUrl: string | null;
}

export interface AssetDetail extends AssetListItem {
  originalUrl: string;
}

export interface AssetListResponse {
  items: AssetListItem[];
  nextCursor: string | null;
}

export interface UploadResult {
  status: "saved" | "duplicate";
  id: string;
}

export interface Me {
  userId: string;
  email: string | null;
}

export interface UploadToken {
  id: string;
  /** Vista enmascarada del token (p. ej. "upl_ab12…7f9c"). Nunca el token completo. */
  preview: string;
  label: string | null;
  created_at: string;
  last_used: string | null;
}

export type AccessAction = "view" | "download" | "list";

export interface ActivityItem {
  id: number;
  action: AccessAction;
  at: string;
  assetId: string | null;
  filename: string | null;
  thumbKey: string | null;
  kind: AssetKind | null;
}

export interface ActivityResponse {
  items: ActivityItem[];
  nextBefore: number | null;
}

export interface StorageInfo {
  driver: "local" | "r2";
  usedBytes: number;
  count: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export interface HealthResult {
  ok: boolean;
  db: boolean;
  version: string;
}

export interface ApiError {
  error: string;
}
