import { buttonEmoji } from "../services/emojis.js";

export const PURCHASE_CATEGORY = Object.freeze({
  id: "compra",
  title: "Compra",
  description: "Pedido da loja da Ignix Cloud PC.",
  emoji: "cash",
});

export function ticketCategory(id) {
  return TICKET_CATEGORIES[id] || (id === "compra" ? PURCHASE_CATEGORY : { id, title: String(id || "Atendimento"), description: "", emoji: "ticket" });
}

export const TICKET_CATEGORIES = Object.freeze({
  suporte: {
    id: "suporte",
    title: "Suporte",
    description: "Ajuda com acesso, máquinas, sessões ou problemas técnicos.",
    emoji: "tools",
  },
  parcerias: {
    id: "parcerias",
    title: "Parcerias",
    description: "Propostas comerciais, criadores e oportunidades de parceria.",
    emoji: "partner",
  },
  outros: {
    id: "outros",
    title: "Outros",
    description: "Assuntos que não se encaixam nas categorias anteriores.",
    emoji: "settings",
  },
});

export const DEFAULT_TICKET_HOURS = "Horário de atendimento: Seg-sex: 08:00-22:00 · Sáb-dom: sem restrição de horário";

export const TICKET_EMOJI = Object.freeze({
  tools: "<:tools:1568512989924171796>",
  partner: "<:74424partner:1568512651829584004>",
  settings: "<:dgear:1568512697002098728>",
  ticket: "<:49457ticket:1568512619722309644>",
  link: "<:externallink:1568512703763324971>",
  pencil: "<:pencil:1568512341904064563>",
  bell: "<:bell:1568512976737013790>",
  close: "<:disactiv:1568512700739362897>",
  channel: "<:1710channel:1568512599770009724>",
  add: "<:1906add:1568512602873794594>",
  member: "<:47106member:1568512616584843324>",
  cash: "<:cash:1568512689754349651>",
  timer: "<:timer:1568512986484711425>",
  warning: "<:5577warning:1568512629847101531>",
  staff: "<:91750staff:1568512667415609406>",
});

export const TICKET_EMOJI_SLOTS = Object.freeze(["suporte", "parcerias", "outros", "abrir", "acessar", "motivo", "chamar", "fechar", "voz", "adicionar", "remover", "pagamento", "horario", "erro", "titulo"]);

const SLOT_KEY = Object.freeze({
  suporte: "tools",
  parcerias: "partner",
  outros: "settings",
  compra: "cash",
  abrir: "ticket",
  acessar: "link",
  motivo: "pencil",
  chamar: "bell",
  fechar: "close",
  voz: "channel",
  adicionar: "add",
  remover: "member",
  pagamento: "cash",
  horario: "timer",
  erro: "warning",
  titulo: "ticket",
});

export function ticketMark(slot, overrides = {}) {
  const custom = String(overrides?.[slot] ?? "").trim();
  if (/^<a?:[\w]+:\d+>$/.test(custom)) return custom;
  return TICKET_EMOJI[SLOT_KEY[slot]] || "";
}

export function ticketEmojiObject(token) {
  const parsed = buttonEmoji(token);
  return parsed && typeof parsed === "object" ? parsed : undefined;
}

export function ticketChannelName(category, username, number) {
  const user = String(username ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 20) || "membro";
  return `${category}-${user}-${number}`.slice(0, 100);
}

export function ticketHours(settings) {
  const text = String(settings?.ticket?.hours ?? "").trim();
  return text || DEFAULT_TICKET_HOURS;
}
