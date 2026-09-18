"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import type { AssetListItem } from "@upscale/shared";
import { specRows } from "@/lib/format";
import ViewerFilmstrip from "./ViewerFilmstrip";

/** Mismo corte que usa el CSS del visor para pasar a diseño móvil (globals.css). */
const MOBILE_BP = "(max-width: 860px)";

/**
 * Franja inferior del <video> donde el navegador pinta su barra NATIVA
 * (play/pausa, tiempo, buscar). Los eventos de esa barra viven en el shadow DOM
 * del propio <video>, así que BURBUJEAN hasta este contenedor: sin esta
 * exclusión, arrastrar la barra de tiempo del vídeo movía también la foto y
 * podía saltar al siguiente vídeo a mitad de búsqueda.
 */
const NATIVE_CONTROLS_H = 76;

interface Props {
  assets: AssetListItem[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
  onFavorite: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  /** pide a la galería la página siguiente; undefined = no queda nada más */
  onNeedMore?: () => void;
  /** viendo dentro de un álbum: "Borrar" solo desagrupa, no borra de la biblioteca */
  inAlbum?: boolean;
}

export default function Viewer({ assets, index, onClose, onIndex, onFavorite, onDelete, onNeedMore, inAlbum }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const open = index !== null;
  const a = open ? assets[index] : null;
  const confirmDeleteMsg = (filename: string) =>
    inAlbum
      ? `¿Quitar ${filename} de este álbum? Sigue en tu biblioteca.`
      : `Borrar ${filename}? Es definitivo.`;

  // Móvil: visor a pantalla completa estilo Fotos — barras que se ocultan al
  // tocar la imagen, hoja de datos técnicos que sube desde abajo en vez de
  // panel fijo, deslizar hacia abajo para cerrar. En escritorio no cambia nada.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BP);
    setMobile(mq.matches);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  // arrastre de la foto: vertical cierra el visor, horizontal pasa a la
  // siguiente/anterior — y esta última DE VERDAD sigue al dedo en vivo, con la
  // vecina asomando por el borde (como Fotos/Instagram), no un corte al soltar.
  const dragY = useMotionValue(0);
  const dragX = useMotionValue(0);
  // la vecina entra desde el borde opuesto según hacia dónde se arrastra;
  // calc(...) es relativo al ancho de la propia imagen, no a la pantalla.
  const nextPeekX = useTransform(dragX, (x) => `calc(100% + ${x}px)`);
  const prevPeekX = useTransform(dragX, (x) => `calc(-100% + ${x}px)`);
  // sensación de profundidad: según se arrastra, la foto actual se encoge y
  // atenúa un pelín mientras la vecina gana tamaño y opacidad — así se siente
  // que una empuja a la otra, no dos pegatinas planas deslizándose.
  const dragAbs = useTransform(dragX, (x) => Math.abs(x));
  const dragScale = useTransform(dragAbs, [0, 260], [1, 0.94], { clamp: true });
  const dragOpacity = useTransform(dragAbs, [0, 260], [1, 0.9], { clamp: true });
  const peekScale = useTransform(dragAbs, [0, 260], [0.94, 1], { clamp: true });
  const peekOpacity = useTransform(dragAbs, [0, 260], [0.7, 1], { clamp: true });
  // `id` = pointerId del dedo que manda. Un segundo dedo (pinza, o el típico
  // roce con el pulgar al sujetar el móvil) NO reescribe el gesto en marcha:
  // antes lo hacía y la foto pegaba un salto, o al levantar el primer dedo se
  // decidía el cambio de foto con las coordenadas del OTRO.
  const gesture = useRef({ id: -1, active: false, x0: 0, y0: 0, t0: 0, axis: null as null | "x" | "y" });
  // animación de "se completa el paso a la siguiente": se guarda para poder
  // pararla si el usuario vuelve a tocar (antes el dedo y la animación se
  // peleaban por el mismo valor) o si el visor se cierra a mitad (antes el
  // `.then()` llamaba a onIndex DESPUÉS de cerrar y el visor se reabría solo).
  const swipe = useRef<{ controls: { stop: () => void }; dir: number } | null>(null);
  useEffect(() => {
    setChromeVisible(true);
    setSheetOpen(false);
    // si el gesto de la foto anterior se quedó "activo" por lo que sea (ver
    // onLostPointerCapture más abajo), no puede colarse a la foto nueva —
    // arrancar cada foto con el gesto limpio de verdad.
    gesture.current = { id: -1, active: false, x0: 0, y0: 0, t0: 0, axis: null };
    dragY.set(0);
    dragX.set(0);
  }, [a?.id, dragY, dragX]);

  const [videoState, setVideoState] = useState<"loading" | "ready" | "error" | "slow">("loading");
  const [buffering, setBuffering] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  const liveRef = useRef<HTMLVideoElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Al pasar a otro archivo (o al cerrar el visor) el <video> anterior se
  // desmonta, pero el navegador puede seguir descargando su buffer un buen
  // rato — con originales de varios GB eso es ancho de banda robado al vídeo
  // que SÍ estás viendo. Se corta a mano. Ojo: el elemento se captura en el
  // cuerpo del efecto, no en la limpieza, porque para cuando corre la limpieza
  // la ref ya apunta al vídeo NUEVO (y lo mataríamos a él).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    return () => {
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        /* el navegador ya lo había soltado */
      }
    };
  }, [a?.id]);

  useEffect(() => {
    setVideoState("loading");
    setBuffering(false);
    setLivePlaying(false);
    if (!a || a.kind !== "video") return;
    // 8s en vez de 20: si un vídeo tarda en arrancar (bitrate alto sin copia
    // ligera aún, o un hipo de Telegram), mejor avisar pronto con la opción
    // de descargar que dejar 20s de spinner mudo sin explicar qué pasa.
    const t = setTimeout(() => setVideoState((s) => (s === "loading" ? "slow" : s)), 8000);
    return () => clearTimeout(t);
  }, [a?.id, a?.kind]);


  // Mientras miras uno, se va pidiendo el arranque del siguiente y el anterior:
  // al pasar de uno a otro ya está en camino y la apertura se siente inmediata.
  // Las precargas en vuelo se cancelan al CERRAR el visor (no al cambiar de
  // foto: ahí interesa que terminen, son justo las que hacen que el vecino
  // abra al instante). Sin esto quedaban peticiones de 2 MB descargándose
  // después de cerrar, y en desarrollo el doble por el Strict Mode de React.
  const prefetches = useRef(new Set<AbortController>());
  const abortPrefetches = useCallback(() => {
    for (const ac of prefetches.current) ac.abort();
    prefetches.current.clear();
  }, []);
  useEffect(() => {
    if (index === null) return;
    const t = setTimeout(() => {
      for (const n of [index + 1, index - 1]) {
        const v = assets[n];
        if (!v) continue;
        if (v.kind === "video") {
          // 2 MB del arranque del vecino: suficiente para que empiece al
          // instante al pasar a él (con preview lista, suele ser el vídeo casi
          // entero). Rango pequeño = no le roba banda al que ves ahora.
          const ac = new AbortController();
          prefetches.current.add(ac);
          void fetch(`/api/media/${v.id}`, { headers: { Range: "bytes=0-2097151" }, signal: ac.signal })
            .catch(() => {})
            .finally(() => prefetches.current.delete(ac));
        } else if (v.posterUrl) {
          const img = new Image();
          img.src = v.posterUrl;
        }
      }
    }, 400); // sin robarle ancho de banda al que estás viendo ahora
    return () => clearTimeout(t);
  }, [index, assets]);
  useEffect(() => {
    if (!open) abortPrefetches();
  }, [open, abortPrefetches]);
  useEffect(() => abortPrefetches, [abortPrefetches]);

  // acercarse al final de lo cargado (deslizando o con el carrete) pide más
  // biblioteca: así se puede recorrer entera desde el visor, no solo las 120
  // primeras. `loadMore` ya se protege sola contra llamadas solapadas.
  useEffect(() => {
    if (index === null || !onNeedMore) return;
    if (index >= assets.length - 15) onNeedMore();
  }, [index, assets.length, onNeedMore]);

  const isLive = !!(a && a.kind === "photo" && a.isLive && a.liveVideoUrl);
  const liveStart = useCallback(() => {
    const v = liveRef.current;
    if (!v) return;
    setLivePlaying(true);
    v.currentTime = 0;
    void v.play().catch(() => setLivePlaying(false));
  }, []);
  const liveStop = useCallback(() => {
    const v = liveRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    setLivePlaying(false);
  }, []);
  // Precarga el vídeo Live en cuanto se muestra la foto: con preload="metadata"
  // el <video> no tenía ni un byte de datos bufferizado, así que el primer
  // mantener-pulsado solo disparaba la petición de red y se soltaba antes de
  // que llegara el primer frame — parecía que "no activaba" y hacían falta un
  // par de intentos más para que ya hubiera algo cacheado. Forzando el load()
  // (con preload="auto") en cuanto se entra en la foto, ya está bufferizando
  // cuando el dedo llega.
  useEffect(() => {
    if (!isLive) return;
    liveRef.current?.load();
  }, [isLive, a?.id]);

  const go = useCallback(
    (d: number) => {
      if (index === null) return;
      const n = index + d;
      if (n >= 0 && n < assets.length) onIndex(n);
    },
    [index, assets.length, onIndex],
  );

  // Gesto táctil del visor móvil: un solo dedo decide en marcha si es un toque
  // (alterna las barras), un deslizamiento horizontal (siguiente/anterior) o
  // vertical hacia abajo (cerrar) — igual que Fotos de iOS, en foto Y en
  // vídeo. En vídeo, reproducir/pausar y buscar siguen siendo los controles
  // NATIVOS del navegador (la barra típica de iPhone) — no se tocan, solo se
  // les deja hueco debajo para que no queden tapados por la barra propia.
  // Solo en móvil y nunca sobre una Live Photo (el dedo ya controla el
  // mantener pulsado).
  const onTap = useCallback(() => {
    setChromeVisible((v) => !v);
  }, []);

  /** Da por terminado YA el paso a la foto vecina que estaba animándose. */
  const settleSwipe = useCallback(() => {
    const s = swipe.current;
    if (!s) return;
    swipe.current = null;
    s.controls.stop();
    dragX.set(0);
    go(s.dir);
  }, [dragX, go]);

  const kind = a?.kind;
  const onMediaPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!mobile || isLive) return;
      if (gesture.current.active) return; // ya hay un dedo mandando: el segundo no pinta nada
      // la barra nativa del vídeo es intocable: ahí no hay gesto propio
      if (kind === "video") {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientY > r.bottom - NATIVE_CONTROLS_H) return;
      }
      settleSwipe(); // si venía una animación de paso, se cierra antes de empezar otra
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* algún navegador puede negarlo; el gesto sigue funcionando igual */
      }
      gesture.current = { id: e.pointerId, active: true, x0: e.clientX, y0: e.clientY, t0: Date.now(), axis: null };
    },
    [mobile, isLive, kind, settleSwipe],
  );
  const onMediaPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g.active || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (!g.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (g.axis === "y" && dy > 0) dragY.set(dy);
      else if (g.axis === "x") dragX.set(dx);
    },
    [dragY, dragX],
  );
  const onMediaPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g.active || e.pointerId !== g.id) return;
      g.active = false;
      g.id = -1;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ya liberado */
      }
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      const dt = Math.max(1, Date.now() - g.t0);
      if (g.axis === "x") {
        // rápido y decidido (aunque no haya llegado muy lejos) O ha cruzado un
        // tercio de la pantalla: se completa el paso. Si no, rebota a su sitio
        // — igual que Fotos: "casi lo suelto" no cuenta como haberlo soltado.
        const w = window.innerWidth;
        const committed = (Math.abs(dx) > 60 && dt < 220) || Math.abs(dx) > w * 0.32;
        const canGo = dx < 0 ? index !== null && index < assets.length - 1 : index !== null && index > 0;
        if (committed && canGo) {
          const dir = dx < 0 ? 1 : -1; // +1 = siguiente (se arrastró hacia la izquierda)
          const controls = animate(dragX, -dir * w, {
            type: "spring",
            stiffness: 380,
            damping: 38,
            velocity: (dx / dt) * 1000,
          });
          swipe.current = { controls, dir };
          void controls.then(() => {
            // si ya se cerró el visor o el usuario volvió a tocar, este remate
            // ya lo dio (o lo anuló) quien interrumpiera: aquí no se toca nada.
            if (swipe.current?.controls !== controls) return;
            swipe.current = null;
            dragX.set(0);
            go(dir);
          });
        } else {
          animate(dragX, 0, { type: "spring", stiffness: 500, damping: 34 });
        }
      } else if (g.axis === "y") {
        if (dy > 110 || (dy > 44 && dt < 250)) onClose();
        else animate(dragY, 0, { type: "spring", stiffness: 420, damping: 34 });
      } else {
        onTap();
      }
    },
    [go, onClose, dragY, dragX, index, assets.length, onTap],
  );
  /**
   * `pointercancel`: el navegador se queda el gesto (gesto del sistema, llamada
   * entrante, el dedo sale por el borde de la pantalla…). NO se decide nada con
   * las últimas coordenadas — antes compartía handler con `pointerup` y un
   * cancel a mitad podía cambiar de foto o cerrar el visor sin querer. Aquí
   * solo se devuelve todo a su sitio.
   */
  const onMediaPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g.active || e.pointerId !== g.id) return;
      g.active = false;
      g.id = -1;
      g.axis = null;
      animate(dragX, 0, { type: "spring", stiffness: 500, damping: 34 });
      animate(dragY, 0, { type: "spring", stiffness: 420, damping: 34 });
    },
    [dragX, dragY],
  );
  // `lostpointercapture`: red de seguridad ante el mismo fallo que
  // `pointercancel` pero que este SIEMPRE dispara, pase lo que pase con el
  // dedo (a diferencia de pointerup/pointercancel, que iOS a veces se traga
  // sin avisar si interpreta el gesto como el arranque de un pellizco o un
  // gesto del sistema). Sin esto, `gesture.current.active` se quedaba en
  // `true` para siempre y CUALQUIER deslizamiento siguiente se ignoraba en
  // `onMediaPointerDown` — hasta que un pellizco de 2 dedos forzaba a iOS a
  // soltar la captura y sin querer "desatascaba" el gesto.
  const onMediaLostPointerCapture = onMediaPointerCancel;

  // al cerrar el visor: se corta la animación de paso pendiente (si no, su
  // `.then()` llamaba a onIndex y el visor se REABRÍA solo un instante después)
  // y se limpia el gesto para que la próxima apertura empiece de cero.
  useEffect(() => {
    if (open) return;
    swipe.current?.controls.stop();
    swipe.current = null;
    gesture.current = { id: -1, active: false, x0: 0, y0: 0, t0: 0, axis: null };
    dragX.set(0);
    dragY.set(0);
  }, [open, dragX, dragY]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, go, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && a && (
        <motion.div
          className="viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
        >
          <motion.div
            className="viewer-stage"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Barra flotante superior — solo móvil (CSS la oculta en escritorio) */}
            <div className={`vm-top ${chromeVisible ? "" : "vm-hidden"}`}>
              <button
                className="vm-iconbtn"
                onClick={() => (sheetOpen ? setSheetOpen(false) : onClose())}
                aria-label={sheetOpen ? "Cerrar información" : "Cerrar"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            </div>

            {/*
              El gesto táctil (deslizar/tocar) va en .viewer-photo Y en
              .viewer-video — nunca en un vídeo con los controles NATIVOS del
              navegador — la barra típica de iPhone, no una hecha a mano. El
              gesto de deslizar convive con ella porque el vídeo deja hueco
              libre debajo (ver .viewer-video en el CSS): la barra nativa
              tiene su sitio propio, sin que mi barra inferior la tape, y el
              resto de la superficie del vídeo sigue respondiendo al deslizar.
              El desplazamiento vertical para cerrar es de este contenedor
              entero (`dragY`), así se ve la foto/vídeo entero deslizándose.
            */}
            <motion.div className="viewer-media" style={{ y: dragY }}>
              {a.kind === "video" ? (
                <motion.div
                  className="viewer-video"
                  style={{ x: dragX, scale: dragScale, opacity: dragOpacity }}
                  onPointerDown={onMediaPointerDown}
                  onPointerMove={onMediaPointerMove}
                  onPointerUp={onMediaPointerUp}
                  onPointerCancel={onMediaPointerCancel}
                  onLostPointerCapture={onMediaLostPointerCapture}
                >
                  <motion.video
                    key={a.id}
                    ref={videoRef}
                    src={`/api/media/${a.id}`}
                    poster={a.posterUrl ?? a.thumbUrl}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    onLoadedData={() => setVideoState("ready")}
                    onCanPlay={() => { setVideoState("ready"); setBuffering(false); }}
                    onPlaying={() => { setVideoState("ready"); setBuffering(false); }}
                    onWaiting={() => setBuffering(true)}
                    onStalled={() => setBuffering(true)}
                    onError={() => setVideoState("error")}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                  />
                  {videoState === "ready" && buffering && (
                    <div className="viewer-buffering" aria-hidden="true">
                      <span className="viewer-spin" />
                    </div>
                  )}
                  {videoState !== "ready" && (
                    <div className="viewer-loading" aria-live="polite">
                      {videoState === "error" ? (
                        <>
                          <small>No se pudo reproducir aquí.</small>
                          <a className="btn primary sm" href={`/api/dl/${a.id}`}>Descargar</a>
                        </>
                      ) : videoState === "slow" ? (
                        <>
                          <span className="viewer-spin" aria-hidden="true" />
                          <small>Está tardando en cargar…</small>
                          <a className="btn sm" href={`/api/dl/${a.id}`}>Descargar</a>
                        </>
                      ) : (
                        <>
                          <span className="viewer-spin" aria-hidden="true" />
                          <small>Preparando el vídeo…</small>
                        </>
                      )}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  className="viewer-photo"
                  style={{ x: dragX, scale: dragScale, opacity: dragOpacity }}
                  onPointerDown={isLive ? liveStart : onMediaPointerDown}
                  onPointerMove={isLive ? undefined : onMediaPointerMove}
                  onPointerUp={isLive ? liveStop : onMediaPointerUp}
                  onPointerCancel={isLive ? liveStop : onMediaPointerCancel}
                  onLostPointerCapture={isLive ? undefined : onMediaLostPointerCapture}
                  onPointerLeave={isLive ? liveStop : undefined}
                  onContextMenu={isLive ? (e) => e.preventDefault() : undefined}
                >
                  <motion.img
                    key={a.id}
                    src={a.posterUrl ?? a.thumbUrl}
                    alt={a.filename}
                    draggable={false}
                    whileTap={isLive ? undefined : { scale: 0.97 }}
                    animate={{ scale: [0.96, 1] }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  />
                  {isLive && (
                    <>
                      <video
                        ref={liveRef}
                        src={a.liveVideoUrl!}
                        className={`viewer-live ${livePlaying ? "on" : ""}`}
                        playsInline
                        preload="auto"
                        onEnded={liveStop}
                      />
                      <span className="badge live viewer-livebadge" aria-hidden="true">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                          <circle cx="12" cy="12" r="3.2" />
                          <path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
                        </svg>
                        LIVE
                      </span>
                    </>
                  )}
                </motion.div>
              )}
              {/* la vecina asoma por el borde mientras se arrastra — foto o
                  vídeo, ya que ambos llevan el mismo gesto. Nunca con Live
                  Photo (ahí el dedo ya controla el mantener pulsado). */}
              {mobile && !isLive && index !== null && index < assets.length - 1 && (
                <motion.img
                  className="vm-peek"
                  style={{ x: nextPeekX, scale: peekScale, opacity: peekOpacity }}
                  src={assets[index + 1]!.posterUrl ?? assets[index + 1]!.thumbUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              )}
              {mobile && !isLive && index !== null && index > 0 && (
                <motion.img
                  className="vm-peek"
                  style={{ x: prevPeekX, scale: peekScale, opacity: peekOpacity }}
                  src={assets[index - 1]!.posterUrl ?? assets[index - 1]!.thumbUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              )}
              {assets.length > 1 && (
                <>
                  <button className="viewer-nav prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Anterior">‹</button>
                  <button className="viewer-nav next" onClick={() => go(1)} disabled={index === assets.length - 1} aria-label="Siguiente">›</button>
                </>
              )}
            </motion.div>

            {/* Barra flotante inferior — carrete de miniaturas + acciones, solo móvil */}
            <div className={`vm-bottom ${chromeVisible ? "" : "vm-hidden"}`}>
              {assets.length > 1 && index !== null && (
                <ViewerFilmstrip assets={assets} index={index} onIndex={onIndex} />
              )}
              <div className="vm-toolbar">
                <div className="vm-pill">
                  <a className="vm-iconbtn" href={`/api/dl/${a.id}`} aria-label="Descargar">
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 19h14" /></svg>
                  </a>
                </div>
                <div className="vm-pill">
                  <button className="vm-iconbtn" onClick={() => onFavorite(a.id, !a.isFavorite)} aria-label={a.isFavorite ? "Quitar de favoritos" : "Favorito"}>
                    <svg width="21" height="21" viewBox="0 0 24 24" fill={a.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8"><path d="M12 17.3 6.2 20l1.1-6.3L2.5 9.2l6.4-.9L12 2.5l3.1 5.8 6.4.9-4.8 4.5L17.8 20z" /></svg>
                  </button>
                  <button className="vm-iconbtn" onClick={() => setSheetOpen(true)} aria-label="Información">
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" strokeLinecap="round" /><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" /></svg>
                  </button>
                </div>
                <div className="vm-pill">
                  <button
                    className="vm-iconbtn vm-danger"
                    onClick={() => {
                      if (confirm(confirmDeleteMsg(a.filename))) onDelete(a.id);
                    }}
                    aria-label={inAlbum ? "Quitar del álbum" : "Borrar"}
                  >
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.1a2 2 0 0 1-2 1.9H9.8a2 2 0 0 1-2-1.9L7 7" /></svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="viewer-panel">
              <div className="viewer-head">
                <h3>{a.filename}</h3>
                <button className="iconbtn" onClick={onClose} aria-label="Cerrar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>

              <div className="integ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
                <div>Original íntegro<small>SHA-256 {a.sha256.slice(0, 16)}… · sin recompresión</small></div>
              </div>

              <dl className="specs">
                {specRows(a).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>

              <div className="viewer-actions">
                <button
                  className={`btn ${a.isFavorite ? "primary" : ""}`}
                  onClick={() => onFavorite(a.id, !a.isFavorite)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill={a.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M12 17.3 6.2 20l1.1-6.3L2.5 9.2l6.4-.9L12 2.5l3.1 5.8 6.4.9-4.8 4.5L17.8 20z" /></svg>
                  {a.isFavorite ? "Favorito" : "Favorito"}
                </button>
                <a className="btn primary" href={`/api/dl/${a.id}`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m0 0 6-6m-6 6-6-6" /></svg>
                  Descargar
                </a>
              </div>
              <div className="viewer-actions">
                {a.liveVideoUrl && <a className="btn" href={a.liveVideoUrl}>Vídeo Live</a>}
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (confirm(confirmDeleteMsg(a.filename))) onDelete(a.id);
                  }}
                >
                  {inAlbum ? "Quitar del álbum" : "Borrar"}
                </button>
              </div>
            </div>

            {/* Hoja de información móvil — sube desde abajo al tocar el icono ⓘ */}
            <div className={`vm-scrim ${sheetOpen ? "vm-show" : ""}`} onClick={() => setSheetOpen(false)} aria-hidden="true" />
            <div className={`vm-sheet ${sheetOpen ? "vm-show" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Información del archivo">
              <div className="vm-sheet-handle" aria-hidden="true" />
              <div className="vm-sheet-head">
                <h3>{a.filename}</h3>
                <button className="vm-done" onClick={() => setSheetOpen(false)}>Hecho</button>
              </div>

              <div className="integ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
                <div>Original íntegro<small>SHA-256 {a.sha256.slice(0, 16)}… · sin recompresión</small></div>
              </div>

              <dl className="specs">
                {specRows(a).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>

              {a.liveVideoUrl && (
                <a className="btn" href={a.liveVideoUrl}>Vídeo Live</a>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
