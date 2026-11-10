import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  RoleSelectMenuBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import { CATALOG_INTRO, CATALOG_SUBTITLE, PERIOD_NAMES, PRODUCT_LINE, PRODUCT_UI, formatBrl, offerState, publicPlanLine, reservationLine } from "./plans.js";
import { applyGreeting } from "./style.js";

export const V2_FLAG = MessageFlags.IsComponentsV2;
const TOP_LEVEL = new Set([1, 9, 10, 12, 13, 14, 17]);
const CONTAINER_CHILDREN = new Set([1, 9, 10, 12, 13, 14]);
const SELECT_TYPES = new Set([3, 5, 6, 7, 8]);

const DEFAULT_ACCENT = 0x5865f2;
let panelAccentValue = DEFAULT_ACCENT;

export function setPanelAccent(value) {
  panelAccentValue = Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : DEFAULT_ACCENT;
}

export function panelAccent(style) {
  return Number.isInteger(style?.accent_color) ? style.accent_color : panelAccentValue;
}

export function v2Flags({ ephemeral = true, update = false } = {}) {
  if (update) return V2_FLAG;
  return ephemeral ? V2_FLAG | MessageFlags.Ephemeral : V2_FLAG;
}

export function confirmationRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`atlasby:confirm:${id}`).setLabel("Confirmar").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`atlasby:cancel:${id}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
}

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function renderNotice(content, { ephemeral = true, update = false, row = null, accent = panelAccent() } = {}) {
  const container = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(text(content));
  if (row) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addActionRowComponents(row);
  }
  return { components: [container], flags: v2Flags({ ephemeral, update }) };
}

function periodOption(plan) {
  const period = PERIOD_NAMES[plan.code] ?? plan.label;
  const openable = offerState(plan).openable;
  const price = plan.price_cents == null ? "sem preço" : formatBrl(plan.price_cents);
  return {
    label: `${period}${openable ? "" : " · Esgotado"}`.slice(0, 100),
    value: plan.code,
    description: `${plan.duration_days} dias · ${openable ? price : "indisponível"}`.slice(0, 100),
  };
}

export function renderCatalog(plans, style = null) {
  const heading = `${style?.catalog_emoji ? `${style.catalog_emoji} ` : ""}${style?.catalog_heading || PRODUCT_LINE}`;
  const intro = style?.catalog_intro || CATALOG_INTRO;
  const container = new ContainerBuilder().setAccentColor(0x2b2d31);
  if (style?.catalog_banner_url) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`# ${heading}\n${intro}`))
        .setThumbnailAccessory(new ThumbnailBuilder({ description: "Logo do catálogo" }).setURL(style.catalog_banner_url)),
    );
  } else {
    container.addTextDisplayComponents(text(`# ${heading}\n${intro}`));
  }
  container.addTextDisplayComponents(text(CATALOG_SUBTITLE));
  for (const sku of ["t4-4", "t4-8", "t4-16"]) {
    const items = plans.filter((plan) => plan.sku === sku);
    if (!items.length) continue;
    const ui = PRODUCT_UI[sku];
    const title = style?.[`title_${sku.replace("-", "_")}`] || ui.title;
    const emoji = style?.[`emoji_${sku.replace("-", "_")}`] || "";
    const placeholder = (style?.[`placeholder_${sku.replace("-", "_")}`] || ui.placeholder).slice(0, 150);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`atlasby:catalog:period:${sku}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(items.map(periodOption));
    if (!items.some((plan) => offerState(plan).openable)) menu.setDisabled(true);
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(text(`${emoji ? `${emoji} ` : ""}**${title}**`))
      .addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  }
  const extras = [];
  if (style?.games_text) {
    const games = new ButtonBuilder().setCustomId("atlasby:catalog:games").setLabel("Jogos incompatíveis").setStyle(ButtonStyle.Secondary);
    extras.push(style.games_emoji ? games.setEmoji(style.games_emoji) : games);
  }
  if (style?.faq_text) {
    const faq = new ButtonBuilder().setCustomId("atlasby:catalog:faq").setLabel("FAQ").setStyle(ButtonStyle.Secondary);
    extras.push(style.faq_emoji ? faq.setEmoji(style.faq_emoji) : faq);
  }
  if (extras.length) container.addActionRowComponents(new ActionRowBuilder().addComponents(extras));
  return { components: [container], flags: v2Flags({ ephemeral: false }) };
}

function emojiButton(customId, label, style, emoji) {
  const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  return emoji ? button.setEmoji(emoji) : button;
}

export function renderTicket(ticket, { avatarUrl, staffText, style = null }) {
  const claimed = ticket.claimed_by
    ? `Responsável: <@${ticket.claimed_by}> <t:${Math.floor(ticket.claimed_at / 1000)}:F>`
    : "Ninguém assumiu este ticket ainda.";
  const greeting = applyGreeting(style?.ticket_greeting, {
    produto: ticket.product_name,
    duracao: ticket.label,
    preco: reservationLine(ticket),
    usuario: `<@${ticket.opener_id}>`,
    equipe: staffText,
  });
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      text(
        [
          `# ${style?.ticket_title_emoji ? `${style.ticket_title_emoji} ` : ""}Ticket de compra criado`,
          `**${ticket.product_name}**`,
          reservationLine(ticket),
          `Aberto <t:${Math.floor(ticket.opened_at / 1000)}:F>`,
          `Cliente <@${ticket.opener_id}>`,
          claimed,
          greeting,
          "Pedido registrado neste ticket. Não houve cobrança nem provisionamento.",
        ].filter(Boolean).join("\n"),
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder({ description: "Avatar de quem abriu o ticket" }).setURL(avatarUrl));
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addSectionComponents(section);
  if (style?.ticket_banner_url) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(style.ticket_banner_url)),
    );
  }
  container
    .addTextDisplayComponents(text(staffText))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        emojiButton(`atlasby:ticket:claim:${ticket.id}`, "Assumir", ButtonStyle.Primary, style?.claim_emoji),
        emojiButton(`atlasby:ticket:unclaim:${ticket.id}`, "Liberar", ButtonStyle.Secondary, style?.unclaim_emoji),
        emojiButton(`atlasby:ticket:transcript:${ticket.id}`, "Transcrição", ButtonStyle.Secondary, style?.transcript_emoji),
        emojiButton(`atlasby:ticket:close:${ticket.id}`, "Fechar", ButtonStyle.Danger, style?.close_emoji),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: false }) };
}

