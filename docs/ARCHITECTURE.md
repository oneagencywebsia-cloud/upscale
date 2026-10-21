# Upscale — arquitectura

## Principio

El **archivo original nunca se recodifica**. Se guarda tal cual llega del iPhone
(bytes idénticos, `sha256` verificado). Miniaturas y pósters son copias derivadas,
descartables y regenerables.

## Componentes

```text
iPhone (Atajo)          Navegador / PWA
  POST /v1/assets          Google / Apple (Supabase Auth)
  X-Upload-Token                 │  access_token (Bearer)
        │                        ▼
        └──────────▶  API Upscale (Fastify)                    Almacenamiento
                        ffprobe + sharp/ffmpeg          ┌── STORAGE_DRIVER=local (coste 0):
                        verifica JWT de Supabase        │     disco del PC (STORAGE_DIR)
                        corre en el PC (túnel Funnel)   │     servido por GET /v1/blob/<key>?e=&t=<hmac>
                              │                         └── STORAGE_DRIVER=r2: Cloudflare R2 + URLs firmadas
                              ▼
                        Postgres (Supabase) — assets · upload_tokens · access_log
                              ▲
                   Web (Next.js 15, Vercel) — landing 3D · /app galería · /app/actividad · /app/ajustes
                   PWA (@serwist) · efectos WebGL (three / react-three-fiber)
```

## Almacenamiento (`apps/api/src/storage.ts`)

Capa con tres motores, elegido por `STORAGE_DRIVER`. Interfaz común:
`put(key, filePath, mime)`, `signedUrl(key)`, `remove(key)`, `readBlob(key)`.

- **`telegram`** (por defecto, coste 0): sube cada archivo a un canal privado con
  `client.sendFile(channel, { forceDocument: true })` — Telegram guarda los **bytes
  exactos** (nada de recompresión). `apps/api/src/telegram.ts` usa GramJS (`telegram`
  npm) con una sesión de usuario (`TELEGRAM_SESSION`, generada por `pnpm … tg-login`).
  `blob_refs` mapea `key → tg_message_id`. Lectura: caché LRU en disco (`TG_CACHE_DIR`,
  `TG_CACHE_MAX_MB`) para miniaturas/pósters; los originales grandes se bajan y sirven al
  vuelo sin cachear. Se sirve por `GET /v1/blob/<key>?e=<exp>&t=<hmac>`.
- **`local`** (coste 0): archivos en `STORAGE_DIR` del disco. Mismo `GET /v1/blob`.
- **`r2`**: Cloudflare R2 (S3), URLs firmadas nativas.

`/v1/blob` no usa sesión: el enlace lleva un token HMAC temporal firmado con
`BLOB_SECRET` (`storage.signedUrl`). Cambiar de motor es solo variables de entorno.

### Audio

Tercer tipo de archivo (`kind = 'audio'`, migración 025): música, notas de voz, podcasts
(`.mp3 .m4a .aac .wav .flac .ogg .opus .aiff .caf .amr .wma`). `probe()` lo clasifica con
ffprobe: hay pista de audio y NINGUNA de vídeo real (la carátula incrustada cuenta como
`attached_pic`, no como vídeo). La «portada» es la carátula del archivo si la trae o una tarjeta
generada con la marca (ondas de sonido y nombre, con un tono propio por archivo). Se reproduce
con `<audio>` en el visor desde el original (sin copia ligera: no hace falta). El servidor de
archivos (`/v1/blob`) sirve los tipos MIME de audio; sin ellos el navegador se niega a reproducirlos.

### Sin pérdida de calidad + Live Photos

Como se guarda el archivo **byte a byte**, todo lo que el iPhone embebe (HDR/Dolby
Vision, mapa de profundidad de Retrato, ProRAW, modo Cine, EXIF, GPS) se conserva sin
hacer nada especial. El **Live Photo** son dos archivos: el `.HEIC` va por
`POST /v1/assets`; el `.MOV` por `POST /v1/assets/:id/live-video` (columna
`live_video_key`). La galería ofrece "Descargar original" y "Vídeo Live" por separado.

## Repo — monorepo pnpm (`proyectos/upscale/`)

