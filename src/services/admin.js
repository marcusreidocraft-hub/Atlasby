import { randomBytes, randomUUID } from "node:crypto";
import { buildAgentInstallScript } from "./agent-install.js";
import { renderAddPicker, renderAzureVmList, renderClientList, renderContinue, renderRemoveConfirm, renderRenewReview, renderReview, renderVmPicker, specsModal, step1Modal, step2Modal, step3Modal } from "../panels/admin.js";
import { notice } from "../panels/ui.js";
import { logInteractionError } from "../components/reply.js";
import { vmOptionValue } from "./provider.js";
import { validateAccess, validateIdentity, validateSchedule, validateSpecs } from "./fields.js";
import { specsFromSize } from "./vm-size.js";
import { expiryFrom, formatDate, startOfToday } from "./plans.js";

const PAGE = 5;
const DRAFT_MS = 30 * 60 * 1000;

function denied(accent) {
  return notice("Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode fazer isso.", accent);
}

export function isAdmin(actor, config) {
  if (actor?.owner) return true;
  const bits = BigInt(actor?.permissions ?? 0);
  if ((bits & 8n) === 8n) return true;
  return (actor?.roleIds ?? []).some((id) => config.adminRoleIds.includes(id));
}

function sealValue(sealer, value) {
  if (!value) return { ok: true, cipher: null };
  if (!sealer) return { ok: false, error: "Defina CREDENTIALS_KEY ou AZURE_CREDENTIALS_KEY antes de guardar senha ou PIN." };
  return { ok: true, cipher: sealer.seal(value) };
}

