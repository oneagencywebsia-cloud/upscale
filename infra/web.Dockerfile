# Upscale Web (Next.js) — build desde la raíz del repo:
#   docker build -f infra/web.Dockerfile -t upscale-web .
# En EasyPanel: build context = raíz del repo, dockerfile = infra/web.Dockerfile
#
# Variables necesarias EN BUILD y en runtime:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, UPSCALE_API_URL

FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY pnpm-lock.yaml* ./
RUN pnpm install --filter "@upscale/web..." --config.node-linker=hoisted

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN pnpm --filter @upscale/web build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# salida standalone de Next
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/web/server.js"]
