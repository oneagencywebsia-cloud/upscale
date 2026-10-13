import { env } from "./env.js";

/**
 * Tope de subidas SIMULTÁNEAS (una en curso ocupa un hueco hasta que termina).
 *
 * Todo lo que se sube acaba en una única cuenta de Telegram y en el disco de un
 * solo servidor: sin tope, un puñado de personas subiendo a la vez dispara los
 * límites de Telegram (FLOOD_WAIT) y llena TMP_DIR. Al pasarse, la API contesta
 * 429 y la web reintenta sola en unos segundos.
 */
const porUsuario = new Map<string, number>();
let total = 0;

export function cogerHueco(userId: string): (() => void) | null {
  const mios = porUsuario.get(userId) ?? 0;
  if (total >= env.UPLOAD_MAX_CONCURRENT || mios >= env.UPLOAD_MAX_PER_USER) return null;
  porUsuario.set(userId, mios + 1);
  total++;
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    total--;
    const n = (porUsuario.get(userId) ?? 1) - 1;
    if (n <= 0) porUsuario.delete(userId);
    else porUsuario.set(userId, n);
  };
}

export function huecosEnUso(): { total: number; max: number } {
  return { total, max: env.UPLOAD_MAX_CONCURRENT };
}
