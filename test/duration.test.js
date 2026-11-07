import assert from "node:assert/strict";
import test from "node:test";
import { DURATION_LIMITS, parseDuration } from "../src/duration.js";

test("aceita duração explícita dentro do limite do Discord", () => {
  assert.equal(parseDuration("5s").ms, 5_000);
  assert.equal(parseDuration(" 10m ").ms, 600_000);
  assert.equal(parseDuration("2h").ms, 7_200_000);
  assert.equal(parseDuration("28d").ms, DURATION_LIMITS.maxMs);
  assert.equal(parseDuration("672h").ms, DURATION_LIMITS.maxMs);
  assert.equal(parseDuration("2419200s").ms, DURATION_LIMITS.maxMs);
});

test("rejeita duração ausente, ambígua ou fora do intervalo", () => {
  for (const value of ["", "10", "10M", "10 m", "1w", "1.5h", "0s", "-1s", "4s", "29d", "673h", null, 600]) {
    const result = parseDuration(value);
    assert.equal(result.ok, false, String(value));
  }
  assert.equal(parseDuration("4s").code, "duration_min");
  assert.equal(parseDuration("29d").code, "duration_max");
  assert.equal(parseDuration("10").code, "duration_format");
});
