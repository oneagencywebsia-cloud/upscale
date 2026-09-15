import { z } from "zod";

const base = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),

  // Supabase Auth. La API verifica los tokens llamando a SUPABASE_URL/auth/v1/user.
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_JWT_SECRET: z.string().optional(), // ya no se usa; se deja por compatibilidad

  WEB_ORIGIN: z.string().default("http://localhost:3001"),

  // telegram = canal privado de Telegram (coste 0, no tu PC ni tu VPS) — POR DEFECTO
  // local | r2
  STORAGE_DRIVER: z.enum(["telegram", "local", "r2"]).default("telegram"),

  STORAGE_DIR: z.string().default("./data"),
  PUBLIC_API_URL: z.string().default("http://localhost:8080"),
  BLOB_SECRET: z.string().min(16).optional(),

  TELEGRAM_API_ID: z.coerce.number().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TG_CACHE_DIR: z.string().default("./tg-cache"),
  TG_CACHE_MAX_MB: z.coerce.number().default(2048),
  /** Conexiones EN PARALELO que usa UNA sola descarga/reproducción (ventana
   *  deslizante de tgReadRangeLive / tgDownloadParallel). Telegram limita CADA
   *  conexión a ~1 MB/s en el mejor caso, pero en la práctica medida (ver
   *  /v1/diag/speedtest) el rendimiento por conexión varía bastante con la
   *  carga. Un vídeo 4K/60 HDR real puede pedir 6+ MB/s sostenidos — con solo
   *  6 streams eso está justo en el límite y cualquier bajón momentáneo hace
   *  que el original (sin copia ligera todavía) se corte al reproducir. 8 es
   *  el tope ya soportado por TG_POOL_WARM_MIN/TG_POOL_MAX_CLIENTS: sube el
   *  margen sin coste extra real. Bajar si sale FLOOD_WAIT con frecuencia. */
  // Tope 8: no es un límite de ancho de banda (para eso está TG_POOL_MAX_CLIENTS,
  // ver abajo) sino de RIESGO — cada conexión extra en la ventana de UN solo
  // archivo es una petición más por segundo contra la MISMA cuenta, y
  // FLOOD_WAIT lo aplica Telegram por cuenta/método, no por conexión: pasado
  // cierto punto, más "streams" por archivo no suma MB/s, solo acerca el
  // FLOOD_WAIT. Con miles de archivos y varios usuarios a la vez, la palanca
  // real de rendimiento es TG_POOL_MAX_CLIENTS (más descargas EN PARALELO),
  // no más streams dentro de una descarga que ya va sobrada para su bitrate.
  TG_DOWNLOAD_STREAMS: z.coerce.number().min(1).max(8).default(8),
  /** Tope de conexiones de descarga que el pool puede llegar a abrir EN TOTAL,
   *  sumando TODAS las descargas/reproducciones simultáneas (no solo los
   *  TG_DOWNLOAD_STREAMS de una). El pool arranca con TG_DOWNLOAD_STREAMS
   *  conexiones y CRECE bajo demanda (una nueva por hueco que falte) hasta
   *  este tope cuando hay más de una reproducción/descarga a la vez — así el
   *  mutex por-cliente (necesario para no mezclar bytes de dos descargas sobre
   *  la misma conexión) no obliga a dos usuarios distintos a hacer cola
   *  detrás del mismo puñado de clientes. Se reduce solo cuando lleva minutos
   *  sin uso. Cada conexión son unos pocos MB de RAM; súbelo si el VPS tiene
   *  ancho de banda y RAM de sobra para más usuarios concurrentes.
   */
  TG_POOL_MAX_CLIENTS: z.coerce.number().min(1).max(64).default(24),
  /** Mínimo de conexiones SIEMPRE conectadas y listas, aunque nadie las esté
   *  usando (no bajo demanda como TG_POOL_MAX_CLIENTS). Objetivo: abrir
   *  cualquier archivo, aunque nunca se haya abierto antes, en <2s — para eso
   *  no puede depender de un handshake MTProto nuevo en el camino crítico si
   *  ya hay varias reproducciones/descargas ocupando las conexiones base.
   *  Cada conexión ociosa cuesta poca RAM; súbelo si esperas muchos usuarios
   *  concurrentes y quieres margen de sobra siempre listo. */
  TG_POOL_WARM_MIN: z.coerce.number().min(1).max(32).default(10),

  // Ingesta desde Telegram: manda un vídeo "como archivo" a este chat y entra
  // en la biblioteca sin recomprimir. Por defecto "me" = Mensajes guardados.
  TELEGRAM_INBOX: z.string().default("me"),
  INGEST_USER_ID: z.string().optional(), // Supabase user id al que se asignan los archivos
  INGEST_POLL_SECONDS: z.coerce.number().default(10),
  /** Tope real de Telegram para un documento: 2 GB en cuentas normales, 4 GB con
   *  Telegram Premium. Es un muro de Telegram, no algo que podamos ampliar desde
   *  aquí — solo sirve para decidir con criterio cuándo NO tiene sentido reintentar
   *  una re-subida (recuperación pesada de un original) y para diagnósticos claros.
   *  Cambiar a "true" si la cuenta de TELEGRAM_SESSION pasa a Premium.
   *  Ver también MAX_UPLOAD_BYTES en routes/assets.ts (misma cuenta, mismo tope;
   *  hoy hardcodeado a 2 GB ahí — conviene alinearlo con esta misma variable si se
   *  toca uno de los dos). */
  TELEGRAM_ACCOUNT_PREMIUM: z
    .string()
    .optional()
    .default("false")
    .transform((v) => /^(1|true|yes)$/i.test(v.trim())),

  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  TMP_DIR: z.string().default("./tmp"),
});

const schema = base.superRefine((v, ctx) => {
    const need = (k: keyof typeof v) => {
      if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `requerido con STORAGE_DRIVER=${v.STORAGE_DRIVER}` });
    };
    if (v.STORAGE_DRIVER === "r2") ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].forEach((k) => need(k as never));
    if (v.STORAGE_DRIVER === "telegram")
      ["TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION", "TELEGRAM_CHANNEL_ID"].forEach((k) => need(k as never));
    if ((v.STORAGE_DRIVER === "local" || v.STORAGE_DRIVER === "telegram") && !v.BLOB_SECRET)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["BLOB_SECRET"], message: `requerido con STORAGE_DRIVER=${v.STORAGE_DRIVER}` });
  });

// alias: si no hay SUPABASE_URL/ANON_KEY usa los NEXT_PUBLIC_*
if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!process.env.SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) process.env.SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "[env] Configuración inválida:\n" +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  process.exit(1);
}

export const env = parsed.data;
export const VERSION = "0.21.4-diag-asset";
