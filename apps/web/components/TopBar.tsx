"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile } from "@/lib/profile";
import Avatar from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import Segmented from "./Segmented";
import Uploader from "./Uploader";
import { useCoverNav } from "./CoverTransition";

const MotionLink = motion.create(Link);

export default function TopBar({ profile, photoUrl }: { profile: Profile; photoUrl: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const coverNav = useCoverNav();
  const [menu, setMenu] = useState(false);

  // el menú se cierra al tocar fuera, con Escape o al cambiar de pantalla
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function navClick(href: string, isActive: boolean) {
    return (e: React.MouseEvent) => {
      setMenu(false);
      if (isActive || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      coverNav(href, { x: e.clientX, y: e.clientY });
    };
  }

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }

  const nav = [
    { href: "/app/albumes", label: "Álbumes", on: pathname.startsWith("/app/albumes") },
    { href: "/app/espacio", label: "Espacio", on: pathname === "/app/espacio" },
    { href: "/app/ajustes", label: "Ajustes", on: pathname === "/app/ajustes" },
  ];
  const shown = profile.name || profile.email;

  return (
    <header className="bar">
      <Link href="/app" className="brand">
        <h1>
          <span className="wm-up">up</span>scale
        </h1>
      </Link>

      <Segmented />

      <nav className="topnav">
        {nav.map((n) => (
          <MotionLink
            key={n.href}
            href={n.href}
            aria-current={n.on}
            whileTap={{ scale: 0.9 }}
            whileHover={{ y: -1 }}
            onClick={navClick(n.href, n.on)}
          >
            {n.label}
          </MotionLink>
        ))}
      </nav>

      <div className="spacer" aria-hidden="true" />

      <Uploader onDone={() => router.refresh()} />

      <ThemeToggle />

      <div className="usermenu" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className="avatar"
          type="button"
          aria-label="Cuenta"
          aria-haspopup="menu"
          aria-expanded={menu}
          title={shown}
          onClick={() => setMenu((v) => !v)}
        >
          <Avatar profile={profile} photoUrl={photoUrl} size={38} />
        </button>
        {menu && (
          <motion.div
            className="gt-dropdown usermenu-drop"
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.14 }}
          >
            <div className="usermenu-who">
              <b>{profile.name || "Tu cuenta"}</b>
              <span>{profile.email}</span>
            </div>
            <Link role="menuitem" href="/app/perfil" onClick={navClick("/app/perfil", pathname === "/app/perfil")}>
              Mi perfil
            </Link>
            <Link role="menuitem" href="/app/ajustes" onClick={navClick("/app/ajustes", pathname === "/app/ajustes")}>
              Ajustes de subida
            </Link>
            <button role="menuitem" type="button" onClick={logout}>
              Cerrar sesión
            </button>
          </motion.div>
        )}
      </div>
    </header>
  );
}
