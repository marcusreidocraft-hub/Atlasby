const DEFAULT_ACCENT = 0x5865f2;
const DEFAULT_LOCATION = "brazilsouth";
const DEFAULT_VM_SIZE = "Standard_NC4as_T4_v3";
const DEFAULT_OS = "Windows";
const DEFAULT_MAX_DISK = 2048;
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3:4b";

const SNOWFLAKE = /^\d{17,20}$/;
const SNAPSHOT = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/snapshots\/[^/]+$/i;
const LOCATION = /^[a-z][a-z0-9]{1,30}$/;
const VM_SIZE = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
const NETWORK_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const EMOJI_ENV = {
  controle: "EMOJI_CONTROLE",
  calendario: "EMOJI_CALENDARIO",
  ticket: "EMOJI_TICKET",
  moonlight: "EMOJI_MOONLIGHT",
  rdp: "EMOJI_RDP",
  alerta: "EMOJI_ALERTA",
  engrenagem: "EMOJI_ENGRENAGEM",
  power: "EMOJI_POWER",
  ligada: "EMOJI_LIGADA",
  desligar: "EMOJI_DESLIGAR",
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function snowflakes(value) {
  return text(value).split(",").map((item) => item.trim()).filter((item) => SNOWFLAKE.test(item));
}

function parseBoolean(value, fallback = false) {
  const clean = text(value).toLowerCase();
  if (["1", "true", "yes", "sim", "on"].includes(clean)) return true;
  if (["0", "false", "no", "nao", "não", "off"].includes(clean)) return false;
  return fallback;
}

export function parsePanelColor(value) {
  const clean = text(value).replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return DEFAULT_ACCENT;
  return Number.parseInt(clean, 16);
}

function parseMaxDisk(value) {
  const number = Number(text(value));
  if (!Number.isInteger(number) || number < 1 || number > 65536) return DEFAULT_MAX_DISK;
  return number;
}

function parsePort(value) {
  if (!text(value)) return null;
  const number = Number(text(value));
  if (!Number.isInteger(number) || number < 1 || number > 65535) return null;
  return number;
}

function parseAgentPort(value) {
  if (!text(value)) return 7474;
  const number = Number(text(value));
  if (!Number.isInteger(number) || number < 1 || number > 65535) return 7474;
  return number;
}

function parseTtl(value) {
  const number = Number(text(value));
  if (!Number.isInteger(number) || number < 15 || number > 300) return 60;
  return number;
}

function parseUrl(value) {
  const clean = text(value);
  if (!clean) return "";
  try {
    const url = new URL(clean);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function parseSnapshot(value) {
  const clean = text(value);
  return SNAPSHOT.test(clean) ? clean : "";
}

export function readConfig(env = {}) {
  const emoji = {};
  for (const [key, name] of Object.entries(EMOJI_ENV)) emoji[key] = text(env[name]);
  const location = text(env.AZURE_LOCATION).toLowerCase();
  const os = text(env.AZURE_OS_TYPE).toLowerCase();
  return {
    token: text(env.DISCORD_TOKEN),
    clientId: text(env.DISCORD_CLIENT_ID),
    allowedGuildIds: snowflakes(env.ALLOWED_GUILD_IDS),
    dataDir: text(env.DATA_DIR) || "data",
    agentSecret: text(env.AGENT_SECRET),
    agentPort: parseAgentPort(env.AGENT_PORT),
    serverPort: parsePort(env.SERVER_PORT),
    wyvi: {
      apiKey: text(env.WYVI_API_KEY),
      webhookSecret: text(env.WYVI_WEBHOOK_SECRET),
      baseUrl: text(env.WYVI_API_BASE) || "https://api.wyvipay.com.br",
    },
    confirmationTtlMs: parseTtl(env.CONFIRMATION_TTL_SECONDS) * 1000,
    messageContentIntent: parseBoolean(env.ENABLE_MESSAGE_CONTENT_INTENT, false),
    panelColor: parsePanelColor(env.PANEL_COLOR),
    bannerUrl: parseUrl(env.PANEL_BANNER_URL),
    supportUrl: parseUrl(env.SUPPORT_CHANNEL_URL),
    adminRoleIds: snowflakes(env.ADMIN_ROLE_IDS),
    adminLogChannelId: SNOWFLAKE.test(text(env.ADMIN_LOG_CHANNEL_ID)) ? text(env.ADMIN_LOG_CHANNEL_ID) : "",
    credentialsKey: text(env.CREDENTIALS_KEY) || text(env.AZURE_CREDENTIALS_KEY),
    emoji,
    azure: {
      tenantId: text(env.AZURE_TENANT_ID),
      clientId: text(env.AZURE_CLIENT_ID),
      clientSecret: text(env.AZURE_CLIENT_SECRET),
      subscriptionId: text(env.AZURE_SUBSCRIPTION_ID),
      snapshotId: parseSnapshot(env.AZURE_SNAPSHOT_ID),
      location: LOCATION.test(location) ? location : DEFAULT_LOCATION,
      vmSize: VM_SIZE.test(text(env.AZURE_DEFAULT_VM_SIZE)) ? text(env.AZURE_DEFAULT_VM_SIZE) : DEFAULT_VM_SIZE,
      osType: os === "linux" ? "Linux" : os === "windows" ? "Windows" : DEFAULT_OS,
      virtualNetwork: NETWORK_NAME.test(text(env.AZURE_VIRTUAL_NETWORK)) ? text(env.AZURE_VIRTUAL_NETWORK) : "",
      subnet: NETWORK_NAME.test(text(env.AZURE_SUBNET)) ? text(env.AZURE_SUBNET) : "",
      maxOsDiskGb: parseMaxDisk(env.AZURE_MAX_OS_DISK_GB),
      configured: Boolean(text(env.AZURE_TENANT_ID) && text(env.AZURE_CLIENT_ID) && text(env.AZURE_CLIENT_SECRET) && text(env.AZURE_SUBSCRIPTION_ID)),
    },
    assistant: {
      baseUrl: text(env.OLLAMA_BASE_URL) || DEFAULT_OLLAMA_URL,
      model: text(env.OLLAMA_MODEL) || DEFAULT_OLLAMA_MODEL,
      apiKey: text(env.OLLAMA_API_KEY),
      enabled: parseBoolean(env.AI_ASSISTANT_ENABLED, false),
    },
  };
}

export function loadConfig(env = process.env) {
  const config = readConfig(env);
  if (!config.token || !config.clientId) {
    throw new Error("Defina DISCORD_TOKEN e DISCORD_CLIENT_ID no ambiente do host.");
  }
  return config;
}
