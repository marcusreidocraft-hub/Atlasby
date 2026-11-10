import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_AZURE_LOCATION,
  DEFAULT_AZURE_OS,
  DEFAULT_AZURE_VM_SIZE,
  DEFAULT_MAX_OS_DISK_GB,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_PANEL_ACCENT,
  loadConfig,
  parseBooleanFlag,
  parseMaxOsDiskGb,
  parsePanelColor,
} from "../src/config.js";
import { renderNotice, setPanelAccent } from "../src/ui.js";
import { renderVmAdmin } from "../src/vm-ui.js";
import { validateDiskIncrease } from "../src/vm-model.js";

const SNAPSHOT = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-atlas/providers/Microsoft.Compute/snapshots/os-base";

test("cor, disco máximo e booleanos aceitam o padrão e rejeitam lixo", () => {
  assert.equal(parsePanelColor("5865F2"), 0x5865f2);
  assert.equal(parsePanelColor("#5865f2"), 0x5865f2);
  assert.equal(parsePanelColor("#abc"), 0xaabbcc);
  assert.equal(parsePanelColor("azul"), DEFAULT_PANEL_ACCENT);
  assert.equal(parsePanelColor(""), DEFAULT_PANEL_ACCENT);
  assert.equal(parseMaxOsDiskGb("2048"), 2048);
  assert.equal(parseMaxOsDiskGb("4096"), 4096);
  assert.equal(parseMaxOsDiskGb(""), DEFAULT_MAX_OS_DISK_GB);
  assert.equal(parseMaxOsDiskGb("nope"), DEFAULT_MAX_OS_DISK_GB);
  assert.equal(parseMaxOsDiskGb("0"), DEFAULT_MAX_OS_DISK_GB);
  assert.equal(parseMaxOsDiskGb("70000"), DEFAULT_MAX_OS_DISK_GB);
  assert.equal(parseBooleanFlag("false"), false);
  assert.equal(parseBooleanFlag("true"), true);
  assert.equal(parseBooleanFlag("0"), false);
  assert.equal(parseBooleanFlag("1"), true);
  assert.equal(parseBooleanFlag("sim"), true);
  assert.equal(parseBooleanFlag("não"), false);
  assert.equal(parseBooleanFlag(""), false);
  assert.equal(parseBooleanFlag("talvez"), false);
  assert.equal(validateDiskIncrease(128, 256, 512).ok, true);
  assert.equal(validateDiskIncrease(128, 600, 512).code, "disk_invalid");
  assert.equal(validateDiskIncrease(128, 600, 512).maxDisk, 512);
});

test("ausência das variáveis opcionais não impede a configuração e não guarda segredo", () => {
  const config = loadConfig({ DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "100000000000000003", ALLOWED_GUILD_IDS: "100000000000000001" });
  assert.equal(config.azure.configured, false);
  assert.equal(config.azure.tenantId, "");
  assert.equal(config.azure.clientId, "");
  assert.equal(config.azure.clientSecret, "");
  assert.equal(config.azure.subscriptionId, "");
  assert.equal(config.azure.snapshotId, "");
  assert.equal(config.azure.virtualNetwork, "");
  assert.equal(config.azure.subnet, "");
  assert.equal(config.azure.location, DEFAULT_AZURE_LOCATION);
  assert.equal(config.azure.vmSize, DEFAULT_AZURE_VM_SIZE);
  assert.equal(config.azure.osType, DEFAULT_AZURE_OS);
  assert.equal(config.azure.maxOsDiskGb, DEFAULT_MAX_OS_DISK_GB);
  assert.equal(config.panelColor, DEFAULT_PANEL_ACCENT);
  assert.equal(config.assistant.enabled, false);
  assert.equal(config.assistant.baseUrl, DEFAULT_OLLAMA_URL);
  assert.equal(config.assistant.model, DEFAULT_OLLAMA_MODEL);
  assert.equal(config.assistant.apiKey, "");
});

