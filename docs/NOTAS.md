# Notas

Escribir notas, adjuntar capturas, extraer su texto para editarlo, personalizar el aspecto, y encontrarlo todo luego. Sin servicios de pago y sin guardar archivos en el servidor.

## Qué hay

| Parte | Cómo funciona |
|---|---|
| **Editor** | TipTap (ProseMirror). Títulos, negrita, cursiva, subrayado, tachado, resaltado, color, listas, tareas, citas, código, enlaces, separador. Autoguardado a los 0,9 s, «Guardado / Guardando… / Sin conexión · reintentando». Se vuelca al salir o ocultar la pestaña. Ctrl/⌘+S guarda ya. |
| **Capturas + texto** | Subir, pegar o arrastrar una imagen, o elegir una de la biblioteca. La imagen va a la biblioteca (Telegram) y se enlaza a la nota. Tesseract lee el texto (`spa+eng`) y se enseña en un cuadro **editable**; «Añadir a la nota» lo inserta, «Copiar» lo copia. El texto leído también se guarda (`note_assets.ocr_text`) para que la búsqueda encuentre palabras que solo salen en la captura. |
| **Personalización** | 12 estilos (Tema, Post-it, Menta, Cielo, Rosa, Lavanda, Papel, Cuaderno, Pizarra, Medianoche, Atardecer, Océano) y a mano: fondo (color o degradado con ángulo), color del texto, recuadro (estilo, grosor, color, esquinas), sombra, fuente, tamaño, interlineado, alineación y margen. Aviso si el contraste texto/fondo es menor de 4,5:1. |
| **Organización** | Etiquetas (hasta 10), fijadas, archivo, papelera de 30 días con «Deshacer», búsqueda (título, texto y capturas), vista rejilla o lista, exportar texto/JSON. |
| **Dispositivos** | Móvil: pestaña «Notas» (sustituye a «Favoritos»; los favoritos siguen en el filtro ★ de la biblioteca), panel de estilo como hoja inferior, sin atajos de teclado en los textos. Ordenador: atajos y arrastrar. Los textos con teclado/ratón dependen de `useTeclado()` (`lib/dispositivo.ts`). |

## Datos (`026_notes.sql`)

- `notes`: `body` (jsonb, documento del editor), `body_text` (texto plano), `style` (jsonb), `tags`, `pinned`, `archived_at`, `deleted_at`, `search` (tsvector `spanish` generado), índices por usuario/fecha, GIN en `search` y `tags`.
- `note_assets`: nota ↔ foto de la biblioteca, `position`, `ocr_text`, `ocr_at`. Borrar la foto o la nota limpia el enlace.
- Límites: 5000 notas por cuenta, 30 capturas por nota, 10 etiquetas, 100 000 caracteres de texto.

## API (todo requiere sesión; cada consulta filtra por `user_id`)

`GET/POST /v1/notes` · `GET/PATCH/DELETE /v1/notes/:id` (`?permanent=1` solo desde la papelera) · `POST /v1/notes/:id/restore` · `DELETE /v1/notes/trash` · `GET /v1/notes/tags` · `POST/DELETE /v1/notes/:id/attachments[/:assetId]` · `POST /v1/notes/:id/attachments/:assetId/ocr` · `GET …/text` · `POST /v1/ocr`.

- **Concurrencia**: `PATCH` acepta `baseUpdatedAt`; si otra pestaña ya cambió la nota responde **409** con la versión actual y el editor deja elegir «Usar la otra» o «Guardar la mía». Adjuntar o quitar capturas **no** toca `updated_at` (es el testigo del texto) para no provocar falsos conflictos.
- **Seguridad del contenido**: `sanitizarDoc` (`apps/api/src/notes/doc.ts`) acepta solo una lista blanca de nodos y marcas, enlaces `http/https/mailto/tel`, colores `#hex`, profundidad ≤ 12 y ≤ 20 000 nodos. `normalizarEstilo` valida cada campo del estilo. Nada de HTML crudo.
- **Límites de uso**: OCR 20/min por cuenta; creación 60/min; guardado 240/min.

## Lectura de texto (OCR)

`apps/api/src/ocr.ts`. Tesseract por `execFile` con argumentos en array (sin shell). Se lee el **original** (no la miniatura), se prepara (orientación, fondo blanco, gris, ampliar si es pequeña, reducir si es enorme) y se ejecuta con `--psm 3`. Máximo 2 a la vez (`OCR_CONCURRENCY`), 60 s cada una (`OCR_TIMEOUT_MS`), imágenes de hasta 60 MB. Los idiomas son `OCR_LANGS` (por defecto `spa+eng`). Si Tesseract no está instalado, la API responde 503 con un mensaje claro y el resto de las notas funciona.

Los Dockerfiles instalan `tesseract-ocr`, `tesseract-ocr-spa` y `tesseract-ocr-eng` (≈ 60 MB). **Ojo:** la imagen que despliega EasyPanel la construye `.github/workflows/build.yml` con el `Dockerfile` de la raíz (no con los de `infra/`): si se añade una herramienta del sistema hay que ponerla ahí. Las fotos que sharp no abre (HEIC de iPhone, TIFF, DNG…) se convierten antes con la misma cadena de decodificadores de las miniaturas.

## Cuenta

- **Borrar cuenta** elimina también todas sus notas.
- **Perfil → Copias de seguridad → Exportar notas** descarga un JSON con texto, etiquetas, estilo y documento.
- Una nota en la papelera se purga sola a los 30 días (tarea cada 6 h).

## Pruebas hechas

API con curl: CRUD, búsqueda (incluida la que solo está en la captura), aislamiento entre cuentas (404 en lectura, edición, borrado, adjuntos y OCR), 409, enlaces `javascript:`, nodos desconocidos, colores con inyección, id no válido, papelera. Navegador (Playwright): crear, formato, autoguardado y recarga, etiquetas, estilos, aviso de contraste, subir y pegar captura, OCR editable, buscar, fijar, eliminar y deshacer, papelera, conflicto entre pestañas, Tab hacia la barra, Escape en diálogos; axe sin violaciones en 4 variantes (claro/oscuro, móvil/escritorio) salvo el contraste de la barra tapada por el velo de un diálogo modal.
