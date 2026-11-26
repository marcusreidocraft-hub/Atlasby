const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function publicIpv4(value) {
  const ip = String(value ?? "").trim();
  return IPV4.test(ip) ? ip : "";
}

export function createSunshineAgent({ secret = "", port = 7474, timeoutMs = 12_000, healthTimeoutMs = 3_000, fetchImpl = globalThis.fetch } = {}) {
  async function call(ip, path, { method = "POST", body = null, timeout = timeoutMs } = {}) {
    const target = publicIpv4(ip);
    if (!secret) return { ok: false, error: "unconfigured" };
    if (!target) return { ok: false, error: "noip" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(`http://${target}:${port}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || payload?.ok !== true) return { ok: false, error: "sunshine" };
      return { ok: true, result: payload.result ?? "" };
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") return { ok: false, error: "timeout" };
      return { ok: false, error: "offline" };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configured: Boolean(secret),
    releasePin(ip, pin) {
      return call(ip, "/pin", { body: { pin: String(pin) } });
    },
    unpairAll(ip) {
      return call(ip, "/unpair-all", { body: {} });
    },
    health(ip) {
      return call(ip, "/health", { method: "GET", timeout: healthTimeoutMs });
    },
  };
}
