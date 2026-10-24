# Upscale — arquitectura

## Principio

El **archivo original nunca se recodifica**. Se guarda tal cual llega del iPhone
(bytes idénticos, `sha256` verificado). Miniaturas y pósters son copias derivadas,
descartables y regenerables.

## Componentes

```text
iPhone (Atajo)          Navegador / PWA
  POST /v1/assets          Google (Supabase Auth)
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

- **Login**: Supabase Auth con proveedor **Google** (y correo + contraseña). La web usa `@supabase/ssr`; el `middleware.ts` refresca la sesión y protege
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
- **Un solo botón al principio** (`StartBox`): las formas de entrar (Google/email) solo aparecen al pulsarlo.
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
`ingestState.recent` (y `kv ingest:recent`, sobrevive a los redeploys) guarda los últimos 40 archivos que llegaron por Telegram y qué pasó con cada uno: **nuevo**, **duplicado** (con el nombre y la fecha del original que ya estaba: se detecta por sha256 —el contenido, no el nombre—, así que reenviar algo ya guardado no crea nada nuevo, el mensaje se borra y el original **sube a «Nuevos»** al poner `uploaded_at = now()`; vale igual para subidas por la web), **error** (con el motivo), **omitido** (tras 3 fallos), **sin_usuario** o **aplazado** (disco). Se ve en Ajustes → «Lo último que llegó por Telegram» (solo administrador) y en `GET /v1/ingest/status`. El destino de los archivos es la cuenta atada (`kv ingest:user_id`, o `INGEST_USER_ID`); ya **no** se usa «el usuario con el token de subida más reciente» como último recurso (con el registro abierto, cualquier persona nueva podía quedarse con los archivos del dueño).

## Descargas «Compatibles con todo»
El original se guarda siempre tal cual, pero un HEIC de iPhone, un vídeo HEVC o un audio CAF/AMR no se abren en muchos aparatos. Las descargas tienen dos formatos (preferencia por dispositivo en `localStorage` `upscale-dl-compat`; por defecto **Compatible**; se cambia en el menú «···» de la galería, en la hoja de descarga y en Perfil → Preferencias):
- **Compatible** (`compat=1`, `apps/api/src/compat.ts`): fotos HEIC/HEIF/AVIF/TIFF/DNG → **JPG a resolución completa** con sus metadatos (fecha, cámara, GPS; `exiftool` copia las etiquetas y deja la orientación en normal); vídeos HEVC/ProRes/MKV/AVI… → **MP4 H.264** reutilizando la «copia ligera» (1080p) que ya existe (si aún no la tiene, va el original); audios CAF/AMR/WMA/AIFF/OGG/OPUS → **MP3**. Lo que ya se abre en todas partes (JPG, PNG, GIF, MP3, M4A, WAV, MP4/MOV H.264) va tal cual.
- **Original**: el archivo exacto, byte a byte (para editar o archivar). Las hojas de «Toda mi biblioteca» de Perfil y Ajustes (copia de seguridad) arrancan en Original.
- Vale para **una foto suelta** (`GET /v1/assets/:id/original?compat=1`: convierte y entrega, o redirige al enlace firmado si ya es compatible o es un vídeo), para el **ZIP** (`compat` en el cuerpo) y para el plan de partes (el tamaño y las partes se calculan sobre lo que se entrega de verdad).
- La conversión se hace de dos en dos (`COMPAT_CONCURRENCY`) dentro de la ventana de preparación del ZIP; los temporales se borran siempre. Si un archivo **no se puede convertir**, se incluye el **original** y `LEEME.txt` lo cuenta (nunca se pierde un archivo). El `LEEME.txt` también explica qué se convirtió y cómo conseguir los originales.

## 3D con la marca
`components/Mark3D.tsx` es el símbolo de Upscale en 3D de verdad: la geometría de `BrandMark` partida en capas con profundidad distinta (cristal, sombra, línea, tres peldaños, punto de luz y brillo) dentro de una escena con perspectiva CSS. Se inclina con el puntero o el dedo (`lib/tilt.ts`, `useTilt`), flota despacio y los peldaños «respiran» a distinta altura. **No hay librería 3D** (three.js habría sumado ~150 kB): solo `transform`/`opacity`, que se componen en la GPU. Sale en la portada (principal y final), en «Cómo funciona» (cada paso enciende un peldaño: prop `step`), en los estados vacíos, en la cabecera de la biblioteca y en el esqueleto de carga. `components/landing/Tilt.tsx` inclina las tarjetas (ventajas, planes, invitación). Todo se queda quieto con `prefers-reduced-motion` o con el interruptor de animaciones apagado, y se pausa fuera de pantalla (`IntersectionObserver`). En los fotogramas no se usa `var()` (se usa `em`, con `font-size: var(--s)`): así Chrome puede componerlos sin tocar el hilo principal.

## Rendimiento
- **Medir antes de tocar**: con Chromium y la CPU ×4 más lenta, el hilo principal en reposo gastaba ~1,3 s por cada 3 s. La causa era `wm-shimmer` (brillo del subrayado del logotipo): animaba `background-position`, que no se puede componer, en un bucle de 6 s casi siempre quieto → un fotograma de hilo principal a 60 fps en **todas** las pantallas. Ahora `components/BrandGlint.tsx` enciende `data-glint` solo los 1,8 s que dura el brillo (cada 6 s): **~80 ms por 3 s (−94 %)** con todas las animaciones activas; dentro de `/app` ~16 ms.
- La barra de progreso indeterminada (`dlp-slide`) animaba `margin-left`; ahora `transform`.
- El visor y las hojas de descarga / álbum se cargan bajo demanda (`next/dynamic`) y se precargan cuando el navegador está ocioso (`/app`: 167 → 158 kB de JS inicial).
- `content-visibility: auto` en las secciones de la portada que aún no se ven.
- Los estáticos públicos (`/brand`, iconos) llevan `Cache-Control` de una semana (Next los servía con `max-age=0`).
- Regla para animaciones nuevas: solo `transform`, `opacity` y `filter`; nada de `margin`, `width`, `background-position` ni `box-shadow` en bucles. Si el bucle es casi todo reposo, encenderlo solo cuando se mueve.

## SEO y AEO
- **Una sola lista** (`lib/seo.ts` → `PAGINAS`) alimenta el mapa del sitio, los enlaces internos, `llms.txt` y los datos estructurados. Páginas públicas de contenido: `/como-funciona` (HowTo), `/planes` (solo se publica el Offer del plan Gratis: los de pago aún no se pueden contratar), `/formatos`, `/preguntas` (FAQPage), `/guias` y dos guías (Article). Todas con `BreadcrumbList` + `Organization`, canónica y tarjeta Open Graph (`pageMeta`).
- **Dominio**: `metadataBase` sale de `SITE_URL` (o del host de la petición). Al activar upscale.com basta con definir `SITE_URL=https://upscale.com`: canónicas, sitemap, robots, llms y JSON-LD se actualizan solos. `CANONICAL_REDIRECT=1` (opcional, con `SITE_URL`) manda `www.` y el host de EasyPanel al dominio final con 308 (`middleware.ts`); está apagado por defecto para no dejar fuera a nadie antes de que el DNS esté listo.
- **AEO**: `llms.txt` (resumen) y `llms-full.txt` (todo el contenido en texto plano); `robots.txt` permite explícitamente a los rastreadores de IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended…); la primera frase de cada respuesta contesta directo.
- `manifest.webmanifest` sin `orientation: portrait` (molestaba en tabletas y móvil girado), con idioma y atajos.
- Regla: contenido solo con lo que el producto hace hoy; nada de valoraciones ni cifras inventadas.

