"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import ThemeToggle from "./ThemeToggle";
import Segmented from "./Segmented";
import Uploader from "./Uploader";

const MotionLink = motion.create(Link);

export default function TopBar({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const initials = email.slice(0, 2).toUpperCase();

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="bar">
      <Link href="/app" className="brand">
        <h1>
          <span className="wm-up">up</span>scale
        </h1>
      </Link>

      <Segmented />

      <nav className="topnav">
        <MotionLink href="/app/espacio" aria-current={pathname === "/app/espacio"} whileTap={{ scale: 0.9 }} whileHover={{ y: -1 }}>Espacio</MotionLink>
        <MotionLink href="/app/ajustes" aria-current={pathname === "/app/ajustes"} whileTap={{ scale: 0.9 }} whileHover={{ y: -1 }}>Ajustes</MotionLink>
      </nav>

      <div className="spacer" aria-hidden="true" />

      <Uploader onDone={() => router.refresh()} />

      <ThemeToggle />

      <button className="avatar" type="button" title={`${email} · cerrar sesión`} onClick={logout}>
        {initials}
      </button>
    </header>
  );
}