export function createAdmin({ config, repo, audit, sealer, emojis, now, infra, agents = null }) {
  function gate(actor) {
    return isAdmin(actor, config) ? null : denied(config.panelColor);
  }

  function requireDraft(guildId, actorId, draftId) {
    const draft = repo.getDraft(draftId);
    if (!draft || draft.guildId !== guildId || draft.actorId !== actorId || draft.expiresAt <= now()) return null;
    return draft;
  }

  function storeDraft(draft) {
    repo.saveDraft({ ...draft, expiresAt: now() + DRAFT_MS });
    return repo.getDraft(draft.id);
  }

  async function logged(actor, action, targetUserId, machineName, detail, secrets = []) {
    await audit.record({ guildId: actor.guildId, actorId: actor.id, action, targetUserId, machineName, detail, secrets });
  }

  return {
    isAdmin: (actor) => isAdmin(actor, config),
    async issueAgentToken(guildId, actor, userId) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const client = repo.getByOwner(guildId, userId);
      if (!client) return notice("Este membro não tem máquina cadastrada.", config.panelColor);
      const token = agents.issueToken(guildId, client, actor.id);
      await agents.recordIssue(guildId, actor.id, client);
      return notice(`Token do agente de ${client.clientName}. Ele aparece só nesta mensagem. Guarde no arquivo de configuração da VM e não o envie em canal aberto.\n\n\`${token}\``, config.panelColor);
    },
    addPicker(guildId) {
      return renderAddPicker(config.panelColor, emojis.pack(guildId));
    },
    beginModal(kind, guildId, userId) {
      const current = kind === "edit" ? repo.getByOwner(guildId, userId) : null;
      if (kind === "edit" && !current) return { error: notice("Este membro não tem máquina cadastrada.", config.panelColor) };
      if (kind === "add" && repo.getByOwner(guildId, userId)) {
        return { error: notice("Este membro já tem uma máquina. Use /editar-cliente.", config.panelColor) };
      }
      return { modal: step1Modal({ kind, targetUserId: userId, current }) };
    },
    applyStep1({ guildId, actor, kind, targetUserId, fields }) {
      const blocked = gate(actor);
      if (blocked) return { payload: blocked };
      const identity = validateIdentity(fields);
      if (!identity.ok) return { payload: notice(identity.error, config.panelColor) };
      const existing = repo.getByOwner(guildId, targetUserId);
      if (kind === "add" && existing) return { payload: notice("Este membro já tem uma máquina. Use /editar-cliente.", config.panelColor) };
      if (kind === "edit" && !existing) return { payload: notice("Este membro não tem máquina cadastrada.", config.panelColor) };
      const draft = storeDraft({
        id: randomUUID(),
        guildId,
        actorId: actor.id,
        kind,
        payload: {
          ...identity.value,
          gpu: existing?.gpu && existing.gpu !== "não informado" ? existing.gpu : "não informado",
          vcpus: existing?.vcpus || 0,
          ram: existing?.ram && existing.ram !== "não informado" ? existing.ram : "não informado",
          specsReady: Boolean(existing?.gpu && existing.gpu !== "não informado"),
          targetUserId,
          publicIp: existing?.publicIp ?? "",
          rdpUser: existing?.rdpUser ?? "",
          plan: existing?.planType ?? "mensal",
          keepPassword: Boolean(existing?.rdpPasswordCipher),
          keepPin: Boolean(existing?.pinCipher),
          rdpPasswordCipher: existing?.rdpPasswordCipher ?? null,
          pinCipher: existing?.pinCipher ?? null,
          startedAt: existing?.startedAt ?? startOfToday(now()),
          expiresAt: existing?.expiresAt ?? expiryFrom(startOfToday(now()), existing?.planType ?? "mensal"),
          infraId: existing?.infraId ?? "",
          existingId: existing?.id ?? null,
          startText: existing ? formatDate(existing.startedAt) : formatDate(startOfToday(now())),
          expiryText: existing ? formatDate(existing.expiresAt) : formatDate(expiryFrom(startOfToday(now()), "mensal")),
        },
      });
      return { payload: renderContinue(config.panelColor, draft.id, 2, "Dados da máquina anotados. Continue para o acesso.", emojis.pack(guildId)) };
    },
    continueModal(guildId, actor, draftId, step) {
      const blocked = gate(actor);
      if (blocked) return { error: blocked };
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft) return { error: notice("O rascunho expirou. Comece de novo.", config.panelColor) };
      if (step === "3" && !draft.payload.infraId && !draft.payload.specsReady) return { modal: specsModal(draft) };
      return { modal: step === "3" ? step3Modal(draft) : step2Modal(draft) };
    },
    applySpecs({ guildId, actor, draftId, fields }) {
      const blocked = gate(actor);
      if (blocked) return { payload: blocked };
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft) return { payload: notice("O rascunho expirou. Comece de novo.", config.panelColor) };
      const specs = validateSpecs(fields);
      if (!specs.ok) return { payload: notice(specs.error, config.panelColor) };
      draft.payload = { ...draft.payload, ...specs.value, specsReady: true };
      storeDraft(draft);
      return { payload: renderContinue(config.panelColor, draft.id, 3, "Hardware anotado. Continue para as datas. O Resource ID manual continua opcional.", emojis.pack(guildId)) };
    },
    applyStep2({ guildId, actor, draftId, fields }) {
      const blocked = gate(actor);
      if (blocked) return { payload: blocked };
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft) return { payload: notice("O rascunho expirou. Comece de novo.", config.panelColor) };
      const access = validateAccess(fields);
      if (!access.ok) return { payload: notice(access.error, config.panelColor) };
      const password = sealValue(sealer, access.value.password);
      if (!password.ok) return { payload: notice(password.error, config.panelColor) };
      const start = draft.payload.startedAt || startOfToday(now());
      draft.payload = {
        ...draft.payload,
        publicIp: access.value.publicIp,
        rdpUser: access.value.rdpUser,
        plan: access.value.plan,
        rdpPasswordCipher: access.value.password ? password.cipher : draft.payload.rdpPasswordCipher,
        keepPassword: access.value.password ? false : Boolean(draft.payload.rdpPasswordCipher),
        startedAt: start,
        startText: formatDate(start),
        expiryText: formatDate(expiryFrom(start, access.value.plan)),
      };
      storeDraft(draft);
      return { payload: renderContinue(config.panelColor, draft.id, 3, "Acesso anotado. O próximo passo lista as VMs da Azure. A senha e o PIN não aparecem nesta tela.", emojis.pack(guildId)) };
    },
    async vmChoices(guildId, targetUserId) {
      const links = repo.listInfraLinks(guildId);
      const linked = new Map(links.map((link) => [link.infraId, link]));
      const vms = await infra.listVms();
      return vms.filter((vm) => {
        const owner = linked.get(vm.id);
        return !owner || owner.userId === targetUserId;
      }).map((vm) => ({ ...vm, own: linked.get(vm.id)?.userId === targetUserId }));
    },
    async vmPicker(guildId, actor, draftId, page = 0) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft) return notice("O rascunho expirou. Comece de novo.", config.panelColor);
      let vms = [];
      let note = "";
      try {
        if (!infra.listVms) note = "A Azure não está configurada. Informe o Resource ID no próximo passo, se quiser.";
        else {
          vms = await this.vmChoices(guildId, draft.payload.targetUserId);
          if (!infra.configured) note = "A Azure não está configurada. Informe o Resource ID no próximo passo, se quiser.";
          else if (!vms.length) note = "Nenhuma VM livre apareceu nesta assinatura.";
        }
      } catch (error) {
        logInteractionError(error);
        note = "Não foi possível listar as VMs na Azure. O Resource ID manual continua disponível no próximo passo.";
      }
      const chosen = draft.payload.infraId
        ? `VM escolhida: ${draft.payload.vmName || "resource ID preenchido"}. Ele entra no próximo campo e ainda pode ser editado.`
        : "";
      return renderVmPicker({ accent: config.panelColor, draftId, vms, page, notice: note, chosen });
    },
    async pickVm(guildId, actor, draftId, token) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft) return notice("O rascunho expirou. Comece de novo.", config.panelColor);
      if (token === "none") {
        draft.payload.infraId = "";
        draft.payload.vmName = "";
        storeDraft(draft);
        return this.vmPicker(guildId, actor, draftId, 0);
      }
      let vms = [];
      try {
        vms = await infra.listVms();
      } catch (error) {
        logInteractionError(error);
        return notice("Não foi possível confirmar a VM na Azure. Nada foi preenchido.", config.panelColor);
      }
      const vm = vms.find((item) => vmOptionValue(item.id) === token);
      if (!vm) return notice("Essa VM não está mais na lista. Abra a lista de novo.", config.panelColor);
      const other = repo.findByInfra(guildId, vm.id);
      if (other && other.userId !== draft.payload.targetUserId) return notice("Essa VM já está vinculada a outro cliente.", config.panelColor);
      const specs = specsFromSize(vm.size);
      draft.payload.infraId = vm.id;
      draft.payload.vmName = vm.name;
      draft.payload.gpu = specs.gpu;
      draft.payload.vcpus = specs.vcpus;
      draft.payload.ram = specs.ram;
      draft.payload.specsReady = true;
      storeDraft(draft);
      return this.vmPicker(guildId, actor, draftId, 0);
    },
    async listAzureVms(guildId, actor, page = 0) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const size = 8;
      if (!infra.configured) return notice("A Azure não está configurada. Nada foi listado.", config.panelColor);
      try {
        const vms = infra.listVms ? await infra.listVms() : [];
        const links = new Map(repo.listInfraLinks(guildId).map((link) => [link.infraId, link]));
        const rows = vms.map((vm) => {
          const link = links.get(vm.id);
          return { ...vm, clientId: link?.clientId || "", clientName: link?.clientName || "", agentLabel: link && agents ? agents.statusFor(link.clientId) : "" };
        });
        const pages = Math.max(1, Math.ceil(rows.length / size));
        const safePage = Math.min(Math.max(0, page), pages - 1);
        return renderAzureVmList({ accent: config.panelColor, rows: rows.slice(safePage * size, safePage * size + size), page: safePage, pages });
      } catch (error) {
        logInteractionError(error);
        return notice("Não foi possível listar as VMs na Azure.", config.panelColor);
      }
    },
    applyStep3({ guildId, actor, draftId, fields }) {
      const blocked = gate(actor);
      if (blocked) return { payload: blocked };
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft) return { payload: notice("O rascunho expirou. Comece de novo.", config.panelColor) };
      const schedule = validateSchedule({ ...fields, plan: draft.payload.plan });
      if (!schedule.ok) return { payload: notice(schedule.error, config.panelColor) };
      const other = repo.findByInfra(guildId, schedule.value.infraId);
      if (other && other.userId !== draft.payload.targetUserId) return { payload: notice("Este ID já está vinculado a outro cliente.", config.panelColor) };
      draft.payload = {
        ...draft.payload,
        ...schedule.value,
        startText: formatDate(schedule.value.startedAt),
        expiryText: formatDate(schedule.value.expiresAt),
      };
      storeDraft(draft);
      return { payload: renderReview(repo.getDraft(draft.id), config.panelColor, emojis.pack(guildId)) };
    },
    async installSummary(guildId, clientId, options = {}) {
      const client = repo.getById(guildId, clientId);
      if (!client) return "Este cliente não está cadastrado. O agente não foi instalado.";
      if (!client.infraId) return `A máquina ${client.machineName} não tem Resource ID. O agente não foi instalado.`;
      if (!config.publicBotUrl) return "Defina PUBLIC_BOT_URL com o endereço público do bot, por exemplo http://IP:PORT. O agente não foi instalado.";
      if (!infra?.configured || typeof infra.runCommand !== "function") return "A Azure não está configurada. O agente não foi instalado.";
      if (options.onProgress) await options.onProgress(notice("Instalando o agente na VM. Isso pode levar um minuto.", config.panelColor));
      const token = randomBytes(32).toString("base64url");
      let script = "";
      try {
        script = buildAgentInstallScript({ botUrl: config.publicBotUrl, token, installSunshine: config.installSunshine });
      } catch (error) {
        logInteractionError(error);
        return "O arquivo do agente não está neste processo. O agente não foi instalado.";
      }
      try {
        const result = await infra.runCommand(client.infraId, script);
        if (result?.reason === "stopped" || result?.status === "desligada") {
          return `A VM de ${client.machineName} está desligada. Ligue a máquina e use Instalar/Reinstalar agente.`;
        }
        if (result?.mode !== "azure") return "A Azure não está configurada. O agente não foi instalado.";
        if (result.reason) return `A Azure não concluiu a instalação do agente em ${client.machineName}. O token novo não foi gravado.`;
      } catch (error) {
        logInteractionError(error);
        return `A Azure não concluiu a instalação do agente em ${client.machineName}. O token novo não foi gravado.`;
      }
      agents.rememberToken(guildId, client, token);
      const status = await agents.waitForSeen(client.id, options.seenWaitMs ?? 20_000);
      await logged(options.actor, "agente_instalado", client.userId, client.machineName, `Agente instalado em ${client.machineName}.`, [token]);
      return `Agente instalado em ${client.machineName}. Situação: ${status}. Usuário e senha do Sunshine ficam somente na VM.`;
    },
    async installAgent(guildId, actor, clientId, options = {}) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      return notice(await this.installSummary(guildId, clientId, { ...options, actor }), config.panelColor);
    },
    async save(guildId, actor, draftId, options = {}) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft || draft.kind === "renew") return notice("O rascunho expirou. Comece de novo.", config.panelColor);
      const data = draft.payload;
      const other = repo.findByInfra(guildId, data.infraId);
      if (other && other.userId !== data.targetUserId) return notice("Este ID já está vinculado a outro cliente.", config.panelColor);
      const row = {
        id: data.existingId || randomUUID(),
        guildId,
        userId: data.targetUserId,
        clientName: data.clientName,
        machineName: data.machineName,
        gpu: data.gpu,
        vcpus: data.vcpus,
        ram: data.ram,
        publicIp: data.publicIp || null,
        rdpUser: data.rdpUser || null,
        rdpPasswordCipher: data.rdpPasswordCipher,
        pinCipher: data.pinCipher,
        planType: data.plan,
        startedAt: data.startedAt,
        expiresAt: data.expiresAt,
        infraId: data.infraId || null,
        powerStatus: "desconhecida",
        now: now(),
      };
      if (data.existingId) repo.updateClient(row);
      else repo.insertClient(row);
      repo.deleteDraft(draft.id);
      await logged(actor, draft.kind === "edit" ? "editar_cliente" : "adicionar_cliente", data.targetUserId, data.machineName, `Cliente salvo: ${data.machineName}.`);
      let message = `Cliente salvo: ${data.clientName} · ${data.machineName}.`;
      if (row.infraId) message = `${message}\n${await this.installSummary(guildId, row.id, { ...options, actor })}`;
      return notice(message, config.panelColor);
    },
    cancel(guildId, actor, draftId) {
      const draft = requireDraft(guildId, actor.id, draftId);
      if (draft) repo.deleteDraft(draft.id);
      return notice("Operação cancelada. Nada foi gravado.", config.panelColor);
    },
    removePreview(guildId, actor, userId) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const client = repo.getByOwner(guildId, userId);
      if (!client) return notice("Este membro não tem máquina cadastrada.", config.panelColor);
      return renderRemoveConfirm(client, config.panelColor, emojis.pack(guildId));
    },
    async remove(guildId, actor, userId) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const client = repo.getByOwner(guildId, userId);
      if (!client) return notice("Este membro não tem máquina cadastrada.", config.panelColor);
      repo.removeClient(guildId, userId);
      await logged(actor, "remover_cliente", userId, client.machineName, `Cliente removido: ${client.machineName}.`);
      return notice(`Cliente removido: ${client.clientName}. A VM na Azure não foi apagada.`, config.panelColor);
    },
    search(guildId, actor, term) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const clean = String(term ?? "").trim().slice(0, 40);
      if (clean.length < 2) return notice("Informe pelo menos 2 caracteres.", config.panelColor);
      const rows = repo.searchClients(guildId, clean).map((row) => ({ ...row, agentLabel: agents ? agents.statusFor(row.id) : "" }));
      return renderClientList(rows, { accent: config.panelColor, page: 0, pages: 1, title: "Busca", emojis: emojis.pack(guildId) });
    },
    list(guildId, actor, page) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const total = repo.countClients(guildId);
      const pages = Math.max(1, Math.ceil(total / PAGE));
      const safePage = Math.min(Math.max(0, page), pages - 1);
      const rows = repo.pageClients(guildId, PAGE, safePage * PAGE).map((row) => ({ ...row, agentLabel: agents ? agents.statusFor(row.id) : "" }));
      return renderClientList(rows, { accent: config.panelColor, page: safePage, pages, title: `Clientes · página ${safePage + 1} de ${pages}`, emojis: emojis.pack(guildId) });
    },
    renewPreview(guildId, actor, input) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const client = repo.getByOwner(guildId, input.userId);
      if (!client) return notice("Este membro não tem máquina cadastrada.", config.panelColor);
      const schedule = validateSchedule({
        start: input.start || formatDate(startOfToday(now())),
        expiry: input.expiry || "",
        plan: input.plan,
        infraId: client.infraId || "",
      });
      if (!schedule.ok) return notice(schedule.error, config.panelColor);
      const draft = storeDraft({
        id: randomUUID(),
        guildId,
        actorId: actor.id,
        kind: "renew",
        payload: {
          targetUserId: client.userId,
          clientName: client.clientName,
          machineName: client.machineName,
          plan: input.plan,
          startedAt: schedule.value.startedAt,
          expiresAt: input.expiry ? schedule.value.expiresAt : expiryFrom(schedule.value.startedAt, input.plan),
          startText: formatDate(schedule.value.startedAt),
          expiryText: formatDate(input.expiry ? schedule.value.expiresAt : expiryFrom(schedule.value.startedAt, input.plan)),
        },
      });
      return renderRenewReview(draft, config.panelColor, emojis.pack(guildId));
    },
    async renewSave(guildId, actor, draftId) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const draft = requireDraft(guildId, actor.id, draftId);
      if (!draft || draft.kind !== "renew") return notice("A renovação expirou. Comece de novo.", config.panelColor);
      const client = repo.getByOwner(guildId, draft.payload.targetUserId);
      if (!client) return notice("Este membro não tem máquina cadastrada.", config.panelColor);
      repo.updateClient({
        ...client,
        planType: draft.payload.plan,
        startedAt: draft.payload.startedAt,
        expiresAt: draft.payload.expiresAt,
        now: now(),
      });
      repo.deleteDraft(draft.id);
      await logged(actor, "renovar_plano", client.userId, client.machineName, `Plano renovado: ${draft.payload.plan}.`);
      return notice(`Plano renovado para ${client.clientName}.`, config.panelColor);
    },
    updateSettings(guildId, actor, patch) {
      const blocked = gate(actor);
      if (blocked) return blocked;
      const current = repo.getSettings(guildId);
      const next = {
        supportUrl: patch.supportUrl === undefined ? current.supportUrl : patch.supportUrl,
        logChannelId: patch.logChannelId === undefined ? current.logChannelId : patch.logChannelId,
        emoji: { ...current.emoji, ...(patch.emoji ?? {}) },
      };
      repo.saveSettings(guildId, next, now());
      return notice("Configuração salva para este servidor.", config.panelColor);
    },
    supportUrl(guildId) {
      return repo.getSettings(guildId).supportUrl || config.supportUrl || "";
    },
    pack(guildId) {
      return emojis.pack(guildId);
    },
  };
}
