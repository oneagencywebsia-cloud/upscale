# Upscale

Nube de fotos personal que **guarda el original del iPhone entero** — misma
resolución, mismos FPS, mismos bits — y lo devuelve exactamente igual.

- **Identidad:** [`docs/BRANDING.md`](docs/BRANDING.md)
- **Arquitectura:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Puesta en marcha:** [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **Mockup (diseño iOS 26):** https://claude.ai/code/artifact/885c8db0-ef92-4dbb-a9ba-2bff42864067

## Qué incluye

| Área | Detalle |
|---|---|
| **Auth** | Registro/login con **Google** y **Apple** (Sign in with Apple / iCloud) vía Supabase. Multi-usuario. |
| **Galería** | `/app` — hoja por fechas + inspector con ficha técnica y sello de integridad SHA-256. |
| **Actividad** | `/app/actividad` — registro de lo que cada usuario ve y descarga. |
| **Ajustes** | `/app/ajustes` — tokens de subida para el Atajo de iOS. |
| **Landing** | `/` — hero 3D (react-three-fiber + bloom), animaciones, CTA «Registrar». |
| **3D en la app** | Fondo WebGL (shader aurora) + inclinación 3D de los tiles. |
| **PWA** | Instalable (`@serwist/next` + manifest). `display: standalone`, `start_url: /app`. |
| **API** | Fastify: sube el original a R2 sin recodificar, deriva miniatura/póster, indexa en Postgres. |

## Estado

| Fase | Alcance | Estado |
|---|---|---|
| **1** | API + web (auth Google/Apple, galería, actividad, ajustes, landing 3D, PWA). Subida con Atajo iOS. | ✅ código completo — falta desplegar (`docs/DEPLOY.md`) |
| **2** | App iOS nativa con subida automática en segundo plano. | ⚪ pendiente (necesita cuenta Apple Developer) |

## Stack

- **Archivos** → `STORAGE_DRIVER`: **`telegram`** (canal privado, coste 0, no tu PC ni
  tu VPS, subido *como documento* = bytes exactos) · `local` (disco) · `r2` (Cloudflare, de pago).
- **Login + Postgres** → Supabase (gratis, sin tarjeta).
- **Código (API + web)** → EasyPanel (VPS). 3D → three / react-three-fiber / drei / postprocessing · PWA → @serwist.

Sin pérdida de calidad: todo lo que el iPhone embebe (HDR, profundidad, ProRAW, EXIF, GPS)
se conserva; los **Live Photos** se guardan como dos archivos. Ver `docs/DEPLOY.md`.

## Desarrollo

```bash
corepack enable
pnpm install
cp .env.example apps/api/.env         # sección API
cp .env.example apps/web/.env.local    # sección WEB (Supabase real)
docker compose -f infra/compose.dev.yml up -d   # Postgres + S3 local
pnpm migrate
pnpm dev                               # API :8080 · web :3001
```

## Estructura

```text
apps/api          Fastify — R2, ffmpeg, Postgres, JWT Supabase
apps/web          Next.js 15 — landing 3D, app (galería/actividad/ajustes), PWA
packages/shared   Tipos TS compartidos
infra             api.Dockerfile · compose.dev.yml
docs              BRANDING · ARCHITECTURE · DEPLOY
```
