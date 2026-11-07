# Atlasby

Bot de moderação do Discord, com comandos de barra em português do Brasil. O processo usa a API oficial por meio do discord.js 14 e grava avisos e auditoria num SQLite local, fora do Git.

O código deste repositório pode ser executado e testado. Ele ainda não foi implantado no Bot-Hosting.net, não recebe token e não liga auto-pull nem sincronização.

## Comandos

| Comando | Quem pode usar | Efeito |
| --- | --- | --- |
| `/aviso` | Moderate Members | Grava um aviso permanente. O motivo é obrigatório. |
| `/silenciar aplicar` | Moderate Members | Timeout com duração explícita: `30s`, `10m`, `2h` ou `3d`. Mínimo 5 segundos, máximo 28 dias. |
| `/silenciar remover` | Moderate Members | Remove o timeout atual. Se o membro não estiver silenciado, nada é chamado na API. |
| `/expulsar` | Kick Members | Pede confirmação e só então expulsa. |
| `/banir` | Ban Members | Pede confirmação e só então bane, sem apagar mensagens. |
| `/canal-logs` | Manage Guild | Define o canal de texto da auditoria. |

Expulsão e banimento só acontecem se o mesmo moderador confirmar, no mesmo servidor e para o mesmo alvo, antes do prazo. O padrão é 60 segundos. Outro usuário, outro servidor, prazo vencido ou segundo clique não aplicam a punição.

O bot recusa como alvo o dono do servidor, o próprio autor, o próprio bot e quem tem Administrador. O cargo de quem pune e o cargo do bot precisam estar acima do alvo. O dono do servidor pode punir sem o bit daquela permissão e acima da própria posição de cargo; a hierarquia e a permissão do bot continuam obrigatórias, assim como as proteções de alvo. Nos demais casos, moderador e bot precisam da permissão da ação.

Sem canal de logs utilizável, nenhuma punição é enviada ao Discord. Se o Discord recusar, a resposta diz que a punição não foi aplicada e a auditoria não fica como sucesso. Se o Discord aplicar e o canal de logs falhar, a resposta diz que a punição ocorreu e que o log não foi entregue.

Os comandos são só de servidor (`GuildInstall`, contexto Guild, sem DM) e só respondem nos IDs de `ALLOWED_GUILD_IDS`. A visibilidade padrão do Discord não substitui essas checagens.

## Permissões do bot

O convite não pede Administrador. Bits: Kick Members, Ban Members, Moderate Members, View Channel, Send Messages e Embed Links. O valor é `1099511647238`.

```text
https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot%20applications.commands&permissions=1099511647238
```

Intents privilegiadas não são necessárias. O processo usa a intent Guilds e consulta membro e canal pela API.

Coloque o cargo do bot acima dos membros que ele pode punir e abaixo dos cargos que devem permanecer protegidos.

## Stack

Node.js 22.13 ou mais novo e discord.js 14.28.1. O banco usa `node:sqlite`, sem módulo nativo. No host, use Node.js 24: na documentação do Node 24.15 o `node:sqlite` está como release candidate. No Node 22 ele funciona sem a flag experimental, mas ainda é marcado como experimental.

## Instalação, migração, execução e testes

```sh
npm ci
npm test
npm run setup
npm start
```

- `npm ci` instala as versões travadas em `package-lock.json`.
- `npm test` cobre hierarquia, prazo e moderador errado da confirmação, persistência, migração e falha da API. Não usa token nem Discord real.
- `npm run setup` cria `data/` e aplica a migração sem token.
- `npm start` aplica migrações pendentes e conecta o bot. Sem `DISCORD_TOKEN`, o processo termina com erro e não declara sucesso.

Copie `.env.example` só no ambiente de execução. Os valores versionados ficam em branco.

| Variável | Obrigatória |
| --- | --- |
| `DISCORD_TOKEN` | sim |
| `DISCORD_CLIENT_ID` | sim |
| `ALLOWED_GUILD_IDS` | sim, IDs separados por vírgula |
| `DATA_DIR` | não; padrão `data` |
| `CONFIRMATION_TTL_SECONDS` | não; padrão `60`, limites 15 e 300 |

O banco é `data/moderation.sqlite`. A primeira migração cria avisos, auditoria, confirmações e configuração do canal. Subir o processo de novo não reaplica a versão já gravada. `data/`, `node_modules/`, `.env` e logs ficam fora do Git.

## Host

O passo a passo verificado do Bot-Hosting.net, o backup por SFTP e o script manual inativo estão em [docs/bot-hosting.md](docs/bot-hosting.md). Entry file: `index.js`. Não use Replace all nem troca de tipo de runtime num servidor que já tem dados. Push para o GitHub não publica no host: não há webhook de push documentado na API verificada.

## O que falta para ficar no ar

1. Criar a aplicação no portal do Discord e guardar token e client ID só no host.
2. Convidar o bot com o link acima e posicionar o cargo.
3. Fazer o backup SFTP do servidor atual.
4. Ligar este repositório privado pelo painel, com Merge, Node.js 24 e entry `index.js`.
5. Preencher as variáveis secretas e definir `/canal-logs` dentro do servidor autorizado.
6. Só então, se quiser que um restart puxe o Git, ligar o auto-pull no painel ou usar o sync manual descrito na documentação de hospedagem.
