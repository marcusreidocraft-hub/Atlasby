import { GatewayIntentBits } from "discord.js";
import { attendanceOf } from "../loja/attendance.js";
import { detectInviter } from "./model.js";
import { renderCongrats, renderLeaveNotice, renderRewardLog, renderValidated } from "./panel.js";
import { V2 } from "../panels/ui.js";

function snapshot(list) {
  return [...list.values()].map((invite) => ({
    code: invite.code,
    uses: Number(invite.uses) || 0,
    inviterId: invite.inviter?.id || "",
    bot: Boolean(invite.inviter?.bot),
  }));
}

async function featuredUses(guild) {
  const method = guild["fetch" + "Vani" + "tyData"];
  if (typeof method !== "function") return 0;
  try {
    const data = await method.call(guild);
    return Number(data?.uses) || 0;
  } catch {
    return 0;
  }
}

async function dm(client, userId, view) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ components: view.components, flags: V2, allowedMentions: { parse: [] } });
    return true;
  } catch {
    console.warn(`Convites: privado fechado ou indisponível para ${userId}.`);
    return false;
  }
}

export function createInviteTracker({ book, repo, config }) {
  const cache = new Map();
  const featured = new Map();
  const allowed = (guildId) => config.allowedGuildIds.includes(guildId);

  async function refresh(guild) {
    try {
      const list = await guild.invites.fetch();
      cache.set(guild.id, snapshot(list));
      featured.set(guild.id, await featuredUses(guild));
      return true;
    } catch {
      console.warn(`Convites: sem a permissão Gerenciar Servidor em ${guild.name || guild.id}. O rastreio não lê os links deste servidor.`);
      return false;
    }
  }

  function noteInvite(invite) {
    const guildId = invite.guild?.id;
    if (!guildId || !allowed(guildId)) return;
    const current = (cache.get(guildId) || []).filter((item) => item.code !== invite.code);
    current.push({ code: invite.code, uses: Number(invite.uses) || 0, inviterId: invite.inviter?.id || "", bot: Boolean(invite.inviter?.bot) });
    cache.set(guildId, current);
  }

  function forgetInvite(invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    cache.set(guildId, (cache.get(guildId) || []).filter((item) => item.code !== invite.code));
  }

  async function postRewards(client, guildId, userId, rewards, valid) {
    if (!rewards.length) return;
    await dm(client, userId, renderCongrats(rewards));
    const logId = attendanceOf(repo, config, guildId).logChannelId;
    if (!logId) {
      console.warn(`Convites: sem canal de logs em ${guildId}. A bonificação ficou aguardando no comando /convites ver.`);
      return;
    }
    const channel = await client.channels.fetch(logId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    for (const reward of rewards) {
      const view = renderRewardLog({ userId, reward, valid });
      await channel.send({ components: view.components, flags: V2, allowedMentions: { parse: [] } }).catch(() => {});
    }
  }

  return {
    book,
    noteInvite,
    forgetInvite,
    refresh,
    async warm(client) {
      const intents = client.options?.intents;
      if (!intents?.has?.(GatewayIntentBits.GuildMembers) || !intents?.has?.(GatewayIntentBits.GuildInvites)) {
        console.warn("Convites: ative os intents Guild Members e Guild Invites no portal do Discord. Sem Guild Members o bot não recebe quem entra ou sai.");
      }
      for (const guild of client.guilds.cache.values()) {
        if (allowed(guild.id)) await refresh(guild);
      }
    },
    async createPersonal(guild, user) {
      const settings = book.settings(guild.id);
      if (!settings.channelId) return { ok: false, error: "A equipe ainda não definiu o canal dos convites. Use /convites canal." };
      const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) return { ok: false, error: "O canal dos convites não está disponível." };
      const saved = repo.inviteLink(guild.id, user.id);
      if (saved) {
        const list = await guild.invites.fetch().catch(() => null);
        const found = list?.get?.(saved.code);
        if (found) return { ok: true, code: found.code, url: `https://discord.gg/${found.code}` };
      }
      try {
        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: "Convite pessoal da Atlas Cloud PC" });
        repo.saveInviteLink({ guildId: guild.id, userId: user.id, code: invite.code, channelId: channel.id, createdAt: Date.now() });
        noteInvite(invite);
        return { ok: true, code: invite.code, url: `https://discord.gg/${invite.code}` };
      } catch {
        return { ok: false, error: "Não consegui criar o convite. O bot precisa de Gerenciar Servidor e Criar Convite nesse canal." };
      }
    },
    async onJoin(member) {
      if (!allowed(member.guild.id) || member.user?.bot) return;
      const before = cache.get(member.guild.id) || [];
      const featuredBefore = featured.get(member.guild.id) || 0;
      if (!await refresh(member.guild)) return;
      const found = detectInviter({
        before,
        after: cache.get(member.guild.id) || [],
        memberId: member.id,
        featuredDelta: (featured.get(member.guild.id) || 0) - featuredBefore,
      });
      if (found.kind !== "user") {
        console.warn(`Convites: entrada de ${member.id} sem indicador (${found.kind}).`);
        return;
      }
      const recorded = book.recordJoin({ guildId: member.guild.id, inviterId: found.inviterId, memberId: member.id, code: found.code });
      if (!recorded.ok) console.warn(`Convites: ${member.id} não entrou de novo na contagem (${recorded.reason}).`);
    },
    async onLeave(member) {
      if (!allowed(member.guild.id) || member.user?.bot) return;
      const result = book.leave(member.guild.id, member.id);
      if (!result) return;
      await dm(member.client, result.join.inviterId, renderLeaveNotice(result.summary, member.id, result.wasValid));
    },
    async sweep(client) {
      const at = Date.now();
      for (const guild of client.guilds.cache.values()) {
        if (!allowed(guild.id)) continue;
        for (const join of book.due(guild.id, at)) {
          let present = false;
          try {
            await guild.members.fetch(join.memberId);
            present = true;
          } catch (error) {
            if (error?.code !== 10007) continue;
          }
          if (!present) {
            const left = book.leave(guild.id, join.memberId, at);
            if (left) await dm(client, left.join.inviterId, renderLeaveNotice(left.summary, join.memberId, left.wasValid));
            continue;
          }
          const result = book.promote(join, at);
          if (!result) continue;
          await dm(client, result.join.inviterId, renderValidated(result.summary, result.join.memberId));
          await postRewards(client, guild.id, result.join.inviterId, result.rewards, result.summary.valid);
        }
      }
    },
    async announce(client, guildId, userId, rewards, valid) {
      await postRewards(client, guildId, userId, rewards, valid);
    },
  };
}
