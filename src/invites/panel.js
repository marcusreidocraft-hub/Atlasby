import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { press, separator, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { statusLabel } from "./model.js";

export const INVITE_EMOJI = Object.freeze({
  gift: "<:giveaway:1568512709388009502>",
  star: "<:star:1568512980033863820>",
  timer: "<:timer:1568512986484711425>",
  member: "<:47106member:1568512616584843324>",
  add: "<:1906add:1568512602873794594>",
  link: "<:externallink:1568512703763324971>",
  verified: "<:53136verified:1568512623639797863>",
  left: "<:disactiv:1568512700739362897>",
  warning: "<:5577warning:1568512629847101531>",
});

export const INVITE_PAGE = 6;

function line(content) {
  return new TextDisplayBuilder().setContent(content);
}

function tierLine(tier) {
  return `${INVITE_EMOJI.star} **${tier.invites} convites** = ${tier.label}`;
}

function progressLine(summary) {
  if (!summary.next) return "Você alcançou a última meta.";
  return `Próxima meta: **${summary.next.invites} convites** · ${summary.next.label} · faltam **${summary.remaining}**`;
}

export function renderInvitePanel(tiers) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.gift} Convites com bonificação`,
    "Convide pessoas para a Atlas Cloud PC. O convite começa pendente e só fica válido depois de 24 horas no servidor. Se a pessoa sair, o convite volta e deixa de contar.",
  ].join("\n")));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(line(["### Metas", ...tiers.map(tierLine)].join("\n")));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press("atlas:invite:create", "Criar convite", ButtonStyle.Primary, INVITE_EMOJI.add),
  ));
  return { components: [root], flags: V2 };
}

export function renderInviteCard({ userId, url, code, summary, joins = null, page = 0 }) {
  const root = new ContainerBuilder();
  const slice = joins || summary.joins.slice(Math.max(0, page) * INVITE_PAGE, Math.max(0, page) * INVITE_PAGE + INVITE_PAGE);
  const pages = Math.max(1, Math.ceil(summary.total / INVITE_PAGE));
  const current = Math.min(page, pages - 1);
  const people = slice.length
    ? slice.map((join) => `${INVITE_EMOJI.member} <@${join.memberId}> · <t:${Math.floor(join.joinedAt / 1000)}:f> · **${statusLabel(join)}**`).join("\n")
    : "Ninguém entrou por este convite ainda.";
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.link} Seu convite`,
    "```",
    url,
    "```",
    `Código: \`${code}\``,
    `${INVITE_EMOJI.verified} Válidos: **${summary.valid}**`,
    `${INVITE_EMOJI.timer} Pendentes: **${summary.pending}**`,
    progressLine(summary),
  ].join("\n")));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(line(`### Convidados · página ${current + 1}/${pages}\n${people}`));
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Abrir convite").setURL(url);
  root.addActionRowComponents(new ActionRowBuilder().addComponents(button));
  const row = new ActionRowBuilder().addComponents(
    press(`atlas:invite:refresh:${userId}`, "Atualizar", ButtonStyle.Secondary, INVITE_EMOJI.timer),
  );
  if (current > 0) row.addComponents(press(`atlas:invite:page:${userId}:${current - 1}`, "Anterior", ButtonStyle.Secondary));
  if (current + 1 < pages) row.addComponents(press(`atlas:invite:page:${userId}:${current + 1}`, "Próxima", ButtonStyle.Secondary));
  root.addActionRowComponents(row);
  return { components: [root], flags: V2_EPHEMERAL };
}

export function renderValidated(summary, memberId) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.verified} Convite válido`,
    `<@${memberId}> completou 24 horas na Atlas Cloud PC.`,
    `Convites válidos: **${summary.valid}**`,
    progressLine(summary),
  ].join("\n")));
  return { components: [root], flags: V2 };
}

export function renderLeaveNotice(summary, memberId, wasValid) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.left} Um convidado saiu`,
    `<@${memberId}> saiu do servidor.`,
    wasValid
      ? "Esse convite era válido e voltou. Ele saiu da sua contagem."
      : "Esse convite ainda estava pendente e não chegou a contar.",
    `Convites válidos agora: **${summary.valid}**`,
  ].join("\n")));
  return { components: [root], flags: V2 };
}

export function renderCongrats(rewards) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.gift} Bonificação alcançada`,
    "Você chegou a uma nova meta na Atlas Cloud PC.",
    ...rewards.map((reward) => `${INVITE_EMOJI.star} **${reward.invites} convites** · ${reward.label}`),
    "A equipe confirma a entrega. O tempo entra no plano ativo quando houver máquina vinculada.",
  ].join("\n")));
  return { components: [root], flags: V2 };
}

export function renderRewardLog({ userId, reward, valid }) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.gift} Bonificação de convite`,
    `Usuário: <@${userId}>`,
    `Meta: **${reward.invites} convites**`,
    `Recompensa: **${reward.label}**`,
    `Convites válidos: **${valid}**`,
  ].join("\n")));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press(`atlas:invite:grant:${reward.id}`, "Entregar", ButtonStyle.Success, INVITE_EMOJI.verified),
    press(`atlas:invite:deny:${reward.id}`, "Recusar", ButtonStyle.Danger, INVITE_EMOJI.left),
  ));
  return { components: [root], flags: V2 };
}

export function renderRewardResult(text) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line(text));
  return { components: [root], flags: V2 };
}

export function renderInviteAdmin(userId, summary) {
  const rewards = summary.rewards.length
    ? summary.rewards.map((reward) => `• ${reward.invites} convites · ${reward.label} · **${reward.status}**`).join("\n")
    : "Nenhuma bonificação registrada.";
  const people = summary.joins.slice(0, 15).map((join) => `• <@${join.memberId}> · ${statusLabel(join)}`).join("\n") || "Sem convidados.";
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(line([
    `## ${INVITE_EMOJI.member} Convites de <@${userId}>`,
    `${INVITE_EMOJI.verified} Válidos: **${summary.valid}**`,
    `${INVITE_EMOJI.timer} Pendentes: **${summary.pending}**`,
    `Ajuste manual: **${summary.bonus}**`,
    progressLine(summary),
    "",
    "### Convidados",
    people,
    "",
    "### Bonificações",
    rewards,
  ].join("\n")));
  const pending = summary.rewards.filter((reward) => reward.status === "aguardando").slice(0, 2);
  for (const reward of pending) {
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:invite:grant:${reward.id}`, `Entregar ${reward.invites}`, ButtonStyle.Success),
      press(`atlas:invite:deny:${reward.id}`, `Recusar ${reward.invites}`, ButtonStyle.Danger),
    ));
  }
  return { components: [root], flags: V2_EPHEMERAL };
}

export function renderRanking(rows) {
  const root = new ContainerBuilder();
  const body = rows.length
    ? rows.map((row, index) => `**${index + 1}.** <@${row.userId}> · **${row.total}** convites`).join("\n")
    : "Ainda não há convites válidos.";
  root.addTextDisplayComponents(line(`## ${INVITE_EMOJI.star} Ranking de convites\n${body}`));
  return { components: [root], flags: V2_EPHEMERAL };
}
