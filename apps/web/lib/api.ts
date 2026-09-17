import "server-only";
import { headers } from "next/headers";
import { getAccessToken } from "@/lib/supabase/server";
import type {
  AssetListResponse,
  AssetDetail,
  Me,
  UploadToken,
  StorageInfo,
  AlbumListResponse,
  Album,
  MapPointsResponse,
} from "@upscale/shared";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

export function apiBase() {
  return API;
}

export async function forwardHeadersFrom(): Promise<Record<string, string>> {
  const h = await headers();
  return { "user-agent": h.get("user-agent") ?? "upscale-web" };
}

export function listAssets(params?: {
  cursor?: string;
  kind?: string;
  limit?: number;
  fav?: boolean;
  q?: string;
  camera?: string;
  from?: string;
  to?: string;
}): Promise<AssetListResponse> {
  const q = new URLSearchParams();
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.kind) q.set("kind", params.kind);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.fav) q.set("fav", "1");
  if (params?.q) q.set("q", params.q);
  if (params?.camera) q.set("camera", params.camera);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return req<AssetListResponse>(`/v1/assets${qs ? `?${qs}` : ""}`);
}

export const listCameras = () => req<{ cameras: string[] }>("/v1/assets/cameras");
export const getMapPoints = () => req<MapPointsResponse>("/v1/assets/map");

export const getAsset = (id: string) => req<AssetDetail>(`/v1/assets/${id}`);
export const getStorage = () => req<StorageInfo>("/v1/storage");
export const listTokens = () => req<{ tokens: UploadToken[] }>("/v1/tokens");
export const createToken = (label?: string) =>
  req<{ id: string; token: string }>("/v1/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
export const deleteToken = (id: string) => req<void>(`/v1/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listAlbums = () => req<AlbumListResponse>("/v1/albums");

/** No hay GET /v1/albums/:id dedicado (la lista ya es barata: pocos álbumes
 *  por usuario) — se busca dentro de listAlbums(). */
export async function getAlbum(id: string): Promise<Album | null> {
  const { albums } = await listAlbums();
  return albums.find((a) => a.id === id) ?? null;
}

export function getAlbumAssets(id: string, cursor?: string): Promise<AssetListResponse> {
  const q = new URLSearchParams();
  if (cursor) q.set("cursor", cursor);
  const qs = q.toString();
  return req<AssetListResponse>(`/v1/albums/${id}/assets${qs ? `?${qs}` : ""}`);
}

export async function getMe(): Promise<Me | null> {
  try {
    return await req<Me>("/v1/auth/me");
  } catch {
    return null;
  }
}
