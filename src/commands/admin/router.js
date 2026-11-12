import { REST, Routes } from "discord.js";
import { renderPublicPanel } from "../../panels/public.js";
import { notice, V2 } from "../../panels/ui.js";
import { parseDate } from "../../services/plans.js";
import { ack, actorFrom, present } from "../../components/reply.js";
import { adminCommands } from "./commands.js";
import { storeCommands } from "../../loja/commands.js";
import { handleStoreCommand } from "../../loja/router.js";
import { renderAttendance } from "../../loja/attendance.js";

const UUID = "([0-9a-f-]{36})";
const SNOWFLAKE = "(\\d{17,20})";

function field(interaction, id) {
  return interaction.fields.getTextInputValue(id).trim();
}

function selected(interaction, id) {
  return interaction.fields.getStringSelectValues(id)[0];
}

export async function registerCommands(config) {
  if (!config.token || !config.clientId || !config.allowedGuildIds.length) return;
  const rest = new REST({ version: "10" }).setToken(config.token);
  const body = [...adminCommands(), ...storeCommands()];
  for (const guildId of config.allowedGuildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body });
      console.log(`Comandos registrados no servidor ${guildId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao registrar comandos no servidor ${guildId}: ${message}`);
    }
  }
}

export async function routeCommand(interaction, app) {
  const actor = actorFrom(interaction);
  const name = interaction.commandName;
  if (!app.admin.isAdmin(actor)) {
    await ack(interaction, false);
    await present(interaction, notice("Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode usar este comando.", app.config.panelColor));
    return;
  }
  if (name === "editar-cliente") {
    const user = interaction.options.getUser("usuario");
    const opened = app.admin.beginModal("edit", interaction.guildId, user.id);
    if (opened.error) {
      await ack(interaction, false);
      await present(interaction, opened.error);
      return;
    }
    await interaction.showModal(opened.modal);
    return;
  }
  await ack(interaction, false);
  if (await handleStoreCommand(interaction, app, actor)) return;
  if (name === "painel-publicar") {
    const payload = renderPublicPanel({
      accent: app.config.panelColor,
      emojis: app.admin.pack(interaction.guildId),
      supportUrl: app.admin.supportUrl(interaction.guildId),
      bannerUrl: app.config.bannerUrl,
    });
    const message = await interaction.channel.send({ components: payload.components, flags: V2, allowedMentions: { parse: [] } });
    app.repo.rememberPanel({ guildId: interaction.guildId, channelId: interaction.channelId, messageId: message.id, now: Date.now() });
    await present(interaction, notice("Painel publicado neste canal.", app.config.panelColor));
    return;
  }
  if (name === "adicionar-cliente") {
    await present(interaction, app.admin.addPicker(interaction.guildId));
    return;
  }
  if (name === "remover-cliente") {
    await present(interaction, app.admin.removePreview(interaction.guildId, actor, interaction.options.getUser("usuario").id));
    return;
  }
  if (name === "buscar-cliente") {
    await present(interaction, app.admin.search(interaction.guildId, actor, interaction.options.getString("termo")));
    return;
  }
  if (name === "listar-clientes") {
    await present(interaction, app.admin.list(interaction.guildId, actor, 0));
    return;
  }
  if (name === "listar-vms") {
    await present(interaction, await app.admin.listAzureVms(interaction.guildId, actor, 0));
    return;
  }
  if (name === "renovar-plano") {
    const start = interaction.options.getString("inicio") || "";
    const expiry = interaction.options.getString("vencimento") || "";
    if ((start && !parseDate(start)) || (expiry && !parseDate(expiry))) {
      await present(interaction, notice("Use datas DD/MM/AAAA ou AAAA-MM-DD.", app.config.panelColor));
      return;
    }
    await present(interaction, app.admin.renewPreview(interaction.guildId, actor, {
      userId: interaction.options.getUser("usuario").id,
      plan: interaction.options.getString("plano"),
      start,
      expiry,
    }));
    return;
  }
  if (name === "configurar") {
    const sub = interaction.options.getSubcommand();
    if (sub === "suporte") {
      const url = interaction.options.getString("url");
      let parsed = "";
      try {
        const value = new URL(url);
        if (value.protocol === "https:" || value.protocol === "http:") parsed = value.toString();
      } catch {
        parsed = "";
      }
      if (!parsed) {
        await present(interaction, notice("Informe uma URL http ou https.", app.config.panelColor));
        return;
      }
      await present(interaction, app.admin.updateSettings(interaction.guildId, actor, { supportUrl: parsed }));
      return;
    }
    if (sub === "logs") {
      const channel = interaction.options.getChannel("canal");
      await present(interaction, app.admin.updateSettings(interaction.guildId, actor, { logChannelId: channel.id }));
      return;
    }
    if (sub === "emoji") {
      const key = interaction.options.getString("nome");
      const value = interaction.options.getString("valor").trim();
      await present(interaction, app.admin.updateSettings(interaction.guildId, actor, { emoji: { [key]: value } }));
      return;
    }
  }
  await present(interaction, notice("Comando não reconhecido.", app.config.panelColor));
}

