import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assessConfirmation } from "../src/confirmations.js";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { ACTOR, CHANNEL, GUILD, OTHER, OTHER_GUILD, TARGET, fakeDiscord } from "../src/fixtures.js";

function harness(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-confirm-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, CHANNEL, 1);
  let clock = 1_000_000;
  const discord = fakeDiscord(overrides.discord ?? {});
  const service = createService({
    store,
    discord,
    now: () => clock,
    ttlMs: 60_000,
  });
  return {
    store,
    discord,
    service,
    setTime(value) {
      clock = value;
    },
    close() {
      store.close();
    },
  };
}

test("confirmação expirada ou de outro moderador, servidor ou uso não pune", async () => {
  const app = harness();
  const pending = await app.service.requestKick({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "quebra de regra",
  });
  const row = app.store.getConfirmation(pending.confirmationId);
  assert.equal(assessConfirmation(row, { guildId: GUILD, moderatorId: OTHER, now: 1_000_000 }).code, "confirmation_wrong_user");
  assert.equal(assessConfirmation(row, { guildId: OTHER_GUILD, moderatorId: ACTOR, now: 1_000_000 }).code, "confirmation_guild");
  assert.equal(assessConfirmation(row, { guildId: GUILD, moderatorId: ACTOR, now: 1_060_000 }).code, "confirmation_expired");

  const wrongUser = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: OTHER,
    decision: "confirm",
  });
  assert.equal(wrongUser.code, "confirmation_wrong_user");
  assert.equal(wrongUser.punishmentApplied, false);
  assert.equal(app.store.getConfirmation(pending.confirmationId).status, "open");

  const wrongGuild = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: OTHER_GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(wrongGuild.code, "confirmation_guild");
  assert.equal(app.store.getConfirmation(pending.confirmationId).status, "open");

  app.setTime(1_060_000);
  const expired = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(expired.code, "confirmation_expired");
  assert.equal(expired.punishmentApplied, false);
  assert.equal(app.discord.calls.some((call) => call[0] === "kick"), false);
  assert.equal(app.store.getConfirmation(pending.confirmationId).status, "open");
  app.close();
});

test("confirmação válida expulsa só o alvo vinculado e não aceita segundo uso", async () => {
  const app = harness();
  const pending = await app.service.requestBan({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "  conta comprometida  ",
  });
  assert.equal(pending.code, "confirmation_required");
  assert.equal(app.discord.calls.length, 0);

  const confirmed = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.punishmentApplied, true);
  assert.deepEqual(app.discord.calls[0], ["ban", GUILD, TARGET, "conta comprometida"]);
  assert.equal(app.store.getConfirmation(pending.confirmationId).status, "completed");

  const repeated = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(repeated.code, "confirmation_used");
  assert.equal(repeated.punishmentApplied, false);
  assert.equal(app.discord.calls.filter((call) => call[0] === "ban").length, 1);
  app.close();
});

test("cancelamento não pune", async () => {
  const app = harness();
  const pending = await app.service.requestKick({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "teste",
  });
  const cancelled = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "cancel",
  });
  assert.equal(cancelled.code, "cancelled");
  assert.equal(cancelled.punishmentApplied, false);
  assert.equal(app.discord.calls.length, 0);
  assert.equal(app.store.getConfirmation(pending.confirmationId).status, "cancelled");
  app.close();
});
