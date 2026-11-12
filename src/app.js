import { createAdmin } from "./services/admin.js";
import { createAudit } from "./services/audit.js";
import { createClients } from "./services/clients.js";
import { createSunshineAgent } from "./services/sunshine.js";
import { createSealer } from "./services/crypto.js";
import { createEmojiBook } from "./services/emojis.js";

export function createApp({ config, repo, infra, now = () => Date.now(), deliverLog = null, sunshine = null }) {
  const sealer = createSealer(config.credentialsKey);
  const audit = createAudit({ repo, config, now, deliverLog });
  const emojis = createEmojiBook(config, repo);
  const agent = sunshine ?? createSunshineAgent({ secret: config.agentSecret, port: config.agentPort });
  const clients = createClients({ config, repo, infra, audit, sealer, emojis, now, sunshine: agent });
  const admin = createAdmin({ config, repo, audit, sealer, emojis, now, infra });
  return { config, repo, infra, emojis, clients, admin, sealer };
}
