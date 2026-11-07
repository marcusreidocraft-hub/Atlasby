import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
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
import { PRODUCT_LINE, PRODUCT_NAME, publicPlanLine } from "./plans.js";

export const V2_FLAG = MessageFlags.IsComponentsV2;
const TOP_LEVEL = new Set([1, 9, 10, 12, 13, 14, 17]);
const CONTAINER_CHILDREN = new Set([1, 9, 10, 12, 13, 14]);
const SELECT_TYPES = new Set([3, 5, 6, 7, 8]);

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

export function renderNotice(content, { ephemeral = true, update = false, row = null, accent = 0x5865f2 } = {}) {
  const container = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(text(content));
  if (row) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addActionRowComponents(row);
  }
  return { components: [container], flags: v2Flags({ ephemeral, update }) };
}

export function renderCatalog(plans) {
  const container = new ContainerBuilder()
    .setAccentColor(0x2b2d31)
    .addTextDisplayComponents(
      text(`# ${PRODUCT_NAME}\n${PRODUCT_LINE}\nSomente catálogo. Este bot não cobra, não recebe pagamento e não provisiona servidor.`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  for (const plan of plans) {
    container.addTextDisplayComponents(text(publicPlanLine(plan)));
  }
  const soldOut = plans.find((plan) => !plan.available);
  if (soldOut) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`atlasby:plan:soldout:${soldOut.code}`)
          .setLabel(`${soldOut.label} · ${soldOut.duration_days} dias · Esgotado`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      ),
    );
  }
  return { components: [container], flags: v2Flags({ ephemeral: false }) };
}

export function renderAdmin(state) {
  const lines = [
    "# Configuração",
    `Canal de logs: ${state.logChannelId ? `<#${state.logChannelId}>` : "não definido"}`,
    "Alterações de canal, preço e disponibilidade só são gravadas depois da confirmação.",
    ...state.plans.map((plan) => {
      const price = plan.price_cents == null ? "sem preço" : `${plan.price_cents} centavos`;
      const stock = plan.available ? "disponível" : "esgotado";
      return `${plan.label}: ${price}, ${stock}`;
    }),
  ];
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(lines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:cfg:logs").setLabel("Canal de logs").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("atlasby:cfg:admins").setLabel("Administradores").setStyle(ButtonStyle.Secondary),
      ),
    );
  for (const plan of state.plans) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`atlasby:cfg:price:${plan.code}`)
          .setLabel(`Preço ${plan.label}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`atlasby:cfg:stock:${plan.code}`)
          .setLabel(plan.available ? `Esgotar ${plan.label}`.slice(0, 80) : `Reativar ${plan.label}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
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

export function priceModal(code, label) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:price:${code}`)
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
    if (type === 17) {
      for (const child of children) {
        if (!CONTAINER_CHILDREN.has(child.type)) errors.push(`container-child:${child.type}`);
        visit(child, { insideContainer: true });
      }
    }
  };
  for (const component of components) visit(component);
  return { ok: errors.length === 0, errors };
}
