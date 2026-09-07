import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),

  // Supabase Auth: secreto JWT del proyecto (Settings → API → JWT Secret)
  SUPABASE_JWT_SECRET: z.string().min(16),

  WEB_ORIGIN: z.string().default("http://localhost:3001"),

  R2_ENDPOINT: z.string().url(),
  R2_BUCKET: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  TMP_DIR: z.string().default("./tmp"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "[env] Configuración inválida:\n" +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  process.exit(1);
}

export const env = parsed.data;
export const VERSION = "0.2.0";
