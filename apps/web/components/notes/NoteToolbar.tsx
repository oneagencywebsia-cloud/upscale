"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { atajo, useTeclado } from "@/lib/dispositivo";

const ico = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const COLORES = ["#111827", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#0e7490", "#1d4ed8", "#7e22ce", "#be185d", "#ffffff"];

function B({ label, on, onClick, children, disabled }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="tb" aria-label={label} title={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** Barra de formato. `onMouseDown` evita que el editor pierda la selección al pulsar. */
export default function NoteToolbar({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      negrita: e.isActive("bold"),
      cursiva: e.isActive("italic"),
      subrayado: e.isActive("underline"),
      tachado: e.isActive("strike"),
      resaltado: e.isActive("highlight"),
      enlace: e.isActive("link"),
      vinetas: e.isActive("bulletList"),
      numerada: e.isActive("orderedList"),
      tareas: e.isActive("taskList"),
      cita: e.isActive("blockquote"),
      codigo: e.isActive("code"),
      bloque: e.isActive("codeBlock"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      puedeDeshacer: e.can().undo(),
      puedeRehacer: e.can().redo(),
      nivel: e.isActive("heading", { level: 1 }) ? "1" : e.isActive("heading", { level: 2 }) ? "2" : e.isActive("heading", { level: 3 }) ? "3" : "0",
    }),
  });
  const nivel = st.nivel;
  const teclado = useTeclado();
  const con = (nombre: string, letra: string) => (teclado ? `${nombre} (${atajo(letra)})` : nombre);
  const [enlace, setEnlace] = useState<string | null>(null);
  const [colores, setColores] = useState(false);

  const aplicarEnlace = () => {
    let u = (enlace ?? "").trim();
    if (!u) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      if (!/^(https?:|mailto:|tel:)/i.test(u)) u = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u) ? `mailto:${u}` : `https://${u}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: u }).run();
    }
    setEnlace(null);
  };


  return (
    <div className="ntb" role="toolbar" aria-label="Formato del texto">
      <B label="Deshacer" onClick={() => editor.chain().focus().undo().run()} disabled={!st.puedeDeshacer}>{ico("M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3")}</B>
      <B label="Rehacer" onClick={() => editor.chain().focus().redo().run()} disabled={!st.puedeRehacer}>{ico("m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3")}</B>
      <span className="tb-sep" aria-hidden="true" />
      <select
        className="tb-sel"
        aria-label="Estilo de párrafo"
        value={nivel}
        onChange={(e) => {
          const v = e.target.value;
          const c = editor.chain().focus();
          (v === "0" ? c.setParagraph() : c.toggleHeading({ level: Number(v) as 1 | 2 | 3 })).run();
        }}
      >
        <option value="0">Texto</option>
        <option value="1">Título</option>
        <option value="2">Subtítulo</option>
        <option value="3">Encabezado</option>
      </select>
      <B label={con("Negrita", "B")} on={st.negrita} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></B>
      <B label={con("Cursiva", "I")} on={st.cursiva} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></B>
      <B label={con("Subrayado", "U")} on={st.subrayado} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></B>
      <B label="Tachado" on={st.tachado} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></B>
      <B label="Resaltado" on={st.resaltado} onClick={() => editor.chain().focus().toggleHighlight().run()}>{ico("m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4")}</B>
      <span className="tb-pop">
        <B label="Color del texto" on={colores} onClick={() => setColores(!colores)}>
          <span className="tb-a" style={{ borderBottomColor: st.color || "currentColor" }}>A</span>
        </B>
        {colores && (
          <span className="tb-colors" role="group" aria-label="Colores">
            {COLORES.map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`} style={{ background: c }} onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().setColor(c).run(); setColores(false); }} />
            ))}
            <button type="button" className="tb-reset" onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().unsetColor().run(); setColores(false); }}>Quitar</button>
          </span>
        )}
      </span>
      <span className="tb-sep" aria-hidden="true" />
      <B label="Lista con viñetas" on={st.vinetas} onClick={() => editor.chain().focus().toggleBulletList().run()}>{ico("M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01")}</B>
      <B label="Lista numerada" on={st.numerada} onClick={() => editor.chain().focus().toggleOrderedList().run()}>{ico("M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1")}</B>
      <B label="Lista de tareas" on={st.tareas} onClick={() => editor.chain().focus().toggleTaskList().run()}>{ico("m3 6 2 2 4-4M3 14l2 2 4-4M13 7h8M13 15h8")}</B>
      <B label="Cita" on={st.cita} onClick={() => editor.chain().focus().toggleBlockquote().run()}>{ico("M3 21c3 0 7-1 7-8V5H3v8h4M14 21c3 0 7-1 7-8V5h-7v8h4")}</B>
      <B label="Código" on={st.codigo} onClick={() => editor.chain().focus().toggleCode().run()}>{ico("m16 18 6-6-6-6M8 6l-6 6 6 6")}</B>
      <B label="Bloque de código" on={st.bloque} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{ico("M4 4h16v16H4zM9 9l-2 3 2 3M15 9l2 3-2 3")}</B>
      <B label="Línea separadora" onClick={() => editor.chain().focus().setHorizontalRule().run()}>{ico("M3 12h18")}</B>
      <B label="Enlace" on={st.enlace} onClick={() => setEnlace(editor.getAttributes("link").href ?? "")}>{ico("M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1")}</B>
      <B label="Quitar formato" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>{ico("m7 21-4-4 11-11 6 6-7 7M13 21h8")}</B>

      {enlace !== null && (
        <form
          className="tb-link"
          onSubmit={(e) => {
            e.preventDefault();
            aplicarEnlace();
          }}
        >
          <input
            autoFocus
            value={enlace}
            onChange={(e) => setEnlace(e.target.value)}
            placeholder="https://… (vacío para quitar)"
            aria-label="Dirección del enlace"
            inputMode="url"
            onKeyDown={(e) => e.key === "Escape" && (setEnlace(null), editor.commands.focus())}
          />
          <button type="submit" className="btn sm primary">Aplicar</button>
          <button type="button" className="btn sm ghost" onClick={() => setEnlace(null)}>Cancelar</button>
        </form>
      )}
    </div>
  );
}
