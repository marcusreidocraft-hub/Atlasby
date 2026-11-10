import { randomUUID } from "node:crypto";
import { canPostLogs } from "./permissions.js";
import { staffMention, ticketOverwrites } from "./tickets.js";
import { azureFailureCode, openJson, probeTcp, sealJson } from "./azure.js";
import {
  AUTO_START_MAX_TRIES,
  AUTO_START_WINDOW_MS,
  MOONLIGHT_PORT,
  POWER_COOLDOWN_MS,
  VM_ACTIONS,
  backoffMs,
  evictionOf,
  expired,
  importKey,
  pageWindow,
  isCapacityError,
  isPublicIpv4,
  normalizePower,
  parseValidity,
  validateDiskIncrease,
  validateVmIdentity,
  validityText,
} from "./vm-model.js";
import {
  renderConnect,
  renderCredentials,
  renderDiskModal,
  renderImportList,
  renderImportSecretModal,
  renderImportSummary,
  renderImportUserPicker,
  renderImportValidityModal,
  renderPendingAzure,
  renderPowerConfirm,
  renderStateNotice,
  renderUserPicker,
  renderVmAdmin,
  renderVmConfirm,
  renderVmDetailsModal,
  renderUnlinkPicker,
  renderVmLogPicker,
  renderVmMenu,
  renderVmModal,
  renderVmPicker,
  renderSecretModal,
  renderValidityModal,
} from "./vm-ui.js";

export { VM_ACTIONS };

function done(action, code, extra = {}) {
  return { ok: true, action, code, confirmed: true, punishmentApplied: false, logDelivered: false, auditRecorded: false, ...extra };
}

const EMPTY_DEFAULTS = {
  location: "brazilsouth",
  vmSize: "Standard_NC4as_T4_v3",
  osType: "Windows",
  snapshotId: "",
  virtualNetwork: "",
  subnet: "",
  maxOsDiskGb: 2048,
};

