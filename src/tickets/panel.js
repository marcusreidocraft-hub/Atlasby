import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, LabelBuilder, ModalBuilder, SectionBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TICKET_CATEGORIES, ticketEmojiObject, ticketHours, ticketMark } from "./catalog.js";
import { separator, text, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { formatBrl } from "../loja/products.js";

function mark(settings, slot) {
  return ticketMark(slot, settings?.ticket?.emojis);
}

export function renderTicketDesk(settings) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(
    text(`## ${mark(settings, "titulo")} Central de atendimento`),
    text("Escolha a categoria que melhor descreve o que você precisa."),
  );
  root.addSeparatorComponents(separator());
  for (const category of Object.values(TICKET_CATEGORIES)) {
    const button = new ButtonBuilder()
      .setCustomId(`atlas:ticket:open:${category.id}`)
      .setLabel("Abrir")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(ticketEmojiObject(mark(settings, "abrir")));
    root.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`${mark(settings, category.id)} **${category.title}**\n${category.description}`))
        .setButtonAccessory(button),
    );
  }
  root.addTextDisplayComponents(text(`-# ${mark(settings, "horario")} ${ticketHours(settings)}`));
  return { components: [root], flags: V2 };
}

export function ticketModal(categoryId) {
  const category = TICKET_CATEGORIES[categoryId];
  const field = new TextInputBuilder()
    .setCustomId("motivo")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(1000)
    .setPlaceholder("Descreva o motivo do ticket...");
  return new ModalBuilder()
    .setCustomId(`atlas:modal:topen:${categoryId}`)
    .setTitle(`Ticket • ${category.title}`.slice(0, 45))
    .addLabelComponents(new LabelBuilder().setLabel("Como podemos ajudar?").setDescription("Explique sua solicitação com os detalhes importantes.").setTextInputComponent(field));
}

export function renderTicketCreated(url, settings) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(text(`## ${mark(settings, "titulo")} Ticket criado\nSeu atendimento já está disponível.`));
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Acessar").setURL(url);
  const emoji = ticketEmojiObject(mark(settings, "acessar"));
  if (emoji) button.setEmoji(emoji);
  root.addActionRowComponents(new ActionRowBuilder().addComponents(button));
  return { components: [root], flags: V2_EPHEMERAL };
}

export function renderTicketWelcome(ticket, settings, supportRoleId) {
  const category = TICKET_CATEGORIES[ticket.category];
  const quote = String(ticket.reason).split("\n").map((line) => `> ${line}`).join("\n");
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(text([
    `## ${mark(settings, category.id)} ${category.title} #${ticket.number}`,
    `<@${ticket.userId}>${supportRoleId ? ` • <@&${supportRoleId}>` : ""}`,
    `### ${mark(settings, "motivo")} Motivo`,
    quote,
  ].join("\n")));
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(new ActionRowBuilder().addComponents(adminSelect(ticket.id, settings)));
  return { components: [root], flags: V2 };
}

export function adminSelect(ticketId, settings) {
  const option = (value, label, description, slot) => ({
    label,
    value,
    description,
    emoji: ticketEmojiObject(mark(settings, slot)),
  });
  return new StringSelectMenuBuilder()
    .setCustomId(`atlas:ticket:menu:${ticketId}`)
    .setPlaceholder("Ações administrativas")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      option("chamar", "Chamar cliente", "Notificar no PV e enviar um ping temporário", "chamar"),
      option("fechar", "Fechar ticket", "Encerra o atendimento e guarda a transcrição", "fechar"),
      option("voz", "Criar canal de voz", "Abre uma sala de voz para este ticket", "voz"),
      option("sem-voz", "Remover canal de voz", "Apaga a sala de voz deste ticket", "voz"),
      option("add", "Adicionar membro", "Libera o canal para outra pessoa", "adicionar"),
      option("rem", "Remover membro", "Tira o acesso de uma pessoa", "remover"),
      option("pix", "Gerar pagamento", "Criar uma cobrança PIX", "pagamento"),
    );
}

export function renderTicketDenied(settings) {
  const root = new ContainerBuilder().setAccentColor(0xed4245);
  root.addTextDisplayComponents(text(`## ${mark(settings, "erro")} Algo deu errado\nEsta ação é restrita à equipe.`));
  return { components: [root], flags: V2_EPHEMERAL };
}

export function renderPixCharge({ cents, description, copiaECola, staffId, settings }) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(text([
    `## ${mark(settings, "pagamento")} Cobrança PIX Gerada`,
    `**Valor:** ${formatBrl(cents)}`,
    `**Descrição:** ${description}`,
    "**Copia e Cola:**",
    `\`\`\`\n${copiaECola}\n\`\`\``,
    `Gerado por <@${staffId}> · PIX copia e cola válido para qualquer banco`,
  ].join("\n")));
  return { components: [root], flags: V2 };
}

export function paymentModal(ticketId) {
  const amount = new TextInputBuilder().setCustomId("valor").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12).setPlaceholder("10,00");
  const description = new TextInputBuilder().setCustomId("descricao").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("Descrição da cobrança");
  return new ModalBuilder()
    .setCustomId(`atlas:modal:tpay:${ticketId}`)
    .setTitle("Gerar pagamento")
    .addLabelComponents(
      new LabelBuilder().setLabel("Valor").setDescription("Em reais, como 10,00.").setTextInputComponent(amount),
      new LabelBuilder().setLabel("Descrição").setTextInputComponent(description),
    );
}

export function closeTicketModal(ticketId) {
  const field = new TextInputBuilder().setCustomId("motivo").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(180).setPlaceholder("Motivo do encerramento");
  return new ModalBuilder()
    .setCustomId(`atlas:modal:tclose:${ticketId}`)
    .setTitle("Fechar ticket")
    .addLabelComponents(new LabelBuilder().setLabel("Motivo").setDescription("A transcrição vai para o canal de logs.").setTextInputComponent(field));
}
