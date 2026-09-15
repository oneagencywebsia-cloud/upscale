import pg from "pg";
import { env } from "./env.js";

/** Pool de Postgres (Supabase). SSL requerido en el pooler de Supabase. */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("localhost") || env.DATABASE_URL.includes("127.0.0.1")
    ? undefined
    : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000, // en vez de esperar indefinidamente si el pool está lleno
  statement_timeout: 20_000, // una consulta lenta no bloquea una conexión para siempre
  query_timeout: 25_000, // red de seguridad del lado del cliente: por si el server
  // (p. ej. el pooler de Supabase) no honra statement_timeout, node-pg corta igual.
  // idle_in_transaction_session_timeout: sin esto, un BEGIN sin COMMIT/ROLLBACK
  // (bug de la app, o un cliente que muere a mitad de una transacción) se queda
  // con una conexión del pool PARA SIEMPRE. Con max=20, bastan unas pocas fugas
  // así para dejar sin conexiones a las peticiones de usuarios reales mientras
  // los barridos de mantenimiento (backfill, poda, ingest) compiten por el pool.
  idle_in_transaction_session_timeout: 30_000,
  // TCP keepalive: detecta antes una conexión muerta (pooler reiniciado, red
  // caída) en vez de quedarse un rato colgado esperando un socket que no va a
  // responder — importante con un pool pequeño compartido por peticiones vivas
  // y tareas de fondo de larga duración.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("[db] error en cliente inactivo:", err.message);
});

/**
 * Instantánea barata del estado del pool (sin consultar la BD): cuántas
 * conexiones hay abiertas, cuántas libres y cuántas peticiones están
 * esperando una. Si `waiting` crece de forma sostenida, el pool (max=20) se
 * está quedando corto para el tráfico real + los barridos de fondo — señal
 * de que hay que subir `max` o separar un pool aparte para mantenimiento
 * antes de que las peticiones de usuario empiecen a hacer cola de verdad.
 */
export function poolStats(): { total: number; idle: number; waiting: number; max: number } {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: 20 };
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never);
}

/** Devuelve la primera fila o null. */
export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const res = await query<T>(text, params);
  return res.rows[0] ?? null;
}

export async function ping(): Promise<boolean> {
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}
