@echo off
REM Arranca la API de Upscale en este PC (STORAGE_DRIVER=local: los archivos se
REM guardan en apps\api\data). Deja esta ventana abierta.
REM Requisitos: Node 20+, pnpm (corepack enable), ffmpeg en el PATH.

cd /d "%~dp0"

where ffmpeg >nul 2>&1 || echo [AVISO] ffmpeg no esta en el PATH. Instalalo:  winget install Gyan.FFmpeg

if not exist node_modules (
  echo [SETUP] Instalando dependencias...
  call pnpm install || goto :err
)

echo [START] API en http://localhost:8080  (Ctrl+C para parar)
call pnpm --filter @upscale/api serve
goto :eof

:err
echo [ERROR] Fallo en pnpm install
pause
