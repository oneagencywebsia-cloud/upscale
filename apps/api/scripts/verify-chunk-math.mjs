// Verificación mecánica de la aritmética de rangos del sistema de troceado.
// Reimplementa LITERALMENTE las fórmulas de telegram.ts/storage.ts y comprueba
// que el archivo lógico reconstruido es byte a byte el original.

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.error("FALLO:", msg); } };

// ---- storage.ts putSplit: cómo se trocea al subir ----
function partirParaSubida(size, PART_SIZE) {
  const n = Math.ceil(size / PART_SIZE);
  const partes = [];
  for (let i = 0; i < n; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(size, start + PART_SIZE);
    // createReadStream(filePath, { start, end: end - 1 })  → inclusivo
    partes.push({ index: i, desde: start, hasta: end - 1, bytes: end - start });
  }
  return partes;
}

// ---- telegram.ts resolveParts: offset GLOBAL acumulado ----
function resolveParts(partes) {
  let acc = 0;
  return partes.map((p) => {
    const start = acc;
    acc += p.bytes;
    return { index: p.index, bytes: p.bytes, start };
  });
}

// ---- telegram.ts tgReadRangeLoc: troceo de UN rango dentro de UN documento ----
// Devuelve los subrangos [from, to) que pide fetchSubRange, en orden.
function subrangos(start, end) {
  const wantLen = end - start + 1;
  const PART = 1024 * 1024;
  const FIRST_PART = Math.min(256 * 1024, wantLen);
  const partRange = (i) => {
    if (i === 0) return [start, start + FIRST_PART];
    const from = start + FIRST_PART + (i - 1) * PART;
    return [from, Math.min(end + 1, from + PART)];
  };
  const nParts = FIRST_PART >= wantLen ? 1 : 1 + Math.ceil((wantLen - FIRST_PART) / PART);
  const out = [];
  for (let i = 0; i < nParts; i++) out.push(partRange(i));
  return out;
}

// ---- telegram.ts tgReadRangeLive: reparto del rango entre partes ----
function leerRango(parts, start, end) {
  const total = parts.reduce((s, p) => s + p.bytes, 0);
  const touched = parts.filter((p) => start < p.start + p.bytes && end >= p.start);
  const tramos = []; // [desdeGlobal, hastaGlobalExcl)
  for (const p of touched) {
    const localStart = Math.max(0, start - p.start);
    const localEnd = Math.min(p.bytes - 1, end - p.start);
    for (const [from, to] of subrangos(localStart, localEnd)) {
      tramos.push([p.start + from, p.start + to]);
    }
  }
  return { total, tramos };
}

/** Comprueba que los tramos cubren EXACTAMENTE [start, end], en orden, sin
 *  huecos, sin solapes y sin salirse del archivo. */
function comprobarCobertura(tramos, start, end, total, etiqueta) {
  let cursor = start;
  for (const [a, b] of tramos) {
    ok(a === cursor, `${etiqueta}: hueco/solape — se esperaba empezar en ${cursor} y empieza en ${a}`);
    ok(b > a, `${etiqueta}: tramo vacío o invertido [${a},${b})`);
    ok(b <= total, `${etiqueta}: tramo se sale del archivo (${b} > ${total})`);
    cursor = b;
  }
  ok(cursor === end + 1, `${etiqueta}: cubre hasta ${cursor - 1}, se pedía hasta ${end}`);
}

// =================== ESCENARIOS ===================
const GB = 1024 * 1024 * 1024;
const CEIL_FREE = 2 * GB;
const PART_FREE = Math.floor(CEIL_FREE * 0.9);
const CEIL_PREM = 4 * GB;
const PART_PREM = Math.floor(CEIL_PREM * 0.9);

const tamanos = [
  CEIL_FREE + 1,
  PART_FREE,
  PART_FREE * 2,      // múltiplo EXACTO de PART_SIZE (caso borde clásico)
  PART_FREE * 2 + 1,  // múltiplo exacto + 1 byte → última parte de 1 byte
  3 * GB, 12 * GB, 45 * GB, 100 * GB,
];

