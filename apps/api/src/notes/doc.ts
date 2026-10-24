/**
 * Validación y saneado del documento de una nota.
 *
 * El editor del navegador (TipTap/ProseMirror) guarda JSON, no HTML. Aun así el
 * servidor NO se fía: antes de guardar recorre el documento y solo deja pasar
 * nodos, marcas y atributos conocidos, con límites de profundidad y tamaño. Así
 * ninguna nota puede contener HTML suelto, `javascript:` en un enlace ni un
 * documento tan grande o anidado que bloquee al cliente o a la base de datos.
 *
 * Además extrae el texto plano (búsqueda, vista previa y exportación).
 */

export class NotaInvalida extends Error {}

const MAX_PROFUNDIDAD = 12;
const MAX_NODOS = 20_000;
export const MAX_TEXTO = 100_000;

interface Nodo {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Nodo[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const BLOQUES = ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule"] as const;
const BLOQUES_ITEM = ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule"] as const;

/** qué hijos admite cada nodo */
const HIJOS: Record<string, readonly string[]> = {
  doc: BLOQUES,
  paragraph: ["text", "hardBreak"],
  heading: ["text", "hardBreak"],
  codeBlock: ["text"],
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  taskList: ["taskItem"],
  listItem: BLOQUES_ITEM,
  taskItem: BLOQUES_ITEM,
  blockquote: BLOQUES_ITEM,
  horizontalRule: [],
  hardBreak: [],
  text: [],
};

const MARCAS = new Set(["bold", "italic", "underline", "strike", "code", "link", "highlight", "textStyle"]);
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ALINEACIONES = new Set(["left", "center", "right", "justify"]);

function fail(msg: string): never {
  throw new NotaInvalida(msg);
}

/** Solo http(s), mailto y tel: nada de `javascript:`, `data:` ni rutas raras. */
export function hrefSeguro(href: unknown): string {
  if (typeof href !== "string") fail("enlace no válido");
  const h = href.trim();
  if (h.length === 0 || h.length > 2000) fail("enlace no válido");
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(h)) fail("solo se permiten enlaces http, https, mailto y tel");
  if (/[\u0000-\u001f\u007f\s]/.test(h)) fail("enlace no válido");
  return h;
}

function atributos(tipo: string, a: unknown): Record<string, unknown> | undefined {
  const src = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  switch (tipo) {
    case "paragraph":
    case "heading": {
      if (typeof src.textAlign === "string" && ALINEACIONES.has(src.textAlign)) out.textAlign = src.textAlign;
      if (tipo === "heading") {
        const l = Number(src.level);
        out.level = l >= 1 && l <= 3 ? Math.trunc(l) : 2;
      }
      break;
    }
    case "orderedList": {
      const s = Number(src.start);
      if (Number.isFinite(s) && s >= 1 && s <= 9999) out.start = Math.trunc(s);
      break;
    }
    case "taskItem":
      out.checked = src.checked === true;
      break;
    case "codeBlock":
      if (typeof src.language === "string" && /^[a-z0-9+#.-]{1,20}$/i.test(src.language)) out.language = src.language;
      break;
  }
  return Object.keys(out).length ? out : undefined;
}

function marca(m: unknown): { type: string; attrs?: Record<string, unknown> } {
  if (!m || typeof m !== "object") fail("marca no válida");
  const { type, attrs } = m as { type?: unknown; attrs?: unknown };
  if (typeof type !== "string" || !MARCAS.has(type)) fail(`marca no permitida: ${String(type).slice(0, 30)}`);
  const a = attrs && typeof attrs === "object" ? (attrs as Record<string, unknown>) : {};
  if (type === "link") return { type, attrs: { href: hrefSeguro(a.href) } };
  if (type === "highlight") {
    const color = typeof a.color === "string" && HEX.test(a.color) ? a.color : null;
    return color ? { type, attrs: { color } } : { type };
  }
  if (type === "textStyle") {
    const color = typeof a.color === "string" && HEX.test(a.color) ? a.color : null;
    return color ? { type, attrs: { color } } : { type };
  }
  return { type };
}

interface Cuenta {
  nodos: number;
  texto: number;
}

function limpiar(n: unknown, padre: string, prof: number, c: Cuenta): Nodo | null {
  if (prof > MAX_PROFUNDIDAD) fail("la nota está demasiado anidada");
  if (!n || typeof n !== "object" || Array.isArray(n)) fail("contenido no válido");
  const { type, text, content, marks, attrs } = n as Record<string, unknown>;
  if (typeof type !== "string" || !(type in HIJOS)) fail(`elemento no permitido: ${String(type).slice(0, 30)}`);
  if (!HIJOS[padre]!.includes(type)) fail(`«${type}» no puede ir dentro de «${padre}»`);
  if (++c.nodos > MAX_NODOS) fail("la nota es demasiado grande");

  if (type === "text") {
    if (typeof text !== "string") fail("texto no válido");
    if (text.length === 0) return null; // ProseMirror no admite texto vacío: se descarta
    c.texto += text.length;
    if (c.texto > MAX_TEXTO) fail("la nota supera el máximo de texto");
    const out: Nodo = { type, text };
    if (padre === "codeBlock") return out; // el código no lleva marcas
    if (marks !== undefined) {
      if (!Array.isArray(marks) || marks.length > 8) fail("marcas no válidas");
      const vistas = new Set<string>();
      out.marks = marks.map(marca).filter((m) => (vistas.has(m.type) ? false : (vistas.add(m.type), true)));
      if (!out.marks.length) delete out.marks;
    }
    return out;
  }

  const out: Nodo = { type };
  const at = atributos(type, attrs);
  if (at) out.attrs = at;
  if (content !== undefined) {
    if (!Array.isArray(content)) fail("contenido no válido");
    const hijos = content.map((h) => limpiar(h, type, prof + 1, c)).filter((h): h is Nodo => h !== null);
    if (hijos.length) out.content = hijos;
  }
  return out;
}

/** El texto plano de un nodo, con saltos de línea entre bloques. */
function textoDe(n: Nodo, out: string[], ctx: { lista?: "ul" | "ol"; i?: number } = {}): void {
  switch (n.type) {
    case "text":
      out.push(n.text ?? "");
      return;
    case "hardBreak":
      out.push("\n");
      return;
    case "horizontalRule":
      out.push("\n---\n");
      return;
  }
  const hijos = n.content ?? [];
  if (n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock") {
    hijos.forEach((h) => textoDe(h, out));
    out.push("\n\n"); // línea en blanco entre bloques (dentro de una lista se recorta)
    return;
  }
  if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") {
    const lista = n.type === "orderedList" ? "ol" : "ul";
    let i = n.type === "orderedList" ? Number(n.attrs?.start ?? 1) : 1;
    for (const h of hijos) {
      const marca = n.type === "taskList" ? (h.attrs?.checked ? "[x] " : "[ ] ") : lista === "ol" ? `${i++}. ` : "- ";
      out.push(marca);
      const sub: string[] = [];
      h.content?.forEach((b) => textoDe(b, sub, { lista, i }));
      out.push(sub.join("").replace(/\n+$/, "").replace(/\n{2,}/g, "\n").replace(/\n/g, "\n  "), "\n");
    }
    out.push("\n"); // línea en blanco tras la lista
    return;
  }
  hijos.forEach((h) => textoDe(h, out, ctx));
}

export interface DocLimpio {
  doc: { type: "doc"; content: Nodo[] };
  texto: string;
}

export function sanitizarDoc(raw: unknown): DocLimpio {
  if (!raw || typeof raw !== "object") fail("la nota no tiene contenido válido");
  if ((raw as { type?: unknown }).type !== "doc") fail("el documento debe empezar por «doc»");
  const c: Cuenta = { nodos: 0, texto: 0 };
  const limpio = limpiar(raw, "__raiz__", 0, c);
  const hijos = limpio?.content ?? [];
  const doc = { type: "doc" as const, content: hijos.length ? hijos : [{ type: "paragraph" }] };
  const out: string[] = [];
  doc.content.forEach((h) => textoDe(h, out));
  const texto = out.join("").replace(/\n{3,}/g, "\n\n").trim();
  return { doc, texto };
}

/** Se acepta `doc` como raíz */
HIJOS.__raiz__ = ["doc"];

/** Documento vacío válido */
export const DOC_VACIO = { type: "doc", content: [{ type: "paragraph" }] } as const;

/** Un documento con el texto dado: una línea en blanco separa párrafos; un salto simple, líneas del mismo párrafo. */
export function docDeTexto(texto: string): DocLimpio {
  const parrafos: string[][] = [];
  let actual: string[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.replace(/\s+$/, "");
    if (t.trim() === "") {
      if (actual.length) parrafos.push(actual);
      actual = [];
    } else actual.push(t);
  }
  if (actual.length) parrafos.push(actual);

  const content = parrafos.length
    ? parrafos.map((lineas) => ({
        type: "paragraph",
        content: lineas.flatMap((l, i) => (i ? [{ type: "hardBreak" }, { type: "text", text: l }] : [{ type: "text", text: l }])),
      }))
    : [{ type: "paragraph" }];
  return sanitizarDoc({ type: "doc", content });
}
