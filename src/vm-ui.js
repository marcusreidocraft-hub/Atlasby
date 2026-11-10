import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import { confirmationRow, panelAccent, v2Flags } from "./ui.js";
import { importKey, powerLabel, validityText } from "./vm-model.js";

function text(content) {
  return new TextDisplayBuilder().setContent(content.slice(0, 3900));
}

function blank(value, fallback = "não informado") {
  const clean = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  return clean || fallback;
}

const CATEGORIES = [
  ["energy", "Energia"],
  ["connection", "Conexão"],
  ["plan", "Plano e validade"],
  ["storage", "Armazenamento"],
  ["support", "Suporte"],
];

export function renderVmMenu(vm, { now, category = "energy", choices = [], azureConfigured = true, autoGlobal = true } = {}) {
  const state = `${powerLabel(vm.last_power)}${vm.os_label ? ` - ${vm.os_label}` : ""}`;
  const lines = [
    `# ${vm.display_name}`,
    `**Estado**\n${state}`,
    `**Conexão**\nPúblico: ${blank(vm.public_ip)}\nPrivado: ${blank(vm.private_ip)}`,
    [
      "**Configuração**",
      blank(vm.size_label, "tamanho não informado"),
      `CPU: ${blank(vm.cpu_label)}`,
      `RAM: ${blank(vm.ram_label)}`,
      `GPU: ${blank(vm.gpu_label)}`,
      `Disco do sistema: ${vm.disk_gb == null ? "não informado" : `${vm.disk_gb} GB`}`,
    ].join("\n"),
    `**Assinatura**\n${validityText(vm.validity_until, now)}`,
    azureConfigured ? "" : "Integração Azure não configurada. Dá para ver o cadastro, mas ligar, desligar e consultar a nuvem ficam indisponíveis.",
  ].filter(Boolean);
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(lines.join("\n\n")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  if (choices.length > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("atlasby:vm:pick")
          .setPlaceholder("Escolha a máquina")
          .addOptions(choices.slice(0, 25).map((item) => ({
            label: item.display_name.slice(0, 100),
            value: item.id,
            default: item.id === vm.id,
          }))),
      ),
    );
  }
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`atlasby:vm:cat:${vm.id}`)
        .setPlaceholder("Escolha uma categoria de ações")
        .addOptions(CATEGORIES.map(([value, label]) => ({ label, value, default: value === category }))),
    ),
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(categoryButtons(vm, category, autoGlobal)));
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

function categoryButtons(vm, category, autoGlobal) {
  const id = vm.id;
  if (category === "connection") {
    return [
      button(`atlasby:vm:connect:${id}`, "Conectar", ButtonStyle.Primary),
      button(`atlasby:vm:pin:${id}`, "Liberar PIN", ButtonStyle.Secondary),
      button(`atlasby:vm:creds:${id}`, "Credenciais", ButtonStyle.Secondary),
      button(`atlasby:vm:probe:${id}`, "Testar conexão", ButtonStyle.Secondary),
    ];
  }
  if (category === "plan") {
    return [
      button(`atlasby:vm:plan:${id}`, "Plano e validade", ButtonStyle.Primary),
      button(`atlasby:vm:renew:${id}`, "Pedir renovação", ButtonStyle.Secondary),
      button(`atlasby:vm:sign:${id}`, "Assinatura", ButtonStyle.Secondary),
    ];
  }
  if (category === "storage") {
    return [
      button(`atlasby:vm:storage:${id}`, "Armazenamento", ButtonStyle.Primary),
      button(`atlasby:vm:disk:${id}`, "Aumentar armazenamento", ButtonStyle.Secondary),
    ];
  }
  if (category === "support") {
    return [
      button(`atlasby:vm:support:${id}`, "Falar com a equipe", ButtonStyle.Primary),
      button(`atlasby:vm:refresh:${id}`, "Atualizar estado", ButtonStyle.Secondary),
    ];
  }
  const auto = !autoGlobal ? "Auto ligamento: bloqueado" : vm.auto_start ? "Auto ligamento: ativado" : "Auto ligamento: desativado";
  return [
    button(`atlasby:vm:power:start:${id}`, "Ligar", ButtonStyle.Success),
    button(`atlasby:vm:power:deallocate:${id}`, "Desligar", ButtonStyle.Danger),
    button(`atlasby:vm:power:restart:${id}`, "Reiniciar", ButtonStyle.Secondary),
    button(`atlasby:vm:refresh:${id}`, "Atualizar estado", ButtonStyle.Primary),
    button(`atlasby:vm:auto:${id}`, auto, ButtonStyle.Secondary),
  ];
}