## Dispositivos
Auditoría automática (Chromium) en 17 tamaños (280–2560 px, vertical y horizontal) por cada página pública y de la app: sin desbordes horizontales. Arreglado: la barra de la app se salía en iPad vertical y en móvil girado (el filtro baja a una 2ª fila hasta 960 px; en horizontal con poca altura la barra deja de ser fija), selectores en plegables de ~280 px, zonas táctiles de ≥44 px en el logo y en «Cómo funciona ↓», y las tablas de las páginas públicas se apilan en tarjetas en móvil.

## Fondo de la portada: «El ascenso»
`components/landing/Sky.tsx` (componente de servidor, sin JavaScript) dibuja un fondo infinito sobre la aurora: escalones con la forma del símbolo de Upscale que suben a distintas profundidades (los cercanos grandes, rápidos y nítidos; los lejanos pequeños, lentos y desenfocados), se bambolean (`translate`) y giran en 3D (`rotateY`), polvo de luz que sube, un sol cálido que respira (el de la esquina del logotipo) y un velo suave en la columna central para que el texto se lea. En la portada completa (18 escalones, 24 de polvo; 10 y 12 en móvil) y en versión compacta en las páginas de contenido. Las posiciones salen de fórmulas fijas (sin aleatoriedad: servidor y navegador coinciden). La aurora de la portada es más rápida y viva que la de la app (antes tardaba 26–39 s en moverse y no se notaba). Con el scroll el fondo se desplaza un poco (`animation-timeline: scroll()`, solo donde hay soporte).
- **Por qué «no se veía nada»**: con «reducir movimiento» en el sistema (p. ej. Windows con «Mostrar animaciones» desactivado) se apagaba toda la animación y la portada no tenía forma de reactivarla. Ahora: **modo calmado** (los escalones se quedan quietos y solo respiran en opacidad) y un **interruptor «Animaciones»** en la cabecera de la portada y de las páginas de contenido (`MotionToggle`). Guarda `upscale-motion` = `on`/`off` y lo refleja en `<html data-motion>`; `on` manda sobre el sistema para la portada (fondo, marca 3D, tarjetas, entradas); `off` lo deja todo quieto. Perfil → Animaciones sigue funcionando igual.
- **Coste medido** (Chromium, CPU ×4 más lenta, 3 s en reposo): el fondo añade ~0,3 s de hilo principal; la portada entera queda en ~0,5 s, frente a 1,3 s antes de arreglar el brillo del logotipo. Todo se anima con `transform`/`opacity`/`translate`, sin `var()` en los fotogramas.
- Para tocarlo: cada pieza aislada es gratis (se midió con una página mínima); si se añade una animación nueva, medir con `Performance.getMetrics` en la página real, no solo aislada.

