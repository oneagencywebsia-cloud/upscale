# syntax=docker/dockerfile:1
# Upscale — TODO en un contenedor (API Fastify + Web Next.js).
# En EasyPanel: 1 sola App → Dockerfile = infra/allinone.Dockerfile, Build Path = /, puerto 3001.
#
# Build args (Next los necesita al compilar):
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

FROM node:20-bookworm-slim AS base
# ffmpeg: vídeo. libheif-examples (heif-convert) + libvips-tools (vips): leer HEIC/HEIF
# del carrete del iPhone, que ni sharp ni el ffmpeg de bookworm saben decodificar.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates libheif-examples libvips-tools \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---------- deps + build ----------
FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
# La store de pnpm se cachea entre builds: al añadir una dependencia solo baja la nueva.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --store-dir /pnpm/store --config.node-linker=hoisted

COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN pnpm --filter @upscale/api build
# La caché de compilación de Next se conserva entre builds → recompila solo lo cambiado.
RUN --mount=type=cache,id=next-cache,target=/app/apps/web/.next/cache \
    pnpm --filter @upscale/web build

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node_modules hoisted (los usa la API) + código compilado de la API
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/packages ./packages

# Web (salida standalone de Next: trae sus propias deps mínimas)
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

COPY infra/start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=3001
ENV API_PORT=8080
ENV TMP_DIR=/tmp/upscale
ENV TG_CACHE_DIR=/app/tg-cache
EXPOSE 3001
CMD ["/start.sh"]
