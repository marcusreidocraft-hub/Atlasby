import { V2 } from "../panels/ui.js";
import { logInteractionError } from "../components/reply.js";

export function isStaleMessage(error) {
  const code = Number(error?.code);
  if (code === 10008 || code === 10003) return true;
  const text = `${error?.message ?? ""} ${error?.rawError?.message ?? ""}`.toLowerCase();
  return text.includes("unknown message") || text.includes("unknown channel");
}

export function isEmojiRejection(error) {
  if (Number(error?.code) !== 50035) return false;
  return /emoji/i.test(JSON.stringify(error?.rawError ?? error?.message ?? ""));
}

export function stripComponentEmojis(components) {
  const raw = (components || []).map((item) => (typeof item?.toJSON === "function" ? item.toJSON() : item));
  const clone = JSON.parse(JSON.stringify(raw));
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    delete node.emoji;
    for (const value of Object.values(node)) walk(value);
  };
  walk(clone);
  return clone;
}

export function panelBody(view, { plain = false } = {}) {
  return {
    components: plain ? stripComponentEmojis(view.components) : view.components,
    flags: view.flags ?? V2,
    allowedMentions: { parse: [] },
  };
}

export async function deliverComponents(action, view) {
  try {
    return await action(panelBody(view));
  } catch (error) {
    if (!isEmojiRejection(error)) throw error;
    logInteractionError(error);
    return action(panelBody(view, { plain: true }));
  }
}

export function panelLocation({ currentChannelId, nextChannelId, messageId }) {
  if (nextChannelId !== currentChannelId) return { channelId: nextChannelId, messageId: "" };
  return { channelId: nextChannelId, messageId: messageId || "" };
}

export async function publishStorePanel({ channelId, settings, view, fetchMessage, edit, send }) {
  if (settings?.channelId === channelId && settings?.messageId) {
    try {
      const message = await fetchMessage(settings.channelId, settings.messageId);
      await deliverComponents((body) => edit(message, body), view);
      return { created: false, channelId, messageId: settings.messageId };
    } catch (error) {
      logInteractionError(error);
    }
  }
  const message = await deliverComponents((body) => send(body), view);
  return { created: true, channelId, messageId: message.id };
}
