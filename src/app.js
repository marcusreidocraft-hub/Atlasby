import { createAdmin } from "./services/admin.js";
import { createAudit } from "./services/audit.js";
import { createClients } from "./services/clients.js";
import { createSunshineAgent } from "./services/sunshine.js";
import { createStore } from "./loja/service.js";
import { createWyviClient } from "./loja/payments.js";
import { createAzureProvisioner } from "./loja/azure.js";
import { createSealer } from "./services/crypto.js";
import { createEmojiBook } from "./services/emojis.js";

export function createApp({ config, repo, infra, now = () => Date.now(), deliverLog = null, sunshine = null }) {
  const sealer = createSealer(config.credentialsKey);
  const audit = createAudit({ repo, config, now, deliverLog });
  const emojis = createEmojiBook(config, repo);
  const agent = sunshine ?? createSunshineAgent({ secret: config.agentSecret, port: config.agentPort });
  const clients = createClients({ config, repo, infra, audit, sealer, emojis, now, sunshine: agent });
  const admin = createAdmin({ config, repo, audit, sealer, emojis, now, infra });
  const provisioner = config.azure.configured ? createAzureProvisioner(config) : {
    async quota() { return { ok: false, error: "A Azure não está configurada." }; },
    async ip() { throw new Error("azure"); },
    async nic() { throw new Error("azure"); },
    async vm() { throw new Error("azure"); },
    async readIp() { return ""; },
  };
  const wyvi = createWyviClient({ apiKey: config.wyvi?.apiKey || "", baseUrl: config.wyvi?.baseUrl });
  const store = createStore({ repo, config, audit, now, wyvi, sunshine: agent, provisioner, infra });
  return { config, repo, infra, emojis, clients, admin, sealer, store };
}
