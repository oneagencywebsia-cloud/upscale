import type { FastifyInstance } from "fastify";
import type { AssetListItem, AssetKind } from "../types.js";
import { query, one } from "../db.js";
import { signedUrl } from "../storage.js";
import { requireUser, principalOf } from "../auth.js";

/** `uuid` de Postgres: cualquier otra cosa hace reventar la consulta con un
 *  error de casting (500 "error interno") en vez del 404 honesto que toca.
 *  Copiado literal de routes/assets.ts (no se toca ese archivo). */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// miniatura: URL estable ~3 semanas — mismo TTL que withUrls() en assets.ts.
const DERIV_TTL = 21 * 24 * 3600;

const MAX_NAME_LEN = 80;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, MAX_NAME_LEN);
  return name.length ? name : null;
}

interface AlbumRow {
  id: string;
  name: string;
  created_at: Date;
  count: string;
  cover_key: string | null;
}

// Misma fila que `A` en assets.ts (menos los blobs pesados), para poder
// reutilizar el mismo mapeo fila→AssetListItem en GET /v1/albums/:id/assets.
interface AssetRow {
  id: string; user_id: string; kind: AssetKind; filename: string; mime: string; bytes: string;
  sha256: string; width: number | null; height: number | null; duration_s: string | null;
  fps: string | null; video_bitrate: string | null; codec: string | null;
  captured_at: Date; uploaded_at: Date; camera_make: string | null; camera_model: string | null;
  lens: string | null; lat: number | null; lon: number | null; is_live: boolean;
  thumb_key: string; poster_key: string | null; original_key: string;
  preview_key: string | null; preview_bytes: string | null;
  live_video_key: string | null; live_video_bytes: string | null;
  is_favorite: boolean;
}

const A =
  "a.id, a.user_id, a.kind, a.filename, a.mime, a.bytes, a.sha256, a.width, a.height, " +
  "a.duration_s, a.fps, a.video_bitrate, a.codec, a.captured_at, a.uploaded_at, a.camera_make, " +
  "a.camera_model, a.lens, a.lat, a.lon, a.is_live, a.original_key, a.thumb_key, a.poster_key, " +
  "a.live_video_key, a.live_video_bytes, a.is_favorite, a.deleted_at, " +
  "a.preview_key, a.preview_bytes";

// Duplicado deliberado del mapeo fila→AssetListItem de assets.ts: ese archivo
// no exporta nada reutilizable y no se toca (ver spec). Mantener EXACTAMENTE
// el mismo shape es lo que importa aquí, no evitar la duplicación.
function toAssetListItemRow(r: AssetRow) {
  return {
    id: r.id, kind: r.kind, filename: r.filename, mime: r.mime, bytes: Number(r.bytes),
    sha256: r.sha256, width: r.width, height: r.height,
    durationS: r.duration_s === null ? null : Number(r.duration_s),
    fps: r.fps === null ? null : Number(r.fps),
    videoBitrate: r.video_bitrate === null ? null : Number(r.video_bitrate),
    codec: r.codec,
    capturedAt: r.captured_at.toISOString(), uploadedAt: r.uploaded_at.toISOString(),
    cameraMake: r.camera_make, cameraModel: r.camera_model, lens: r.lens,
    lat: r.lat, lon: r.lon, isLive: r.is_live,
    liveVideoBytes: r.live_video_bytes === null ? null : Number(r.live_video_bytes),
    isFavorite: r.is_favorite,
  };
}

async function withUrls(r: AssetRow): Promise<AssetListItem> {
  return {
    ...toAssetListItemRow(r),
    thumbUrl: await signedUrl(r.thumb_key, { expiresIn: DERIV_TTL }),
    posterUrl: r.poster_key ? await signedUrl(r.poster_key, { expiresIn: DERIV_TTL }) : null,
    liveVideoUrl: r.live_video_key
      ? await signedUrl(r.live_video_key, { expiresIn: 3600, downloadName: r.filename.replace(/\.[^.]+$/, "") + ".mov" })
      : null,
  };
}