export async function routeAdminComponent(interaction, app) {
  const id = interaction.customId ?? "";
  if (!id.startsWith("atlas:admin:") && !id.startsWith("atlas:modal:add:") && !id.startsWith("atlas:modal:edit:") && !id.startsWith("atlas:attend:")) return false;
  const actor = actorFrom(interaction);
  const guildId = interaction.guildId;
  if (!app.admin.isAdmin(actor)) {
    await ack(interaction, false);
    await present(interaction, notice("Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode fazer isso.", app.config.panelColor));
    return true;
  }
  if (id.startsWith("atlas:attend:")) {
    await ack(interaction, true);
    const patch = id.endsWith("role")
      ? { supportRoleId: interaction.values?.[0] }
      : id.endsWith("category")
        ? { ticketCategoryId: interaction.values?.[0] }
        : { logChannelId: interaction.values?.[0] };
    app.admin.updateSettings(guildId, actor, patch);
    if (patch.ticketCategoryId) {
      app.store.settings(guildId);
      const current = app.repo.storeSettings(guildId);
      app.repo.saveStore({ ...current, ticketCategoryId: patch.ticketCategoryId, updatedAt: Date.now() });
    }
    await present(interaction, renderAttendance(app.repo.getSettings(guildId), app.config.panelColor));
    return true;
  }
  if (id === "atlas:admin:add:user") {
    const userId = interaction.values?.[0];
    const opened = app.admin.beginModal("add", guildId, userId);
    if (opened.error) {
      await ack(interaction, true);
      await present(interaction, opened.error);
      return true;
    }
    await interaction.showModal(opened.modal);
    return true;
  }
  const draftButton = new RegExp(`^atlas:admin:draft:([23]):${UUID}$`).exec(id);
  if (draftButton) {
    if (draftButton[1] === "3") {
      await ack(interaction, true);
      await present(interaction, await app.admin.vmPicker(guildId, actor, draftButton[2], 0));
      return true;
    }
    const opened = app.admin.continueModal(guildId, actor, draftButton[2], draftButton[1]);
    if (opened.error) {
      await ack(interaction, true);
      await present(interaction, opened.error);
      return true;
    }
    await interaction.showModal(opened.modal);
    return true;
  }
  const specs = new RegExp(`^atlas:modal:(add|edit):specs:${UUID}$`).exec(id);
  if (specs) {
    await ack(interaction, false);
    const result = app.admin.applySpecs({
      guildId,
      actor,
      draftId: specs[2],
      fields: { gpu: selected(interaction, "gpu"), vcpus: field(interaction, "vcpus"), ram: field(interaction, "ram") },
    });
    await present(interaction, result.payload);
    return true;
  }
  const step = new RegExp(`^atlas:modal:(add|edit):([123]):(.+)$`).exec(id);
  if (step) {
    await ack(interaction, false);
    const kind = step[1];
    const number = step[2];
    const token = step[3];
    let result;
    if (number === "1") {
      result = app.admin.applyStep1({
        guildId,
        actor,
        kind,
        targetUserId: token,
        fields: { clientName: field(interaction, "nome"), machineName: field(interaction, "maquina") },
      });
    } else if (number === "2") {
      result = app.admin.applyStep2({
        guildId,
        actor,
        draftId: token,
        fields: {
          publicIp: field(interaction, "ip"),
          rdpUser: field(interaction, "usuario"),
          password: interaction.fields.getTextInputValue("senha"),
          plan: selected(interaction, "plano"),
        },
      });
    } else {
      result = app.admin.applyStep3({
        guildId,
        actor,
        draftId: token,
        fields: { start: field(interaction, "inicio"), expiry: field(interaction, "vencimento"), infraId: field(interaction, "infra") },
      });
    }
    await present(interaction, result.payload);
    return true;
  }
  const vmPick = new RegExp(`^atlas:admin:vmpick:${UUID}$`).exec(id);
  if (vmPick) {
    await ack(interaction, true);
    await present(interaction, await app.admin.pickVm(guildId, actor, vmPick[1], interaction.values?.[0] ?? ""));
    return true;
  }
  const vmPage = new RegExp(`^atlas:admin:vmpage:(\\d+):(prev|next):${UUID}$`).exec(id);
  if (vmPage) {
    await ack(interaction, true);
    const next = vmPage[2] === "next" ? Number(vmPage[1]) + 1 : Number(vmPage[1]) - 1;
    await present(interaction, await app.admin.vmPicker(guildId, actor, vmPage[3], next));
    return true;
  }
  const vmDates = new RegExp(`^atlas:admin:vmdates:${UUID}$`).exec(id);
  if (vmDates) {
    const opened = app.admin.continueModal(guildId, actor, vmDates[1], "3");
    if (opened.error) {
      await ack(interaction, true);
      await present(interaction, opened.error);
      return true;
    }
    await interaction.showModal(opened.modal);
    return true;
  }
  const azurePage = /^atlas:admin:azurepage:(\d+):(prev|next)$/.exec(id);
  if (azurePage) {
    await ack(interaction, true);
    const next = azurePage[2] === "next" ? Number(azurePage[1]) + 1 : Number(azurePage[1]) - 1;
    await present(interaction, await app.admin.listAzureVms(guildId, actor, next));
    return true;
  }
  const save = new RegExp(`^atlas:admin:save:${UUID}$`).exec(id);
  if (save) {
    await ack(interaction, true);
    await present(interaction, await app.admin.save(guildId, actor, save[1]));
    return true;
  }
  const renew = new RegExp(`^atlas:admin:renew:save:${UUID}$`).exec(id);
  if (renew) {
    await ack(interaction, true);
    await present(interaction, await app.admin.renewSave(guildId, actor, renew[1]));
    return true;
  }
  const cancel = new RegExp(`^atlas:admin:cancel:${UUID}$`).exec(id);
  if (cancel) {
    await ack(interaction, true);
    await present(interaction, app.admin.cancel(guildId, actor, cancel[1]));
    return true;
  }
  const remove = new RegExp(`^atlas:admin:remove:yes:${SNOWFLAKE}$`).exec(id);
  if (remove) {
    await ack(interaction, true);
    await present(interaction, await app.admin.remove(guildId, actor, remove[1]));
    return true;
  }
  if (id === "atlas:admin:remove:no") {
    await ack(interaction, true);
    await present(interaction, notice("Remoção cancelada.", app.config.panelColor));
    return true;
  }
  const page = /^atlas:admin:list:(prev|next):(\d+)$/.exec(id);
  if (page) {
    await ack(interaction, true);
    const current = Number(page[2]);
    await present(interaction, app.admin.list(guildId, actor, page[1] === "next" ? current + 1 : current - 1));
    return true;
  }
  await ack(interaction, false);
  await present(interaction, notice("Este controle não está mais ativo.", app.config.panelColor));
  return true;
}
