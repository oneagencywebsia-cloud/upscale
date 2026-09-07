# Upscale — puesta en marcha (0 €, sin tu PC ni tu VPS de almacén)

Código en GitHub (`oneagencywebsia-cloud/upscale`, público).

**Plan:** los archivos viven en un **canal privado de Telegram** (gratis, sin límite
práctico, no en tu PC ni ocupando el disco del VPS). El **código** (API + web) corre en
tu VPS con EasyPanel (que ya pagas). Login y base de datos en **Supabase gratis**.

**Sin pérdida de calidad:** el bot sube cada archivo *como documento* → Telegram guarda
los **bytes exactos**. Todo lo que el iPhone metió dentro (HDR/Dolby Vision, profundidad
de Retrato, ProRAW, modo Cine, EXIF, ubicación…) se conserva. Se verifica con SHA-256 al
subir y al bajar. Los **Live Photos** se guardan como dos archivos (HEIC + MOV).

Límite real: **2 GB por archivo** (4 GB con Telegram Premium). Vídeo del iPhone entra de
sobra; solo ProRes 4K largo se pasaría.

---

## 1. Supabase (login + base de datos) — gratis, sin tarjeta

1. supabase.com → **New project** `upscale`, región Europa.
2. **Settings → Database → Connection string → "Session pooler"** (5432) → `DATABASE_URL`.
3. **Settings → API**: `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`; `anon public` →
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`; **JWT Secret** → `SUPABASE_JWT_SECRET`.
4. **Authentication → Providers → Google**: OAuth client en Google Cloud Console (Web),
   *redirect URI* = la que da Supabase. (Apple: solo si tienes cuenta Apple Developer.)
5. Esquema — desde tu PC una vez:
   ```bash
   cd proyectos/upscale
   corepack enable && pnpm install
   cp .env.example apps/api/.env      # rellena DATABASE_URL y SUPABASE_JWT_SECRET
   pnpm --filter @upscale/api migrate
   ```

---

## 2. Telegram (el almacén) — gratis

1. En Telegram, crea un **canal privado** nuevo (o grupo). Será el "disco". No escribas nada.
2. Entra en **https://my.telegram.org** → *API development tools* → crea una app.
   Apunta **api_id** y **api_hash**.
3. En tu PC, genera la sesión:
   ```bash
   TELEGRAM_API_ID=xxdígitos TELEGRAM_API_HASH=xxhash pnpm --filter @upscale/api tg-login
   ```
   Mete tu número, el código que te llega y (si tienes) la 2FA. Al terminar imprime:
   - un **TELEGRAM_SESSION** largo → cópialo
   - la lista de tus canales con su **TELEGRAM_CHANNEL_ID** (ej. `-1001234567890`) → copia el del canal que creaste
4. En `apps/api/.env`:
   ```
   STORAGE_DRIVER=telegram
   TELEGRAM_API_ID=...
   TELEGRAM_API_HASH=...
   TELEGRAM_SESSION=...
   TELEGRAM_CHANNEL_ID=-100...
   BLOB_SECRET=            (openssl rand -hex 32)
   ```

---

## 3. API en EasyPanel

1. *Create → App* → GitHub `oneagencywebsia-cloud/upscale`, branch `main`, Build Path `/`.
2. Build: **Dockerfile** `infra/api.Dockerfile`.
3. **Environment** (todo lo de la sección API del `.env`):
   `PORT=8080`, `DATABASE_URL`, `SUPABASE_JWT_SECRET`,
   `STORAGE_DRIVER=telegram`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`,
   `TELEGRAM_CHANNEL_ID`, `BLOB_SECRET`,
   `PUBLIC_API_URL=https://api.upscale.tudominio.es`,
   `WEB_ORIGIN=https://upscale.tudominio.es`.
4. (Opcional) un volumen pequeño en `/app/apps/api/tg-cache` para la caché de miniaturas
   (se limita sola a 2 GB con `TG_CACHE_MAX_MB`).
5. **Domains**: `api.upscale.tudominio.es` → puerto `8080`, HTTPS.
6. Deploy → `https://api.upscale.tudominio.es/v1/healthz` → `{"ok":true,"db":true,...}`.
   Si la sesión de Telegram está mal, la API no arranca y lo dice en los logs.

---

## 4. Web en EasyPanel (otra app)

1. *Create → App* → mismo repo, branch `main`, Build Path `/`.
2. Build: **Dockerfile** `infra/web.Dockerfile`.
3. **Build Args**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **Environment**: los dos `NEXT_PUBLIC_*` + `UPSCALE_API_URL=https://api.upscale.tudominio.es`.
5. **Domains**: `upscale.tudominio.es` → puerto `3001`, HTTPS.
6. Supabase → Auth → URL Configuration: Site URL y `.../auth/callback` con esa URL.

Abre `https://upscale.tudominio.es` → **Registrar con Google** → entras a `/app`.

---

## 5. Subir fotos

- **Desde la web/PWA**: botón **«Subir»** arriba.
- **Live Photos y originales 100 % garantizados**: el **Atajo de iOS** (Ajustes → crear
  token). El Atajo manda el HEIC a `POST /v1/assets` y, si es Live Photo, el MOV a
  `POST /v1/assets/<id>/live-video` con la misma cabecera `X-Upload-Token`.

---

## 6. Espacio y actividad

- `/app/espacio`: cuánto ocupa tu biblioteca. Con Telegram no hay tope del disco, así
  que aquí solo ves el total y puedes borrar lo que no quieras (borra también de Telegram).
- `/app/actividad`: registro de lo que abres y descargas.

---

## PWA

Instalable. Chrome/Edge: **Instalar**. iPhone: *Compartir → Añadir a pantalla de inicio*.

---

## Avisos honestos sobre usar Telegram de almacén

- Es un uso no previsto. A escala personal la gente lo hace sin problema, pero si Telegram
  lo considerara abuso podría limitar o cerrar la cuenta → se perdería todo (haz copia del
  canal de vez en cuando, o exporta con Telegram Desktop).
- Más lento que una nube de verdad (la primera vez que ves un original hay que bajarlo de
  Telegram; las miniaturas se quedan en caché).
- Si algún día quieres algo "de servicio", cambia `STORAGE_DRIVER` a `r2` (~1 €/mes) o
  `local` — nada más del código cambia.