```text
apps/api        Fastify. Sube a R2, deriva, indexa. Multi-usuario (JWT Supabase).
apps/web        Next.js 15. Landing (R3F) + app (galería, actividad, ajustes). PWA.
packages/shared Tipos TS. Solo `import type`.
infra           api.Dockerfile · compose.dev.yml (Postgres + MinIO local)
docs            BRANDING · ARCHITECTURE · DEPLOY
```

## Autenticación

- **Login**: Supabase Auth con proveedores **Google** y **Apple** (Sign in with Apple /
  iCloud). La web usa `@supabase/ssr`; el `middleware.ts` refresca la sesión y protege
  `/app/*`. `/auth/callback` intercambia el código OAuth.
- **API**: valida el `access_token` de Supabase (HS256 con `SUPABASE_JWT_SECRET`).
  `sub` = `user_id`. Todas las consultas filtran por `user_id`.
- **Subida**: `POST /v1/assets` acepta el Bearer de sesión (web) **o** un `X-Upload-Token`
  de la tabla `upload_tokens` (Atajo iOS). Cada usuario gestiona sus tokens en Ajustes.

## API — endpoints

| Método | Ruta | Qué |
|---|---|---|
| `GET` | `/v1/healthz` | estado |
| `GET` | `/v1/auth/me` | `{ userId, email }` de la sesión |
| `POST` | `/v1/assets` | sube el original (stream→almacén), deriva, indexa. Dedup por `(user_id, sha256)` |
| `POST` | `/v1/assets/:id/live-video` | adjunta el `.MOV` de un Live Photo (byte a byte) |
| `GET` | `/v1/assets?limit=&cursor=&kind=&sort=` | feed del usuario, keyset por `(captured_at,id)`. `sort=added` ordena por fecha de **subida** `(uploaded_at,id)` (vista «Nuevos») |
| `GET` | `/v1/assets/:id` | ficha + `originalUrl` firmada. Registra `view` |
| `GET` | `/v1/assets/:id/original` | 302 → URL firmada de R2. Registra `download` |
| `GET` | `/v1/assets/:id/poster` | 302 → póster o miniatura |
| `DELETE` | `/v1/assets/:id` | soft-delete + borra los blobs del disco (liberar espacio) |
| `GET` | `/v1/blob/*?e=&t=` | (modo local) sirve un archivo del disco; token HMAC en la URL |
| `GET` | `/v1/storage` | `{ driver, usedBytes, count, diskFreeBytes, diskTotalBytes }` |
| `GET` | `/v1/tokens` · `POST` · `DELETE /:token` | tokens de subida del usuario |
| `GET` | `/v1/plans` | catálogo público de planes (sin sesión) |
| `GET` | `/v1/me/account` | espacio usado, plan, bonus e invitaciones de la persona |
| `POST` | `/v1/me/redeem` `{code}` | canjea un código (espacio extra o plan de prueba). 10/min |
| `POST` | `/v1/me/referral` `{code}` | enlaza a quien la invitó (solo cuentas sin archivos) |
| `POST` | `/v1/me/waitlist` `{plan}` | lista de espera de un plan de pago |
| `GET`/`POST` | `/v1/admin/codes` | (admin) listar / crear códigos de canje |
| `GET` | `/v1/activity?before=` | registro de `view`/`download`/`list` del usuario |

## Tablas (`apps/api/migrations/001_init.sql`)

- **assets** — `user_id`, `kind`, `sha256` (único por usuario), dimensiones, `fps`,
  `video_bitrate`, `codec`, `captured_at`, EXIF cámara/lente, `lat`/`lon`, `is_live`,
  `original_key`/`thumb_key`/`poster_key`, `deleted_at`.
- **upload_tokens** — `token`, `user_id`, `label`, `last_used`.
- **access_log** — `user_id`, `asset_id`, `action`, `at`, `ua`. Alimenta *Actividad*.

## 3D / efectos (web)

- **Landing** (`components/landing/HeroScene.tsx`): `@react-three/fiber` + `drei` +
  `@react-three/postprocessing` (Bloom + Vignette). Nube de ~34 planos con textura de
  degradado orbitando, cámara con parallax al puntero. `frameloop="demand"` si
  `prefers-reduced-motion`.
- **App** (`components/Aurora.tsx`): plano a pantalla completa con *fragment shader*
  (aurora de ruido), fijo detrás de la UI. Fallback CSS estático con reduced-motion.
- **Galería** (`components/TiltFrame.tsx`): inclinación 3D por `perspective`/`rotateX/Y`
  según el puntero, sin librería, vía `requestAnimationFrame`.
