const SNOWFLAKE = /^\d{17,20}$/;

function readAzureEnv(env) {
  const tenantId = String(env.AZURE_TENANT_ID ?? "").trim();
  const clientId = String(env.AZURE_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.AZURE_CLIENT_SECRET ?? "").trim();
  const subscriptionId = String(env.AZURE_SUBSCRIPTION_ID ?? "").trim();
  const credentialsKey = String(env.AZURE_CREDENTIALS_KEY ?? "").trim();
  return {
    tenantId,
    clientId,
    clientSecret,
    subscriptionId,
    credentialsKey,
    configured: Boolean(tenantId && clientId && clientSecret && subscriptionId),
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
    azure: readAzureEnv(env),
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