## Auditoría de calidad (accesibilidad, errores, seguridad)
Hecha con comprobaciones ejecutadas contra la app real (Chromium + Postgres + API locales), no solo leyendo código.
- **Accesibilidad (WCAG 2.1 AA)**: axe-core sobre 15 pantallas × 2 temas × móvil/escritorio → **0 violaciones** (antes: zoom bloqueado en `/app`, contraste, sin `<main>`, ARIA mal usado). Tokens de color: `--accent` se queda para rellenos y brillos; **`--accent-ink`** (`#0f6f8a` en claro) es el que se usa cuando el acento es *texto*; `--text-mute` y `--danger-solid` cumplen 4,5:1 en los dos temas. `/app` ya permite zoom (el visor sigue protegido con `touch-action: none`). Enlace «Saltar al contenido» y `<main id="contenido">` en todas las páginas.
- **Diálogos** (`lib/dialog.ts`, `useDialogFocus`): el foco entra al abrir, Tab da la vuelta dentro y al cerrar vuelve a quien abrió. Lo usan el visor, «Añadir a álbum», la hoja de descarga y «Añadir fotos» de un álbum. El visor ahora es `role="dialog" aria-modal`.
- **Errores reales corregidos**: un álbum inexistente se mostraba como «Sin conexión» (se pedían álbum y contenido a la vez, y el 404 de uno se tomaba por fallo de red) → ahora 404 con mensaje claro; 404 con marca en español (`app/not-found.tsx` y `app/app/not-found.tsx`); un fallo de inicio de sesión (`/?error=auth`) volvía a la portada sin avisar; todas las pestañas de la app se llamaban «Upscale» (títulos por pantalla); miniaturas que fallan (`components/Thumb.tsx`): reintenta dos veces y, si no, un marcador en vez del icono de imagen rota — también si el fallo ocurre **antes de hidratar**, cuando `onError` ya no llega.
- **Seguridad**: cabeceras, rutas privadas (401/403 sin sesión), CSRF en POST (403 sin origen), CORS con lista explícita y sin mapas de código fuente: bien. **Dependencias**: `pnpm audit --prod` pasó de 24 avisos (1 crítico, 10 altos) a **0**: `next` 15.5.25→15.5.28 (RCE del optimizador de imágenes, que en producción está desactivado: `/_next/image` da 404), `sharp` 0.33→0.35.5 (libvips/libheif/librsvg, procesa archivos subidos), `fastify` →5.12.7 y `overrides` en el `package.json` raíz para `postcss`, `brace-expansion`, `fast-uri`, `ip-address` y `source-map-js`. Verificado: miniaturas de JPG/PNG/WebP/TIFF/GIF (orientación EXIF correcta, 9000×6000 en ~0,3 s, archivo corrupto tolerado), conversión «Compatible» a JPG y ZIP íntegro.
- **No hecho a propósito**: la CSP sigue con `script-src 'unsafe-inline'` (hace falta por el script de tema y el JSON-LD; pasar a *nonces* es posible porque todas las páginas son dinámicas, pero toca el middleware y conviene probarlo aparte). El modo `STORAGE_DRIVER=local` no sirve miniaturas (las guarda en la base de datos y la ruta de archivos solo mira el disco, y `putLocal` mueve el temporal que la miniatura en segundo plano aún necesita): en producción se usa Telegram y no afecta, pero no es un modo utilizable tal cual.

## Notas

