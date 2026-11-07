import { AttachmentBuilder, ChannelType, ContainerBuilder, FileBuilder, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from "discord.js";
import { renderTicket } from "./ui.js";

const TITLES = {
  warn: "Aviso registrado",
  timeout: "Timeout aplicado",
  timeout_remove: "Timeout removido",
  kick: "Membro expulso",
  ban: "Membro banido",
};

function mapMember(member) {
  return {
    id: member.id,
    permissions: member.permissions.bitfield,
    highestPosition: member.roles.highest.position,
    timedOutUntil: member.communicationDisabledUntilTimestamp ?? null,
  };
}

async function fetchTarget(guild, targetId) {
  try {
    return await guild.members.fetch(targetId);
  } catch (error) {
    if (error?.code === 10007) return null;
    throw error;
  }
}

export function createDiscordAdapter(client) {
  return {
    async getModerationContext(guildId, actorId, targetId) {
      const guild = await client.guilds.fetch(guildId);
      const actor = await guild.members.fetch(actorId);
      const bot = await guild.members.fetch(client.user.id);
      const target = await fetchTarget(guild, targetId);
      return {
        guildOwnerId: guild.ownerId,
        actor: mapMember(actor),
        bot: mapMember(bot),
        target: target ? mapMember(target) : null,
      };
    },

    async inspectActor(guildId, actorId) {
      const guild = await client.guilds.fetch(guildId);
      const actor = await guild.members.fetch(actorId);
      return {
        id: actor.id,
        permissions: actor.permissions.bitfield,
        ownerId: guild.ownerId,
        isOwner: guild.ownerId === actor.id,
      };
    },

    async inspectChannel(channelId) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.guildId || !channel.guild) return null;
      const me = channel.guild.members.me ?? (await channel.guild.members.fetch(client.user.id));
      const permissions = channel.permissionsFor(me);
      return {
        guildId: channel.guildId,
        type:
          channel.type === ChannelType.GuildText
            ? "GuildText"
            : channel.type === ChannelType.GuildCategory
              ? "GuildCategory"
              : "other",
        permissions: permissions?.bitfield ?? 0n,
        everyoneCanView: Boolean(channel.guild.roles.everyone && channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)),
      };
    },

    async guildIdentity(guildId) {
      const guild = await client.guilds.fetch(guildId);
      const me = guild.members.me ?? (await guild.members.fetch(client.user.id));
      return { everyoneId: guild.roles.everyone.id, botId: client.user.id, botPermissions: me.permissions.bitfield };
    },

    async memberHasRole(guildId, userId, roleId) {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return member.roles.cache.has(roleId);
    },

    async createTicketChannel({ guildId, name, parentId, overwrites }) {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites: overwrites.map((entry) => ({
          id: entry.id,
          allow: entry.allow.map((name) => PermissionFlagsBits[name]),
          deny: entry.deny.map((name) => PermissionFlagsBits[name]),
        })),
      });
      return { id: channel.id };
    },

    async applyOverwrites(channelId, overwrites) {
      const channel = await client.channels.fetch(channelId);
      await channel.permissionOverwrites.set(
        overwrites.map((entry) => ({
          id: entry.id,
          allow: entry.allow.map((name) => PermissionFlagsBits[name]),
          deny: entry.deny.map((name) => PermissionFlagsBits[name]),
        })),
      );
    },

    async sendTicketPanel({ channelId, ticket, avatarUrl, staffRoleId, mention }) {
      const channel = await client.channels.fetch(channelId);
      const payload = renderTicket(ticket, { avatarUrl, staffText: mention.text });
      await channel.send({ ...payload, allowedMentions: mention.allowedMentions });
      return staffRoleId;
    },

    async fetchHistoryPage(channelId, before) {
      const channel = await client.channels.fetch(channelId);
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      return [...batch.values()]
        .sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? 1 : -1))
        .map((message) => ({
          id: message.id,
          authorId: message.author.id,
          authorName: message.author.username,
          authorIsBot: Boolean(message.author.bot),
          content: message.content ?? "",
          timestamp: message.createdAt.toISOString(),
          attachments: [...message.attachments.values()].map((file) => ({ url: file.url, name: file.name })),
          embeds: message.embeds ?? [],
          components: message.components ?? [],
        }));
    },

    async deliverTranscript({ channelId, html, filename }) {
      const channel = await client.channels.fetch(channelId);
      const container = new ContainerBuilder()
        .setAccentColor(0x2b2d31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("Transcrição do ticket. O arquivo está escapado e não executa HTML."))
        .addFileComponents(new FileBuilder().setURL(`attachment://${filename}`));
      await channel.send({
        components: [container],
        files: [new AttachmentBuilder(Buffer.from(html), { name: filename })],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    },

    async deleteChannel(channelId) {
      const channel = await client.channels.fetch(channelId);
      await channel.delete("Ticket fechado depois da transcrição privada");
    },

    async editMessage(channelId, messageId, payload) {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.messages.edit(messageId, payload);
        return { ok: true, missing: false };
      } catch (error) {
        return { ok: false, missing: error?.code === 10008 };
      }
    },

    async fetchMemberAvatar(guildId, userId) {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return {
        userId,
        hasCustomAvatar: Boolean(member.avatar || member.user?.avatar),
        url: member.displayAvatarURL({ extension: "png", size: 128 }),
      };
    },

    async timeoutMember(guildId, userId, durationMs, reason) {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.timeout(durationMs, reason);
    },

    async removeTimeout(guildId, userId, reason) {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.timeout(null, reason);
    },

    async kickMember(guildId, userId, reason) {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      await member.kick(reason);
    },

    async banMember(guildId, userId, reason) {
      const guild = await client.guilds.fetch(guildId);
      await guild.members.ban(userId, { reason, deleteMessageSeconds: 0 });
    },

    async sendLog(channelId, record) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
        throw new Error("Canal de logs indisponível.");
      }
      const lines = [
        TITLES[record.action] ?? "Ação de moderação",
        `Alvo: <@${record.targetId}>`,
        `Moderador: <@${record.moderatorId}>`,
        `Motivo: ${record.reason}`,
      ];
      if (record.warningId != null) lines.push(`Aviso: ${record.warningId}`);
      if (record.extra?.durationLabel) lines.push(`Duração: ${record.extra.durationLabel}`);
      const container = new ContainerBuilder()
        .setAccentColor(record.action === "warn" ? 0xf1c40f : 0xe74c3c)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
      await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    },
  };
}
