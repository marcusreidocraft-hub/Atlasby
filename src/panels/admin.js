import {
  ActionRowBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import { GPUS, PLAN_LABEL, formatDate } from "../services/plans.js";
import { container, press, text } from "./ui.js";

function input(id, label, description, style = TextInputStyle.Short, extra = {}) {
  const field = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(extra.required !== false).setMaxLength(extra.max ?? 80);
  if (extra.min) field.setMinLength(extra.min);
  if (extra.value) field.setValue(String(extra.value).slice(0, extra.max ?? 80));
  if (extra.placeholder) field.setPlaceholder(extra.placeholder);
  const item = new LabelBuilder().setLabel(label).setTextInputComponent(field);
  if (description) item.setDescription(description);
  return item;
}

function select(id, label, description, options, current) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(label)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.map((option) => ({ label: option.label, value: option.value, default: option.value === current })));
  const item = new LabelBuilder().setLabel(label).setStringSelectMenuComponent(menu);
  if (description) item.setDescription(description);
  return item;
}

function modal(customId, title, labels) {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addLabelComponents(...labels);
}

export function renderAddPicker(accent) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text("## Adicionar cliente\nEscolha o membro. Os dados seguem em etapas e só são gravados depois da revisão."));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("atlas:admin:add:user").setPlaceholder("Escolha o membro").setMinValues(1).setMaxValues(1),
    ));
  });
}

export function step1Modal({ kind, targetUserId, current = {} }) {
  return modal(`atlas:modal:${kind}:1:${targetUserId}`, "Cliente e máquina", [
    input("nome", "Nome do cliente", "Como a pessoa aparece no painel.", TextInputStyle.Short, { min: 2, max: 48, value: current.clientName }),
    input("maquina", "Nome da máquina", "Usado também na confirmação de formatação.", TextInputStyle.Short, { min: 2, max: 32, value: current.machineName }),
    select("gpu", "GPU", "Escolha o modelo.", GPUS.map((gpu) => ({ label: gpu, value: gpu })), current.gpu),
    input("vcpus", "vCPUs", "Número de 1 a 128.", TextInputStyle.Short, { max: 4, value: current.vcpus }),
    input("ram", "RAM", "Exemplo: 28 GB.", TextInputStyle.Short, { max: 24, value: current.ram }),
  ]);
}

export function step2Modal(draft) {
  const current = draft.payload;
  return modal(`atlas:modal:${draft.kind}:2:${draft.id}`, "Acesso", [
    input("ip", "IP público", "IPv4. Pode ficar vazio.", TextInputStyle.Short, { required: false, max: 64, value: current.publicIp }),
    input("usuario", "Usuário RDP", "Pode ficar vazio.", TextInputStyle.Short, { required: false, max: 32, value: current.rdpUser }),
    input("senha", "Senha RDP", "Em branco mantém a senha já gravada.", TextInputStyle.Short, { required: false, max: 128 }),
    input("pin", "PIN Moonlight", "4 a 8 dígitos. Em branco mantém o atual.", TextInputStyle.Short, { required: false, max: 8 }),
    select("plano", "Tipo de plano", "O vencimento pode ser ajustado na próxima etapa.", [
      { label: "Semanal", value: "semanal" },
      { label: "Quinzenal", value: "quinzenal" },
      { label: "Mensal", value: "mensal" },
    ], current.plan),
  ]);
}

export function step3Modal(draft) {
  const current = draft.payload;
  return modal(`atlas:modal:${draft.kind}:3:${draft.id}`, "Plano e infra", [
    input("inicio", "Data de início", "DD/MM/AAAA ou AAAA-MM-DD.", TextInputStyle.Short, { max: 20, value: current.startText }),
    input("vencimento", "Data de vencimento", "Calculada pelo plano e editável.", TextInputStyle.Short, { max: 20, value: current.expiryText }),
    input("infra", "ID da máquina na infra", "Resource ID da VM. Pode ficar vazio.", TextInputStyle.Paragraph, { required: false, max: 400, value: current.infraId }),
  ]);
}

