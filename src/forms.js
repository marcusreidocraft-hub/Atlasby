import { randomUUID } from "node:crypto";
import { canPostLogs, evaluateApprovalRole } from "./permissions.js";
import { resolveOpenerAvatar } from "./tickets.js";
import {
  DEFAULT_QUESTIONS,
  FORM_ACTIONS,
  MAX_QUESTIONS,
  MAX_REVIEWERS,
  firstIncompleteStep,
  parseQuestionFields,
  snapshotOf,
  stepsOf,
  validateAnswers,
  validateDecisionReason,
  validateFormStyle,
  validateQuestionInput,
} from "./forms-model.js";
import {
  applyModal,
  questionModal,
  formStyleModal,
  renderApplicationPanel,
  renderDraftReview,
  renderFormAdmin,
  renderFormChannels,
  renderFormQuestions,
  renderFormRoles,
  renderQuestionDetail,
  renderReviewPanel,
  renderPrivateDecision,
  renderStatus,
  renderStepSaved,
  rejectModal,
} from "./form-ui.js";

export { FORM_ACTIONS };

const SNOWFLAKE = /^\d{17,20}$/;

function done(action, code, extra = {}) {
  return { ok: true, action, code, confirmed: true, punishmentApplied: false, logDelivered: false, auditRecorded: false, ...extra };
}

function viewOf(view, extra = {}) {
  return { ok: true, view, ...extra };
}

