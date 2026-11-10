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
  ModalBuilder,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} from "discord.js";
import { confirmationRow, panelAccent, v2Flags } from "./ui.js";
import { PRIVACY_LINE, STEP_SIZE } from "./forms-model.js";

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function emojiButton(customId, label, style, emoji) {
  const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  return emoji ? button.setEmoji(emoji) : button;
}

export function renderApplicationPanel(form) {
  const heading = `${form?.emoji ? `${form.emoji} ` : ""}${form?.heading || "Atlas"}`;
  const intro = form?.intro || "Candidate-se à equipe. O formulário é privado.";
  const state = form?.open ? "Inscrições abertas." : "Inscrições fechadas.";
  const container = new ContainerBuilder().setAccentColor(panelAccent());
  const body = `# ${heading}\n${intro}\n${PRIVACY_LINE}\n${state}`;
  if (form?.banner_url) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text(body)).setThumbnailAccessory(
        new ThumbnailBuilder({ description: "Imagem do formulário" }).setURL(form.banner_url),
      ),
    );
  } else {
    container.addTextDisplayComponents(text(body));
  }
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      emojiButton("atlasby:apply:start", "Fazer formulário", ButtonStyle.Primary, form?.button_emoji),
      new ButtonBuilder().setCustomId("atlasby:apply:mine").setLabel("Minha candidatura").setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [container], flags: v2Flags({ ephemeral: false }) };
}

export function renderFormAdmin(state) {
  const reviewers = state.reviewers.length ? state.reviewers.map((row) => `<@&${row.role_id}>`).join(", ") : "nenhum";
  const lines = [
    "# Formulários da equipe",
    `Inscrições: ${state.form.open ? "abertas" : "fechadas"}`,
    `Canal do painel: ${state.form.panel_channel_id ? `<#${state.form.panel_channel_id}>` : "não definido"}`,
    `Canal privado de análise: ${state.form.review_channel_id ? `<#${state.form.review_channel_id}>` : "não definido"}`,
    `Cargo concedido: ${state.form.approval_role_id ? `<@&${state.form.approval_role_id}>` : "não definido"}`,
    `Avaliadores: ${reviewers}`,
    `Perguntas: ${state.questions.length}`,
    "Publique o painel com `/formularios` no canal público. Nada sensível aparece lá.",
  ];
  const toggle = state.form.open ? "Fechar inscrições" : "Abrir inscrições";
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(lines.join("\n")))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:form:open").setLabel(toggle).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("atlasby:form:channels").setLabel("Canais").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:form:roles").setLabel("Cargos").setStyle(ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:form:questions").setLabel("Perguntas").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:form:style").setLabel("Aparência").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("atlasby:form:restore").setLabel("Restaurar padrão").setStyle(ButtonStyle.Secondary).setDisabled(state.questions.length > 0),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderFormChannels() {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("O canal do painel pode ser público. O canal de análise precisa ser privado e invisível para @everyone."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("atlasby:form:panel")
          .setPlaceholder("Canal público do painel")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("atlasby:form:review")
          .setPlaceholder("Canal privado de análise")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderFormRoles(reviewers) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text("O cargo concedido é só o que for escolhido aqui. O cargo da equipe dos tickets não é dado automaticamente. Cargos com Administrador, Gerenciar cargos ou Gerenciar servidor são recusados."));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId("atlasby:form:approval").setPlaceholder("Cargo concedido ao aprovar").setMinValues(1).setMaxValues(1),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId("atlasby:form:reviewer").setPlaceholder("Adicionar cargo avaliador").setMinValues(1).setMaxValues(1),
    ),
  );
  if (reviewers.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("atlasby:form:reviewerdel")
          .setPlaceholder("Remover cargo avaliador")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(reviewers.slice(0, 25).map((row) => ({ label: `Cargo ${row.role_id}`.slice(0, 100), value: row.role_id }))),
      ),
    );
  }
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderFormQuestions(questions) {
  const lines = questions.length
    ? questions.map((question, index) => `${index + 1}. ${question.prompt}${question.required ? "" : " (opcional)"}`)
    : ["Nenhuma pergunta. Restaure o padrão ou adicione uma."];
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(["# Perguntas", `Até 15 perguntas, ${STEP_SIZE} por etapa.`, ...lines].join("\n")))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("atlasby:form:qadd").setLabel("Adicionar").setStyle(ButtonStyle.Primary).setDisabled(questions.length >= 15),
      ),
    );
  if (questions.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("atlasby:form:qpick")
          .setPlaceholder("Escolha uma pergunta")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(questions.slice(0, 25).map((question) => ({
            label: question.prompt.slice(0, 100),
            value: question.id,
          }))),
      ),
    );
  }
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

