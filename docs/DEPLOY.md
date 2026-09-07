# Upscale — puesta en marcha (coste 0 €)

Todo el código está en GitHub (`oneagencywebsia-cloud/upscale`, público).
Plan **sin gastos**: los archivos se guardan en **tu PC**, la API corre en **tu PC**,
y se accede desde fuera con un **túnel** (Tailscale Funnel, gratis). Login y base de
datos en **Supabase gratis**. Web en **Vercel gratis**.

Lo único que cuesta 0 pero requiere que el **PC esté encendido** para ver/descargar
fotos estando fuera de casa. Sin copia de seguridad automática (haz copias del disco).

---

## 1. Supabase (base de datos + login Google/Apple) — gratis

1. supabase.com → **New project** `upscale`, región Europa. Guarda la contraseña.
2. **Settings → Database → Connection string → "Session pooler"** (5432) → `DATABASE_URL`.
3. **Settings → API**: `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`; `anon public` →
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`; **JWT Secret** → `SUPABASE_JWT_SECRET`.
4. **Authentication → Providers**:
   - **Google**: OAuth client en Google Cloud Console (tipo Web). *Authorized redirect URI* =
     la que da Supabase (`https://<proj>.supabase.co/auth/v1/callback`). Pega Client ID + Secret.
   - **Apple**: necesita cuenta Apple Developer. Si no la tienes aún, deja solo Google;
     Apple se añade después sin tocar código.
5. **Authentication → URL Configuration** (lo rellenas tras el paso 4 de Vercel):
   Site URL y Redirect URL = `https://<tu-app>.vercel.app` y `.../auth/callback`.
6. Esquema:
   ```bash
   cd proyectos/upscale
   corepack enable && pnpm install
   cp .env.example apps/api/.env        # rellena la sección API
   pnpm --filter @upscale/api migrate
   ```

---

## 2. La API + el almacén, en tu PC

1. Instala **ffmpeg**: `winget install Gyan.FFmpeg` (reinicia la terminal).
2. En `apps/api/.env`:
   ```
   DATABASE_URL=...supabase...
   SUPABASE_JWT_SECRET=...supabase...
   STORAGE_DRIVER=local
   STORAGE_DIR=./data
   BLOB_SECRET=            # openssl rand -hex 32
   PUBLIC_API_URL=         # se rellena en el paso 3 (URL del túnel)
   WEB_ORIGIN=             # se rellena en el paso 4 (URL de Vercel)
   ```
3. Arranca: doble clic en **`start-api.bat`** (raíz del repo). Debe decir
   `Upscale API (local) en http://0.0.0.0:8080`. Prueba `http://localhost:8080/v1/healthz`.
   Los archivos se guardarán en `apps/api/data/`.

Para que arranque sola al encender el PC: crea un acceso directo a `start-api.bat` en
`shell:startup` (Win+R → `shell:startup`).

---

## 3. Túnel público — Tailscale Funnel (gratis)

Ya tienes Tailscale entre el PC y el iPhone. Falta exponerlo a internet:

1. admin console de Tailscale → **DNS**: activa **HTTPS Certificates**.
2. **Access controls**: añade a `nodeAttrs` el permiso de Funnel para `carri-pc`
   (Tailscale enseña el snippet; es `"attr": ["funnel"]`).
3. En el PC:
   ```
   tailscale funnel --bg 8080
   tailscale funnel status
   ```
   Te da una URL fija tipo `https://carri-pc.tailXXXX.ts.net`.
4. Pon esa URL en `apps/api/.env` como `PUBLIC_API_URL` y **reinicia** `start-api.bat`.

Alternativa (si prefieres Cloudflare): `cloudflared tunnel` con un dominio tuyo en
Cloudflare, apuntando `api.upscale.tudominio.es` → `http://localhost:8080`. Pon esa
URL en `PUBLIC_API_URL`.

---

## 4. Web en Vercel (gratis)

1. vercel.com → *Add New → Project* → importa `oneagencywebsia-cloud/upscale`.
2. **Root Directory:** `apps/web`.
3. Variables:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `UPSCALE_API_URL=https://carri-pc.tailXXXX.ts.net` (la URL del túnel).
4. Deploy. Copia la URL final (`https://upscale-xxxx.vercel.app`).
5. Vuelve a `apps/api/.env` → `WEB_ORIGIN=` esa URL, reinicia `start-api.bat`.
6. Supabase → Auth → URL Configuration → Site URL y `.../auth/callback` con esa URL.

Abre la web → **Registrar con Google** → entras a `/app`.

---

## 5. Subir desde el iPhone (Atajo)

1. Web → **Ajustes → Crear token**. Cópialo.
2. App **Atajos** → **"Subir a Upscale"**:
   - **Buscar fotos** — «fecha de captura en los últimos 7 días», más antiguas primero, límite 150.
   - **Repetir con cada uno** → **Obtener detalles de las fotos** → *Nombre*.
   - **Obtener contenido de la URL**: POST a `https://carri-pc.tailXXXX.ts.net/v1/assets`,
     cabeceras `X-Upload-Token` = tu token y `X-Filename` = *Nombre*, cuerpo = **Archivo**
     (*Elemento de repetición*).
3. **Automatizaciones**: al conectar al WiFi de casa, al cargar, y a las 14:00 y 22:00.

---

## PWA

Instalable ya (manifest + service worker). En Chrome/Edge sale **Instalar**; en iPhone,
*Compartir → Añadir a pantalla de inicio*.

---

## Si algún día quieres nube de verdad (de pago)

Cambia en `apps/api/.env`: `STORAGE_DRIVER=r2` + las 4 variables `R2_*` (crea el bucket
en Cloudflare R2, ~0,015 $/GB·mes, descargas gratis). La API entonces puede correr en
el VPS (EasyPanel, `infra/api.Dockerfile`) y el PC ya no hace falta. Nada más cambia.
