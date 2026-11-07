import { loadConfig } from "./src/config.js";
import { startBot } from "./src/bot.js";
import { openDatabase } from "./src/storage.js";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Configuração inválida.");
  process.exit(1);
}

const store = openDatabase(config.dataDir);
const client = await startBot({ config, store });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  client.destroy();
  store.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  shutdown().catch(() => process.exit(1));
});
process.once("SIGTERM", () => {
  shutdown().catch(() => process.exit(1));
});
