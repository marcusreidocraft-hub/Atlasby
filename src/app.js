import { createAgentService } from "./services/agent.js";
import { createAdmin } from "./services/admin.js";
import { createAudit } from "./services/audit.js";
import { createClients } from "./services/clients.js";
import { createSealer } from "./services/crypto.js";
import { createEmojiBook } from "./services/emojis.js";

export function createApp({ config, repo, infra, now = () => Date.now(), deliverLog = null }) {
  const sealer = createSealer(config.credentialsKey);
  const audit = createAudit({ repo, config, now, deliverLog });
  const emojis = createEmojiBook(config, repo);
  const agents = createAgentService({ repo, audit, now });
  const clients = createClients({ config, repo, infra, audit, sealer, emojis, now, agents });
  const admin = createAdmin({ config, repo, audit, sealer, emojis, now, infra, agents });
  return { config, repo, infra, emojis, clients, admin, agents, sealer };
}
