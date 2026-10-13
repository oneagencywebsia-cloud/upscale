/**
 * Catálogo de planes — ÚNICA fuente de verdad en la API (cuotas, tamaño máximo
 * por archivo). La portada y la página del plan en la web tienen una copia de
 * los números para pintarlos (apps/web/lib/plans.ts): si se cambia aquí, cambiar
 * allí. Los precios son una propuesta inicial; todavía no hay cobro.
 */
const GB = 1024 ** 3;

export type PlanId = "free" | "plus" | "pro" | "max";

export interface Plan {
  id: PlanId;
  name: string;
  /** espacio incluido */
  bytes: number;
  /** tamaño máximo de UN archivo */
  maxFileBytes: number;
  /** €/mes (0 = gratis) */
  priceMonthEur: number;
  /** orden: un plan mayor reemplaza a uno menor al canjear un código */
  rank: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Gratis", bytes: 5 * GB, maxFileBytes: 2 * GB, priceMonthEur: 0, rank: 0 },
  plus: { id: "plus", name: "Plus", bytes: 100 * GB, maxFileBytes: 10 * GB, priceMonthEur: 1.99, rank: 1 },
  pro: { id: "pro", name: "Pro", bytes: 500 * GB, maxFileBytes: 50 * GB, priceMonthEur: 4.99, rank: 2 },
  max: { id: "max", name: "Max", bytes: 2048 * GB, maxFileBytes: 200 * GB, priceMonthEur: 12.99, rank: 3 },
};

export const PLAN_LIST: Plan[] = Object.values(PLANS).sort((a, b) => a.rank - b.rank);

export function esPlan(v: unknown): v is PlanId {
  return typeof v === "string" && v in PLANS;
}

/** Invita y gana: la persona invitada y quien la invitó reciben espacio extra
 *  cuando la invitada guarda su primer archivo. */
export const REFERRAL_BONUS_INVITED = 1 * GB;
export const REFERRAL_BONUS_INVITER = 2 * GB;
/** Tope de invitaciones que dan premio (+20 GB como máximo por persona). */
export const REFERRAL_MAX_REWARDED = 10;
