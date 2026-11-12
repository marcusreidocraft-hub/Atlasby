import { loadConfig } from "./src/config.js";
import { openDatabase } from "./src/db/database.js";
import { startBot } from "./src/bot.js";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Configuração inválida.");
  process.exit(1);
}

const repo = openDatabase(config.dataDir);
const client = await startBot({ config, repo });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  client.agentServer?.close();
  client.destroy();
  repo.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  shutdown().catch(() => process.exit(1));
});
process.once("SIGTERM", () => {
  shutdown().catch(() => process.exit(1));
});
