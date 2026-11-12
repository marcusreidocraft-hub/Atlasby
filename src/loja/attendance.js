import { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, PermissionFlagsBits, RoleSelectMenuBuilder } from "discord.js";
import { isAdmin } from "../services/admin.js";
import { container, text } from "../panels/ui.js";
import { emojiText } from "./emojis.js";

export function attendanceOf(repo, config, guildId) {
  const settings = repo.getSettings(guildId);
  const store = repo.storeSettings?.(guildId);
  const supportRoleId = settings.supportRoleId || "";
  return {
    supportRoleId,
    categoryId: settings.ticketCategoryId || store?.ticketCategoryId || "",
    logChannelId: settings.logChannelId || config.adminLogChannelId || "",
    staffRoleIds: [...new Set([...(supportRoleId ? [supportRoleId] : []), ...(config.adminRoleIds || [])])],
  };
}

export function canAttend(actor, config, attendance) {
  if (isAdmin(actor, config)) return true;
  return Boolean(attendance.supportRoleId) && (actor.roleIds || []).includes(attendance.supportRoleId);
}

export function ticketOverwrites({ everyoneId, userId, botId, staffRoleIds }) {
  return [
    { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
  ];
}

export function renderAttendance(settings, accent) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text([
      `## ${emojiText("staff")} Atendimento`,
      `Cargo de suporte: ${settings.supportRoleId ? `<@&${settings.supportRoleId}>` : "não definido"}`,
      `Categoria dos tickets: ${settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : "não definida"}`,
      `Canal de logs: ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não definido"}`,
      "O cargo vê e assume os tickets e é mencionado quando um pedido abre. Os logs recebem transações, transcrições e alertas de provisionamento.",
      "Se um campo ficar vazio, vale `ADMIN_ROLE_IDS` ou `ADMIN_LOG_CHANNEL_ID`.",
    ].join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId("atlas:attend:role").setPlaceholder("Cargo de suporte").setMinValues(1).setMaxValues(1),
    ));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId("atlas:attend:category").setPlaceholder("Categoria dos tickets").addChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1),
    ));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId("atlas:attend:logs").setPlaceholder("Canal de logs").addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1),
    ));
  });
}
