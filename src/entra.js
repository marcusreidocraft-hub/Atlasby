import { canPostLogs } from "./permissions.js";
import { azureFailureCode } from "./azure.js";
import { generatePassword, methodKind, passwordIsStrong } from "./entra-model.js";
import { importKey } from "./vm-model.js";
import {
  renderEntraAccount,
  renderEntraList,
  renderEntraSearchModal,
  renderEntraVmPicker,
  renderLinkConfirm,
  renderMethodConfirm,
  renderMethodsConfirm,
  renderMethods,
  renderPasswordConfirm,
  renderPasswordModal,
  renderPasswordOnce,
} from "./entra-ui.js";

function deny(action, fields) {
  return { ok: false, action, punishmentApplied: false, logDelivered: false, auditRecorded: false, ...fields };
}

function done(code, extra = {}) {
  return { ok: true, action: "entra", code, confirmed: true, punishmentApplied: false, logDelivered: false, auditRecorded: true, ...extra };
}

function methodHash(userId, methodId) {
  return importKey(userId, methodId).slice(0, 16);
}

function removable(methods) {
  return methods
    .map((method) => ({ ...method, kind: methodKind(method["@odata.type"]) }))
    .filter((method) => method.kind !== "password" && method.kind !== "unknown" && methodPathSafe(method.kind));
}

function methodPathSafe(kind) {
  return ["microsoftAuthenticator", "phone", "fido2", "softwareOath", "email", "windowsHelloForBusiness", "temporaryAccessPass"].includes(kind);
}

