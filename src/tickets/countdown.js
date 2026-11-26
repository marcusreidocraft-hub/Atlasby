import { ContainerBuilder } from "discord.js";
import { notice, text, V2_EPHEMERAL } from "../panels/ui.js";
import { renderTicketCreated } from "./panel.js";

const STEPS = [5, 4, 3, 2, 1];

export function countdownBar(step) {
  const current = Math.min(5, Math.max(1, Number(step) || 1));
  const filled = 6 - current;
  return `${"▰".repeat(filled)}${"▱".repeat(5 - filled)}`;
}

export function renderTicketCountdown(step) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(text([
    "## Preparando seu atendimento",
    `# ${step}`,
    countdownBar(step),
    "Estamos abrindo o seu canal.",
  ].join("\n")));
  return { components: [root], flags: V2_EPHEMERAL };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function playCountdown(edit, { delay = 1000, steps = STEPS, sleep = defaultSleep, now = Date.now, gate = { closed: false } } = {}) {
  for (const step of steps) {
    if (gate.closed) return;
    const started = now();
    await edit(renderTicketCountdown(step));
    if (gate.closed || !delay) continue;
    const remain = delay - (now() - started);
    if (remain > 0) await sleep(remain);
  }
}

export async function announceTicket(interaction, settings, work, { delay = 1000, sleep, now } = {}) {
  const gate = { closed: false };
  const job = Promise.resolve().then(work);
  await playCountdown(async (view) => {
    if (gate.closed) return;
    await interaction.editReply({
      components: view.components,
      flags: V2_EPHEMERAL,
      allowedMentions: { parse: [] },
    });
  }, { delay, sleep, now, gate });
  let result;
  try {
    result = await job;
  } catch (error) {
    console.error(`Ticket: ${error instanceof Error ? error.message : "erro"}`);
    result = { ok: false };
  }
  gate.closed = true;
  const view = result?.ok
    ? renderTicketCreated(result.url, settings, { existing: Boolean(result.existing) })
    : notice(result?.error || "Não foi possível abrir o atendimento. Tente de novo em instantes.");
  await interaction.editReply({
    components: view.components,
    flags: V2_EPHEMERAL,
    allowedMentions: { parse: [] },
  });
  return result;
}
