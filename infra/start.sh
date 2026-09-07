#!/bin/bash
set -e

# API Fastify (interna)
PORT="${API_PORT:-8080}" node apps/api/dist/server.js &
API_PID=$!

# Web Next.js (pública)
PORT="${PORT:-3001}" HOSTNAME=0.0.0.0 node apps/web/server.js &
WEB_PID=$!

# si cae cualquiera de los dos, tira el contenedor para que EasyPanel lo reinicie
wait -n
exit $?
