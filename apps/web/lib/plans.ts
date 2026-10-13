/**
 * Copia de los planes para PINTARLOS (portada y página del plan). La verdad que
 * se aplica (cuotas, tamaño máximo por archivo) está en apps/api/src/plans.ts:
 * si cambias un número allí, cámbialo aquí. Precios = propuesta inicial; aún no
 * hay cobro, los planes de pago se activan con un código o por lista de espera.
 */
const GB = 1024 ** 3;

export type PlanId = "free" | "plus" | "pro" | "max";

export interface PlanCopy {
  id: PlanId;
  name: string;
  /** frase de una línea: para quién es */
  tagline: string;
  bytes: number;
  maxFileBytes: number;
  priceMonthEur: number;
  /** viñetas MUY cortas */
  perks: string[];
  /** el que se destaca (efecto de anclaje: el medio parece el sensato) */
  highlight?: boolean;
}

export const PLANS: PlanCopy[] = [
  {
    id: "free",
    name: "Gratis",
    tagline: "Para probar sin riesgo",
    bytes: 5 * GB,
    maxFileBytes: 2 * GB,
    priceMonthEur: 0,
    perks: ["5 GB para empezar", "Fotos, vídeos y audio", "Sin tarjeta"],
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "Tu carrete de cada día",
    bytes: 100 * GB,
    maxFileBytes: 10 * GB,
    priceMonthEur: 1.99,
    perks: ["100 GB", "Archivos de hasta 10 GB", "Todo en original"],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Para toda la familia",
    bytes: 500 * GB,
    maxFileBytes: 50 * GB,
    priceMonthEur: 4.99,
    perks: ["500 GB", "Vídeos 4K sin límite práctico", "Archivos de hasta 50 GB"],
    highlight: true,
  },
  {
    id: "max",
    name: "Max",
    tagline: "Guardarlo absolutamente todo",
    bytes: 2048 * GB,
    maxFileBytes: 200 * GB,
    priceMonthEur: 12.99,
    perks: ["2 TB", "Archivos de hasta 200 GB", "Prioridad en las subidas"],
  },
];

/** «5 GB», «2 TB», «1,5 GB» */
export function gbHuman(bytes: number): string {
  const gb = bytes / GB;
  if (gb >= 1024) return `${(gb / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} TB`;
  return `${gb.toLocaleString("es-ES", { maximumFractionDigits: gb < 10 ? 1 : 0 })} GB`;
}

export function priceHuman(eur: number): string {
  return eur === 0 ? "0 €" : `${eur.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`;
}

/** Invita y gana (copia para pintar; la verdad está en apps/api/src/plans.ts). */
export const REFERRAL = {
  invitedBonusBytes: 1 * GB,
  inviterBonusBytes: 2 * GB,
  maxRewarded: 10,
} as const;
