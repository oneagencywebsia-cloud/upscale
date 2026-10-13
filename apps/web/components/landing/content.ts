/**
 * Textos de la portada. Regla: frases cortas, una idea por línea, lo que un
 * niño de 5 años entendería. Telegram NO aparece aquí a propósito: es un
 * detalle interno de dónde viven los archivos, no algo que el usuario deba
 * conocer ni configurar.
 */

export const STEPS = [
  {
    t: "Crea tu cuenta",
    d: "Un toque con Google o Apple. Sin tarjeta.",
    time: "10 segundos",
  },
  {
    t: "Suelta tus cosas",
    d: "Arrastra tus fotos, vídeos y música. Todo a la vez.",
    time: "1 toque",
  },
  {
    t: "Míralo donde quieras",
    d: "En el móvil, el ordenador o la tablet. Igual que lo subiste.",
    time: "siempre",
  },
] as const;

export const BENEFITS = [
  { t: "Idéntico al original", d: "Ni un píxel menos. Lo guardamos tal cual sale de tu cámara." },
  { t: "Fotos, vídeo y audio", d: "Un solo sitio para todo lo que grabas y fotografías." },
  { t: "Solo tuyo", d: "Cada persona ve únicamente lo suyo." },
] as const;

/** Respuestas: la primera frase contesta directo (así las citan los buscadores
 *  y los asistentes de IA); la segunda aclara. Nada que no sea verdad hoy. */
export const FAQ = [
  {
    q: "¿Upscale es gratis?",
    a: "Sí. Empiezas con 5 GB gratis y sin tarjeta. Puedes ganar más espacio invitando a amigos.",
  },
  {
    q: "¿Pierden calidad mis fotos y vídeos?",
    a: "No. Guardamos el archivo original, byte a byte, sin recomprimir. Cuando lo descargas es idéntico al que subiste.",
  },
  {
    q: "¿Qué tipos de archivo puedo guardar?",
    a: "Fotos (HEIC, JPG, PNG, RAW DNG…), vídeos (MOV, MP4, MKV…) y audio (MP3, M4A, WAV, FLAC…). Si tu móvil lo hace, Upscale lo guarda.",
  },
  {
    q: "¿Quién puede ver mis archivos?",
    a: "Solo tú. Cada cuenta ve únicamente lo suyo, y para entrar hace falta tu sesión.",
  },
  {
    q: "¿Puedo llevarme todo si me voy?",
    a: "Sí. Puedes descargar toda tu biblioteca en un ZIP cuando quieras, con los originales intactos.",
  },
  {
    q: "¿Cómo subo cosas desde el móvil?",
    a: "Abre Upscale en el navegador, pulsa el botón ↑ y elige lo que quieras. También puedes instalarla como app desde el menú de compartir.",
  },
] as const;
