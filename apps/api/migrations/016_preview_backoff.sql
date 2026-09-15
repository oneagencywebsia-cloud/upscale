-- 0.20.0 — Backlog de copias de reproducción a escala TB: backoff exponencial,
-- concurrencia segura entre workers y autocuración de candados huérfanos.
--
-- Antes: 3 intentos y para siempre (preview_state = -1), reintentados sin
-- espera cada 20 s. Un fallo TRANSITORIO (disco lleno, red, el proceso
-- muere a mitad de una transcodificación de horas por un OOM-kill o un
-- redeploy) se confundía con "este vídeo nunca podrá tener copia ligera"
-- tras poco más de un minuto de reintentos machacando el mismo archivo.
-- A escala de miles de vídeos largos eso da abandonos falsos constantes.
--
-- Ahora: más intentos permitidos (PREVIEW_MAX_ATTEMPTS, por defecto 8) pero
-- con espera EXPONENCIAL entre cada uno (preview_next_attempt_at). Mientras
-- un vídeo problemático espera su turno, el resto del backlog sigue
-- avanzando en vez de quedarse bloqueado detrás de él.
--
-- preview_locked_at es lo que permite subir la concurrencia del worker de
-- forma segura: dos workers no pueden reclamar el mismo vídeo a la vez
-- (se combina con "for update skip locked" en la consulta de reclamo), y si
-- un worker muere a mitad de faena el candado caduca solo pasado
-- PREVIEW_LOCK_TIMEOUT_MIN y el vídeo vuelve a la cola sin intervención
-- manual — no se puede quedar "procesando" para siempre.

alter table assets add column if not exists preview_next_attempt_at timestamptz not null default now();
alter table assets add column if not exists preview_locked_at timestamptz;
alter table assets add column if not exists preview_last_error text;
