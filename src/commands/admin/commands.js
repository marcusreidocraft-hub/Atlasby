import { ChannelType, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { EMOJI_KEYS } from "../../services/emojis.js";

const guild = (builder) => builder.setContexts(InteractionContextType.Guild);

export function adminCommands() {
  return [
    guild(new SlashCommandBuilder().setName("painel-publicar").setDescription("Publica o painel da Atlas Cloud PC neste canal.")),
    guild(new SlashCommandBuilder().setName("atendimento-publicar").setDescription("Publica a central de atendimento neste canal.")),
    guild(new SlashCommandBuilder().setName("termos").setDescription("Publica os Termos de Uso da Atlas Cloud PC.").addChannelOption((option) => option.setName("canal").setDescription("Canal de texto. Vazio publica neste canal.").addChannelTypes(ChannelType.GuildText).setRequired(false))),
    guild(new SlashCommandBuilder()
      .setName("anuncio")
      .setDescription("Publica ou edita um anúncio da Atlas Cloud PC.")
      .addSubcommand((sub) => sub
        .setName("publicar")
        .setDescription("Abre o anúncio para revisão antes de publicar.")
        .addChannelOption((option) => option.setName("canal").setDescription("Canal de texto. Vazio usa este canal.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
        .addAttachmentOption((option) => option.setName("imagem").setDescription("Imagem grande. Tem prioridade sobre a URL.").setRequired(false))
        .addAttachmentOption((option) => option.setName("miniatura").setDescription("Miniatura ao lado do título.").setRequired(false))
        .addStringOption((option) => option.setName("url_miniatura").setDescription("URL https da miniatura, se não houver anexo.").setRequired(false).setMaxLength(2000))
        .addStringOption((option) => option.setName("cor").setDescription("Cor hexadecimal. Vazio usa a cor do painel.").setRequired(false).setMaxLength(7))
        .addStringOption((option) => option.setName("mencionar").setDescription("Cargo, @everyone ou @here.").setRequired(false).setMaxLength(32))
        .addStringOption((option) => option.setName("emoji").setDescription("Emoji do título. Vazio usa o megafone. nenhum omite.").setRequired(false).setMaxLength(64)))
      .addSubcommand((sub) => sub
        .setName("editar")
        .setDescription("Reabre um anúncio publicado por este bot.")
        .addStringOption((option) => option.setName("mensagem").setDescription("Link ou ID da mensagem.").setRequired(true).setMaxLength(200))
        .addAttachmentOption((option) => option.setName("imagem").setDescription("Nova imagem grande.").setRequired(false))
        .addAttachmentOption((option) => option.setName("miniatura").setDescription("Nova miniatura.").setRequired(false))
        .addStringOption((option) => option.setName("url_miniatura").setDescription("URL https da miniatura.").setRequired(false).setMaxLength(2000))
        .addStringOption((option) => option.setName("cor").setDescription("Nova cor hexadecimal.").setRequired(false).setMaxLength(7))
        .addStringOption((option) => option.setName("mencionar").setDescription("Cargo, @everyone ou @here.").setRequired(false).setMaxLength(32))
        .addStringOption((option) => option.setName("emoji").setDescription("Emoji do título, ou nenhum.").setRequired(false).setMaxLength(64)))),
    guild(new SlashCommandBuilder()
      .setName("convites")
      .setDescription("Painel e gestão dos convites com bonificação.")
      .addSubcommand((sub) => sub.setName("painel").setDescription("Publica o painel de convites.").addChannelOption((option) => option.setName("canal").setDescription("Canal de texto. Vazio usa este canal.").addChannelTypes(ChannelType.GuildText).setRequired(false)))
      .addSubcommand((sub) => sub.setName("canal").setDescription("Define o canal onde os convites pessoais são criados.").addChannelOption((option) => option.setName("canal").setDescription("Canal de texto").addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand((sub) => sub.setName("ver").setDescription("Mostra a contagem, os convidados e as bonificações.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true)))
      .addSubcommand((sub) => sub.setName("ajustar").setDescription("Soma ou tira convites válidos na mão.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true)).addIntegerOption((option) => option.setName("quantidade").setDescription("Número positivo ou negativo.").setRequired(true).setMinValue(-500).setMaxValue(500)))
      .addSubcommand((sub) => sub.setName("resetar").setDescription("Zera a contagem. Bonificações já registradas continuam.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true)))
      .addSubcommand((sub) => sub.setName("ranking").setDescription("Lista quem mais convidou."))),
    guild(new SlashCommandBuilder().setName("criar-maquina").setDescription("Abre o assistente para criar uma VM e vincular a um cliente.")),
    guild(new SlashCommandBuilder().setName("adicionar-cliente").setDescription("Cadastra a máquina de um membro.")),
    guild(new SlashCommandBuilder().setName("editar-cliente").setDescription("Edita a máquina de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true))),
    guild(new SlashCommandBuilder().setName("remover-cliente").setDescription("Remove o cadastro de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro").setRequired(true))),
    guild(new SlashCommandBuilder().setName("buscar-cliente").setDescription("Busca clientes por nome, máquina ou IP.").addStringOption((option) => option.setName("termo").setDescription("Nome, máquina ou IP").setRequired(true).setMaxLength(40))),
    guild(new SlashCommandBuilder().setName("listar-clientes").setDescription("Lista os clientes deste servidor.")),
    guild(new SlashCommandBuilder().setName("listar-vms").setDescription("Lista as VMs da assinatura Azure.")),
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
      .addSubcommand((sub) => sub.setName("emoji").setDescription("Substitui um emoji do painel.").addStringOption((option) => option.setName("nome").setDescription("Nome do emoji").setRequired(true).addChoices(...EMOJI_KEYS.map((key) => ({ name: key, value: key })))).addStringOption((option) => option.setName("valor").setDescription("Unicode ou <:nome:id>").setRequired(true).setMaxLength(80)))
      .addSubcommand((sub) => sub.setName("horario").setDescription("Texto do horário no painel de atendimento.").addStringOption((option) => option.setName("texto").setDescription("Horário exibido no rodapé").setRequired(true).setMaxLength(150)))
      .addSubcommand((sub) => sub.setName("ticket-emoji").setDescription("Troca um emoji do atendimento.").addStringOption((option) => option.setName("nome").setDescription("Slot").setRequired(true).addChoices(...["suporte", "parcerias", "outros", "abrir", "acessar", "motivo", "chamar", "fechar", "voz", "adicionar", "remover", "pagamento", "horario", "erro", "titulo"].map((key) => ({ name: key, value: key })))).addStringOption((option) => option.setName("valor").setDescription("<:nome:id>").setRequired(true).setMaxLength(80)))),
  ].map((command) => command.toJSON());
}
