import bigInt from "big-integer";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";

const botToken = required("TELEGRAM_BOT_TOKEN");
const apiId = Number(required("TELEGRAM_API_ID"));
const apiHash = required("TELEGRAM_API_HASH");
const session = required("TELEGRAM_SESSION");
const channel = required("TELEGRAM_CHANNEL");
const cutoffSeconds = 48 * 60 * 60;
const nowSeconds = Math.floor(Date.now() / 1000);

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });

try {
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error("Telegram user session is not authorized.");

  const me = await client.getMe();
  const actorId = String(me?.id ?? "");
  if (!actorId) throw new Error("Could not resolve the authenticated Telegram user.");

  const inputPeer = await client.getInputEntity(channel);
  const bot = await botApi("getMe", {});
  const botMember = await botApi("getChatMember", { chat_id: channel, user_id: bot.result.id });
  const canDelete = botMember.result?.status === "creator" || Boolean(botMember.result?.can_delete_messages);
  if (!canDelete) throw new Error("The configured Telegram bot is not an administrator with can_delete_messages in the target chat.");

  let offsetId = 0;
  let scanned = 0;
  const recentIds = [];
  const tooOldIds = [];

  while (true) {
    const result = await client.invoke(new Api.messages.GetHistory({
      peer: inputPeer,
      offsetId,
      offsetDate: 0,
      addOffset: 0,
      limit: 100,
      maxId: 0,
      minId: 0,
      hash: bigInt(0)
    }));

    const messages = Array.isArray(result?.messages) ? result.messages : [];
    if (!messages.length) break;
    scanned += messages.length;

    for (const message of messages) {
      const action = message?.action;
      const isService = message?.className === "MessageService" || message?.constructor?.name === "MessageService";
      const isAddAction = action?.className === "MessageActionChatAddUser" || action?.constructor?.name === "MessageActionChatAddUser";
      const messageActorId = String(message?.fromId?.userId ?? "");
      if (!isService || !isAddAction || messageActorId !== actorId) continue;

      const id = Number(message.id);
      const date = Number(message.date);
      if (!Number.isInteger(id) || !Number.isInteger(date)) continue;

      if (date >= nowSeconds - cutoffSeconds) recentIds.push(id);
      else tooOldIds.push(id);
    }

    const oldest = messages[messages.length - 1];
    const nextOffset = Number(oldest?.id || 0);
    if (!nextOffset || messages.length < 100 || nextOffset >= offsetId && offsetId !== 0) break;
    offsetId = nextOffset;
  }

  let deleted = 0;
  const failures = [];
  for (let i = 0; i < recentIds.length; i += 100) {
    const ids = recentIds.slice(i, i + 100);
    try {
      await botApi("deleteMessages", { chat_id: channel, message_ids: ids });
      deleted += ids.length;
    } catch (error) {
      for (const id of ids) {
        try {
          await botApi("deleteMessage", { chat_id: channel, message_id: id });
          deleted += 1;
        } catch (singleError) {
          failures.push({ id, error: String(singleError?.message || singleError).slice(0, 180) });
        }
      }
    }
  }

  console.log(JSON.stringify({
    event: "telegram_add_service_message_cleanup",
    actorMatched: true,
    scanned,
    matchingMessages: recentIds.length + tooOldIds.length,
    deletedByBot: deleted,
    tooOldForBotApi: tooOldIds.length,
    deletionFailures: failures.length,
    failureIds: failures.map(item => item.id),
    tooOldIds
  }));
} finally {
  await client.disconnect().catch(() => {});
}

async function botApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`Telegram Bot API ${method} failed: ${payload?.description || `HTTP ${response.status}`}`);
  }
  return payload;
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
