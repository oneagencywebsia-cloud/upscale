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
  { t: "Idéntico al original", d: "Ni un píxel menos. Lo guardamos tal cual sale de tu cámara, y lo descargas igual." },
  { t: "Fotos, vídeo, audio… y notas", d: "Apunta lo que quieras recordar. Pega una captura y Upscale lee su texto para que lo edites." },
  { t: "Se abre en cualquier aparato", d: "¿Una foto HEIC que no abre en tu PC? La descargas en JPG con un toque. Y tu vídeo, en MP4." },
  { t: "Subidas que no se rompen", d: "Si se corta la conexión, reintenta solo. Y comprobamos que llegue entero antes de guardarlo." },
  { t: "Solo tuyo", d: "Cada persona ve únicamente lo suyo. Nadie más, ni por error." },
  { t: "Te lo llevas cuando quieras", d: "Descarga toda tu biblioteca en un ZIP o borra tu cuenta. Sin letra pequeña." },
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
    a: "No. Guardamos tu foto o vídeo exactamente como lo hiciste, sin perder nada de calidad. Cuando lo descargas es idéntico.",
  },
  {
    q: "¿Cuánto costará pasar a un plan de pago?",
    a: "Los precios previstos son Plus 1,99 €/mes, Pro 4,99 €/mes y Max 12,99 €/mes. Aún no hay cobro: empiezas gratis y te avisamos cuando se activen.",
  },
  {
    q: "¿Puedo guardar notas y capturas de pantalla?",
    a: "Sí. Escribes notas con formato y adjuntas capturas: Upscale lee el texto de la imagen y te lo deja listo para editar. Puedes personalizar el color y el aspecto de cada nota.",
  },
  {
    q: "¿Qué tipos de archivo puedo guardar?",
    a: "Fotos, vídeos y música de cualquier tipo. Si tu móvil lo hace, Upscale lo guarda.",
  },
  {
    q: "¿Quién puede ver mis archivos?",
    a: "Solo tú. Cada cuenta ve únicamente lo suyo, y para verlo hay que entrar con tu cuenta.",
  },
  {
    q: "¿Puedo llevarme todo si me voy?",
    a: "Sí. Puedes descargar todo cuando quieras, tal cual lo subiste.",
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
    a: "Sí. Al descargar eliges entre «Fácil de abrir» y «Original». «Fácil de abrir» convierte lo que no se abre en todas partes (por ejemplo, las fotos del iPhone) y «Original» te da el archivo exacto.",
  },
  {
    q: "¿Cómo descargo muchas fotos de golpe?",
    a: "Selecciónalas y descárgalas de una vez. Si son muchas, Upscale las reparte en partes cómodas para el móvil y te enseña una barra de progreso.",
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
    a: "Sí, cuando quieras y tú solo, desde Ajustes. Se borran tus archivos y tus datos. Antes puedes descargarlo todo.",
  },
  {
    q: "¿Hay límite de tamaño por archivo?",
    a: "Sí, depende del plan. En el plan Gratis cada archivo puede pesar hasta 2 GB. Los planes de pago, cuando lleguen, permitirán archivos más grandes.",
  },
] as const;