for (const PART_SIZE of [PART_FREE, PART_PREM]) {
  for (const size of tamanos) {
    const subidas = partirParaSubida(size, PART_SIZE);
    let acc = 0;
    for (const p of subidas) {
      ok(p.desde === acc, `subida ${size}/${PART_SIZE}: parte ${p.index} empieza en ${p.desde}, se esperaba ${acc}`);
      ok(p.bytes > 0, `subida ${size}: parte ${p.index} vacía`);
      ok(p.bytes <= PART_SIZE, `subida ${size}: parte ${p.index} de ${p.bytes} > PART_SIZE`);
      ok(p.bytes <= CEIL_FREE || PART_SIZE === PART_PREM, `subida ${size}: parte ${p.index} supera el tope de Telegram`);
      acc += p.bytes;
    }
    ok(acc === size, `subida ${size}/${PART_SIZE}: se suben ${acc} bytes de ${size}`);

    const parts = resolveParts(subidas);
    const total = parts.reduce((s, p) => s + p.bytes, 0);
    ok(total === size, `resolveParts ${size}: total ${total}`);

    let esperado = 0;
    for (const p of parts) {
      ok(p.start === esperado, `ensureCached ${size}: parte ${p.index} en offset ${p.start}, se esperaba ${esperado}`);
      esperado += p.bytes;
    }
    ok(esperado === size, `ensureCached ${size}: reconstruye ${esperado} de ${size}`);

    const MAX_SLICE = 16 * 1024 * 1024;
    const rangos = [
      [0, 0],
      [0, Math.min(MAX_SLICE, size) - 1],
      [size - 1, size - 1],
      [Math.max(0, size - MAX_SLICE), size - 1],
      [PART_SIZE - 1, PART_SIZE],
      [PART_SIZE - MAX_SLICE, PART_SIZE + MAX_SLICE - 1],
      [PART_SIZE, PART_SIZE],
      [PART_SIZE - 1, PART_SIZE - 1],
      [Math.floor(size / 3), Math.floor(size / 3) + 300],
      [0, size - 1], // DESCARGA COMPLETA
    ];
    for (const [s0, e0] of rangos) {
      const s = Math.max(0, Math.min(s0, size - 1));
      const e = Math.max(s, Math.min(e0, size - 1));
      const { tramos } = leerRango(parts, s, e);
      comprobarCobertura(tramos, s, e, size, `lectura ${size}/${PART_SIZE} [${s},${e}]`);
    }
  }
}

// tgHeadTailTemp troceado (leerRangoGlobalTroceado: cruza partes si hace falta)
function leerRangoGlobalTroceado(parts, from, to) {
  const tocadas = parts.filter((p) => from < p.start + p.bytes && to > p.start);
  return tocadas.map((p) => {
    const localFrom = Math.max(0, from - p.start);
    const localTo = Math.min(p.bytes, to - p.start);
    return { at: p.start + localFrom, len: localTo - localFrom, parte: p.index };
  });
}
for (const size of [CEIL_FREE + 1, 3 * GB, 12 * GB, 45 * GB, 100 * GB, PART_FREE * 2 + 1]) {
  const parts = resolveParts(partirParaSubida(size, PART_FREE));
  const total = parts.reduce((s, p) => s + p.bytes, 0);
  const headBytes = 8 * 1024 * 1024;
  const tailBytes = 6 * 1024 * 1024;
  const headTo = Math.min(headBytes, total);
  const tailFrom = Math.max(headTo, Math.floor(Math.max(0, total - tailBytes) / 4096) * 4096);
  const head = leerRangoGlobalTroceado(parts, 0, headTo);
  const tail = leerRangoGlobalTroceado(parts, tailFrom, total);
  const headLen = head.reduce((s, t) => s + t.len, 0);
  const tailLen = tail.reduce((s, t) => s + t.len, 0);
  ok(headLen === headTo, `headtail ${size}: cabecera de ${headLen}, se pedían ${headTo}`);
  ok(tailLen === total - tailFrom, `headtail ${size}: cola de ${tailLen}, se esperaban ${total - tailFrom}`);
  ok(tailLen >= Math.min(tailBytes, total - headTo), `headtail ${size}: la cola trae solo ${tailLen} bytes`);
  comprobarCobertura(head.map((t) => [t.at, t.at + t.len]), 0, headTo - 1, total, `headtail cabecera ${size}`);
  comprobarCobertura(tail.map((t) => [t.at, t.at + t.len]), tailFrom, total - 1, total, `headtail cola ${size}`);
  ok(tailFrom >= headTo, `headtail ${size}: cabecera y cola se solapan`);
  for (const t of [...head, ...tail]) ok(t.len > 0, `headtail ${size}: trozo vacío en parte ${t.parte}`);
}

