import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashResellerKey(token) {
  return createHash("sha256").update(String(token ?? "")).digest();
}

export function generateResellerKey() {
  const token = `ignx_rs_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashResellerKey(token).toString("hex") };
}

export function resellerKeysMatch(storedHex, token) {
  const given = hashResellerKey(token);
  let stored;
  try {
    stored = Buffer.from(String(storedHex ?? ""), "hex");
  } catch {
    stored = Buffer.alloc(0);
  }
  if (stored.length !== given.length) {
    timingSafeEqual(given, given);
    return false;
  }
  return timingSafeEqual(stored, given);
}

export function createRateLimit({ limit = 30, windowMs = 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    allow(key) {
      const time = now();
      const recent = (hits.get(key) || []).filter((at) => time - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(time);
      hits.set(key, recent);
      return true;
    },
  };
}
