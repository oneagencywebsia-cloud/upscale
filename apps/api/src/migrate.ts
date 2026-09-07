import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";

/** Migrador mínimo: ejecuta migrations/*.sql en orden, una sola vez cada una. */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists _migrations (
        name text primary key,
        run_at timestamptz not null default now()
      )
    `);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await client.query("select 1 from _migrations where name = $1", [file]);
      if (done.rowCount) {
        console.log(`= ${file} (ya aplicada)`);
        continue;
      }
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`+ ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    console.log("Migraciones al día.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
