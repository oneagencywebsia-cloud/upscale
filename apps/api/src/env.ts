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
  /** Conexiones simultáneas de descarga a Telegram. Telegram limita CADA conexión
   *  a ~1 MB/s; los clientes oficiales abren varias. 4 = ~4 MB/s (suficiente para
   *  4K). Subir a 6-8 si la red del VPS da para más; bajar si sale FLOOD_WAIT. */
  TG_DOWNLOAD_STREAMS: z.coerce.number().min(1).max(8).default(4),

  // Ingesta desde Telegram: manda un vídeo "como archivo" a este chat y entra
  // en la biblioteca sin recomprimir. Por defecto "me" = Mensajes guardados.
  TELEGRAM_INBOX: z.string().default("me"),
  INGEST_USER_ID: z.string().optional(), // Supabase user id al que se asignan los archivos
  INGEST_POLL_SECONDS: z.coerce.number().default(10),

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
export const VERSION = "0.14.4-prioridad";
