"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Mark3D from "@/components/Mark3D";
import NoteCard, { type AccionesNota } from "./NoteCard";
import { api, ErrorApi, type Note, type NoteListItem, type NoteListResponse } from "@/lib/notes";

type Vista = "activas" | "archivadas" | "papelera";
const VISTAS: { id: Vista; label: string; api: string }[] = [
  { id: "activas", label: "Notas", api: "active" },
  { id: "archivadas", label: "Archivadas", api: "archived" },
  { id: "papelera", label: "Papelera", api: "trash" },
];

function contar(n: number, mas: boolean, vista: Vista): string {
  const num = `${n.toLocaleString("es-ES")}${mas ? "+" : ""}`;
  if (vista === "papelera") return `${num} en la papelera`;
  if (vista === "archivadas") return `${num} ${n === 1 && !mas ? "archivada" : "archivadas"}`;
  return `${num} ${n === 1 && !mas ? "nota" : "notas"}`;
}

/** Lista de notas: buscar, etiquetas, fijadas, archivo, papelera (30 días) y vista en rejilla o lista. */
export default function NotesApp() {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>("activas");
  const [q, setQ] = useState("");
  const [consulta, setConsulta] = useState("");
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  const [etiquetas, setEtiquetas] = useState<{ tag: string; count: number }[]>([]);
  const [items, setItems] = useState<NoteListItem[] | null>(null);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [lista, setLista] = useState(false);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; deshacer?: () => void } | null>(null);
  const [confirmar, setConfirmar] = useState<{ texto: string; ok: () => void } | null>(null);
  const reqId = useRef(0);
  const avisoT = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      setLista(localStorage.getItem("notas-lista") === "1");
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setConsulta(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const cargar = useCallback(
    async (cursor?: string) => {
      const mi = ++reqId.current;
      const p = new URLSearchParams({ view: VISTAS.find((v) => v.id === vista)!.api });
      if (consulta) p.set("q", consulta);
      if (etiqueta) p.set("tag", etiqueta);
      if (cursor) p.set("cursor", cursor);
      try {
        const r = await api<NoteListResponse>(`?${p}`);
        if (mi !== reqId.current) return; // llegó tarde: otra búsqueda manda
        setItems((prev) => (cursor && prev ? [...prev, ...r.items] : r.items));
        setSiguiente(r.nextCursor);
        setError(null);
      } catch (e) {
        if (mi !== reqId.current) return;
        setError(e instanceof ErrorApi && e.status === 401 ? "Tu sesión ha caducado. Vuelve a entrar." : "No se pudieron cargar las notas.");
      }
    },
    [vista, consulta, etiqueta],
  );

  const cargarEtiquetas = useCallback(() => {
    api<{ tags: { tag: string; count: number }[] }>("/tags").then((r) => setEtiquetas(r.tags)).catch(() => {});
  }, []);

  useEffect(() => {
    setItems(null);
    void cargar();
  }, [cargar]);
  useEffect(cargarEtiquetas, [cargarEtiquetas]);

  function avisar(texto: string, deshacer?: () => void) {
    window.clearTimeout(avisoT.current);
    setAviso({ texto, deshacer });
    avisoT.current = window.setTimeout(() => setAviso(null), 7000);
  }
  const quitar = (n: NoteListItem) => setItems((p) => p?.filter((x) => x.id !== n.id) ?? p);

  async function crear() {
    if (creando) return;
    setCreando(true);
    try {
      const n = await api<Note>("", { method: "POST", json: {} });
      router.push(`/app/notas/${n.id}?nueva=1`);
    } catch (e) {
      setCreando(false);
      avisar(e instanceof ErrorApi ? e.message : "No se pudo crear la nota");
    }
  }

  const acciones: AccionesNota = useMemo(
    () => ({
      fijar: async (n) => {
        setItems((p) => p?.map((x) => (x.id === n.id ? { ...x, pinned: !n.pinned } : x)) ?? p);
        try {
          await api(`/${n.id}`, { method: "PATCH", json: { pinned: !n.pinned } });
          void cargar();
        } catch {
          avisar("No se pudo fijar la nota");
          void cargar();
        }
      },
      archivar: async (n) => {
        const arch = vista !== "archivadas";
        quitar(n);
        try {
          await api(`/${n.id}`, { method: "PATCH", json: { archived: arch } });
          avisar(arch ? "Nota archivada" : "Nota desarchivada", async () => {
            await api(`/${n.id}`, { method: "PATCH", json: { archived: !arch } }).catch(() => {});
            void cargar();
          });
        } catch {
          avisar("No se pudo archivar");
          void cargar();
        }
      },
      borrar: async (n) => {
        quitar(n);
        try {
          await api(`/${n.id}`, { method: "DELETE" });
          avisar("Nota movida a la papelera", async () => {
            await api(`/${n.id}/restore`, { method: "POST" }).catch(() => {});
            void cargar();
          });
          cargarEtiquetas();
        } catch {
          avisar("No se pudo eliminar");
          void cargar();
        }
      },
      restaurar: async (n) => {
        quitar(n);
        await api(`/${n.id}/restore`, { method: "POST" }).catch(() => avisar("No se pudo restaurar"));
        avisar("Nota restaurada");
        cargarEtiquetas();
      },
      borrarYa: (n) =>
        setConfirmar({
          texto: `«${n.title.trim() || "Sin título"}» se borrará para siempre. No se puede deshacer.`,
          ok: async () => {
            quitar(n);
            await api(`/${n.id}?permanent=1`, { method: "DELETE" }).catch(() => avisar("No se pudo borrar"));
          },
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vista, cargar],
  );

  const fijadas = items?.filter((n) => n.pinned) ?? [];
  const resto = items?.filter((n) => !n.pinned) ?? [];
  const separar = vista === "activas" && fijadas.length > 0;
  const buscando = Boolean(consulta || etiqueta);

  const grupo = (lis: NoteListItem[]) => (
    <ul className={`ngrid${lista ? " list" : ""}`}>
      {lis.map((n) => (
        <NoteCard key={n.id} n={n} vista={vista} a={acciones} lista={lista} />
      ))}
    </ul>
  );

  return (
    <div className="app notes">
      <div className="libhead">
        <div>
          <h2>
            Notas
            <span className="lh-flourish" aria-hidden="true" />
          </h2>
          <p>{items ? contar(items.length, siguiente !== null, vista) : "\u00a0"}</p>
        </div>
        <button type="button" className="btn primary" onClick={crear} disabled={creando}>
          {creando ? "Creando…" : "+ Nueva nota"}
        </button>
      </div>

      <div className="ntools">
        <div className="seg ntabs" role="group" aria-label="Qué notas ver">
          {VISTAS.map((v) => (
            <button key={v.id} type="button" aria-pressed={vista === v.id} onClick={() => setVista(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="nsearch">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en títulos, texto y capturas…"
            aria-label="Buscar notas"
            enterKeyHint="search"
          />
        </div>
        <button
          type="button"
          className="btn ghost sm nview"
          aria-pressed={lista}
          aria-label={lista ? "Ver en rejilla" : "Ver en lista"}
          onClick={() => {
            setLista(!lista);
            try {
              localStorage.setItem("notas-lista", lista ? "0" : "1");
            } catch {
              /* sin almacenamiento */
            }
          }}
        >
          {lista ? "Rejilla" : "Lista"}
        </button>
      </div>

      {etiquetas.length > 0 && vista !== "papelera" && (
        <div className="ntags" role="group" aria-label="Filtrar por etiqueta">
          {etiqueta && (
            <button type="button" className="ntag on" onClick={() => setEtiqueta(null)}>
              ✕ {etiqueta}
            </button>
          )}
          {etiquetas
            .filter((t) => t.tag !== etiqueta)
            .map((t) => (
              <button key={t.tag} type="button" className="ntag" onClick={() => setEtiqueta(t.tag)}>
                {t.tag} <span>{t.count}</span>
              </button>
            ))}
        </div>
      )}

      {vista === "papelera" && items && items.length > 0 && (
        <div className="nbanner">
          <span>Las notas de la papelera se borran solas a los 30 días.</span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              setConfirmar({
                texto: "Se borrarán para siempre todas las notas de la papelera.",
                ok: async () => {
                  await api("/trash", { method: "DELETE" }).catch(() => avisar("No se pudo vaciar"));
                  setItems([]);
                },
              })
            }
          >
            Vaciar papelera
          </button>
        </div>
      )}

      {error ? (
        <div className="empty" role="alert">
          <h3>{error}</h3>
          <button type="button" className="btn" onClick={() => void cargar()}>Reintentar</button>
        </div>
      ) : items === null ? (
        <ul className="ngrid" aria-busy="true" aria-label="Cargando notas">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="ncard skel" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-mark" aria-hidden="true">
            <Mark3D size={104} />
          </div>
          <h3>
            {buscando
              ? "No hay notas que coincidan"
              : vista === "papelera"
                ? "La papelera está vacía"
                : vista === "archivadas"
                  ? "No tienes notas archivadas"
                  : "Escribe tu primera nota"}
          </h3>
          <p>
            {buscando
              ? "Prueba con otra palabra o quita el filtro."
              : vista === "activas"
                ? "Apunta ideas, listas o pega una captura: Upscale lee el texto de la imagen y te lo deja listo para editar."
                : "Aquí aparecerán cuando las muevas."}
          </p>
          {vista === "activas" && !buscando && (
            <button type="button" className="btn primary" onClick={crear} disabled={creando}>
              + Nueva nota
            </button>
          )}
        </div>
      ) : separar ? (
        <>
          <h3 className="nsec">Fijadas</h3>
          {grupo(fijadas)}
          {resto.length > 0 && (
            <>
              <h3 className="nsec">Otras</h3>
              {grupo(resto)}
            </>
          )}
        </>
      ) : (
        grupo(items)
      )}

      {siguiente && !error && (
        <div className="nmore">
          <button
            type="button"
            className="btn ghost"
            disabled={cargandoMas}
            onClick={async () => {
              setCargandoMas(true);
              await cargar(siguiente);
              setCargandoMas(false);
            }}
          >
            {cargandoMas ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      )}

      <div className="ntoast-wrap" aria-live="polite">
        {aviso && (
          <div className="ntoast" role="status">
            <span>{aviso.texto}</span>
            {aviso.deshacer && (
              <button
                type="button"
                onClick={() => {
                  aviso.deshacer?.();
                  setAviso(null);
                }}
              >
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>

      {confirmar && (
        <Confirmar
          texto={confirmar.texto}
          onNo={() => setConfirmar(null)}
          onSi={() => {
            confirmar.ok();
            setConfirmar(null);
          }}
        />
      )}
    </div>
  );
}

export function Confirmar({ texto, onSi, onNo, si = "Borrar" }: { texto: string; onSi: () => void; onNo: () => void; si?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onNo();
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      prev?.focus?.();
    };
  }, [onNo]);
  return (
    <div className="nmodal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="nmodal-box" role="alertdialog" aria-modal="true" aria-label="Confirmar" ref={ref}>
        <p>{texto}</p>
        <div className="nmodal-acts">
          <button type="button" className="btn ghost" onClick={onNo}>Cancelar</button>
          <button type="button" className="btn danger" onClick={onSi}>{si}</button>
        </div>
      </div>
    </div>
  );
}
