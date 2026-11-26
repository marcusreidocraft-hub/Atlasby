import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export function resellerCommand() {
  const reseller = (option) => option.setName("revendedor").setDescription("Revendedor").setRequired(true).setAutocomplete(true);
  const vm = (option) => option.setName("vm").setDescription("Máquina").setRequired(true).setAutocomplete(true);
  return new SlashCommandBuilder()
    .setName("revendedor")
    .setDescription("Cria e controla revendedores da Ignix Cloud PC.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub.setName("criar").setDescription("Gera um revendedor e mostra a chave uma vez.").addStringOption((option) => option.setName("nome").setDescription("Nome do revendedor").setRequired(true).setMaxLength(40)))
    .addSubcommand((sub) => sub.setName("listar").setDescription("Lista os revendedores deste servidor."))
    .addSubcommand((sub) => sub.setName("revogar").setDescription("Revoga a chave na hora.").addStringOption(reseller))
    .addSubcommand((sub) => sub.setName("girar-chave").setDescription("Troca a chave e invalida a anterior.").addStringOption(reseller))
    .addSubcommand((sub) => sub.setName("atribuir-vm").setDescription("Entrega uma VM livre a um revendedor.").addStringOption(reseller).addStringOption(vm))
    .addSubcommand((sub) => sub.setName("remover-vm").setDescription("Tira a VM do revendedor. A VM na Azure continua.").addStringOption(reseller).addStringOption(vm));
}
