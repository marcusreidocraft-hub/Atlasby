import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { panelAccent, v2Flags } from "./ui.js";
import { methodKind, methodLabel } from "./entra-model.js";
import { importKey } from "./vm-model.js";

function text(content) {
  return new TextDisplayBuilder().setContent(String(content).slice(0, 3900));
}

function button(customId, label, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(style);
}

export function renderEntraWait() {
  return {
    components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text("Consultando o Microsoft Entra…"))],
    flags: v2Flags({ update: true }),
  };
}

export function renderEntraList({ users, page, search, more }) {
  const lines = [
    "# Contas Azure",
    "Somente o dono ou um administrador do bot. Contas pessoais da Microsoft, fora deste tenant, não aparecem.",
    search ? `Busca: ${search}` : "Busca: todas as contas.",
    `Página ${page + 1}${more ? " · há mais resultados" : ""}.`,
    users.length
      ? users.slice(0, 25).map((user) => `**${user.displayName || "sem nome"}** · ${user.userPrincipalName || "sem UPN"} · ${user.mail || "sem e-mail"} · ${user.accountEnabled === false ? "bloqueada" : "ativa"}`).join("\n")
      : "Nenhuma conta encontrada.",
  ];
  const container = new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text(lines.join("\n")));
  if (users.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("atlasby:entra:pick")
          .setPlaceholder("Escolha a conta")
          .addOptions(users.slice(0, 25).map((user) => ({
            label: String(user.displayName || user.userPrincipalName).slice(0, 100),
            description: `${user.userPrincipalName || user.mail || "sem e-mail"} · ${user.accountEnabled === false ? "bloqueada" : "ativa"}`.slice(0, 100),
            value: user.id,
          }))),
      ),
    );
  }
  const token = search ? Buffer.from(search).toString("base64url") : "all";
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`atlasby:entra:page:${Math.max(0, page - 1)}:${token}`, "Anterior", ButtonStyle.Secondary).setDisabled(page === 0),
      button(`atlasby:entra:page:${page + 1}:${token}`, "Próxima", ButtonStyle.Secondary).setDisabled(!more),
      button("atlasby:entra:search", "Buscar", ButtonStyle.Primary),
    ),
  );
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderEntraSearchModal() {
  return new ModalBuilder()
    .setCustomId("atlasby:modal:entra:search")
    .setTitle("Buscar conta")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Nome ou e-mail")
        .setDescription("Até 40 caracteres.")
        .setTextInputComponent(new TextInputBuilder().setCustomId("busca").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)),
    );
}