export function renderAdmin(state) {
  const lines = [
    "# Configuração",
    `Canal de logs: ${state.logChannelId ? `<#${state.logChannelId}>` : "não definido"}`,
    "Alterações de canal, preço e disponibilidade só são gravadas depois da confirmação.",
    ...state.plans.map((plan) => `${plan.product_name} · ${publicPlanLine(plan)}`),
  ];
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(lines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:cfg:logs").setLabel("Canal de logs").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("atlasby:cfg:admins").setLabel("Administradores").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:tickets").setLabel("Tickets").setStyle(ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:cfg:product:t4-4").setLabel("4 vCPU").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:product:t4-8").setLabel("8 vCPU").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:product:t4-16").setLabel("16 vCPU").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:appearance").setLabel("Aparência").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:forms").setLabel("Formulários").setStyle(ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:cfg:vms").setLabel("Máquinas").setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderProductAdmin(plans) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("Escolha a duração. O próximo passo pede preço e disponível ou esgotado, e só grava depois do resumo."));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      plans.slice(0, 5).map((plan) =>
        new ButtonBuilder()
          .setCustomId(`atlasby:cfg:duration:${plan.sku}:${plan.code}`)
          .setLabel(publicPlanLine(plan).slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      ),
    ),
  );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderAppearance() {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(
      text("Aparência deste servidor. Nada é gravado até a prévia ser confirmada. Não altera o perfil do bot."),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:cfg:style:catalog").setLabel("Visual do catálogo").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("atlasby:cfg:style:ticket").setLabel("Mensagem do ticket").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:style:buttons").setLabel("Emojis dos botões").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:style:products").setLabel("Textos dos planos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:cfg:style:info").setLabel("FAQ e jogos").setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

function optionalInput(customId, placeholder) {
  return new TextInputBuilder().setCustomId(customId).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setPlaceholder(placeholder);
}

export function styleModal(kind) {
  if (kind === "catalog") {
    return new ModalBuilder()
      .setCustomId("atlasby:modal:style:catalog")
      .setTitle("Visual do catálogo")
      .addLabelComponents(
        new LabelBuilder().setLabel("Emoji do catálogo").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("catalogo_emoji", "🙂")),
        new LabelBuilder().setLabel("Texto introdutório").setDescription("Vazio volta ao texto padrão.").setTextInputComponent(new TextInputBuilder().setCustomId("catalogo_intro").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200).setPlaceholder("Selecione o plano e o período para abrir um ticket.")),
        new LabelBuilder().setLabel("Banner do catálogo").setDescription("URL HTTPS. Vazio remove.").setTextInputComponent(optionalInput("catalogo_banner", "https://")),
        new LabelBuilder().setLabel("Emoji de abrir ticket").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("abrir_emoji", "🎫")),
      );
  }
  if (kind === "ticket") {
    return new ModalBuilder()
      .setCustomId("atlasby:modal:style:ticket")
      .setTitle("Mensagem do ticket")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("Saudação")
          .setDescription("Marcadores: {produto} {duracao} {preco} {usuario} {equipe}.")
          .setTextInputComponent(
            new TextInputBuilder().setCustomId("saudacao").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setPlaceholder("Olá {usuario}"),
          ),
        new LabelBuilder().setLabel("Emoji do título").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("titulo_emoji", "🧾")),
        new LabelBuilder().setLabel("Banner do ticket").setDescription("URL HTTPS. Vazio remove.").setTextInputComponent(optionalInput("ticket_banner", "https://")),
      );
  }
  return new ModalBuilder()
    .setCustomId("atlasby:modal:style:buttons")
    .setTitle("Emojis dos botões")
    .addLabelComponents(
      new LabelBuilder().setLabel("Assumir").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("assumir", "✅")),
      new LabelBuilder().setLabel("Liberar").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("liberar", "↩️")),
      new LabelBuilder().setLabel("Transcrição").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("transcricao", "📄")),
      new LabelBuilder().setLabel("Fechar").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("fechar", "🔒")),
    );
}