test("formatos válidos entram e formatos inválidos voltam ao padrão vazio", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "t",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: "100000000000000001",
    AZURE_SNAPSHOT_ID: SNAPSHOT,
    AZURE_LOCATION: "BRAZILSOUTH",
    AZURE_DEFAULT_VM_SIZE: "Standard_NC4as_T4_v3",
    AZURE_OS_TYPE: "linux",
    AZURE_VIRTUAL_NETWORK: "vnet-brazilsouth-4",
    AZURE_SUBNET: "snet-brazilsouth-1",
    AZURE_MAX_OS_DISK_GB: "1024",
    PANEL_COLOR: "#112233",
    OLLAMA_BASE_URL: "http://localhost:11434/",
    OLLAMA_MODEL: "qwen3:4b",
    OLLAMA_API_KEY: "nao-mostrar",
    AI_ASSISTANT_ENABLED: "false",
  });
  assert.equal(config.azure.snapshotId, SNAPSHOT);
  assert.equal(config.azure.location, "brazilsouth");
  assert.equal(config.azure.vmSize, "Standard_NC4as_T4_v3");
  assert.equal(config.azure.osType, "Linux");
  assert.equal(config.azure.virtualNetwork, "vnet-brazilsouth-4");
  assert.equal(config.azure.subnet, "snet-brazilsouth-1");
  assert.equal(config.azure.maxOsDiskGb, 1024);
  assert.equal(config.panelColor, 0x112233);
  assert.equal(config.assistant.enabled, false);
  assert.equal(config.assistant.baseUrl, "http://localhost:11434");
  assert.equal(config.assistant.apiKey, "nao-mostrar");

  const invalid = loadConfig({
    DISCORD_TOKEN: "t",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: "100000000000000001",
    AZURE_SNAPSHOT_ID: "snapshot-simples",
    AZURE_LOCATION: "Brazil South",
    AZURE_DEFAULT_VM_SIZE: "tamanho inválido",
    AZURE_OS_TYPE: "macos",
    AZURE_VIRTUAL_NETWORK: "rede com espaço",
    AZURE_SUBNET: "../etc",
    OLLAMA_BASE_URL: "ftp://local",
    OLLAMA_MODEL: "modelo com espaço",
    AI_ASSISTANT_ENABLED: "talvez",
  });
  assert.equal(invalid.azure.snapshotId, "");
  assert.equal(invalid.azure.location, DEFAULT_AZURE_LOCATION);
  assert.equal(invalid.azure.vmSize, DEFAULT_AZURE_VM_SIZE);
  assert.equal(invalid.azure.osType, DEFAULT_AZURE_OS);
  assert.equal(invalid.azure.virtualNetwork, "");
  assert.equal(invalid.azure.subnet, "");
  assert.equal(invalid.assistant.enabled, false);
  assert.equal(invalid.assistant.baseUrl, DEFAULT_OLLAMA_URL);
  assert.equal(invalid.assistant.model, DEFAULT_OLLAMA_MODEL);
});

test("painel admin mostra padrões sem segredo e a cor inválida não troca o destaque", () => {
  const view = renderVmAdmin({
    vms: [],
    azureConfigured: false,
    autoGlobal: true,
    defaults: {
      location: "brazilsouth",
      vmSize: "Standard_NC4as_T4_v3",
      osType: "Windows",
      maxOsDiskGb: 2048,
      snapshotId: SNAPSHOT,
      virtualNetwork: "vnet-brazilsouth-4",
      subnet: "snet-brazilsouth-1",
    },
    users: () => [],
  });
  const rendered = JSON.stringify(view);
  assert.match(rendered, /Padrões Azure/);
  assert.match(rendered, /brazilsouth/);
  assert.match(rendered, /vnet-brazilsouth-4/);
  assert.doesNotMatch(rendered, /AZURE_CLIENT_SECRET|clientSecret|OLLAMA_API_KEY/);
  setPanelAccent(parsePanelColor("verde"));
  const notice = renderNotice("Atlas");
  assert.equal(notice.components[0].toJSON().accent_color, DEFAULT_PANEL_ACCENT);
  setPanelAccent(DEFAULT_PANEL_ACCENT);
});

test("o exemplo de ambiente e o gitignore não carregam segredo", () => {
  const example = fs.readFileSync(".env.example", "utf8");
  const ignore = fs.readFileSync(".gitignore", "utf8");
  assert.match(ignore, /^\.env$/m);
  for (const name of ["AZURE_TENANT_ID=", "AZURE_CLIENT_ID=", "AZURE_CLIENT_SECRET=", "AZURE_SUBSCRIPTION_ID=", "AZURE_SNAPSHOT_ID=", "OLLAMA_API_KEY="]) {
    assert.match(example, new RegExp(`^${name}$`, "m"));
  }
  assert.match(example, /^AZURE_LOCATION=brazilsouth$/m);
  assert.match(example, /^AZURE_DEFAULT_VM_SIZE=Standard_NC4as_T4_v3$/m);
  assert.match(example, /^AZURE_OS_TYPE=Windows$/m);
  assert.match(example, /^AZURE_VIRTUAL_NETWORK=$/m);
  assert.match(example, /^AZURE_SUBNET=$/m);
  assert.match(example, /^AZURE_MAX_OS_DISK_GB=2048$/m);
  assert.match(example, /^PANEL_COLOR=5865F2$/m);
  assert.match(example, /^OLLAMA_BASE_URL=http:\/\/localhost:11434$/m);
  assert.match(example, /^OLLAMA_MODEL=qwen3:4b$/m);
  assert.match(example, /^AI_ASSISTANT_ENABLED=false$/m);
});
