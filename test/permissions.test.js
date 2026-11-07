import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits } from "discord.js";
import {
  BOT_INVITE_PERMISSIONS,
  Permissions,
  evaluateLogConfig,
  evaluateModeration,
} from "../src/permissions.js";
import { ACTOR, BOT, OWNER, TARGET } from "../src/fixtures.js";

const base = {
  action: "kick",
  actorId: ACTOR,
  targetId: TARGET,
  botId: BOT,
  actorPermissions: Permissions.KickMembers,
  targetPermissions: 0n,
  botPermissions: Permissions.KickMembers,
  actorHighestPosition: 10,
  targetHighestPosition: 2,
  botHighestPosition: 20,
  actorIsOwner: false,
  targetIsOwner: false,
  botIsOwner: false,
};

test("convite do bot não inclui Administrador", () => {
  assert.equal(BOT_INVITE_PERMISSIONS & Permissions.Administrator, 0n);
  assert.equal(BOT_INVITE_PERMISSIONS, 1099511647238n);
  assert.equal(Permissions.Administrator, PermissionFlagsBits.Administrator);
  assert.equal(Permissions.KickMembers, PermissionFlagsBits.KickMembers);
  assert.equal(Permissions.BanMembers, PermissionFlagsBits.BanMembers);
  assert.equal(Permissions.ModerateMembers, PermissionFlagsBits.ModerateMembers);
  assert.equal(Permissions.ManageGuild, PermissionFlagsBits.ManageGuild);
});

test("hierarquia e permissões do moderador e do bot", () => {
  assert.equal(evaluateModeration(base).ok, true);
  assert.equal(evaluateModeration({ ...base, actorHighestPosition: 2 }).code, "actor_hierarchy");
  assert.equal(evaluateModeration({ ...base, botHighestPosition: 2 }).code, "bot_hierarchy");
  assert.equal(evaluateModeration({ ...base, actorPermissions: 0n }).code, "actor_permission");
  assert.equal(evaluateModeration({ ...base, botPermissions: 0n }).code, "bot_permission");
  assert.equal(evaluateModeration({ ...base, targetHighestPosition: -1 }).code, "hierarchy_unknown");
});

test("dono ultrapassa a própria hierarquia, mas não a do bot", () => {
  const owner = { ...base, actorId: OWNER, actorIsOwner: true, actorHighestPosition: 0, actorPermissions: 0n };
  assert.equal(evaluateModeration(owner).ok, true);
  assert.equal(evaluateModeration({ ...owner, botHighestPosition: 1 }).code, "bot_hierarchy");
});

test("protege dono, autor, bot e administrador", () => {
  assert.equal(evaluateModeration({ ...base, targetIsOwner: true }).code, "owner_protected");
  assert.equal(evaluateModeration({ ...base, actorId: TARGET, targetId: TARGET }).code, "self_protected");
  assert.equal(evaluateModeration({ ...base, targetId: BOT, botId: BOT }).code, "bot_protected");
  assert.equal(
    evaluateModeration({ ...base, targetPermissions: Permissions.Administrator, actorIsOwner: true, actorId: OWNER }).code,
    "privileged_protected",
  );
});

test("Administrador do moderador não fura a hierarquia nem substitui a permissão do bot", () => {
  assert.equal(
    evaluateModeration({ ...base, actorPermissions: Permissions.Administrator, actorHighestPosition: 1 }).code,
    "actor_hierarchy",
  );
  assert.equal(
    evaluateModeration({ ...base, botPermissions: Permissions.Administrator, botHighestPosition: 1 }).code,
    "bot_hierarchy",
  );
  assert.equal(evaluateModeration({ ...base, botPermissions: Permissions.Administrator }).ok, true);
});

test("aviso exige ModerateMembers e canal de logs exige ManageGuild", () => {
  assert.equal(evaluateModeration({ ...base, action: "warn", actorPermissions: Permissions.ModerateMembers, botPermissions: Permissions.ModerateMembers }).ok, true);
  assert.equal(evaluateModeration({ ...base, action: "warn", actorPermissions: Permissions.KickMembers, botPermissions: Permissions.ModerateMembers }).code, "actor_permission");
  assert.equal(evaluateLogConfig({ actorPermissions: Permissions.ManageGuild }).ok, true);
  assert.equal(evaluateLogConfig({ actorPermissions: Permissions.Administrator }).ok, true);
  assert.equal(evaluateLogConfig({ actorPermissions: Permissions.KickMembers }).code, "actor_permission");
});
