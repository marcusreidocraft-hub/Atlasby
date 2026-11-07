import { loadConfig } from "./config.js";
import { openDatabase } from "./storage.js";

let config;
try {
  config = loadConfig(process.env, { requireDiscord: false });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Configuração inválida.");
  process.exit(1);
}

const store = openDatabase(config.dataDir);
console.log(`Migração aplicada. Banco: ${store.path}`);
store.close();
