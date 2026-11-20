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
import { vmOptionValue } from "../services/provider.js";
import { GPUS, PLAN_LABEL, formatDate } from "../services/plans.js";
import { container, heading, mark, press, text } from "./ui.js";

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function input(id, label, description, style = TextInputStyle.Short, extra = {}) {
  const max = extra.max ?? 80;
  const min = extra.min ?? 0;
  const field = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(extra.required !== false).setMaxLength(max);
  if (min > 0) field.setMinLength(min);
  if (extra.value) {
    const value = clip(extra.value, max);
    if (value.length >= min) field.setValue(value);
  }
  if (extra.placeholder) field.setPlaceholder(clip(extra.placeholder, 100));
  const item = new LabelBuilder().setLabel(clip(label, 45)).setTextInputComponent(field);
  const hint = clip(description, 100);
  if (hint) item.setDescription(hint);
  return item;
}

function select(id, label, description, options, current) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(clip(label, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.map((option) => {
      const data = { label: clip(option.label, 100), value: clip(option.value, 100) };
      if (data.value === current) data.default = true;
      return data;
    }));
  const item = new LabelBuilder().setLabel(clip(label, 45)).setStringSelectMenuComponent(menu);
  const hint = clip(description, 100);
  if (hint) item.setDescription(hint);
  return item;
}

export function inspectModal(modal) {
  const data = modal.toJSON();
  const issues = [];
  if (typeof data.custom_id !== "string" || data.custom_id.length < 1 || data.custom_id.length > 100) issues.push("custom_id");
  if (typeof data.title !== "string" || data.title.length < 1 || data.title.length > 45) issues.push("title");
  if (!Array.isArray(data.components) || data.components.length < 1 || data.components.length > 5) issues.push("count");
  const ids = new Set();
  for (const component of data.components ?? []) {
    if (component.type !== 18) issues.push("not-label");
    if (typeof component.label !== "string" || component.label.length < 1 || component.label.length > 45) issues.push("label");
    if (component.description != null && (component.description.length < 1 || component.description.length > 100)) issues.push("description");
    const child = component.component ?? {};
    if (typeof child.custom_id !== "string" || child.custom_id.length < 1 || child.custom_id.length > 100 || ids.has(child.custom_id)) issues.push("child-id");
    if (child.custom_id) ids.add(child.custom_id);
    if (child.type === 4) {
      if (child.placeholder && child.placeholder.length > 100) issues.push("placeholder");
      if (child.value && child.min_length && child.value.length < child.min_length) issues.push("value-short");
      if (child.value && child.max_length && child.value.length > child.max_length) issues.push("value-long");
    } else if (child.type === 3) {
      if (child.disabled) issues.push("disabled");
      if (child.placeholder && child.placeholder.length > 150) issues.push("select-placeholder");
      if (!Array.isArray(child.options) || child.options.length < 1 || child.options.length > 25) issues.push("options");
      for (const option of child.options ?? []) {
        if (option.default === false) issues.push("default-false");
        if (!option.label || option.label.length > 100 || !option.value || option.value.length > 100) issues.push("option");
      }
    } else issues.push("child-type");
  }
  return issues;
}

function modal(customId, title, labels) {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addLabelComponents(...labels);
}

export function renderAddPicker(accent, emojis = {}) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(`${heading(emojis, "add", "Adicionar cliente")}\nEscolha o membro. Os dados seguem em etapas e só são gravados depois da revisão.`));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("atlas:admin:add:user").setPlaceholder("Escolha o membro").setMinValues(1).setMaxValues(1),
    ));
  });
}

export function step1Modal({ kind, targetUserId, current = null }) {
  const data = current ?? {};
  return modal(`atlas:modal:${kind}:1:${targetUserId}`, "Cliente e máquina", [
    input("nome", "Nome do cliente", "Como a pessoa aparece no painel.", TextInputStyle.Short, { min: 2, max: 48, value: data.clientName }),
    input("maquina", "Nome da máquina", "Usado também na confirmação de formatação.", TextInputStyle.Short, { min: 2, max: 32, value: data.machineName }),
  ]);
}

