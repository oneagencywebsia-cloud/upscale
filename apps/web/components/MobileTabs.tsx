"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const I = {
  lib: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m3 17 5-4 4 3 3-2 6 4" />
    </svg>
  ),
  fav: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17.3 6.2 20l1.1-6.3L2.5 9.2l6.4-.9L12 2.5l3.1 5.8 6.4.9-4.8 4.5L17.8 20z" />
    </svg>
  ),
  space: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  ),
  gear: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 2h-4l-.6 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 22h4l.6-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </svg>
  ),
};

export default function MobileTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const onFav = pathname === "/app" && sp.get("fav") === "1";
  const onLib = pathname === "/app" && !onFav;

  const tabs = [
    { href: "/app", label: "Biblioteca", icon: I.lib, active: onLib },
    { href: "/app?fav=1", label: "Favoritos", icon: I.fav, active: onFav },
    { href: "/app/espacio", label: "Espacio", icon: I.space, active: pathname === "/app/espacio" },
    { href: "/app/ajustes", label: "Ajustes", icon: I.gear, active: pathname === "/app/ajustes" },
  ];

  return (
    <nav className="mtabs" aria-label="Navegación">
      {tabs.map((t) => (
        <Link key={t.label} href={t.href} className={t.active ? "on" : ""} aria-current={t.active}>
          {t.icon}
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