function button(customId, label, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(style);
}

export function renderPowerConfirm(vm, operation) {
  const verb = operation === "restart" ? "reiniciar" : "desligar";
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(text(`# Confirmar ${verb === "reiniciar" ? "reinicialização" : "desligamento"}\nVocê está prestes a ${verb} a VM ${vm.display_name}. Confirme para continuar.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:vm:yes:${operation}:${vm.id}`, "Confirmar", ButtonStyle.Danger),
        button(`atlasby:vm:no:${vm.id}`, "Cancelar", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderPendingAzure() {
  return {
    components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text("Enviando solicitação para o Azure. Acompanhe enquanto a operação é processada."))],
    flags: v2Flags({ ephemeral: true, update: true }),
  };
}

export function renderStateNotice(vm, from, to) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(`# Estado da VM atualizado\nO estado passou de VM ${from} para VM ${to}.\n\nAtlas • VM ${vm.display_name}`));
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderConnect(vm) {
  const ip = vm.public_ip || "IP público não informado";
  const body = [
    "# Conectar pelo Moonlight",
    `IP público: ${ip}`,
    "1. Abra o Moonlight no seu aparelho.",
    "2. Adicione o computador com o IP público.",
    "3. Toque em Liberar PIN e informe o PIN que o Moonlight mostrar.",
    "4. Se a conexão falhar, use Falar com a equipe. O bot não entra na VM.",
    "Atlas • VM " + vm.display_name,
  ];
  return { components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text(body.join("\n")))], flags: v2Flags({ ephemeral: true }) };
}

export function renderCredentials(vm, secret) {
  const body = secret
    ? `# Credenciais\nUsuário: ${secret.username}\nSenha: ${secret.password}${secret.pin ? `\nPIN anotado: ${secret.pin}` : ""}\nIsto só aparece para você. Não encaminhe esta mensagem.\n\nAtlas • VM ${vm.display_name}`
    : `# Credenciais\nCredenciais desta VM ainda não foram cadastradas. Peça à administração para configurar.\n\nAtlas • VM ${vm.display_name}`;
  return { components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text(body))], flags: v2Flags({ ephemeral: true }) };
}

