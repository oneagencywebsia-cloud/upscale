"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Mark3D from "@/components/Mark3D";
import InstallDialog from "./InstallDialog";
import { Confirmar } from "@/components/notes/NotesApp";
import { api, ErrorWidgets, NOMBRE_TIPO, type Widget } from "@/lib/widgets";

/** Mis widgets: vista en vivo de cada uno, y de aquí se editan, se ponen en la pantalla o se borran. */
export default function WidgetsApp() {
  const [items, setItems] = useState<Widget[] | null>(null);
  const [max, setMax] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [instalar, setInstalar] = useState<Widget | null>(null);
  const [borrar, setBorrar] = useState<Widget | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [v] = useState(() => Date.now()); // para refrescar las vistas
  const [menu, setMenu] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api<{ items: Widget[]; max: number }>("")
      .then((r) => { setItems(r.items); setMax(r.max); setError(null); })
      .catch((e) => setError(e instanceof ErrorWidgets && e.status === 401 ? "Por seguridad, tienes que entrar otra vez." : "No se pudo cargar. Inténtalo otra vez."));
  }, []);
  useEffect(cargar, [cargar]);

  // cerrar el menú «⋯» al tocar fuera o con Escape
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: Event) => !(e.target as HTMLElement).closest(".wg-menu-wrap") && setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const decir = (t: string) => { setAviso(t); window.setTimeout(() => setAviso(null), 5000); };

  return (
    <div className="app notes">
      <div className="libhead">
        <div>
          <h2>En mi pantalla<span className="lh-flourish" aria-hidden="true" /></h2>
          <p>{items ? (items.length === 1 ? "1 elemento" : `${items.length} elementos`) : " "}</p>
        </div>
        <Link href="/app/widgets/nuevo" className="btn primary wg-nuevo">+ Añadir</Link>
      </div>

      <p className="wg-intro">Pon tus fotos, notas, álbumes o tu espacio en la pantalla de inicio de tu móvil. Elige qué enseñar y Upscale lo mantiene al día solo.</p>

      {error ? (
        <div className="empty" role="alert"><h3>{error}</h3><button type="button" className="btn" onClick={cargar}>Reintentar</button></div>
      ) : items === null ? (
        <ul className="wg-grid" aria-busy="true" aria-label="Cargando widgets">{[0, 1, 2].map((i) => <li key={i} className="wg-card skel" />)}</ul>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-mark" aria-hidden="true"><Mark3D size={104} /></div>
          <h3>Pon tus fotos en tu pantalla</h3>
          <p>Una foto que cambia cada día, un mosaico de tus favoritas, una nota con su color o tus recuerdos de hoy. Tú eliges.</p>
          <Link href="/app/widgets/nuevo" className="btn primary">+ Añadir</Link>
        </div>
      ) : (
        <ul className="wg-grid">
          {items.map((w) => (
            <li key={w.id} className="wg-card">
              <Link href={`/app/widgets/${w.id}`} className="wg-vista" aria-label={`Editar ${w.name}`}>
                <img src={`/api/widgets/${w.id}/image?s=medium&v=${v}-${w.updatedAt}`} alt={`Vista de ${w.name}`} loading="lazy" decoding="async" />
              </Link>
              <div className="wg-pie">
                <div>
                  <b>{w.name}</b>
                  <small>{NOMBRE_TIPO[w.kind]}</small>
                </div>
              </div>
              <div className="wg-acts">
                <button type="button" className="btn primary" onClick={() => setInstalar(w)}>Poner en pantalla</button>
                <Link href={`/app/widgets/${w.id}`} className="btn ghost">Editar</Link>
                <span className="wg-menu-wrap">
                  <button type="button" className="btn ghost wg-mas" aria-label={`Más acciones de ${w.name}`} aria-haspopup="menu" aria-expanded={menu === w.id} onClick={() => setMenu(menu === w.id ? null : w.id)}>⋯</button>
                  {menu === w.id && (
                    <div className="ned-menu wg-menu" role="menu">
                      <button
                        role="menuitem"
                        type="button"
                        onClick={async () => {
                          setMenu(null);
                          try {
                            await api(`/${w.id}/regenerate`, { method: "POST" });
                            cargar();
                            decir("Enlace nuevo creado: el anterior ya no funciona");
                          } catch { decir("No se pudo crear el enlace nuevo"); }
                        }}
                      >
                        Crear un enlace nuevo
                      </button>
                      <button role="menuitem" type="button" className="warn" onClick={() => { setMenu(null); setBorrar(w); }}>Eliminar</button>
                    </div>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items && items.length > 0 && items.length < max && (
        <Link href="/app/widgets/nuevo" className="wg-fab" aria-label="Añadir a mi pantalla">
          <span aria-hidden="true">+</span>
          <b>Añadir a mi pantalla</b>
        </Link>
      )}

      <div className="ntoast-wrap" aria-live="polite">{aviso && <div className="ntoast" role="status"><span>{aviso}</span></div>}</div>
      {instalar && <InstallDialog widget={instalar} onClose={() => setInstalar(null)} />}
      {borrar && (
        <Confirmar
          texto={`«${borrar.name}» se quitará de tu pantalla y su enlace dejará de funcionar. Tus fotos y notas no se tocan.`}
          si="Eliminar"
          onNo={() => setBorrar(null)}
          onSi={async () => {
            const w = borrar;
            setBorrar(null);
            try { await api(`/${w.id}`, { method: "DELETE" }); setItems((p) => p?.filter((x) => x.id !== w.id) ?? p); } catch { decir("No se pudo eliminar"); }
          }}
        />
      )}
    </div>
  );
}
