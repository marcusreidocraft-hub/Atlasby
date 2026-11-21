import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { SKUS } from "./products.js";

const sku = (option) => option.setName("produto").setDescription("Produto").setRequired(true).addChoices(
  { name: "T4 4 vCPUs", value: SKUS.t4_4 },
  { name: "T4 8 vCPUs", value: SKUS.t4_8 },
  { name: "T4 16 vCPUs", value: SKUS.t4_16 },
);
const plan = (option) => option.setName("plano").setDescription("Duração").setRequired(true).addChoices(
  { name: "3 horas", value: "3h" },
  { name: "6 horas", value: "6h" },
  { name: "Semanal", value: "semanal" },
  { name: "Quinzenal", value: "quinzenal" },
  { name: "Mensal", value: "mensal" },
);

export function storeCommands() {
  return [
    new SlashCommandBuilder().setName("configurar-atendimento").setDescription("Define cargo, categoria e logs dos tickets.").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("configurar-loja").setDescription("Publica a loja da Ignix Cloud PC.")
      .addSubcommand((sub) => sub.setName("publicar").setDescription("Publica ou atualiza o painel neste canal."))
      .addSubcommand((sub) => sub.setName("compras").setDescription("Ativa ou desativa todas as compras.").addStringOption((option) => option.setName("acao").setDescription("Ativar ou desativar").setRequired(true).addChoices({ name: "Ativar", value: "ativar" }, { name: "Desativar", value: "desativar" })))
      .addSubcommand((sub) => sub.setName("status").setDescription("Mostra disponibilidade, ofertas e o link do painel."))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("criar-oferta").setDescription("Cria uma promoção.")
      .addStringOption(sku).addStringOption(plan)
      .addStringOption((option) => option.setName("preco").setDescription("Preço promocional, como 29,90").setRequired(true))
      .addIntegerOption((option) => option.setName("unidades").setDescription("Unidades promocionais").setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName("inicio").setDescription("AAAA-MM-DD HH:MM").setRequired(true))
      .addStringOption((option) => option.setName("fim").setDescription("AAAA-MM-DD HH:MM").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("remover-oferta").setDescription("Encerra uma oferta.").addStringOption((option) => option.setName("id").setDescription("Oferta ativa").setRequired(true).setAutocomplete(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("configurar-cargo").setDescription("Cargo entregue com o produto.").addStringOption(sku).addRoleOption((option) => option.setName("cargo").setDescription("Cargo").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("configurar-azure").setDescription("Rede e tamanho usados ao criar a VM.")
      .addStringOption(sku)
      .addStringOption((option) => option.setName("grupo").setDescription("Resource group").setRequired(true))
      .addStringOption((option) => option.setName("vnet").setDescription("Rede virtual").setRequired(true))
      .addStringOption((option) => option.setName("subnet").setDescription("Sub-rede").setRequired(true))
      .addStringOption((option) => option.setName("nsg").setDescription("NSG").setRequired(false))
      .addBooleanOption((option) => option.setName("spot").setDescription("Instância Spot").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("configurar-imagem").setDescription("Imagem da galeria. Sem versão, usa a última.")
      .addStringOption((option) => option.setName("tipo").setDescription("Origem").setRequired(true).addChoices(
        { name: "Imagem gerenciada", value: "managed" },
        { name: "Galeria", value: "gallery" },
        { name: "Snapshot", value: "snapshot" },
      ))
      .addStringOption((option) => option.setName("id").setDescription("Resource ID").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("pedidos").setDescription("Lista os pedidos recentes.").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("pedido").setDescription("Mostra um pedido.").addStringOption((option) => option.setName("id").setDescription("ID").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("cancelar-pedido").setDescription("Cancela um pedido e devolve a oferta se a VM não foi entregue.").addStringOption((option) => option.setName("id").setDescription("ID").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map((command) => command.setContexts(InteractionContextType.Guild).toJSON());
}

export const STORE_COMMANDS = new Set(["configurar-loja", "configurar-atendimento", "criar-oferta", "remover-oferta", "configurar-cargo", "configurar-azure", "configurar-imagem", "pedidos", "pedido", "cancelar-pedido"]);