export function renderProductTexts() {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x57f287)
        .addTextDisplayComponents(text("Título, emoji e placeholder de cada seletor. O texto padrão é neutro."))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("atlasby:cfg:copy:t4-4").setLabel("Textos 4 vCPU").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("atlasby:cfg:copy:t4-8").setLabel("Textos 8 vCPU").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("atlasby:cfg:copy:t4-16").setLabel("Textos 16 vCPU").setStyle(ButtonStyle.Secondary),
          ),
        ),
    ],
    flags: v2Flags({ ephemeral: true, update: true }),
  };
}

export function productCopyModal(sku) {
  const ui = PRODUCT_UI[sku];
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:copy:${sku}`)
    .setTitle(`Textos · ${ui.title}`)
    .addLabelComponents(
      new LabelBuilder().setLabel("Título acima do seletor").setDescription("Vazio volta ao texto neutro.").setTextInputComponent(optionalInput("titulo", ui.title)),
      new LabelBuilder().setLabel("Emoji do seletor").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("emoji", "🖥️")),
      new LabelBuilder().setLabel("Placeholder do seletor").setDescription("Vazio volta ao texto padrão.").setTextInputComponent(optionalInput("placeholder", ui.placeholder)),
    );
}

export function infoModal() {
  return new ModalBuilder()
    .setCustomId("atlasby:modal:style:info")
    .setTitle("FAQ e jogos")
    .addLabelComponents(
      new LabelBuilder().setLabel("Texto do FAQ").setDescription("Vazio oculta o botão. Sem links inventados.").setTextInputComponent(new TextInputBuilder().setCustomId("faq").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
      new LabelBuilder().setLabel("Emoji do FAQ").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("faq_emoji", "❓")),
      new LabelBuilder().setLabel("Texto de jogos incompatíveis").setDescription("Vazio oculta o botão.").setTextInputComponent(new TextInputBuilder().setCustomId("jogos").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
      new LabelBuilder().setLabel("Emoji de jogos").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(optionalInput("jogos_emoji", "🎮")),
    );
}

export function renderStylePreview(style, confirmationId) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(
      text(`# ${style.catalogEmoji ? `${style.catalogEmoji} ` : ""}${style.catalogHeading || "Atlas"}\nPrévia. Nada foi gravado até confirmar.`),
    );
  if (style.catalogBannerUrl || style.ticketBannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(style.catalogBannerUrl || style.ticketBannerUrl),
      ),
    );
  }
  if (style.ticketGreeting) {
    container.addTextDisplayComponents(
      text(applyGreeting(style.ticketGreeting, {
        produto: "Tesla T4 · 4 vCPU",
        duracao: "7 dias",
        preco: "R$35,90",
        usuario: "cliente",
        equipe: "equipe",
      })),
    );
  }
  const sample = new ButtonBuilder().setCustomId("atlasby:preview:open").setLabel("Abrir ticket").setStyle(ButtonStyle.Secondary).setDisabled(true);
  container.addActionRowComponents(new ActionRowBuilder().addComponents(style.openEmoji ? sample.setEmoji(style.openEmoji) : sample));
  if (confirmationId) container.addActionRowComponents(confirmationRow(confirmationId));
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function offerModal(plan) {
  const price = plan.price_cents == null ? "" : (plan.price_cents / 100).toFixed(2).replace(".", ",");
  const priceInput = new TextInputBuilder().setCustomId("preco").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(16).setPlaceholder(price || "sem preço");
  if (price) priceInput.setValue(price);
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:offer:${plan.sku}:${plan.code}`)
    .setTitle(`${plan.product_name} · ${plan.label}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel("Preço em reais").setDescription("Exemplo: 35,90. Vazio mantém o preço atual.").setTextInputComponent(priceInput),
      new LabelBuilder()
        .setLabel("Disponibilidade")
        .setDescription("Escreva disponivel ou esgotado.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("disponibilidade")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(12)
            .setValue(plan.available ? "disponivel" : "esgotado"),
        ),
    );
}

