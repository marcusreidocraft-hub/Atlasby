import { confirmationRow, renderNotice } from "./ui.js";
import { describeResult } from "./messages.js";

function blank(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

async function present(interaction, result) {
  if (result?.modal) {
    await interaction.showModal(result.modal);
    return;
  }
  if (result?.view) {
    if (result.update) await interaction.update(result.view);
    else await interaction.reply(result.view);
    return;
  }
  const row = result?.confirmationId ? confirmationRow(result.confirmationId) : null;
  const payload = renderNotice(describeResult(result), { row });
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

export async function routeFormButton(interaction, forms) {
  const customId = interaction.customId ?? "";
  if (customId === "atlasby:cfg:forms") {
    const result = await forms.admin(interaction.guildId, interaction.user.id);
    await present(interaction, result.view ? { ...result, update: true } : result);
    return true;
  }
  if (customId === "atlasby:form:open") return reply(interaction, await forms.requestOpen({ guildId: interaction.guildId, actorId: interaction.user.id }));
  if (customId === "atlasby:form:channels") return reply(interaction, await forms.channels(interaction.guildId, interaction.user.id));
  if (customId === "atlasby:form:roles") return reply(interaction, await forms.roles(interaction.guildId, interaction.user.id));
  if (customId === "atlasby:form:questions") return reply(interaction, await forms.questions(interaction.guildId, interaction.user.id));
  if (customId === "atlasby:form:style") {
    const auth = await forms.admin(interaction.guildId, interaction.user.id);
    if (!auth.view) return reply(interaction, auth);
    await interaction.showModal(forms.styleModal(forms.current(interaction.guildId)));
    return true;
  }
  if (customId === "atlasby:form:qadd") {
    await interaction.showModal(forms.questionModal(null));
    return true;
  }
  if (customId === "atlasby:form:restore") return reply(interaction, await forms.requestRestore({ guildId: interaction.guildId, actorId: interaction.user.id }));
  if (customId === "atlasby:apply:start") {
    return reply(interaction, await forms.start({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      hasCustomAvatar: Boolean(interaction.member?.avatar || interaction.user?.avatar),
      avatarUrl: interaction.member?.displayAvatarURL?.({ extension: "png", size: 128 }) ?? interaction.user?.displayAvatarURL?.({ extension: "png", size: 128 }) ?? null,
    }));
  }
  if (customId === "atlasby:apply:mine") return reply(interaction, forms.status(interaction.guildId, interaction.user.id));
  const answer = /^atlasby:apply:answer:([0-9a-f-]{36})$/.exec(customId);
  if (answer) return reply(interaction, await forms.answerModal(interaction.guildId, interaction.user.id, answer[1]));
  const submit = /^atlasby:apply:submit:([0-9a-f-]{36})$/.exec(customId);
  if (submit) return reply(interaction, await forms.requestSubmit({ guildId: interaction.guildId, actorId: interaction.user.id, applicationId: submit[1] }));
  const cancel = /^atlasby:apply:cancel:([0-9a-f-]{36})$/.exec(customId);
  if (cancel) return reply(interaction, await forms.requestCancel({ guildId: interaction.guildId, actorId: interaction.user.id, applicationId: cancel[1] }));
  const forget = /^atlasby:apply:forget:([0-9a-f-]{36})$/.exec(customId);
  if (forget) return reply(interaction, await forms.requestForget({ guildId: interaction.guildId, userId: interaction.user.id, applicationId: forget[1] }));
  const claim = /^atlasby:apply:claim:([0-9a-f-]{36})$/.exec(customId);
  if (claim) return reply(interaction, await forms.claim({ guildId: interaction.guildId, actorId: interaction.user.id, applicationId: claim[1] }));
  const approve = /^atlasby:apply:approve:([0-9a-f-]{36})$/.exec(customId);
  if (approve) return reply(interaction, await forms.requestApprove({ guildId: interaction.guildId, actorId: interaction.user.id, applicationId: approve[1] }));
  const reject = /^atlasby:apply:reject:([0-9a-f-]{36})$/.exec(customId);
  if (reject) {
    await interaction.showModal(forms.rejectModal(reject[1]));
    return true;
  }
  const page = /^atlasby:apply:page:([0-9a-f-]{36}):(\d+)$/.exec(customId);
  if (page) return reply(interaction, await forms.page({ guildId: interaction.guildId, actorId: interaction.user.id, applicationId: page[1], page: Number(page[2]) }));
  const remove = /^atlasby:apply:admindelete:([0-9a-f-]{36})$/.exec(customId);
  if (remove) return reply(interaction, await forms.requestAdminDelete({ guildId: interaction.guildId, actorId: interaction.user.id, applicationId: remove[1] }));
  const fix = /^atlasby:apply:fix:([0-9a-f-]{36})$/.exec(customId);
  if (fix) return reply(interaction, await forms.answerModal(interaction.guildId, interaction.user.id, fix[1]));
  const edit = /^atlasby:form:qedit:([0-9a-f-]{36})$/.exec(customId);
  if (edit) {
    const detail = await forms.questionDetail(interaction.guildId, interaction.user.id, edit[1]);
    if (!detail.question) return reply(interaction, detail);
    await interaction.showModal(forms.questionModal(detail.question));
    return true;
  }
  const up = /^atlasby:form:qup:([0-9a-f-]{36})$/.exec(customId);
  if (up) return reply(interaction, await forms.requestMove({ guildId: interaction.guildId, actorId: interaction.user.id, id: up[1], direction: "up" }));
  const down = /^atlasby:form:qdown:([0-9a-f-]{36})$/.exec(customId);
  if (down) return reply(interaction, await forms.requestMove({ guildId: interaction.guildId, actorId: interaction.user.id, id: down[1], direction: "down" }));
  const del = /^atlasby:form:qdel:([0-9a-f-]{36})$/.exec(customId);
  if (del) return reply(interaction, await forms.requestRemoveQuestion({ guildId: interaction.guildId, actorId: interaction.user.id, id: del[1] }));
  if (!customId.startsWith("atlasby:form:") && !customId.startsWith("atlasby:apply:")) return false;
  return false;
}

async function reply(interaction, result) {
  await present(interaction, result);
  return true;
}

export async function routeFormSelect(interaction, forms) {
  const customId = interaction.customId ?? "";
  const selected = interaction.values?.[0] ?? null;
  if (customId === "atlasby:form:panel") {
    return reply(interaction, await forms.requestPanel({ guildId: interaction.guildId, actorId: interaction.user.id, channelId: selected }));
  }
  if (customId === "atlasby:form:review") {
    return reply(interaction, await forms.requestReview({ guildId: interaction.guildId, actorId: interaction.user.id, channelId: selected }));
  }
  if (customId === "atlasby:form:approval") {
    return reply(interaction, await forms.requestRole({ guildId: interaction.guildId, actorId: interaction.user.id, roleId: selected }));
  }
  if (customId === "atlasby:form:reviewer") {
    return reply(interaction, await forms.requestReviewer({ guildId: interaction.guildId, actorId: interaction.user.id, roleId: selected, op: "add" }));
  }
  if (customId === "atlasby:form:reviewerdel") {
    return reply(interaction, await forms.requestReviewer({ guildId: interaction.guildId, actorId: interaction.user.id, roleId: selected, op: "remove" }));
  }
  if (customId === "atlasby:form:qpick") {
    return reply(interaction, await forms.questionDetail(interaction.guildId, interaction.user.id, selected));
  }
  return false;
}

export async function routeFormModal(interaction, forms) {
  const customId = interaction.customId ?? "";
  const read = (id) => blank(interaction.fields.getTextInputValue(id));
  const question = /^atlasby:modal:form:question:(new|[0-9a-f-]{36})$/.exec(customId);
  if (question) {
    return reply(interaction, await forms.requestQuestion({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      id: question[1] === "new" ? null : question[1],
      prompt: interaction.fields.getTextInputValue("enunciado"),
      hint: read("complemento"),
      kindText: interaction.fields.getTextInputValue("tipo"),
      requiredText: interaction.fields.getTextInputValue("obrigatoria"),
    }));
  }
  if (customId === "atlasby:modal:form:style") {
    return reply(interaction, await forms.requestStyle({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      patch: {
        heading: read("titulo"),
        emoji: read("emoji"),
        intro: read("intro"),
        bannerUrl: read("banner"),
        buttonEmoji: read("botao"),
      },
    }));
  }
  const apply = /^atlasby:modal:apply:([0-9a-f-]{36}):(\d+)$/.exec(customId);
  if (apply) {
    const questions = forms.stepQuestions(interaction.guildId, Number(apply[2]));
    const raw = {};
    for (const question of questions) raw[question.id] = interaction.fields.getTextInputValue(question.id);
    return reply(interaction, await forms.saveStep({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      applicationId: apply[1],
      step: Number(apply[2]),
      raw,
    }));
  }
  const reject = /^atlasby:modal:reject:([0-9a-f-]{36})$/.exec(customId);
  if (reject) {
    return reply(interaction, await forms.requestReject({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      applicationId: reject[1],
      reason: interaction.fields.getTextInputValue("motivo"),
    }));
  }
  return false;
}
