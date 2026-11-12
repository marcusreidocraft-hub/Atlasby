# Bot-Hosting.net

Este arquivo só prepara o deployment. Nada aqui liga o repositório a um servidor, não há chave de API e o script de sincronização sai sem chamar a rede.

Fontes lidas em 7 de novembro de 2026:

- [Clone a GitHub Repository](https://bot-hosting.net/docs/guides/clone-a-github-repository), atualizado em 15 de outubro de 2026
- [REST API](https://bot-hosting.net/api)
- [Deploy a Discord bot from GitHub in 2 minutes](https://bot-hosting.net/blog/deploy-a-discord-bot-from-github-in-2-minutes), 8 de abril de 2025
- [Set Up a Deployment](https://bot-hosting.net/docs/guides/set-up-a-deployment), 15 de outubro de 2026
- [Connect Server Files with SFTP](https://bot-hosting.net/docs/guides/connect-server-files-with-sftp), 15 de outubro de 2026
- [Manage Access](https://bot-hosting.net/docs/guides/manage-access), 15 de outubro de 2026
- [Create a Deployment](https://bot-hosting.net/docs/guides/create-a-deployment), 15 de outubro de 2026

## O que a documentação confirma

Repositório privado, pelo painel: conecte a conta GitHub, escolha o repositório e o branch. Se o repositório não aparecer, reconecte o GitHub e confira se essa conta lê o repositório. Repositório público usa o link. Isso está no guia de clone.

Na aba Files, o ícone do GitHub oferece três estratégias:

- Replace all remove o que já existe no servidor.
- Merge mantém os arquivos atuais e substitui os de mesmo caminho.
- Add in subfolder clona dentro de uma pasta.

Para um servidor que já tem arquivos, use Merge. Não use Replace all.

A API `deployments.create` descreve `githubRepo` como repositório público. Este projeto não usa essa chamada para ligar o repositório privado.

Auto-pull no restart está na API e no artigo de 8 de abril de 2025. Não está na página do guia de clone.

- `GET /api/v1/deployments/:id/git` devolve `linked`, `repo`, `branch` e `autoPull`. Escopo `deployments:read`.
- `PATCH /api/v1/deployments/:id/git` com `{"autoPull": true}` ou `false`. O texto oficial é "re-pull the linked repo on every restart". Escopo `deployments:write`.

`POST /api/v1/deployments/:id/sync` existe. O texto oficial diz que puxa o código do repositório GitHub ligado e reinicia o deployment se ele estava em execução. O corpo pode trazer `repo` e `branch` para corrigir um clone no lugar errado; omitir os dois mantém o vínculo atual. A resposta documentada tem `ok`, `commit`, `repo` e `branch`. Escopo `deployments:write`. `ok: true` nessa resposta não está documentado como prova de que o processo do bot subiu. Depois de um sync, leia o console do painel.

Não há, na referência de API nem no guia de clone, um webhook que publique a cada `git push`. Push no GitHub, sozinho, não atualiza o host. O artigo descreve push e, em seguida, restart com auto-pull ligado, ou Pull now no painel.

O artigo também diz que o auto-pull atualiza arquivos rastreados e mantém o que não está no Git, inclusive banco e `.env`. A referência de API não repete essa garantia. Replace all e a troca de tipo de runtime não preservam esses arquivos: `deployments.updateStartup` exige `wipeFiles: true` quando a mudança de tipo apaga o volume.

## Backup antes de ligar este repositório

1. Baixe os arquivos atuais por SFTP. O guia de SFTP mostra host, porta, usuário e senha na aba SFTP, e a cópia para o seu computador. O guia de setup diz para guardar uma cópia fora do host, porque a exclusão do deployment leva os arquivos junto.
2. A permissão de deployment chamada Backups existe no guia de acesso. A API documenta `GET /deployments/:id/backups`, `GET /deployments/:id/backups/:backupId` e `POST /deployments/:id/backups/:backupId/restore`. O restore `replace` para o deployment, repõe todos os arquivos e liga de novo se estava em execução. O modo `subfolder` copia para uma pasta `/restored-...` sem parar o processo. O escopo `backups:write` é descrito como "Take, restore, delete", mas a página da API lida em 7 de novembro de 2026 não documenta o corpo de uma chamada para criar backup. Não invente esse POST. A cópia verificada é o download por SFTP.
3. Não troque o tipo de runtime e não marque a opção que apaga os arquivos.
4. O banco deste bot fica em `data/atlas.sqlite`, pasta ignorada pelo Git. Mantenha essa pasta no volume `/home/container`. Não copie um banco local por cima do banco que já estiver no servidor. O arquivo antigo `moderation.sqlite`, se ainda existir no volume, não é lido.

## Runtime

- Runtime: Node.js 24. O `node:sqlite` está disponível sem flag desde o Node 22.13 e, na documentação do Node 24, o módulo consta como release candidate a partir do 24.15. Não há dependência nativa de banco.
- Entry file: `index.js`
- Comando de start, se for definir um em vez do padrão da plataforma: `npm ci --omit=dev && exec node index.js`
- O padrão documentado da plataforma já instala a partir do `package.json` e executa o entry file. Mantenha o passo de instalação. O comando roda na raiz do volume, `/home/container`.
- Variáveis, só no host, marcadas como secret no caso do token. A API correspondente é `POST /api/v1/deployments/:id/env` com `secret: true`; o valor passa a valer no próximo restart. Não grave o token no Git.

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `DISCORD_TOKEN` | sim | token do bot, secret |
| `DISCORD_CLIENT_ID` | sim | ID da aplicação |
| `ALLOWED_GUILD_IDS` | sim | IDs dos servidores autorizados, separados por vírgula |
| `DATA_DIR` | não | padrão `data` |
| `CONFIRMATION_TTL_SECONDS` | não | padrão `60`, entre 15 e 300 |
| `SUPPORT_CHANNEL_URL` | não | link do botão de suporte |
| `ADMIN_ROLE_IDS` | não | cargos que administram o painel, além de quem tem Administrador |
| `ADMIN_LOG_CHANNEL_ID` | não | canal de log das ações |
| `CREDENTIALS_KEY` | não | cifra senha e PIN; se vazio, usa `AZURE_CREDENTIALS_KEY` |

`npm start` abre o banco e conecta ao Discord. `npm run setup` só cria o banco, sem token e sem Discord. O servidor que já acompanha `cursor/catalogo-components-v2-850e` recebe este código no próximo restart feito por quem opera o host. Este repositório não troca a branch do host, não faz merge e não reinicia nada.

## O que continua desligado

`hosting/sync-manual.sh` só imprime o endpoint e termina. Ele só chama a API se, na mesma sessão, `BOT_HOSTING_SYNC_EXECUTE=1` e `BOT_HOSTING_SYNC_I_CONFIRM=yes`, além do ID do deployment e da chave. A CI não executa esse script. Este repositório não liga `autoPull` e não cria workflow de push para o host.

Quando quiser atualizar o servidor, faça o backup, confira o branch ligado e use uma das formas já verificadas: Pull now no painel, restart com auto-pull que você mesmo tiver ligado, ou o POST de sync acima. Até lá, o código está apenas no GitHub.