export function renderTicketSettings() {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("Categoria, cargo da equipe e canal privado da transcrição. Nada é gravado até a confirmação."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("atlasby:cfg:category")
          .setPlaceholder("Categoria dos tickets")
          .setChannelTypes(ChannelType.GuildCategory)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId("atlasby:cfg:staff").setPlaceholder("Cargo da equipe").setMinValues(1).setMaxValues(1),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("atlasby:cfg:transcript")
          .setPlaceholder("Canal privado da transcrição")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function stockModal(sku, code, label) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:stock:${sku}:${code}`)
    .setTitle(`Estoque · ${label}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Estoque")
        .setDescription("Inteiro maior ou igual a zero.")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("estoque").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(7).setPlaceholder("0"),
        ),
    );
}

export function renderLogPicker({ update = false } = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("Escolha o canal de texto. Nada é gravado até você confirmar."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("atlasby:cfg:logselect")
          .setPlaceholder("Canal de texto")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update }) };
}

export function renderAdminPicker(admins, { update = false } = {}) {
  const listed = admins.length ? admins.map((row) => `<@${row.user_id}>`).join(", ") : "nenhum administrador extra";
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(`O dono do servidor já administra. Incluídos: ${listed}\nA inclusão só vale depois da confirmação.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("atlasby:cfg:adminadd")
          .setPlaceholder("Incluir administrador")
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  if (admins.length) {
    const remove = new StringSelectMenuBuilder()
      .setCustomId("atlasby:cfg:admindel")
      .setPlaceholder("Remover administrador")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(admins.slice(0, 25).map((row) => ({ label: row.user_id, value: row.user_id })));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(remove));
  }
  return { components: [container], flags: v2Flags({ ephemeral: true, update }) };
}

export function priceModal(sku, code, label) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:price:${sku}:${code}`)
    .setTitle(`Preço · ${label}`.slice(0, 45))
    .addTextDisplayComponents(text("Informe centavos, como 3590, ou reais com dois decimais, como 35,90. Nada é gravado neste passo."))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Preço")
        .setDescription("Centavos ou reais com dois decimais.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("preco")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(16)
            .setPlaceholder("35,90"),
        ),
    );
}

