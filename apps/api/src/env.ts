import { z } from "zod";

const base = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),

  // Supabase Auth: secreto JWT del proyecto (Settings → API → JWT Secret)
  SUPABASE_JWT_SECRET: z.string().min(16),

  WEB_ORIGIN: z.string().default("http://localhost:3001"),

  // "local" = disco de esta máquina (coste 0) | "r2" = Cloudflare R2
  STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
  STORAGE_DIR: z.string().default("./data"),
  // URL pública de ESTA API (para construir los enlaces /v1/blob). Ej: https://api.upscale.tudominio.es
  PUBLIC_API_URL: z.string().default("http://localhost:8080"),
  // Secreto para firmar los enlaces temporales de /v1/blob (openssl rand -hex 32)
  BLOB_SECRET: z.string().min(16).optional(),

  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  TMP_DIR: z.string().default("./tmp"),
});

const schema = base.superRefine((v, ctx) => {
  if (v.STORAGE_DRIVER === "r2") {
    for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const) {
      if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: "requerido con STORAGE_DRIVER=r2" });
    }
  }
  if (v.STORAGE_DRIVER === "local" && !v.BLOB_SECRET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["BLOB_SECRET"], message: "requerido con STORAGE_DRIVER=local" });
  }
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
export const VERSION = "0.3.0";
