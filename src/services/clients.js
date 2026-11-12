import { randomUUID } from "node:crypto";
import { formatModal, renderFormatConfirm } from "../panels/admin.js";
import { cardFacts, renderControl, renderMissing, renderPinModal, renderPinResult, renderPlan, renderSecret, renderUnpairConfirm } from "../panels/control.js";
import { publicIpv4 } from "./sunshine.js";
import { notice } from "../panels/ui.js";
import { logInteractionError } from "../components/reply.js";
import { phraseMatches } from "./fields.js";
import { providerError, providerNotice } from "./provider.js";
import { resolveGalleryImage } from "../loja/image.js";
import { renderVmCardPng } from "./vm-card.js";

async function viewOf(client, context, noticeText, agentLabel = "") {
  let image = null;
  try {
    image = await renderVmCardPng(cardFacts(client, context.now));
  } catch (error) {
    logInteractionError(error);
  }
  return renderControl(client, { ...context, notice: noticeText, image, agentLabel });
}

function applyMachine(client, machine) {
  return {
    ...client,
    gpu: machine.gpu && machine.gpu !== "não informado" ? machine.gpu : client.gpu,
    vcpus: machine.vcpus || client.vcpus,
    ram: machine.ram && machine.ram !== "não informado" ? machine.ram : client.ram,
    publicIp: machine.publicIp || client.publicIp,
    powerStatus: machine.power === "ligada" || machine.power === "desligada" ? machine.power : client.powerStatus,
  };
}

