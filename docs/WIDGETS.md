# Widgets

Poner fotos, álbumes, notas, recuerdos y el espacio usado **en la pantalla de inicio, de fondo de pantalla o como marco de fotos**, sin app nativa y sin servicios de pago.

## Cómo funciona

Una web no puede crear widgets del sistema por sí sola (iPhone: WidgetKit; Android: App Widgets). Pero casi todo lo que sabe hacer un widget es **mostrar una imagen de internet**. Así que cada widget de Upscale es una *vista configurable* que el servidor **dibuja como imagen** en una dirección privada:

`/_api/v1/w/<llave>.png?s=small|medium|large` (o `&w=…&h=…`)

- **iPhone** → la app gratuita **Scriptable** muestra esa imagen como widget; el constructor genera el script listo para pegar.
- **Android** → cualquier app de widgets que acepte «imagen desde una dirección web» (por ejemplo KWGT); el constructor da las tres direcciones (pequeño/mediano/grande).
- **Fondo de pantalla** → se descarga la imagen a la medida exacta del aparato (6 tamaños de iPhone/Android/tablet), con la opción de dejar libre la parte de arriba para el reloj de la pantalla de bloqueo.
- **Marco de fotos** → `/w/<llave>`: pantalla completa que cambia sola cada 5–120 s, con la pantalla siempre encendida (Wake Lock) y la hora opcional; se puede añadir a la pantalla de inicio.

## Tipos

| Tipo | Qué dibuja | Opciones |
|---|---|---|
| Una foto | Una o varias fotos de la biblioteca (hasta 30) | rotación (fija/día/hora/cada vez), marco (sin/borde/polaroid), esquinas |
| Mosaico | 2, 4, 6 o 9 fotos: últimas, favoritas, de un álbum o elegidas | separación, rotación, esquinas; la última fila incompleta reparte el ancho |
| Un álbum | Portada con nombre y nº de elementos | mostrar nombre, portada fija o rotatoria |
| Una nota | La nota con **su propio estilo** (fondo, degradado, recuadro, letra, alineación); el texto crece hasta llenar | mostrar título; las tareas salen como ☐/☑ |
| Recuerdos | Fotos de este día en años anteriores («Hace 2 años»); sin ninguna, una foto cualquiera | rotación |
| Mi espacio | Anillo con lo usado, plan y recuento de fotos/vídeos/audio/notas | — |

Todo se actualiza solo: si cambias la nota, la foto o el álbum, el widget cambia con ellos. Si el contenido desaparece (nota a la papelera, foto borrada) el widget enseña un aviso en vez de romperse.

## Seguridad

- La **llave** (192 bits al azar) va en la dirección porque los widgets no pueden mandar cabeceras. Solo permite ver **el dibujo de ese widget**: nunca la cuenta, ni los originales, ni otros widgets. Solo se usan los derivados que ya están en la base de datos (miniatura 640 px y póster 1600 px), nunca Telegram.
- **Nueva dirección** (botón en cada widget) crea otra llave y la anterior deja de funcionar al instante; borrar el widget mata su dirección.
- Al crear o editar, el servidor comprueba que **fotos, álbum y nota son de la propia cuenta** (400 si no) y solo guarda campos conocidos.
- Límites: 20 widgets por cuenta, 30 fotos por widget, lado de imagen entre 64 y 2800 px, 120 peticiones/min por dirección IP en el endpoint público, vista previa 90/min, 4 dibujos a la vez (el resto espera) y caché de 30 s.
- El marco es `noindex` y sin referrer. Borrar la cuenta borra sus widgets.

## Datos (`027_widgets.sql`)

`widgets(id, user_id, token unique, name, kind, config jsonb, position, created_at, updated_at, last_used)`.

## API

Con sesión: `GET/POST /v1/widgets` · `PATCH/DELETE /v1/widgets/:id` · `POST /v1/widgets/:id/regenerate` · `POST /v1/widgets/preview` (dibuja sin guardar) · `GET /v1/widgets/:id/image` (con `download=1` y `wallpaper=1`).
Pública: `GET /v1/w/<llave>.png|.jpg|.json` (el `.json` da los datos de la nota/espacio/álbum para apps que quieran pintarlos ellas).

## En el móvil

- **Asistente de una decisión por pantalla** (qué → contenido → aspecto), con barra de progreso y una barra de acciones fija abajo que ocupa el sitio de las pestañas (`body[data-enfoque]`). La vista previa ya no es «fija» (en pantallas pequeñas se pisaba con el contenido): va en bloque, solo cuando ya hay algo que enseñar.
- **Un toque**: «Mis recuerdos de hoy», «Mosaico de mis últimas/favoritas» y «Mi espacio» se crean sin elegir nada y abren directamente «Ponlo en tu pantalla».
- **Desde la biblioteca**: *Seleccionar* → marcar fotos → **Widget** abre el asistente ya en el paso 2 con esas fotos (`/app/widgets/nuevo?fotos=id,id`).
- **Medidas**: botones de al menos 48 px, tipos en 2 columnas, fotos en cuadrícula de 3, álbumes y notas como filas anchas con miniatura, campos de 16 px (iOS no hace zoom), selector de fotos e «instalar» como hojas a pantalla completa con la acción abajo y márgenes de zona segura.
- **Instalar**: tres caminos (Fondo de pantalla, Widget, Marco de fotos); el Widget se divide en iPhone (pasos numerados con botones a la App Store y a Scriptable) y Android (KWGT).

## Dónde se crean

Menú de la cuenta → **Widgets**; «Poner en mi pantalla (widget)» en el menú «Más» de cada nota; «Widget del álbum» en cada álbum.

## Pruebas hechas

Motor: los 6 tipos en 3 tamaños (30–140 ms). API: aislamiento entre cuentas (400/404 en crear, previsualizar, ver, editar, borrar, regenerar), llaves inventadas o con símbolos, medidas absurdas (se acotan), contenido borrado, nueva dirección. Navegador: lista con vistas en vivo, constructor con vista previa, selector de fotos múltiple, diálogo de instalación (script copiado, fondo 1179×2556 descargado), marco sin sesión con cambio de imagen; axe sin violaciones (claro/oscuro, móvil/escritorio).

## Límites honestos

Los widgets de iPhone necesitan **Scriptable** (gratis) y los de Android una app de widgets que acepte imágenes web: no son «widgets nativos de Upscale». Un widget propio sin apps intermedias exigiría una app nativa (iPhone: Apple Developer 99 $/año; Android: 25 $ una vez); ver `docs/PENDIENTE.md`.
