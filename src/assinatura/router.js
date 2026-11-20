import { actorFrom, present } from "../components/reply.js";
import { notice, V2_EPHEMERAL } from "../panels/ui.js";
import { QUOTA_REGIONS } from "./model.js";
import { renderSubscription } from "./panel.js";

export async function routeSubscriptionCommand(interaction, app) {
  const view = await app.subscription.report({ location: app.config.azure.location, force: false });
  await present(interaction, renderSubscription(view, app.config.panelColor));
}

export async function routeSubscriptionComponent(interaction, app) {
  const id = interaction.customId ?? "";
  const move = /^atlas:assinatura:(refresh|force):([a-z0-9]+)$/.exec(id);
  if (id !== "atlas:assinatura:region" && !move) return false;
  const actor = actorFrom(interaction);
  if (!app.admin.isAdmin(actor)) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: V2_EPHEMERAL });
    await present(interaction, notice("Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode fazer isso.", app.config.panelColor));
    return true;
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
    interaction.atlasMode = "update";
  }
  const location = move?.[2] || interaction.values?.[0];
  const place = QUOTA_REGIONS.includes(location) ? location : app.config.azure.location;
  const view = await app.subscription.report({ location: place, force: move?.[1] === "force" });
  await present(interaction, renderSubscription(view, app.config.panelColor));
  return true;
}