export function renderDiskModal(vm, maxGb = 2048) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:vm:disk:${vm.id}`)
    .setTitle("Aumentar disco do sistema")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Novo total em GB")
        .setDescription(`Maior que o atual e no máximo ${maxGb}. A equipe confirma antes.`)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("gb").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(String(maxGb).length).setPlaceholder(String(maxGb)),
        ),
    );
}

export function renderVmAdmin(state) {
  const defaults = state.defaults ?? {};
  const lines = [
    "# Máquinas",
    state.azureConfigured ? "A integração Azure está configurada." : "Integração Azure não configurada.",
    `Auto ligamento global: ${state.autoGlobal ? "ativado" : "desativado"}`,
    "**Padrões Azure**",
    `Local: ${defaults.location || "brazilsouth"}`,
    `Tamanho: ${defaults.vmSize || "Standard_NC4as_T4_v3"}`,
    `Sistema: ${defaults.osType || "Windows"}`,
    `Disco máximo: ${defaults.maxOsDiskGb || 2048} GB`,
    `Snapshot: ${defaults.snapshotId || "não definido"}`,
    `VNet: ${defaults.virtualNetwork || "não definida"}`,
    `Subnet: ${defaults.subnet || "não definida"}`,
    "Esses padrões só preenchem o cadastro. Nenhuma VM é criada na Azure agora.",
  ];
  if (!state.vms.length) lines.push("Nenhuma VM cadastrada.");
  for (const vm of state.vms.slice(0, 10)) {
    const users = state.users(vm.id).map((row) => `<@${row.user_id}>`).join(", ") || "sem cliente";
    lines.push(`**${vm.display_name}** · ${vm.resource_group}/${vm.vm_name} · ${users}`);
  }
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(lines.join("\n")))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button("atlasby:vmcfg:add", "Cadastrar VM", ButtonStyle.Primary),
        button("atlasby:vmcfg:users", "Adicionar usuário", ButtonStyle.Secondary),
        button("atlasby:vmcfg:details", "Detalhes", ButtonStyle.Secondary),
        button("atlasby:vmcfg:policy", state.autoGlobal ? "Pausar auto ligamento" : "Retomar auto ligamento", ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button("atlasby:vmcfg:validity", "Validade", ButtonStyle.Secondary),
        button("atlasby:vmcfg:secret", "Credenciais", ButtonStyle.Secondary),
        button("atlasby:vmcfg:log", "Canal de log", ButtonStyle.Secondary),
        button("atlasby:vmcfg:import", "Importar da Azure", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderUserPicker() {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("Escolha o membro do servidor. O vínculo só é gravado depois da confirmação."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("atlasby:vmcfg:pickuser").setPlaceholder("Adicionar usuário").setMinValues(1).setMaxValues(1),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderVmPicker(customId, vms, placeholder) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(placeholder))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder("Escolha a VM")
          .addOptions(vms.slice(0, 25).map((vm) => ({ label: vm.display_name.slice(0, 100), description: `${vm.resource_group}/${vm.vm_name}`.slice(0, 100), value: vm.id }))),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

function optional(customId, placeholder, max = 40) {
  return new TextInputBuilder().setCustomId(customId).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(max).setPlaceholder(placeholder);
}

function withValue(builder, value) {
  if (value) builder.setValue(String(value).slice(0, 40));
  return builder;
}

export function renderVmModal(defaults = {}) {
  return new ModalBuilder()
    .setCustomId("atlasby:modal:vm:create")
    .setTitle("Cadastrar VM")
    .addLabelComponents(
      new LabelBuilder().setLabel("Nome visível").setTextInputComponent(new TextInputBuilder().setCustomId("nome").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)),
      new LabelBuilder().setLabel("Resource group").setTextInputComponent(new TextInputBuilder().setCustomId("grupo").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(90)),
      new LabelBuilder().setLabel("Nome da VM no Azure").setTextInputComponent(new TextInputBuilder().setCustomId("vm").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64)),
      new LabelBuilder().setLabel("Sistema").setDescription("Sugestão editável. Vazio usa o padrão.").setTextInputComponent(withValue(optional("sistema", defaults.osType || "Windows", 24), defaults.osType)),
      new LabelBuilder().setLabel("Local").setDescription("Sugestão editável.").setTextInputComponent(withValue(optional("local", defaults.location || "brazilsouth", 32), defaults.location)),
    );
}

export function renderVmDetailsModal(vm, defaults = {}) {
  const size = vm.size_label || defaults.vmSize || "Standard_NC4as_T4_v3";
  const place = vm.location || defaults.location || "brazilsouth";
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:vm:details:${vm.id}`)
    .setTitle("Detalhes da VM")
    .addLabelComponents(
      new LabelBuilder().setLabel("Tamanho Azure").setTextInputComponent(withValue(optional("tamanho", size, 64), size)),
      new LabelBuilder().setLabel("Local").setTextInputComponent(withValue(optional("local", place, 32), place)),
      new LabelBuilder().setLabel("CPU").setTextInputComponent(optional("cpu", vm.cpu_label || "4", 20)),
      new LabelBuilder().setLabel("RAM").setTextInputComponent(optional("ram", vm.ram_label || "28 GB", 20)),
      new LabelBuilder().setLabel("GPU").setTextInputComponent(optional("gpu", vm.gpu_label || "Tesla T4", 40)),
    );
}

export function renderSecretModal(vm) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:vm:secret:${vm.id}`)
    .setTitle("Credenciais da VM")
    .addLabelComponents(
      new LabelBuilder().setLabel("Usuário").setTextInputComponent(new TextInputBuilder().setCustomId("usuario").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64)),
      new LabelBuilder().setLabel("Senha").setTextInputComponent(new TextInputBuilder().setCustomId("senha").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(128)),
      new LabelBuilder().setLabel("PIN").setDescription("Opcional. Não libera o PIN dentro da VM.").setTextInputComponent(optional("pin", "0000", 8)),
    );
}

export function renderValidityModal(vm) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:vm:validity:${vm.id}`)
    .setTitle("Validade da assinatura")
    .addLabelComponents(
      new LabelBuilder().setLabel("Data").setDescription("AAAA-MM-DD. Vazio remove a validade.").setTextInputComponent(optional("data", "2026-12-31", 10)),
      new LabelBuilder().setLabel("Bloquear energia vencida").setDescription("sim ou nao.").setTextInputComponent(new TextInputBuilder().setCustomId("bloquear").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(vm.block_when_expired ? "sim" : "nao")),
    );
}

