/**
 * Perfil de usuario. Vive en `user_metadata` de Supabase (sin tablas nuevas ni
 * cambios en la API). OJO: ese objeto viaja dentro del JWT en cada petición, así
 * que aquí solo se guarda lo MÍNIMO: nada de imágenes en base64.
 */

export type AvatarStyle = "gradient" | "emoji" | "photo";

export interface AvatarPref {
  style: AvatarStyle;
  /** índice de AVATAR_GRADIENTS */
  g: number;
  /** emoji (style = emoji) */
  e?: string;
  /** id de un asset de la biblioteca (style = photo) */
  a?: string;
}

export interface Profile {
  name: string;
  bio: string;
  avatar: AvatarPref;
  email: string;
  initials: string;
}

export const NAME_MAX = 40;
export const BIO_MAX = 160;

export const AVATAR_GRADIENTS: [string, string][] = [
  ["#7adcec", "#2f5aa8"],
  ["#ffe3a8", "#ff8a65"],
  ["#c3a6ff", "#5b6cff"],
  ["#9af0c4", "#1f9d8a"],
  ["#ffb3d1", "#a259ff"],
  ["#ffd08a", "#e5484d"],
  ["#a8e6ff", "#6c8cff"],
  ["#d6f59a", "#34a46a"],
  ["#ffc7a8", "#d6548a"],
  ["#b8c4ff", "#3b4a9c"],
  ["#8ef0e0", "#3f7bd9"],
  ["#f3d9ff", "#8b5cf6"],
];

export const AVATAR_EMOJIS = [
  "🎣", "🐟", "🌊", "⛵", "🏝️", "🌅", "🏔️", "🌲",
  "📸", "🎞️", "✨", "🔥", "🌙", "☀️", "🦊", "🐙",
  "🦋", "🌸", "🍀", "🚀", "🎧", "🎨", "⚡", "💎",
];

export const DEFAULT_AVATAR: AvatarPref = { style: "gradient", g: 0 };

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

export function initialsOf(name: string, email: string): string {
  const base = name.trim() || email.split("@")[0] || "?";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const out = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : base.slice(0, 2);
  return out.toUpperCase();
}

/** Lee el perfil de un usuario de Supabase, tolerando metadatos ausentes o raros. */
export function profileOf(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): Profile {
  const m = (user.user_metadata ?? {}) as Record<string, unknown>;
  const email = user.email ?? "";
  const name = String(m.display_name ?? m.full_name ?? m.name ?? "").slice(0, NAME_MAX);
  const bio = String(m.bio ?? "").slice(0, BIO_MAX);
  const raw = (m.avatar ?? null) as Partial<AvatarPref> | null;
  const style: AvatarStyle = raw?.style === "emoji" || raw?.style === "photo" ? raw.style : "gradient";
  const avatar: AvatarPref = {
    style,
    g: clamp(raw?.g, 0, AVATAR_GRADIENTS.length - 1, 0),
    e: typeof raw?.e === "string" ? raw.e.slice(0, 8) : undefined,
    a: typeof raw?.a === "string" && /^[0-9a-f-]{36}$/i.test(raw.a) ? raw.a : undefined,
  };
  return { name, bio, avatar, email, initials: initialsOf(name, email) };
}

/** Fondo CSS del avatar según su degradado. */
export function gradientCss(g: number): string {
  const [a, b] = AVATAR_GRADIENTS[clamp(g, 0, AVATAR_GRADIENTS.length - 1, 0)]!;
  return `radial-gradient(circle at 32% 28%, ${a}, ${b} 78%)`;
}
