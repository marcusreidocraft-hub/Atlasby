const ZONE = "America/Sao_Paulo";

export const PLAN_DAYS = Object.freeze({ semanal: 7, quinzenal: 15, mensal: 30 });
export const PLAN_LABEL = Object.freeze({ semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" });
export const GPUS = Object.freeze(["Tesla T4", "NVIDIA A10", "RTX 2050", "RTX 3060", "RTX 3090", "RTX 4070", "RTX 4090"]);

function parts(ms) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return values;
}

function offsetMinutes(utcMs) {
  const value = parts(utcMs);
  const asUtc = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second));
  return Math.round((asUtc - utcMs) / 60_000);
}

export function zonedToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - offsetMinutes(guess) * 60_000;
  return guess - offsetMinutes(first) * 60_000;
}

export function formatStamp(ms) {
  if (!ms) return "nunca";
  const value = parts(ms);
  return `${value.day}/${value.month}/${value.year}, ${value.hour}:${value.minute}`;
}

export function formatDate(ms) {
  const value = parts(ms);
  return `${value.day}/${value.month}/${value.year}`;
}

export function startOfToday(now) {
  const value = parts(now);
  return zonedToUtc(Number(value.year), Number(value.month), Number(value.day), 0, 0, 0);
}

export function parseDate(input) {
  const text = String(input ?? "").trim();
  const match = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4}))(?:[ T](\d{2}):(\d{2}))?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1] || match[6]);
  const month = Number(match[2] || match[5]);
  const day = Number(match[3] || match[4]);
  const hour = match[7] === undefined ? 0 : Number(match[7]);
  const minute = match[8] === undefined ? 0 : Number(match[8]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utc = zonedToUtc(year, month, day, hour, minute, 0);
  const back = parts(utc);
  if (Number(back.year) !== year || Number(back.month) !== month || Number(back.day) !== day || Number(back.hour) !== hour || Number(back.minute) !== minute) return null;
  return utc;
}

export function expiryFrom(start, plan) {
  const days = PLAN_DAYS[plan];
  if (!days) return null;
  return start + days * 24 * 60 * 60 * 1000;
}

export function remainingLabel(now, expires) {
  const delta = expires - now;
  if (delta <= 0) return "vencido";
  const minutes = Math.floor(delta / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return `${days}d ${hours}h ${mins}min`;
}

export function planStatus(now, expires) {
  return now < expires ? "Ativo" : "Vencido";
}

export function powerLabel(status) {
  if (status === "ligada") return "Ligada";
  if (status === "desligada") return "Desligada";
  return "Desconhecida";
}
