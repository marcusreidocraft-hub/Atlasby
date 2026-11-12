import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWyviSignature(raw, headers, secret, now = Date.now()) {
  const stamp = String(headers?.["x-wyvi-carimbo"] ?? "");
  const given = String(headers?.["x-wyvi-assinatura"] ?? "").replace(/^v1=/, "");
  if (!secret || !stamp || !/^\d+$/.test(stamp) || !/^[0-9a-f]+$/i.test(given)) return false;
  if (Math.abs(now / 1000 - Number(stamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function chargeReference(body) {
  return body?.referencia || body?.cobranca?.referencia || body?.data?.referencia || "";
}

export function chargeCents(body) {
  const value = body?.valor_centavos ?? body?.cobranca?.valor_centavos ?? body?.data?.valor_centavos;
  return Number.isInteger(value) ? value : null;
}

export function createWyviClient({ apiKey, baseUrl = "https://api.wyvipay.com.br", fetchImpl = globalThis.fetch }) {
  return {
    configured: Boolean(apiKey),
    async createCharge({ cents, description, reference, idempotencyKey }) {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/v2/cobrancas`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          valor_centavos: cents,
          descricao: description,
          referencia: reference,
          expira_em_segundos: 3600,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error("wyvi");
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return {
        id: body.id || "",
        copiaECola: body.pix?.copia_e_cola || body.copia_e_cola || "",
        qrcode: body.pix?.qrcode || body.qrcode || "",
      };
    },
  };
}
