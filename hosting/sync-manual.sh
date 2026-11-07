#!/bin/sh
# Modelo inativo. Não sincroniza nada, a menos que os dois bloqueios abaixo
# estejam definidos de propósito, no ambiente do operador, fora do Git.
# A CI não chama este arquivo. Não coloque a chave em argumento de processo
# visível em histórico compartilhado; exporte as variáveis na sessão.
set -eu

if [ "${BOT_HOSTING_SYNC_EXECUTE:-}" != "1" ] || [ "${BOT_HOSTING_SYNC_I_CONFIRM:-}" != "yes" ]; then
  echo "Inativo. Nenhuma chamada foi feita."
  echo "Endpoint verificado, para uso manual depois que o deployment existir:"
  echo "  POST https://bot-hosting.net/api/v1/deployments/<id>/sync"
  echo "Escopo: deployments:write. Corpo vazio mantém o repositório e o branch já ligados."
  exit 0
fi

: "${BOT_HOSTING_API_KEY:?defina BOT_HOSTING_API_KEY}"
: "${BOT_HOSTING_DEPLOYMENT_ID:?defina BOT_HOSTING_DEPLOYMENT_ID}"

curl -f -sS -X POST \
  "https://bot-hosting.net/api/v1/deployments/${BOT_HOSTING_DEPLOYMENT_ID}/sync" \
  -H "Authorization: Bearer ${BOT_HOSTING_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
