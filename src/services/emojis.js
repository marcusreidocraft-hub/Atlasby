export const EMOJI_KEYS = Object.freeze(["controle", "calendario", "ticket", "moonlight", "rdp", "alerta", "engrenagem", "power"]);

export const UNICODE = Object.freeze({
  controle: "🎮",
  calendario: "🗓️",
  ticket: "🎟️",
  moonlight: "🌙",
  rdp: "🖥️",
  alerta: "⚠️",
  engrenagem: "⚙️",
  power: "⏻",
});

export function emojiFromGuild(emojis) {
  const found = {};
  const list = emojis?.values ? [...emojis.values()] : [...(emojis ?? [])];
  for (const emoji of list) {
    const name = String(emoji.name ?? "").toLowerCase();
    if (!EMOJI_KEYS.includes(name) || !emoji.id) continue;
    found[name] = emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
  }
  return found;
}

export function resolveToken(key, { stored = {}, env = {}, fetched = {} } = {}) {
  return stored[key] || env[key] || fetched[key] || UNICODE[key];
}

export function buttonEmoji(token) {
  const custom = /^<(a)?:([A-Za-z0-9_]+):(\d+)>$/.exec(String(token ?? ""));
  if (!custom) return token || UNICODE.controle;
  return { animated: Boolean(custom[1]), name: custom[2], id: custom[3] };
}

export function createEmojiBook(config, repo) {
  const fetched = new Map();
  return {
    pack(guildId) {
      const stored = repo.getSettings(guildId).emoji ?? {};
      const guild = fetched.get(guildId) ?? {};
      const tokens = {};
      for (const key of EMOJI_KEYS) tokens[key] = resolveToken(key, { stored, env: config.emoji, fetched: guild });
      return tokens;
    },
    remember(guildId, emojis) {
      fetched.set(guildId, emojiFromGuild(emojis));
    },
    async refresh(client) {
      for (const guildId of config.allowedGuildIds) {
        try {
          const guild = await client.guilds.fetch(guildId);
          const emojis = await guild.emojis.fetch();
          this.remember(guildId, emojis);
        } catch (error) {
          const message = error instanceof Error ? error.message : "erro";
          console.error(`Não foi possível ler os emojis do servidor ${guildId}: ${message}`);
        }
      }
    },
  };
}