export async function albumRoutes(app: FastifyInstance): Promise<void> {
  // ---------- listar álbumes (con portada y recuento) ----------
  app.get("/v1/albums", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const rows = (
      await query<AlbumRow>(
        `select al.id, al.name, al.created_at,
           (select count(*) from album_assets aa where aa.album_id = al.id) as count,
           (select a.thumb_key from album_assets aa join assets a on a.id = aa.asset_id
              where aa.album_id = al.id and a.deleted_at is null
              order by a.captured_at desc limit 1) as cover_key
         from albums al where al.user_id = $1 order by al.created_at desc`,
        [userId],
      )
    ).rows;

    const albums = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at.toISOString(),
        count: Number(r.count),
        coverUrl: r.cover_key ? await signedUrl(r.cover_key, { expiresIn: DERIV_TTL }) : null,
      })),
    );
    return { albums };
  });

  // ---------- crear álbum ----------
  app.post("/v1/albums", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const name = cleanName((req.body as { name?: unknown } | undefined)?.name);
    if (!name) return reply.code(400).send({ error: "el nombre del álbum no puede estar vacío" });
    const r = await one<{ id: string; name: string; created_at: Date }>(
      "insert into albums (user_id, name) values ($1, $2) returning id, name, created_at",
      [userId, name],
    );
    return reply.code(201).send({ id: r!.id, name: r!.name, createdAt: r!.created_at.toISOString() });
  });

  // ---------- renombrar álbum ----------
  app.patch("/v1/albums/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const name = cleanName((req.body as { name?: unknown } | undefined)?.name);
    if (!name) return reply.code(400).send({ error: "el nombre del álbum no puede estar vacío" });
    const r = await one<{ id: string; name: string }>(
      "update albums set name = $1 where id = $2 and user_id = $3 returning id, name",
      [name, id, userId],
    );
    if (!r) return reply.code(404).send({ error: "no existe" });
    return { id: r.id, name: r.name };
  });

  // ---------- borrar álbum (la cascada limpia album_assets; assets no se toca) ----------
  app.delete("/v1/albums/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const r = await query("delete from albums where id = $1 and user_id = $2", [id, userId]);
    if (r.rowCount === 0) return reply.code(404).send({ error: "no existe" });
    return reply.code(204).send();
  });

  // ---------- añadir assets a un álbum ----------
  app.post("/v1/albums/:id/assets", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });

    const body = (req.body as { ids?: unknown } | undefined) ?? {};
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    if (rawIds.length > 500) return reply.code(400).send({ error: "como máximo 500 ids por llamada" });
    const ids = rawIds.filter((x): x is string => typeof x === "string" && ES_UUID.test(x));
    if (!ids.length) return { added: 0 };

    const album = await one<{ id: string }>("select id from albums where id = $1 and user_id = $2", [id, userId]);
    if (!album) return reply.code(404).send({ error: "no existe" });

    // Solo assets del propio usuario y no borrados — defensa en profundidad
    // (en esta app single-tenant-por-cuenta un id ajeno no debería colarse
    // nunca, pero no cuesta nada comprobarlo aquí también).
    const r = await query(
      `insert into album_assets (album_id, asset_id)
         select $1, a.id from assets a
         where a.id = any($2::uuid[]) and a.user_id = $3 and a.deleted_at is null
       on conflict do nothing`,
      [id, ids, userId],
    );
    return { added: r.rowCount ?? 0 };
  });

  // ---------- quitar un asset de un álbum ----------
  app.delete("/v1/albums/:id/assets/:assetId", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id, assetId } = req.params as { id: string; assetId: string };
    if (!ES_UUID.test(id) || !ES_UUID.test(assetId)) return reply.code(404).send({ error: "no existe" });

    const album = await one<{ id: string }>("select id from albums where id = $1 and user_id = $2", [id, userId]);
    if (!album) return reply.code(404).send({ error: "no existe" });

    await query("delete from album_assets where album_id = $1 and asset_id = $2", [id, assetId]);
    return reply.code(204).send();
  });

  // ---------- listar el contenido de un álbum (paginado, MISMO shape que GET /v1/assets) ----------
  app.get("/v1/albums/:id/assets", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });

    const album = await one<{ id: string }>("select id from albums where id = $1 and user_id = $2", [id, userId]);
    if (!album) return reply.code(404).send({ error: "no existe" });

    const q = req.query as { limit?: string; cursor?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 80, 1), 500);
    const params: unknown[] = [userId, id];
    let sql = `select ${A} from assets a
                 join album_assets aa on aa.asset_id = a.id and aa.album_id = $2
                 where a.user_id = $1 and a.deleted_at is null`;

    if (typeof q.cursor === "string" && q.cursor) {
      const [ts, cid] = Buffer.from(q.cursor, "base64url").toString("utf8").split("|");
      if (!ts || !cid || !ES_UUID.test(cid) || Number.isNaN(Date.parse(ts))) {
        return reply.code(400).send({ error: "cursor inválido" });
      }
      params.push(ts, cid);
      sql += ` and (a.captured_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    sql += ` order by a.captured_at desc, a.id desc limit $${params.length}`;

    const res = await query<AssetRow>(sql, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map(withUrls));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.captured_at.toISOString()}|${last.id}`, "utf8").toString("base64url")
        : null;

    return { items, nextCursor };
  });
}
