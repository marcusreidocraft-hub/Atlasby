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

export const DEFAULTS = Object.freeze({
  controle: "<:8688gaming:1568512664705961985>",
  calendario: "<:timer:1568512986484711425>",
  ticket: "<:49457ticket:1568512619722309644>",
  moonlight: "<:moonzinho:1568512334245138452>",
  rdp: "<:rdp:1568512345825878049>",
  alerta: "<:5577warning:1568512629847101531>",
  engrenagem: "<:dgear:1568512697002098728>",
  power: "<:disactiv:1568512700739362897>",
});

export const EXTRAS = Object.freeze({
  monitor: "<:monitor:1568512326804574281>",
  windows: "<:windows:1568627841954873366>",
  world: "<:world:1545311030396321854>",
  externallink: "<:externallink:1568512703763324971>",
  mail: "<:mail:1568512319489708042>",
  pencil: "<:pencil:1568512341904064563>",
  tools: "<:tools:1568512989924171796>",
  star: "<:star:1568512980033863820>",
  cash: "<:cash:1568512689754349651>",
  bell: "<:bell:1568512976737013790>",
  megaphone: "<:megaphone:1568512322450882665>",
  admin: "<:8011admin:1568512661334003762>",
  member: "<:47106member:1568512616584843324>",
  add: "<:1906add:1568512602873794594>",
  verified: "<:53136verified:1568512623639797863>",
  arrow: "<:12560blackarrow:1568512590789869609>",
  link: "<:7957link:1568512657458470964>",
  vip: "<:44216vip:1568512612625424487>",
  gavel: "<:gavel:1568512706519109734>",
});

const CUSTOM = /^<(a)?:([A-Za-z0-9_]+):(\d+)>$/;

export function customEmojiId(token) {
  return CUSTOM.exec(String(token ?? ""))?.[3] ?? null;
}

export function collectEmojiIds(emojis) {
  const ids = new Set();
  const list = emojis?.values ? [...emojis.values()] : [...(emojis ?? [])];
  for (const emoji of list) if (emoji?.id) ids.add(String(emoji.id));
  return ids;
}

function usable(token, availableIds) {
  if (!token) return "";
  const id = customEmojiId(token);
  if (!id) return token;
  return availableIds?.has(id) ? token : "";
}

export function resolveToken(key, { stored = {}, env = {}, availableIds } = {}) {
  for (const candidate of [stored[key], env[key], DEFAULTS[key]]) {
    const token = usable(candidate, availableIds);
    if (token) return token;
  }
  return UNICODE[key];
}

export function resolveExtra(key, availableIds) {
  return usable(EXTRAS[key], availableIds);
}

export function buttonEmoji(token) {
  const custom = CUSTOM.exec(String(token ?? ""));
  if (!custom) return token || UNICODE.controle;
  return { animated: Boolean(custom[1]), name: custom[2], id: custom[3] };
}

export function createEmojiBook(config, repo) {
  const availableIds = new Set();
  return {
    pack(guildId) {
      const stored = repo.getSettings(guildId).emoji ?? {};
      const tokens = {};
      for (const key of EMOJI_KEYS) tokens[key] = resolveToken(key, { stored, env: config.emoji, availableIds });
      for (const key of Object.keys(EXTRAS)) tokens[key] = resolveExtra(key, availableIds);
      return tokens;
    },
    remember(_guildId, emojis) {
      for (const id of collectEmojiIds(emojis)) availableIds.add(id);
    },
    async refresh(client) {
      this.remember(null, client?.emojis?.cache);
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
