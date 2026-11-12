import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { EMOJI_KEYS } from "../../services/emojis.js";

const guild = (builder) => builder.setContexts(InteractionContextType.Guild);

export function adminCommands() {
  return [
    guild(new SlashCommandBuilder().setName("painel-publicar").setDescription("Publica o painel da Atlas Cloud PC neste canal.")),
    guild(new SlashCommandBuilder().setName("adicionar-cliente").setDescription("Cadastra a máquina de um membro.")),
    guild(new SlashCommandBuilder().setName("editar-cliente").setDescription("Edita a máquina de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true))),
    guild(new SlashCommandBuilder().setName("remover-cliente").setDescription("Remove o cadastro de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true))),
    guild(new SlashCommandBuilder().setName("buscar-cliente").setDescription("Busca clientes por nome, máquina ou IP.").addStringOption((option) => option.setName("termo").setDescription("Nome, máquina ou IP").setRequired(true).setMaxLength(40))),
    guild(new SlashCommandBuilder().setName("listar-clientes").setDescription("Lista os clientes deste servidor.")),
    guild(new SlashCommandBuilder().setName("listar-vms").setDescription("Lista as VMs da assinatura Azure.")),
    guild(new SlashCommandBuilder().setName("agente-token").setDescription("Fallback manual. Mostra o token e não instala o agente.").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption((option) => option.setName("membro").setDescription("Dono da máquina").setRequired(true))),
    guild(new SlashCommandBuilder()
      .setName("renovar-plano")
      .setDescription("Renova o plano de um cliente.")
      .addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true))
      .addStringOption((option) => option.setName("plano").setDescription("Duração").setRequired(true).addChoices(
        { name: "Semanal", value: "semanal" },
        { name: "Quinzenal", value: "quinzenal" },
        { name: "Mensal", value: "mensal" },
      ))
      .addStringOption((option) => option.setName("inicio").setDescription("DD/MM/AAAA. Vazio usa hoje.").setRequired(false))
      .addStringOption((option) => option.setName("vencimento").setDescription("DD/MM/AAAA. Vazio calcula pelo plano.").setRequired(false))),
    guild(new SlashCommandBuilder()
      .setName("configurar")
      .setDescription("Ajusta suporte, logs ou emoji deste servidor.")
      .addSubcommand((sub) => sub.setName("suporte").setDescription("Define o link do botão de suporte.").addStringOption((option) => option.setName("url").setDescription("URL https do canal ou site").setRequired(true)))
      .addSubcommand((sub) => sub.setName("logs").setDescription("Define o canal de logs administrativos.").addChannelOption((option) => option.setName("canal").setDescription("Canal de texto").addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand((sub) => sub.setName("emoji").setDescription("Substitui um emoji do painel.").addStringOption((option) => option.setName("nome").setDescription("Nome do emoji").setRequired(true).addChoices(...EMOJI_KEYS.map((key) => ({ name: key, value: key })))).addStringOption((option) => option.setName("valor").setDescription("Unicode ou <:nome:id>").setRequired(true).setMaxLength(80)))),
  ].map((command) => command.toJSON());
}
