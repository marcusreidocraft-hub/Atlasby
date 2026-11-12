import { randomUUID } from "node:crypto";
import { formatModal, renderFormatConfirm } from "../panels/admin.js";
import { cardFacts, renderControl, renderMissing, renderPinDone, renderPinModal, renderPinSoon, renderPinWait, renderPlan, renderSecret } from "../panels/control.js";
import { notice } from "../panels/ui.js";
import { logInteractionError } from "../components/reply.js";
import { phraseMatches } from "./fields.js";
import { providerError, providerNotice } from "./provider.js";
import { renderVmCardPng } from "./vm-card.js";

async function viewOf(client, context, noticeText) {
  let image = null;
  try {
    image = await renderVmCardPng(cardFacts(client, context.now));
  } catch (error) {
    logInteractionError(error);
  }
  return renderControl(client, { ...context, notice: noticeText, image });
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

export function createClients({ config, repo, infra, audit, sealer, emojis, now, agents = null }) {
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
        if (client.infraId && infra.readMachine) {
          const machine = await infra.readMachine(client.infraId);
          const fresh = machine ? applyMachine(client, machine) : client;
          repo.updateClient({ ...fresh, now: now() });
          if (fresh.powerStatus === "ligada" || fresh.powerStatus === "desligada") repo.updatePower(client.id, fresh.powerStatus, now());
          else repo.touchQuery(client.id, now());
          return viewOf(repo.getById(guildId, client.id), themeNow, "");
        }
        const result = await infra.readPower(client.infraId);
        const fresh = await remember(client, result);
        const note = result.mode === "manual" ? providerNotice(result, "read") : "";
        return viewOf(fresh, themeNow, note);
      } catch (error) {
        logInteractionError(error);
        repo.touchQuery(client.id, now());
        return viewOf(repo.getById(guildId, client.id), themeNow, providerError(error));
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
      if (kind === "pin") return this.pinStart(guildId, userId).payload ?? renderPinSoon(config.panelColor, themeNow.emojis);
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
      if (!agents?.hasToken(client.id)) {
        return { payload: renderPinSoon(config.panelColor, emojis.pack(guildId), "Agente não instalado nesta máquina. Peça a um administrador para gerar o token com /agente-token.") };
      }
      if (!config.serverPort) {
        return { payload: renderPinSoon(config.panelColor, emojis.pack(guildId), "A API do agente não está escutando neste processo. Confira SERVER_PORT no host.") };
      }
      return { modal: renderPinModal() };
    },
    async submitPin(guildId, userId, pin, notify) {
      const client = repo.getByOwner(guildId, userId);
      if (!client) return renderMissing(config.panelColor);
      if (!/^\d{4}$/.test(String(pin ?? ""))) return notice("O PIN mostrado pelo Moonlight tem 4 dígitos.", config.panelColor);
      if (!agents?.hasToken(client.id)) {
        return renderPinSoon(config.panelColor, emojis.pack(guildId), "Agente não instalado nesta máquina. Peça a um administrador para gerar o token com /agente-token.");
      }
      if (!config.serverPort) return renderPinSoon(config.panelColor, emojis.pack(guildId), "A API do agente não está escutando neste processo. Confira SERVER_PORT no host.");
      const job = agents.queuePin({ guildId, client, userId, pin: String(pin) });
      agents.watch(job.id, async (result) => {
        try {
          await notify(renderPinDone(config.panelColor, result.ok));
        } catch (error) {
          logInteractionError(error);
        }
      });
      await audit.record({
        guildId,
        actorId: userId,
        action: "moonlight_pedido",
        targetUserId: userId,
        machineName: client.machineName,
        detail: `PIN do Moonlight solicitado para ${client.machineName}.`,
        secrets: [String(pin)],
      });
      const offline = !agents.online(client.id);
      return renderPinWait(config.panelColor, offline);
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