export function specsModal(draft) {
  const data = draft.payload ?? {};
  return modal(`atlas:modal:${draft.kind}:specs:${draft.id}`, "Hardware", [
    select("gpu", "GPU", "Só quando nenhuma VM da Azure foi escolhida.", GPUS.map((gpu) => ({ label: gpu, value: gpu })), data.gpu),
    input("vcpus", "vCPUs", "Número de 1 a 128.", TextInputStyle.Short, { max: 4, value: data.vcpus }),
    input("ram", "RAM", "Exemplo: 28 GB.", TextInputStyle.Short, { max: 24, value: data.ram }),
  ]);
}

export function step2Modal(draft) {
  const current = draft.payload;
  return modal(`atlas:modal:${draft.kind}:2:${draft.id}`, "Acesso", [
    input("ip", "IP público", "IPv4. Pode ficar vazio.", TextInputStyle.Short, { required: false, max: 64, value: current.publicIp }),
    input("usuario", "Usuário RDP", "Pode ficar vazio.", TextInputStyle.Short, { required: false, max: 32, value: current.rdpUser }),
    input("senha", "Senha RDP", "Em branco mantém a senha já gravada.", TextInputStyle.Short, { required: false, max: 128 }),
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

export function renderContinue(accent, draftId, step, summary, emojis = {}) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(summary));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:draft:${step}:${draftId}`, "Continuar", ButtonStyle.Primary, emojis.arrow),
      press(`atlas:admin:cancel:${draftId}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderReview(draft, accent, emojis = {}) {
  const data = draft.payload;
  const lines = [
    heading(emojis, "pencil", "Revise antes de salvar"),
    mark(emojis, "member", `Membro: <@${data.targetUserId}>`),
    `Cliente: ${data.clientName}`,
    mark(emojis, "monitor", `Máquina: ${data.machineName}`),
    mark(emojis, "windows", `GPU: ${data.gpu}`),
    `vCPUs: ${data.vcpus}`,
    `RAM: ${data.ram}`,
    mark(emojis, "world", `IP: ${data.publicIp || "não informado"}`),
    mark(emojis, "rdp", `Usuário RDP: ${data.rdpUser || "não informado"}`),
    `Senha RDP: ${data.rdpPasswordCipher || data.keepPassword ? "definida" : "não definida"}`,
    mark(emojis, "moonlight", `PIN Moonlight: ${data.pinCipher || data.keepPin ? "definido" : "não definido"}`),
    mark(emojis, "vip", `Plano: ${PLAN_LABEL[data.plan] || data.plan}`),
    `Início: ${data.startText || formatDate(data.startedAt)}`,
    mark(emojis, "cash", `Vencimento: ${data.expiryText || formatDate(data.expiresAt)}`),
    mark(emojis, "link", `ID na infra: ${data.infraId || "não informado"}`),
  ];
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(lines.join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:save:${draft.id}`, "Salvar", ButtonStyle.Success, emojis.verified),
      press(`atlas:admin:cancel:${draft.id}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderFormatConfirm(client, confirmation, accent, emojis) {
  return container(0xed4245, (root) => {
    root.addTextDisplayComponents(text([
      heading(emojis, "alerta", "Formatar VM"),
      `Isso pede a recriação do disco do sistema de **${client.machineName}**.`,
      mark(emojis, "tools", "Na Azure, a VM é desligada e o disco do sistema é recriado pela imagem da galeria. O IP e o vínculo permanecem."),
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

const VM_PAGE = 24;

export function renderVmPicker({ accent, draftId, vms, page, notice: note, chosen }) {
  const pages = Math.max(1, Math.ceil(vms.length / VM_PAGE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = vms.slice(safePage * VM_PAGE, safePage * VM_PAGE + VM_PAGE);
  const lines = [
    "## Escolha a VM",
    "A lista é da assinatura Azure. VMs já vinculadas a outro cliente não aparecem.",
    chosen || "Nenhuma VM escolhida ainda. O Resource ID manual continua opcional no próximo passo.",
  ];
  if (note) lines.push(note);
  const options = [{ label: "Nenhuma VM agora", value: "none", description: "Segue sem Resource ID, ou cole um no próximo passo." }];
  for (const vm of slice) {
    options.push({
      label: vm.name.slice(0, 100),
      value: vmOptionValue(vm.id),
      description: `${vm.resourceGroup} · ${vm.size || "tamanho não informado"} · ${vm.location || "região não informada"}${vm.own ? " · deste cliente" : ""}`.slice(0, 100),
    });
  }
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(lines.join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`atlas:admin:vmpick:${draftId}`).setPlaceholder("Escolha a VM").setMinValues(1).setMaxValues(1).addOptions(options),
    ));
    if (pages > 1) {
      root.addActionRowComponents(new ActionRowBuilder().addComponents(
        press(`atlas:admin:vmpage:${safePage}:prev:${draftId}`, "Anterior", ButtonStyle.Secondary).setDisabled(safePage === 0),
        press(`atlas:admin:vmpage:${safePage}:next:${draftId}`, "Próxima", ButtonStyle.Secondary).setDisabled(safePage + 1 >= pages),
      ));
    }
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:vmdates:${draftId}`, "Continuar para as datas", ButtonStyle.Primary),
    ));
  });
}

export function renderAzureVmList({ accent, rows, page, pages }) {
  const lines = [
    `## VMs da assinatura · página ${page + 1} de ${pages}`,
    rows.length
      ? rows.map((vm) => `**${vm.name}** · ${vm.resourceGroup} · ${vm.size || "tamanho não informado"} · ${vm.location || "região não informada"} · ${vm.power || "estado não consultado"} · ${vm.clientName || "sem cliente"}`).join("\n")
      : "A assinatura não devolveu máquinas virtuais.",
  ];
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(lines.join("\n")));
    if (pages > 1) {
      root.addActionRowComponents(new ActionRowBuilder().addComponents(
        press(`atlas:admin:azurepage:${page}:prev`, "Anterior", ButtonStyle.Secondary).setDisabled(page === 0),
        press(`atlas:admin:azurepage:${page}:next`, "Próxima", ButtonStyle.Secondary).setDisabled(page + 1 >= pages),
      ));
    }
  });
}

export function renderRemoveConfirm(client, accent, emojis = {}) {
  return container(0xed4245, (root) => {
    root.addTextDisplayComponents(text(`${heading(emojis, "gavel", "Remover cliente")}\n${client.clientName} · ${client.machineName}\nO registro e as credenciais cifradas saem do banco. A VM na Azure não é apagada.`));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:remove:yes:${client.userId}`, "Remover", ButtonStyle.Danger, emojis.alerta),
      press("atlas:admin:remove:no", "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderClientList(rows, { accent, page, pages, title, emojis = {} }) {
  const lines = [heading(emojis, "member", title), rows.length ? rows.map((row) => `**${row.clientName}** · ${row.machineName} · <@${row.userId}> · ${PLAN_LABEL[row.planType] || row.planType}`).join("\n") : "Nenhum cliente encontrado."];
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(lines.join("\n")));
    if (pages > 1) {
      root.addActionRowComponents(new ActionRowBuilder().addComponents(
        press(`atlas:admin:list:prev:${page}`, "Anterior", ButtonStyle.Secondary, emojis.arrow).setDisabled(page <= 0),
        press(`atlas:admin:list:next:${page}`, "Próxima", ButtonStyle.Secondary, emojis.arrow).setDisabled(page + 1 >= pages),
      ));
    }
  });
}

export function renderRenewReview(draft, accent, emojis = {}) {
  const data = draft.payload;
  return container(accent, (root) => {
    root.addTextDisplayComponents(text([
      heading(emojis, "cash", "Renovar plano"),
      mark(emojis, "member", `Cliente: ${data.clientName}`),
      mark(emojis, "monitor", `Máquina: ${data.machineName}`),
      mark(emojis, "vip", `Plano: ${PLAN_LABEL[data.plan]}`),
      `Início: ${data.startText}`,
      `Vencimento: ${data.expiryText}`,
    ].join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:admin:renew:save:${draft.id}`, "Salvar", ButtonStyle.Success, emojis.verified),
      press(`atlas:admin:cancel:${draft.id}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}
