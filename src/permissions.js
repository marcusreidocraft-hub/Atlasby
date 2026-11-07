export const Permissions = Object.freeze({
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageGuild: 1n << 5n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  ModerateMembers: 1n << 40n,
});

export const BOT_INVITE_PERMISSIONS =
  Permissions.KickMembers |
  Permissions.BanMembers |
  Permissions.ViewChannel |
  Permissions.SendMessages |
  Permissions.EmbedLinks |
  Permissions.ModerateMembers;

export function hasPermission(bits, flag) {
  let value;
  try {
    value = BigInt(bits ?? 0);
  } catch {
    return false;
  }
  if ((value & Permissions.Administrator) === Permissions.Administrator) return true;
  return (value & BigInt(flag)) === BigInt(flag);
}

export function requiredPermission(action) {
  switch (action) {
    case "warn":
    case "timeout":
    case "timeout_remove":
      return Permissions.ModerateMembers;
    case "kick":
      return Permissions.KickMembers;
    case "ban":
      return Permissions.BanMembers;
    case "set_log_channel":
      return Permissions.ManageGuild;
    default:
      return null;
  }
}

function fail(code) {
  return { ok: false, code };
}

function validPosition(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function evaluateModeration(input) {
  if (input.actorId === input.targetId) return fail("self_protected");
  if (input.targetId === input.botId) return fail("bot_protected");
  if (input.targetIsOwner) return fail("owner_protected");
  if (hasPermission(input.targetPermissions, Permissions.Administrator)) {
    return fail("privileged_protected");
  }

  const needed = requiredPermission(input.action);
  if (!needed) return fail("unknown_action");
  if (!input.actorIsOwner && !hasPermission(input.actorPermissions, needed)) return fail("actor_permission");
  if (!hasPermission(input.botPermissions, needed)) return fail("bot_permission");

  if (!validPosition(input.targetHighestPosition) || !validPosition(input.botHighestPosition)) {
    return fail("hierarchy_unknown");
  }
  if (!input.actorIsOwner && !validPosition(input.actorHighestPosition)) {
    return fail("hierarchy_unknown");
  }
  if (!input.actorIsOwner && !(input.actorHighestPosition > input.targetHighestPosition)) {
    return fail("actor_hierarchy");
  }
  const botOutranks = input.botIsOwner || input.botHighestPosition > input.targetHighestPosition;
  if (!botOutranks) return fail("bot_hierarchy");
  return { ok: true };
}

export function evaluateLogConfig(input) {
  if (!hasPermission(input.actorPermissions, Permissions.ManageGuild)) return fail("actor_permission");
  return { ok: true };
}

export function canPostLogs(bits) {
  return [Permissions.ViewChannel, Permissions.SendMessages, Permissions.EmbedLinks].every((flag) =>
    hasPermission(bits, flag),
  );
}
