import { randomUUID } from "node:crypto";
import { actorFrom, present } from "../components/reply.js";
import { resolveGalleryImage, withGalleryVersion } from "../loja/image.js";
import { notice, V2_EPHEMERAL } from "../panels/ui.js";
import { isAdmin } from "../services/admin.js";
import { createMachine } from "./create.js";
import { autoThroughput, validateDataDisk } from "./limits.js";
import { defaultMachineName, sizeById, validMachineName } from "./payload.js";
import { atlasNsgRules, chooseNsgs, samePlace } from "./nsg.js";
import { nameModal, renderDiskStep, renderFailure, renderGbStep, renderHold, renderImageStep, renderIopsStep, renderMemberStep, renderNameStep, renderNsgStep, renderProgress, renderReady, renderReview, renderSizeStep, renderSpotStep, renderThroughputStep, renderZoneStep, WIZARD_DEFAULTS } from "./panel.js";

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
  return true;
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
  const step = /^atlas:maquina:(user|size|spot|disk|gb|iops|flow|zone|nsg|image|auto|name|go|no):([0-9a-f-]{36})$/.exec(id);
  const move = /^atlas:maquina:(ok|back):([a-z]+):([0-9a-f-]{36})$/.exec(id);
  if (!modal && !step && !move) return false;
  const actor = actorFrom(interaction);
  if (!isAdmin(actor, app.config)) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: V2_EPHEMERAL });
    await present(interaction, notice("Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode fazer isso.", app.config.panelColor));
    return true;
  }
  const draftId = modal?.[1] || step?.[2] || move?.[3];
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
  if (move?.[1] === "ok") return goOn(interaction, app, draft, move[2]);
  if (move?.[1] === "back") return goBack(interaction, app, draft, move[2]);
  const kind = step[1];
  if (kind === "user") return pickUser(interaction, app, draft);
  if (kind === "size") return applySize(interaction, app, draft, interaction.values?.[0]);
  if (kind === "spot") return applySpot(interaction, app, draft, interaction.values?.[0]);
  if (kind === "disk") return applyDisk(interaction, app, draft, interaction.values?.[0]);
  if (kind === "gb") return applyGb(interaction, app, draft, interaction.values?.[0]);
  if (kind === "iops") return applyIops(interaction, app, draft, interaction.values?.[0]);
  if (kind === "flow") return applyFlow(interaction, app, draft, interaction.values?.[0]);
  if (kind === "zone") return applyZone(interaction, app, draft, interaction.values?.[0]);
  if (kind === "nsg") return applyNsg(interaction, app, draft, interaction.values?.[0]);
  if (kind === "image") return applyImage(interaction, app, draft, interaction.values?.[0], false);
  if (kind === "auto") return useSuggested(interaction, app, draft);
  if (kind === "no") return cancel(interaction, app, draft);
  if (kind === "go") return launch(interaction, app, actor, draft);
  return true;
}

function suggestedZone(app) {
  return ["1", "2", "3"].includes(app.config.azure.zone) ? app.config.azure.zone : "1";
}

function goOn(interaction, app, draft, from) {
  if (from === "size") return applySize(interaction, app, draft, WIZARD_DEFAULTS.size);
  if (from === "spot") return applySpot(interaction, app, draft, WIZARD_DEFAULTS.spot);
  if (from === "disk") return applyDisk(interaction, app, draft, WIZARD_DEFAULTS.disk);
  if (from === "gb") return applyGb(interaction, app, draft, WIZARD_DEFAULTS.gb);
  if (from === "iops") return applyIops(interaction, app, draft, WIZARD_DEFAULTS.iops);
  if (from === "flow") return applyFlow(interaction, app, draft, WIZARD_DEFAULTS.flow);
  if (from === "zone") return applyZone(interaction, app, draft, suggestedZone(app));
  if (from === "nsg") return applyNsg(interaction, app, draft, WIZARD_DEFAULTS.nsg);
  if (from === "image") return applyImage(interaction, app, draft, draft.payload.imagePreferred, false);
  return show(interaction, notice("Esta etapa não tem sugestão. Escolha uma opção.", app.config.panelColor));
}

