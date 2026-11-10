import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { confirmationRow, handleInteraction } from "../src/bot.js";
import { commands } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { describeResult } from "../src/messages.js";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, CHANNEL, GUILD, TARGET, commandInteraction, fakeDiscord } from "../src/fixtures.js";

test("comandos são só de servidor e não pedem Administrador", () => {
  const built = commands.map((command) => command.toJSON());
  assert.deepEqual(
    built.map((command) => command.name),
    ["aviso", "silenciar", "expulsar", "banir", "canal-logs", "catalogo", "configurar", "formularios", "candidatura", "menu", "maquinas"],
  );
  for (const command of built) {
    assert.equal(command.dm_permission, false);
    assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
    assert.deepEqual(command.integration_types, [ApplicationIntegrationType.GuildInstall]);
    if (command.default_member_permissions != null) {
      assert.equal(BigInt(command.default_member_permissions) & PermissionFlagsBits.Administrator, 0n);
    }
  }
  const byName = Object.fromEntries(built.map((command) => [command.name, command]));
  assert.equal(BigInt(byName.aviso.default_member_permissions), PermissionFlagsBits.ModerateMembers);
  assert.equal(BigInt(byName.expulsar.default_member_permissions), PermissionFlagsBits.KickMembers);
  assert.equal(BigInt(byName.banir.default_member_permissions), PermissionFlagsBits.BanMembers);
  assert.equal(byName["canal-logs"].default_member_permissions, undefined);
  assert.equal(byName.catalogo.default_member_permissions, undefined);
});

test("interação recusa DM e servidor fora da lista sem chamar moderação", async () => {
  let called = false;
  const service = new Proxy({}, { get: () => () => {
    called = true;
    throw new Error("não deveria executar");
  } });
  const config = { allowedGuildIds: [GUILD] };
  const dm = commandInteraction({ name: "aviso", options: { inGuild: false, user: { id: TARGET }, motivo: "x" } });
  await handleInteraction(dm, { config, service });
  assert.equal(textOf(dm.replies[0]), describeResult({ code: "guild_only" }));
  assert.equal(dm.replies[0].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
  assert.equal(validateV2Message(dm.replies[0]).ok, true);

  const foreign = commandInteraction({
    name: "aviso",
    guildId: "100000000000000099",
    options: { user: { id: TARGET }, motivo: "x" },
  });
  await handleInteraction(foreign, { config, service });
  assert.equal(textOf(foreign.replies[0]), describeResult({ code: "guild_unauthorized" }));
  assert.equal(called, false);
});

test("expulsão responde confirmação vinculada e ainda não aplicada", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-ui-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, CHANNEL, 1);
  const service = createService({
    store,
    discord: fakeDiscord(),
    now: () => 2_000,
    ttlMs: 60_000,
  });
  const interaction = commandInteraction({
    name: "expulsar",
    options: { user: { id: TARGET }, motivo: "motivo válido" },
  });
  await handleInteraction(interaction, { config: { allowedGuildIds: [GUILD] }, service });
  const reply = interaction.replies[0];
  assert.match(textOf(reply), /ainda não foi aplicado/);
  assert.equal(reply.content, undefined);
  assert.equal(validateV2Message(reply).ok, true);
  assert.match(JSON.stringify(reply.components[0].toJSON()), /atlasby:confirm:[0-9a-f-]{36}/);
  store.close();
});

test("botão de outro fluxo não declara sucesso quando a API falha", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-button-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, CHANNEL, 1);
  const discord = fakeDiscord({
    async kickMember() {
      throw new Error("falhou");
    },
  });
  const service = createService({ store, discord, now: () => 2_000, ttlMs: 60_000 });
  const pending = await service.requestKick({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "motivo válido",
  });
  const interaction = commandInteraction({
    name: "expulsar",
    options: { button: true, customId: confirmationRow(pending.confirmationId).components[0].data.custom_id },
  });
  await handleInteraction(interaction, { config: { allowedGuildIds: [GUILD] }, service });
  assert.equal(interaction.deferred, true);
  assert.equal(interaction.edits[0].content, undefined);
  assert.match(textOf(interaction.edits[0]), /não foi aplicado/);
  assert.doesNotMatch(JSON.stringify(interaction.edits[0].components), /atlasby:confirm:/);
  assert.equal(validateV2Message(interaction.edits[0]).ok, true);
  store.close();
});

test("configuração exige token e servidores; setup cria o banco sem credencial", () => {
  assert.throws(() => loadConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => loadConfig({ DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "1", ALLOWED_GUILD_IDS: GUILD }), /DISCORD_CLIENT_ID/);
  const config = loadConfig({
    DISCORD_TOKEN: "token-de-teste",
    DISCORD_CLIENT_ID: ACTOR,
    ALLOWED_GUILD_IDS: `${GUILD}, ${GUILD}`,
    CONFIRMATION_TTL_SECONDS: "90",
  });
  assert.deepEqual(config.allowedGuildIds, [GUILD]);
  assert.equal(config.confirmationTtlMs, 90_000);
  assert.throws(() => loadConfig({ ...process.env, CONFIRMATION_TTL_SECONDS: "10" }, { requireDiscord: false }), /15 e 300/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-setup-"));
  const setup = spawnSync(process.execPath, ["src/setup.js"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, DATA_DIR: dir },
  });
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /Migração aplicada/);
  const store = openDatabase(dir);
  assert.equal(store.migrationCount(), 8);
  store.close();

  const start = spawnSync(process.execPath, ["index.js"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(start.status, 1);
  assert.match(start.stderr, /DISCORD_TOKEN ausente/);
  assert.doesNotMatch(`${start.stdout}\n${start.stderr}`, /token-de-teste/);
});
