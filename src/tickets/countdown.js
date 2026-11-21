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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function playCountdown(edit, { delay = 1000, steps = STEPS } = {}) {
  for (const step of steps) {
    await edit(renderTicketCountdown(step));
    if (delay) await sleep(delay);
  }
}

export async function announceTicket(interaction, settings, work, { delay = 1000 } = {}) {
  const job = Promise.resolve().then(work);
  await playCountdown((view) => interaction.editReply({
    components: view.components,
    flags: V2_EPHEMERAL,
    allowedMentions: { parse: [] },
  }), { delay });
  let result;
  try {
    result = await job;
  } catch (error) {
    console.error(`Ticket: ${error instanceof Error ? error.message : "erro"}`);
    result = { ok: false };
  }
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