export function renderContinue(accent, draftId, step, summary) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(summary));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:draft:${step}:${draftId}`, "Continuar", ButtonStyle.Primary),
      press(`atlas:admin:cancel:${draftId}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderReview(draft, accent) {
  const data = draft.payload;
  const lines = [
    "## Revise antes de salvar",
    `Membro: <@${data.targetUserId}>`,
    `Cliente: ${data.clientName}`,
    `Máquina: ${data.machineName}`,
    `GPU: ${data.gpu}`,
    `vCPUs: ${data.vcpus}`,
    `RAM: ${data.ram}`,
    `IP: ${data.publicIp || "não informado"}`,
    `Usuário RDP: ${data.rdpUser || "não informado"}`,
    `Senha RDP: ${data.rdpPasswordCipher || data.keepPassword ? "definida" : "não definida"}`,
    `PIN Moonlight: ${data.pinCipher || data.keepPin ? "definido" : "não definido"}`,
    `Plano: ${PLAN_LABEL[data.plan] || data.plan}`,
    `Início: ${data.startText || formatDate(data.startedAt)}`,
    `Vencimento: ${data.expiryText || formatDate(data.expiresAt)}`,
    `ID na infra: ${data.infraId || "não informado"}`,
  ];
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(lines.join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:save:${draft.id}`, "Salvar", ButtonStyle.Success),
      press(`atlas:admin:cancel:${draft.id}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderFormatConfirm(client, confirmation, accent, emojis) {
  return container(0xed4245, (root) => {
    root.addTextDisplayComponents(text([
      "## Formatar VM",
      `Isso pede a recriação do disco do sistema de **${client.machineName}**.`,
      "Na Azure, a VM é desligada e o disco do sistema é trocado pelo snapshot configurado.",
      `A confirmação expira <t:${Math.floor(confirmation.expiresAt / 1000)}:R>.`,
      "No próximo passo, digite o nome da máquina ou CONFIRMAR.",
    ].join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:vm:format:yes:${confirmation.id}`, "Confirmar formatação", ButtonStyle.Danger, emojis.alerta),
      press(`atlas:vm:format:no:${confirmation.id}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function formatModal(confirmationId) {
  return modal(`atlas:modal:format:${confirmationId}`, "Confirmar formatação", [
    input("frase", "Nome da máquina ou CONFIRMAR", "A frase precisa ser exata, sem diferenciar maiúsculas.", TextInputStyle.Short, { min: 2, max: 48 }),
  ]);
}

export function renderRemoveConfirm(client, accent) {
  return container(0xed4245, (root) => {
    root.addTextDisplayComponents(text(`## Remover cliente\n${client.clientName} · ${client.machineName}\nO registro e as credenciais cifradas saem do banco. A VM na Azure não é apagada.`));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:remove:yes:${client.userId}`, "Remover", ButtonStyle.Danger),
      press("atlas:admin:remove:no", "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderClientList(rows, { accent, page, pages, title }) {
  const lines = [`## ${title}`, rows.length ? rows.map((row) => `**${row.clientName}** · ${row.machineName} · <@${row.userId}> · ${PLAN_LABEL[row.planType] || row.planType}`).join("\n") : "Nenhum cliente encontrado."];
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(lines.join("\n")));
    if (pages > 1) {
      root.addActionRowComponents(new ActionRowBuilder().addComponents(
        press(`atlas:admin:list:prev:${page}`, "Anterior", ButtonStyle.Secondary).setDisabled(page <= 0),
        press(`atlas:admin:list:next:${page}`, "Próxima", ButtonStyle.Secondary).setDisabled(page + 1 >= pages),
      ));
    }
  });
}

export function renderRenewReview(draft, accent) {
  const data = draft.payload;
  return container(accent, (root) => {
    root.addTextDisplayComponents(text([
      "## Renovar plano",
      `Cliente: ${data.clientName}`,
      `Máquina: ${data.machineName}`,
      `Plano: ${PLAN_LABEL[data.plan]}`,
      `Início: ${data.startText}`,
      `Vencimento: ${data.expiryText}`,
    ].join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:renew:save:${draft.id}`, "Salvar", ButtonStyle.Success),
      press(`atlas:admin:cancel:${draft.id}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}
