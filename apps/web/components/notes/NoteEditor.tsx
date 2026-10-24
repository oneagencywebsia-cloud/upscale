"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { atajo, useTeclado } from "@/lib/dispositivo";
import NoteToolbar from "./NoteToolbar";
import StylePanel from "./StylePanel";
import NoteAttachments, { type SubirFn } from "./NoteAttachments";
import { Confirmar } from "./NotesApp";
import { api, ErrorApi, estiloCss, textoDeDoc, type Note, type NoteAttachment, type NoteStyle } from "@/lib/notes";

type Guardado = "ok" | "pendiente" | "guardando" | "error" | "conflicto";
const ESTADO: Record<Guardado, string> = {
  ok: "Guardado",
  pendiente: "Cambios sin guardar…",
  guardando: "Guardando…",
  error: "Sin conexión · reintentando",
  conflicto: "Cambió en otra pestaña",
};

/** «línea\nlínea\n\npárrafo» → nodos del editor. */
function nodosDeTexto(t: string) {
  return t
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((l, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(l ? [{ type: "text", text: l }] : [])]),
    }));
}

function descargar(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: `${tipo};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function NoteEditor({ id }: { id: string }) {
  const [nota, setNota] = useState<Note | null>(null);
  const [fallo, setFallo] = useState<"no" | "red" | null>(null);
  const cargar = useCallback(() => {
    setFallo(null);
    api<Note>(`/${id}`)
      .then(setNota)
      .catch((e) => setFallo(e instanceof ErrorApi && e.status === 404 ? "no" : "red"));
  }, [id]);
  useEffect(cargar, [cargar]);

  if (fallo === "no")
    return (
      <div className="app notes">
        <div className="empty">
          <h3>Esta nota no existe</h3>
          <p>Puede que se haya borrado o que no sea tuya.</p>
          <Link className="btn primary" href="/app/notas">Volver a Notas</Link>
        </div>
      </div>
    );
  if (fallo === "red")
    return (
      <div className="app notes">
        <div className="empty" role="alert">
          <h3>No se pudo abrir la nota</h3>
          <button type="button" className="btn" onClick={cargar}>Reintentar</button>
        </div>
      </div>
    );
  if (!nota)
    return (
      <div className="app notes" aria-busy="true" aria-label="Cargando nota">
        <div className="ned-skel" />
      </div>
    );
  return <Editor1 inicial={nota} />;
}

function Editor1({ inicial }: { inicial: Note }) {
  const router = useRouter();
  const nueva = useSearchParams().get("nueva") === "1";
  const teclado = useTeclado();
  // el marcador de posición se lee al pintar: en móvil no se habla de Ctrl+V ni de Enter
  const frases = useRef({ cuerpo: "" });
  frases.current.cuerpo = teclado ? `Escribe aquí… o pega una captura (${atajo("V")}) para extraer su texto.` : "Escribe aquí… o añade una captura abajo para extraer su texto.";
  const [titulo, setTitulo] = useState(inicial.title);
  const [estilo, setEstilo] = useState<NoteStyle>(inicial.style ?? {});
  const [etiquetas, setEtiquetas] = useState<string[]>(inicial.tags);
  const [fijada, setFijada] = useState(inicial.pinned);
  const [archivada, setArchivada] = useState(Boolean(inicial.archivedAt));
  const [adjuntos, setAdjuntos] = useState<NoteAttachment[]>(inicial.attachments);
  const [guardado, setGuardado] = useState<Guardado>("ok");
  const [panel, setPanel] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tagTxt, setTagTxt] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState(false);
  const [soltando, setSoltando] = useState(false);

  // --- estado de guardado en refs: el guardado nunca debe leer valores viejos de un cierre
  const base = useRef(inicial.updatedAt);
  const sucio = useRef(new Set<"body" | "title" | "style" | "tags">());
  const enVuelo = useRef(false);
  const otraVez = useRef(false);
  const temporizador = useRef<number | undefined>(undefined);
  const reintento = useRef<number | undefined>(undefined);
  const datos = useRef({ titulo, estilo, etiquetas });
  datos.current = { titulo, estilo, etiquetas };
  const editorRef = useRef<Editor | null>(null);
  const subirRef = useRef<SubirFn>(() => {});
  const avisoT = useRef<number | undefined>(undefined);

  const decir = useCallback((t: string) => {
    window.clearTimeout(avisoT.current);
    setAviso(t);
    avisoT.current = window.setTimeout(() => setAviso(null), 5000);
  }, []);

  const guardar = useCallback(async (forzarBase?: string) => {
    window.clearTimeout(temporizador.current);
    if (enVuelo.current) {
      otraVez.current = true;
      return;
    }
    if (sucio.current.size === 0) return;
    const campos = new Set(sucio.current);
    sucio.current.clear();
    const d = datos.current;
    const cuerpo: Record<string, unknown> = { baseUpdatedAt: forzarBase ?? base.current };
    if (campos.has("title")) cuerpo.title = d.titulo;
    if (campos.has("style")) cuerpo.style = d.estilo;
    if (campos.has("tags")) cuerpo.tags = d.etiquetas;
    if (campos.has("body") && editorRef.current) cuerpo.body = editorRef.current.getJSON();
    enVuelo.current = true;
    setGuardado("guardando");
    try {
      const r = await api<Note>(`/${inicial.id}`, { method: "PATCH", json: cuerpo });
      base.current = r.updatedAt;
      setGuardado(sucio.current.size ? "pendiente" : "ok");
    } catch (e) {
      campos.forEach((c) => sucio.current.add(c));
      if (e instanceof ErrorApi && e.status === 409) setGuardado("conflicto");
      else if (e instanceof ErrorApi && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        setGuardado("error");
        decir(e.message);
      } else {
        setGuardado("error");
        reintento.current = window.setTimeout(() => void guardar(), 4000);
      }
    } finally {
      enVuelo.current = false;
      if (otraVez.current && sucio.current.size) {
        otraVez.current = false;
        window.setTimeout(() => void guardar(), 0);
      }
    }
  }, [inicial.id, decir]);

  const marcar = useCallback((c: "body" | "title" | "style" | "tags") => {
    sucio.current.add(c);
    setGuardado((g) => (g === "conflicto" ? g : "pendiente"));
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => void guardar(), 900);
  }, [guardar]);

  // al salir o ocultar la pestaña, lo pendiente se manda ya (keepalive sobrevive al cierre)
  useEffect(() => {
    const volcar = () => {
      if (!sucio.current.size || enVuelo.current) return;
      const d = datos.current;
      const cuerpo: Record<string, unknown> = { baseUpdatedAt: base.current };
      if (sucio.current.has("title")) cuerpo.title = d.titulo;
      if (sucio.current.has("style")) cuerpo.style = d.estilo;
      if (sucio.current.has("tags")) cuerpo.tags = d.etiquetas;
      if (sucio.current.has("body") && editorRef.current) cuerpo.body = editorRef.current.getJSON();
      void fetch(`/api/notes/${inicial.id}`, { method: "PATCH", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => {});
      sucio.current.clear();
    };
    const vis = () => document.visibilityState === "hidden" && volcar();
    const antes = (e: BeforeUnloadEvent) => {
      if (sucio.current.size || enVuelo.current) {
        volcar();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", volcar);
    window.addEventListener("beforeunload", antes);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", volcar);
      window.removeEventListener("beforeunload", antes);
      volcar();
      window.clearTimeout(temporizador.current);
      window.clearTimeout(reintento.current);
    };
  }, [inicial.id]);

  const extensiones = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ["mailto", "tel"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      }),
      Highlight,
      TextStyle,
      Color,
      TaskList,
      TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node, hecha) => `Tarea ${hecha ? "hecha" : "pendiente"}: ${node.textContent || "vacía"}` } }),
      Placeholder.configure({ placeholder: () => frases.current.cuerpo }),
    ],
    [],
  );

  const editor = useEditor({
    extensions: extensiones,
    content: inicial.body as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "nedit-pm", "aria-label": "Texto de la nota", role: "textbox", "aria-multiline": "true" },
      handlePaste: (_v, ev) => {
        const imgs = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return false;
        ev.preventDefault();
        subirRef.current(imgs);
        return true;
      },
      handleDrop: (_v, ev) => {
        const imgs = [...((ev as DragEvent).dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return false;
        ev.preventDefault();
        subirRef.current(imgs);
        return true;
      },
    },
    onUpdate: () => marcar("body"),
  });
  editorRef.current = editor;
  // el marcador es una decoración: se repinta cuando se sabe si hay teclado
  useEffect(() => {
    editor?.view.dispatch(editor.state.tr);
  }, [teclado, editor]);

  useEffect(() => {
    if (nueva && editor) {
      document.getElementById("ned-titulo")?.focus();
      router.replace(`/app/notas/${inicial.id}`);
    }
  }, [nueva, editor, router, inicial.id]);

  // Ctrl/Cmd+S guarda ya
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void guardar();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [guardar]);

  async function patchSuelto(cambio: Record<string, unknown>) {
    try {
      const r = await api<Note>(`/${inicial.id}`, { method: "PATCH", json: { ...cambio, baseUpdatedAt: base.current } });
      base.current = r.updatedAt;
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 409) setGuardado("conflicto");
      else decir("No se pudo guardar el cambio");
    }
  }

  function anadirEtiqueta(t: string) {
    const v = t.trim().replace(/^#/, "").slice(0, 30);
    if (!v || etiquetas.some((x) => x.toLowerCase() === v.toLowerCase())) return setTagTxt("");
    if (etiquetas.length >= 10) return decir("Máximo 10 etiquetas por nota");
    setEtiquetas([...etiquetas, v]);
    setTagTxt("");
    datos.current.etiquetas = [...etiquetas, v];
    marcar("tags");
  }

  const textoPlano = () => {
    const t = textoDeDoc(editor?.getJSON() ?? { type: "doc" });
    return `${titulo.trim() ? `${titulo.trim()}\n\n` : ""}${t}`.trim();
  };

  const css = estiloCss(estilo);
  const sinTitulo = titulo.trim() || "Sin título";

  return (
    <div className={`app notes ned${panel ? " con-panel" : ""}`}>
      <h1 className="sr-only">Nota: {sinTitulo}</h1>
      <div className="ned-top">
        <Link href="/app/notas" className="btn ghost sm" onClick={() => void guardar()}>← Notas</Link>
        <span className={`ned-estado st-${guardado}`} role="status" aria-live="polite">
          {ESTADO[guardado]}
        </span>
        <div className="ned-acts">
          <button type="button" className="btn ghost sm" aria-pressed={fijada} onClick={() => { setFijada(!fijada); void patchSuelto({ pinned: !fijada }); }}>
            {fijada ? "Fijada" : "Fijar"}
          </button>
          <button type="button" className="btn ghost sm" aria-pressed={panel} onClick={() => setPanel(!panel)}>Personalizar</button>
          <span className="tb-pop">
            <button type="button" className="btn ghost sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>Más ▾</button>
            {menu && (
              <div className="ned-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
                <button role="menuitem" type="button" onClick={() => { navigator.clipboard?.writeText(textoPlano()).then(() => decir("Texto copiado")).catch(() => decir("No se pudo copiar")); setMenu(false); }}>Copiar texto</button>
                <button role="menuitem" type="button" onClick={() => { descargar(`${sinTitulo.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "nota"}.txt`, textoPlano(), "text/plain"); setMenu(false); }}>Descargar (.txt)</button>
                <button role="menuitem" type="button" onClick={() => { window.print(); setMenu(false); }}>Imprimir</button>
                <button role="menuitem" type="button" onClick={async () => { setMenu(false); const a = !archivada; setArchivada(a); await patchSuelto({ archived: a }); decir(a ? "Nota archivada" : "Nota desarchivada"); }}>{archivada ? "Desarchivar" : "Archivar"}</button>
                <button role="menuitem" type="button" className="warn" onClick={() => { setMenu(false); setBorrar(true); }}>Mover a la papelera</button>
              </div>
            )}
          </span>
        </div>
      </div>

      {guardado === "conflicto" && (
        <div className="nbanner warn" role="alert">
          <span>Esta nota se cambió en otra pestaña o dispositivo. Elige qué versión conservar.</span>
          <span className="nbanner-acts">
            <button type="button" className="btn sm" onClick={async () => {
              try {
                const r = await api<Note>(`/${inicial.id}`);
                base.current = r.updatedAt;
                setTitulo(r.title); setEstilo(r.style ?? {}); setEtiquetas(r.tags); setAdjuntos(r.attachments);
                editor?.commands.setContent(r.body as JSONContent, { emitUpdate: false });
                sucio.current.clear();
                setGuardado("ok");
              } catch { decir("No se pudo cargar la otra versión"); }
            }}>Usar la otra</button>
            <button type="button" className="btn sm primary" onClick={async () => {
              try {
                const r = await api<Note>(`/${inicial.id}`);
                sucio.current.add("body"); sucio.current.add("title"); sucio.current.add("style"); sucio.current.add("tags");
                setGuardado("pendiente");
                await guardar(r.updatedAt);
              } catch { decir("No se pudo guardar"); }
            }}>Guardar la mía</button>
          </span>
        </div>
      )}

      <div className="ned-grid">
        <div className="ned-main">
          <div
            className={`npaper${soltando ? " drop" : ""}`}
            style={css}
            onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setSoltando(true); } }}
            onDragLeave={() => setSoltando(false)}
            onDrop={() => setSoltando(false)}
          >
            <input
              id="ned-titulo"
              className="npaper-title"
              value={titulo}
              maxLength={200}
              onChange={(e) => { setTitulo(e.target.value); datos.current.titulo = e.target.value; marcar("title"); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); } }}
              placeholder="Título"
              aria-label="Título de la nota"
              autoComplete="off"
            />
            {editor && <NoteToolbar editor={editor} />}
            <EditorContent editor={editor} className="nedit" />
            {soltando && <div className="npaper-drop" aria-hidden="true">Suelta la imagen para adjuntarla</div>}
          </div>

          <div className="ned-tags">
            <label className="sr-only" htmlFor="ned-tag">Añadir etiqueta</label>
            {etiquetas.map((t) => (
              <span key={t} className="ntag on">
                {t}
                <button type="button" aria-label={`Quitar la etiqueta ${t}`} onClick={() => { const n = etiquetas.filter((x) => x !== t); setEtiquetas(n); datos.current.etiquetas = n; marcar("tags"); }}>✕</button>
              </span>
            ))}
            <input
              id="ned-tag"
              value={tagTxt}
              maxLength={30}
              placeholder={etiquetas.length ? "+ etiqueta" : teclado ? "+ Añadir etiqueta (Enter)" : "+ Añadir etiqueta"}
              onChange={(e) => setTagTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); anadirEtiqueta(tagTxt); } else if (e.key === "Backspace" && !tagTxt && etiquetas.length) { const n = etiquetas.slice(0, -1); setEtiquetas(n); datos.current.etiquetas = n; marcar("tags"); } }}
              onBlur={() => tagTxt && anadirEtiqueta(tagTxt)}
            />
          </div>

          <NoteAttachments
            noteId={inicial.id}
            adjuntos={adjuntos}
            setAdjuntos={setAdjuntos}
            aviso={decir}
            registrar={useCallback((f: SubirFn) => { subirRef.current = f; }, [])}
            insertar={(t) => {
              const nodos = nodosDeTexto(t);
              if (!nodos.length || !editor) return;
              editor.chain().focus("end").insertContent(nodos).run();
            }}
          />
        </div>

        {panel && (
          <StylePanel
            style={estilo}
            onClose={() => setPanel(false)}
            onChange={(s) => { setEstilo(s); datos.current.estilo = s; marcar("style"); }}
          />
        )}
      </div>

      <div className="ntoast-wrap" aria-live="polite">
        {aviso && <div className="ntoast" role="status"><span>{aviso}</span></div>}
      </div>

      {borrar && (
        <Confirmar
          si="Mover a la papelera"
          texto="La nota irá a la papelera y se borrará sola a los 30 días. Hasta entonces puedes restaurarla."
          onNo={() => setBorrar(false)}
          onSi={async () => {
            setBorrar(false);
            sucio.current.clear();
            window.clearTimeout(temporizador.current);
            try {
              await api(`/${inicial.id}`, { method: "DELETE" });
              router.push("/app/notas");
            } catch { decir("No se pudo eliminar"); }
          }}
        />
      )}
    </div>
  );
}
