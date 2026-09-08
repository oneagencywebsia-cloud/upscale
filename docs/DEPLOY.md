# Upscale — puesta en marcha (1 app en EasyPanel, 0 €)

Código en GitHub: `oneagencywebsia-cloud/upscale` (público).

- **Archivos** → canal privado de **Telegram** (gratis, no tu PC ni tu VPS, bytes exactos).
- **Login + base de datos** → **Supabase** (gratis, sin tarjeta).
- **Código** → **1 sola App** en EasyPanel (API + web en el mismo contenedor).

---

## Paso 1 — Supabase

1. supabase.com → **New Project** `upscale`.
2. **Settings → Database → Connection string → Session pooler** (puerto 5432) → guarda como `DATABASE_URL`.
3. **Settings → API** → guarda: `Project URL`, `anon public`, `JWT Secret`.
4. **Authentication → Providers → Google** → sigue el asistente (crea el OAuth client en Google Cloud, pega Client ID + Secret). Apple solo si tienes cuenta Apple Developer.
5. **Authentication → URL Configuration** (lo rellenas al final):
   Site URL = `https://TU-DOMINIO`, Redirect URLs = `https://TU-DOMINIO/auth/callback`.
6. En tu PC, aplica el esquema una vez:
   ```
   cd proyectos/upscale
   corepack enable && pnpm install
   DATABASE_URL="LA-DE-SUPABASE" pnpm --filter @upscale/api migrate
   ```

## Paso 2 — Telegram (el almacén)

1. En Telegram crea un **canal privado** nuevo (será el "disco"). No escribas nada.
2. Ve a **my.telegram.org → API development tools → Create app** → apunta `api_id` y `api_hash`.
3. En tu PC:
   ```
   TELEGRAM_API_ID=xxxx TELEGRAM_API_HASH=xxxx pnpm --filter @upscale/api tg-login
   ```
   Mete tu número + el código que te llega. Al final imprime:
   - `TELEGRAM_SESSION` (cadena larga) → cópiala
   - la lista de canales con su id → copia el del canal que creaste (`TELEGRAM_CHANNEL_ID`, ej. `-1001234567890`)

## Paso 3 — La App en EasyPanel

1. Proyecto → **+ Service → App** → nómbrala `upscale`.
2. **Source → Github**: repo `oneagencywebsia-cloud/upscale`, branch `main`, Build Path `/`.
3. **Build**: método **Dockerfile**, ruta `infra/allinone.Dockerfile`.
4. **Build Args** (Environment tiene una pestaña de build args, o ponlos también arriba):
   ```
   NEXT_PUBLIC_SUPABASE_URL=...          (Project URL de Supabase)
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...     (anon public de Supabase)
   ```
5. **Environment** — pega esto y rellena:
   ```
   DATABASE_URL=
   SUPABASE_JWT_SECRET=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   UPSCALE_API_URL=http://127.0.0.1:8080
   INTERNAL_API_URL=http://127.0.0.1:8080

   STORAGE_DRIVER=telegram
   TELEGRAM_API_ID=
   TELEGRAM_API_HASH=
   TELEGRAM_SESSION=
   TELEGRAM_CHANNEL_ID=
   TG_CACHE_MAX_MB=2048

   BLOB_SECRET=
   PUBLIC_API_URL=https://TU-DOMINIO/_api
   WEB_ORIGIN=https://TU-DOMINIO
   ```
   - `BLOB_SECRET`: te lo doy generado abajo (o `openssl rand -hex 32`).
   - `TU-DOMINIO`: el dominio que le pongas a esta app (paso 6). `UPSCALE_API_URL` e
     `INTERNAL_API_URL` se quedan tal cual (son internas del contenedor).
6. **Domains**: añade tu dominio (o el que te da EasyPanel) → **puerto 3001**, HTTPS.
7. **Deploy**.
8. Vuelve a Supabase (paso 1.5) y pon ahí ese dominio.

Abre `https://TU-DOMINIO` → **Registrar con Google** → dentro.

---

## Comprobar

- `https://TU-DOMINIO/_api/v1/healthz` → `{"ok":true,"db":true,...}` (si la sesión de
  Telegram falla, la app no arranca y lo dice en los logs de EasyPanel).
- Sube una foto con el botón «Subir». Aparece en la galería.

## Subir desde el iPhone

- Botón **«Subir»** en la web/PWA (instálala: *Compartir → Añadir a pantalla de inicio*).
- Para Live Photos y originales 100 % garantizados: **Ajustes → Crear token** y monta el
  Atajo de iOS (instrucciones en la propia pantalla de Ajustes).

## Deploy rápido: imagen pre-construida (GitHub Actions → GHCR)

En vez de que EasyPanel construya la imagen en el VPS (lento), GitHub la construye
y la sube a `ghcr.io/oneagencywebsia-cloud/upscale:latest`. EasyPanel solo la
descarga y reinicia (~1 min).

**Una vez:**

1. GitHub → repo `upscale` → **Settings → Secrets and variables → Actions → Variables**
   → **New repository variable** (x2):
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL de Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public de Supabase
   (No son secretos: ya viajan al navegador. Van como *Variables*, no *Secrets*.)
2. Haz un push a `main` (o Actions → *build & push image* → **Run workflow**). Espera a que
   termine en verde.
3. GitHub → tu perfil/organización → **Packages** → `upscale` → **Package settings** →
   **Change visibility → Public** (así EasyPanel lo baja sin credenciales).
4. EasyPanel → app `upscale` → **Source**: cambia de *Github/Dockerfile* a
   **Docker Image** = `ghcr.io/oneagencywebsia-cloud/upscale:latest`.
   Deja **igual** todo lo de *Environment* y el dominio (puerto 3001).
5. **Deploy**. A partir de ahora, cada push a `main` reconstruye la imagen en GitHub;
   para publicarla pulsa **Deploy** en EasyPanel (o configura un *Deploy hook*:
   EasyPanel te da una URL; ponla como secreto `EASYPANEL_DEPLOY_HOOK` y descomenta
   el último paso de `.github/workflows/build.yml` para que se redespliegue solo).

Las migraciones de la BD siguen corriendo solas al arrancar el contenedor.

## Vídeo desde el iPhone: 30 fps vs 60/120/240 fps

Subir un vídeo con el **botón «Subir» del navegador en el iPhone** = iOS lo
**recodifica** antes de dárselo a la web (HEVC→H.264 y a menudo 60→30 fps, menos
bitrate). Es una limitación de Safari/iOS, no de Upscale: la web nunca llega a ver
el archivo original.

Para guardar el vídeo **tal cual sale del iPhone** (60/120/240 fps, HEVC, bitrate
completo): usa el **Atajo de iOS** (Ajustes → Crear token). El Atajo manda el
archivo original sin pasar por el recodificador de Safari. Las fotos por el
navegador sí van íntegras; el problema es solo el vídeo.

## Avisos

- Usar Telegram de almacén es un uso no previsto; a escala personal va bien, pero si lo
  consideraran abuso podrían cerrar la cuenta → exporta el canal de vez en cuando.
- Límite 2 GB/archivo (4 con Telegram Premium).
- Si algún día quieres un servicio "de verdad": `STORAGE_DRIVER=r2` (~1 €/mes) o `local`.

## Alternativa: 2 apps separadas

Si prefieres separar, usa `infra/api.Dockerfile` (puerto 8080) e `infra/web.Dockerfile`
(puerto 3001) en dos Apps, y pon `PUBLIC_API_URL`/`UPSCALE_API_URL` con la URL pública
de la API. El resultado es el mismo.
