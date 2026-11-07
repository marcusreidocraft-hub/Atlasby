# Atlasby

Bot de moderação do Discord, com comandos de barra em português do Brasil. O processo usa a API oficial por meio do discord.js 14 e grava avisos e auditoria num SQLite local, fora do Git.

O código pode ser executado e testado sem token. Este repositório não grava segredo, não cobra e não reinicia o host.

## Comandos

| Comando | Quem pode usar | Efeito |
| --- | --- | --- |
| `/aviso` | Moderate Members | Grava um aviso permanente. O motivo é obrigatório. |
| `/silenciar aplicar` | Moderate Members | Timeout com duração explícita: `30s`, `10m`, `2h` ou `3d`. Mínimo 5 segundos, máximo 28 dias. |
| `/silenciar remover` | Moderate Members | Remove o timeout atual. Se o membro não estiver silenciado, nada é chamado na API. |
| `/expulsar` | Kick Members | Pede confirmação e só então expulsa. |
| `/banir` | Ban Members | Pede confirmação e só então bane, sem apagar mensagens. |
| `/canal-logs` | Dono ou administrador incluído | Pede confirmação para trocar o canal de logs. |
| `/catalogo` | Qualquer membro do servidor autorizado | Mostra o catálogo, sem compra. |
| `/configurar` | Dono ou administrador incluído | Painel de logs, preços, disponibilidade e administradores. |

Aviso, timeout, remoção de timeout, expulsão, banimento e mudanças de configuração só acontecem se a mesma pessoa confirmar, no mesmo servidor e para o mesmo alvo, antes do prazo. O padrão é 60 segundos. Outro usuário, outro servidor, prazo vencido, cancelamento ou segundo clique não aplicam a ação. As respostas usam Components V2: texto em Text Display, dentro de Container, com a flag `IS_COMPONENTS_V2`. Não há embed legado no lugar dessa flag.

O bot recusa como alvo o dono do servidor, o próprio autor, o próprio bot e quem tem Administrador. O cargo de quem pune e o cargo do bot precisam estar acima do alvo. O dono do servidor pode punir sem o bit daquela permissão e acima da própria posição de cargo; a hierarquia e a permissão do bot continuam obrigatórias, assim como as proteções de alvo. Nos demais casos, moderador e bot precisam da permissão da ação.

Sem canal de logs utilizável, nenhuma punição é enviada ao Discord. Se o Discord recusar, a resposta diz que a punição não foi aplicada e a auditoria não fica como sucesso. Se o Discord aplicar e o canal de logs falhar, a resposta diz que a punição ocorreu e que o log não foi entregue.

Os comandos são só de servidor (`GuildInstall`, contexto Guild, sem DM) e só respondem nos IDs de `ALLOWED_GUILD_IDS`. A visibilidade padrão do Discord não substitui essas checagens.

## Permissões do bot

O convite não pede Administrador. Além de Kick, Ban, Moderate Members, View Channel, Send Messages e Embed Links, o ticket precisa de Manage Channels, Read Message History e Attach Files. O valor é `1099511745558`.

```text
https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot%20applications.commands&permissions=1099511745558
```

A intent padrão é só Guilds. A transcrição grava autor, horário e anexos mesmo assim. O texto das mensagens de outras pessoas só vem completo se a intent privilegiada Message Content estiver ligada no portal e `ENABLE_MESSAGE_CONTENT_INTENT=1` no host. Sem isso, o arquivo marca o trecho como conteúdo indisponível em vez de fingir que leu a mensagem. Ligar a intent sem o portal derruba o login, por isso ela fica desligada por padrão.

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
| `ENABLE_MESSAGE_CONTENT_INTENT` | não; vazio desliga a intent |

O banco é `data/moderation.sqlite`. As migrações 1 e 2 criam moderação e o catálogo antigo. A migração 3 copia os planos de 4 vCPU para o catálogo novo, apaga só o rótulo de preço temporário e não mexe no preço que a equipe já alterou. Estoque numérico desses planos antigos fica vazio, ou seja, sem teto, até alguém definir um número. Itens novos entram com estoque 0. `data/`, `node_modules/`, `.env` e logs ficam fora do Git.

## Catálogo e tickets

A marca padrão é Atlas. Se o banco ainda tiver o texto exato Nyx ou Nyx Cloud como padrão antigo, a migração troca só esse padrão. Preço, estoque, permissões e o texto histórico de uma transcrição não são reescritos.

Não há pagamento nem provisionamento. Abrir um plano reserva estoque e edita a mesma mensagem do catálogo. Fechar salva a transcrição privada, mostra a contagem 5, 4, 3, 2 e 1 e só então apaga o canal. Se a transcrição, a permissão ou o texto das mensagens faltarem, o canal continua. A reserva volta uma única vez e isso não é uma venda.

| Produto | 7 dias | 15 dias | 30 dias | Estoque inicial |
| --- | --- | --- | --- | --- |
| Tesla T4 · 4 vCPU | R$35,90, disponível | R$49,90, disponível, sem rótulo temporário | Esgotado, sem preço inventado | sem teto, herdado |
| Tesla T4 · 8 vCPU | sem preço | sem preço | Esgotado, sem preço | 0; a equipe precisa definir preço e estoque |
| Tesla T4 · 16 vCPU | R$45,00 | R$75,00 | Esgotado, sem preço | 0 até a equipe informar a quantidade |

Não há plano de 6 horas nem de 1 dia. Cada pessoa só pode ter um ticket aberto por produto e duração. O canal nasce invisível para `@everyone` e visível para quem abriu, o cargo da equipe e o bot. Assumir é atômico e só a equipe, o dono ou um administrador incluído consegue. A transcrição sai em HTML escapado, só no canal privado configurado. O canal do ticket é apagado depois da contagem, e somente se essa transcrição tiver sido salva.

Antes do primeiro ticket, o dono confirma em `/configurar` a categoria, o cargo da equipe, os preços que faltam e o estoque do 8 vCPU e do 16 vCPU.

## Host

O passo a passo verificado do Bot-Hosting.net, o backup por SFTP e o script manual inativo estão em [docs/bot-hosting.md](docs/bot-hosting.md). Entry file: `index.js`. Não use Replace all nem troca de tipo de runtime num servidor que já tem dados. Push para o GitHub não publica no host: não há webhook de push documentado na API verificada.

## O que falta para ficar no ar

1. Criar a aplicação no portal do Discord e guardar token e client ID só no host.
2. Convidar o bot com o link acima e posicionar o cargo.
3. Fazer o backup SFTP do servidor atual.
4. Ligar este repositório privado pelo painel, com Merge, Node.js 24 e entry `index.js`.
5. Preencher `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` e `ALLOWED_GUILD_IDS`. Canal de logs, preços e administradores não vão no ambiente.
6. O host que já usa `cursor/catalogo-components-v2-850e` não precisa trocar de branch. Este repositório não faz merge nem restart. O código novo só entra no processo quando quem opera o host reiniciar.
7. No Discord, o dono usa `/configurar` e confirma categoria, cargo, preços e estoque. `/catalogo` abre o ticket do plano escolhido.
