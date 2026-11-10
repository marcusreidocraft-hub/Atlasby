const SNOWFLAKE = /^\d{17,20}$/;
const SNAPSHOT_ID = /^\/subscriptions\/[0-9a-fA-F-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/snapshots\/[^/]+$/;
const AZURE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const LOCATION = /^[a-z][a-z0-9]{1,30}$/;
const VM_SIZE = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
const OLLAMA_MODEL = /^[\w.:-]{1,80}$/;

export const DEFAULT_PANEL_ACCENT = 0x5865f2;
export const DEFAULT_MAX_OS_DISK_GB = 2048;
export const DEFAULT_AZURE_LOCATION = "brazilsouth";
export const DEFAULT_AZURE_VM_SIZE = "Standard_NC4as_T4_v3";
export const DEFAULT_AZURE_OS = "Windows";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3:4b";

export function parsePanelColor(raw) {
  const text = String(raw ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(text)) return Number.parseInt(text, 16);
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return Number.parseInt(text.split("").map((char) => char + char).join(""), 16);
  }
  return DEFAULT_PANEL_ACCENT;
}

export function parseMaxOsDiskGb(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return DEFAULT_MAX_OS_DISK_GB;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 65536) return DEFAULT_MAX_OS_DISK_GB;
  return value;
}

export function parseBooleanFlag(raw, fallback = false) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "sim", "on"].includes(text)) return true;
  if (["0", "false", "no", "nao", "não", "off"].includes(text)) return false;
  return fallback;
}

function optionalName(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  return AZURE_NAME.test(text) ? text : "";
}

function parseHttpUrl(raw, fallback) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function readAzureEnv(env = {}) {
  const tenantId = String(env.AZURE_TENANT_ID ?? "").trim();
  const clientId = String(env.AZURE_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.AZURE_CLIENT_SECRET ?? "").trim();
  const subscriptionId = String(env.AZURE_SUBSCRIPTION_ID ?? "").trim();
  const credentialsKey = String(env.AZURE_CREDENTIALS_KEY ?? "").trim();
  const snapshotRaw = String(env.AZURE_SNAPSHOT_ID ?? "").trim();
  const locationRaw = String(env.AZURE_LOCATION ?? "").trim().toLowerCase();
  const sizeRaw = String(env.AZURE_DEFAULT_VM_SIZE ?? "").trim();
  const osRaw = String(env.AZURE_OS_TYPE ?? "").trim().toLowerCase();
  return {
    tenantId,
    clientId,
    clientSecret,
    subscriptionId,
    credentialsKey,
    configured: Boolean(tenantId && clientId && clientSecret && subscriptionId),
    snapshotId: SNAPSHOT_ID.test(snapshotRaw) ? snapshotRaw : "",
    location: LOCATION.test(locationRaw) ? locationRaw : DEFAULT_AZURE_LOCATION,
    vmSize: VM_SIZE.test(sizeRaw) ? sizeRaw : DEFAULT_AZURE_VM_SIZE,
    osType: osRaw === "linux" ? "Linux" : osRaw === "windows" ? "Windows" : DEFAULT_AZURE_OS,
    virtualNetwork: optionalName(env.AZURE_VIRTUAL_NETWORK),
    subnet: optionalName(env.AZURE_SUBNET),
    maxOsDiskGb: parseMaxOsDiskGb(env.AZURE_MAX_OS_DISK_GB),
  };
}

export function readAssistantEnv(env = {}) {
  const modelRaw = String(env.OLLAMA_MODEL ?? "").trim();
  return {
    enabled: parseBooleanFlag(env.AI_ASSISTANT_ENABLED, false),
    baseUrl: parseHttpUrl(env.OLLAMA_BASE_URL, DEFAULT_OLLAMA_URL),
    model: OLLAMA_MODEL.test(modelRaw) ? modelRaw : DEFAULT_OLLAMA_MODEL,
    apiKey: String(env.OLLAMA_API_KEY ?? "").trim().slice(0, 500),
  };
}

function parseGuilds(raw) {
  const parts = String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const ids = [];
  for (const part of parts) {
    if (!SNOWFLAKE.test(part)) throw new Error("ALLOWED_GUILD_IDS contém um ID inválido.");
    if (!ids.includes(part)) ids.push(part);
  }
  return ids;
}

export function loadConfig(env, options = {}) {
  const requireDiscord = options.requireDiscord !== false;
  const dataDir = (env.DATA_DIR ?? "").trim() || "data";
  if (dataDir.includes("\0")) throw new Error("DATA_DIR inválido.");

  let ttlSeconds = 60;
  const ttlRaw = (env.CONFIRMATION_TTL_SECONDS ?? "").trim();
  if (ttlRaw) {
    if (!/^\d+$/.test(ttlRaw)) throw new Error("CONFIRMATION_TTL_SECONDS inválido.");
    ttlSeconds = Number(ttlRaw);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 15 || ttlSeconds > 300) {
      throw new Error("CONFIRMATION_TTL_SECONDS deve ficar entre 15 e 300.");
    }
  }

  const config = {
    dataDir,
    confirmationTtlMs: ttlSeconds * 1000,
    token: (env.DISCORD_TOKEN ?? "").trim(),
    clientId: (env.DISCORD_CLIENT_ID ?? "").trim(),
    allowedGuildIds: parseGuilds(env.ALLOWED_GUILD_IDS),
    messageContentIntent: (env.ENABLE_MESSAGE_CONTENT_INTENT ?? "").trim() === "1",
    panelColor: parsePanelColor(env.PANEL_COLOR),
    azure: readAzureEnv(env),
    assistant: readAssistantEnv(env),
  };

  if (requireDiscord) {
    if (!config.token) throw new Error("DISCORD_TOKEN ausente.");
    if (!SNOWFLAKE.test(config.clientId)) throw new Error("DISCORD_CLIENT_ID inválido.");
    if (config.allowedGuildIds.length === 0) throw new Error("ALLOWED_GUILD_IDS ausente.");
  }

  return config;
}

export function isGuildAuthorized(config, guildId) {
  return config.allowedGuildIds.includes(guildId);
}