export function createClients({ config, repo, infra, audit, sealer, emojis, now, sunshine = null }) {
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

  async function agentLabelOf(client) {
    if (!sunshine?.configured || !publicIpv4(client.publicIp)) return "";
    const health = await sunshine.health(client.publicIp);
    return health.ok ? "Agente online" : "Agente offline";
  }

  function secretNotice() {
    return notice("O agente não está configurado. Defina AGENT_SECRET no host.", config.panelColor);
  }

  function stoppedNotice() {
    return renderPinResult(config.panelColor, "A VM está desligada. Ligue a máquina primeiro.");
  }

  function agentMessage(result, success) {
    if (result?.error === "unconfigured") return "O agente não está configurado. Defina AGENT_SECRET no host.";
    if (result?.error === "noip") return "Esta máquina não tem IP público. Nada foi enviado.";
    if (result?.error === "timeout" || result?.error === "offline") return "Agente da VM não respondeu, tente de novo em instantes";
    if (!result?.ok) return "O Sunshine não concluiu o pedido. Tente de novo em instantes.";
    return success;
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
        if (client.infraId && infra.readMachine) {
          const machine = await infra.readMachine(client.infraId);
          const fresh = machine ? applyMachine(client, machine) : client;
          repo.updateClient({ ...fresh, now: now() });
          if (fresh.powerStatus === "ligada" || fresh.powerStatus === "desligada") repo.updatePower(client.id, fresh.powerStatus, now());
          else repo.touchQuery(client.id, now());
          const saved = repo.getById(guildId, client.id);
          return viewOf(saved, themeNow, "", await agentLabelOf(saved));
        }
        const result = await infra.readPower(client.infraId);
        const fresh = await remember(client, result);
        const note = result.mode === "manual" ? providerNotice(result, "read") : "";
        return viewOf(fresh, themeNow, note, await agentLabelOf(fresh));
      } catch (error) {
        logInteractionError(error);
        repo.touchQuery(client.id, now());
        const saved = repo.getById(guildId, client.id);
        return viewOf(saved, themeNow, providerError(error), await agentLabelOf(saved));
      }
    },
    plan(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      return renderPlan(client, { accent: config.panelColor, now: now(), emojis: emojis.pack(guildId) });
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
        logInteractionError(error);
        return viewOf(repo.getById(guildId, client.id), themeNow, providerError(error));
      }
    },
    async reveal(guildId, userId, kind) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      const themeNow = theme(guildId);
      if (kind === "pin") return this.pinStart(guildId, userId).payload ?? secretNotice();
      const cipher = client.rdpPasswordCipher;
      const badge = themeNow.emojis.rdp;
      if (!cipher) {
        return renderSecret("Acesso RDP", ["Nada foi gravado para esta máquina."], config.panelColor, badge);
      }
      if (!sealer) return notice("A chave de criptografia não está disponível. Nada foi exibido.", config.panelColor);
      let secret = "";
      try {
        secret = sealer.open(cipher);
      } catch {
        return notice("Não foi possível ler a credencial. Confira a chave de criptografia.", config.panelColor);
      }
      await tracked(client, userId, "credencial_exibida", "Acesso RDP exibido ao dono.", [secret]);
      return renderSecret("Acesso RDP", [
        `IP: ${client.publicIp || "não informado"}`,
        `Usuário: ${client.rdpUser || "não informado"}`,
        `Senha: ${secret}`,
      ], config.panelColor, badge);
    },
    pinStart(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return { payload: renderMissing(config.panelColor) };
      if (!sunshine?.configured) return { payload: secretNotice() };
      if (client.powerStatus === "desligada") return { payload: stoppedNotice() };
      if (!publicIpv4(client.publicIp)) return { payload: renderPinResult(config.panelColor, "Esta máquina não tem IP público. Nada foi enviado.") };
      return { modal: renderPinModal() };
    },
    async submitPin(guildId, userId, pin) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      if (!sunshine?.configured) return secretNotice();
      if (!/^\d{4}$/.test(String(pin ?? ""))) return renderPinResult(config.panelColor, "O PIN mostrado pelo Moonlight tem 4 dígitos.");
      if (client.powerStatus === "desligada") return stoppedNotice();
      const ip = publicIpv4(client.publicIp);
      if (!ip) return renderPinResult(config.panelColor, "Esta máquina não tem IP público. Nada foi enviado.");
      const result = await sunshine.releasePin(ip, String(pin));
      const message = agentMessage(result, "Moonlight autorizado com acesso completo.");
      await tracked(client, userId, result.ok ? "moonlight_ok" : "moonlight_falha", message, [String(pin)]);
      return renderPinResult(config.panelColor, message);
    },
    async askUnpair(guildId, userId) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      if (!sunshine?.configured) return secretNotice();
      const confirmation = {
        id: randomUUID(),
        guildId,
        userId,
        clientId: client.id,
        action: "unpair",
        expiresAt: now() + config.confirmationTtlMs,
      };
      repo.saveConfirmation(confirmation);
      return renderUnpairConfirm(client, confirmation, config.panelColor);
    },
    async cancelUnpair(guildId, userId, confirmationId) {
      const confirmation = repo.getConfirmation(confirmationId);
      if (!confirmation || confirmation.userId !== userId || confirmation.guildId !== guildId || confirmation.action !== "unpair") {
        return notice("Esta confirmação não é sua.", config.panelColor);
      }
      repo.consumeConfirmation(confirmationId, now());
      return notice("Despareamento cancelado. Nada foi alterado.", config.panelColor);
    },
    async confirmUnpair(guildId, userId, confirmationId) {
      const confirmation = repo.getConfirmation(confirmationId);
      if (!confirmation || confirmation.guildId !== guildId || confirmation.userId !== userId || confirmation.action !== "unpair") {
        return notice("Esta confirmação não é sua. Nada foi alterado.", config.panelColor);
      }
      const client = repo.getById(guildId, confirmation.clientId);
      if (!client || client.userId !== userId) return notice("A máquina não é sua. Nada foi alterado.", config.panelColor);
      if (confirmation.usedAt || confirmation.expiresAt <= now()) return notice("A confirmação expirou ou já foi usada. Nada foi alterado.", config.panelColor);
      if (!repo.consumeConfirmation(confirmationId, now())) return notice("A confirmação expirou ou já foi usada. Nada foi alterado.", config.panelColor);
      if (!sunshine?.configured) return secretNotice();
      if (client.powerStatus === "desligada") return stoppedNotice();
      const ip = publicIpv4(client.publicIp);
      if (!ip) return renderPinResult(config.panelColor, "Esta máquina não tem IP público. Nada foi enviado.");
      const result = await sunshine.unpairAll(ip);
      const message = agentMessage(result, "Os dispositivos pareados foram removidos.");
      await tracked(client, userId, result.ok ? "moonlight_unpair" : "moonlight_unpair_falha", message);
      return renderPinResult(config.panelColor, message);
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
      if (!confirmation || confirmation.action !== "format" || confirmation.guildId !== guildId || confirmation.userId !== userId || confirmation.usedAt || confirmation.expiresAt <= now()) return null;
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
        const stored = repo.storeSettings?.(guildId);
        const image = resolveGalleryImage({
          storedId: stored?.imageKind === "snapshot" ? stored.imageId : stored?.imageId,
          storedKind: stored?.imageKind,
          envId: config.azure.imageId,
        });
        const result = await infra.format(client.infraId, image);
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