export function renderEntraAccount(user, links = []) {
  const mails = [user.mail, ...(user.otherMails ?? [])].filter(Boolean);
  const lines = [
    `# ${user.displayName || "Conta"}`,
    `Entrada: ${user.userPrincipalName || "não informado"}`,
    `E-mail: ${user.mail || "não informado"}`,
    `Outros e-mails: ${mails.filter((mail) => mail !== user.mail).join(", ") || "nenhum"}`,
    `Estado: ${user.accountEnabled === false ? "bloqueada" : "ativa"}`,
    links.length ? `Vínculos: ${links.map((link) => link.user_principal_name).join(", ")}` : "Sem vínculo com VM.",
  ];
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(lines.join("\n")))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:entra:pass:${user.id}`, "Gerar senha", ButtonStyle.Danger),
        button(`atlasby:entra:passtype:${user.id}`, "Digitar senha", ButtonStyle.Secondary),
        button(`atlasby:entra:methods:${user.id}`, "Remover autenticação", ButtonStyle.Danger),
        button(`atlasby:entra:link:${user.id}`, "Vincular VM", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderPasswordConfirm(user) {
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(text(`# Redefinir senha\nUma senha forte será gerada para ${user.userPrincipalName}. Ela aparece uma única vez, só para você. O padrão não força troca no próximo login.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:entra:yespass:${user.id}:0`, "Confirmar", ButtonStyle.Danger),
        button(`atlasby:entra:yespass:${user.id}:1`, "Confirmar e forçar troca", ButtonStyle.Danger),
        button(`atlasby:entra:open:${user.id}`, "Cancelar", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderPasswordOnce(user, password, force) {
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(text(`# Senha nova\n${user.userPrincipalName}\n\`${password}\`\nForçar troca: ${force ? "sim" : "não"}.\nCopie agora. Ela não será mostrada de novo nem registrada.`));
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderPasswordModal(userId) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:entra:password:${userId}`)
    .setTitle("Nova senha")
    .addLabelComponents(
      new LabelBuilder().setLabel("Senha").setDescription("12 a 64 caracteres, com letras, número e símbolo.").setTextInputComponent(new TextInputBuilder().setCustomId("senha").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(12).setMaxLength(64)),
      new LabelBuilder().setLabel("Forçar troca").setDescription("sim ou nao. Padrão nao.").setTextInputComponent(new TextInputBuilder().setCustomId("forcar").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue("nao")),
    );
}

export function renderMethods(user, methods) {
  const removable = methods.filter((method) => methodKind(method["@odata.type"]) !== "password");
  const lines = [
    `# Autenticação · ${user.userPrincipalName}`,
    removable.length ? removable.map((method) => `• ${methodLabel(method)}`).join("\n") : "Não há métodos além da senha.",
    "Remover o método padrão pode exigir apagar os outros antes.",
  ];
  const container = new ContainerBuilder().setAccentColor(0xed4245).addTextDisplayComponents(text(lines.join("\n")));
  if (removable.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`atlasby:entra:method:${user.id}`)
          .setPlaceholder("Escolha um método")
          .addOptions(removable.slice(0, 25).map((method) => ({
            label: methodLabel(method).slice(0, 100),
            value: importKey(user.id, method.id).slice(0, 16),
          }))),
      ),
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:entra:all:${user.id}`, "Remover todos", ButtonStyle.Danger),
      ),
    );
  }
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderMethodsConfirm(user) {
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(text(`# Remover autenticação\nTodos os métodos que não são senha serão apagados de ${user.userPrincipalName}. A senha da conta permanece. Encerrar sessões desconecta os logins atuais.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:entra:yesall:${user.id}`, "Remover todos", ButtonStyle.Danger),
        button(`atlasby:entra:yesallout:${user.id}`, "Remover e encerrar sessões", ButtonStyle.Danger),
        button(`atlasby:entra:methods:${user.id}`, "Cancelar", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderMethodConfirm(user, method) {
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(text(`# Remover autenticação\n${methodLabel(method)} de ${user.userPrincipalName}. A senha da conta não é removida.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:entra:yesmethod:${user.id}:${importKey(user.id, method.id).slice(0, 16)}`, "Confirmar", ButtonStyle.Danger),
        button(`atlasby:entra:methods:${user.id}`, "Cancelar", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderEntraVmPicker(userId, vms) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text("Escolha a VM deste servidor para vincular à conta do Entra. Nada é gravado até a confirmação."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`atlasby:entra:link:${userId}`)
          .setPlaceholder("Escolha a VM")
          .addOptions(vms.slice(0, 25).map((vm) => ({
            label: vm.display_name.slice(0, 100),
            description: `${vm.resource_group}/${vm.vm_name}`.slice(0, 100),
            value: vm.id,
          }))),
      ),
    );
  return { components: [container], flags: v2Flags({ update: true }) };
}

export function renderLinkConfirm(user, vm) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(`Vincular ${user.userPrincipalName} à VM ${vm.display_name}.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`atlasby:entra:yeslink:${user.id}:${vm.id}`, "Confirmar", ButtonStyle.Danger),
        button(`atlasby:entra:open:${user.id}`, "Cancelar", ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ update: true }) };
}
