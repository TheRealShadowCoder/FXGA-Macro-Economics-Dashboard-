import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const rl = createInterface({ input, output });

try {
  const apiId = Number(process.env.TELEGRAM_API_ID || await rl.question("Telegram API ID: "));
  const apiHash = process.env.TELEGRAM_API_HASH || await rl.question("Telegram API hash: ");
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("Valid TELEGRAM_API_ID and TELEGRAM_API_HASH are required.");
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: () => rl.question("Telegram phone number (international format): "),
    password: () => rl.question("Telegram 2FA password (if enabled): "),
    phoneCode: () => rl.question("Telegram login code: "),
    onError: error => console.error(error?.message || error)
  });

  console.log("\nTELEGRAM_SESSION (store this as a secret; never commit it):\n");
  console.log(client.session.save());
  await client.disconnect();
} finally {
  rl.close();
}