export function createFormController({ store, discord, now, openConfirmation, deny, assertAdmin }) {
  const chains = new Map();
  const grants = new Map();
  function grantSerialized(application, reviewerId, options) {
    const key = `${application.guild_id}:${application.id}`;
    if (grants.has(key)) return grants.get(key);
    const job = grant(application, reviewerId, options).finally(() => grants.delete(key));
    grants.set(key, job);
    return job;
  }

  function saved(action, extra = {}) {
    return done(action, "config_saved", extra);
  }

  async function refresh(guildId) {
    if (!discord.editMessage) return;
    const payload = { ...renderApplicationPanel(store.getForm(guildId)), allowedMentions: { parse: [] } };
    for (const post of store.listFormPosts(guildId)) {
      const result = await discord.editMessage(post.channel_id, post.message_id, payload);
      if (result?.missing) store.pruneFormPost(post);
    }
  }

  function schedule(guildId) {
    const previous = chains.get(guildId) ?? Promise.resolve();
    const next = previous.then(() => refresh(guildId)).catch(() => {});
    chains.set(guildId, next);
    return next;
  }

  function ensure(guildId) {
    const form = store.ensureForm(guildId, now());
    if (!form.questions_seeded) {
      for (const question of DEFAULT_QUESTIONS) {
        store.insertQuestion({
          id: randomUUID(),
          guildId,
          position: store.nextQuestionPosition(guildId),
          prompt: question.prompt,
          hint: question.hint,
          kind: question.kind,
          required: question.required,
          maxLength: question.kind === "long" ? 1000 : 200,
          now: now(),
        });
      }
      store.saveForm(guildId, { questions_seeded: true }, now());
    }
    return store.getForm(guildId);
  }

  function state(guildId) {
    ensure(guildId);
    return { form: store.getForm(guildId), reviewers: store.listReviewers(guildId), questions: store.listQuestions(guildId) };
  }

  async function isReviewer(guildId, userId, application) {
    if (application && application.applicant_id === userId) return false;
    const auth = await assertAdmin(guildId, userId);
    if (auth.ok) return true;
    if (!discord.memberRoleIds) return false;
    let roles = [];
    try {
      roles = await discord.memberRoleIds(guildId, userId);
    } catch {
      return false;
    }
    const allowed = new Set(store.listReviewers(guildId).map((row) => row.role_id));
    return roles.some((roleId) => allowed.has(roleId));
  }

  async function inspectPrivate(channelId, guildId) {
    let info;
    try {
      info = await discord.inspectChannel(channelId);
    } catch {
      return { ok: false, code: "review_channel_missing" };
    }
    if (!info || info.guildId !== guildId || info.type !== "GuildText" || info.everyoneCanView !== false || !canPostLogs(info.permissions)) {
      return { ok: false, code: "review_channel_unsafe" };
    }
    return { ok: true, info };
  }

  async function loadRole(guildId, roleId, actorId) {
    if (!SNOWFLAKE.test(roleId ?? "") || !discord.inspectRole) return { ok: false, code: "role_missing" };
    let role;
    let actor;
    try {
      role = await discord.inspectRole(guildId, roleId);
      actor = await discord.inspectActor(guildId, actorId);
    } catch {
      return { ok: false, code: "role_missing" };
    }
    const staffRoleId = store.getSettings(guildId)?.staff_role_id ?? null;
    const decision = evaluateApprovalRole({
      role,
      actorIsOwner: actor?.isOwner === true,
      actorHighestPosition: actor?.highestPosition,
      staffRoleId,
    });
    return decision.ok ? { ok: true, role } : decision;
  }

  async function postReview(application) {
    const current = store.getApplication(application.guild_id, application.id) ?? application;
    const form = store.getForm(current.guild_id);
    const channelId = current.review_channel_id || form?.review_channel_id;
    const check = await inspectPrivate(channelId, current.guild_id);
    if (!check.ok) return check;
    if (current.review_message_id === "posting") return { ok: true, duplicate: true };
    if (current.review_message_id) return { ok: true, duplicate: true };
    if (!store.claimReviewPost(current.guild_id, current.id, channelId)) return { ok: true, duplicate: true };
    const avatar = current.avatar_url || resolveOpenerAvatar({ userId: current.applicant_id, hasCustomAvatar: false });
    const payload = { ...renderReviewPanel({ ...current, avatar_url: avatar }, 0), allowedMentions: { parse: [] } };
    try {
      const sent = await discord.sendComponents(channelId, payload);
      store.finishReviewPost(current.guild_id, current.id, sent.id);
      return { ok: true, posted: true, messageId: sent.id };
    } catch {
      store.clearReviewPost(current.guild_id, current.id);
      return { ok: false, code: "application_panel_pending" };
    }
  }

  async function notify(application) {
    if (!discord.tryDm) {
      store.setNotifyState(application.guild_id, application.id, "failed");
      return false;
    }
    const content = application.status === "rejected"
      ? `Sua candidatura foi recusada. Motivo: ${application.decision_reason}`
      : "Sua candidatura foi aprovada. O cargo configurado foi concedido.";
    const payload = renderPrivateDecision(content);
    try {
      await discord.tryDm(application.applicant_id, { ...payload, allowedMentions: { parse: [] } });
      store.setNotifyState(application.guild_id, application.id, "sent");
      return true;
    } catch {
      store.setNotifyState(application.guild_id, application.id, "failed");
      return false;
    }
  }

  async function editReview(application) {
    if (!application?.review_channel_id || !application.review_message_id || application.review_message_id === "posting" || !discord.editMessage) return;
    const avatar = application.avatar_url || resolveOpenerAvatar({ userId: application.applicant_id, hasCustomAvatar: false });
    try {
      await discord.editMessage(application.review_channel_id, application.review_message_id, {
        ...renderReviewPanel({ ...application, avatar_url: avatar }, 0),
        allowedMentions: { parse: [] },
      });
    } catch {
      // O estado permanece no banco mesmo se o painel antigo não puder ser editado.
    }
  }

  async function grant(application, reviewerId, { revert = true } = {}) {
    if (application.status === "approved" && application.role_applied) {
      return done("approve_application", application.notify_state === "failed" ? "application_approved_unnotified" : "application_approved", { application });
    }
    const form = store.getForm(application.guild_id);
    const roleCheck = await loadRole(application.guild_id, form?.approval_role_id, reviewerId);
    if (!roleCheck.ok) {
      if (revert && application.status === "approving") store.revertApproval(application.guild_id, application.id, application.claimed_by ? "claimed" : "pending", now());
      return deny("approve_application", roleCheck);
    }
    try {
      await discord.addRole(application.guild_id, application.applicant_id, form.approval_role_id, "Candidatura aprovada");
    } catch (error) {
      const code = error?.code === 10007 || error?.code === 10013 ? "user_left" : error?.code === 10011 ? "role_missing" : "role_grant_failed";
      if (revert && application.status === "approving") store.revertApproval(application.guild_id, application.id, application.claimed_by ? "claimed" : "pending", now());
      return deny("approve_application", { code });
    }
    const sent = await notify({ ...application, status: "approved" });
    store.markApplicationApproved({
      guildId: application.guild_id,
      id: application.id,
      roleId: form.approval_role_id,
      reviewerId,
      now: now(),
      notifyState: sent ? "sent" : "failed",
    });
    const updated = store.getApplication(application.guild_id, application.id);
    await editReview(updated);
    return done("approve_application", sent ? "application_approved" : "application_approved_unnotified", { application: updated });
  }

  return {
    FORM_ACTIONS,
    schedule,
    whenSettled(guildId) {
      return chains.get(guildId) ?? Promise.resolve();
    },
    track(post) {
      store.trackFormPost(post);
    },
    panel(guildId) {
      return renderApplicationPanel(ensure(guildId));
    },
    async admin(guildId, actorId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "config" };
      return viewOf(renderFormAdmin(state(guildId)));
    },
    async channels(guildId, actorId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      ensure(guildId);
      return viewOf(renderFormChannels(), { update: true });
    },
    async roles(guildId, actorId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      ensure(guildId);
      return viewOf(renderFormRoles(store.listReviewers(guildId)), { update: true });
    },
    async questions(guildId, actorId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      ensure(guildId);
      return viewOf(renderFormQuestions(store.listQuestions(guildId)), { update: true });
    },
    async questionDetail(guildId, actorId, questionId) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return auth;
      const question = store.getQuestion(guildId, questionId);
      if (!question) return deny("set_form_question", { code: "question_invalid" });
      return viewOf(renderQuestionDetail(question), { update: true, question });
    },
    current(guildId) {
      return ensure(guildId);
    },
    stepQuestions(guildId, step) {
      return stepsOf(store.listQuestions(guildId))[step] ?? [];
    },
    styleModal(form) {
      return formStyleModal(form);
    },
    questionModal(question) {
      return questionModal(question);
    },
    async publish({ guildId, actorId, channelId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_panel" };
      ensure(guildId);
      if (SNOWFLAKE.test(channelId ?? "")) store.saveForm(guildId, { panel_channel_id: channelId }, now());
      return { ok: true, code: "form_published", message: renderApplicationPanel(store.getForm(guildId)) };
    },
    async requestPanel(input) {
      return this.requestChannel({ ...input, action: "set_form_panel", field: "panel", summary: `Canal do painel: <#${input.channelId}>.` });
    },
    async requestReview(input) {
      const check = await inspectPrivate(input.channelId, input.guildId);
      if (!check.ok) return deny("set_form_review", check);
      return this.requestChannel({ ...input, action: "set_form_review", field: "review", summary: `Canal privado de análise: <#${input.channelId}>.` });
    },
    async requestChannel({ guildId, actorId, channelId, action, summary }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action };
      if (!SNOWFLAKE.test(channelId ?? "")) return deny(action, { code: "channel_required" });
      let info;
      try {
        info = await discord.inspectChannel(channelId);
      } catch {
        return deny(action, { code: "log_channel_check_failed" });
      }
      if (!info || info.guildId !== guildId || info.type !== "GuildText" || !canPostLogs(info.permissions)) {
        return deny(action, { code: "log_channel_unusable" });
      }
      return openConfirmation({
        action,
        guildId,
        actorId,
        targetId: channelId,
        reason: "Definir canal do formulário",
        payload: { channelId },
        summary,
      });
    },
    async requestRole({ guildId, actorId, roleId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_role" };
      const check = await loadRole(guildId, roleId, actorId);
      if (!check.ok) return deny("set_form_role", check);
      return openConfirmation({
        action: "set_form_role",
        guildId,
        actorId,
        targetId: roleId,
        reason: "Definir o cargo concedido na aprovação",
        payload: { roleId },
        summary: `Ao aprovar, conceder só <@&${roleId}>.`,
      });
    },
    async requestReviewer({ guildId, actorId, roleId, op }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_reviewer" };
      if (!SNOWFLAKE.test(roleId ?? "") || !discord.inspectRole) return deny("set_form_reviewer", { code: "role_missing" });
      let role;
      try {
        role = await discord.inspectRole(guildId, roleId);
      } catch {
        return deny("set_form_reviewer", { code: "role_missing" });
      }
      if (!role || role.everyone || role.managed || role.guildId !== guildId) return deny("set_form_reviewer", { code: "role_unsafe" });
      if (op === "add" && store.listReviewers(guildId).length >= MAX_REVIEWERS && !store.listReviewers(guildId).some((row) => row.role_id === roleId)) {
        return deny("set_form_reviewer", { code: "reviewer_limit" });
      }
      return openConfirmation({
        action: "set_form_reviewer",
        guildId,
        actorId,
        targetId: roleId,
        reason: op === "add" ? "Incluir avaliador" : "Remover avaliador",
        payload: { roleId, op },
        summary: `${op === "add" ? "Incluir" : "Remover"} <@&${roleId}> como avaliador.`,
      });
    },
    async requestOpen({ guildId, actorId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_open" };
      const form = ensure(guildId);
      const open = !form.open;
      return openConfirmation({
        action: "set_form_open",
        guildId,
        actorId,
        targetId: guildId,
        reason: open ? "Abrir inscrições" : "Fechar inscrições",
        payload: { open },
        summary: open ? "Abrir as inscrições da equipe." : "Fechar as inscrições da equipe.",
      });
    },
    async requestStyle({ guildId, actorId, patch }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_style" };
      const current = ensure(guildId);
      const valid = validateFormStyle({
        heading: patch.heading === undefined ? current.heading : patch.heading,
        emoji: patch.emoji === undefined ? current.emoji : patch.emoji,
        intro: patch.intro === undefined ? current.intro : patch.intro,
        bannerUrl: patch.bannerUrl === undefined ? current.banner_url : patch.bannerUrl,
        buttonEmoji: patch.buttonEmoji === undefined ? current.button_emoji : patch.buttonEmoji,
      });
      if (!valid.ok) return deny("set_form_style", valid);
      return openConfirmation({
        action: "set_form_style",
        guildId,
        actorId,
        targetId: guildId,
        reason: "Alterar a aparência do formulário",
        payload: valid.style,
        summary: "Prévia pronta. Confirme para gravar só neste servidor.",
      });
    },
    async requestQuestion({ guildId, actorId, id, prompt, hint, kindText, requiredText }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_question" };
      const parsed = parseQuestionFields(kindText, requiredText);
      if (!parsed.ok) return deny("set_form_question", parsed);
      const valid = validateQuestionInput({ prompt, hint, kind: parsed.kind, required: parsed.required });
      if (!valid.ok) return deny("set_form_question", valid);
      ensure(guildId);
      if (!id && store.listQuestions(guildId).length >= MAX_QUESTIONS) return deny("set_form_question", { code: "question_limit" });
      if (id && !store.getQuestion(guildId, id)) return deny("set_form_question", { code: "question_invalid" });
      return openConfirmation({
        action: "set_form_question",
        guildId,
        actorId,
        targetId: id || guildId,
        reason: id ? "Editar pergunta" : "Adicionar pergunta",
        payload: { id: id || null, ...valid },
        summary: `Pergunta: ${valid.prompt}.`,
      });
    },
    async requestRemoveQuestion({ guildId, actorId, id }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "remove_form_question" };
      const question = store.getQuestion(guildId, id);
      if (!question) return deny("remove_form_question", { code: "question_invalid" });
      return openConfirmation({
        action: "remove_form_question",
        guildId,
        actorId,
        targetId: id,
        reason: "Remover pergunta",
        payload: { id },
        summary: `Remover: ${question.prompt}.`,
      });
    },
    async requestMove({ guildId, actorId, id, direction }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "move_form_question" };
      if (!store.getQuestion(guildId, id)) return deny("move_form_question", { code: "question_invalid" });
      return openConfirmation({
        action: "move_form_question",
        guildId,
        actorId,
        targetId: id,
        reason: "Reordenar pergunta",
        payload: { id, direction },
        summary: direction === "up" ? "Mover a pergunta para cima." : "Mover a pergunta para baixo.",
      });
    },
    async requestRestore({ guildId, actorId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_form_question" };
      if (store.listQuestions(guildId).length) return deny("set_form_question", { code: "question_limit" });
      return openConfirmation({
        action: "set_form_question",
        guildId,
        actorId,
        targetId: guildId,
        reason: "Restaurar perguntas padrão",
        payload: { restore: true },
        summary: "Restaurar motivação, experiência e disponibilidade.",
      });
    },
    async start({ guildId, userId, avatarUrl, hasCustomAvatar }) {
      const form = ensure(guildId);
      if (!form.open) return deny("submit_application", { code: "applications_closed" });
      const questions = store.listQuestions(guildId);
      if (!questions.length) return deny("submit_application", { code: "form_not_ready" });
      let application = store.activeApplication(guildId, userId);
      if (application && application.status !== "draft") return { ok: false, code: "application_exists", view: renderStatus(application), action: "submit_application" };
      if (!application) {
        const inserted = store.insertDraft({
          id: randomUUID(),
          guildId,
          applicantId: userId,
          avatarUrl: resolveOpenerAvatar({ userId, url: avatarUrl, hasCustomAvatar }),
          now: now(),
        });
        application = store.activeApplication(guildId, userId);
        if (!application) return deny("submit_application", inserted.ok ? { code: "application_missing" } : inserted);
      }
      const step = application.draft?.step ?? 0;
      const steps = stepsOf(questions);
      if (step >= steps.length) return viewOf(renderDraftReview(application, questions));
      return { ok: true, modal: applyModal(application.id, step, steps[step]) };
    },
    async answerModal(guildId, userId, applicationId) {
      const application = store.getApplication(guildId, applicationId);
      if (!application || application.applicant_id !== userId || application.status !== "draft") return deny("submit_application", { code: "application_missing" });
      const questions = store.listQuestions(guildId);
      const step = Math.min(application.draft?.step ?? 0, Math.max(0, stepsOf(questions).length - 1));
      store.saveDraft(guildId, applicationId, userId, { step, answers: application.draft?.answers ?? {} }, now());
      return { ok: true, modal: applyModal(applicationId, step, stepsOf(questions)[step]) };
    },
    async saveStep({ guildId, userId, applicationId, step, raw }) {
      const form = store.getForm(guildId);
      if (!form?.open) return deny("submit_application", { code: "applications_closed" });
      const application = store.getApplication(guildId, applicationId);
      if (!application || application.applicant_id !== userId || application.status !== "draft") return deny("submit_application", { code: "application_missing" });
      if ((application.draft?.step ?? 0) !== step) return deny("submit_application", { code: "application_step" });
      const questions = store.listQuestions(guildId);
      const slice = stepsOf(questions)[step];
      if (!slice) return deny("submit_application", { code: "application_step" });
      const valid = validateAnswers(slice, raw);
      if (!valid.ok) return deny("submit_application", valid);
      const answers = { ...(application.draft?.answers ?? {}), ...valid.answers };
      const next = step + 1;
      store.saveDraft(guildId, applicationId, userId, { step: next, answers }, now());
      const updated = store.getApplication(guildId, applicationId);
      if (next >= stepsOf(questions).length) return viewOf(renderDraftReview(updated, questions));
      return viewOf(renderStepSaved(updated, next, stepsOf(questions).length));
    },
    async requestSubmit({ guildId, userId, applicationId }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application || application.applicant_id !== userId || application.status !== "draft") return deny("submit_application", { code: "application_missing" });
      const questions = store.listQuestions(guildId);
      const incomplete = firstIncompleteStep(questions, application.draft?.answers ?? {});
      if (incomplete < stepsOf(questions).length) return deny("submit_application", { code: "application_step" });
      return openConfirmation({
        action: "submit_application",
        guildId,
        actorId: userId,
        targetId: applicationId,
        reason: "Enviar candidatura",
        payload: { applicationId },
        summary: "Enviar a candidatura. Depois do envio, as respostas ficam no registro privado e não dá para editar.",
      });
    },
    async requestCancel({ guildId, userId, applicationId }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application || application.applicant_id !== userId || application.status !== "draft") return deny("cancel_application", { code: "application_missing" });
      return openConfirmation({
        action: "cancel_application",
        guildId,
        actorId: userId,
        targetId: applicationId,
        reason: "Cancelar rascunho",
        payload: { applicationId },
        summary: "Apagar o rascunho desta candidatura.",
      });
    },
    async requestForget({ guildId, userId, applicationId }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application || application.applicant_id !== userId) return deny("delete_application", { code: "application_missing" });
      return openConfirmation({
        action: "delete_application",
        guildId,
        actorId: userId,
        targetId: applicationId,
        reason: "Apagar os próprios dados de candidatura",
        payload: { applicationId, scope: "own" },
        summary: "Apagar suas candidaturas neste servidor. Isso não remove um cargo já concedido.",
      });
    },
    async requestAdminDelete({ guildId, actorId, applicationId }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application) return deny("delete_application", { code: "application_missing" });
      if (!(await isReviewer(guildId, actorId, application))) return deny("delete_application", { code: "reviewer_only" });
      return openConfirmation({
        action: "delete_application",
        guildId,
        actorId,
        targetId: applicationId,
        reason: "Apagar candidatura",
        payload: { applicationId, scope: "admin" },
        summary: "Apagar esta candidatura do registro privado. O cargo já concedido não é removido.",
      });
    },
    status(guildId, userId) {
      ensure(guildId);
      return viewOf(renderStatus(store.latestApplication(guildId, userId)));
    },
    async claim({ guildId, actorId, applicationId }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application) return deny("approve_application", { code: "application_missing" });
      if (!(await isReviewer(guildId, actorId, application))) return deny("approve_application", { code: application.applicant_id === actorId ? "own_application" : "reviewer_only" });
      const result = store.claimApplication({ guildId, id: applicationId, userId: actorId, now: now() });
      if (!result.ok) return deny("approve_application", result);
      await editReview(result.application);
      return done("approve_application", result.idempotent ? "application_claimed" : "application_claimed", { application: result.application });
    },
    async requestApprove({ guildId, actorId, applicationId }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application) return deny("approve_application", { code: "application_missing" });
      if (!(await isReviewer(guildId, actorId, application))) return deny("approve_application", { code: application.applicant_id === actorId ? "own_application" : "reviewer_only" });
      if (application.status === "approved" && application.role_applied) return done("approve_application", "application_approved", { application, confirmed: false });
      const form = store.getForm(guildId);
      const role = await loadRole(guildId, form?.approval_role_id, actorId);
      if (!role.ok) return deny("approve_application", role);
      return openConfirmation({
        action: "approve_application",
        guildId,
        actorId,
        targetId: applicationId,
        reason: "Aprovar candidatura",
        payload: { applicationId, roleId: form.approval_role_id },
        summary: `Aprovar <@${application.applicant_id}> e conceder só <@&${form.approval_role_id}>.`,
      });
    },
    rejectModal(applicationId) {
      return rejectModal(applicationId);
    },
    async requestReject({ guildId, actorId, applicationId, reason }) {
      const valid = validateDecisionReason(reason);
      if (!valid.ok) return deny("reject_application", valid);
      const application = store.getApplication(guildId, applicationId);
      if (!application) return deny("reject_application", { code: "application_missing" });
      if (!(await isReviewer(guildId, actorId, application))) return deny("reject_application", { code: application.applicant_id === actorId ? "own_application" : "reviewer_only" });
      if (application.status === "rejected") return done("reject_application", "application_rejected", { application, confirmed: false });
      return openConfirmation({
        action: "reject_application",
        guildId,
        actorId,
        targetId: applicationId,
        reason: valid.reason,
        payload: { applicationId, reason: valid.reason },
        summary: `Recusar <@${application.applicant_id}>. Motivo: ${valid.reason}. Nenhum cargo será concedido.`,
      });
    },
    async page({ guildId, actorId, applicationId, page }) {
      const application = store.getApplication(guildId, applicationId);
      if (!application) return deny("approve_application", { code: "application_missing" });
      if (!(await isReviewer(guildId, actorId, application))) return deny("approve_application", { code: application.applicant_id === actorId ? "own_application" : "reviewer_only" });
      const avatar = application.avatar_url || resolveOpenerAvatar({ userId: application.applicant_id, hasCustomAvatar: false });
      return viewOf(renderReviewPanel({ ...application, avatar_url: avatar }, page), { update: true });
    },
    async prepare(row, actorId) {
      let payload = null;
      try {
        payload = row.payload ? JSON.parse(row.payload) : null;
      } catch {
        return deny(row.action, { code: "confirmation_mismatch" });
      }
      if (!payload) return deny(row.action, { code: "confirmation_mismatch" });
      if (["submit_application", "cancel_application"].includes(row.action)) {
        const application = store.getApplication(row.guild_id, row.target_id);
        if (!application || application.applicant_id !== actorId || payload.applicationId !== row.target_id) {
          return deny(row.action, { code: "confirmation_mismatch" });
        }
      }
      if (row.action === "delete_application") {
        const application = store.getApplication(row.guild_id, row.target_id);
        if (!application || payload.applicationId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        if (payload.scope === "own" && application.applicant_id !== actorId) return deny(row.action, { code: "own_application" });
        if (payload.scope === "admin" && !(await isReviewer(row.guild_id, actorId, application))) return deny(row.action, { code: "reviewer_only" });
      }
      if (row.action === "approve_application" || row.action === "reject_application") {
        const application = store.getApplication(row.guild_id, row.target_id);
        if (!application || payload.applicationId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        if (!(await isReviewer(row.guild_id, actorId, application))) {
          return deny(row.action, { code: application.applicant_id === actorId ? "own_application" : "reviewer_only" });
        }
      }
      if (!FORM_ACTIONS.has(row.action) || row.action.startsWith("set_form") || row.action === "remove_form_question" || row.action === "move_form_question") {
        const auth = await assertAdmin(row.guild_id, actorId);
        if (!auth.ok) return { ...auth, action: row.action };
      }
      return { ok: true };
    },
    async execute(row) {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        return deny(row.action, { code: "confirmation_mismatch" });
      }
      const guildId = row.guild_id;
      const ts = now();
      if (row.action === "set_form_panel") {
        if (payload.channelId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        store.saveForm(guildId, { panel_channel_id: payload.channelId }, ts);
        schedule(guildId);
        return saved(row.action);
      }
      if (row.action === "set_form_review") {
        if (payload.channelId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        const check = await inspectPrivate(payload.channelId, guildId);
        if (!check.ok) return deny(row.action, check);
        store.saveForm(guildId, { review_channel_id: payload.channelId }, ts);
        return saved(row.action);
      }
      if (row.action === "set_form_role") {
        const check = await loadRole(guildId, payload.roleId, row.moderator_id);
        if (!check.ok || payload.roleId !== row.target_id) return deny(row.action, check.ok ? { code: "confirmation_mismatch" } : check);
        store.saveForm(guildId, { approval_role_id: payload.roleId }, ts);
        return saved(row.action);
      }
      if (row.action === "set_form_reviewer") {
        if (payload.op === "add") store.addReviewer(guildId, payload.roleId, ts);
        else store.removeReviewer(guildId, payload.roleId);
        return saved(row.action);
      }
      if (row.action === "set_form_open") {
        store.saveForm(guildId, { open: Boolean(payload.open) }, ts);
        schedule(guildId);
        return saved(row.action);
      }
      if (row.action === "set_form_style") {
        const valid = validateFormStyle(payload);
        if (!valid.ok) return deny(row.action, valid);
        store.saveForm(guildId, {
          heading: valid.style.heading,
          emoji: valid.style.emoji,
          intro: valid.style.intro,
          banner_url: valid.style.bannerUrl,
          button_emoji: valid.style.buttonEmoji,
        }, ts);
        schedule(guildId);
        return saved(row.action);
      }
      if (row.action === "set_form_question") {
        if (payload.restore) {
          if (store.listQuestions(guildId).length) return deny(row.action, { code: "question_limit" });
          for (const question of DEFAULT_QUESTIONS) {
            store.insertQuestion({
              id: randomUUID(),
              guildId,
              position: store.nextQuestionPosition(guildId),
              prompt: question.prompt,
              hint: question.hint,
              kind: question.kind,
              required: question.required,
              maxLength: question.kind === "long" ? 1000 : 200,
              now: ts,
            });
          }
          return saved(row.action);
        }
        const valid = validateQuestionInput(payload);
        if (!valid.ok) return deny(row.action, valid);
        if (payload.id) {
          if (!store.saveQuestion(guildId, payload.id, { ...valid, now: ts })) return deny(row.action, { code: "question_invalid" });
        } else {
          if (store.listQuestions(guildId).length >= MAX_QUESTIONS) return deny(row.action, { code: "question_limit" });
          store.insertQuestion({ id: randomUUID(), guildId, position: store.nextQuestionPosition(guildId), ...valid, now: ts });
        }
        return saved(row.action);
      }
      if (row.action === "remove_form_question") {
        if (!store.deleteQuestion(guildId, payload.id)) return deny(row.action, { code: "question_invalid" });
        return saved(row.action);
      }
      if (row.action === "move_form_question") {
        store.moveQuestion(guildId, payload.id, payload.direction);
        return saved(row.action);
      }
      if (row.action === "cancel_application") {
        const removed = store.deleteApplication(guildId, payload.applicationId);
        if (!removed.ok) return deny(row.action, { code: "application_busy" });
        return done(row.action, "application_cancelled");
      }
      if (row.action === "delete_application") {
        if (payload.scope === "own") {
          const application = store.getApplication(guildId, payload.applicationId);
          const removed = store.deleteOwnApplications(guildId, application.applicant_id);
          if (!removed.ok) return deny(row.action, removed);
          for (const item of removed.applications) {
            if (item.review_message_id && discord.deleteMessage) {
              try {
                await discord.deleteMessage(item.review_channel_id, item.review_message_id);
              } catch {
                // O registro já saiu. Um clique antigo encontra candidatura ausente.
              }
            }
          }
          return done(row.action, "application_deleted");
        }
        const removed = store.deleteApplication(guildId, payload.applicationId);
        if (!removed.ok) return deny(row.action, { code: "application_busy" });
        if (removed.application.review_message_id && discord.deleteMessage) {
          try {
            await discord.deleteMessage(removed.application.review_channel_id, removed.application.review_message_id);
          } catch {
            // idem
          }
        }
        return done(row.action, "application_deleted");
      }
      if (row.action === "submit_application") {
        const form = store.getForm(guildId);
        if (!form?.open) return deny(row.action, { code: "applications_closed" });
        const application = store.getApplication(guildId, payload.applicationId);
        if (!application || application.status !== "draft") return deny(row.action, { code: "application_missing" });
        const questions = store.listQuestions(guildId);
        const answers = application.draft?.answers ?? {};
        if (firstIncompleteStep(questions, answers) < stepsOf(questions).length) return deny(row.action, { code: "application_step" });
        const check = await inspectPrivate(form.review_channel_id, guildId);
        if (!check.ok) return deny(row.action, check);
        const snapshot = snapshotOf(questions, answers);
        if (!store.submitApplication({
          guildId,
          id: application.id,
          applicantId: application.applicant_id,
          snapshot,
          reviewChannelId: form.review_channel_id,
          now: ts,
        })) return deny(row.action, { code: "application_exists" });
        const submitted = store.getApplication(guildId, application.id);
        const posted = await postReview(submitted);
        return done(row.action, posted.ok ? "application_submitted" : "application_panel_pending", { application: store.getApplication(guildId, application.id) });
      }
      if (row.action === "reject_application") {
        const valid = validateDecisionReason(payload.reason);
        if (!valid.ok) return deny(row.action, valid);
        const result = store.rejectApplication({ guildId, id: payload.applicationId, reviewerId: row.moderator_id, reason: valid.reason, now: ts });
        if (!result.ok) return deny(row.action, result);
        const sent = result.idempotent ? result.application.notify_state === "sent" : await notify(result.application);
        if (!result.idempotent) store.setNotifyState(guildId, result.application.id, sent ? "sent" : "failed");
        await editReview(store.getApplication(guildId, payload.applicationId));
        return done(row.action, sent || result.application.notify_state === "sent" ? "application_rejected" : "application_rejected_unnotified", { application: store.getApplication(guildId, payload.applicationId) });
      }
      if (row.action === "approve_application") {
        const current = store.getApplication(guildId, payload.applicationId);
        if (!current) return deny(row.action, { code: "application_missing" });
        if (current.status === "approved" && current.role_applied) return done(row.action, current.notify_state === "failed" ? "application_approved_unnotified" : "application_approved", { application: current });
        const locked = current.status === "approving"
          ? { ok: true, retry: true, application: current }
          : store.lockApproval({ guildId, id: current.id, reviewerId: row.moderator_id, now: ts });
        if (!locked.ok) return deny(row.action, locked);
        if (locked.done) return done(row.action, "application_approved", { application: locked.application });
        return grantSerialized(store.getApplication(guildId, current.id), row.moderator_id);
      }
      return deny(row.action, { code: "unknown_action" });
    },
    async recover() {
      store.releasePosting();
      for (const application of store.listApprovingApplications()) {
        try {
          await grantSerialized(application, application.decision_by || application.claimed_by, { revert: false });
        } catch {
          // A próxima subida tenta de novo, sem segunda candidatura.
        }
      }
      for (const application of store.listUnpostedApplications()) {
        try {
          await postReview(application);
        } catch {
          // idem
        }
      }
    },
  };
}
