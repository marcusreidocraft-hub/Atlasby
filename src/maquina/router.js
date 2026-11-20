import { randomUUID } from "node:crypto";
import { actorFrom, present } from "../components/reply.js";
import { resolveGalleryImage } from "../loja/image.js";
import { notice, V2_EPHEMERAL } from "../panels/ui.js";
import { isAdmin } from "../services/admin.js";
import { createMachine } from "./create.js";
import { autoThroughput, validateDataDisk } from "./limits.js";
import { defaultMachineName, sizeById, validMachineName } from "./payload.js";
import { atlasNsgRules, chooseNsgs, samePlace } from "./nsg.js";
import { nameModal, renderDiskStep, renderFailure, renderGbStep, renderIopsStep, renderMemberStep, renderNameStep, renderNsgStep, renderProgress, renderReady, renderReview, renderSizeStep, renderSpotStep, renderThroughputStep, renderZoneStep } from "./panel.js";

const DRAFT_MS = 30 * 60 * 1000;

function keep(repo, draft) {
  repo.deleteDraft(draft.id);
  repo.saveDraft(draft);
}

function load(repo, id, guildId, actorId, now) {
  const draft = repo.getDraft(id);
  if (!draft || draft.kind !== "maquina" || draft.guildId !== guildId || draft.actorId !== actorId || draft.expiresAt <= now) return null;
  return draft;
}

async function show(interaction, view) {
  const body = { components: view.components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) await interaction.editReply(body);
  else await interaction.reply(body);
}

function imageLabel(config) {
  const image = resolveGalleryImage({ envId: config.azure.imageId });
  const parts = image.id.split("/");
  return parts.at(-1) || "galeria";
}

export async function routeMachineCommand(interaction, app, actor) {
  if (!app.config.azure.configured || !app.config.azure.resourceGroup || !app.config.azure.virtualNetwork || !app.config.azure.subnet) {
    await present(interaction, notice("Defina a Azure, o grupo de recursos, a rede e a sub-rede no host antes de criar uma máquina.", app.config.panelColor));
    return;
  }
  const id = randomUUID();
  const draft = {
    id,
    guildId: interaction.guildId,
    actorId: actor.id,
    kind: "maquina",
    expiresAt: Date.now() + DRAFT_MS,
    payload: { id, step: "membro" },
  };
  keep(app.repo, draft);
  await show(interaction, renderMemberStep(id, app.config.panelColor));
}

export async function routeMachineComponent(interaction, app) {
  const id = interaction.customId ?? "";
  const modal = /^atlas:modal:maquina:([0-9a-f-]{36})$/.exec(id);
  const step = /^atlas:maquina:(user|size|spot|disk|gb|iops|flow|zone|nsg|auto|name|go|no):([0-9a-f-]{36})$/.exec(id);
  if (!modal && !step) return false;
  const actor = actorFrom(interaction);
  if (!isAdmin(actor, app.config)) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: V2_EPHEMERAL });
    await present(interaction, notice("Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode fazer isso.", app.config.panelColor));
    return true;
  }
  const draftId = modal?.[1] || step?.[2];
  const draft = load(app.repo, draftId, interaction.guildId, actor.id, Date.now());
  if (!draft) {
    if (step?.[1] === "name") {
      await interaction.reply({ components: notice("O assistente expirou. Use /criar-maquina de novo.", app.config.panelColor).components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
      return true;
    }
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => interaction.deferReply({ flags: V2_EPHEMERAL }));
    await show(interaction, notice("O assistente expirou. Use /criar-maquina de novo.", app.config.panelColor));
    return true;
  }
  if (step?.[1] === "name") {
    await interaction.showModal(nameModal(draft.id));
    return true;
  }
  if (modal) return submitName(interaction, app, draft);
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  draft.expiresAt = Date.now() + DRAFT_MS;
  const kind = step[1];
  if (kind === "user") return pickUser(interaction, app, draft);
  if (kind === "size") return pickSize(interaction, app, draft);
  if (kind === "spot") return pickSpot(interaction, app, draft);
  if (kind === "disk") return pickDisk(interaction, app, draft);
  if (kind === "gb") return pickGb(interaction, app, draft);
  if (kind === "iops") return pickIops(interaction, app, draft);
  if (kind === "flow") return pickFlow(interaction, app, draft);
  if (kind === "zone") return pickZone(interaction, app, draft);
  if (kind === "nsg") return pickNsg(interaction, app, draft);
  if (kind === "auto") return useSuggested(interaction, app, draft);
  if (kind === "no") return cancel(interaction, app, draft);
  if (kind === "go") return launch(interaction, app, actor, draft);
  return true;
}

