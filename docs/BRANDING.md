# Upscale — identidad

## Nombre

**Upscale.** Dos lecturas:

1. **Subir** (upload) tu carrete a la nube.
2. **De gama alta** (upscale) — tus fotos guardadas al máximo nivel, sin recortes de
   calidad.

Nota: Upscale **no** reescala ni "mejora" la imagen con IA. Guarda el **original
exacto**. El nombre habla del nivel de tu biblioteca, no de tocar los píxeles.

Palabra corta, directa, internacional. Nombre elegido por Ángel.

## Idea de una frase

> Sube tu carrete del iPhone a la nube y guárdalo en su máxima calidad —mismos
> píxeles, mismos fotogramas, mismos bits—. Descárgalo idéntico cuando quieras.

## Taglines

- Principal: **"Tus fotos, al máximo."**
- Alternas: "Sube sin perder nada." · "El original, a salvo."

## Voz

Serena y precisa. Los datos técnicos (resolución, códec, fps, bitrate, hash) se
enseñan como prueba de que el original está íntegro. Verbos claros: **Subir**,
**Descargar original**, **Verificar**. Sin literatura.

## Sistema visual — "Liquid Glass" (iOS 26), atmosférico

Cristal translúcido, desenfoque real, profundidad — con carácter de **cielo al
anochecer**: azul-negro frío y un acento cian de cielo. **Dark-first**; el tema claro
es cielo alto (blanco frío).

### Firma: el subrayado

El logotipo **`upscale`** en Hanken Grotesk 800, minúsculas, va **subrayado** con una
línea de 3 px en degradado cian con un leve glow. Es el único adorno de la marca y su
seña de identidad — la línea que "sube" bajo la palabra. Nada de halos, prismas ni
tiras de película.

### Color

| Token | Dark (twilight) | Claro (cielo alto) | Uso |
|---|---|---|---|
| `--night` | `#0A0D14` | `#EEF1F7` | Fondo. Azul-negro elegido, sesgo frío. |
| `--surface` | `#141926` | `#FFFFFF` | Superficie sólida. |
| `--glass` | `rgba(18,24,38,.55)` | `rgba(255,255,255,.62)` | Paneles con `backdrop-filter`. |
| `--stroke` | `rgba(200,220,255,.10)` | `rgba(17,23,37,.11)` | Filos 1px. |
| `--light` / `--text-dim` | `#EEF2FB` / `#98A2B8` | `#111725` / `#55607A` | Texto. |
| `--accent` | `#4FC5DC` | `#1E90AE` | **El único tono de UI**: cian de cielo. Subrayado, botones, foco, selección. |
| `--danger` | `#F16B6B` | `#D0524F` | Semántico: borrar. |

El elemento seleccionado en la galería se rodea de un **glow cian**, no de un borde duro.

### Tipografía

| Rol | Fuente | Por qué |
|---|---|---|
| Display / logotipo / títulos | **Hanken Grotesk** (700–800) | Humanista-geométrica, cálida y clara. No es Inter ni Space Grotesk. |
| Cuerpo / UI | **Public Sans** | Neutra, muy legible, poco vista. |
| Datos / ficha técnica | **IBM Plex Mono** | La ficha se lee como lectura de instrumento. |

### Logotipo

**Símbolo** (`apps/web/public/brand/upscale-mark.svg`, componente `BrandMark`): un
cristal de anochecer (azul-negro `#18264a → #0a0d14`) con un sol cálido en la esquina
(el halo `#ffe3a8 → cian`, heredado de la bola de luz que había antes) y, encima:

- **Tres peldaños que suben** — la *escala*. Chevrones en degradado cian
  (`#b6f1fb → #7adcec → #3fb4cf`), cada uno más fino y más tenue que el de abajo.
- **La línea de la marca** — el subrayado, convertido en horizonte, con su glow.
- **El punto de luz** al final de la línea (el mismo punto que cierra el subrayado del
  logotipo), cálido sobre el cristal.

En la app el símbolo respira: los peldaños se iluminan de abajo arriba y el punto
late (solo opacidad/escala; se apaga con `prefers-reduced-motion`).

**Logotipo horizontal**: símbolo + `upscale` en Hanken Grotesk 800 (convertido a
trazos, no depende de la fuente), con `up` en el acento y el subrayado cónico con su
punto de luz.

| Archivo | Uso |
|---|---|
| `public/brand/upscale-mark.svg` | Símbolo suelto (esquinas redondeadas). Avatares, redes, README. |
| `public/brand/upscale-logo-dark.svg` | Logotipo para **fondos oscuros** (texto claro). |
| `public/brand/upscale-logo-light.svg` | Logotipo para **fondos claros** (texto oscuro). |
| `public/icon.svg`, `app/icon.svg` | Favicon / icono de la PWA. |
| `public/icon-maskable.svg` | Icono *maskable* (a sangre, símbolo al 72 % para la zona segura). |
| `public/icon-192.png`, `icon-512.png`, `favicon-32.png`, `app/apple-icon.png` | Rasterizados del símbolo. |

Reglas: respetar un margen libre de media altura de peldaño alrededor; no
recolorear los peldaños (el único acento es el cian); no usar el símbolo por debajo
de 24 px (a 16 px se pierde el tercer peldaño; vale el favicon de 32).

## Mockup

Galería (hoja por fechas + inspector con ficha técnica y chip de integridad),
estado real de trabajo:
https://claude.ai/code/artifact/885c8db0-ef92-4dbb-a9ba-2bff42864067

Nombres previos descartados: "Fotón", "Negativo", "Nimbo".