function goBack(interaction, app, draft, from) {
  const accent = app.config.panelColor;
  const payload = draft.payload;
  if (from === "size") return show(interaction, renderMemberStep(draft.id, accent));
  if (from === "spot") return show(interaction, renderSizeStep(payload, accent));
  if (from === "disk") return show(interaction, renderSpotStep(payload, accent));
  if (from === "gb") return show(interaction, renderDiskStep(payload, accent));
  if (from === "iops") return show(interaction, renderGbStep(payload, accent));
  if (from === "flow") return show(interaction, renderIopsStep(payload, accent));
  if (from === "zone") return show(interaction, renderThroughputStep(payload, accent));
  if (from === "nsg") return payload.diskMode === "v2" ? show(interaction, renderZoneStep(payload, accent, app.config.azure.zone)) : show(interaction, renderDiskStep(payload, accent));
  if (from === "image") return openNsg(interaction, app, draft);
  if (from === "name") return showImage(interaction, app, draft);
  if (from === "review") return askName(interaction, app, draft);
  if (from === "fail") return openReview(interaction, app, draft, payload.machineName);
  return show(interaction, notice("Não há etapa anterior.", app.config.panelColor));
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

function applySize(interaction, app, draft, sizeId) {
  const chosen = sizeById(sizeId);
  if (!chosen) return show(interaction, renderSizeStep(draft.payload, app.config.panelColor));
  draft.payload = { ...draft.payload, sizeId: chosen.id, sizeLabel: `${chosen.label} · ${chosen.size}` };
  keep(app.repo, draft);
  return show(interaction, renderSpotStep(draft.payload, app.config.panelColor));
}

function applySpot(interaction, app, draft, value) {
  if (value !== "spot" && value !== "normal") return show(interaction, renderSpotStep(draft.payload, app.config.panelColor));
  draft.payload = { ...draft.payload, spot: value === "spot" };
  keep(app.repo, draft);
  return show(interaction, renderDiskStep(draft.payload, app.config.panelColor));
}

function applyDisk(interaction, app, draft, value) {
  if (value !== "premium" && value !== "v2") return show(interaction, renderDiskStep(draft.payload, app.config.panelColor));
  draft.payload = { ...draft.payload, diskMode: value };
  keep(app.repo, draft);
  if (value === "premium") return openNsg(interaction, app, draft);
  return show(interaction, renderGbStep(draft.payload, app.config.panelColor));
}

function applyGb(interaction, app, draft, raw) {
  const gb = Number(raw);
  const check = validateDataDisk({ gb, iops: 3000, throughput: 125 });
  if (!check.ok) return show(interaction, renderGbStep(draft.payload, app.config.panelColor));
  draft.payload = { ...draft.payload, dataGb: gb };
  keep(app.repo, draft);
  return show(interaction, renderIopsStep(draft.payload, app.config.panelColor));
}

function applyIops(interaction, app, draft, raw) {
  const iops = Number(raw);
  const check = validateDataDisk({ gb: draft.payload.dataGb, iops, throughput: 125 });
  if (!check.ok) return show(interaction, renderIopsStep(draft.payload, app.config.panelColor));
  draft.payload = { ...draft.payload, iops };
  keep(app.repo, draft);
  return show(interaction, renderThroughputStep(draft.payload, app.config.panelColor));
}

function applyFlow(interaction, app, draft, mode) {
  const throughput = mode === "auto" ? autoThroughput(draft.payload.iops) : mode === "base" ? 125 : 0;
  const check = validateDataDisk({ gb: draft.payload.dataGb, iops: draft.payload.iops, throughput });
  if (!check.ok) return show(interaction, renderThroughputStep(draft.payload, app.config.panelColor));
  draft.payload = { ...draft.payload, throughput, throughputAuto: mode === "auto" };
  keep(app.repo, draft);
  return show(interaction, renderZoneStep(draft.payload, app.config.panelColor, app.config.azure.zone));
}

function applyZone(interaction, app, draft, zone) {
  if (!["1", "2", "3"].includes(zone)) return show(interaction, renderZoneStep(draft.payload, app.config.panelColor, app.config.azure.zone));
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

function applyNsg(interaction, app, draft, value) {
  const location = app.config.azure.location;
  if (value === "padrao") {
    const found = (draft.payload.nsgs || []).find((item) => item.name === app.config.azure.nsg);
    if (found && !samePlace(found.location, location)) {
      return show(interaction, renderNsgStep(draft.payload, draft.payload.nsgs, { defaultName: app.config.azure.nsg, accent: app.config.panelColor }));
    }
    draft.payload = { ...draft.payload, nsgMode: "padrao", nsgId: found?.id || "", nsgName: app.config.azure.nsg, nsgLabel: `${app.config.azure.nsg} · padrão` };
  } else if (value === "criar") {
    draft.payload = { ...draft.payload, nsgMode: "criar", nsgId: "", nsgName: "", nsgLabel: "Criar NSG Ignix" };
  } else {
    const index = Number(String(value || "").slice(2));
    const chosen = draft.payload.nsgs?.[index];
    if (!chosen || !samePlace(chosen.location, location)) {
      return show(interaction, renderNsgStep(draft.payload, draft.payload.nsgs, { defaultName: app.config.azure.nsg, accent: app.config.panelColor }));
    }
    draft.payload = { ...draft.payload, nsgMode: "existente", nsgId: chosen.id, nsgName: chosen.name, nsgLabel: `${chosen.name} · ${chosen.group}` };
  }
  keep(app.repo, draft);
  return openImage(interaction, app, draft);
}

async function openImage(interaction, app, draft) {
  const listed = await app.provisioner.listImageVersions(app.config.azure.imageId);
  if (!listed.ok) return show(interaction, renderHold(listed.error, app.config.panelColor, draft.id));
  const versions = listed.versions || [];
  if (!versions.length) return show(interaction, renderHold("Nenhuma versão pronta dessa imagem.", app.config.panelColor, draft.id));
  const preferred = versions.includes(listed.preferred) ? listed.preferred : versions[0];
  if (versions.length === 1) return applyImage(interaction, app, draft, versions[0], true, versions);
  draft.payload = { ...draft.payload, imageVersions: versions, imagePreferred: preferred, imageSkipped: false };
  keep(app.repo, draft);
  return show(interaction, renderImageStep(draft.payload, versions, preferred, app.config.panelColor));
}

function showImage(interaction, app, draft) {
  const versions = draft.payload.imageVersions || [];
  if (versions.length <= 1) return openNsg(interaction, app, draft);
  return show(interaction, renderImageStep(draft.payload, versions, draft.payload.imagePreferred, app.config.panelColor));
}

function applyImage(interaction, app, draft, version, skipped, versions = draft.payload.imageVersions) {
  const list = versions || [];
  if (!list.includes(version)) {
    if (list.length > 1) return show(interaction, renderImageStep(draft.payload, list, draft.payload.imagePreferred, app.config.panelColor));
    return openImage(interaction, app, draft);
  }
  draft.payload = {
    ...draft.payload,
    imageVersions: list,
    imagePreferred: skipped ? version : (draft.payload.imagePreferred || version),
    imageVersion: version,
    imageId: withGalleryVersion(app.config.azure.imageId, version),
    imageSkipped: Boolean(skipped),
  };
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
    image: (draft.payload.imageId || image.id).split("/").filter(Boolean).slice(-2).join("/"),
    version: draft.payload.imageVersion || "",
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
  if (confirmation?.usedAt) {
    return show(interaction, notice("A confirmação já foi usada.", app.config.panelColor));
  }
  if (!confirmation || confirmation.action !== "criar-maquina" || confirmation.guildId !== interaction.guildId || confirmation.userId !== actor.id || confirmation.expiresAt <= Date.now()) {
    return openReview(interaction, app, draft, draft.payload.machineName);
  }
  if (!app.repo.consumeConfirmation(confirmation.id, Date.now())) {
    return show(interaction, notice("A confirmação expirou ou já foi usada.", app.config.panelColor));
  }
  if (app.repo.getByOwner(interaction.guildId, draft.payload.userId)) {
    return show(interaction, notice("Este membro já tem máquina. Nada foi criado.", app.config.panelColor));
  }
  const azure = app.config.azure;
  const image = resolveGalleryImage({ envId: draft.payload.imageId || azure.imageId });
  const chosen = sizeById(draft.payload.sizeId);
  if (!chosen) return show(interaction, notice("Escolha o tamanho de novo.", app.config.panelColor));
  const spec = {
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
    nsgGroup: /resourceGroups\/([^/]+)/i.exec(draft.payload.nsgId || "")?.[1] || azure.resourceGroup,
  };
  if (app.provisioner.preflight) {
    const problems = await app.provisioner.preflight(spec);
    if (problems.length) {
      const error = problems.join("\n");
      console.error(`Criar máquina [pré-checagem]: ${error}`);
      await show(interaction, renderFailure(error, app.config.panelColor, null, draft.id));
      await app.audit?.record?.({ guildId: interaction.guildId, actorId: actor.id, action: "criar_maquina", targetUserId: draft.payload.userId, machineName: draft.payload.machineName, detail: error });
      return true;
    }
  }
  await show(interaction, renderProgress("rede", app.config.panelColor));
  const result = await createMachine(spec, app.provisioner, {
    progress: async (step) => {
      await interaction.editReply({ components: renderProgress(step, app.config.panelColor).components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } }).catch(() => {});
    },
  });
  if (!result.ok) {
    console.error(`Criar máquina [${result.step || "falha"}] ${result.code || ""}: ${result.message || result.error}`);
    await show(interaction, renderFailure(result.error, app.config.panelColor, result.cleanupFailed, draft.id));
    await app.audit?.record?.({ guildId: interaction.guildId, actorId: actor.id, action: "criar_maquina", targetUserId: draft.payload.userId, machineName: draft.payload.machineName, detail: `${result.step || "falha"} ${result.code || ""} ${result.error}`.slice(0, 500) });
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
    await show(interaction, renderFailure("Este membro já tem máquina. A VM criada foi removida.", app.config.panelColor, [], draft.id));
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

