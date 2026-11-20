import { ActionRowBuilder, ButtonStyle, ContainerBuilder, StringSelectMenuBuilder } from "discord.js";
import { press, separator, text, V2_EPHEMERAL } from "../panels/ui.js";
import { formatAmount, formatCount, QUOTA_REGIONS, regionLabel, T4_FAMILY, usageBar } from "./model.js";

function money(value, currency) {
  return `${formatAmount(value)}${currency ? ` ${currency}` : ""}`;
}

function quotaLine(label, row) {
  if (!row) return `${label}: não aparece nesta região.`;
  return `${label}: ${formatCount(row.used)} / ${formatCount(row.limit)}\n\`${usageBar(row.used, row.limit)}\``;
}

function costText(cost) {
  if (cost?.error === "forbidden") return "Sem permissão para ler o custo. Peça a função Leitor ou Cost Management Reader na assinatura.";
  if (cost?.error === "throttled") return "A Azure limitou as consultas de custo. Use Atualizar daqui a alguns minutos ou Forçar mais tarde.";
  if (cost?.error) return "A consulta de custo não respondeu.";
  const lines = [
    `Este mês: ${money(cost?.current, cost?.currency)}`,
    `Mês anterior: ${money(cost?.previous, cost?.currency)}`,
  ];
  if (cost?.currency) lines.push(`Moeda: ${cost.currency}`);
  if (cost?.top?.length) {
    lines.push("Serviços neste mês:");
    cost.top.forEach((item, index) => lines.push(`${index + 1}. ${item.name} · ${money(item.cost, cost.currency)}`));
  } else lines.push("Sem serviços neste mês.");
  return lines.join("\n");
}

function subscriptionText(subscription) {
  if (subscription?.error === "forbidden") return "Sem permissão para ler a assinatura. Peça a função Leitor.";
  if (subscription?.error) return "A assinatura não respondeu.";
  const offer = [subscription.offer, subscription.quotaId].filter(Boolean).join(" · ");
  return [
    `Nome: ${subscription.name}`,
    `ID: ${subscription.shortId}`,
    `Estado: ${subscription.stateLabel}`,
    offer ? `Oferta: ${offer}` : "",
    `Tenant: ${subscription.tenant}`,
  ].filter(Boolean).join("\n");
}

function quotaText(quota) {
  if (quota?.error === "forbidden") return "Sem permissão para ler a cota de compute.";
  if (quota?.error === "throttled") return "A Azure limitou a consulta de cota.";
  if (quota?.error) return "A cota não foi consultada.";
  return [
    quotaLine("Low-priority vCPU", quota?.low),
    quotaLine("vCPU regional", quota?.cores),
    quotaLine(`NCASv3_T4 (${T4_FAMILY})`, quota?.family),
  ].join("\n");
}

export function renderSubscription(view, accent) {
  if (!view?.configured) {
    const root = new ContainerBuilder().setAccentColor(accent);
    root.addTextDisplayComponents(text("## Ignix\nDefina as credenciais Azure no host para consultar a assinatura."));
    return { components: [root], flags: V2_EPHEMERAL };
  }
  const place = view.location;
  const balance = view.balance ? `Saldo restante: ${money(view.balance.remaining, view.balance.currency)}` : "";
  const root = new ContainerBuilder().setAccentColor(accent);
  root.addTextDisplayComponents(text([
    "## Ignix",
    "Assinatura",
    subscriptionText(view.subscription),
  ].join("\n")));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(["Custo", costText(view.cost), balance].filter(Boolean).join("\n")));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text([
    `Cota · ${regionLabel(place)}`,
    quotaText(view.quota),
    view.cached ? "Consulta em cache." : "",
  ].filter(Boolean).join("\n")));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press(`atlas:assinatura:refresh:${place}`, "Atualizar", ButtonStyle.Primary),
    press(`atlas:assinatura:force:${place}`, "Forçar", ButtonStyle.Secondary),
  ));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("atlas:assinatura:region")
      .setPlaceholder(regionLabel(place))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(QUOTA_REGIONS.map((region) => ({ label: regionLabel(region), value: region }))),
  ));
  return { components: [root], flags: V2_EPHEMERAL };
}
