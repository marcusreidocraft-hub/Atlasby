const SUBJECT = {
  warn: "O aviso",
  timeout: "O timeout",
  timeout_remove: "A remoção do timeout",
  kick: "A expulsão",
  ban: "O banimento",
  set_log_channel: "A alteração do canal de logs",
  set_plan: "A alteração do plano",
  enroll_admin: "A inclusão de administrador",
  remove_admin: "A remoção de administrador",
};

function isConfig(action) {
  return action === "set_log_channel" || action === "set_plan" || action === "enroll_admin" || action === "remove_admin";
}

function subject(result) {
  return SUBJECT[result.action] ?? "A ação";
}

export function describeResult(result) {
  const name = subject(result);
  switch (result.code) {
    case "applied":
      if (result.action === "warn") {
        return `O aviso foi registrado (id ${result.warningId}) e o canal de logs recebeu o registro.`;
      }
      if (result.action === "timeout_remove") {
        return "A remoção do timeout foi aplicada e o canal de logs recebeu o registro.";
      }
      return `${name} foi aplicado e o canal de logs recebeu o registro.`;
    case "log_failed":
      if (result.action === "warn") {
        return "O aviso foi registrado, mas o canal de logs não recebeu a mensagem.";
      }
      if (result.action === "timeout_remove") {
        return "A remoção do timeout foi aplicada, mas o canal de logs não recebeu a mensagem.";
      }
      return `${name} foi aplicado, mas o canal de logs não recebeu a mensagem.`;
    case "discord_api":
      return `${name} não foi aplicado. A chamada ao Discord falhou.`;
    case "audit_failed":
      if (result.punishmentApplied && result.action === "warn") {
        return "O aviso foi registrado, mas a auditoria local não pôde ser atualizada.";
      }
      if (result.punishmentApplied) {
        return `${name} foi aplicado no Discord, mas a auditoria local não pôde ser atualizada.`;
      }
      return `${name} não foi aplicado. A auditoria local falhou antes da punição.`;
    case "warn_persist_failed":
      return "O aviso não foi registrado. A gravação local falhou.";
    case "log_channel_missing":
      return `${name} não foi aplicado. Configure o canal de logs antes.`;
    case "log_channel_unusable":
      return `${name} não foi aplicado. O canal de logs está inacessível para o bot.`;
    case "log_channel_check_failed":
      return `${name} não foi aplicado. Não foi possível verificar o canal de logs.`;
    case "confirmation_required": {
      const summary = result.summary ? ` ${result.summary}` : "";
      const lead = isConfig(result.action)
        ? `${name} ainda não foi gravada.`
        : `${name} ainda não foi aplicado.`;
      return `${lead}${summary} Confirme antes de ${new Date(result.expiresAt).toISOString()} UTC. Só quem pediu, neste servidor e para este alvo, pode confirmar.`;
    }
    case "cancelled":
      return isConfig(result.action)
        ? "Alteração cancelada. Nada foi gravado."
        : "Pedido cancelado. Nenhuma punição foi aplicada.";
    case "confirmation_expired":
      return "O pedido expirou. Nenhuma punição foi aplicada.";
    case "confirmation_wrong_user":
      return "Só o moderador que pediu a ação pode confirmar ou cancelar. Nenhuma punição foi aplicada.";
    case "confirmation_guild":
      return "Este pedido pertence a outro servidor. Nenhuma punição foi aplicada.";
    case "confirmation_missing":
      return "Pedido de confirmação inexistente. Nenhuma punição foi aplicada.";
    case "confirmation_used":
      return "Este pedido já foi usado. Nenhuma punição nova foi aplicada.";
    case "reason_required":
      return "Informe um motivo. Nenhuma punição foi aplicada.";
    case "reason_length":
      return "O motivo precisa ter no máximo 512 caracteres. Nenhuma punição foi aplicada.";
    case "duration_format":
      return "Informe a duração explícita no formato 30s, 10m, 2h ou 3d. Nenhuma punição foi aplicada.";
    case "duration_min":
      return "A duração mínima é 5 segundos. Nenhuma punição foi aplicada.";
    case "duration_max":
      return "A duração máxima é 28 dias. Nenhuma punição foi aplicada.";
    case "not_timed_out":
      return "Este membro não está em timeout. Nada foi removido.";
    case "self_protected":
      return "Você não pode aplicar esta ação a si mesmo. Nenhuma punição foi aplicada.";
    case "bot_protected":
      return "O bot não pode ser alvo desta ação. Nenhuma punição foi aplicada.";
    case "owner_protected":
      return "O dono do servidor está protegido. Nenhuma punição foi aplicada.";
    case "privileged_protected":
      return "Membros com permissão de Administrador estão protegidos. Nenhuma punição foi aplicada.";
    case "actor_permission":
      return "Você não tem a permissão exigida para esta ação. Nenhuma punição foi aplicada.";
    case "bot_permission":
      return "O bot não tem a permissão exigida para esta ação. Nenhuma punição foi aplicada.";
    case "actor_hierarchy":
      return "Seu cargo precisa estar acima do cargo do alvo. Nenhuma punição foi aplicada.";
    case "bot_hierarchy":
      return "O cargo do bot precisa estar acima do cargo do alvo. Nenhuma punição foi aplicada.";
    case "hierarchy_unknown":
      return "A hierarquia não pôde ser confirmada. Nenhuma punição foi aplicada.";
    case "target_not_member":
      return "O alvo não está neste servidor. Nenhuma punição foi aplicada.";
    case "lookup_failed":
      return "Não foi possível consultar o Discord. Nenhuma punição foi aplicada.";
    case "guild_only":
      return "Os comandos funcionam apenas dentro de um servidor autorizado.";
    case "guild_unauthorized":
      return "Este servidor não está autorizado a usar o bot.";
    case "target_required":
      return "Informe o membro alvo. Nenhuma punição foi aplicada.";
    case "channel_required":
      return "Informe um canal de texto. Nada foi alterado.";
    case "channel_guild":
      return "O canal precisa pertencer a este servidor. Nada foi alterado.";
    case "channel_type":
      return "O canal de logs precisa ser um canal de texto. Nada foi alterado.";
    case "log_channel_saved":
    case "config_saved":
      return "Alteração gravada. Nenhuma cobrança ou provisionamento foi feito.";
    case "log_channel_save_failed":
    case "config_save_failed":
      return "A alteração não foi gravada. A gravação local falhou.";
    case "admin_unauthorized":
      return "Só o dono do servidor ou um administrador incluído por ele pode configurar. Nada foi alterado.";
    case "owner_only":
      return "Só o dono do servidor pode alterar administradores. Nada foi alterado.";
    case "admin_missing":
      return "Esse usuário não está na lista de administradores. Nada foi alterado.";
    case "plan_unknown":
      return "Plano desconhecido. Nada foi alterado.";
    case "plan_forbidden":
      return "Planos de 6 horas e de 1 dia não existem neste catálogo. Nada foi alterado.";
    case "price_invalid":
      return "Preço inválido. Use centavos inteiros, como 3590, ou reais com dois decimais, como 35,90. Nada foi alterado.";
    case "price_required":
      return "Não há preço cadastrado para reativar este plano. Nada foi alterado e nenhum valor foi inventado.";
    case "sold_out":
      return "Este período está esgotado. O ticket não foi aberto.";
    case "out_of_stock":
    case "stock_retired":
      return "A quantidade de estoque não é mais usada. O número antigo foi preservado e não foi alterado. Use disponível ou esgotado.";
    case "sku_setup_required":
      return "O 8 vCPU ainda não tem preço definido pela equipe. O ticket não foi aberto.";
    case "ticket_setup_required":
      return "Configure a categoria e o cargo da equipe antes de abrir tickets. Nada foi aberto.";
    case "ticket_opened":
      return "Ticket de compra criado.";
    case "ticket_exists":
      return "Você já tem um ticket aberto para este plano.";
    case "ticket_panel_failed":
      return "O ticket foi registrado, mas o painel não pôde ser enviado.";
    case "ticket_claimed":
      return "Ticket assumido.";
    case "claim_taken":
      return "Outra pessoa da equipe já assumiu este ticket.";
    case "claim_cleared":
      return "A responsabilidade do ticket foi liberada.";
    case "ticket_closed":
      return "A transcrição privada foi salva e o canal será apagado. Nenhuma venda foi registrada.";
    case "delete_failed":
      return "A transcrição foi salva, mas o canal não pôde ser apagado. Ele será apagado na próxima tentativa, sem nova transcrição.";
    case "transcript_incomplete":
      return "A transcrição não inclui o texto das mensagens porque a intent Message Content está desligada. O canal foi mantido. Ative a intent no portal, defina ENABLE_MESSAGE_CONTENT_INTENT=1 e tente fechar de novo.";
    case "close_in_progress":
      return "Este fechamento já está em andamento.";
    case "transcript_ready":
      return "Transcrição gerada no canal privado configurado, ou no próprio ticket se não houver canal de arquivo.";
    case "transcript_failed":
      return "A transcrição falhou. O ticket continua aberto.";
    case "transcript_channel_unsafe":
      return "O canal de transcrição é público ou inacessível. Nada foi enviado.";
    case "staff_only":
      return "Só a equipe configurada, o dono ou um administrador pode fazer isso.";
    case "ticket_missing":
      return "Ticket inexistente ou já fechado. Nada foi alterado.";
    case "greeting_invalid":
      return "Texto ou emoji inválido. Use emoji Unicode ou customizado, HTTPS e apenas os marcadores {produto}, {duracao}, {preco}, {usuario} e {equipe}. Nada foi gravado.";
    case "emoji_invalid":
    case "media_invalid":
      return "Emoji ou imagem inválidos. A imagem precisa ser HTTPS, sem buscar o arquivo agora. Nada foi gravado.";
    case "transcript_not_configured":
      return "Configure um canal privado de transcrição antes de fechar. O canal do ticket foi mantido.";
    case "stock_invalid":
      return "A quantidade de estoque não é mais usada. Nada foi alterado.";
    case "info_unconfigured":
      return "Este texto ainda não foi configurado.";
    case "confirmation_mismatch":
      return "O pedido não confere com o alvo gravado. Nada foi aplicado.";
    case "internal":
      return "A ação não foi aplicada. Ocorreu um erro interno.";
    default:
      return "A ação não foi aplicada.";
  }
}
