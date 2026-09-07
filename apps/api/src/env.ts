import { z } from "zod";

const base = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),

  // Supabase Auth: secreto JWT del proyecto (Settings → API → JWT Secret)
  SUPABASE_JWT_SECRET: z.string().min(16),

  WEB_ORIGIN: z.string().default("http://localhost:3001"),

  // "telegram" = canal privado de Telegram (coste 0, no tu PC ni tu VPS)
  // "local"    = disco de esta máquina
  // "r2"       = Cloudflare R2 (de pago)
  STORAGE_DRIVER: z.enum(["telegram", "local", "r2"]).default("telegram"),

  STORAGE_DIR: z.string().default("./data"),
  // URL pública de ESTA API (para los enlaces /v1/blob). Ej: https://api.upscale.tudominio.es
  PUBLIC_API_URL: z.string().default("http://localhost:8080"),
  // Secreto para firmar los enlaces temporales de /v1/blob (openssl rand -hex 32). Si vacío usa SUPABASE_JWT_SECRET.
  BLOB_SECRET: z.string().min(16).optional(),

  // --- Telegram (STORAGE_DRIVER=telegram) ---
  TELEGRAM_API_ID: z.coerce.number().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().optional(), // se genera con `pnpm --filter @upscale/api tg-login`
  TELEGRAM_CHANNEL_ID: z.string().optional(), // id del canal/grupo privado que hará de almacén
  // caché en disco de blobs pequeños ya descargados (miniaturas/pósters)
  TG_CACHE_DIR: z.string().default("./tg-cache"),
  TG_CACHE_MAX_MB: z.coerce.number().default(2048),

  // --- R2 (STORAGE_DRIVER=r2) ---
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

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "[env] Configuración inválida:\n" +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  process.exit(1);
}

export const env = { ...parsed.data, BLOB_SECRET: parsed.data.BLOB_SECRET ?? parsed.data.SUPABASE_JWT_SECRET };
export const VERSION = "0.4.0";
