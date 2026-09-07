import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

/**
 * Login único de Telegram. Genera el TELEGRAM_SESSION que va en .env.
 *
 *   1. Entra en https://my.telegram.org → API development tools → crea una app.
 *      Apunta api_id y api_hash.
 *   2. Crea un canal privado (o grupo) que hará de almacén. Añade tu cuenta.
 *   3. Ejecuta:  TELEGRAM_API_ID=... TELEGRAM_API_HASH=... pnpm --filter @upscale/api tg-login
 *   4. Pega el session string en .env como TELEGRAM_SESSION, y el id del canal
 *      (te lo imprime al final) como TELEGRAM_CHANNEL_ID.
 */

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";
if (!apiId || !apiHash) {
  console.error("Faltan TELEGRAM_API_ID y TELEGRAM_API_HASH (de my.telegram.org).");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber: async () => await input.text("Número de teléfono (con +34…): "),
  password: async () => await input.text("Contraseña 2FA (si tienes): "),
  phoneCode: async () => await input.text("Código que te ha llegado a Telegram: "),
  onError: (e) => console.error(e),
});

console.log("\n=== TELEGRAM_SESSION (ponlo en .env) ===\n");
console.log(client.session.save());
console.log("\n=== Tus canales/grupos (elige el que hará de almacén) ===\n");

for await (const dialog of client.iterDialogs({})) {
  if (dialog.isChannel || dialog.isGroup) {
    console.log(`${dialog.title}  ->  TELEGRAM_CHANNEL_ID=${dialog.id}`);
  }
}

await client.disconnect();
process.exit(0);