export function createVmController({ store, discord, now, openConfirmation, deny, assertAdmin, azure, credentialKey, probe = probeTcp, defaults = EMPTY_DEFAULTS }) {
  const azureDefaults = { ...EMPTY_DEFAULTS, ...defaults };
  const importDrafts = new Map();
  function owned(guildId, userId, vmId) {
    const vm = store.getVm(guildId, vmId);
    if (!vm || !store.ownsVm(guildId, vmId, userId)) return null;
    return vm;
  }

  function menuOf(guildId, userId, vmId, category = "energy") {
    const choices = store.listAssignedVms(guildId, userId);
    const vm = choices.find((item) => item.id === vmId) ?? choices[0];
    if (!vm) return deny("upsert_vm", { code: "vm_none" });
    const settings = store.getAzureSettings(guildId);
    return {
      ok: true,
      view: renderVmMenu(vm, {
        now: now(),
        category,
        choices,
        azureConfigured: Boolean(azure?.configured),
        autoGlobal: settings.auto_start_enabled,
      }),
      vm,
    };
  }

  async function privateLog(guildId, lines) {
    const settings = store.getAzureSettings(guildId);
    if (!settings.log_channel_id || !discord.sendComponents) return { ok: false, code: "vm_log_missing" };
    let info;
    try {
      info = await discord.inspectChannel(settings.log_channel_id);
    } catch {
      return { ok: false, code: "vm_log_missing" };
    }
    if (!info || info.guildId !== guildId || info.type !== "GuildText" || info.everyoneCanView !== false || !canPostLogs(info.permissions)) {
      return { ok: false, code: "vm_log_unsafe" };
    }
    await discord.sendComponents(settings.log_channel_id, {
      components: renderStateNotice({ display_name: "registro" }, "interno", lines.join(" ")).components,
      flags: renderStateNotice({ display_name: "registro" }, "a", "b").flags,
      allowedMentions: { parse: [] },
    });
    return { ok: true };
  }

  async function observe(vm) {
    if (!azure?.configured) return { vm, changed: false, unconfigured: true };
    const view = await azure.getInstanceView(vm.resource_group, vm.vm_name);
    let publicIp = vm.public_ip;
    let privateIp = vm.private_ip;
    try {
      const network = await azure.readNetwork(vm.resource_group, vm.vm_name);
      publicIp = network.publicIp ?? publicIp;
      privateIp = network.privateIp ?? privateIp;
    } catch {
      // O estado de energia ainda pode ser lido sem o IP.
    }
    const power = normalizePower(view.powerState);
    const changed = power !== (vm.last_power ?? "unknown");
    const updated = store.updateVm(vm.guild_id, vm.id, {
      last_power: power,
      last_power_at: now(),
      public_ip: publicIp,
      private_ip: privateIp,
    }, now());
    return { vm: updated, changed, from: vm.last_power || "unknown", to: power, view };
  }

  async function perform(vm, actorId, operation) {
    if (!azure?.configured) return deny("upsert_vm", { code: "azure_unconfigured" });
    if ((operation === "start" || operation === "deallocate" || operation === "restart") && expired(vm, now())) {
      return deny("upsert_vm", { code: "vm_expired" });
    }
    if (!store.acquireVmLock({ vmId: vm.id, guildId: vm.guild_id, operation, actorId, now: now(), holdMs: POWER_COOLDOWN_MS })) {
      return deny("upsert_vm", { code: "vm_busy" });
    }
    const before = vm.last_power || "unknown";
    const previousDesired = vm.desired_power;
    if (operation === "deallocate") store.updateVm(vm.guild_id, vm.id, { desired_power: "stopped" }, now());
    if (operation === "start" || operation === "restart") store.updateVm(vm.guild_id, vm.id, { desired_power: "running" }, now());
    try {
      if (operation === "start") await azure.start(vm.resource_group, vm.vm_name);
      else if (operation === "deallocate") await azure.deallocate(vm.resource_group, vm.vm_name);
      else await azure.restart(vm.resource_group, vm.vm_name);
    } catch (error) {
      store.updateVm(vm.guild_id, vm.id, { desired_power: previousDesired }, now());
      return deny("upsert_vm", { code: isCapacityError(error) ? "azure_capacity" : "azure_failed" });
    }
    const seen = await observe(store.getVm(vm.guild_id, vm.id)).catch(() => null);
    const current = seen?.vm ?? store.getVm(vm.guild_id, vm.id);
    await privateLog(vm.guild_id, [`${operation}`, current.display_name, actorId]).catch(() => {});
    const notice = seen?.changed ? renderStateNotice(current, before, seen.to) : null;
    return done("upsert_vm", "vm_requested", { vm: current, notice, view: menuOf(vm.guild_id, actorId, vm.id).view });
  }

  async function notifyUser(userId, payload) {
    if (!discord.tryDm) return false;
    try {
      await discord.tryDm(userId, { ...payload, allowedMentions: { parse: [] } });
      return true;
    } catch {
      return false;
    }
  }

  return {
    menu(guildId, userId, vmId, category) {
      return menuOf(guildId, userId, vmId, category);
    },
    async refresh(guildId, userId, vmId, category = "energy") {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      const seen = await observe(vm).catch((error) => ({ error }));
      if (seen.error) return deny("upsert_vm", { code: seen.error.code || "azure_failed" });
      const view = menuOf(guildId, userId, vmId, category);
      return { ...view, update: true, notice: seen.changed ? renderStateNotice(seen.vm, seen.from, seen.to) : null };
    },
    async requestPower(guildId, userId, vmId, operation) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      if (!azure?.configured) return deny("upsert_vm", { code: "azure_unconfigured" });
      if (expired(vm, now())) return deny("upsert_vm", { code: "vm_expired" });
      if (operation === "start") return { ok: true, pending: true, task: () => perform(vm, userId, "start") };
      if (operation !== "deallocate" && operation !== "restart") return deny("upsert_vm", { code: "vm_invalid" });
      return { ok: true, view: renderPowerConfirm(vm, operation) };
    },
    async confirmPower(guildId, userId, vmId, operation) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      return { ok: true, pending: true, task: () => perform(vm, userId, operation) };
    },
    connect(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      return { ok: true, view: renderConnect(vm) };
    },
    async releasePin(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      await privateLog(guildId, ["pedido de PIN", vm.display_name, userId]).catch(() => {});
      return done("upsert_vm", "vm_pin_requested");
    },
    credentials(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      let secret = null;
      if (vm.credentials_cipher) {
        try {
          secret = openJson(credentialKey, vm.credentials_cipher);
        } catch {
          return deny("set_vm_secret", { code: "credentials_unreadable" });
        }
      }
      return { ok: true, view: renderCredentials(vm, secret) };
    },
    async probe(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      const seen = azure?.configured ? await observe(vm).catch(() => null) : null;
      const current = seen?.vm ?? vm;
      if (!isPublicIpv4(current.public_ip)) return deny("upsert_vm", { code: "vm_probe_skipped" });
      const open = await probe(current.public_ip, MOONLIGHT_PORT, 1500);
      return done("upsert_vm", open ? "vm_probe_ok" : "vm_probe_closed", { view: renderConnect(current) });
    },
    plan(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      return done("upsert_vm", "vm_plan", { summary: `${vm.display_name}: ${validityText(vm.validity_until, now())}.` });
    },
    async renew(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      await privateLog(guildId, ["pedido de renovação", vm.display_name, userId]).catch(() => {});
      return done("upsert_vm", "vm_renewal", { summary: "Pedido de renovação registrado. Não há cobrança automática." });
    },
    diskModal(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("request_disk", { code: "vm_missing" });
      return { ok: true, modal: renderDiskModal(vm, azureDefaults.maxOsDiskGb) };
    },
    async requestDisk({ guildId, userId, vmId, raw }) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("request_disk", { code: "vm_missing" });
      const valid = validateDiskIncrease(vm.disk_gb, Number(String(raw).trim()), azureDefaults.maxOsDiskGb);
      if (!valid.ok) return deny("request_disk", valid);
      return openConfirmation({
        action: "request_disk",
        guildId,
        actorId: userId,
        targetId: vmId,
        reason: "Pedir aumento de disco",
        payload: { vmId, requestedGb: valid.requestedGb, currentGb: vm.disk_gb ?? null },
        summary: `Pedir disco de ${vm.disk_gb ?? "tamanho atual"} GB para ${valid.requestedGb} GB. A equipe confirma antes de alterar o Azure.`,
      });
    },
    async support(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      const settings = store.getSettings(guildId);
      if (settings?.ticket_category_id && settings?.staff_role_id && discord.createTicketChannel && discord.guildIdentity) {
        try {
          const identity = await discord.guildIdentity(guildId);
          const created = await discord.createTicketChannel({
            guildId,
            name: `suporte-${vm.vm_name}`.slice(0, 90),
            parentId: settings.ticket_category_id,
            overwrites: ticketOverwrites({
              everyoneId: identity.everyoneId,
              openerId: userId,
              staffRoleId: settings.staff_role_id,
              botId: identity.botId,
            }),
          });
          const mention = staffMention(settings.staff_role_id);
          if (discord.sendComponents) {
            await discord.sendComponents(created.id, {
              components: renderStateNotice(vm, "suporte", "aberto").components,
              allowedMentions: mention.allowedMentions,
            });
          }
          return done("upsert_vm", "vm_support_opened", { summary: `Canal <#${created.id}> criado para ${vm.display_name}.` });
        } catch {
          return deny("upsert_vm", { code: "vm_support_failed" });
        }
      }
      const logged = await privateLog(guildId, ["suporte", vm.display_name, userId]).catch(() => ({ ok: false }));
      if (!logged.ok) return deny("upsert_vm", { code: "vm_support_unconfigured" });
      return done("upsert_vm", "vm_support_logged");
    },
    async toggleAuto(guildId, userId, vmId) {
      const vm = owned(guildId, userId, vmId);
      if (!vm) return deny("set_vm_policy", { code: "vm_missing" });
      const settings = store.getAzureSettings(guildId);
      if (!settings.auto_start_enabled) return deny("set_vm_policy", { code: "vm_auto_disabled" });
      store.updateVm(guildId, vmId, { auto_start: !vm.auto_start }, now());
      return { ...menuOf(guildId, userId, vmId, "energy"), update: true };
    },
    async admin(guildId, actorId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      const vms = store.listVms(guildId);
      const settings = store.getAzureSettings(guildId);
      return {
        ok: true,
        view: renderVmAdmin({
          vms,
          azureConfigured: Boolean(azure?.configured),
          autoGlobal: settings.auto_start_enabled,
          defaults: azureDefaults,
          users: (vmId) => store.listVmUsers(guildId, vmId),
          entra: (vmId) => store.entraLinkForVm(guildId, vmId),
        }),
      };
    },
    userPicker(guildId, actorId) {
      return this.admin(guildId, actorId).then((result) => (result.view ? { ok: true, view: renderUserPicker(), update: true } : result));
    },
    async pickLink(guildId, actorId, userId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      const vms = store.listVms(guildId);
      if (!vms.length) return deny("link_vm", { code: "vm_none" });
      return { ok: true, view: renderVmPicker(`atlasby:vmcfg:link:${userId}`, vms, `Vincular <@${userId}> a uma VM.`), update: true };
    },
    createModal() {
      return renderVmModal(azureDefaults);
    },
    detailsModal(guildId, vmId) {
      const vm = store.getVm(guildId, vmId);
      if (!vm) return deny("upsert_vm", { code: "vm_missing" });
      return { ok: true, modal: renderVmDetailsModal(vm, azureDefaults) };
    },
    secretModal(guildId, vmId) {
      const vm = store.getVm(guildId, vmId);
      if (!vm) return deny("set_vm_secret", { code: "vm_missing" });
      return { ok: true, modal: renderSecretModal(vm) };
    },
    validityModal(guildId, vmId) {
      const vm = store.getVm(guildId, vmId);
      if (!vm) return deny("set_vm_validity", { code: "vm_missing" });
      return { ok: true, modal: renderValidityModal(vm) };
    },
    async chooseVm(guildId, actorId, purpose) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      const vms = store.listVms(guildId);
      if (!vms.length) return deny("upsert_vm", { code: "vm_none" });
      return { ok: true, view: renderVmPicker(`atlasby:vmcfg:choose:${purpose}`, vms, "Escolha a VM."), update: true };
    },
    async requestCreate({ guildId, actorId, displayName, resourceGroup, vmName, osLabel, diskGb, sizeLabel, location }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      const valid = validateVmIdentity({ displayName, resourceGroup, vmName });
      if (!valid.ok) return deny("upsert_vm", valid);
      const disk = diskGb == null || diskGb === "" ? null : Number(diskGb);
      if (disk != null && (!Number.isInteger(disk) || disk < 1 || disk > azureDefaults.maxOsDiskGb)) {
        return deny("upsert_vm", { code: "disk_invalid", maxDisk: azureDefaults.maxOsDiskGb });
      }
      return openConfirmation({
        action: "upsert_vm",
        guildId,
        actorId,
        targetId: `${valid.resourceGroup}:${valid.vmName}`.slice(0, 80),
        reason: "Cadastrar VM",
        payload: {
          ...valid,
          osLabel: osLabel || azureDefaults.osType,
          diskGb: disk,
          sizeLabel: sizeLabel || azureDefaults.vmSize,
          location: location || azureDefaults.location,
          spot: true,
        },
        summary: `Cadastrar ${valid.displayName} (${valid.resourceGroup}/${valid.vmName}) em ${location || azureDefaults.location}, tamanho ${sizeLabel || azureDefaults.vmSize}. Nenhuma VM é criada na Azure agora.`,
      });
    },
    async requestDetails({ guildId, actorId, vmId, sizeLabel, cpuLabel, ramLabel, gpuLabel, location }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      if (!store.getVm(guildId, vmId)) return deny("upsert_vm", { code: "vm_missing" });
      return openConfirmation({
        action: "upsert_vm",
        guildId,
        actorId,
        targetId: vmId,
        reason: "Editar detalhes da VM",
        payload: { vmId, sizeLabel: sizeLabel || null, cpuLabel: cpuLabel || null, ramLabel: ramLabel || null, gpuLabel: gpuLabel || null, location: location || null, details: true },
        summary: "Atualizar tamanho, CPU, RAM e GPU informados. Nada disso é inventado pelo bot.",
      });
    },
    async requestSecret({ guildId, actorId, vmId, username, password, pin }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_vm_secret" };
      if (!store.getVm(guildId, vmId)) return deny("set_vm_secret", { code: "vm_missing" });
      if (!credentialKey) return deny("set_vm_secret", { code: "credentials_key_missing" });
      const user = String(username ?? "").trim();
      const pass = String(password ?? "");
      if (user.length < 1 || user.length > 64 || pass.length < 1 || pass.length > 128) return deny("set_vm_secret", { code: "vm_invalid" });
      const cleanPin = String(pin ?? "").trim();
      if (cleanPin && !/^\d{4,8}$/.test(cleanPin)) return deny("set_vm_secret", { code: "vm_invalid" });
      const cipher = sealJson(credentialKey, { username: user, password: pass, pin: cleanPin || null });
      return openConfirmation({
        action: "set_vm_secret",
        guildId,
        actorId,
        targetId: vmId,
        reason: "Gravar credenciais da VM",
        payload: { vmId, cipher },
        summary: "Gravar usuário e senha cifrados. A senha não aparece neste resumo.",
      });
    },
    async requestValidity({ guildId, actorId, vmId, raw, blockText }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_vm_validity" };
      if (!store.getVm(guildId, vmId)) return deny("set_vm_validity", { code: "vm_missing" });
      const parsed = parseValidity(raw);
      if (!parsed.ok) return deny("set_vm_validity", parsed);
      const block = String(blockText ?? "").trim().toLowerCase();
      if (!["sim", "nao", "não"].includes(block)) return deny("set_vm_validity", { code: "validity_invalid" });
      return openConfirmation({
        action: "set_vm_validity",
        guildId,
        actorId,
        targetId: vmId,
        reason: "Definir validade",
        payload: { vmId, until: parsed.until, block: block === "sim" },
        summary: `Validade: ${validityText(parsed.until, now())}. Energia vencida ${block === "sim" ? "bloqueada" : "liberada"}.`,
      });
    },
    async requestLink({ guildId, actorId, vmId, userId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "link_vm" };
      if (!store.getVm(guildId, vmId)) return deny("link_vm", { code: "vm_missing" });
      return openConfirmation({
        action: "link_vm",
        guildId,
        actorId,
        targetId: `${vmId}:${userId}`,
        reason: "Vincular cliente à VM",
        payload: { vmId, userId },
        summary: `Vincular <@${userId}> a esta VM.`,
      });
    },
    async requestUnlink({ guildId, actorId, vmId, userId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "unlink_vm" };
      return openConfirmation({
        action: "unlink_vm",
        guildId,
        actorId,
        targetId: `${vmId}:${userId}`,
        reason: "Remover vínculo",
        payload: { vmId, userId },
        summary: `Remover <@${userId}> desta VM.`,
      });
    },
    async requestApproveDisk({ guildId, actorId, requestId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "approve_disk" };
      const request = store.getDiskRequest(guildId, requestId);
      if (!request || request.status !== "pending") return deny("approve_disk", { code: "vm_missing" });
      return openConfirmation({
        action: "approve_disk",
        guildId,
        actorId,
        targetId: requestId,
        reason: "Aprovar aumento de disco",
        payload: { requestId },
        summary: `Aumentar o disco para ${request.requested_gb} GB. A VM precisa estar desalocada. O disco não diminui.`,
      });
    },
    async unlinkPicker(guildId, actorId, vmId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      const vm = store.getVm(guildId, vmId);
      const users = store.listVmUsers(guildId, vmId);
      if (!vm || !users.length) return deny("unlink_vm", { code: "vm_none" });
      return { ok: true, view: renderUnlinkPicker(vm, users), update: true };
    },
    async requestPolicy({ guildId, actorId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_vm_policy" };
      const settings = store.getAzureSettings(guildId);
      return openConfirmation({
        action: "set_vm_policy",
        guildId,
        actorId,
        targetId: guildId,
        reason: "Alterar auto ligamento global",
        payload: { enabled: !settings.auto_start_enabled },
        summary: settings.auto_start_enabled ? "Pausar o auto ligamento em todas as VMs deste servidor." : "Retomar o auto ligamento.",
      });
    },
    async requestLog({ guildId, actorId, channelId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_vm_log" };
      let info;
      try {
        info = await discord.inspectChannel(channelId);
      } catch {
        return deny("set_vm_log", { code: "vm_log_missing" });
      }
      if (!info || info.guildId !== guildId || info.type !== "GuildText" || info.everyoneCanView !== false || !canPostLogs(info.permissions)) {
        return deny("set_vm_log", { code: "vm_log_unsafe" });
      }
      return openConfirmation({
        action: "set_vm_log",
        guildId,
        actorId,
        targetId: channelId,
        reason: "Definir canal privado das VMs",
        payload: { channelId },
        summary: `Registrar operações em <#${channelId}>.`,
      });
    },
    async catalogFromAzure() {
      if (!azure?.configured || !azure.listVirtualMachines) return { ok: false, code: "azure_unconfigured" };
      try {
        const items = await azure.listVirtualMachines();
        return { ok: true, items: items ?? [] };
      } catch (error) {
        return { ok: false, code: azureFailureCode(error) };
      }
    },
    linkedKeys(guildId) {
      return new Set(store.listVms(guildId).map((vm) => importKey(vm.resource_group, vm.vm_name)));
    },
    async importList(guildId, actorId, page = 0, groupIndex = 0) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      const listed = await this.catalogFromAzure();
      if (!listed.ok) return deny("upsert_vm", { code: listed.code });
      const groups = [...new Set(listed.items.map((item) => item.resourceGroup).filter(Boolean))].sort();
      const shownGroups = groups.slice(0, 24);
      const token = String(groupIndex ?? "0");
      const group = token === "0" || token === "all"
        ? null
        : /^[0-9a-f]{32}$/.test(token)
          ? shownGroups.find((name) => importKey("group", name) === token) ?? null
          : /^\d+$/.test(token) && Number(token) > 0
            ? shownGroups[Number(token) - 1] ?? null
            : null;
      const linked = this.linkedKeys(guildId);
      const filtered = (group ? listed.items.filter((item) => item.resourceGroup === group) : listed.items)
        .filter((item) => !linked.has(importKey(item.resourceGroup, item.name)));
      const hidden = listed.items.length - filtered.length - (group ? listed.items.filter((item) => item.resourceGroup !== group).length : 0);
      if (!listed.items.length) return deny("upsert_vm", { code: "azure_empty" });
      const window = pageWindow(filtered, Number(page) || 0);
      const options = window.items.map((item) => ({
        label: String(item.name).slice(0, 100),
        description: `${item.resourceGroup} · ${item.size || "tamanho"} · ${item.location || "região"}`.slice(0, 100),
        value: importKey(item.resourceGroup, item.name),
      }));
      return {
        ok: true,
        update: true,
        page: window.page,
        pages: window.pages,
        view: renderImportList({
          page: window.page,
          pages: window.pages,
          total: window.total,
          hidden: Math.max(0, hidden),
          group,
          groupToken: group ? importKey("group", group) : "all",
          groups: shownGroups,
          options,
        }),
      };
    },
    async findImported(guildId, key) {
      const listed = await this.catalogFromAzure();
      if (!listed.ok) return listed;
      const item = listed.items.find((entry) => importKey(entry.resourceGroup, entry.name) === key);
      if (!item) return { ok: false, code: "vm_missing" };
      if (this.linkedKeys(guildId).has(key)) return { ok: false, code: "vm_exists" };
      try {
        const details = azure.describeVirtualMachine
          ? await azure.describeVirtualMachine(item.resourceGroup, item.name)
          : item;
        return { ok: true, details: { ...item, ...details, resourceGroup: item.resourceGroup, name: item.name } };
      } catch (error) {
        return { ok: false, code: azureFailureCode(error) };
      }
    },
    draftFor(guildId, actorId, key) {
      const id = `${guildId}:${actorId}:${key}`;
      if (!importDrafts.has(id)) importDrafts.set(id, {});
      return { id, draft: importDrafts.get(id) };
    },
    async importPreview(guildId, actorId, key) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      const found = await this.findImported(guildId, key);
      if (!found.ok) return deny("upsert_vm", found);
      const { draft } = this.draftFor(guildId, actorId, key);
      draft.details = found.details;
      return {
        ok: true,
        update: true,
        view: renderImportSummary(found.details, { key, userLabel: draft.userId ? `<@${draft.userId}>` : "ninguém" }),
      };
    },
    async stageImportUser(guildId, actorId, key, userId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      const { draft } = this.draftFor(guildId, actorId, key);
      draft.userId = userId;
      return this.importPreview(guildId, actorId, key);
    },
    importUserPicker(key) {
      return { ok: true, update: true, view: renderImportUserPicker(key) };
    },
    importValidityModal(key) {
      return renderImportValidityModal(key);
    },
    importSecretModal(key) {
      return renderImportSecretModal(key);
    },
    stageImportValidity(guildId, actorId, key, raw, blockText) {
      const parsed = parseValidity(raw);
      if (!parsed.ok) return deny("set_vm_validity", parsed);
      const block = String(blockText ?? "").trim().toLowerCase();
      if (block && !["sim", "nao", "não"].includes(block)) return deny("set_vm_validity", { code: "validity_invalid" });
      const { draft } = this.draftFor(guildId, actorId, key);
      draft.until = parsed.until;
      draft.block = block ? block === "sim" : true;
      return this.importPreview(guildId, actorId, key);
    },
    stageImportSecret(guildId, actorId, key, username, password, pin) {
      if (!credentialKey) return deny("set_vm_secret", { code: "credentials_key_missing" });
      const user = String(username ?? "").trim();
      const pass = String(password ?? "");
      if (user.length < 1 || user.length > 64 || pass.length < 1 || pass.length > 128) return deny("set_vm_secret", { code: "vm_invalid" });
      const cleanPin = String(pin ?? "").trim();
      if (cleanPin && !/^\d{4,8}$/.test(cleanPin)) return deny("set_vm_secret", { code: "vm_invalid" });
      const { draft } = this.draftFor(guildId, actorId, key);
      draft.cipher = sealJson(credentialKey, { username: user, password: pass, pin: cleanPin || null });
      return this.importPreview(guildId, actorId, key);
    },
    async requestImport(guildId, actorId, key) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "upsert_vm" };
      const found = await this.findImported(guildId, key);
      if (!found.ok) return deny("upsert_vm", found);
      const { draft } = this.draftFor(guildId, actorId, key);
      if (!draft.userId) return deny("upsert_vm", { code: "vm_user_required" });
      const details = found.details;
      return openConfirmation({
        action: "upsert_vm",
        guildId,
        actorId,
        targetId: `${details.resourceGroup}:${details.name}`.slice(0, 80),
        reason: "Importar VM da assinatura",
        payload: {
          imported: true,
          displayName: details.name,
          resourceGroup: details.resourceGroup,
          vmName: details.name,
          osLabel: details.osType || azureDefaults.osType,
          sizeLabel: details.size,
          location: details.location,
          cpuLabel: details.cpu,
          ramLabel: details.ram,
          gpuLabel: details.gpu,
          diskGb: details.diskGb ?? null,
          publicIp: details.publicIp ?? null,
          privateIp: details.privateIp ?? null,
          priority: details.priority || "Regular",
          userId: draft.userId,
          until: draft.until ?? null,
          block: draft.block !== false,
          cipher: draft.cipher ?? null,
        },
        summary: `Importar ${details.name} (${details.resourceGroup}) para <@${draft.userId}>. ${details.priority || "Regular"}, disco ${details.diskGb ?? "não informado"} GB. A Azure não será alterada.`,
      });
    },
    async prepare(row, actorId) {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        return deny(row.action, { code: "confirmation_mismatch" });
      }
      if (row.action === "request_disk") {
        const vm = owned(row.guild_id, actorId, payload.vmId);
        if (!vm || payload.vmId !== row.target_id) return deny(row.action, { code: "vm_missing" });
        return { ok: true };
      }
      const auth = await assertAdmin(row.guild_id, actorId);
      if (!auth.ok) return { ...auth, action: row.action };
      return { ok: true };
    },
    async execute(row) {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        return deny(row.action, { code: "confirmation_mismatch" });
      }
      const guildId = row.guild_id;
      const ts = now();
      if (row.action === "upsert_vm" && payload.details) {
        store.updateVm(guildId, payload.vmId, {
          size_label: payload.sizeLabel,
          cpu_label: payload.cpuLabel,
          ram_label: payload.ramLabel,
          gpu_label: payload.gpuLabel,
          location: payload.location,
        }, ts);
        return done(row.action, "config_saved");
      }
      if (row.action === "upsert_vm") {
        const id = randomUUID();
        try {
          store.insertVm({
            id,
            guildId,
            displayName: payload.displayName,
            resourceGroup: payload.resourceGroup,
            vmName: payload.vmName,
            osLabel: payload.osLabel,
            sizeLabel: payload.sizeLabel ?? null,
            cpuLabel: payload.cpuLabel ?? null,
            ramLabel: payload.ramLabel ?? null,
            gpuLabel: payload.gpuLabel ?? null,
            diskGb: payload.diskGb,
            location: payload.location ?? null,
            publicIp: payload.publicIp ?? null,
            privateIp: payload.privateIp ?? null,
            validityUntil: payload.until ?? null,
            blockWhenExpired: payload.block !== false,
            autoStart: false,
            spot: payload.priority ? payload.priority === "Spot" : payload.spot !== false,
            now: ts,
          });
          if (payload.userId) store.linkVm(guildId, id, payload.userId, ts);
          if (payload.cipher) store.updateVm(guildId, id, { credentials_cipher: payload.cipher }, ts);
        } catch (error) {
          if (String(error?.message ?? "").toLowerCase().includes("unique")) return deny(row.action, { code: "vm_exists" });
          throw error;
        }
        return done(row.action, "config_saved");
      }
      if (row.action === "link_vm") {
        if (!store.linkVm(guildId, payload.vmId, payload.userId, ts) && !store.ownsVm(guildId, payload.vmId, payload.userId)) {
          return deny(row.action, { code: "vm_missing" });
        }
        return done(row.action, "config_saved");
      }
      if (row.action === "unlink_vm") {
        store.unlinkVm(guildId, payload.vmId, payload.userId);
        return done(row.action, "config_saved");
      }
      if (row.action === "set_vm_secret") {
        store.updateVm(guildId, payload.vmId, { credentials_cipher: payload.cipher }, ts);
        return done(row.action, "config_saved");
      }
      if (row.action === "set_vm_validity") {
        store.updateVm(guildId, payload.vmId, { validity_until: payload.until, block_when_expired: payload.block }, ts);
        return done(row.action, "config_saved");
      }
      if (row.action === "set_vm_policy") {
        store.saveAzureSettings(guildId, { auto_start_enabled: payload.enabled }, ts);
        return done(row.action, "config_saved");
      }
      if (row.action === "set_vm_log") {
        store.saveAzureSettings(guildId, { log_channel_id: payload.channelId }, ts);
        return done(row.action, "config_saved");
      }
      if (row.action === "request_disk") {
        const id = randomUUID();
        store.insertDiskRequest({
          id,
          guildId,
          vmId: payload.vmId,
          userId: row.moderator_id,
          currentGb: payload.currentGb,
          requestedGb: payload.requestedGb,
          now: ts,
        });
        await privateLog(guildId, ["pedido de disco", String(payload.requestedGb), "GB"]).catch(() => {});
        return done(row.action, "vm_disk_requested");
      }
      if (row.action === "approve_disk") {
        const request = store.getDiskRequest(guildId, payload.requestId);
        if (!request || request.status !== "pending") return deny(row.action, { code: "vm_missing" });
        const vm = store.getVm(guildId, request.vm_id);
        if (!vm) return deny(row.action, { code: "vm_missing" });
        if (!azure?.configured) return deny(row.action, { code: "azure_unconfigured" });
        try {
          await azure.resizeDisk(vm.resource_group, vm.vm_name, request.requested_gb);
        } catch (error) {
          store.finishDiskRequest(guildId, request.id, "failed", row.moderator_id, error.code || "azure_failed", ts);
          return deny(row.action, { code: error.code || "azure_failed" });
        }
        store.finishDiskRequest(guildId, request.id, "approved", row.moderator_id, null, ts);
        store.updateVm(guildId, vm.id, { disk_gb: request.requested_gb }, ts);
        return done(row.action, "config_saved");
      }
      if (row.action === "delete_vm") {
        if (!store.deleteVm(guildId, payload.vmId)) return deny(row.action, { code: "vm_missing" });
        return done(row.action, "config_saved");
      }
      return deny(row.action, { code: "unknown_action" });
    },
    async autoStartPass() {
      if (!azure?.configured) return { ok: true, checked: 0 };
      const due = store.listAutoStartVms();
      let checked = 0;
      for (const vm of due) {
        if (expired(vm, now())) continue;
        checked += 1;
        let view;
        try {
          view = await azure.getInstanceView(vm.resource_group, vm.vm_name);
        } catch {
          continue;
        }
        const observed = normalizePower(view.powerState);
        const changed = observed !== (vm.last_power ?? "unknown");
        const evicted = evictionOf({ desired: vm.desired_power, observed, statuses: view.statuses });
        store.updateVm(vm.guild_id, vm.id, { last_power: observed, last_power_at: now() }, now());
        if (changed && !evicted) {
          const users = store.listVmUsers(vm.guild_id, vm.id);
          const notice = renderStateNotice(vm, vm.last_power || "unknown", observed);
          notice.flags = 32768;
          for (const user of users) await notifyUser(user.user_id, notice);
        }
        if (!evicted) continue;
        const retry = store.getVmRetry(vm.id);
        if (retry && retry.next_at > now()) continue;
        const attempts = retry?.attempts ?? 0;
        if (attempts >= AUTO_START_MAX_TRIES) {
          store.saveVmRetry({ vmId: vm.id, guildId: vm.guild_id, attempts: 0, nextAt: now() + AUTO_START_WINDOW_MS, lastNotice: "window", now: now() });
          continue;
        }
        if (!store.acquireVmLock({ vmId: vm.id, guildId: vm.guild_id, operation: "autostart", actorId: "monitor", now: now(), holdMs: POWER_COOLDOWN_MS })) continue;
        const users = store.listVmUsers(vm.guild_id, vm.id);
        let handled = false;
        try {
          await azure.start(vm.resource_group, vm.vm_name);
          store.clearVmRetry(vm.id);
          store.updateVm(vm.guild_id, vm.id, { desired_power: "running", last_power: "starting" }, now());
          const notice = renderStateNotice(vm, observed, "starting");
          notice.flags = 32768;
          for (const user of users) await notifyUser(user.user_id, notice);
          await privateLog(vm.guild_id, ["auto ligamento", vm.display_name, "aceito"]).catch(() => {});
          handled = true;
        } catch (error) {
          const nextAttempts = attempts + 1;
          const wait = isCapacityError(error) ? backoffMs(nextAttempts) : backoffMs(nextAttempts);
          store.saveVmRetry({ vmId: vm.id, guildId: vm.guild_id, attempts: nextAttempts, nextAt: now() + wait, lastNotice: isCapacityError(error) ? "capacity" : "failed", now: now() });
          const text = isCapacityError(error)
            ? renderStateNotice(vm, observed, "sem capacidade Spot")
            : renderStateNotice(vm, observed, "falha ao ligar");
          text.flags = 32768;
          for (const user of users) await notifyUser(user.user_id, text);
        }
      }
      return { ok: true, checked };
    },
  };
}
