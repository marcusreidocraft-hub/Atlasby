import { readConfig } from "./config.js";
import { openDatabase } from "./db/database.js";

const config = readConfig(process.env);
const repo = openDatabase(config.dataDir);
repo.close();
console.log(`Banco pronto em ${config.dataDir}.`);
