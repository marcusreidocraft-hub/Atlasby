import { ActionRowBuilder, ButtonStyle, ContainerBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from "discord.js";
import { press, separator, text, V2_EPHEMERAL } from "../panels/ui.js";
import { DATA_SIZES, IOPS_CHOICES, autoThroughput } from "./limits.js";
import { nsgOptions } from "./nsg.js";
import { suggestedDataGb } from "../loja/catalog.config.js";
import { MACHINE_SIZES, sizeById } from "./payload.js";
import { specsFromSize } from "../services/vm-size.js";
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

export const WIZARD_DEFAULTS = Object.freeze({
  size: "t4-4",
  spot: "spot",
  disk: "premium",
  gb: "128",
  iops: "3000",
  flow: "base",
  nsg: "padrao",
});

function select(customId, placeholder, options) {
  const rows = options.map((option) => {
    const row = { label: option.label, value: option.value };
    if (option.description) row.description = option.description;
    return row;
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).addOptions(rows),
  );
}

function move(draftId, step) {
  return new ActionRowBuilder().addComponents(
    press(`atlas:maquina:ok:${step}:${draftId}`, "Continuar", ButtonStyle.Primary),
    press(`atlas:maquina:back:${step}:${draftId}`, "Voltar", ButtonStyle.Secondary),
  );
}

export function renderMemberStep(draftId, accent) {
  return shell(accent, [
    "## Criar máquina",
    "Escolha quem vai receber a VM da Ignix Cloud PC.",
  ], [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`atlas:maquina:user:${draftId}`).setPlaceholder("Membro").setMinValues(1).setMaxValues(1),
    ),
  ]);
}

export function renderSizeStep(draft, accent) {
  const suggested = MACHINE_SIZES.find((item) => item.id === WIZARD_DEFAULTS.size) || MACHINE_SIZES[0];
  return shell(accent, [
    "## Tamanho",
    `Membro: <@${draft.userId}>`,
    "Tesla T4 nas famílias já usadas pela Ignix.",
    `Sugestão: ${suggested.label}`,
  ], [
    select(`atlas:maquina:size:${draft.id}`, "Tamanho", MACHINE_SIZES.map((item) => ({ label: item.label, value: item.id, description: item.size }))),
    move(draft.id, "size"),
  ]);
}

export function renderSpotStep(draft, accent) {
  return shell(accent, [
    "## Capacidade",
    `${draft.sizeLabel}`,
    "Spot pode ser interrompida. Normal fica ligada pelo período.",
    "Sugestão: Spot",
  ], [
    select(`atlas:maquina:spot:${draft.id}`, "Spot ou Normal", [
      { label: "Spot", value: "spot", description: "Capacidade ociosa, pode cair" },
      { label: "Normal", value: "normal", description: "Capacidade dedicada" },
    ]),
    move(draft.id, "spot"),
  ]);
}

export function renderDiskStep(draft, accent) {
  return shell(accent, [
    "## Disco",
    "O sistema fica num SSD Premium. O SSD v2 entra como disco de dados, na mesma zona da VM.",
    "Sugestão: SSD Premium",
  ], [
    select(`atlas:maquina:disk:${draft.id}`, "Disco", [
      { label: "SSD Premium", value: "premium", description: "Só o disco do sistema" },
      { label: "Adicionar SSD v2", value: "v2", description: "Disco de dados com IOPS próprio" },
    ]),
    move(draft.id, "disk"),
  ]);
}

export function renderGbStep(draft, accent) {
  const suggested = suggestedDataGb(specsFromSize(sizeById(draft.sizeId)?.size).vcpus);
  return shell(accent, ["## Disco de dados", "Tamanho do Premium SSD v2.", `Sugestão: ${suggested} GB`], [
    select(`atlas:maquina:gb:${draft.id}`, "Gigabytes", DATA_SIZES.map((gb) => ({ label: `${gb} GB`, value: String(gb) }))),
    move(draft.id, "gb"),
  ]);
}

export function renderIopsStep(draft, accent) {
  return shell(accent, ["## IOPS", "3000 já vem no preço base do SSD v2.", "Sugestão: 3000"], [
    select(`atlas:maquina:iops:${draft.id}`, "IOPS", IOPS_CHOICES.map((iops) => ({ label: String(iops), value: String(iops), description: iops === 3000 ? "Base" : "Acima da base" }))),
    move(draft.id, "iops"),
  ]);
}

