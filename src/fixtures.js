import { Permissions } from "../src/permissions.js";

export const GUILD = "100000000000000001";
export const ACTOR = "100000000000000002";
export const BOT = "100000000000000003";
export const TARGET = "100000000000000004";
export const OTHER = "100000000000000005";
export const OWNER = "100000000000000009";
export const CHANNEL = "100000000000000008";
export const OTHER_GUILD = "100000000000000007";

const MODERATION = Permissions.ModerateMembers | Permissions.KickMembers | Permissions.BanMembers;
const LOG_BITS = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks;

export function context(overrides = {}) {
  const base = {
    guildOwnerId: OWNER,
    actor: {
      id: ACTOR,
      permissions: MODERATION,
      highestPosition: 10,
      timedOutUntil: null,
    },
    bot: {
      id: BOT,
      permissions: MODERATION | LOG_BITS,
      highestPosition: 20,
      timedOutUntil: null,
    },
    target: {
      id: TARGET,
      permissions: 0n,
      highestPosition: 1,
      timedOutUntil: null,
    },
  };
  return {
    ...base,
    ...overrides,
    actor: { ...base.actor, ...overrides.actor },
    bot: { ...base.bot, ...overrides.bot },
    target: overrides.target === null ? null : { ...base.target, ...overrides.target },
  };
}

export function fakeDiscord(overrides = {}) {
  const calls = [];
  const discord = {
    calls,
    async getModerationContext() {
      return context();
    },
    async inspectChannel() {
      return { guildId: GUILD, type: "GuildText", permissions: LOG_BITS };
    },
    async inspectActor() {
      return { id: ACTOR, permissions: Permissions.ManageGuild };
    },
    async timeoutMember(...args) {
      calls.push(["timeout", ...args]);
    },
    async removeTimeout(...args) {
      calls.push(["removeTimeout", ...args]);
    },
    async kickMember(...args) {
      calls.push(["kick", ...args]);
    },
    async banMember(...args) {
      calls.push(["ban", ...args]);
    },
    async sendLog(...args) {
      calls.push(["log", ...args]);
    },
  };
  return Object.assign(discord, overrides);
}

export function commandInteraction({ name, guildId = GUILD, userId = ACTOR, options = {} }) {
  return {
    guildId,
    user: { id: userId },
    commandName: name,
    customId: options.customId,
    deferred: false,
    replied: false,
    replies: [],
    edits: [],
    inGuild() {
      return options.inGuild !== false;
    },
    isChatInputCommand() {
      return options.button !== true;
    },
    isButton() {
      return options.button === true;
    },
    options: {
      getUser: () => options.user ?? null,
      getString: (optionName) => options[optionName] ?? null,
      getSubcommand: () => options.subcommand,
      getChannel: () => options.channel ?? null,
    },
    async reply(payload) {
      this.replied = true;
      this.replies.push(payload);
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.edits.push(payload);
    },
    async followUp(payload) {
      this.replies.push(payload);
    },
  };
}
