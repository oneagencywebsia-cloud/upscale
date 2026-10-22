# Pendiente de hacer (lo dejamos para el final)

Cosas que **no se pueden hacer desde el código** (dependen de ti, de claves o de decisiones).
Tachar según se vayan haciendo. Orden sugerido: de arriba abajo.

## 1. Antes de abrir el registro a mucha gente

- [ ] **Revisión legal** de `/privacidad` y `/terminos` (los textos están escritos de buena fe y
      ajustados a lo que la app hace, pero no son asesoramiento jurídico). Los dos archivos:
      `apps/web/app/privacidad/page.tsx` y `apps/web/app/terminos/page.tsx`.
- [ ] **Variables en EasyPanel** (servicio de la **web**):
  - `LEGAL_NAME` — nombre o razón social del responsable.
  - `CONTACT_EMAIL` — correo de contacto (aparece en privacidad y términos).
  - `SITE_URL` — el dominio público definitivo (sitemap, canonical, tarjeta al compartir).
    Sin ella se deduce de la petición y funciona igual.
- [ ] **Variable en EasyPanel** (servicio de la **API**): `SUPABASE_SERVICE_ROLE_KEY`
      (Supabase → Project Settings → API → `service_role`). Es **secreta**: solo en la API, nunca
      en la web ni en el repo. Con ella «Borrar mi cuenta» también elimina el usuario de Supabase;
      sin ella se borran archivos y datos, pero el email de acceso queda.
- [ ] **Supabase → Authentication**:
  - Comprobar que **Google** está activado con sus claves (la portada ofrece el botón;
    si no está configurado, falla al pulsarlo).
  - **SMTP propio** (Authentication → SMTP Settings). El correo por defecto de Supabase tiene un
    límite muy bajo (unos pocos correos por hora): con registros reales, la confirmación de
    email dejaría de llegar. Servicios habituales: Resend, Brevo, Postmark.
  - Revisar las plantillas de correo (confirmación, recuperar contraseña) en español.
  - **Redirect URLs**: añadir el dominio definitivo.
- [ ] **Dominio propio** apuntando a EasyPanel (y HTTPS), y poner el mismo en `WEB_ORIGIN` de la API.
  - Al activar **upscale.com**: `SITE_URL=https://upscale.com` en la web (canónicas, sitemap, robots y llms se ajustan solos);
    cuando el DNS ya responda, `CANONICAL_REDIRECT=1` para mandar `www.` y el host de EasyPanel al dominio final.
  - Repetir en Google Cloud (orígenes autorizados) y en Supabase (Site URL + Redirect URLs) con el dominio nuevo.
  - Dar de alta el dominio en **Google Search Console** y **Bing Webmaster Tools**, enviar `https://upscale.com/sitemap.xml`
    y pedir la indexación de la portada y de las páginas nuevas (`/planes`, `/como-funciona`, `/formatos`, `/preguntas`, `/guias`).

## 2. Cobro de los planes (Stripe)

Hoy los planes Plus/Pro/Max figuran como «muy pronto»: se activan con un código o por lista de
espera (`/app/espacio`). Para cobrar de verdad hace falta:

- [ ] Decidir **precios y planes definitivos** (ahora son una propuesta: Plus 1,99 · Pro 4,99 ·
      Max 12,99 €/mes). Se cambian en `apps/api/src/plans.ts` **y** `apps/web/lib/plans.ts`
      (deben coincidir).
- [ ] Crear la cuenta de **Stripe** y pasarme (o poner en EasyPanel, API): `STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET` y los `price_…` de cada plan.
- [ ] Qué hay que construir (cuando se decida): `POST /v1/billing/checkout` (Stripe Checkout),
      `POST /v1/billing/portal` (gestionar/cancelar), webhook que ponga `profiles.plan` y
      `plan_until`, y sustituir «Muy pronto» por el botón real. La cuota ya se aplica sola según
      el plan (`cuotaDe` en `apps/api/src/accounts.ts`).
- [ ] Añadir a los **términos** las condiciones de pago, renovación, cancelación y desistimiento
      (obligatorio al cobrar).
- [ ] Facturación/IVA según tu situación fiscal.

## 3. Almacenamiento (riesgo conocido)

Todo se guarda en una única cuenta de Telegram. Los Términos de la API permiten a Telegram cortar
el acceso, y el ritmo medido ronda 3,5 MB/s sostenidos. Protegen las cuotas y el tope de subidas
(`UPLOAD_MAX_CONCURRENT`, `UPLOAD_MAX_PER_USER`).

- [ ] Decidir el **disparador** para pasar a almacenamiento propio (propuesta: al pasar de
      ~50 usuarios activos o ~500 GB totales, o ante cualquier aviso de Telegram).
- [ ] Preparar el destino: bucket **Cloudflare R2** (o S3 compatible) y las variables de `r2.ts`;
      la app ya soporta `STORAGE_DRIVER=r2` sin tocar nada más. Falta el **script de migración**
      de lo ya guardado en Telegram (no escrito).
- [ ] Hacer copia de seguridad periódica de la base de datos (Postgres) y comprobar que se puede restaurar.

## 4. Revisiones manuales rápidas

- [ ] Probar en el **iPhone**: el fondo animado (interruptor en Perfil → Preferencias), subir
      varias fotos y un vídeo, y el botón «Seleccionar».
- [ ] Registrar una cuenta de prueba con **email real** de principio a fin (correo de
      confirmación → entrar → subir → invitar → canjear `BIENVENIDA` → borrar cuenta).
- [ ] Probar el enlace de invitación con otra cuenta nueva (`/?ref=CODIGO`).
- [ ] Mirar la portada en un buscador de pruebas (Google Search Console) cuando haya dominio,
      y enviar `sitemap.xml`.

## 5. Decisiones tomadas (para que no se pierdan)

- **Telegram** se mantiene como almacenamiento para todos, pero **oculto en la interfaz**
  (solo lo ve el administrador). La política de privacidad lo nombra por transparencia.
- **Sin mapa** (decidido en el PR #2).
- La cuenta de **administración** (la de la ingesta atada) no se puede borrar desde la app.
- Planes de pago: «muy pronto» hasta que haya cobro. Nada se cobra hoy.

## 6. Ideas para más adelante

- Compartir un álbum con un enlace público (hoy todo es privado).
- Aviso por email cuando una cuenta se acerca al límite de espacio.
- Panel de administración (usuarios, uso, códigos) en vez de llamadas a la API.
- Subida desde una app instalable con subida en segundo plano (hoy es web/PWA).
