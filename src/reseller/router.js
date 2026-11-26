import { actorFrom } from "../components/reply.js";
import { present } from "../components/reply.js";
import { hasAdministrator } from "./service.js";

export async function routeResellerCommand(interaction, app, actor) {
  if (!hasAdministrator(actor)) {
    await present(interaction, app.resellers.list(interaction.guildId, { id: "0", permissions: 0n, roleIds: [], owner: false }));
    return;
  }
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (sub === "criar") {
    const result = app.resellers.create(guildId, actor, interaction.options.getString("nome"));
    await present(interaction, result.payload);
    return;
  }
  if (sub === "listar") {
    await present(interaction, app.resellers.list(guildId, actor));
    return;
  }
  if (sub === "revogar") {
    await present(interaction, await app.resellers.revoke(guildId, actor, interaction.options.getString("revendedor")));
    return;
  }
  if (sub === "girar-chave") {
    const result = await app.resellers.rotate(guildId, actor, interaction.options.getString("revendedor"));
    await present(interaction, result.payload);
    return;
  }
  if (sub === "atribuir-vm") {
    await present(interaction, await app.resellers.assign(
      guildId,
      actor,
      interaction.options.getString("revendedor"),
      interaction.options.getString("vm"),
    ));
    return;
  }
  if (sub === "remover-vm") {
    await present(interaction, await app.resellers.unassign(
      guildId,
      actor,
      interaction.options.getString("revendedor"),
      interaction.options.getString("vm"),
    ));
  }
}

export async function routeResellerAutocomplete(interaction, app) {
  const actor = actorFrom(interaction);
  if (!hasAdministrator(actor)) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name === "revendedor") {
    const rows = app.resellers.search(interaction.guildId, focused.value);
    await interaction.respond(rows.slice(0, 25).map((item) => ({ name: item.name.slice(0, 100), value: item.id })));
    return;
  }
  if (focused.name === "vm") {
    const choices = await app.resellers.vmOptions(
      interaction.guildId,
      interaction.options.getSubcommand(),
      interaction.options.getString("revendedor") || "",
      focused.value,
    );
    await interaction.respond(choices);
  }
}
