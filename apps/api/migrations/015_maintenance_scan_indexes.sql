-- Escala: varios barridos de fondo (ingest.ts) corren en CADA vuelta del
-- ingest (cada 8-45 s, para siempre, mientras el proceso viva) haciendo un
-- filtro sobre TODA la tabla `assets` sin ningún índice que los soporte:
--
--   1) el contador de "chores" y backfillDerivatives() buscan filas con
--      póster/dimensiones aún pendientes (poster_jpg is null, o vídeo sin
--      width/duration_s).
--   2) offloadPosters() busca filas cuyo póster sigue en Postgres (aún no
--      volcado a Telegram) para seguir sacándolo de la BD.
--   3) precargarArranques() ordena TODOS los vídeos por captured_at desc
--      con LIMIT 60, sin filtrar por usuario — un sort de la tabla entera.
--
-- Con miles/millones de filas esto es un seq scan (o un sort completo) cada
-- pocos segundos, para siempre. En régimen estable casi todas las filas ya
-- tienen póster/dimensiones y ya fueron volcadas a Telegram, así que estos
-- índices PARCIALES quedan minúsculos (solo contienen lo que de verdad está
-- pendiente) sea cual sea el tamaño de la tabla — la búsqueda pasa de O(filas
-- totales) a casi O(1).
--
-- Los predicados son deliberadamente más laxos que el WHERE completo de cada
-- consulta (se omiten los `not exists (select ... blob_refs)` y el
-- `octet_length(...) > 4`, que no son indexables como predicado de índice):
-- basta con que el predicado del índice esté IMPLICADO por el WHERE de la
-- consulta para que Postgres pueda usarlo (y luego re-comprueba el resto al
-- vuelo sobre las pocas filas candidatas).
--
-- OJO PARA PRODUCCIÓN A ESCALA TB: el migrador (migrate.ts) envuelve cada
-- archivo en BEGIN/COMMIT, y CREATE INDEX CONCURRENTLY no puede ir dentro de
-- una transacción. Sobre una tabla `assets` ya con millones de filas, este
-- CREATE INDEX normal toma un lock que bloquea escrituras mientras construye
-- el índice (recorre la tabla entera una vez). Si se aplica cuando la tabla
-- YA es enorme, mejor ejecutar el `create index concurrently` a mano fuera
-- del migrador (y luego marcar la fila en `_migrations` para que no se
-- reintente). Sobre una tabla pequeña/mediana (como ahora) es instantáneo y
-- no hace falta nada especial.

create index if not exists assets_missing_poster_idx
  on assets (id)
  where deleted_at is null and stored = true and not unrecoverable and poster_jpg is null;

create index if not exists assets_missing_video_meta_idx
  on assets (id)
  where deleted_at is null and stored = true and not unrecoverable and kind = 'video'
    and (width is null or duration_s is null);

create index if not exists assets_poster_offload_idx
  on assets (id)
  where deleted_at is null and stored = true and poster_key is not null and poster_jpg is not null;

create index if not exists assets_video_recent_idx
  on assets (captured_at desc)
  where kind = 'video' and stored = true and deleted_at is null;
