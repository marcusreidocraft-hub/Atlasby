import { ActionRowBuilder, ButtonStyle, ContainerBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from "discord.js";
import { press, separator, text, V2_EPHEMERAL } from "../panels/ui.js";
import { DATA_SIZES, IOPS_CHOICES, autoThroughput } from "./limits.js";
import { MACHINE_SIZES } from "./payload.js";
import { progressMark } from "./create.js";

const STEPS = [
  ["rede", "Rede e IP público"],
  ["nic", "Placa de rede"],
  ["disco", "Disco"],
  ["vm", "Máquina virtual"],
  ["ligando", "Ligando"],
  ["pronto", "Pronto"],
];

function shell(accent, lines, rows = []) {
  const root = new ContainerBuilder().setAccentColor(accent);
  root.addTextDisplayComponents(text(lines.join("\n")));
  for (const row of rows) root.addActionRowComponents(row);
  return { components: [root], flags: V2_EPHEMERAL };
}

function select(customId, placeholder, options) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).addOptions(options),
  );
}

export function renderMemberStep(draftId, accent) {
  return shell(accent, [
    "## Criar máquina",
    "Escolha quem vai receber a VM da Atlas Cloud PC.",
  ], [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`atlas:maquina:user:${draftId}`).setPlaceholder("Membro").setMinValues(1).setMaxValues(1),
    ),
  ]);
}

export function renderSizeStep(draft, accent) {
  return shell(accent, [
    "## Tamanho",
    `Membro: <@${draft.userId}>`,
    "Tesla T4 nas famílias já usadas pela Atlas.",
  ], [
    select(`atlas:maquina:size:${draft.id}`, "Tamanho", MACHINE_SIZES.map((item) => ({ label: item.label, value: item.id, description: item.size }))),
  ]);
}

export function renderSpotStep(draft, accent) {
  return shell(accent, [
    "## Capacidade",
    `${draft.sizeLabel}`,
    "Spot pode ser interrompida. Normal fica ligada pelo período.",
  ], [
    select(`atlas:maquina:spot:${draft.id}`, "Spot ou Normal", [
      { label: "Spot", value: "spot", description: "Capacidade ociosa, pode cair" },
      { label: "Normal", value: "normal", description: "Capacidade dedicada" },
    ]),
  ]);
}

export function renderDiskStep(draft, accent) {
  return shell(accent, [
    "## Disco",
    "O sistema fica num SSD Premium. O SSD v2 entra como disco de dados, na mesma zona da VM.",
  ], [
    select(`atlas:maquina:disk:${draft.id}`, "Disco", [
      { label: "SSD Premium", value: "premium", description: "Só o disco do sistema" },
      { label: "Adicionar SSD v2", value: "v2", description: "Disco de dados com IOPS próprio" },
    ]),
  ]);
}

export function renderGbStep(draft, accent) {
  return shell(accent, ["## Disco de dados", "Tamanho do Premium SSD v2."], [
    select(`atlas:maquina:gb:${draft.id}`, "Gigabytes", DATA_SIZES.map((gb) => ({ label: `${gb} GB`, value: String(gb) }))),
  ]);
}

export function renderIopsStep(draft, accent) {
  return shell(accent, ["## IOPS", "3000 já vem no preço base do SSD v2."], [
    select(`atlas:maquina:iops:${draft.id}`, "IOPS", IOPS_CHOICES.map((iops) => ({ label: String(iops), value: String(iops), description: iops === 3000 ? "Base" : "Acima da base" }))),
  ]);
}

export function renderThroughputStep(draft, accent) {
  const auto = autoThroughput(draft.iops);
  return shell(accent, ["## Taxa de transferência", `Automático para ${draft.iops} IOPS: ${auto} MB/s.`], [
    select(`atlas:maquina:flow:${draft.id}`, "Throughput", [
      { label: "125 MB/s", value: "base", description: "Base incluída" },
      { label: `Automático · ${auto} MB/s`, value: "auto", description: "Proporcional ao IOPS" },
    ]),
  ]);
}

export function renderZoneStep(draft, accent, hostZone) {
  return shell(accent, [
    "## Zona",
    hostZone ? `O host sugere a zona ${hostZone}. O disco v2 usa a mesma zona da VM.` : "O SSD v2 exige zona 1, 2 ou 3.",
  ], [
    select(`atlas:maquina:zone:${draft.id}`, "Zona", [
      { label: "Zona 1", value: "1" },
      { label: "Zona 2", value: "2" },
      { label: "Zona 3", value: "3" },
    ]),
  ]);
}

export function renderNameStep(draft, accent) {
  return shell(accent, [
    "## Nome",
    `Sugestão: \`${draft.suggestedName}\``,
    "Até 15 caracteres, começando com letra.",
  ], [
    new ActionRowBuilder().addComponents(
      press(`atlas:maquina:auto:${draft.id}`, "Usar sugestão", ButtonStyle.Primary),
      press(`atlas:maquina:name:${draft.id}`, "Outro nome", ButtonStyle.Secondary),
    ),
  ]);
}

export function nameModal(draftId) {
  const field = new TextInputBuilder().setCustomId("nome").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(15).setPlaceholder("atlas-ana-01");
  return new ModalBuilder()
    .setCustomId(`atlas:modal:maquina:${draftId}`)
    .setTitle("Nome da máquina")
    .addLabelComponents(new LabelBuilder().setLabel("Nome").setDescription("Letras minúsculas, números e hífen.").setTextInputComponent(field));
}

export function renderReview(draft, accent, extra) {
  const disk = draft.diskMode === "v2"
    ? `SSD v2 ${draft.dataGb} GB · ${draft.iops} IOPS · ${draft.throughput} MB/s · zona ${draft.zone}`
    : "SSD Premium no sistema";
  const root = new ContainerBuilder().setAccentColor(accent);
  root.addTextDisplayComponents(text([
    "## Revisão",
    `Membro: <@${draft.userId}>`,
    `Tamanho: ${draft.sizeLabel}`,
    `Capacidade: ${draft.spot ? "Spot" : "Normal"}`,
    `Disco: ${disk}`,
    `Nome: \`${draft.machineName}\``,
    `Região: ${extra.location}`,
    `Imagem: ${extra.image}`,
    `A confirmação expira <t:${extra.expires}:R>.`,
  ].join("\n")));
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press(`atlas:maquina:go:${draft.id}`, "Criar", ButtonStyle.Success),
    press(`atlas:maquina:no:${draft.id}`, "Cancelar", ButtonStyle.Secondary),
  ));
  return { components: [root], flags: V2_EPHEMERAL };
}

export function renderProgress(step, accent) {
  const lines = STEPS.map(([id, label]) => `${id === step ? "→" : "·"} ${label}`);
  return shell(accent, [
    "## Criando a máquina",
    `\`${progressMark(step)}\``,
    ...lines,
  ]);
}

export function renderReady({ machineName, publicIp, accent }) {
  return shell(accent, [
    "## Máquina pronta",
    `\`${machineName}\``,
    publicIp ? `IP público: \`${publicIp}\`` : "O IP público ainda não apareceu.",
    "O cliente foi cadastrado com plano mensal a partir de hoje.",
  ]);
}

export function renderFailure(message, accent, cleaned) {
  const tail = cleaned == null ? "" : cleaned.length ? "Não consegui apagar todos os recursos parciais. Confira o grupo de recursos." : "Os recursos parciais foram apagados.";
  return shell(accent, ["## Não foi criada", message, tail].filter(Boolean));
}
