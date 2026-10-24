"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Album, AssetDetail } from "@upscale/shared";
import FotoPicker from "./FotoPicker";
import InstallDialog from "./InstallDialog";
import { api, ErrorWidgets, TALLAS, TIPOS, type ConfigWidget, type Rotacion, type Talla, type TipoWidget, type Widget } from "@/lib/widgets";
import { api as apiNotas, type NoteListItem, type NoteListResponse } from "@/lib/notes";

const ROTACIONES: [Rotacion, string][] = [
  ["fija", "Siempre la misma"],
  ["dia", "Cambia cada día"],
  ["hora", "Cambia cada hora"],
  ["vez", "Cambia cada vez"],
];

function Seg<T extends string | number>({ label, value, opciones, onChange }: { label: string; value: T | undefined; opciones: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="sp-seg" role="group" aria-label={label}>
      {opciones.map(([v, t]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** Constructor: tipo → contenido → aspecto, con vista previa en vivo. `id === "nuevo"` crea; si no, edita. */
export default function WidgetBuilder({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const nuevo = id === "nuevo";

  const [existente, setExistente] = useState<Widget | null>(null);
  const [cargado, setCargado] = useState(nuevo);
  const [fallo, setFallo] = useState(false);
  const [kind, setKind] = useState<TipoWidget | null>(() => {
    const t = sp.get("tipo");
    return TIPOS.some((x) => x.id === t) ? (t as TipoWidget) : null;
  });
  const [config, setConfig] = useState<ConfigWidget>(() => {
    const c: ConfigWidget = {};
    if (sp.get("nota")) c.noteId = sp.get("nota")!;
    if (sp.get("album")) c.albumId = sp.get("album")!;
    return c;
  });
  const [nombre, setNombre] = useState("");
  const [talla, setTalla] = useState<Talla>("medium");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [instalar, setInstalar] = useState<Widget | null>(null);
  const [albumes, setAlbumes] = useState<Album[] | null>(null);
  const [notas, setNotas] = useState<NoteListItem[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // editar: cargar el widget
  useEffect(() => {
    if (nuevo) return;
    api<{ items: Widget[] }>("")
      .then((r) => {
        const w = r.items.find((x) => x.id === id);
        if (!w) return setFallo(true);
        setExistente(w);
        setKind(w.kind);
        setConfig(w.config);
        setNombre(w.name);
        setCargado(true);
      })
      .catch(() => setFallo(true));
  }, [id, nuevo]);

  // listas para elegir (álbumes y notas) solo cuando hacen falta
  const necesitaAlbumes = kind === "album" || (kind === "coleccion" && config.origen === "album");
  useEffect(() => {
    if (!necesitaAlbumes || albumes) return;
    fetch("/api/albums", { cache: "no-store" }).then((r) => r.json()).then((d: { albums?: Album[] }) => setAlbumes(d.albums ?? [])).catch(() => setAlbumes([]));
  }, [necesitaAlbumes, albumes]);
  useEffect(() => {
    if (kind !== "nota" || notas) return;
    apiNotas<NoteListResponse>("?view=active").then((r) => setNotas(r.items)).catch(() => setNotas([]));
  }, [kind, notas]);

  // miniaturas de las fotos elegidas que aún no se conocen
  useEffect(() => {
    const faltan = (config.assetIds ?? []).filter((i) => !thumbs[i]).slice(0, 30);
    if (!faltan.length) return;
    let vivo = true;
    Promise.all(faltan.map((i) => fetch(`/api/assets/${i}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<AssetDetail>) : null)).catch(() => null))).then((rs) => {
      if (!vivo) return;
      setThumbs((t) => ({ ...t, ...Object.fromEntries(rs.filter((a): a is AssetDetail => !!a).map((a) => [a.id, a.thumbUrl])) }));
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.assetIds]);

  const set = useCallback((p: Partial<ConfigWidget>) => setConfig((c) => ({ ...c, ...p })), []);

  function elegirTipo(t: TipoWidget) {
    setKind(t);
    setConfig(t === "coleccion" ? { origen: "recientes", celdas: 4, rotar: "dia", hueco: 6 } : t === "recuerdos" ? { rotar: "dia" } : t === "nota" ? { mostrarTitulo: true, noteId: sp.get("nota") ?? undefined } : t === "album" ? { mostrarNombre: true, rotar: "fija", albumId: sp.get("album") ?? undefined } : {});
    setError(null);
  }

  /** ¿ya hay lo mínimo para dibujar? */
  const listo = useMemo(() => {
    if (!kind) return false;
    if (kind === "foto") return (config.assetIds?.length ?? 0) >= 1;
    if (kind === "coleccion") return config.origen === "seleccion" ? (config.assetIds?.length ?? 0) >= 2 : config.origen === "album" ? !!config.albumId : true;
    if (kind === "album") return !!config.albumId;
    if (kind === "nota") return !!config.noteId;
    return true;
  }, [kind, config]);

  // vista previa en vivo (con pausa para no pedir en cada pulsación)
  const [vista, setVista] = useState<string | null>(null);
  const [vistaError, setVistaError] = useState<string | null>(null);
  const [pintando, setPintando] = useState(false);
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    if (!kind || !listo) {
      setVista(null);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      setPintando(true);
      try {
        const r = await fetch(`/api/widgets/preview?s=${talla}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, config }),
          signal: ac.signal,
        });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo dibujar");
        const url = URL.createObjectURL(await r.blob());
        if (anterior.current) URL.revokeObjectURL(anterior.current);
        anterior.current = url;
        setVista(url);
        setVistaError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setVistaError((e as Error).message);
      } finally {
        setPintando(false);
      }
    }, 350);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [kind, config, listo, talla]);
  useEffect(() => () => void (anterior.current && URL.revokeObjectURL(anterior.current)), []);

  async function guardar(poner: boolean) {
    if (!kind || !listo || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const w = existente
        ? await api<Widget>(`/${existente.id}`, { method: "PATCH", json: { name: nombre || undefined, config } })
        : await api<Widget>("", { method: "POST", json: { kind, config, name: nombre || undefined } });
      if (poner) {
        setExistente(w);
        setInstalar(w);
        // la dirección pasa a ser la del widget guardado sin recargar la pantalla (así no se pierde el diálogo)
        if (!existente) window.history.replaceState(null, "", `/app/widgets/${w.id}`);
      } else {
        router.push("/app/widgets");
      }
    } catch (e) {
      setError(e instanceof ErrorWidgets ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (fallo)
    return (
      <div className="app notes">
        <div className="empty" role="alert">
          <h3>Ese widget no existe</h3>
          <Link className="btn primary" href="/app/widgets">Volver a Widgets</Link>
        </div>
      </div>
    );
  if (!cargado) return <div className="app notes" aria-busy="true"><div className="ned-skel" /></div>;

  const tallaDef = TALLAS.find((t) => t.id === talla)!;
  const albumElegido = albumes?.find((a) => a.id === config.albumId);

  return (
    <div className="app notes wb">
      <div className="ned-top">
        <Link href="/app/widgets" className="btn ghost sm">← Widgets</Link>
        <h1 className="wb-h1">{existente ? "Editar widget" : "Nuevo widget"}</h1>
      </div>

      <div className="wb-grid">
        <div className="wb-form">
          {!existente && (
            <section aria-labelledby="wb-1">
              <h2 id="wb-1">1 · ¿Qué quieres ver?</h2>
              <div className="wb-tipos" role="radiogroup" aria-label="Tipo de widget">
                {TIPOS.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={kind === t.id} className={`wb-tipo${kind === t.id ? " on" : ""}`} onClick={() => elegirTipo(t.id)}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icono} /></svg>
                    <b>{t.titulo}</b>
                    <span>{t.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {kind && (
            <section aria-labelledby="wb-2">
              <h2 id="wb-2">{existente ? "Contenido" : "2 · Contenido"}</h2>

              {(kind === "foto" || (kind === "coleccion" && config.origen === "seleccion")) && (
                <div className="wb-bloque">
                  <div className="wb-fotos">
                    {(config.assetIds ?? []).map((i) => (
                      <span key={i} className="wb-foto">
                        {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <i aria-hidden="true" />}
                        <button type="button" aria-label="Quitar esta foto" onClick={() => set({ assetIds: (config.assetIds ?? []).filter((x) => x !== i) })}>✕</button>
                      </span>
                    ))}
                    <button type="button" className="wb-add" onClick={() => setPicker(true)}>
                      <b>+</b>
                      <span>{(config.assetIds?.length ?? 0) ? "Cambiar fotos" : "Elegir de mi biblioteca"}</span>
                    </button>
                  </div>
                  {kind === "foto" && (config.assetIds?.length ?? 0) > 1 && (
                    <label className="wb-campo"><span>Rotación</span><Seg label="Rotación" value={config.rotar} opciones={ROTACIONES} onChange={(v) => set({ rotar: v })} /></label>
                  )}
                </div>
              )}

              {kind === "coleccion" && (
                <div className="wb-bloque">
                  <label className="wb-campo">
                    <span>¿De dónde salen las fotos?</span>
                    <Seg
                      label="Origen"
                      value={config.origen}
                      opciones={[["recientes", "Mis últimas"], ["favoritas", "Favoritas"], ["album", "De un álbum"], ["seleccion", "Las que yo elija"]]}
                      onChange={(v) => set({ origen: v, rotar: v === "seleccion" ? "fija" : config.rotar === "fija" ? "dia" : config.rotar })}
                    />
                  </label>
                  <label className="wb-campo"><span>Fotos en el mosaico</span><Seg label="Celdas" value={config.celdas} opciones={[[2, "2"], [4, "4"], [6, "6"], [9, "9"]]} onChange={(v) => set({ celdas: v })} /></label>
                  {config.origen !== "seleccion" && <label className="wb-campo"><span>Rotación</span><Seg label="Rotación" value={config.rotar} opciones={ROTACIONES} onChange={(v) => set({ rotar: v })} /></label>}
                  <label className="wb-campo sp-range"><span>Separación <b>{config.hueco ?? 6}</b></span><input type="range" min={0} max={24} value={config.hueco ?? 6} onChange={(e) => set({ hueco: Number(e.target.value) })} /></label>
                </div>
              )}

              {necesitaAlbumes && (
                <div className="wb-bloque">
                  <span className="wb-etq">Álbum</span>
                  {albumes === null ? (
                    <p className="nocr-wait"><span className="nspin" aria-hidden="true" /> Cargando álbumes…</p>
                  ) : albumes.length === 0 ? (
                    <p className="natt-hint">Todavía no tienes álbumes. Crea uno desde la biblioteca.</p>
                  ) : (
                    <ul className="wb-lista" role="radiogroup" aria-label="Álbum">
                      {albumes.map((a) => (
                        <li key={a.id}>
                          <button type="button" role="radio" aria-checked={config.albumId === a.id} className={config.albumId === a.id ? "on" : ""} onClick={() => set({ albumId: a.id })}>
                            {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <i aria-hidden="true" />}
                            <b>{a.name}</b>
                            <span>{a.count.toLocaleString("es-ES")} {a.count === 1 ? "elemento" : "elementos"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {kind === "album" && (
                    <>
                      <label className="wb-check"><input type="checkbox" checked={config.mostrarNombre !== false} onChange={(e) => set({ mostrarNombre: e.target.checked })} /> Mostrar el nombre del álbum</label>
                      <label className="wb-campo"><span>Portada</span><Seg label="Portada" value={config.rotar} opciones={ROTACIONES} onChange={(v) => set({ rotar: v })} /></label>
                    </>
                  )}
                </div>
              )}

              {kind === "nota" && (
                <div className="wb-bloque">
                  <span className="wb-etq">Nota</span>
                  {notas === null ? (
                    <p className="nocr-wait"><span className="nspin" aria-hidden="true" /> Cargando notas…</p>
                  ) : notas.length === 0 ? (
                    <p className="natt-hint">Todavía no tienes notas. <Link href="/app/notas">Crea una</Link> y vuelve.</p>
                  ) : (
                    <ul className="wb-lista wb-notas" role="radiogroup" aria-label="Nota">
                      {notas.map((n) => (
                        <li key={n.id}>
                          <button type="button" role="radio" aria-checked={config.noteId === n.id} className={config.noteId === n.id ? "on" : ""} onClick={() => set({ noteId: n.id })}>
                            <b>{n.title.trim() || "Sin título"}</b>
                            <span>{n.preview || "Nota vacía"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="wb-check"><input type="checkbox" checked={config.mostrarTitulo !== false} onChange={(e) => set({ mostrarTitulo: e.target.checked })} /> Mostrar el título</label>
                  <p className="natt-hint">El widget usa el color, el recuadro y la letra de la nota. Si la cambias, el widget se actualiza solo.</p>
                </div>
              )}

              {kind === "recuerdos" && (
                <div className="wb-bloque">
                  <p className="natt-hint">Fotos que hiciste este mismo día en años anteriores («Hace 2 años»). Si hoy no hay ninguna, enseña una foto cualquiera.</p>
                  <label className="wb-campo"><span>Rotación</span><Seg label="Rotación" value={config.rotar} opciones={ROTACIONES} onChange={(v) => set({ rotar: v })} /></label>
                </div>
              )}

              {kind === "espacio" && <p className="natt-hint">Muestra cuánto espacio llevas usado y cuántas fotos, vídeos, audios y notas tienes. Se actualiza solo.</p>}
            </section>
          )}

          {kind && (
            <section aria-labelledby="wb-3">
              <h2 id="wb-3">{existente ? "Aspecto" : "3 · Aspecto"}</h2>
              <div className="wb-bloque">
                {kind === "foto" && (
                  <label className="wb-campo"><span>Marco</span><Seg label="Marco" value={config.marco ?? "sin"} opciones={[["sin", "Sin marco"], ["fino", "Borde blanco"], ["polaroid", "Polaroid"]]} onChange={(v) => set({ marco: v })} /></label>
                )}
                <label className="wb-campo sp-range"><span>Esquinas redondeadas <b>{config.esquinas ?? 0}</b></span><input type="range" min={0} max={60} value={config.esquinas ?? 0} onChange={(e) => set({ esquinas: Number(e.target.value) })} /></label>
                <label className="wb-campo"><span>Nombre del widget</span><input className="wb-nombre" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Por ejemplo: Mi perro" /></label>
              </div>
            </section>
          )}

          {error && <p className="sp-warn" role="alert">{error}</p>}
          <div className="wb-acts">
            <button type="button" className="btn primary" disabled={!listo || guardando} onClick={() => guardar(true)}>
              {guardando ? "Guardando…" : "Guardar y ponerlo en mi pantalla"}
            </button>
            <button type="button" className="btn ghost" disabled={!listo || guardando} onClick={() => guardar(false)}>Guardar</button>
          </div>
        </div>

        <aside className="wb-prev" aria-label="Vista previa">
          <h2>Vista previa</h2>
          <Seg label="Tamaño de la vista previa" value={talla} opciones={TALLAS.map((t) => [t.id, t.nombre] as [Talla, string])} onChange={setTalla} />
          <div className="wb-lienzo" style={{ aspectRatio: `${tallaDef.w} / ${tallaDef.h}` }} aria-busy={pintando}>
            {vista && listo ? <img src={vista} alt="Así se verá el widget" /> : <p>{kind ? "Completa el contenido para verlo aquí." : "Elige un tipo de widget."}</p>}
            {pintando && <span className="wb-pinta nspin" aria-hidden="true" />}
          </div>
          {vistaError && <p className="sp-warn" role="alert">{vistaError}</p>}
          <p className="natt-hint">En tu pantalla se verá igual, con el tamaño que elija tu móvil.</p>
        </aside>
      </div>

      {picker && (
        <FotoPicker
          inicial={config.assetIds ?? []}
          max={kind === "foto" ? 30 : 30}
          min={kind === "coleccion" ? 2 : 1}
          onClose={() => setPicker(false)}
          onListo={(ids, mini) => {
            set({ assetIds: ids, rotar: kind === "foto" ? (ids.length > 1 ? (config.rotar && config.rotar !== "fija" ? config.rotar : "dia") : "fija") : config.rotar });
            setThumbs((t) => ({ ...t, ...mini }));
            setPicker(false);
          }}
        />
      )}
      {instalar && <InstallDialog widget={instalar} onClose={() => { setInstalar(null); router.push("/app/widgets"); }} />}
    </div>
  );
}
