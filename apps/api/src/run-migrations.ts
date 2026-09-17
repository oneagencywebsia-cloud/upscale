import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type pg from "pg";
import { pool } from "./db.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Plazo para UNA migración. Las migraciones no son consultas de usuario: un
 * `create index` o un `alter table ... add column` sobre una tabla `assets` ya
 * grande tarda minutos, mientras que el pool impone `statement_timeout` de 20 s
 * y `query_timeout` de 25 s a TODO lo que pasa por él (db.ts).
 *
 * Eso era un fallo de arranque esperando a pasar: en cuanto una migración
 * futura (o una de las existentes reaplicada sobre la base ya crecida) pasara
 * de 20 s, Postgres la abortaba, el `catch` hacía ROLLBACK, runMigrations()
 * relanzaba el error y server.ts hace `process.exit(1)` — la API NO ARRANCA, y
 * al reintentar el contenedor vuelve a fallar en el mismo punto, en bucle.
 * Peor todavía con `query_timeout`: node-pg, si la consulta ya se envió,
 * DESTRUYE el socket — la transacción se queda abierta del lado del servidor
 * hasta que salta `idle_in_transaction_session_timeout`.
 *
 * Se le da 1 h a cada migración, por sesión (statement_timeout) y del lado del
 * cliente (query_timeout por consulta, que es lo único que pisa el valor del
 * pool).
 */
const MIGRACION_TIMEOUT_MS = 60 * 60_000;

/** Aplica migrations/*.sql pendientes. Idempotente. Se llama al arrancar la API. */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  // `q` pisa el query_timeout del pool para ESTA sesión de migración.
  // (`query_timeout` no está en los tipos de QueryConfig pero pg SÍ lo lee del
  // objeto de consulta: `config.query_timeout || connectionParameters.query_timeout`.)
  const q = (text: string, values?: unknown[]): Promise<pg.QueryResult> =>
    client.query({ text, values, query_timeout: MIGRACION_TIMEOUT_MS } as unknown as pg.QueryConfig);
  try {
    // `set local` no sirve aquí (hay consultas fuera de transacción): se pone a
    // nivel de sesión y esa conexión NO vuelve al pool (se destruye al final),
    // para no repartir por ahí una conexión sin límite de consulta.
    await q(`set statement_timeout = ${MIGRACION_TIMEOUT_MS}`);
    await q(
      "create table if not exists _migrations (name text primary key, run_at timestamptz not null default now())",
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await q("select 1 from _migrations where name = $1", [file]);
      if (done.rowCount) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await q("begin");
      try {
        await q(sql);
        await q("insert into _migrations (name) values ($1)", [file]);
        await q("commit");
        console.log(`[migrate] + ${file}`);
      } catch (err) {
        // El rollback también necesita su propio margen: si falla (conexión ya
        // rota), se propaga el error ORIGINAL, que es el que explica qué pasó.
        await q("rollback").catch(() => {});
        throw err;
      }
    }
  } finally {
    // `true` = destruir en vez de devolver al pool: esta conexión lleva un
    // statement_timeout de 1 h a nivel de sesión y no debe acabar sirviendo
    // peticiones de usuario con ese margen. Se hace una sola vez, al arrancar.
    client.release(true);
  }
}
