/** Tipos compartidos entre la API y la web de Upscale. */

export type AssetKind = "photo" | "video" | "audio";

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

export interface Album {
  id: string;
  name: string;
  createdAt: string;
  count: number;
  coverUrl: string | null;
}

export interface AlbumListResponse {
  albums: Album[];
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  thumbUrl: string;
}

export interface MapPointsResponse {
  points: MapPoint[];
}

/** Estado de «mi espacio y mi plan» (GET /v1/me/account). `null` = sin tope (administrador). */
export interface AccountInfo {
  plan: { id: "free" | "plus" | "pro" | "max"; name: string; until: string | null; maxFileBytes: number | null };
  unlimited: boolean;
  usedBytes: number;
  limitBytes: number | null;
  remainingBytes: number | null;
  bonusBytes: number;
  referral: {
    code: string;
    invited: number;
    rewarded: number;
    earnedBytes: number;
    maxRewarded: number;
    invitedBonusBytes: number;
    inviterBonusBytes: number;
  };
}

// ---------------------------------------------------------------- Notas

/** Personalización de una nota. Todo es opcional: lo que falta se toma del tema. */
export interface NoteStyle {
  /** id del estilo predefinido del que se partió (solo informativo) */
  preset?: string;
  bg?:
    | { type: "solid"; color: string }
    | { type: "gradient"; from: string; to: string; angle: number };
  /** color del texto, `#rrggbb` */
  text?: string;
  border?: { width: number; style: "none" | "solid" | "dashed" | "dotted" | "double"; color: string; radius: number };
  shadow?: "none" | "soft" | "medium" | "strong";
  font?: "sans" | "serif" | "mono" | "display";
  /** px, 13–24 */
  size?: number;
  /** 1,2–2 */
  lineHeight?: number;
  align?: "left" | "center" | "right";
  /** px, 8–48 */
  padding?: number;
}

/** Documento del editor (ProseMirror). El servidor solo acepta nodos y marcas conocidos. */
export interface NoteDoc {
  type: "doc";
  content?: unknown[];
}

export interface NoteListItem {
  id: string;
  title: string;
  /** primeros caracteres del texto, para la tarjeta */
  preview: string;
  style: NoteStyle;
  tags: string[];
  pinned: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  /** miniatura de la primera captura adjunta */
  coverUrl: string | null;
}

export interface NoteAttachment {
  assetId: string;
  filename: string;
  width: number | null;
  height: number | null;
  thumbUrl: string;
  posterUrl: string | null;
  /** ya se extrajo su texto */
  ocrDone: boolean;
}

export interface Note extends NoteListItem {
  body: NoteDoc;
  attachments: NoteAttachment[];
}

export interface NoteListResponse {
  items: NoteListItem[];
  nextCursor: string | null;
}
