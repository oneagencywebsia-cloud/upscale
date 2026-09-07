# Upscale — puesta en marcha (todo en tu VPS, coste 0 €)

Código en GitHub (`oneagencywebsia-cloud/upscale`, público).

**Plan:** API + web + archivos, **todo en EasyPanel** (tu VPS, que ya está 24/7 y ya pagas).
Login y base de datos en **Supabase** (cuenta gratis, sin tarjeta). Nada de Vercel, ni
Tailscale, ni tu PC, ni tarjeta.

**Límite honesto:** el disco del VPS tiene ~85 GB libres (compartidos con CLIPSO/n8n).
Upscale trae una pantalla **Espacio** para borrar lo viejo cuando se llene. Es una
biblioteca "reciente", no infinita. Para quitar el límite → `STORAGE_DRIVER=r2`
(Cloudflare R2, ~1 €/mes).

---

## 1. Supabase (login + base de datos) — gratis, sin tarjeta

1. supabase.com → **New project** `upscale`, región Europa. Guarda la contraseña.
2. **Settings → Database → Connection string → "Session pooler"** (5432) → `DATABASE_URL`.
3. **Settings → API**: `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`; `anon public` →
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`; **JWT Secret** → `SUPABASE_JWT_SECRET`.
4. **Authentication → Providers → Google**: OAuth client en Google Cloud Console
   (tipo Web), *Authorized redirect URI* = la que da Supabase. Pega Client ID + Secret.
   (Apple: solo si tienes cuenta Apple Developer; si no, lo dejas para después.)
5. **Authentication → URL Configuration** (tras el paso 3 de abajo):
   Site URL = `https://upscale.tudominio.es`, Redirect URL = `.../auth/callback`.
6. Esquema — desde tu PC una sola vez:
   ```bash
   cd proyectos/upscale
   corepack enable && pnpm install
   cp .env.example apps/api/.env      # rellena DATABASE_URL, SUPABASE_JWT_SECRET
   pnpm --filter @upscale/api migrate
   ```

---

## 2. API en EasyPanel

1. EasyPanel → *Create → App* → GitHub `oneagencywebsia-cloud/upscale`, branch `main`, Build Path `/`.
2. Build: **Dockerfile** `infra/api.Dockerfile`.
3. **Volumes**: monta un volumen en `/data` (aquí van los archivos).
4. **Environment**:
   ```
   PORT=8080
   DATABASE_URL=...supabase...
   SUPABASE_JWT_SECRET=...supabase...
   STORAGE_DRIVER=local
   STORAGE_DIR=/data
   BLOB_SECRET=            (openssl rand -hex 32)
   PUBLIC_API_URL=https://api.upscale.tudominio.es
   WEB_ORIGIN=https://upscale.tudominio.es
   ```
5. **Domains**: `api.upscale.tudominio.es` → puerto `8080`, HTTPS.
6. Deploy → `https://api.upscale.tudominio.es/v1/healthz` → `{"ok":true,"db":true,...}`.

---

## 3. Web en EasyPanel (otra app)

1. EasyPanel → *Create → App* → mismo repo, branch `main`, Build Path `/`.
2. Build: **Dockerfile** `infra/web.Dockerfile`.
3. **Build Args** (Next los necesita al compilar):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **Environment**:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   UPSCALE_API_URL=https://api.upscale.tudominio.es
   ```
5. **Domains**: `upscale.tudominio.es` → puerto `3001`, HTTPS.
6. Deploy. Vuelve a Supabase → Auth → URL Configuration con `https://upscale.tudominio.es`.

Abre `https://upscale.tudominio.es` → **Registrar con Google** → entras a `/app`.

---

## 4. Subir fotos

**Desde la web/app**: botón **«Subir»** arriba → eliges fotos/vídeos. Ya está.
(En el iPhone, si instalas la PWA, el botón abre el carrete.)

**Nota de calidad**: al elegir desde el carrete de iOS, a veces Safari convierte HEIC→JPEG.
Si quieres el original 100 % garantizado, el Atajo de iOS sigue disponible (Ajustes →
crear token). Pero no es obligatorio.

---

## 5. Gestionar espacio

`/app/espacio`: barra de uso + lista de lo más pesado con botón **Borrar**. Cuando la
barra se acerque al 100 %, borra lo que ya tengas editado/descargado. Borrar libera el
disco del VPS al instante.

---

## PWA

Instalable ya. Chrome/Edge: botón **Instalar**. iPhone: *Compartir → Añadir a pantalla de inicio*.

---

## Si algún día quieres biblioteca infinita (de pago, ~1 €/mes)

En la API cambia `STORAGE_DRIVER=r2` y añade `R2_ENDPOINT`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (bucket en Cloudflare R2). Quita el volumen
`/data`. Nada más cambia.
