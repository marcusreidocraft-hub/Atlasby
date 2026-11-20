import assert from "node:assert/strict";
import test from "node:test";
import { diskLabel, machineNoticeText, renderMachineNotice, sendMachineNotice } from "../src/panels/machine-dm.js";

const ready = {
  kind: "pronta",
  accent: 0x5865f2,
  bannerUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
  machineName: "ignix-zlyl-7c10",
  gpu: "Tesla T4",
  vcpus: 4,
  ram: "28 GB",
  diskMode: "v2",
  dataGb: 256,
  ip: "20.206.240.93",
  planLabel: "Mensal",
  startedAt: "20/11/2026",
  expiresAt: "20/12/2026",
  panelUrl: "https://discord.com/channels/100000000000000001/100000000000000002",
  supportUrl: "https://discord.com/channels/100000000000000001/100000000000000003",
};

test("o aviso da máquina pronta é um painel com seções e botões", () => {
  assert.equal(diskLabel({ diskMode: "v2", dataGb: 256 }), "SSD Premium · SSD v2 256 GB");
  const view = renderMachineNotice(ready);
  const raw = JSON.stringify(view);
  assert.match(raw, /🎮 Sua máquina está pronta/);
  assert.match(raw, /ignix-zlyl-7c10/);
  assert.match(raw, /Tesla T4 · 4 vCPUs · 28 GB · SSD Premium · SSD v2 256 GB/);
  assert.match(raw, /`20\.206\.240\.93`/);
  assert.match(raw, /Início 20\/11\/2026/);
  assert.match(raw, /Vencimento 20\/12\/2026/);
  assert.match(raw, /Controlar VM/);
  assert.match(raw, /Ignix Cloud PC/);
  assert.match(raw, /cdn\.discordapp\.com/);
  assert.match(raw, /Abrir painel/);
  assert.match(raw, /Suporte/);
  assert.equal(view.fallback, machineNoticeText(ready));
  assert.match(view.fallback, /está pronta: ignix-zlyl-7c10/);
  const plain = JSON.stringify(renderMachineNotice({ ...ready, bannerUrl: "", panelUrl: "", supportUrl: "" }));
  assert.equal(plain.includes("cdn.discordapp.com"), false);
  assert.equal(plain.includes("Abrir painel"), false);
  const expired = JSON.stringify(renderMachineNotice({ ...ready, kind: "venceu" }));
  assert.match(expired, /Seu plano venceu/);
  assert.equal(expired.includes("está pronta"), false);
  assert.match(machineNoticeText({ kind: "venceu", machineName: "ignix-zlyl-7c10" }), /venceu/);
});

test("a DM cai para texto quando os componentes falham", async () => {
  const sent = [];
  const user = {
    async send(body) {
      sent.push(body);
      if (sent.length === 1) throw new Error("components");
    },
  };
  assert.equal(await sendMachineNotice(user, renderMachineNotice(ready)), "texto");
  assert.equal(typeof sent[1], "string");
  assert.match(sent[1], /20\.206\.240\.93/);
});
