# Upscale — puesta en marcha

Todo el código está hecho y subido a GitHub (`oneagencywebsia-cloud/upscale`).
Esto es lo que hay que configurar **con tus cuentas**. Sustituye `upscale.tudominio.es`
por tu subdominio real.

---

## 1. Supabase (base de datos + login Google/Apple)

1. supabase.com → **New project** `upscale`, región Europa. Guarda la contraseña de la BD.
2. **Settings → Database → Connection string → "Session pooler"** (puerto 5432) → esa es
   `DATABASE_URL`.
3. **Settings → API**: copia `Project URL` (→ `NEXT_PUBLIC_SUPABASE_URL`), `anon public`
   (→ `NEXT_PUBLIC_SUPABASE_ANON_KEY`) y **JWT Secret** (→ `SUPABASE_JWT_SECRET`).
4. **Authentication → URL Configuration**:
   - Site URL: `https://upscale.tudominio.es`
   - Redirect URLs: `https://upscale.tudominio.es/auth/callback` (y `http://localhost:3001/auth/callback` para local).
5. **Authentication → Providers**:
   - **Google**: créalo en Google Cloud Console (OAuth client, tipo Web), pon como
     *Authorized redirect URI* la que te da Supabase (`https://<proj>.supabase.co/auth/v1/callback`).
     Pega Client ID + Secret en Supabase.
   - **Apple**: necesitas cuenta Apple Developer. En developer.apple.com creas un
     *Services ID*, activas *Sign in with Apple*, generas la *key* (.p8). Pega Services ID,
     Team ID, Key ID y la key en Supabase. (Si aún no tienes cuenta Apple Developer,
     deja solo Google de momento; Apple se añade luego sin tocar código.)
6. Aplica el esquema:
   ```bash
   cd proyectos/upscale
   DATABASE_URL='...supabase...' pnpm --filter @upscale/api migrate
   ```
   (o pega `apps/api/migrations/001_init.sql` en el SQL Editor de Supabase).

---

## 2. Cloudflare R2

1. Cloudflare → **R2** → *Create bucket* `upscale`.
2. *Manage R2 API Tokens* → *Create* → **Object Read & Write** sobre `upscale`.
   Apunta Access Key ID y Secret.
3. Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

---

## 3. API en EasyPanel (tu VPS)

1. EasyPanel → *Create* → **App** → source: GitHub `oneagencywebsia-cloud/upscale`.
2. Build: **Dockerfile** `infra/api.Dockerfile`, **build context = `/`**.
3. Variables de entorno (sección API del `.env.example`):
   `PORT=8080`, `DATABASE_URL`, `SUPABASE_JWT_SECRET`,
   `WEB_ORIGIN=https://upscale.tudominio.es`,
   `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
4. Dominio: `api.upscale.tudominio.es` → puerto `8080`, HTTPS.
5. Comprueba: `https://api.upscale.tudominio.es/v1/healthz` → `{"ok":true,"db":true,...}`.

> Vigila la RAM del VPS (ya al ~57%). Si `ffmpeg` la aprieta, sube el plan o mueve la
> API a un VPS aparte — el código no cambia.

---

## 4. Web en Vercel

1. vercel.com → *Add New → Project* → importa `oneagencywebsia-cloud/upscale`.
2. **Root Directory:** `apps/web`.
3. Variables:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `UPSCALE_API_URL=https://api.upscale.tudominio.es`.
4. Deploy → añade el dominio `upscale.tudominio.es`.
5. Vuelve a la API: `WEB_ORIGIN` = exactamente `https://upscale.tudominio.es`.
6. Vuelve a Supabase → Auth → URL Configuration: Site URL y Redirect URL con ese dominio.

Abre `https://upscale.tudominio.es` → **Registrar con Google / Apple** → entras a `/app`.

---

## 5. PWA (instalar como app)

Ya viene montada (`@serwist/next` + `manifest.webmanifest` + `app/sw.ts`). En producción,
al abrir `upscale.tudominio.es` en Chrome/Edge sale un botón **Instalar**; en iPhone,
*Compartir → Añadir a pantalla de inicio*. Los iconos son SVG en `apps/web/public/` —
si quieres PNG nítidos para tiendas, exporta 192/512 desde `public/icon.svg`.

---

## 6. Subir desde el iPhone (Atajo — provisional hasta la app nativa)

1. En la web: **Ajustes → Crear token**. Copia el token.
2. App **Atajos** → nuevo **"Subir a Upscale"**:
   - **Buscar fotos** — «fecha de captura en los últimos 7 días», más antiguas primero, límite 150.
   - **Repetir con cada uno** → **Obtener detalles de las fotos** → *Nombre*.
   - **Obtener contenido de la URL**: POST a `https://api.upscale.tudominio.es/v1/assets`,
     cabeceras `X-Upload-Token` = tu token y `X-Filename` = *Nombre*, cuerpo = **Archivo**
     (*Elemento de repetición*).
3. **Automatizaciones** (*Ejecutar inmediatamente*): al conectar al WiFi de casa, al
   conectar el cargador, y hora del día 14:00 y 22:00. El servidor deduplica por hash.

Backfill: duplica el atajo con ventana de 365 días y ejecútalo una vez.

---

## Local (para probar antes)

```bash
cd proyectos/upscale
corepack enable
pnpm install
cp .env.example apps/api/.env        # rellenar sección API
cp .env.example apps/web/.env.local   # rellenar sección WEB
docker compose -f infra/compose.dev.yml up -d   # Postgres + S3 local
pnpm migrate
pnpm dev                              # API :8080 · web :3001
```

Para el login en local necesitas igualmente un proyecto Supabase (el compose solo trae
Postgres/S3, no Auth). Apunta `DATABASE_URL` al Postgres local pero
`NEXT_PUBLIC_SUPABASE_*` y `SUPABASE_JWT_SECRET` al proyecto Supabase real.

---

## Notas

- Reproducción de vídeo HEVC en el navegador: la galería muestra el **póster** + botón
  **Descargar original**. Streaming in-browser llega en otra iteración.
- Los scripts `scripts/inbox-server.js` + Tailscale del workspace fueron la semilla de
  esta API y quedan como vía manual de respaldo.
