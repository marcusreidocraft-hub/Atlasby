import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
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
    new SlashCommandBuilder().setName("configurar-loja").setDescription("Ajusta a loja da Atlas Cloud PC.")
      .addSubcommand((sub) => sub.setName("publicar").setDescription("Publica ou atualiza o painel no canal atual."))
      .addSubcommand((sub) => sub.setName("banner").setDescription("Define a imagem do painel.").addStringOption((option) => option.setName("url").setDescription("URL https").setRequired(true)))
      .addSubcommand((sub) => sub.setName("texto").setDescription("Define título e descrição.").addStringOption((option) => option.setName("titulo").setDescription("Título").setRequired(true).setMaxLength(80)).addStringOption((option) => option.setName("descricao").setDescription("Descrição").setRequired(true).setMaxLength(300)))
      .addSubcommand((sub) => sub.setName("canal").setDescription("Canal do painel e categoria dos pedidos.").addChannelOption((option) => option.setName("painel").setDescription("Canal do painel").addChannelTypes(ChannelType.GuildText).setRequired(true)).addChannelOption((option) => option.setName("categoria").setDescription("Categoria dos pedidos").addChannelTypes(ChannelType.GuildCategory).setRequired(false)))
      .addSubcommand((sub) => sub.setName("produto").setDescription("Inclui ou ajusta um produto, inclusive A10.").addStringOption((option) => option.setName("sku").setDescription("Identificador, como a10-1").setRequired(true).setMaxLength(20)).addStringOption((option) => option.setName("nome").setDescription("Nome").setRequired(true)).addStringOption((option) => option.setName("tamanho").setDescription("Tamanho Azure").setRequired(true)).addIntegerOption((option) => option.setName("vcpus").setDescription("vCPUs").setRequired(true)).addStringOption((option) => option.setName("ram").setDescription("RAM").setRequired(true)).addStringOption((option) => option.setName("precos").setDescription("semanal=3590 em centavos, separados por vírgula").setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("configurar-horas").setDescription("Liga ou ajusta os planos de 3h e 6h.")
      .addBooleanOption((option) => option.setName("ativo").setDescription("Mostrar 3h e 6h").setRequired(true))
      .addStringOption((option) => option.setName("preco3").setDescription("Preço de 3h, como 4,59").setRequired(false))
      .addStringOption((option) => option.setName("preco6").setDescription("Preço de 6h, como 8,00").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("criar-oferta").setDescription("Cria uma promoção.")
      .addStringOption(sku).addStringOption(plan)
      .addIntegerOption((option) => option.setName("unidades").setDescription("Unidades promocionais").setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName("inicio").setDescription("AAAA-MM-DD HH:MM").setRequired(true))
      .addStringOption((option) => option.setName("fim").setDescription("AAAA-MM-DD HH:MM").setRequired(true))
      .addIntegerOption((option) => option.setName("desconto").setDescription("Percentual").setRequired(false).setMinValue(1).setMaxValue(90))
      .addStringOption((option) => option.setName("preco").setDescription("Preço promocional, como 36,90").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("remover-oferta").setDescription("Encerra uma oferta.").addStringOption((option) => option.setName("id").setDescription("ID da oferta").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("estoque").setDescription("Mostra o estoque da loja.").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("adicionar-estoque").setDescription("Soma unidades ao estoque.").addStringOption(sku).addIntegerOption((option) => option.setName("quantidade").setDescription("Unidades").setRequired(true).setMinValue(1))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("remover-estoque").setDescription("Remove unidades do estoque.").addStringOption(sku).addIntegerOption((option) => option.setName("quantidade").setDescription("Unidades").setRequired(true).setMinValue(1))
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
    new SlashCommandBuilder().setName("configurar-imagem").setDescription("Imagem especializada ou snapshot.")
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
    new SlashCommandBuilder().setName("cancelar-pedido").setDescription("Cancela um pedido e devolve o estoque se a VM não foi entregue.").addStringOption((option) => option.setName("id").setDescription("ID").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map((command) => command.setContexts(InteractionContextType.Guild).toJSON());
}

export const STORE_COMMANDS = new Set(["configurar-loja", "configurar-atendimento", "configurar-horas", "criar-oferta", "remover-oferta", "estoque", "adicionar-estoque", "remover-estoque", "configurar-cargo", "configurar-azure", "configurar-imagem", "pedidos", "pedido", "cancelar-pedido"]);