export function renderQuestionDetail(question) {
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents(text(`**${question.prompt}**\n${question.hint || "Sem complemento."}\n${question.kind === "long" ? "Resposta longa" : "Resposta curta"} · ${question.required ? "obrigatória" : "opcional"}`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`atlasby:form:qedit:${question.id}`).setLabel("Editar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`atlasby:form:qup:${question.id}`).setLabel("Subir").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`atlasby:form:qdown:${question.id}`).setLabel("Descer").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`atlasby:form:qdel:${question.id}`).setLabel("Remover").setStyle(ButtonStyle.Danger),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true, update: true }) };
}

function optionalInput(customId, placeholder, max) {
  return new TextInputBuilder().setCustomId(customId).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(max).setPlaceholder(placeholder);
}

export function questionModal(question = null) {
  const prompt = new TextInputBuilder().setCustomId("enunciado").setStyle(TextInputStyle.Short).setRequired(!question).setMaxLength(45).setPlaceholder("Por que quer entrar na equipe?");
  const hint = optionalInput("complemento", "Sem dados pessoais", 100);
  const kind = new TextInputBuilder().setCustomId("tipo").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setPlaceholder("curta ou longa");
  const required = new TextInputBuilder().setCustomId("obrigatoria").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder("sim ou nao");
  if (question) {
    prompt.setValue(question.prompt);
    if (question.hint) hint.setValue(question.hint);
    kind.setValue(question.kind === "long" ? "longa" : "curta");
    required.setValue(question.required ? "sim" : "nao");
  }
  return new ModalBuilder()
    .setCustomId(question ? `atlasby:modal:form:question:${question.id}` : "atlasby:modal:form:question:new")
    .setTitle(question ? "Editar pergunta" : "Nova pergunta")
    .addLabelComponents(
      new LabelBuilder().setLabel("Enunciado").setDescription("Até 45 caracteres. Sem e-mail, senha ou documento no padrão.").setTextInputComponent(prompt),
      new LabelBuilder().setLabel("Complemento").setDescription("Opcional. Até 100 caracteres.").setTextInputComponent(hint),
      new LabelBuilder().setLabel("Tipo").setDescription("Escreva curta ou longa.").setTextInputComponent(kind),
      new LabelBuilder().setLabel("Obrigatória").setDescription("Escreva sim ou nao.").setTextInputComponent(required),
    );
}

export function formStyleModal(form) {
  const heading = optionalInput("titulo", "Atlas", 40);
  const emoji = optionalInput("emoji", "🧾", 64);
  const intro = new TextInputBuilder().setCustomId("intro").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200).setPlaceholder("Candidate-se à equipe.");
  const banner = optionalInput("banner", "https://", 300);
  const button = optionalInput("botao", "📝", 64);
  if (form?.heading) heading.setValue(form.heading);
  if (form?.emoji) emoji.setValue(form.emoji);
  if (form?.intro) intro.setValue(form.intro);
  if (form?.banner_url) banner.setValue(form.banner_url);
  if (form?.button_emoji) button.setValue(form.button_emoji);
  return new ModalBuilder()
    .setCustomId("atlasby:modal:form:style")
    .setTitle("Aparência do formulário")
    .addLabelComponents(
      new LabelBuilder().setLabel("Título").setDescription("Vazio usa Atlas.").setTextInputComponent(heading),
      new LabelBuilder().setLabel("Emoji do título").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(emoji),
      new LabelBuilder().setLabel("Texto").setDescription("Vazio volta ao texto neutro.").setTextInputComponent(intro),
      new LabelBuilder().setLabel("Banner").setDescription("URL HTTPS. Vazio remove.").setTextInputComponent(banner),
      new LabelBuilder().setLabel("Emoji do botão").setDescription("Unicode ou <:nome:id>. Vazio remove.").setTextInputComponent(button),
    );
}

export function applyModal(applicationId, step, questions) {
  const modal = new ModalBuilder()
    .setCustomId(`atlasby:modal:apply:${applicationId}:${step}`)
    .setTitle(`Candidatura · etapa ${step + 1}`.slice(0, 45));
  modal.addLabelComponents(
    questions.map((question) => {
      const input = new TextInputBuilder()
        .setCustomId(question.id)
        .setStyle(question.kind === "long" ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(question.required)
        .setMaxLength(question.max_length);
      if (question.required) input.setMinLength(1);
      const hint = question.hint ? question.hint.slice(0, 80) : (question.required ? "Obrigatória" : "Opcional");
      return new LabelBuilder().setLabel(question.prompt.slice(0, 45)).setDescription(hint).setTextInputComponent(input);
    }),
  );
  return modal;
}

export function rejectModal(applicationId) {
  return new ModalBuilder()
    .setCustomId(`atlasby:modal:reject:${applicationId}`)
    .setTitle("Recusar candidatura")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Motivo")
        .setDescription("Obrigatório. A pessoa vê este texto na consulta privada.")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("motivo").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(5).setMaxLength(400),
        ),
    );
}

