import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");

let renderer;

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function ensureRenderer() {
  if (!renderer) {
    renderer = (async () => {
      const wasm = await import("@resvg/resvg-wasm");
      await wasm.initWasm(readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
      const [regular, semibold] = await Promise.all([
        readFile(path.join(fontsDir, "Inter-Regular.ttf")),
        readFile(path.join(fontsDir, "Inter-SemiBold.ttf")),
      ]);
      return { Resvg: wasm.Resvg, regular, semibold };
    })();
  }
  return renderer;
}

export function vmCardSvg(card) {
  const status = escapeXml(card.status || "Desconhecida");
  const headline = escapeXml(card.headline || "GPU não informada");
  const ip = escapeXml(card.ip || "não informado");
  const time = escapeXml(card.time || "não informado");
  const plan = escapeXml(card.plan || "não informado");
  const consulted = escapeXml(card.consulted || "nunca");
  const statusColor = card.status === "Ligada" ? "#d6d6d6" : "#8d8d8d";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="920" height="560" viewBox="0 0 920 560">
  <rect width="920" height="560" rx="28" fill="#0a0a0a"/>
  <text x="48" y="78" fill="#f5f5f5" font-family="Inter" font-size="40" font-weight="600">Atlas</text>
  <text x="48" y="112" fill="#8a8a8a" font-family="Inter" font-size="18">Seu poder em nuvem</text>
  <text x="872" y="86" fill="${statusColor}" font-family="Inter" font-size="20" font-weight="600" text-anchor="end">${status}</text>
  <text x="48" y="196" fill="#f5f5f5" font-family="Inter" font-size="34" font-weight="600">${headline}</text>
  <text x="48" y="268" fill="#8a8a8a" font-family="Inter" font-size="15">IP público</text>
  <text x="500" y="268" fill="#8a8a8a" font-family="Inter" font-size="15">Tempo do plano</text>
  <text x="48" y="304" fill="#f3f3f3" font-family="Inter" font-size="22" font-weight="600">${ip}</text>
  <text x="500" y="304" fill="#f3f3f3" font-family="Inter" font-size="22" font-weight="600">${time}</text>
  <text x="48" y="372" fill="#8a8a8a" font-family="Inter" font-size="15">Plano</text>
  <text x="500" y="372" fill="#8a8a8a" font-family="Inter" font-size="15">Última consulta da VM</text>
  <text x="48" y="408" fill="#f3f3f3" font-family="Inter" font-size="22" font-weight="600">${plan}</text>
  <text x="500" y="408" fill="#f3f3f3" font-family="Inter" font-size="22" font-weight="600">${consulted}</text>
  <text x="48" y="488" fill="#8a8a8a" font-family="Inter" font-size="15">Use os botões abaixo para controlar sua máquina.</text>
  <text x="48" y="514" fill="#8a8a8a" font-family="Inter" font-size="15">Instância Spot: se desligar inesperadamente, tente ligá-la novamente.</text>
</svg>`;
}

export async function renderVmCardPng(card) {
  const { Resvg, regular, semibold } = await ensureRenderer();
  const svg = vmCardSvg(card);
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: 920 },
    font: {
      fontBuffers: [regular, semibold],
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
    },
    background: "#0a0a0a",
  });
  try {
    return Buffer.from(image.render().asPng());
  } finally {
    image.free();
  }
}