- **Transiciones**: `motion` (framer-motion) en la landing (`whileInView`, stagger).

## PWA

`@serwist/next` (`swSrc: app/sw.ts` → `public/sw.js`, precache + `defaultCache`).
`public/manifest.webmanifest` (`display: standalone`, `start_url: /app`), iconos SVG en
`public/` + `app/icon.svg` + `app/apple-icon.tsx` (ImageResponse). `InstallPrompt.tsx`
captura `beforeinstallprompt`.

## Fase 2 (pendiente)

App iOS nativa (SwiftUI) con subida en segundo plano (`PHPhotoLibrary` observer,
`BGProcessingTaskRequest`, `URLSession` background). Requiere cuenta Apple Developer.
La API ya expone lo necesario; se añadiría `POST /v1/assets/presign` para subir directo
a R2.

## Planes, cuotas y topes

- **Catálogo** en `apps/api/src/plans.ts` (Gratis 5 GB · Plus 100 GB · Pro 500 GB · Max 2 TB;
  precios = propuesta, aún sin cobro). La web tiene una copia para pintarlos
  (`apps/web/lib/plans.ts`): si se cambia uno, cambiar el otro.
- **Estado por persona** en `profiles` (plan, `plan_until`, `bonus_bytes`, código de invitación).
  Un plan de prueba caducado vuelve a Gratis; pasarse de cuota no borra nada, solo impide subir.
- **En la subida** (`POST /v1/assets`) se comprueba ANTES de aceptar el cuerpo: tamaño máximo por
  archivo del plan (413 `FILE_TOO_BIG`), espacio libre (402 `QUOTA`) y subidas simultáneas
  (429 `BUSY`, ver `uploadSlots.ts`). Sin `Content-Length`, el tope se aplica mientras llega.
  El administrador no tiene tope.
- **Invita y gana:** al guardar su primer archivo, la persona invitada recibe +1 GB y quien la
  invitó +2 GB (máx. 10 invitaciones premiadas = +20 GB). Una sola vez por invitación.
- **Códigos** (`redeem_codes`): `bonus` (espacio) o `plan` (N días). Una vez por persona, con
  usos máximos y caducidad opcionales. Se crean con `POST /v1/admin/codes`.

### Telegram como almacén para muchas personas

Todo se guarda en UNA cuenta de Telegram. Límites conocidos: 2 GB por archivo (4 GB con Premium),
~3,5 MB/s sostenidos medidos por cuenta, espera obligatoria (`FLOOD_WAIT`) si se abusa, y los
Términos de la API permiten a Telegram cortar el acceso del `api_id` tras avisar. Por eso las
cuotas y el tope de subidas simultáneas no son opcionales: son lo que protege esa cuenta. La
capa `storage.ts` ya admite `STORAGE_DRIVER=r2` para salir de Telegram sin tocar la app.

## Portada (landing) — `apps/web/components/landing/`
Pensada para que cualquiera la entienda en segundos y acabe registrándose:
- **Un solo botón al principio** (`StartBox`): las formas de entrar (Google/Apple/email) solo aparecen al pulsarlo.
- **Cómo funciona de uno en uno** (`Steps`): 3 pasos; los tres están en el HTML, a la vista solo uno.
- **Planes por niveles**: el Gratis primero y grande, el resto plegado en un `<details>`. Los de pago figuran como «muy pronto» (aún no hay cobro).
- **Invita y gana** y **FAQ** (`<details>`, sin JS). Textos en `content.ts` (cortos, una idea por línea). **Telegram no aparece**: es un detalle interno.
- Sin cifras ni escasez inventadas: la persuasión viene de lo que es verdad (gratis, sin tarjeta, original idéntico, 1 minuto).
- **SEO**: `generateMetadata` en `app/page.tsx` (título, descripción, canonical, Open Graph/Twitter), `app/opengraph-image.tsx`, `app/robots.ts`, `app/sitemap.ts`; `/app/*` lleva `noindex`.
- **AEO** (buscadores de IA): JSON-LD `WebSite` + `SoftwareApplication` + `HowTo` + `FAQPage` en la portada, respuestas que contestan en la primera frase, y `/llms.txt` (`app/llms.txt/route.ts`).
- La URL pública sale de `SITE_URL` o, si no está, de la petición (`lib/site.ts`).
- **Legal**: `/privacidad` y `/terminos` (con resumen «en pocas palabras»); enlazadas desde la portada, el registro y Ajustes. Responsable y contacto salen de `LEGAL_NAME` / `CONTACT_EMAIL`. La política nombra a Telegram como parte del almacenamiento (transparencia obligatoria) aunque la interfaz no lo muestre.
- **Borrar cuenta**: Ajustes → «Borrar mi cuenta» (escribir BORRAR) → `POST /v1/me/delete` (202, borrado por tandas en segundo plano: archivos del almacén, filas, álbumes, tokens, accesos, canjes, perfil; y el usuario de Supabase si hay `SUPABASE_SERVICE_ROLE_KEY`). La cuenta de administración (ingesta atada) no se puede borrar así.
- **Ajustes** simple: subir, descargar todo (ZIP) y borrar cuenta; lo técnico (Atajo de iOS, mapa, vídeos sin vista previa) va plegado en «Opciones avanzadas».
- Pendiente: cobro real (Stripe).

