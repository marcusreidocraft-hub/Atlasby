import { confirmationRow, renderNotice } from "./ui.js";
import { describeResult } from "./messages.js";
import { renderPendingAzure, renderVmLogPicker } from "./vm-ui.js";

function blank(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

async function go(interaction, result) {
  await present(interaction, result);
  return true;
}

async function present(interaction, result) {
  if (result?.modal) {
    await interaction.showModal(result.modal);
    return;
  }
  if (result?.pending && result.task) {
    await interaction.update(renderPendingAzure());
    const finished = await result.task();
    const payload = finished.view ?? renderNotice(describeResult(finished));
    await interaction.editReply(payload);
    if (finished.notice) await interaction.followUp(finished.notice);
    return;
  }
  if (result?.view) {
    if (result.update && !interaction.replied && !interaction.deferred) await interaction.update(result.view);
    else await interaction.reply(result.view);
    if (result.notice) await interaction.followUp(result.notice);
    return;
  }
  const row = result?.confirmationId ? confirmationRow(result.confirmationId) : null;
  const base = describeResult(result);
  const extra = result?.summary && result.code !== "confirmation_required" ? `\n${result.summary}` : "";
  const payload = renderNotice(`${base}${extra}`, { row });
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

export async function routeVmButton(interaction, vms) {
  const customId = interaction.customId ?? "";
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (customId === "atlasby:cfg:vms" || customId === "atlasby:vmcfg:home") {
    const result = await vms.admin(guildId, userId);
    await present(interaction, result.view ? { ...result, update: customId !== "atlasby:cfg:vms" ? true : interaction.message != null } : result);
    return true;
  }
  if (!customId.startsWith("atlasby:vm:") && !customId.startsWith("atlasby:vmcfg:")) return false;
  if (customId === "atlasby:vmcfg:add") {
    await interaction.showModal(vms.createModal());
    return true;
  }
  if (customId === "atlasby:vmcfg:users") return go(interaction, await vms.userPicker(guildId, userId)) ?? true;
  if (customId === "atlasby:vmcfg:details") return go(interaction, await vms.chooseVm(guildId, userId, "details")) ?? true;
  if (customId === "atlasby:vmcfg:validity") return go(interaction, await vms.chooseVm(guildId, userId, "validity")) ?? true;
  if (customId === "atlasby:vmcfg:secret") return go(interaction, await vms.chooseVm(guildId, userId, "secret")) ?? true;
  if (customId === "atlasby:vmcfg:policy") return go(interaction, await vms.requestPolicy({ guildId, actorId: userId })) ?? true;
  if (customId === "atlasby:vmcfg:log") return go(interaction, { ok: true, view: renderVmLogPicker(), update: true }) ?? true;
  if (customId === "atlasby:vmcfg:import") return go(interaction, await vms.importList(guildId, userId, 0, 0)) ?? true;
  const importPage = /^atlasby:vmcfg:importpage:(\d+):(\d+)$/.exec(customId);
  if (importPage) return go(interaction, await vms.importList(guildId, userId, Number(importPage[1]), Number(importPage[2]))) ?? true;
  const importUser = /^atlasby:vmcfg:importuser:([0-9a-f]{32})$/.exec(customId);
  if (importUser) return go(interaction, vms.importUserPicker(importUser[1])) ?? true;
  const importValidity = /^atlasby:vmcfg:importvalidity:([0-9a-f]{32})$/.exec(customId);
  if (importValidity) {
    await interaction.showModal(vms.importValidityModal(importValidity[1]));
    return true;
  }
  const importSecret = /^atlasby:vmcfg:importsecret:([0-9a-f]{32})$/.exec(customId);
  if (importSecret) {
    await interaction.showModal(vms.importSecretModal(importSecret[1]));
    return true;
  }
  const importSave = /^atlasby:vmcfg:importsave:([0-9a-f]{32})$/.exec(customId);
  if (importSave) return go(interaction, await vms.requestImport(guildId, userId, importSave[1])) ?? true;
  const power = /^atlasby:vm:power:(start|deallocate|restart):([0-9a-f-]{36})$/.exec(customId);
  if (power) return go(interaction, await vms.requestPower(guildId, userId, power[2], power[1])) ?? true;
  const yes = /^atlasby:vm:yes:(deallocate|restart):([0-9a-f-]{36})$/.exec(customId);
  if (yes) return go(interaction, await vms.confirmPower(guildId, userId, yes[2], yes[1])) ?? true;
  const no = /^atlasby:vm:no:([0-9a-f-]{36})$/.exec(customId);
  if (no) return go(interaction, { ...vms.menu(guildId, userId, no[1]), update: true }) ?? true;
  const simple = /^atlasby:vm:(connect|pin|creds|probe|plan|renew|sign|storage|support|refresh|auto|disk):([0-9a-f-]{36})$/.exec(customId);
  if (simple) {
    const vmId = simple[2];
    const action = simple[1];
    if (action === "connect") return go(interaction, vms.connect(guildId, userId, vmId)) ?? true;
    if (action === "pin") return go(interaction, await vms.releasePin(guildId, userId, vmId)) ?? true;
    if (action === "creds") return go(interaction, vms.credentials(guildId, userId, vmId)) ?? true;
    if (action === "probe") return go(interaction, await vms.probe(guildId, userId, vmId)) ?? true;
    if (action === "plan" || action === "sign" || action === "storage") return go(interaction, vms.plan(guildId, userId, vmId)) ?? true;
    if (action === "renew") return go(interaction, await vms.renew(guildId, userId, vmId)) ?? true;
    if (action === "support") return go(interaction, await vms.support(guildId, userId, vmId)) ?? true;
    if (action === "refresh") return go(interaction, await vms.refresh(guildId, userId, vmId)) ?? true;
    if (action === "auto") return go(interaction, await vms.toggleAuto(guildId, userId, vmId)) ?? true;
    if (action === "disk") {
      const result = vms.diskModal(guildId, userId, vmId);
      await present(interaction, result);
      return true;
    }
  }
  return true;
}

export async function routeVmSelect(interaction, vms) {
  const customId = interaction.customId ?? "";
  const selected = interaction.values?.[0] ?? null;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (customId === "atlasby:vm:pick") {
    await present(interaction, { ...vms.menu(guildId, userId, selected), update: true });
    return true;
  }
  const category = /^atlasby:vm:cat:([0-9a-f-]{36})$/.exec(customId);
  if (category) {
    await present(interaction, { ...vms.menu(guildId, userId, category[1], selected), update: true });
    return true;
  }
  if (customId === "atlasby:vmcfg:pickuser") {
    await present(interaction, await vms.pickLink(guildId, userId, selected));
    return true;
  }
  const link = /^atlasby:vmcfg:link:(\d{17,20})$/.exec(customId);
  if (link) {
    await present(interaction, await vms.requestLink({ guildId, actorId: userId, vmId: selected, userId: link[1] }));
    return true;
  }
  const choose = /^atlasby:vmcfg:choose:(details|validity|secret|unlink|delete)$/.exec(customId);
  if (choose) {
    if (choose[1] === "details") await present(interaction, vms.detailsModal(guildId, selected));
    else if (choose[1] === "validity") await present(interaction, vms.validityModal(guildId, selected));
    else if (choose[1] === "secret") await present(interaction, vms.secretModal(guildId, selected));
    else if (choose[1] === "delete" || choose[1] === "unlink") await present(interaction, await vms.unlinkPicker(guildId, userId, selected));
    return true;
  }
  if (customId === "atlasby:vmcfg:logchannel") {
    await present(interaction, await vms.requestLog({ guildId, actorId: userId, channelId: selected }));
    return true;
  }
  const unlink = /^atlasby:vmcfg:unlink:([0-9a-f-]{36})$/.exec(customId);
  if (unlink) {
    await present(interaction, await vms.requestUnlink({ guildId, actorId: userId, vmId: unlink[1], userId: selected }));
    return true;
  }
  if (customId === "atlasby:vmcfg:importfilter") {
    await present(interaction, await vms.importList(guildId, userId, 0, Number(selected)));
    return true;
  }
  if (customId === "atlasby:vmcfg:importpick") {
    await present(interaction, await vms.importPreview(guildId, userId, selected));
    return true;
  }
  const importUserPick = /^atlasby:vmcfg:importuserpick:([0-9a-f]{32})$/.exec(customId);
  if (importUserPick) {
    await present(interaction, await vms.stageImportUser(guildId, userId, importUserPick[1], selected));
    return true;
  }
  if (!customId.startsWith("atlasby:vm")) return false;
  return true;
}

export async function routeVmModal(interaction, vms) {
  const customId = interaction.customId ?? "";
  const read = (id) => blank(interaction.fields.getTextInputValue(id));
  if (customId === "atlasby:modal:vm:create") {
    await present(interaction, await vms.requestCreate({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      displayName: interaction.fields.getTextInputValue("nome"),
      resourceGroup: interaction.fields.getTextInputValue("grupo"),
      vmName: interaction.fields.getTextInputValue("vm"),
      osLabel: read("sistema"),
      location: read("local"),
    }));
    return true;
  }
  const details = /^atlasby:modal:vm:details:([0-9a-f-]{36})$/.exec(customId);
  if (details) {
    await present(interaction, await vms.requestDetails({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      vmId: details[1],
      sizeLabel: read("tamanho"),
      location: read("local"),
      cpuLabel: read("cpu"),
      ramLabel: read("ram"),
      gpuLabel: read("gpu"),
    }));
    return true;
  }
  const secret = /^atlasby:modal:vm:secret:([0-9a-f-]{36})$/.exec(customId);
  if (secret) {
    await present(interaction, await vms.requestSecret({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      vmId: secret[1],
      username: interaction.fields.getTextInputValue("usuario"),
      password: interaction.fields.getTextInputValue("senha"),
      pin: read("pin"),
    }));
    return true;
  }
  const validity = /^atlasby:modal:vm:validity:([0-9a-f-]{36})$/.exec(customId);
  if (validity) {
    await present(interaction, await vms.requestValidity({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      vmId: validity[1],
      raw: read("data"),
      blockText: interaction.fields.getTextInputValue("bloquear"),
    }));
    return true;
  }
  const importValidityModal = /^atlasby:modal:vm:importvalidity:([0-9a-f]{32})$/.exec(customId);
  if (importValidityModal) {
    await present(interaction, await vms.stageImportValidity(
      interaction.guildId,
      interaction.user.id,
      importValidityModal[1],
      read("data"),
      interaction.fields.getTextInputValue("bloquear"),
    ));
    return true;
  }
  const importSecretModal = /^atlasby:modal:vm:importsecret:([0-9a-f]{32})$/.exec(customId);
  if (importSecretModal) {
    await present(interaction, await vms.stageImportSecret(
      interaction.guildId,
      interaction.user.id,
      importSecretModal[1],
      interaction.fields.getTextInputValue("usuario"),
      interaction.fields.getTextInputValue("senha"),
      read("pin"),
    ));
    return true;
  }
  const disk = /^atlasby:modal:vm:disk:([0-9a-f-]{36})$/.exec(customId);
  if (disk) {
    await present(interaction, await vms.requestDisk({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      vmId: disk[1],
      raw: interaction.fields.getTextInputValue("gb"),
    }));
    return true;
  }
  return false;
}