function pickUser(interaction, app, draft) {
  const user = interaction.users?.first?.() || interaction.users?.[0];
  const userId = user?.id || interaction.values?.[0];
  if (!userId) return show(interaction, notice("Escolha um membro.", app.config.panelColor));
  if (app.repo.getByOwner(interaction.guildId, userId)) {
    return show(interaction, notice("Este membro já tem máquina. Edite o cadastro ou remova o cliente antes.", app.config.panelColor));
  }
  draft.payload = { ...draft.payload, userId, username: user?.username || "user" };
  keep(app.repo, draft);
  return show(interaction, renderSizeStep(draft.payload, app.config.panelColor));
}

function pickSize(interaction, app, draft) {
  const chosen = sizeById(interaction.values?.[0]);
  if (!chosen) return show(interaction, notice("Escolha um tamanho T4.", app.config.panelColor));
  draft.payload = { ...draft.payload, sizeId: chosen.id, sizeLabel: `${chosen.label} · ${chosen.size}` };
  keep(app.repo, draft);
  return show(interaction, renderSpotStep(draft.payload, app.config.panelColor));
}

function pickSpot(interaction, app, draft) {
  const value = interaction.values?.[0];
  if (value !== "spot" && value !== "normal") return show(interaction, notice("Escolha Spot ou Normal.", app.config.panelColor));
  draft.payload = { ...draft.payload, spot: value === "spot" };
  keep(app.repo, draft);
  return show(interaction, renderDiskStep(draft.payload, app.config.panelColor));
}

function pickDisk(interaction, app, draft) {
  const value = interaction.values?.[0];
  if (value !== "premium" && value !== "v2") return show(interaction, notice("Escolha o tipo de disco.", app.config.panelColor));
  draft.payload = { ...draft.payload, diskMode: value };
  keep(app.repo, draft);
  if (value === "premium") return openNsg(interaction, app, draft);
  return show(interaction, renderGbStep(draft.payload, app.config.panelColor));
}

function pickGb(interaction, app, draft) {
  const gb = Number(interaction.values?.[0]);
  const check = validateDataDisk({ gb, iops: 3000, throughput: 125 });
  if (!check.ok) return show(interaction, notice(check.error, app.config.panelColor));
  draft.payload = { ...draft.payload, dataGb: gb };
  keep(app.repo, draft);
  return show(interaction, renderIopsStep(draft.payload, app.config.panelColor));
}

function pickIops(interaction, app, draft) {
  const iops = Number(interaction.values?.[0]);
  const check = validateDataDisk({ gb: draft.payload.dataGb, iops, throughput: 125 });
  if (!check.ok) return show(interaction, notice(check.error, app.config.panelColor));
  draft.payload = { ...draft.payload, iops };
  keep(app.repo, draft);
  return show(interaction, renderThroughputStep(draft.payload, app.config.panelColor));
}

function pickFlow(interaction, app, draft) {
  const mode = interaction.values?.[0];
  const throughput = mode === "auto" ? autoThroughput(draft.payload.iops) : 125;
  const check = validateDataDisk({ gb: draft.payload.dataGb, iops: draft.payload.iops, throughput });
  if (!check.ok) return show(interaction, notice(check.error, app.config.panelColor));
  draft.payload = { ...draft.payload, throughput, throughputAuto: mode === "auto" };
  keep(app.repo, draft);
  return show(interaction, renderZoneStep(draft.payload, app.config.panelColor, app.config.azure.zone));
}

function pickZone(interaction, app, draft) {
  const zone = interaction.values?.[0];
  if (!["1", "2", "3"].includes(zone)) return show(interaction, notice("Escolha a zona 1, 2 ou 3.", app.config.panelColor));
  draft.payload = { ...draft.payload, zone };
  keep(app.repo, draft);
  return openNsg(interaction, app, draft);
}

