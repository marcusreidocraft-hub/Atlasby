import { MessageFlags } from "discord.js";
import { describeResult } from "./messages.js";
import { renderNotice } from "./ui.js";
import { renderEntraWait } from "./entra-ui.js";

function editFlags(interaction) {
  if (interaction.azureDeferred === "reply") return MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
  return MessageFlags.IsComponentsV2;
}

async function report(interaction, payload) {
  const body = { ...payload, flags: editFlags(interaction) };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(body);
    else await interaction.reply(body);
  } catch {
    try {
      await interaction.followUp(body);
    } catch {
      // A interação já expirou.
    }
  }
}

async function entraGo(interaction, work, { fresh = false } = {}) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      if (fresh || interaction.isModalSubmit?.()) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        interaction.azureDeferred = "reply";
      } else {
        await interaction.deferUpdate();
        interaction.azureDeferred = "update";
      }
    }
    await interaction.editReply({ ...renderEntraWait(), flags: editFlags(interaction) });
    const result = await work();
    if (result?.view) await report(interaction, result.view);
    else await report(interaction, renderNotice(describeResult(result ?? { code: "azure_failed" }), { update: true }));
  } catch (error) {
    const code = error?.code === "azure_timeout" ? "azure_timeout" : error?.code === "entra_forbidden" ? "entra_forbidden" : "azure_failed";
    await report(interaction, renderNotice(describeResult({ code }), { update: true }));
  }
  return true;
}

function searchFrom(token) {
  if (!token || token === "all") return "";
  try {
    return Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export async function routeEntraButton(interaction, entra) {
  const customId = interaction.customId ?? "";
  const guildId = interaction.guildId;
  const actorId = interaction.user.id;
  if (!customId.startsWith("atlasby:entra:") && customId !== "atlasby:vmcfg:entra") return false;
  if (customId === "atlasby:vmcfg:entra") return entraGo(interaction, () => entra.list(guildId, actorId, 0, ""));
  if (customId === "atlasby:entra:search") {
    await interaction.showModal(entra.searchModal());
    return true;
  }
  const page = /^atlasby:entra:page:(\d+):(all|[A-Za-z0-9_-]{1,80})$/.exec(customId);
  if (page) return entraGo(interaction, () => entra.list(guildId, actorId, Number(page[1]), searchFrom(page[2])));
  const open = /^atlasby:entra:open:([0-9a-f-]{36})$/.exec(customId);
  if (open) return entraGo(interaction, () => entra.open(guildId, actorId, open[1]));
  if (customId.startsWith("atlasby:entra:pass:")) {
    const userId = customId.slice("atlasby:entra:pass:".length);
    if (/^[0-9a-f-]{36}$/.test(userId)) return entraGo(interaction, () => entra.passwordPrompt(guildId, actorId, userId, false));
  }
  const yes = /^atlasby:entra:yespass:([0-9a-f-]{36}):([01])$/.exec(customId);
  if (yes) return entraGo(interaction, () => entra.applyGeneratedPassword(guildId, actorId, yes[1], yes[2] === "1"));
  const type = /^atlasby:entra:passtype:([0-9a-f-]{36})$/.exec(customId);
  if (type) {
    await interaction.showModal(entra.passwordModal(type[1]));
    return true;
  }
  const methods = /^atlasby:entra:methods:([0-9a-f-]{36})$/.exec(customId);
  if (methods) return entraGo(interaction, () => entra.methods(guildId, actorId, methods[1]));
  const yesMethod = /^atlasby:entra:yesmethod:([0-9a-f-]{36}):([0-9a-f]{16})$/.exec(customId);
  if (yesMethod) return entraGo(interaction, () => entra.deleteMethod(guildId, actorId, yesMethod[1], yesMethod[2]));
  const all = /^atlasby:entra:all:([0-9a-f-]{36})$/.exec(customId);
  if (all) return entraGo(interaction, () => entra.methodsConfirm(guildId, actorId, all[1]));
  const yesAll = /^atlasby:entra:yesall:([0-9a-f-]{36})$/.exec(customId);
  if (yesAll) return entraGo(interaction, () => entra.deleteAllMethods(guildId, actorId, yesAll[1], false));
  const yesOut = /^atlasby:entra:yesallout:([0-9a-f-]{36})$/.exec(customId);
  if (yesOut) return entraGo(interaction, () => entra.deleteAllMethods(guildId, actorId, yesOut[1], true));
  const link = /^atlasby:entra:link:([0-9a-f-]{36})$/.exec(customId);
  if (link) return entraGo(interaction, () => entra.linkPicker(guildId, actorId, link[1]));
  const yesLink = /^atlasby:entra:yeslink:([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(customId);
  if (yesLink) return entraGo(interaction, () => entra.link(guildId, actorId, yesLink[1], yesLink[2]));
  return true;
}

export async function routeEntraSelect(interaction, entra) {
  const customId = interaction.customId ?? "";
  const selected = interaction.values?.[0] ?? "";
  const guildId = interaction.guildId;
  const actorId = interaction.user.id;
  if (customId === "atlasby:entra:pick") return entraGo(interaction, () => entra.open(guildId, actorId, selected));
  const method = /^atlasby:entra:method:([0-9a-f-]{36})$/.exec(customId);
  if (method) return entraGo(interaction, () => entra.methodPrompt(guildId, actorId, method[1], selected));
  const link = /^atlasby:entra:link:([0-9a-f-]{36})$/.exec(customId);
  if (link) return entraGo(interaction, () => entra.linkPrompt(guildId, actorId, link[1], selected));
  if (!customId.startsWith("atlasby:entra:")) return false;
  return true;
}

export async function routeEntraModal(interaction, entra) {
  const customId = interaction.customId ?? "";
  if (customId === "atlasby:modal:entra:search") {
    const search = interaction.fields.getTextInputValue("busca").trim();
    return entraGo(interaction, () => entra.list(interaction.guildId, interaction.user.id, 0, search), { fresh: true });
  }
  const password = /^atlasby:modal:entra:password:([0-9a-f-]{36})$/.exec(customId);
  if (password) {
    return entraGo(interaction, () => entra.applyTypedPassword(
      interaction.guildId,
      interaction.user.id,
      password[1],
      interaction.fields.getTextInputValue("senha"),
      interaction.fields.getTextInputValue("forcar"),
    ), { fresh: true });
  }
  return false;
}
