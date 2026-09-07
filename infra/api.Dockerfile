# Upscale API — build desde la raíz del repo:
#   docker build -f infra/api.Dockerfile -t upscale-api .
# En EasyPanel: build context = raíz del repo, dockerfile = infra/api.Dockerfile

FROM node:20-bookworm-slim

# ffmpeg/ffprobe para metadatos y miniaturas/pósters
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# 1) manifiestos primero (mejor cache)
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY pnpm-lock.yaml* ./
RUN pnpm install --filter "@upscale/api..." --config.node-linker=hoisted

# 2) código y build
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @upscale/api build

ENV NODE_ENV=production
ENV TMP_DIR=/tmp/upscale
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "dist/server.js"]
