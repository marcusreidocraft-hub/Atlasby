import {
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

function guildOnly(builder) {
  return builder
    .setDMPermission(false)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
}

const userOption = (option) =>
  option.setName("usuario").setDescription("Membro alvo").setRequired(true);

const reasonOption = (option) =>
  option
    .setName("motivo")
    .setDescription("Motivo obrigatório, com até 512 caracteres")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(512);

export const commands = [
  guildOnly(
    new SlashCommandBuilder()
      .setName("aviso")
      .setDescription("Registra um aviso permanente para um membro.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(userOption)
      .addStringOption(reasonOption),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("silenciar")
      .setDescription("Aplica ou remove um timeout com duração explícita.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((subcommand) =>
        subcommand
          .setName("aplicar")
          .setDescription("Aplica timeout com duração explícita.")
          .addUserOption(userOption)
          .addStringOption((option) =>
            option
              .setName("duracao")
              .setDescription("Duração explícita: 30s, 10m, 2h ou 3d. Máximo de 28 dias.")
              .setRequired(true)
              .setMinLength(2)
              .setMaxLength(8),
          )
          .addStringOption(reasonOption),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remover")
          .setDescription("Remove o timeout de um membro.")
          .addUserOption(userOption)
          .addStringOption(reasonOption),
      ),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("expulsar")
      .setDescription("Expulsa um membro depois de uma confirmação.")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption(userOption)
      .addStringOption(reasonOption),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("banir")
      .setDescription("Bane um membro depois de uma confirmação.")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(userOption)
      .addStringOption(reasonOption),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("canal-logs")
      .setDescription("Define o canal onde as ações de moderação são registradas.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName("canal")
          .setDescription("Canal de texto que receberá os registros")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  ),
];
