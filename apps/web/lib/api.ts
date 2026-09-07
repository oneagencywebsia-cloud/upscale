import "server-only";
import { headers } from "next/headers";
import { getAccessToken } from "@/lib/supabase/server";
import type { AssetListResponse, AssetDetail, Me, UploadToken, StorageInfo } from "@upscale/shared";

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

export function listAssets(params?: { cursor?: string; kind?: string; limit?: number; fav?: boolean }): Promise<AssetListResponse> {
  const q = new URLSearchParams();
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.kind) q.set("kind", params.kind);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.fav) q.set("fav", "1");
  const qs = q.toString();
  return req<AssetListResponse>(`/v1/assets${qs ? `?${qs}` : ""}`);
}

export const getAsset = (id: string) => req<AssetDetail>(`/v1/assets/${id}`);
export const getStorage = () => req<StorageInfo>("/v1/storage");
export const listTokens = () => req<{ tokens: UploadToken[] }>("/v1/tokens");
export const createToken = (label?: string) =>
  req<{ token: string }>("/v1/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
export const deleteToken = (token: string) => req<void>(`/v1/tokens/${token}`, { method: "DELETE" });

export async function getMe(): Promise<Me | null> {
  try {
    return await req<Me>("/v1/auth/me");
  } catch {
    return null;
  }
}