async function openNsg(interaction, app, draft) {
  let listed = [];
  try {
    listed = await app.provisioner.listNsgs();
  } catch {
    listed = [];
  }
  const nsgs = chooseNsgs(listed, { location: app.config.azure.location, resourceGroup: app.config.azure.resourceGroup });
  draft.payload = { ...draft.payload, nsgs };
  keep(app.repo, draft);
  return show(interaction, renderNsgStep(draft.payload, nsgs, { defaultName: app.config.azure.nsg, accent: app.config.panelColor }));
}

function pickNsg(interaction, app, draft) {
  const value = interaction.values?.[0];
  const location = app.config.azure.location;
  if (value === "padrao") {
    const found = (draft.payload.nsgs || []).find((item) => item.name === app.config.azure.nsg);
    if (found && !samePlace(found.location, location)) {
      return show(interaction, notice("O NSG padrão está em outra região. Escolha um grupo da mesma região da VM.", app.config.panelColor));
    }
    draft.payload = { ...draft.payload, nsgMode: "padrao", nsgId: found?.id || "", nsgName: app.config.azure.nsg, nsgLabel: `${app.config.azure.nsg} · padrão` };
  } else if (value === "criar") {
    draft.payload = { ...draft.payload, nsgMode: "criar", nsgId: "", nsgName: "", nsgLabel: "Criar NSG Ignix" };
  } else {
    const index = Number(String(value || "").slice(2));
    const chosen = draft.payload.nsgs?.[index];
    if (!chosen || !samePlace(chosen.location, location)) {
      return show(interaction, notice("Esse NSG não está na mesma região da VM.", app.config.panelColor));
    }
    draft.payload = { ...draft.payload, nsgMode: "existente", nsgId: chosen.id, nsgName: chosen.name, nsgLabel: `${chosen.name} · ${chosen.group}` };
  }
  keep(app.repo, draft);
  return askName(interaction, app, draft);
}

function askName(interaction, app, draft) {
  draft.payload = { ...draft.payload, suggestedName: draft.payload.suggestedName || defaultMachineName(draft.payload.username) };
  keep(app.repo, draft);
  return show(interaction, renderNameStep(draft.payload, app.config.panelColor));
}

function useSuggested(interaction, app, draft) {
  return openReview(interaction, app, draft, draft.payload.suggestedName || defaultMachineName(draft.payload.username));
}

