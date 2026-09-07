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

Capa con dos motores, elegido por `STORAGE_DRIVER`:

- **`local`** (por defecto, coste 0): originales y copias en `STORAGE_DIR` del disco.
  Se sirven por `GET /v1/blob/<key>?e=<exp>&t=<hmac>` — sin sesión, el enlace lleva un
  token HMAC temporal firmado con `BLOB_SECRET` (`storage.signedUrl`). La API corre en
  la máquina que tiene el disco (el PC), expuesta por Tailscale Funnel o Cloudflare Tunnel.
- **`r2`**: Cloudflare R2 (S3), URLs firmadas nativas. La API puede ir entonces en el VPS.

Cambiar de uno a otro es solo variables de entorno; el resto del código no cambia.

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
| `POST` | `/v1/assets` | sube el original (stream→R2), deriva, indexa. Dedup por `(user_id, sha256)` |
| `GET` | `/v1/assets?limit=&cursor=&kind=` | feed del usuario, keyset por `(captured_at,id)` |
| `GET` | `/v1/assets/:id` | ficha + `originalUrl` firmada. Registra `view` |
| `GET` | `/v1/assets/:id/original` | 302 → URL firmada de R2. Registra `download` |
| `GET` | `/v1/assets/:id/poster` | 302 → póster o miniatura |
| `GET` | `/v1/tokens` · `POST` · `DELETE /:token` | tokens de subida del usuario |
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
