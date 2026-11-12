import { randomUUID } from "node:crypto";
import { formatModal, renderFormatConfirm } from "../panels/admin.js";
import { renderControl, renderMissing, renderPlan, renderSecret } from "../panels/control.js";
import { notice } from "../panels/ui.js";
import { phraseMatches } from "./fields.js";
import { providerError, providerNotice } from "./provider.js";

function viewOf(client, context, noticeText) {
  return renderControl(client, { ...context, notice: noticeText });
}

export function createClients({ config, repo, infra, audit, sealer, emojis, now }) {
  function theme(guildId) {
    return {
      accent: config.panelColor,
      emojis: emojis.pack(guildId),
      bannerUrl: config.bannerUrl,
      now: now(),
    };
  }

  async function remember(client, result) {
    if (result.status === "ligada" || result.status === "desligada") repo.updatePower(client.id, result.status, now());
    else repo.touchQuery(client.id, now());
    return repo.getById(client.guildId, client.id);
  }

  async function tracked(client, actorId, action, detail, secrets = []) {
    await audit.record({
      guildId: client.guildId,
      actorId,
      action,
      targetUserId: client.userId,
      machineName: client.machineName,
      detail,
      secrets,
    });
  }

  return {
    async open(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      const themeNow = theme(guildId);
      if (!client) return renderMissing(themeNow.accent);
      try {
        const result = await infra.readPower(client.infraId);
        const fresh = await remember(client, result);
        const note = result.mode === "manual" ? providerNotice(result, "read") : "";
        return viewOf(fresh, themeNow, note);
      } catch (error) {
        repo.touchQuery(client.id, now());
        return viewOf(repo.getById(guildId, client.id), themeNow, providerError(error));
      }
    },
    plan(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      return renderPlan(client, { accent: config.panelColor, now: now() });
    },
    async refresh(guildId, userId) {
      return this.open(guildId, userId);
    },
    async togglePower(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      const themeNow = theme(guildId);
      if (!client) return renderMissing(themeNow.accent);
      const desired = client.powerStatus === "ligada" ? "desligada" : "ligada";
      try {
        const result = await infra.setPower(client.infraId, desired);
        const fresh = result.mode === "azure" ? await remember(client, result) : (repo.touchQuery(client.id, now()), repo.getById(guildId, client.id));
        await tracked(client, userId, result.mode === "azure" ? "energia" : "energia_manual", `${providerNotice(result, "power")} Máquina ${client.machineName}.`);
        return viewOf(fresh, themeNow, providerNotice(result, "power"));
      } catch (error) {
        return viewOf(repo.getById(guildId, client.id), themeNow, providerError(error));
      }
    },
    async reveal(guildId, userId, kind) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      const cipher = kind === "pin" ? client.pinCipher : client.rdpPasswordCipher;
      if (!cipher) {
        return renderSecret(kind === "pin" ? "PIN Moonlight" : "Acesso RDP", ["Nada foi gravado para esta máquina."], config.panelColor);
      }
      if (!sealer) return notice("A chave de criptografia não está disponível. Nada foi exibido.", config.panelColor);
      let secret = "";
      try {
        secret = sealer.open(cipher);
      } catch {
        return notice("Não foi possível ler a credencial. Confira a chave de criptografia.", config.panelColor);
      }
      await tracked(client, userId, "credencial_exibida", kind === "pin" ? "PIN exibido ao dono." : "Acesso RDP exibido ao dono.", [secret]);
      if (kind === "pin") return renderSecret("PIN Moonlight", [`PIN: ${secret}`], config.panelColor);
      return renderSecret("Acesso RDP", [
        `IP: ${client.publicIp || "não informado"}`,
        `Usuário: ${client.rdpUser || "não informado"}`,
        `Senha: ${secret}`,
      ], config.panelColor);
    },
    async askFormat(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      const confirmation = {
        id: randomUUID(),
        guildId,
        userId,
        clientId: client.id,
        action: "format",
        expiresAt: now() + config.confirmationTtlMs,
      };
      repo.saveConfirmation(confirmation);
      return renderFormatConfirm(client, confirmation, config.panelColor, emojis.pack(guildId));
    },
    formatModal(guildId, userId, confirmationId) {
      const confirmation = repo.getConfirmation(confirmationId);
      if (!confirmation || confirmation.guildId !== guildId || confirmation.userId !== userId || confirmation.usedAt || confirmation.expiresAt <= now()) return null;
      return formatModal(confirmationId);
    },
    async cancelFormat(guildId, userId, confirmationId) {
      const confirmation = repo.getConfirmation(confirmationId);
      if (!confirmation || confirmation.userId !== userId || confirmation.guildId !== guildId) return notice("Esta confirmação não é sua.", config.panelColor);
      repo.consumeConfirmation(confirmationId, now());
      return notice("Formatação cancelada. Nada foi alterado.", config.panelColor);
    },
    async confirmFormat(guildId, userId, confirmationId, phrase) {
      const confirmation = repo.getConfirmation(confirmationId);
      if (!confirmation || confirmation.guildId !== guildId || confirmation.userId !== userId) return notice("Esta confirmação não é sua. Nada foi alterado.", config.panelColor);
      const client = repo.getById(guildId, confirmation.clientId);
      if (!client || client.userId !== userId) return notice("A máquina não é sua. Nada foi alterado.", config.panelColor);
      if (confirmation.usedAt || confirmation.expiresAt <= now()) {
        return notice("A confirmação expirou ou já foi usada. Nada foi alterado.", config.panelColor);
      }
      if (!phraseMatches(phrase, client.machineName)) return notice("A frase não confere com o nome da máquina nem com CONFIRMAR. Nada foi alterado.", config.panelColor);
      if (!repo.consumeConfirmation(confirmationId, now())) return notice("A confirmação expirou ou já foi usada. Nada foi alterado.", config.panelColor);
      try {
        const result = await infra.format(client.infraId);
        if (result.mode === "azure") repo.updatePower(client.id, "desligada", now());
        else repo.touchQuery(client.id, now());
        await tracked(client, userId, result.mode === "azure" ? "formatar" : "formatar_manual", providerNotice(result, "format"));
        return viewOf(repo.getById(guildId, client.id), theme(guildId), providerNotice(result, "format"));
      } catch (error) {
        return viewOf(repo.getById(guildId, client.id), theme(guildId), providerError(error));
      }
    },
  };
}
