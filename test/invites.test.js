import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInviteBook } from "../src/invites/book.js";
import { STAY_MS, detectInviter, tierProgress } from "../src/invites/model.js";
import { renderInvitePanel } from "../src/invites/panel.js";
import { adminCommands } from "../src/commands/admin/commands.js";
import { openDatabase } from "../src/db/database.js";

const OTHER = ["n", "y", "x"].join("");

function book() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-invite-"));
  const repo = openDatabase(dir);
  return { repo, invites: createInviteBook({ repo, now: () => 5_000 }), dir };
}

test("o indicador sai da diferença de usos e a meta calcula o que falta", () => {
  const before = [{ code: "aaa", uses: 2, inviterId: "host" }, { code: "bbb", uses: 4, inviterId: "outro" }];
  const after = [{ code: "aaa", uses: 3, inviterId: "host" }, { code: "bbb", uses: 4, inviterId: "outro" }];
  assert.equal(detectInviter({ before, after, memberId: "novo" }).inviterId, "host");
  assert.equal(detectInviter({ before, after: before, memberId: "novo", featuredDelta: 1 }).kind, "featured");
  assert.equal(detectInviter({ before, after: before, memberId: "novo" }).kind, "unknown");
  assert.equal(detectInviter({ before: [], after: [{ code: "aaa", uses: 1, inviterId: "host", bot: true }], memberId: "novo" }).kind, "bot");
  assert.equal(detectInviter({ before: [], after: [{ code: "aaa", uses: 1, inviterId: "novo" }], memberId: "novo" }).kind, "self");
  assert.equal(detectInviter({
    before: [],
    after: [{ code: "aaa", uses: 1, inviterId: "host" }, { code: "bbb", uses: 1, inviterId: "outro" }],
    memberId: "novo",
  }).kind, "unknown");
  const progress = tierProgress(18);
  assert.equal(progress.next.invites, 20);
  assert.equal(progress.remaining, 2);
  assert.equal(progress.next.label, "12 horas de máquina");
  assert.equal(tierProgress(55).next, null);
  const command = adminCommands().find((item) => item.name === "convites");
  assert.deepEqual(command.options.map((item) => item.name), ["painel", "canal", "ver", "ajustar", "resetar", "ranking"]);
  const panel = JSON.stringify(renderInvitePanel([
    { invites: 10, label: "6 horas de máquina" },
    { invites: 20, label: "12 horas de máquina" },
    { invites: 30, label: "24 horas de máquina" },
    { invites: 40, label: "3 dias de máquina" },
    { invites: 55, label: "1 semana de máquina" },
  ]).components.map((item) => item.toJSON()));
  assert.match(panel, /Criar convite/);
  assert.match(panel, /6 horas de máquina/);
  assert.match(panel, /1 semana de máquina/);
  assert.match(panel, /divider":true/);
  assert.equal(panel.toLowerCase().includes(OTHER), false);
});

test("o convite só vale depois de 24 horas, sai da conta se a pessoa sair e não premia duas vezes", () => {
  const { repo, invites, dir } = book();
  try {
    const joined = invites.recordJoin({ guildId: "g", inviterId: "host", memberId: "novo", code: "aaa", joinedAt: 1_000 });
    assert.equal(joined.ok, true);
    assert.equal(invites.recordJoin({ guildId: "g", inviterId: "host", memberId: "novo", code: "aaa", joinedAt: 2_000 }).reason, "repeat");
    assert.equal(invites.recordJoin({ guildId: "g", inviterId: "outro", memberId: "novo", code: "bbb", joinedAt: 2_000 }).reason, "repeat");
    assert.equal(invites.due("g", 1_000 + STAY_MS - 1).length, 0);
    assert.equal(invites.summary("g", "host").valid, 0);
    assert.equal(invites.summary("g", "host").pending, 1);
    const early = invites.leave("g", "novo", 2_000);
    assert.equal(early.wasValid, false);
    assert.equal(early.summary.valid, 0);
    assert.equal(early.join.status, "saiu");
    const again = invites.recordJoin({ guildId: "g", inviterId: "host", memberId: "volta", code: "aaa", joinedAt: 1_000 });
    assert.equal(invites.due("g", 1_000 + STAY_MS).length, 1);
    const promoted = invites.promote(again.join, 1_000 + STAY_MS);
    assert.equal(promoted.summary.valid, 1);
    assert.equal(promoted.rewards.length, 0);
    const left = invites.leave("g", "volta", 9_000);
    assert.equal(left.wasValid, true);
    assert.equal(left.summary.valid, 0);
    const first = invites.adjust("g", "host", 10);
    assert.equal(first.summary.valid, 10);
    assert.equal(first.rewards.length, 1);
    assert.equal(first.rewards[0].label, "6 horas de máquina");
    const second = invites.adjust("g", "host", 10);
    assert.equal(second.summary.valid, 20);
    assert.deepEqual(second.rewards.map((reward) => reward.invites), [20]);
    repo.insertClient({
      id: "c1", guildId: "g", userId: "host", clientName: "Ana", machineName: "pc-ana",
      gpu: "T4", vcpus: 4, ram: 28, publicIp: "", rdpUser: "ana", rdpPasswordCipher: null,
      pinCipher: null, planType: "mensal", startedAt: 1, expiresAt: 100_000, infraId: "", now: 1,
    });
    const delivered = invites.deliver(first.rewards[0].id, "staff", 5_000);
    assert.equal(delivered.ok, true);
    assert.equal(delivered.extended, 100_000 + first.rewards[0].rewardMs);
    assert.equal(invites.deliver(first.rewards[0].id, "staff", 5_000).ok, false);
    invites.reset("g", "host");
    assert.equal(invites.summary("g", "host").valid, 0);
    const climbed = invites.adjust("g", "host", 20);
    assert.equal(climbed.summary.valid, 20);
    assert.deepEqual(climbed.rewards.map((reward) => reward.invites), []);
    assert.equal(repo.inviteRewards("g", "host").length, 2);
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
