import { validateEmoji, validateMediaUrl, rewriteDefaultBrand } from "./style.js";

export const MAX_QUESTIONS = 15;
export const STEP_SIZE = 5;
export const MAX_REVIEWERS = 5;
export const PRIVACY_LINE = "Só avaliadores autorizados leem as respostas. Elas não são publicadas em canal público.";

export const DEFAULT_QUESTIONS = Object.freeze([
  Object.freeze({ prompt: "Por que quer entrar na equipe?", hint: "Motivação, sem dados pessoais.", kind: "long", required: true }),
  Object.freeze({ prompt: "Experiência com comunidade?", hint: "Atendimento ou projetos, se houver.", kind: "long", required: true }),
  Object.freeze({ prompt: "Disponibilidade semanal?", hint: "Dias e horários em que pode ajudar.", kind: "short", required: true }),
]);

export const FORM_ACTIONS = new Set([
  "submit_application",
  "cancel_application",
  "delete_application",
  "approve_application",
  "reject_application",
  "set_form_panel",
  "set_form_review",
  "set_form_role",
  "set_form_reviewer",
  "set_form_open",
  "set_form_style",
  "set_form_question",
  "remove_form_question",
  "move_form_question",
]);

const MENTION = /@everyone|@here|<@/;

export function answerLimit(kind) {
  return kind === "long" ? 1000 : 200;
}

export function stepsOf(questions) {
  const steps = [];
  for (let index = 0; index < questions.length; index += STEP_SIZE) steps.push(questions.slice(index, index + STEP_SIZE));
  return steps;
}

export function validateQuestionInput({ prompt, hint, kind, required }) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.trim().length > 45 || MENTION.test(prompt)) {
    return { ok: false, code: "question_invalid" };
  }
  if (hint != null && hint !== "" && (typeof hint !== "string" || hint.trim().length > 100 || MENTION.test(hint))) {
    return { ok: false, code: "question_invalid" };
  }
  if (kind !== "short" && kind !== "long") return { ok: false, code: "question_invalid" };
  return {
    ok: true,
    prompt: prompt.trim(),
    hint: hint?.trim() ? hint.trim() : null,
    kind,
    required: Boolean(required),
    maxLength: answerLimit(kind),
  };
}

export function parseQuestionFields(kindText, requiredText) {
  const kind = String(kindText ?? "").trim().toLowerCase();
  const required = String(requiredText ?? "").trim().toLowerCase();
  if (!["curta", "longa"].includes(kind)) return { ok: false, code: "question_invalid" };
  if (!["sim", "nao", "não"].includes(required)) return { ok: false, code: "question_invalid" };
  return { ok: true, kind: kind === "longa" ? "long" : "short", required: required === "sim" };
}

export function validateAnswers(questions, input) {
  const answers = {};
  for (const question of questions) {
    const raw = input?.[question.id];
    const text = typeof raw === "string" ? raw.trim() : "";
    if (question.required && !text) return { ok: false, code: "answer_invalid" };
    if (text.length > question.max_length) return { ok: false, code: "answer_invalid" };
    answers[question.id] = text;
  }
  return { ok: true, answers };
}

export function firstIncompleteStep(questions, answers) {
  const steps = stepsOf(questions);
  for (let index = 0; index < steps.length; index += 1) {
    const valid = validateAnswers(steps[index], answers);
    if (!valid.ok) return index;
  }
  return steps.length;
}

export function validateFormStyle(input) {
  const emoji = validateEmoji(input.emoji);
  if (!emoji.ok) return emoji;
  const button = validateEmoji(input.buttonEmoji);
  if (!button.ok) return button;
  const banner = validateMediaUrl(input.bannerUrl);
  if (!banner.ok) return banner;
  const heading = rewriteDefaultBrand(input.heading ?? "");
  if (heading && (heading.length > 40 || MENTION.test(heading))) return { ok: false, code: "greeting_invalid" };
  const intro = input.intro == null || input.intro === "" ? null : String(input.intro).trim();
  if (intro && (intro.length > 200 || MENTION.test(intro))) return { ok: false, code: "greeting_invalid" };
  return {
    ok: true,
    style: {
      heading: heading || null,
      emoji: emoji.emoji,
      intro,
      bannerUrl: banner.url,
      buttonEmoji: button.emoji,
    },
  };
}

export function validateDecisionReason(reason) {
  if (typeof reason !== "string") return { ok: false, code: "reason_required" };
  const text = reason.trim();
  if (text.length < 5 || text.length > 400 || MENTION.test(text)) return { ok: false, code: "reason_required" };
  return { ok: true, reason: text };
}

export function snapshotOf(questions, answers) {
  return {
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      hint: question.hint,
      kind: question.kind,
      required: question.required,
      position: question.position,
    })),
    answers: Object.fromEntries(questions.map((question) => [question.id, answers[question.id] ?? ""])),
  };
}