export function renderVmLogPicker() {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("Canal privado. @everyone não pode ver. O registro não leva senha nem PIN."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("atlasby:vmcfg:logchannel")
          .setPlaceholder("Canal privado de log")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderUnlinkPicker(vm, users) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(`Remover um cliente de ${vm.display_name}.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`atlasby:vmcfg:unlink:${vm.id}`)
          .setPlaceholder("Escolha o cliente")
          .addOptions(users.slice(0, 25).map((row) => ({ label: row.user_id, value: row.user_id }))),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderAzureWait() {
  return {
    components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text("Buscando detalhes na Azure…"))],
    flags: v2Flags({ ephemeral: true, update: true }),
  };
}

export function renderImportList({ page, pages, total, hidden, group, groupToken = "all", groups, options }) {
  const lines = [
    "# Importar da Azure",
    `Página ${page + 1} de ${pages}. ${total} máquina(s) disponível(is).`,
    hidden ? `${hidden} já vinculada(s) foram ocultadas.` : "",
    group ? `Filtro: ${group}` : "Filtro: todos os resource groups.",
    "A lista só lê a assinatura. Nenhuma VM é criada ou alterada.",
  ].filter(Boolean);
  const container = new ContainerBuilder().setAccentColor(0x57f287).addTextDisplayComponents(text(lines.join("\n")));
  if (groups.length > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("atlasby:vmcfg:importfilter")
          .setPlaceholder("Filtrar por resource group")
          .addOptions([
            { label: "Todos os grupos", value: "all", default: !group },
            ...groups.slice(0, 24).map((name) => ({
              label: name.slice(0, 100),
              value: importKey("group", name),
              default: name === group,
            })),
          ]),
      ),
    );
  }
  if (options.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("atlasby:vmcfg:importpick")
          .setPlaceholder("Escolha a VM da assinatura")
          .addOptions(options),
      ),
    );
  }
  if (pages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:vmcfg:importpage:${Math.max(0, page - 1)}:${groupToken}`, "Anterior", ButtonStyle.Secondary).setDisabled(page === 0),
        button(`atlasby:vmcfg:importpage:${Math.min(pages - 1, page + 1)}:${groupToken}`, "Próxima", ButtonStyle.Secondary).setDisabled(page >= pages - 1),
      ),
    );
  }
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderImportSummary(details, { userLabel = "ninguém", key }) {
  const lines = [
    `# ${details.name}`,
    `Grupo: ${details.resourceGroup}`,
    `Região: ${details.location || "não informada"}`,
    `Tamanho: ${details.size || "não informado"}`,
    `Sistema: ${details.osType || "não informado"}`,
    `Prioridade: ${details.priority || "Regular"}`,
    `Estado: ${details.powerState || "desconhecido"}`,
    `IP público: ${details.publicIp || "não informado"}`,
    `IP privado: ${details.privateIp || "não informado"}`,
    `Disco do SO: ${details.diskGb == null ? "não informado" : `${details.diskGb} GB`}`,
    `CPU: ${details.cpu || "não informado"}`,
    `RAM: ${details.ram || "não informado"}`,
    `GPU: ${details.gpu || "não informado"}`,
    `Cliente: ${userLabel}`,
    "Nada é gravado até a confirmação. A Azure não é alterada.",
  ];
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(lines.join("\n")))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:vmcfg:importuser:${key}`, "Adicionar usuário", ButtonStyle.Primary),
        button(`atlasby:vmcfg:importvalidity:${key}`, "Validade", ButtonStyle.Secondary),
        button(`atlasby:vmcfg:importsecret:${key}`, "Credenciais", ButtonStyle.Secondary),
        button(`atlasby:vmcfg:importsave:${key}`, "Confirmar", ButtonStyle.Success),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderImportUserPicker(key) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("Escolha o cliente desta VM. O vínculo só entra depois da confirmação."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`atlasby:vmcfg:importuserpick:${key}`).setPlaceholder("Adicionar usuário").setMinValues(1).setMaxValues(1),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderImportValidityModal(key) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:vm:importvalidity:${key}`)
    .setTitle("Validade da importação")
    .addLabelComponents(
      new LabelBuilder().setLabel("Data").setDescription("AAAA-MM-DD. Vazio deixa sem validade.").setTextInputComponent(optional("data", "2026-12-31", 10)),
      new LabelBuilder().setLabel("Bloquear energia vencida").setDescription("sim ou nao.").setTextInputComponent(new TextInputBuilder().setCustomId("bloquear").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue("sim")),
    );
}

export function renderImportSecretModal(key) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:vm:importsecret:${key}`)
    .setTitle("Credenciais da importação")
    .addLabelComponents(
      new LabelBuilder().setLabel("Usuário").setTextInputComponent(new TextInputBuilder().setCustomId("usuario").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64)),
      new LabelBuilder().setLabel("Senha").setTextInputComponent(new TextInputBuilder().setCustomId("senha").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(128)),
      new LabelBuilder().setLabel("PIN").setDescription("Opcional.").setTextInputComponent(optional("pin", "0000", 8)),
    );
}

export function renderVmConfirm(summary, confirmationId) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(summary))
    .addActionRowComponents(confirmationRow(confirmationId));
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}