export function collectText(component, parts) {
  if (!component || typeof component !== "object") return;
  if (typeof component.content === "string") parts.push(component.content);
  const children = component.components ?? [];
  for (const child of children) collectText(child, parts);
}

export function textOf(payload) {
  const parts = [];
  for (const component of payload?.components ?? []) collectText(component.toJSON?.() ?? component, parts);
  return parts.join("\n");
}

export function walkComponents(component, visit) {
  if (!component || typeof component !== "object") return;
  visit(component);
  for (const child of component.components ?? []) walkComponents(child, visit);
}

export function validateV2Message(payload) {
  const errors = [];
  if (payload == null || typeof payload !== "object") return { ok: false, errors: ["payload"] };
  if (payload.content != null && payload.content !== "") errors.push("content");
  if (Array.isArray(payload.embeds) && payload.embeds.length > 0) errors.push("embeds");
  if (payload.poll != null) errors.push("poll");
  if (Array.isArray(payload.sticker_ids) && payload.sticker_ids.length > 0) errors.push("stickers");
  const flags = Number(payload.flags ?? 0);
  if ((flags & V2_FLAG) !== V2_FLAG) errors.push("flag");
  const components = Array.isArray(payload.components) ? payload.components.map((item) => item.toJSON?.() ?? item) : [];
  if (components.length < 1) errors.push("components");
  const ids = new Set();
  let count = 0;
  const visit = (component, { insideContainer = false, inActionRow = false } = {}) => {
    count += 1;
    if (count > 40) errors.push("limit");
    const type = component.type;
    if (!Number.isInteger(type)) errors.push("type");
    if (!insideContainer && !inActionRow && !TOP_LEVEL.has(type)) errors.push(`top:${type}`);
    if (type === 17 && insideContainer) errors.push("nested-container");
    if (type === 10) {
      if (typeof component.content !== "string" || component.content.length < 1 || component.content.length > 4000) {
        errors.push("text");
      }
    }
    if (type === 2) {
      if (component.sku_id || component.style === 6) errors.push("premium");
      if (component.style === 5) {
        if (!component.url || component.custom_id) errors.push("link-button");
      } else if (typeof component.custom_id !== "string" || component.custom_id.length < 1 || component.custom_id.length > 100) {
        errors.push("custom-id");
      } else if (ids.has(component.custom_id)) errors.push("duplicate-id");
      else ids.add(component.custom_id);
      if (component.disabled != null && typeof component.disabled !== "boolean") errors.push("disabled");
    }
    if (SELECT_TYPES.has(type)) {
      if (typeof component.custom_id !== "string" || component.custom_id.length < 1 || component.custom_id.length > 100) {
        errors.push("custom-id");
      } else if (ids.has(component.custom_id)) errors.push("duplicate-id");
      else ids.add(component.custom_id);
    }
    const children = component.components ?? [];
    if (type === 1) {
      if (children.length < 1 || children.length > 5) errors.push("action-row");
      for (const child of children) visit(child, { insideContainer, inActionRow: true });
      return;
    }
    if (type === 17 || type === 9) {
      for (const child of children) {
        if (type === 17 && !CONTAINER_CHILDREN.has(child.type)) errors.push(`container-child:${child.type}`);
        visit(child, { insideContainer: true });
      }
      if (component.accessory) visit(component.accessory, { insideContainer: true });
    }
  };
  for (const component of components) visit(component);
  return { ok: errors.length === 0, errors };
}