export function createEntraController({ store, discord, now, assertAdmin, graph }) {
  function fail(error) {
    const code = error?.code === "entra_forbidden" || error?.code === "azure_timeout" || error?.code === "azure_unconfigured" || error?.code === "entra_default_method"
      ? error.code
      : azureFailureCode(error);
    return deny("entra", { code: code === "azure_forbidden" ? "entra_forbidden" : code });
  }

  async function gate(guildId, actorId) {
    const auth = await assertAdmin(guildId, actorId);
    if (!auth.ok) return auth;
    if (!graph?.configured) return deny("entra", { code: "azure_unconfigured" });
    return { ok: true };
  }

  async function audit(guildId, actorId, action, account, secret) {
    try {
      const settings = store.getAzureSettings(guildId);
      if (!settings.log_channel_id || !discord?.sendComponents || !discord.inspectChannel) return;
      const info = await discord.inspectChannel(settings.log_channel_id);
      if (!info || info.guildId !== guildId || info.type !== "GuildText" || info.everyoneCanView !== false || !canPostLogs(info.permissions)) return;
      const content = `Entra: ${action}\nConta: ${account}\nAdmin: <@${actorId}>`;
      if (secret && content.includes(secret)) return;
      await discord.sendComponents(settings.log_channel_id, {
        components: [{ type: 17, components: [{ type: 10, content }] }],
        flags: 32768,
        allowedMentions: { parse: [] },
      });
    } catch {
      // O registro privado não pode desfazer a ação nem receber a senha.
    }
  }

  async function accountView(guildId, user) {
    const links = store.entraLinksForAccount(guildId, user.id);
    return { ok: true, update: true, view: renderEntraAccount(user, links) };
  }

  async function removeOne(userId, method) {
    try {
      await graph.deleteMethod(userId, method.kind, method.id);
      return { ok: true };
    } catch (error) {
      if (error?.code === "entra_default_method") return { ok: false, code: "entra_default_method", method };
      throw error;
    }
  }

  return {
    searchModal() {
      return renderEntraSearchModal();
    },
    passwordModal(userId) {
      return renderPasswordModal(userId);
    },
    async list(guildId, actorId, page = 0, search = "") {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const result = await graph.listUsers({ search, page });
        return { ok: true, update: true, view: renderEntraList({ users: result.users, page, search, more: result.next }) };
      } catch (error) {
        return fail(error);
      }
    },
    async open(guildId, actorId, userId) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        return accountView(guildId, user);
      } catch (error) {
        return fail(error);
      }
    },
    async passwordPrompt(guildId, actorId, userId, force) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        return { ok: true, update: true, view: renderPasswordConfirm(user) };
      } catch (error) {
        return fail(error);
      }
    },
    async applyGeneratedPassword(guildId, actorId, userId, force) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      const password = generatePassword();
      try {
        const user = await graph.getUser(userId);
        await graph.resetPassword(userId, { password, forceChangePasswordNextSignIn: force });
        await audit(guildId, actorId, "senha redefinida", user.userPrincipalName, password);
        return { ok: true, view: renderPasswordOnce(user, password, force) };
      } catch (error) {
        return fail(error);
      }
    },
    async applyTypedPassword(guildId, actorId, userId, password, forceText) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      if (!passwordIsStrong(password)) return deny("entra", { code: "entra_password_weak" });
      const force = ["sim", "1", "true"].includes(String(forceText ?? "").trim().toLowerCase());
      try {
        const user = await graph.getUser(userId);
        await graph.resetPassword(userId, { password, forceChangePasswordNextSignIn: force });
        await audit(guildId, actorId, "senha redefinida", user.userPrincipalName, password);
        return { ok: true, view: renderPasswordOnce(user, password, force) };
      } catch (error) {
        return fail(error);
      }
    },
    async methods(guildId, actorId, userId) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        const methods = await graph.listMethods(userId);
        return { ok: true, update: true, view: renderMethods(user, methods) };
      } catch (error) {
        return fail(error);
      }
    },
    async methodsConfirm(guildId, actorId, userId) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        return { ok: true, update: true, view: renderMethodsConfirm(user) };
      } catch (error) {
        return fail(error);
      }
    },
    async methodPrompt(guildId, actorId, userId, hash) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        const methods = removable(await graph.listMethods(userId));
        const method = methods.find((item) => methodHash(userId, item.id) === hash);
        if (!method) return deny("entra", { code: "entra_method_invalid" });
        return { ok: true, update: true, view: renderMethodConfirm(user, method) };
      } catch (error) {
        return fail(error);
      }
    },
    async deleteMethod(guildId, actorId, userId, hash) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        const methods = removable(await graph.listMethods(userId));
        const method = methods.find((item) => methodHash(userId, item.id) === hash);
        if (!method) return deny("entra", { code: "entra_method_invalid" });
        const removed = await removeOne(userId, method);
        if (!removed.ok) return deny("entra", { code: "entra_default_method" });
        await audit(guildId, actorId, `método removido ${method.kind}`, user.userPrincipalName);
        return done("entra_method_removed", { view: renderMethods(user, await graph.listMethods(userId)) });
      } catch (error) {
        return fail(error);
      }
    },
    async deleteAllMethods(guildId, actorId, userId, revoke) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      try {
        const user = await graph.getUser(userId);
        const ordered = removable(await graph.listMethods(userId)).sort((left, right) => Number(Boolean(left.isDefault)) - Number(Boolean(right.isDefault)));
        const deferred = [];
        for (const method of ordered) {
          const removed = await removeOne(userId, method);
          if (!removed.ok) deferred.push(method);
        }
        for (const method of deferred) {
          const removed = await removeOne(userId, method);
          if (!removed.ok) return deny("entra", { code: "entra_default_method" });
        }
        if (revoke) await graph.revokeSessions(userId);
        await audit(guildId, actorId, revoke ? "métodos removidos e sessões encerradas" : "métodos removidos", user.userPrincipalName);
        return done("entra_method_removed", { view: renderMethods(user, await graph.listMethods(userId)) });
      } catch (error) {
        return fail(error);
      }
    },
    async linkPicker(guildId, actorId, userId) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      const vms = store.listVms(guildId);
      if (!vms.length) return deny("entra", { code: "vm_none" });
      return { ok: true, update: true, view: renderEntraVmPicker(userId, vms) };
    },
    async linkPrompt(guildId, actorId, userId, vmId) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      const vm = store.getVm(guildId, vmId);
      if (!vm) return deny("entra", { code: "vm_missing" });
      try {
        const user = await graph.getUser(userId);
        return { ok: true, update: true, view: renderLinkConfirm(user, vm) };
      } catch (error) {
        return fail(error);
      }
    },
    async link(guildId, actorId, userId, vmId) {
      const auth = await gate(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "entra" };
      const vm = store.getVm(guildId, vmId);
      if (!vm) return deny("entra", { code: "vm_missing" });
      try {
        const user = await graph.getUser(userId);
        store.linkEntra({ guildId, vmId, entraId: user.id, userPrincipalName: user.userPrincipalName, now: now() });
        await audit(guildId, actorId, `vínculo com ${vm.display_name}`, user.userPrincipalName);
        return accountView(guildId, user);
      } catch (error) {
        return fail(error);
      }
    },
  };
}
