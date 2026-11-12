import { notice, V2, V2_EPHEMERAL } from "../panels/ui.js";

function callerIsAdmin(interaction, config) {
  if (!interaction || !config) return false;
  if (interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user?.id) return true;
  const member = interaction.member;
  const permissions = member?.permissions?.bitfield ?? member?.permissions ?? 0n;
  try {
    if ((BigInt(permissions) & 8n) === 8n) return true;
  } catch {
    return false;
  }
  const roles = member?.roles?.cache ? [...member.roles.cache.keys()] : Array.isArray(member?.roles) ? member.roles : [];
  return roles.some((id) => (config.adminRoleIds || []).includes(id));
}

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
  if (payload.files?.length) body.files = payload.files;
  if (interaction.deferred || interaction.replied) await interaction.editReply(body);
  else await interaction.reply(body);
}

export function publicErrorMessage(error) {
  return String(error instanceof Error ? error.message : error ?? "erro").replace(/Bearer\s+\S+/gi, "Bearer [omitido]").slice(0, 240);
}

export function interactionErrorText(error, admin) {
  const base = "A ação não foi concluída. Tente de novo. Nenhum botão fica preso se esta mensagem aparecer.";
  if (!admin) return base;
  const code = error?.code === undefined || error?.code === null || error?.code === "" ? "erro" : String(error.code).slice(0, 32);
  return `${base} Código: ${code}.`;
}

export function logInteractionError(error) {
  const name = error?.name ?? "Error";
  const message = publicErrorMessage(error);
  const code = error?.code;
  console.error(`Falha ao processar interação: ${name}${code === undefined ? "" : ` [${code}]`}: ${message}`);
  if (error?.rawError) console.error(JSON.stringify(error.rawError));
}

export async function fail(interaction, accent, error = null, app = null) {
  if (error && app?.audit && interaction?.guildId) {
    const code = error.code ?? "erro";
    await app.audit.record({
      guildId: interaction.guildId,
      actorId: interaction.user?.id || "sistema",
      action: "erro_interacao",
      detail: `Interação falhou [${code}]: ${publicErrorMessage(error)}`,
    }).catch(() => {});
  }
  const admin = callerIsAdmin(interaction, app?.config);
  const payload = notice(interactionErrorText(error, admin), accent);
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
