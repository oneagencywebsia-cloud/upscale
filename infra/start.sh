#!/bin/bash
set -e

# API Fastify (interna)
PORT="${API_PORT:-8080}" node apps/api/dist/server.js &
API_PID=$!

# Web Next.js (pública). --require sube los timeouts del http.Server interno
# de la salida standalone de Next (por defecto Node corta a los 5 min con un
# 408 cualquier petición que tarde más en llegar — ver patch-timeouts.cjs).
PORT="${PORT:-3001}" HOSTNAME=0.0.0.0 NODE_OPTIONS="--require /app/apps/web/patch-timeouts.cjs" node apps/web/server.js &
WEB_PID=$!

# si cae cualquiera de los dos, tira el contenedor para que EasyPanel lo reinicie
wait -n
exit $?