## Descargas (ZIP)
`apps/api/src/zipDownload.ts` + `DownloadSheet` en la web.
- **Una foto/vídeo** → enlace directo al original (`/api/dl/:id`, sin ZIP). **Varios** → ZIP pedido con **POST** (`/v1/assets/zip`, la selección va en el cuerpo: con cientos de fotos los ids no caben en una URL; `GET ?ids=` sigue por compatibilidad).
- Filtros iguales a los de la galería (`kind`, `fav`, `album`, `q`, `camera`, `from`, `to`): «Descargar todo» baja exactamente lo que se ve filtrado.
- **Partes**: `POST /v1/assets/zip/plan` devuelve cuántos elementos/bytes son y los reparte en partes (2 GB en móvil, 8 GB en ordenador; un original más grande es su propia parte). La hoja de descarga (`DownloadSheet`) sale solo si es «descargar todo» o la selección pesa más de 1,5 GB; si no, se descarga directamente.
- **Sin errores por archivos malos**: un archivo que falla se omite y el ZIP añade `LEEME - archivos omitidos.txt` con la lista. Nombres repetidos (también por mayúsculas) se renombran. Zip64 solo si hace falta (>3,5 GB).
- **Rápido**: las cabeceras salen al instante (el navegador enseña la descarga ya), hasta 6 archivos se bajan en paralelo (2 «grandes» como máximo, con presupuesto de bytes según el disco libre).
- **Cupos**: `ZIP_MAX_PER_USER` (1) y `ZIP_MAX_CONCURRENT` (3). Al cancelar en el navegador el hueco se libera al instante y se corta también la petición a la API.
- Errores (ya hay una descarga, demasiadas a la vez, nada que bajar) salen como una página legible en la pestaña de descarga, no como JSON.
- **Barra de progreso**: la descarga la gestiona el navegador (en iPhone, el gestor del sistema), así que la página no puede medirla; la mide el servidor. `descargarZip()` manda un `job` (uuid) con la petición y `DownloadProgress` (montada en `/app`) pregunta cada ~0,7 s a `GET /v1/assets/zip/progress?job=` (solo lo ve su dueño). Estados: preparando → enviando (archivos y bytes: lo escrito menos lo que aún espera en la cola del socket) → listo / error / cancelado; se guarda 15 min en memoria. Si el servidor no llega a registrar la descarga en 12 s se avisa de que el navegador pudo bloquear la ventana.

## Ingesta de Telegram: registro de envíos
`ingestState.recent` (y `kv ingest:recent`, sobrevive a los redeploys) guarda los últimos 40 archivos que llegaron por Telegram y qué pasó con cada uno: **nuevo**, **duplicado** (con el nombre y la fecha del original que ya estaba: se detecta por sha256, así que reenviar algo ya guardado no crea nada nuevo y el mensaje se borra), **error** (con el motivo), **omitido** (tras 3 fallos), **sin_usuario** o **aplazado** (disco). Se ve en Ajustes → «Lo último que llegó por Telegram» (solo administrador) y en `GET /v1/ingest/status`. El destino de los archivos es la cuenta atada (`kv ingest:user_id`, o `INGEST_USER_ID`); ya **no** se usa «el usuario con el token de subida más reciente» como último recurso (con el registro abierto, cualquier persona nueva podía quedarse con los archivos del dueño).
