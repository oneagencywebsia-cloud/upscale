"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "motion/react";

const FILTERS = [
  { key: "all", label: "Todo", href: "/app" },
  { key: "photo", label: "Fotos", href: "/app?kind=photo" },
  { key: "video", label: "Vídeos", href: "/app?kind=video" },
  { key: "fav", label: "★", href: "/app?fav=1" },
];

export default function Segmented() {
  const pathname = usePathname();
  const sp = useSearchParams();
  if (pathname !== "/app") return null;

  const active = sp.get("fav") === "1" ? "fav" : sp.get("kind") ?? "all";

  return (
    <div className="seg" role="group" aria-label="Filtrar biblioteca">
      {FILTERS.map((f) => (
        <Link key={f.key} href={f.href} role="button" aria-pressed={active === f.key}>
          {active === f.key && (
            <motion.span
              layoutId="seg-pill"
              className="seg-pill"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          <span className="seg-label">{f.label}</span>
        </Link>
      ))}
    </div>
  );
}
