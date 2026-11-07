const DURATION = /^(\d{1,7})(s|m|h|d)$/;
const SECOND = 1000;
const MIN_MS = 5 * SECOND;
const MAX_MS = 28 * 24 * 60 * 60 * SECOND;
const UNIT_MS = {
  s: SECOND,
  m: 60 * SECOND,
  h: 60 * 60 * SECOND,
  d: 24 * 60 * 60 * SECOND,
};

export function parseDuration(input) {
  if (typeof input !== "string") return { ok: false, code: "duration_format" };
  const match = DURATION.exec(input.trim());
  if (!match) return { ok: false, code: "duration_format" };
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, code: "duration_format" };
  const ms = amount * UNIT_MS[match[2]];
  if (!Number.isSafeInteger(ms)) return { ok: false, code: "duration_format" };
  if (ms < MIN_MS) return { ok: false, code: "duration_min" };
  if (ms > MAX_MS) return { ok: false, code: "duration_max" };
  return { ok: true, ms };
}

export const DURATION_LIMITS = Object.freeze({ minMs: MIN_MS, maxMs: MAX_MS });