async function submitName(interaction, app, draft) {
  const name = interaction.fields.getTextInputValue("nome").trim().toLowerCase();
  if (!validMachineName(name)) {
    await interaction.reply({ components: notice("Use de 2 a 15 caracteres: letra no início, minúsculas, números e hífen.", app.config.panelColor).components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    return true;
  }
  await interaction.deferReply({ flags: V2_EPHEMERAL });
  await openReview(interaction, app, draft, name);
  return true;
}

function openReview(interaction, app, draft, machineName) {
  const confirmation = {
    id: randomUUID(),
    guildId: interaction.guildId,
    userId: draft.actorId,
    clientId: draft.id,
    action: "criar-maquina",
    expiresAt: Date.now() + app.config.confirmationTtlMs,
  };
  app.repo.saveConfirmation(confirmation);
  draft.payload = { ...draft.payload, machineName, confirmationId: confirmation.id };
  keep(app.repo, draft);
  const image = resolveGalleryImage({ envId: app.config.azure.imageId });
  return show(interaction, renderReview(draft.payload, app.config.panelColor, {
    location: app.config.azure.location,
    image: image.id.split("/").filter(Boolean).slice(-2).join("/"),
    expires: Math.floor(confirmation.expiresAt / 1000),
  }));
}

async function cancel(interaction, app, draft) {
  if (draft.payload.confirmationId) app.repo.consumeConfirmation(draft.payload.confirmationId, Date.now());
  app.repo.deleteDraft(draft.id);
  return show(interaction, notice("Criação cancelada. Nenhuma máquina foi criada.", app.config.panelColor));
}

async function launch(interaction, app, actor, draft) {
  const confirmation = app.repo.getConfirmation(draft.payload.confirmationId);
  if (!confirmation || confirmation.action !== "criar-maquina" || confirmation.guildId !== interaction.guildId || confirmation.userId !== actor.id || confirmation.usedAt || confirmation.expiresAt <= Date.now()) {
    return show(interaction, notice("A confirmação expirou. Abra a revisão de novo.", app.config.panelColor));
  }
  if (!app.repo.consumeConfirmation(confirmation.id, Date.now())) {
    return show(interaction, notice("A confirmação expirou ou já foi usada.", app.config.panelColor));
  }
  if (app.repo.getByOwner(interaction.guildId, draft.payload.userId)) {
    return show(interaction, notice("Este membro já tem máquina. Nada foi criado.", app.config.panelColor));
  }
  const azure = app.config.azure;
  const image = resolveGalleryImage({ envId: azure.imageId });
  const chosen = sizeById(draft.payload.sizeId);
  await show(interaction, renderProgress("rede", app.config.panelColor));
  if (!chosen) return show(interaction, notice("Escolha o tamanho de novo.", app.config.panelColor));
  const result = await createMachine({
    seed: draft.id,
    machineName: draft.payload.machineName,
    sizeId: draft.payload.sizeId,
    vmSize: chosen.size,
    vcpus: chosen.id === "t4-16" ? 16 : chosen.id === "t4-8" ? 8 : 4,
    spot: draft.payload.spot,
    diskMode: draft.payload.diskMode,
    dataGb: draft.payload.dataGb,
    iops: draft.payload.iops,
    throughput: draft.payload.throughput,
    zone: draft.payload.zone || azure.zone,
    location: azure.location,
    group: azure.resourceGroup,
    vnet: azure.virtualNetwork,
    subnet: azure.subnet,
    nsg: draft.payload.nsgName || azure.nsg,
    nsgId: draft.payload.nsgId || "",
    nsgMode: draft.payload.nsgMode || "padrao",
    nsgRules: atlasNsgRules(app.config.agentPort),
    imageId: image.id,
    osGb: Math.min(512, azure.maxOsDiskGb),
  }, app.provisioner, {
    progress: async (step) => {
      await interaction.editReply({ components: renderProgress(step, app.config.panelColor).components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } }).catch(() => {});
    },
  });
  if (!result.ok) {
    await show(interaction, renderFailure(result.error, app.config.panelColor, result.cleanupFailed));
    await app.audit?.record?.({ guildId: interaction.guildId, actorId: actor.id, action: "criar_maquina", targetUserId: draft.payload.userId, machineName: draft.payload.machineName, detail: result.error });
    return true;
  }
  const { clientRow } = await import("./create.js");
  const { specsFromSize } = await import("../services/vm-size.js");
  const specs = specsFromSize(chosen.size);
  try {
    app.repo.insertClient(clientRow({
      guildId: interaction.guildId,
      userId: draft.payload.userId,
      clientName: draft.payload.username,
      machineName: draft.payload.machineName,
      specs,
      publicIp: result.state.publicIp,
      infraId: result.state.vmId,
      now: Date.now(),
    }));
  } catch {
    await app.provisioner.cleanup?.({ ...result.state, vmCreated: true }).catch(() => {});
    await show(interaction, renderFailure("Este membro já tem máquina. A VM criada foi removida.", app.config.panelColor, []));
    return true;
  }
  app.repo.deleteDraft(draft.id);
  await show(interaction, renderReady({ machineName: draft.payload.machineName, publicIp: result.state.publicIp, accent: app.config.panelColor }));
  await app.audit?.record?.({
    guildId: interaction.guildId,
    actorId: actor.id,
    action: "criar_maquina",
    targetUserId: draft.payload.userId,
    machineName: draft.payload.machineName,
    detail: `VM criada. IP ${result.state.publicIp || "pendente"}.`,
  });
  interaction.client.users.fetch(draft.payload.userId).then((user) => user.send(`Sua máquina da Ignix Cloud PC está pronta: ${draft.payload.machineName}. IP: ${result.state.publicIp || "ainda não publicado"}.`)).catch(() => {
    console.warn(`Máquina: privado fechado para ${draft.payload.userId}.`);
  });
  return true;
}