Detalle completo en `docs/NOTAS.md`. Resumen: notas con editor (TipTap, cargado solo en la pantalla de edición), capturas adjuntas con lectura de texto (OCR con Tesseract, libre y local), estilo totalmente personalizable, etiquetas, fijadas, archivo y papelera de 30 días. El documento se guarda como JSON de ProseMirror **validado por una lista blanca en el servidor** (nunca HTML), con el texto plano aparte para la búsqueda. Las capturas son fotos de la biblioteca (Telegram): las notas solo las referencian; no se guarda nada en el servidor.

## Widgets, accesos rápidos e instalación

**Widgets de pantalla de inicio:** una web instalada (PWA) no puede crear widgets del sistema (iPhone: WidgetKit; Android: App Widgets). Por eso Upscale dibuja cada widget como **imagen en una dirección privada y revocable** que sirve para Scriptable (iPhone) y apps de widgets de Android: ver `docs/WIDGETS.md`. Además, sin app nativa ni pagos:

- **Accesos rápidos del icono** (mantener pulsado, Android/Chrome; `manifest.webmanifest → shortcuts`): Nueva nota (`/app/notas/nueva`, reutiliza la última nota si sigue vacía), Subir (`/app?subir=1`, el navegador exige un toque antes del selector de archivos, así que sale un botón grande), Notas, Favoritos y Biblioteca.
- **Compartir hacia Upscale** (`share_target`): archivos → biblioteca (con tamaño exacto para cuota e integridad); texto o enlace → **nota nueva**.
- **iPhone/iPad:** pantalla de arranque a medida de cada modelo en claro y oscuro (`/splash/<ancho>x<alto>-<tema>`, 17 pantallas × 2; solo tamaños de `lib/splash.ts`) y, como Safari no tiene botón de instalar, un aviso «Compartir → Añadir a pantalla de inicio» a partir de la 2.ª visita (se cierra 30 días).
- **Android:** iconos «maskable» en PNG, `launch_handler` (reutiliza la ventana abierta), `interactive-widget=resizes-content` (el teclado no tapa el editor) y color de barra/arranque igual al de la app.
- **Si algún día se quiere un widget de verdad:** habría que envolver la web en una app (Capacitor) y añadir el widget nativo; en iOS exige la cuota anual de Apple Developer. Queda apuntado en `docs/PENDIENTE.md`.
## Portada: recorrido con escenas fijas

Reglas: **nada de datos inventados** (ni usuarios, ni opiniones, ni «quedan X plazas»), solo lo que es verdad hoy. La portada alterna **escenas fijas** (el escenario se queda quieto y el contenido cambia al hacer scroll, `Scrolly.tsx`) con **tramos normales** donde la página baja:

1. Escena A (gancho): promesa + un botón → «tu móvil se llena» (pérdida) → «súbelo y olvídate» (alivio) → «idéntico al original» (prueba).
2. Tramo: la biblioteca en un móvil con vídeo + «1, 2, 3».
3. Escena B (confianza): pantallas → «solo tuyo» → invita y gana.
4. Tramo: planes con calculadora, captura → nota (`Demo.tsx`) y dudas.
5. Escena C (cierre): el caos vuelve a juntarse en un sol y aparece el mismo botón.

Mecánica: `formas.ts` define las disposiciones (sol, caos, escalera de la marca, marcos, pantallas, cerradura, red) de los **mismos 28 elementos**; al hacer scroll cada elemento viaja de una a la siguiente y cambia de forma (círculo ↔ rectángulo redondeado). Un solo oyente de scroll con `requestAnimationFrame`, que se para fuera de pantalla; solo se escriben `transform`, `opacity`, `border-radius` y el ancho de cada elemento. Sin JavaScript, con «reducir movimiento» o con las animaciones apagadas, las escenas son una lista normal de capítulos (`[data-quieto]`). Los capítulos ocultos llevan `inert`.

Imágenes y vídeo propios, sin servicios externos: `tools/generar-portada.mjs` (sharp + ffmpeg) genera ilustraciones y un vídeo de la biblioteca en `apps/web/public/landing/`.

- **Planes siempre a la vista** (antes iban en un `<details>`). `Pricing.tsx`: una calculadora («¿cuánto pesa tu carrete?», estimación media de 3 MB/foto y 100 MB/min de vídeo con 10 % de holgura) marca el plan que encaja («Para tu carrete»); los cuatro planes se leen de un vistazo, con el precio por día para suavizar el pago. Los de pago dicen la verdad: «Muy pronto» (se entra gratis y se avisa, `next=/app/espacio`).
- **Botón fijo en móvil** (`StickyCta.tsx`): aparece al pasar el primer botón y se esconde ante el botón final.
- El registro se abre en la propia tarjeta (`StartBox`), sin saltos de página.
- Los números de `lib/plans.ts` son la copia para pintar; la verdad está en `apps/api/src/plans.ts`.
