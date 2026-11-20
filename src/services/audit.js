import { randomUUID } from "node:crypto";
import { MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

function safeDetail(detail, secrets) {
  let text = String(detail ?? "").slice(0, 500);
  for (const secret of secrets) {
    if (secret && text.includes(secret)) return "Registro sem detalhes porque o texto continha um segredo.";
  }
  return text;
}

export function createAudit({ repo, config, now, deliverLog }) {
  return {
    async record({ guildId, actorId, action, targetUserId = null, machineName = null, detail, secrets = [] }) {
      const clean = safeDetail(detail, secrets);
      repo.addLog({ id: randomUUID(), guildId, actorId, action, targetUserId, machineName, detail: clean, now: now() });
      const settings = repo.getSettings(guildId);
      const channelId = settings.logChannelId || config.adminLogChannelId || "";
      if (!channelId || !deliverLog) return { logged: true, delivered: false };
      const container = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${action}**\n${clean}\nAutor: <@${actorId}>${targetUserId ? `\nCliente: <@${targetUserId}>` : ""}`));
      try {
        const delivered = await Promise.race([
          deliverLog(channelId, {
          components: [container],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
          }),
          new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
        return { logged: true, delivered: Boolean(delivered) };
      } catch {
        return { logged: true, delivered: false };
      }
    },
  };
}
