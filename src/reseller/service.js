import { randomUUID } from "node:crypto";
import { notice } from "../panels/ui.js";
import { validatePassword } from "../services/password.js";
import { vmOptionValue } from "../services/provider.js";
import { normalizeVmId, resolveOwner } from "../services/vm-link.js";
import { createRateLimit, generateResellerKey, hashResellerKey, resellerKeysMatch } from "./keys.js";
import { assignmentFor } from "./match.js";

const OPERATION_STATE = {
  start: "iniciando",
  stop: "parando",
  restart: "reiniciando",
  password: "alterando senha",
};

export function hasAdministrator(actor) {
  if (actor?.owner) return true;
  try {
    return (BigInt(actor?.permissions ?? 0) & 8n) === 8n;
  } catch {
    return false;
  }
}

function publicVm(row) {
  return {
    id: row.id,
    name: row.name,
    state: row.operation ? (OPERATION_STATE[row.operation] || row.powerState) : (row.powerState || "desconhecida"),
    publicIp: row.publicIp || "",
    size: row.size || "",
  };
}

export function createResellers({ repo, infra, audit, config, now = () => Date.now(), rateLimit = 30 }) {
  const limiter = createRateLimit({ limit: rateLimit, now });
  const locks = new Set();

  function denied() {
    return notice("Só quem tem Administrador no servidor pode gerenciar revendedores.", config.panelColor);
  }

  async function note(guildId, actorId, action, detail) {
    await audit?.record?.({ guildId, actorId, action, detail }).catch(() => {});
  }

  async function catalog() {
    if (!infra?.listVms) return [];
    return infra.listVms();
  }

  function owned(reseller, id) {
    const vm = repo.resellerVm(id);
    if (!vm || vm.resellerId !== reseller.id || vm.guildId !== reseller.guildId) return null;
    return vm;
  }

  function missing() {
    return { status: 404, body: { error: "não encontrado" } };
  }

  async function runPower(reseller, vm, action) {
    try {
      const result = action === "restart"
        ? await infra.restart?.(vm.infraId)
        : await infra.setPower?.(vm.infraId, action === "start" ? "ligada" : "desligada");
      if (!result || result.mode !== "azure") {
        repo.patchResellerVm(vm.id, { operation: "", powerState: vm.powerState }, now());
        await note(reseller.guildId, reseller.id, "revendedor_acao", `Revendedor ${reseller.name} · ${vm.name} · ${action} · não concluída.`);
        return;
      }
      const power = action === "stop" ? "desligada" : "ligada";
      repo.patchResellerVm(vm.id, { operation: "", powerState: power }, now());
      await note(reseller.guildId, reseller.id, "revendedor_acao", `Revendedor ${reseller.name} · ${vm.name} · ${action}.`);
    } catch {
      repo.patchResellerVm(vm.id, { operation: "", powerState: vm.powerState }, now());
      await note(reseller.guildId, reseller.id, "revendedor_acao", `Revendedor ${reseller.name} · ${vm.name} · ${action} · falha.`);
    }
  }

  async function runPassword(reseller, vm, password) {
    try {
      const account = await infra.adminUsername?.(vm.infraId).catch(() => "") || "";
      const check = validatePassword(password, password, account);
      if (!check.ok) {
        repo.patchResellerVm(vm.id, { operation: "" }, now());
        await note(reseller.guildId, reseller.id, "revendedor_senha", `Revendedor ${reseller.name} · ${vm.name} · senha recusada.`);
        return;
      }
      const result = await infra.resetWindowsPassword(vm.infraId, { username: account, password });
      repo.patchResellerVm(vm.id, { operation: "" }, now());
      await note(reseller.guildId, reseller.id, "revendedor_senha", `Revendedor ${reseller.name} · ${vm.name} · ${result?.code === "ok" ? "senha alterada" : "senha não alterada"}.`);
    } catch {
      repo.patchResellerVm(vm.id, { operation: "" }, now());
      await note(reseller.guildId, reseller.id, "revendedor_senha", `Revendedor ${reseller.name} · ${vm.name} · falha.`);
    }
  }

  return {
    hasAdministrator,
    search(guildId, query) {
      const needle = String(query || "").toLowerCase();
      return repo.resellers(guildId).filter((item) => !item.revoked && item.name.toLowerCase().includes(needle));
    },
    async vmOptions(guildId, subcommand, resellerId, query) {
      const needle = String(query || "").toLowerCase();
      if (subcommand === "remover-vm") {
        const reseller = repo.reseller(resellerId);
        if (!reseller || reseller.guildId !== guildId) return [];
        return repo.resellerVms(reseller.id)
          .filter((vm) => vm.name.toLowerCase().includes(needle))
          .slice(0, 25)
          .map((vm) => ({ name: vm.name.slice(0, 100), value: vm.id }));
      }
      let vms = [];
      try { vms = await catalog(); } catch { return []; }
      const clients = repo.listClients(guildId);
      const assigned = repo.resellerVmsByGuild(guildId);
      return vms.filter((vm) => {
        if (resolveOwner(vm, clients)) return false;
        if (assignmentFor(vm, assigned)) return false;
        return `${vm.name} ${vm.resourceGroup || ""}`.toLowerCase().includes(needle);
      }).slice(0, 25).map((vm) => ({
        name: `${vm.name} · ${vm.resourceGroup || "grupo"}`.slice(0, 100),
        value: vmOptionValue(vm.id),
      }));
    },
    create(guildId, actor, name) {
      if (!hasAdministrator(actor)) return { payload: denied() };
      const clean = String(name || "").trim().slice(0, 40);
      if (!clean) return { payload: notice("Informe o nome do revendedor.", config.panelColor) };
      const { token, hash } = generateResellerKey();
      const id = randomUUID();
      repo.insertReseller({ id, guildId, name: clean, keyHash: hash, now: now() });
      void note(guildId, actor.id, "revendedor_criar", `Revendedor ${clean} criado.`);
      return {
        token,
        payload: notice(`Revendedor ${clean} criado.\nCopie a chave agora. Ela não será mostrada de novo.\n\`${token}\``, config.panelColor),
      };
    },
    list(guildId, actor) {
      if (!hasAdministrator(actor)) return denied();
      const rows = repo.resellers(guildId);
      if (!rows.length) return notice("Nenhum revendedor neste servidor.", config.panelColor);
      const lines = rows.map((item) => {
        const count = repo.resellerVms(item.id).length;
        return `**${item.name}** · ${count} VM${count === 1 ? "" : "s"} · ${item.revoked ? "revogado" : "ativo"}`;
      });
      return notice(lines.join("\n"), config.panelColor);
    },
    async revoke(guildId, actor, resellerId) {
      if (!hasAdministrator(actor)) return denied();
      const reseller = repo.reseller(resellerId);
      if (!reseller || reseller.guildId !== guildId) return notice("Revendedor não encontrado.", config.panelColor);
      repo.revokeReseller(reseller.id, now());
      await note(guildId, actor.id, "revendedor_revogar", `Revendedor ${reseller.name} revogado.`);
      return notice(`Chave de ${reseller.name} revogada.`, config.panelColor);
    },
    async rotate(guildId, actor, resellerId) {
      if (!hasAdministrator(actor)) return { payload: denied() };
      const reseller = repo.reseller(resellerId);
      if (!reseller || reseller.guildId !== guildId) return { payload: notice("Revendedor não encontrado.", config.panelColor) };
      if (reseller.revoked) return { payload: notice("Esse revendedor está revogado.", config.panelColor) };
      const { token, hash } = generateResellerKey();
      repo.setResellerHash(reseller.id, hash, now());
      await note(guildId, actor.id, "revendedor_girar", `Chave de ${reseller.name} substituída.`);
      return {
        token,
        payload: notice(`Nova chave de ${reseller.name}.\nA anterior deixou de valer.\n\`${token}\``, config.panelColor),
      };
    },
    async assign(guildId, actor, resellerId, token) {
      if (!hasAdministrator(actor)) return denied();
      const reseller = repo.reseller(resellerId);
      if (!reseller || reseller.guildId !== guildId || reseller.revoked) return notice("Revendedor não encontrado.", config.panelColor);
      let vms = [];
      try { vms = await catalog(); } catch { return notice("Não foi possível listar as VMs.", config.panelColor); }
      const vm = vms.find((item) => vmOptionValue(item.id) === token);
      if (!vm) return notice("Essa VM não está na lista.", config.panelColor);
      if (resolveOwner(vm, repo.listClients(guildId))) return notice("Essa VM já pertence a um cliente.", config.panelColor);
      if (assignmentFor(vm, repo.resellerVmsByGuild(guildId))) return notice("Essa VM já está com um revendedor.", config.panelColor);
      const row = {
        id: randomUUID(),
        guildId,
        resellerId: reseller.id,
        infraId: normalizeVmId(vm.id),
        name: vm.name,
        size: vm.size || "",
        publicIp: vm.publicIp || "",
        powerState: vm.power || "desconhecida",
        now: now(),
      };
      try {
        repo.insertResellerVm(row);
      } catch {
        return notice("Essa VM já está com um revendedor.", config.panelColor);
      }
      if (infra?.tagReseller) await infra.tagReseller(vm.id, reseller.id).catch(() => {});
      await note(guildId, actor.id, "revendedor_atribuir", `VM ${vm.name} atribuída a ${reseller.name}.`);
      return notice(`${vm.name} agora é de ${reseller.name}.`, config.panelColor);
    },
    async unassign(guildId, actor, resellerId, vmId) {
      if (!hasAdministrator(actor)) return denied();
      const reseller = repo.reseller(resellerId);
      const vm = repo.resellerVm(vmId);
      if (!reseller || reseller.guildId !== guildId || !vm || vm.resellerId !== reseller.id) {
        return notice("VM não encontrada para esse revendedor.", config.panelColor);
      }
      repo.deleteResellerVm(vm.id, reseller.id);
      if (infra?.tagReseller) await infra.tagReseller(vm.infraId, "").catch(() => {});
      await note(guildId, actor.id, "revendedor_remover", `VM ${vm.name} removida de ${reseller.name}.`);
      return notice(`${vm.name} voltou a ficar sem revendedor.`, config.panelColor);
    },
    authenticate(token) {
      const hash = hashResellerKey(token).toString("hex");
      const row = repo.resellerByHash(hash);
      const match = resellerKeysMatch(row?.keyHash || "0".repeat(64), token);
      if (!row || !match || row.revoked) return null;
      return row;
    },
    allow(token) {
      const key = token ? hashResellerKey(token).toString("hex") : "anon";
      return limiter.allow(key);
    },
    async handle(reseller, method, pathname, body) {
      const one = /^\/api\/reseller\/v1\/vms\/([0-9a-f-]{36})$/.exec(pathname);
      const action = /^\/api\/reseller\/v1\/vms\/([0-9a-f-]{36})\/(start|stop|restart|password)$/.exec(pathname);
      if (method === "GET" && pathname === "/api/reseller/v1/vms") {
        return { status: 200, body: { vms: repo.resellerVms(reseller.id).map(publicVm) } };
      }
      if (method === "GET" && one) {
        const vm = owned(reseller, one[1]);
        if (!vm) return missing();
        return { status: 200, body: publicVm(vm) };
      }
      if (method === "POST" && action) {
        const vm = owned(reseller, action[1]);
        if (!vm) return missing();
        if (action[2] === "password") return queuePassword(vm, body);
        return queuePower(vm, action[2]);
      }
      return missing();
    },
  };

  function queuePower(vm, action) {
    if (vm.operation || locks.has(vm.id)) return { status: 409, body: { error: "ação em andamento" } };
    locks.add(vm.id);
    repo.patchResellerVm(vm.id, { operation: action }, now());
    const owner = repo.reseller(vm.resellerId);
    const job = runPower(owner, vm, action).finally(() => locks.delete(vm.id));
    return { status: 202, body: publicVm({ ...vm, operation: action }), job };
  }

  async function queuePassword(vm, body) {
    if (!infra?.resetWindowsPassword) return { status: 503, body: { error: "não disponível" } };
    let account = "";
    if (infra.adminUsername) {
      try { account = String(await infra.adminUsername(vm.infraId) || ""); } catch { account = ""; }
    }
    const check = validatePassword(body?.password, body?.confirm, account);
    if (!check.ok) return { status: 400, body: { error: check.error } };
    if (vm.operation || locks.has(vm.id)) return { status: 409, body: { error: "ação em andamento" } };
    locks.add(vm.id);
    repo.patchResellerVm(vm.id, { operation: "password" }, now());
    const owner = repo.reseller(vm.resellerId);
    const job = runPassword(owner, vm, String(body.password)).finally(() => locks.delete(vm.id));
    return { status: 202, body: publicVm({ ...vm, operation: "password" }), job };
  }
}
