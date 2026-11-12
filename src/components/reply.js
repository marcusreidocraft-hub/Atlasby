import { notice, V2, V2_EPHEMERAL } from "../panels/ui.js";

export async function ack(interaction, update) {
  if (interaction.deferred || interaction.replied) return;
  if (update) {
    await interaction.deferUpdate();
    interaction.atlasMode = "update";
  } else {
    await interaction.deferReply({ flags: V2_EPHEMERAL });
    interaction.atlasMode = "reply";
  }
}

export async function present(interaction, payload) {
  const flags = interaction.atlasMode === "update" ? V2 : V2_EPHEMERAL;
  const body = { components: payload.components, flags, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) await interaction.editReply(body);
  else await interaction.reply(body);
}

export function logInteractionError(error) {
  const name = error?.name ?? "Error";
  const message = error instanceof Error ? error.message : String(error ?? "erro");
  const code = error?.code;
  console.error(`Falha ao processar interação: ${name}${code === undefined ? "" : ` [${code}]`}: ${message}`);
  if (error?.rawError) console.error(JSON.stringify(error.rawError));
}

export async function fail(interaction, accent) {
  const payload = notice("A ação não foi concluída. Tente de novo. Nenhum botão fica preso se esta mensagem aparecer.", accent);
  try {
    await present(interaction, payload);
  } catch {
    // A interação já expirou.
  }
}

export function actorFrom(interaction) {
  const member = interaction.member;
  const permissions = member?.permissions?.bitfield ?? member?.permissions ?? 0n;
  const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : Array.isArray(member?.roles) ? member.roles : [];
  return {
    id: interaction.user.id,
    guildId: interaction.guildId,
    permissions,
    roleIds,
    owner: interaction.guild?.ownerId === interaction.user.id,
  };
}