export function renderDraftReview(application, questions) {
  const answers = application.draft?.answers ?? {};
  const lines = questions.map((question) => {
    const value = answers[question.id]?.trim() ? answers[question.id].trim().slice(0, 180) : "sem resposta";
    return `**${question.prompt}**\n${value}`;
  });
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(["# Revise antes de enviar", PRIVACY_LINE, ...lines].join("\n\n").slice(0, 3900)))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`atlasby:apply:submit:${application.id}`).setLabel("Enviar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`atlasby:apply:fix:${application.id}`).setLabel("Corrigir").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`atlasby:apply:cancel:${application.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderStepSaved(application, step, total) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(`Etapa ${step} de ${total} salva neste servidor. Você pode continuar agora ou depois.`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`atlasby:apply:answer:${application.id}`).setLabel("Continuar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`atlasby:apply:cancel:${application.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger),
      ),
    );
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderStatus(application) {
  if (!application) {
    return {
      components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text("Você não tem candidatura neste servidor."))],
      flags: v2Flags({ ephemeral: true }),
    };
  }
  const labels = {
    draft: "Rascunho ainda não enviado.",
    pending: "Em análise.",
    claimed: "Em análise por um avaliador.",
    approving: "Aprovação em andamento.",
    approved: "Aprovada. O cargo configurado foi solicitado.",
    rejected: `Recusada.${application.decision_reason ? ` Motivo: ${application.decision_reason}` : ""}`,
  };
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(`# Minha candidatura\n${labels[application.status] || "Estado desconhecido."}\n${PRIVACY_LINE}`));
  const row = new ActionRowBuilder();
  if (application.status === "draft") {
    row.addComponents(new ButtonBuilder().setCustomId(`atlasby:apply:answer:${application.id}`).setLabel("Retomar").setStyle(ButtonStyle.Primary));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`atlasby:apply:forget:${application.id}`).setLabel("Apagar meus dados").setStyle(ButtonStyle.Danger));
  container.addActionRowComponents(row);
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}

export function renderReviewPanel(application, page) {
  const snapshot = application.snapshot ?? { questions: [], answers: {} };
  const pages = pack(snapshot);
  const index = Math.min(Math.max(page, 0), pages.length - 1);
  const claimed = application.claimed_by ? `Avaliador: <@${application.claimed_by}>` : "Ninguém assumiu ainda.";
  const decision = application.status === "approved"
    ? "Aprovada."
    : application.status === "rejected"
      ? `Recusada. Motivo: ${application.decision_reason || "não informado"}`
      : application.status === "approving"
        ? "Aprovação pendente de confirmação do cargo."
        : "Aguardando decisão.";
  const body = [
    "# Candidatura",
    PRIVACY_LINE,
    `Pessoa: <@${application.applicant_id}>`,
    `Enviada <t:${Math.floor((application.updated_at || application.created_at) / 1000)}:F>`,
    claimed,
    decision,
    pages[index],
    pages.length > 1 ? `Página ${index + 1} de ${pages.length}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 3900);
  const section = new SectionBuilder()
    .addTextDisplayComponents(text(body))
    .setThumbnailAccessory(new ThumbnailBuilder({ description: "Avatar de quem se candidatou" }).setURL(application.avatar_url));
  const container = new ContainerBuilder().setAccentColor(panelAccent()).addSectionComponents(section);
  if (pages.length > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`atlasby:apply:page:${application.id}:${Math.max(0, index - 1)}`).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`atlasby:apply:page:${application.id}:${Math.min(pages.length - 1, index + 1)}`).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(index === pages.length - 1),
      ),
    );
  }
  const open = application.status === "pending" || application.status === "claimed" || application.status === "approving";
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`atlasby:apply:claim:${application.id}`).setLabel("Assumir").setStyle(ButtonStyle.Primary).setDisabled(!open || application.status === "approving"),
      new ButtonBuilder().setCustomId(`atlasby:apply:approve:${application.id}`).setLabel("Aprovar").setStyle(ButtonStyle.Success).setDisabled(!open),
      new ButtonBuilder().setCustomId(`atlasby:apply:reject:${application.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger).setDisabled(application.status !== "pending" && application.status !== "claimed"),
      new ButtonBuilder().setCustomId(`atlasby:apply:admindelete:${application.id}`).setLabel("Apagar").setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [container], flags: v2Flags({ ephemeral: false }) };
}

function pack(snapshot) {
  const blocks = (snapshot.questions ?? []).map((question) => {
    const raw = snapshot.answers?.[question.id]?.trim() || "sem resposta";
    const value = raw.length > 700 ? `${raw.slice(0, 700)}…` : raw;
    return `**${question.prompt}**\n${value}`;
  });
  if (!blocks.length) return ["Sem respostas no registro."];
  const pages = [];
  let current = "";
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > 2500 && current) {
      pages.push(current);
      current = block.slice(0, 2500);
    } else {
      current = next.slice(0, 2500);
    }
  }
  if (current) pages.push(current);
  return pages;
}

export function renderPrivateDecision(content) {
  return {
    components: [new ContainerBuilder().setAccentColor(panelAccent()).addTextDisplayComponents(text(content))],
    flags: v2Flags({ ephemeral: false }),
  };
}

export function renderConfirm(summary, confirmationId) {
  const container = new ContainerBuilder()
    .setAccentColor(panelAccent())
    .addTextDisplayComponents(text(summary))
    .addActionRowComponents(confirmationRow(confirmationId));
  return { components: [container], flags: v2Flags({ ephemeral: true }) };
}
