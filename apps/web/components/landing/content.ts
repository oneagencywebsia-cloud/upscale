/**
 * Textos de la portada. Regla: frases cortas, una idea por línea, lo que un
 * niño de 5 años entendería. Telegram NO aparece aquí a propósito: es un
 * detalle interno de dónde viven los archivos, no algo que el usuario deba
 * conocer ni configurar.
 */

export const STEPS = [
  {
    t: "Crea tu cuenta",
    d: "Un toque con Google. Sin tarjeta.",
    time: "10 segundos",
  },
  {
    t: "Sube tus cosas",
    d: "Elige tus fotos, vídeos y música (en el ordenador, también puedes arrastrarlos). Todo a la vez.",
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

/** Preguntas de la página /preguntas: las de la portada y algunas más. Misma regla:
 *  la primera frase contesta directo, la segunda aclara, y todo es verdad hoy. */
export const FAQ_EXTRA = [
  {
    q: "¿Qué pasa si subo dos veces el mismo archivo?",
    a: "No se duplica. Upscale reconoce el contenido y conserva una sola copia, así que no gastas espacio de más.",
  },
  {
    q: "¿Puedo descargar mis fotos en un formato que se abra en cualquier aparato?",
    a: "Sí. Al descargar eliges entre Compatible y Original. Compatible convierte lo que no se abre en todas partes (por ejemplo, una foto HEIC pasa a JPG) y Original te da el archivo exacto.",
  },
  {
    q: "¿Cómo descargo muchas fotos de golpe?",
    a: "Selecciónalas y descárgalas en un ZIP. Si son muchas, Upscale las reparte en partes de tamaño cómodo para el móvil y muestra una barra de progreso.",
  },
  {
    q: "¿Puedo usar Upscale en el móvil como una app?",
    a: "Sí. Se instala desde el navegador, en Añadir a pantalla de inicio, y funciona como una app. En Android también aparece al compartir fotos desde otras apps.",
  },
  {
    q: "¿Cómo gano más espacio gratis?",
    a: "Invitando a amigos. Por cada amigo que guarde su primera foto, tú ganas 2 GB y él 1 GB, hasta 20 GB extra. También puedes canjear un código si te dan uno.",
  },
  {
    q: "¿Cuándo habrá planes de pago?",
    a: "Muy pronto. Habrá planes con más espacio y archivos más grandes. Si quieres que te avisemos, pulsa Avísame dentro de la app, en Espacio y plan.",
  },
  {
    q: "¿Puedo borrar mi cuenta y mis archivos?",
    a: "Sí, cuando quieras y tú solo, desde Ajustes. Se borran tus archivos y tus datos. Antes puedes descargarlo todo en un ZIP.",
  },
  {
    q: "¿Hay límite de tamaño por archivo?",
    a: "Sí, depende del plan. En el plan Gratis cada archivo puede pesar hasta 2 GB. Los planes de pago, cuando lleguen, permitirán archivos más grandes.",
  },
] as const;
