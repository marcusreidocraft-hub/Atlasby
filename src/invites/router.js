import { MessageFlags } from "discord.js";
import { actorFrom, ack, present } from "../components/reply.js";
import { attendanceOf, canAttend } from "../loja/attendance.js";
import { notice, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { formatStamp } from "../services/plans.js";
import { INVITE_PAGE, renderInviteAdmin, renderInviteCard, renderInvitePanel, renderRanking, renderRewardResult } from "./panel.js";

function staff(interaction, app) {
  return canAttend(actorFrom(interaction), app.config, attendanceOf(app.repo, app.config, interaction.guildId));
}

async function showCard(interaction, app, userId, page, mode) {
  const link = app.repo.inviteLink(interaction.guildId, userId);
  if (!link) {
    const payload = notice("Crie o convite pelo botão do painel.", app.config.panelColor);
    if (mode === "update") {
      await interaction.editReply({ components: payload.components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    } else {
      await present(interaction, payload);
    }
    return;
  }
  const summary = app.invites.book.summary(interaction.guildId, userId);
  const joins = app.repo.inviteJoins(interaction.guildId, userId, INVITE_PAGE, page * INVITE_PAGE);
  const view = renderInviteCard({ userId, url: `https://discord.gg/${link.code}`, code: link.code, summary, joins, page });
  const body = { components: view.components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } };
  if (mode === "update") await interaction.editReply(body);
  else await present(interaction, view);
}

export async function routeInviteCommand(interaction, app, actor) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (sub === "painel") {
    const channel = interaction.options.getChannel("canal") ?? interaction.channel;
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
      await present(interaction, notice("Escolha um canal de texto do servidor.", app.config.panelColor));
      return;
    }
    const tiers = app.invites.book.settings(guildId).tiers;
    const view = renderInvitePanel(tiers);
    await channel.send({ components: view.components, flags: V2, allowedMentions: { parse: [] } });
    await present(interaction, notice("Painel de convites publicado neste canal.", app.config.panelColor));
    return;
  }
  if (sub === "canal") {
    const channel = interaction.options.getChannel("canal");
    app.invites.book.setChannel(guildId, channel.id);
    await present(interaction, notice(`Os convites pessoais saem de <#${channel.id}>.`, app.config.panelColor));
    await app.audit?.record?.({ guildId, actorId: actor.id, action: "Canal de convites", detail: `Canal <#${channel.id}>.` });
    return;
  }
  if (sub === "ver") {
    const user = interaction.options.getUser("usuario");
    await present(interaction, renderInviteAdmin(user.id, app.invites.book.summary(guildId, user.id)));
    return;
  }
  if (sub === "ajustar") {
    const user = interaction.options.getUser("usuario");
    const delta = interaction.options.getInteger("quantidade");
    if (!delta) {
      await present(interaction, notice("Informe um número diferente de zero.", app.config.panelColor));
      return;
    }
    const result = app.invites.book.adjust(guildId, user.id, delta);
    if (result.rewards.length) await app.invites.announce(interaction.client, guildId, user.id, result.rewards, result.summary.valid);
    await present(interaction, notice(`Contagem de <@${user.id}>: ${result.before} → ${result.summary.valid}.`, app.config.panelColor));
    await app.audit?.record?.({ guildId, actorId: actor.id, action: "Ajuste de convites", targetUserId: user.id, detail: `${result.before} → ${result.summary.valid}.` });
    return;
  }
  if (sub === "resetar") {
    const user = interaction.options.getUser("usuario");
    const summary = app.invites.book.reset(guildId, user.id);
    await present(interaction, notice(`A contagem de <@${user.id}> foi zerada. Bonificações já registradas continuam. Válidos agora: ${summary.valid}.`, app.config.panelColor));
    await app.audit?.record?.({ guildId, actorId: actor.id, action: "Reset de convites", targetUserId: user.id, detail: "Contagem zerada. Bonificações anteriores permanecem." });
    return;
  }
  if (sub === "ranking") {
    await present(interaction, renderRanking(app.invites.book.ranking(guildId)));
    return;
  }
  await present(interaction, notice("Comando não reconhecido.", app.config.panelColor));
}

export async function routeInviteComponent(interaction, app) {
  const id = interaction.customId ?? "";
  if (!id.startsWith("atlas:invite:")) return false;
  if (id === "atlas:invite:create") {
    await ack(interaction, false);
    const created = await app.invites.createPersonal(interaction.guild, interaction.user);
    if (!created.ok) {
      await present(interaction, notice(created.error, app.config.panelColor));
      return true;
    }
    const summary = app.invites.book.summary(interaction.guildId, interaction.user.id);
    const joins = app.repo.inviteJoins(interaction.guildId, interaction.user.id, INVITE_PAGE, 0);
    await present(interaction, renderInviteCard({ userId: interaction.user.id, url: created.url, code: created.code, summary, joins, page: 0 }));
    return true;
  }
  const refresh = /^atlas:invite:(refresh|page):(\d{17,20})(?::(\d+))?$/.exec(id);
  if (refresh) {
    if (interaction.user.id !== refresh[2]) {
      await ack(interaction, false);
      await present(interaction, notice("Este painel é de outro membro.", app.config.panelColor));
      return true;
    }
    await interaction.deferUpdate();
    await showCard(interaction, app, refresh[2], Number(refresh[3] || 0), "update");
    return true;
  }
  const decision = /^atlas:invite:(grant|deny):([0-9a-f-]{36})$/.exec(id);
  if (!decision) return false;
  if (!staff(interaction, app)) {
    await ack(interaction, false);
    await present(interaction, notice("Esta ação é restrita à equipe.", app.config.panelColor));
    return true;
  }
  const actor = actorFrom(interaction);
  const result = decision[1] === "grant"
    ? app.invites.book.deliver(decision[2], actor.id)
    : app.invites.book.refuse(decision[2], actor.id);
  const ephemeral = Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));
  await interaction.deferUpdate();
  const text = !result.ok
    ? result.error
    : decision[1] === "deny"
      ? "Bonificação recusada. A meta não será oferecida de novo."
      : result.extended
        ? `Bonificação entregue. O plano de ${result.client.machineName} vai até ${formatStamp(result.extended)}.`
        : "Bonificação marcada como entregue. Não há plano ativo: a equipe aplica o tempo manualmente.";
  await interaction.editReply({
    components: renderRewardResult(text).components,
    flags: ephemeral ? V2_EPHEMERAL : V2,
    allowedMentions: { parse: [] },
  });
  if (result.ok) {
    await app.audit?.record?.({
      guildId: interaction.guildId,
      actorId: actor.id,
      action: decision[1] === "grant" ? "Bonificação entregue" : "Bonificação recusada",
      targetUserId: result.reward.userId,
      detail: `${result.reward.invites} convites · ${result.reward.label}`,
    });
  }
  return true;
}