export function renderThroughputStep(draft, accent) {
  const auto = autoThroughput(draft.iops);
  return shell(accent, ["## Taxa de transferência", `Automático para ${draft.iops} IOPS: ${auto} MB/s.`, "Sugestão: 125 MB/s"], [
    select(`atlas:maquina:flow:${draft.id}`, "Throughput", [
      { label: "125 MB/s", value: "base", description: "Base incluída" },
      { label: `Automático · ${auto} MB/s`, value: "auto", description: "Proporcional ao IOPS" },
    ]),
    move(draft.id, "flow"),
  ]);
}

export function renderNsgStep(draft, nsgs, { defaultName, accent }) {
  return shell(accent, [
    "## Firewall",
    "Escolha o grupo de segurança da placa de rede. A lista é da mesma região da VM.",
    `Sugestão: ${defaultName || "Padrão"}`,
  ], [
    select(`atlas:maquina:nsg:${draft.id}`, "Grupo de segurança", nsgOptions({ nsgs, defaultName })),
    move(draft.id, "nsg"),
  ]);
}

export function renderZoneStep(draft, accent, hostZone) {
  return shell(accent, [
    "## Zona",
    hostZone ? `O host sugere a zona ${hostZone}. O disco v2 usa a mesma zona da VM.` : "O SSD v2 exige zona 1, 2 ou 3.",
    `Sugestão: zona ${hostZone || "1"}`,
  ], [
    select(`atlas:maquina:zone:${draft.id}`, "Zona", [
      { label: "Zona 1", value: "1" },
      { label: "Zona 2", value: "2" },
      { label: "Zona 3", value: "3" },
    ]),
    move(draft.id, "zone"),
  ]);
}

export function renderImageStep(draft, versions, preferred, accent) {
  return shell(accent, [
    "## Imagem",
    preferred ? `Sugestão: ${preferred}` : "Escolha a versão pronta da galeria.",
    "Continuar usa a sugestão. A opção do menu não fica pré-marcada.",
  ], [
    select(`atlas:maquina:image:${draft.id}`, "Versão", versions.map((version) => ({
      label: version,
      value: version,
      description: version === "2.0.0" ? "Versão pedida" : "Pronta",
    }))),
    move(draft.id, "image"),
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
      press(`atlas:maquina:back:name:${draft.id}`, "Voltar", ButtonStyle.Secondary),
    ),
  ]);
}

export function nameModal(draftId) {
  const field = new TextInputBuilder().setCustomId("nome").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(15).setPlaceholder("ignix-ana-01");
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
    `NSG: ${draft.nsgLabel || "não escolhido"}`,
    `Nome: \`${draft.machineName}\``,
    `Região: ${extra.location}`,
    `Imagem: ${extra.image}`,
    extra.version ? `Versão: ${extra.version}` : "",
    `A confirmação expira <t:${extra.expires}:R>.`,
  ].filter(Boolean).join("\n")));
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press(`atlas:maquina:go:${draft.id}`, "Criar", ButtonStyle.Success),
    press(`atlas:maquina:back:review:${draft.id}`, "Voltar", ButtonStyle.Secondary),
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

export function renderFailure(message, accent, cleaned, draftId = "") {
  const tail = cleaned == null ? "" : cleaned.length ? "Não consegui apagar todos os recursos parciais. Confira o grupo de recursos." : "Os recursos parciais foram apagados.";
  const rows = draftId ? [new ActionRowBuilder().addComponents(
    press(`atlas:maquina:back:fail:${draftId}`, "Tentar de novo", ButtonStyle.Primary),
    press(`atlas:maquina:no:${draftId}`, "Cancelar", ButtonStyle.Secondary),
  )] : [];
  return shell(accent, ["## Não foi criada", message, tail].filter(Boolean), rows);
}

export function renderHold(message, accent, draftId) {
  return shell(accent, ["## Criar máquina", message], [
    new ActionRowBuilder().addComponents(
      press(`atlas:maquina:back:image:${draftId}`, "Voltar", ButtonStyle.Secondary),
      press(`atlas:maquina:no:${draftId}`, "Cancelar", ButtonStyle.Secondary),
    ),
  ]);
}
