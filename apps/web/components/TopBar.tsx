"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import ThemeToggle from "./ThemeToggle";

const FILTERS = [
  { key: "all", label: "Todo", href: "/app" },
  { key: "photo", label: "Fotos", href: "/app?kind=photo" },
  { key: "video", label: "Vídeos", href: "/app?kind=video" },
];

export default function TopBar({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const initials = email.slice(0, 2).toUpperCase();
  const inGallery = pathname === "/app";

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        await fetch("/api/upload", { method: "POST", body: fd });
      }
      router.refresh();
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="bar">
      <Link href="/app" className="brand">
        <h1>upscale</h1>
      </Link>

      {inGallery && (
        <div className="seg" role="group" aria-label="Filtrar biblioteca">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.href} role="button">
              {f.label}
            </Link>
          ))}
        </div>
      )}

      <nav className="topnav">
        <Link href="/app/espacio" aria-current={pathname === "/app/espacio"}>
          Espacio
        </Link>
        <Link href="/app/actividad" aria-current={pathname === "/app/actividad"}>
          Actividad
        </Link>
        <Link href="/app/ajustes" aria-current={pathname === "/app/ajustes"}>
          Ajustes
        </Link>
      </nav>

      <div className="spacer" aria-hidden="true" />

      <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={onFiles} />
      <button className="upload" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5m0 0-6 6m6-6 6 6" />
        </svg>
        {busy ? "Subiendo…" : "Subir"}
      </button>

      <ThemeToggle />

      <button className="avatar" type="button" title={`${email} · cerrar sesión`} onClick={logout}>
        {initials}
      </button>
    </header>
  );
}