// fetchSubRange: alineación a 512 KB + descarte (skip)
const CHUNK = 512 * 1024;
for (const [from, to] of [[0, 262144], [1, 5], [CHUNK - 1, CHUNK + 1], [12345678, 12345678 + 1048576]]) {
  const alignedStart = Math.floor(from / CHUNK) * CHUNK;
  const skip = from - alignedStart;
  const want = to - from;
  const limit = Math.ceil((want + skip) / CHUNK) * CHUNK;
  ok(alignedStart % CHUNK === 0, `fetchSubRange: offset no alineado (${alignedStart})`);
  ok(limit % CHUNK === 0, `fetchSubRange: limit no alineado (${limit})`);
  ok(alignedStart + limit >= to, `fetchSubRange: el limit no llega hasta ${to}`);
  ok(skip >= 0 && skip < CHUNK, `fetchSubRange: skip fuera de rango (${skip})`);
}

// downloadDocToFile: reparto en nParts con baseOffset
function repartoDescarga(total, streams, baseOffset) {
  const REQ = 512 * 1024;
  const per = Math.max(REQ, Math.ceil(total / streams / REQ) * REQ);
  const nParts = Math.ceil(total / per);
  const tramos = [];
  for (let i = 0; i < nParts; i++) {
    const from = i * per;
    const to = Math.min(total, from + per);
    tramos.push([baseOffset + from, baseOffset + to]);
  }
  return { nParts, tramos };
}
for (const total of [1, 1024, 5 * 1024 * 1024, PART_FREE, 700 * 1024 * 1024]) {
  for (const streams of [1, 4, 8]) {
    const base = 12345 * 1024;
    const { nParts, tramos } = repartoDescarga(total, streams, base);
    ok(nParts <= streams || total <= 512 * 1024, `downloadDocToFile: ${nParts} trozos > ${streams} streams (total ${total})`);
    comprobarCobertura(tramos, base, base + total - 1, base + total, `downloadDocToFile total=${total} streams=${streams}`);
  }
}

// ventana deslizante acotada: nunca se adelanta más de MAX_AHEAD al consumidor
function simularVentana(nParts, STREAMS, consumoLento) {
  const MAX_AHEAD = Math.max(STREAMS * 2, STREAMS + 2);
  let consumed = 0, maxInflight = 0;
  const inflight = new Set(), aplazados = new Set();
  const launch = (i) => { if (i < nParts && !inflight.has(i)) inflight.add(i); };
  const pedir = (next) => { if (next >= nParts) return; if (next < consumed + MAX_AHEAD) launch(next); else aplazados.add(next); };
  const bombear = () => { for (const i of [...aplazados].sort((a, b) => a - b)) { if (i >= consumed + MAX_AHEAD) break; aplazados.delete(i); launch(i); } };
  for (let i = 0; i < Math.min(nParts, STREAMS); i++) launch(i);
  // el productor va `consumoLento` veces más rápido que el consumidor
  for (let i = 0; i < nParts; i++) {
    consumed = i; bombear();
    if (!inflight.has(i)) { aplazados.delete(i); launch(i); }
    for (let k = 0; k < consumoLento; k++) { const libres = [...inflight].filter((x) => x !== i); if (libres.length) pedir(libres[0] + STREAMS); }
    maxInflight = Math.max(maxInflight, inflight.size);
    inflight.delete(i);
    consumed = i + 1; bombear();
  }
  return { maxInflight, MAX_AHEAD };
}
for (const [nParts, STREAMS] of [[1, 8], [5, 8], [200, 8], [100000, 8], [100000, 1]]) {
  const { maxInflight, MAX_AHEAD } = simularVentana(nParts, STREAMS, 5);
  ok(maxInflight <= MAX_AHEAD + STREAMS + 2, `ventana: ${maxInflight} trozos en vuelo con MAX_AHEAD=${MAX_AHEAD} (nParts=${nParts})`);
}
// 100 GB de descarga completa: cuántos trozos de 1 MB y cuánta RAM cabría
{
  const nParts = 1 + Math.ceil((100 * GB - 262144) / (1024 * 1024));
  const STREAMS = 8, MAX_AHEAD = STREAMS * 2;
  console.log(`  · descarga de 100 GB = ${nParts} trozos; ANTES sin tope (=${Math.round(nParts / 1024)} GB en RAM si el cliente se para), AHORA ≤ ${MAX_AHEAD + STREAMS} MB`);
}

// claves compuestas del docCache
const claves = new Set();
for (const key of ["orig/u1/2026/09/abc123.mov", "copy/u1/x/thumb.webp"]) {
  for (let i = 0; i < 60; i++) {
    const ck = `${key}#p${i}`;
    ok(!claves.has(ck), `docCache: colisión de clave compuesta ${ck}`);
    claves.add(ck);
  }
}

console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES OK" : `${fallos} COMPROBACIONES FALLIDAS`);
process.exit(fallos === 0 ? 0 : 1);
