import { notice, V2_EPHEMERAL } from "../../panels/ui.js";
import { renderPasswordStatus } from "../../panels/control.js";
import { ack, present } from "../reply.js";

const UUID = "([0-9a-f-]{36})";

export async function routeClient(interaction, app) {
  const id = interaction.customId ?? "";
  if (!id.startsWith("atlas:panel:") && !id.startsWith("atlas:vm:") && !id.startsWith("atlas:modal:format:") && id !== "atlas:modal:moonlight" && id !== "atlas:modal:password") return false;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const actor = {
    id: userId,
    permissions: interaction.member?.permissions?.bitfield ?? interaction.member?.permissions ?? 0n,
    roleIds: interaction.member?.roles?.cache ? [...interaction.member.roles.cache.keys()] : [],
    owner: interaction.guild?.ownerId === userId,
  };
  const formatModalId = new RegExp(`^atlas:modal:format:${UUID}$`).exec(id);
  if (formatModalId) {
    await ack(interaction, false);
    const phrase = interaction.fields.getTextInputValue("frase");
    await present(interaction, await app.clients.confirmFormat(guildId, userId, formatModalId[1], phrase));
    return true;
  }
  const formatYes = new RegExp(`^atlas:vm:format:yes:${UUID}$`).exec(id);
  if (formatYes) {
    const modal = app.clients.formatModal(guildId, userId, formatYes[1]);
    if (!modal) {
      await ack(interaction, false);
      await present(interaction, await app.clients.cancelFormat(guildId, userId, formatYes[1]));
      return true;
    }
    await interaction.showModal(modal);
    return true;
  }
  const formatNo = new RegExp(`^atlas:vm:format:no:${UUID}$`).exec(id);
  if (formatNo) {
    await ack(interaction, true);
    await present(interaction, await app.clients.cancelFormat(guildId, userId, formatNo[1]));
    return true;
  }
  if (id === "atlas:panel:control") {
    await ack(interaction, false);
    await present(interaction, await app.clients.open(guildId, userId));
    return true;
  }
  if (id === "atlas:vm:refresh" || id === "atlas:vm:status") {
    await ack(interaction, true);
    await present(interaction, await app.clients.refresh(guildId, userId));
    return true;
  }
  if (id === "atlas:vm:power") {
    await ack(interaction, true);
    await present(interaction, await app.clients.togglePower(guildId, userId));
    return true;
  }
  if (id === "atlas:panel:plan") {
    await ack(interaction, false);
    await present(interaction, app.clients.plan(guildId, userId));
    return true;
  }
  if (id === "atlas:vm:pin") {
    const opened = app.clients.pinStart(guildId, userId);
    if (opened.modal) {
      await interaction.showModal(opened.modal);
      return true;
    }
    await ack(interaction, false);
    await present(interaction, opened.payload);
    return true;
  }
  if (id === "atlas:modal:moonlight") {
    await ack(interaction, false);
    await present(interaction, await app.clients.submitPin(guildId, userId, interaction.fields.getTextInputValue("pin").trim()));
    return true;
  }
  if (id === "atlas:vm:unpair") {
    await ack(interaction, false);
    await present(interaction, await app.clients.askUnpair(guildId, userId));
    return true;
  }
  const unpairYes = new RegExp(`^atlas:vm:unpair:yes:${UUID}$`).exec(id);
  if (unpairYes) {
    await ack(interaction, true);
    await present(interaction, await app.clients.confirmUnpair(guildId, userId, unpairYes[1]));
    return true;
  }
  const unpairNo = new RegExp(`^atlas:vm:unpair:no:${UUID}$`).exec(id);
  if (unpairNo) {
    await ack(interaction, true);
    await present(interaction, await app.clients.cancelUnpair(guildId, userId, unpairNo[1]));
    return true;
  }
  if (id === "atlas:vm:rdp") {
    await ack(interaction, false);
    await present(interaction, await app.clients.reveal(guildId, userId, "rdp"));
    return true;
  }
  if (id === "atlas:vm:format") {
    await ack(interaction, false);
    await present(interaction, await app.clients.askFormat(guildId, userId));
    return true;
  }
  if (id === "atlas:vm:password") {
    const opened = app.clients.passwordStart(guildId, actor);
    if (opened.modal) {
      await interaction.showModal(opened.modal);
      return true;
    }
    await ack(interaction, false);
    await present(interaction, opened.payload);
    return true;
  }
  if (id === "atlas:modal:password") {
    await ack(interaction, false);
    await present(interaction, app.clients.acceptPassword(guildId, actor, {
      password: interaction.fields.getTextInputValue("nova"),
      confirm: interaction.fields.getTextInputValue("confirmar"),
    }));
    return true;
  }
  const passwordYes = new RegExp(`^atlas:vm:password:yes:${UUID}$`).exec(id);
  if (passwordYes) {
    await ack(interaction, false);
    await present(interaction, renderPasswordStatus("Aplicando..."));
    const payload = await app.clients.applyPassword(guildId, actor, passwordYes[1]);
    await interaction.editReply({ components: payload.components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    return true;
  }
  const passwordNo = new RegExp(`^atlas:vm:password:no:${UUID}$`).exec(id);
  if (passwordNo) {
    await ack(interaction, true);
    await present(interaction, app.clients.cancelPassword(guildId, userId, passwordNo[1]));
    return true;
  }
  await ack(interaction, false);
  await present(interaction, notice("Este controle não está mais ativo.", app.config.panelColor));
  return true;
}
