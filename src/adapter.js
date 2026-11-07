import { ChannelType, ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

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
        type: channel.type === ChannelType.GuildText ? "GuildText" : "other",
        permissions: permissions?.bitfield ?? 0n,
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
