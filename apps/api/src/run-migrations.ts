import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Aplica migrations/*.sql pendientes. Idempotente. Se llama al arrancar la API. */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "create table if not exists _migrations (name text primary key, run_at timestamptz not null default now())",
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await client.query("select 1 from _migrations where name = $1", [file]);
      if (done.rowCount) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`[migrate] + ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
