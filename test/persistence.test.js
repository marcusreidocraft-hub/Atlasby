import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/storage.js";
import { ACTOR, GUILD, TARGET } from "../src/fixtures.js";

test("migração é idempotente e aviso permanece depois de reabrir o banco", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-"));
  const first = openDatabase(dir);
  const recorded = first.recordWarning({
    guildId: GUILD,
    targetId: TARGET,
    moderatorId: ACTOR,
    reason: "spam em ticket",
    now: 10,
  });
  first.updateAction(recorded.actionId, { status: "succeeded", now: 11, detail: { logDelivered: true } });
  assert.equal(first.migrationCount(), 6);
  first.close();

  const second = openDatabase(dir);
  assert.equal(second.migrationCount(), 6);
  const warnings = second.listWarnings(GUILD);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, "spam em ticket");
  assert.equal(warnings[0].id, recorded.warningId);
  assert.equal(second.getAction(recorded.actionId).status, "succeeded");
  second.close();
});

test("falha no meio da transação não deixa aviso gravado", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-rollback-"));
  const store = openDatabase(dir, { failAfterWarningInsert: true });
  assert.throws(() =>
    store.recordWarning({
      guildId: GUILD,
      targetId: TARGET,
      moderatorId: ACTOR,
      reason: "não deve persistir",
      now: 10,
    }),
  );
  assert.equal(store.listWarnings(GUILD).length, 0);
  assert.equal(store.listActions(GUILD).length, 0);
  store.close();
});

test("canal de logs configurado sobrevive ao reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-logs-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, "100000000000000008", 20);
  store.close();
  const reopened = openDatabase(dir);
  assert.equal(reopened.getLogChannel(GUILD), "100000000000000008");
  reopened.close();
});
