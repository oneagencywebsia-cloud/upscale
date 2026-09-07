import pg from "pg";
import { env } from "./env.js";

/** Pool de Postgres (Supabase). SSL requerido en el pooler de Supabase. */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("localhost") || env.DATABASE_URL.includes("127.0.0.1")
    ? undefined
    : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("[db] error en cliente inactivo:", err.message);
});

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
