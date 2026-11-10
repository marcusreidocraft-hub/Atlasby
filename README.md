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
| `/configurar` | Dono ou administrador incluído | Painel de logs, preços, disponibilidade, administradores e formulários. |
| `/formularios` | Dono ou administrador incluído | Publica o painel de candidatura no canal atual. |
| `/candidatura` | Qualquer membro do servidor autorizado | Mostra em particular o estado da própria candidatura. |
| `/menu` | Cliente com VM vinculada | Menu privado das máquinas virtuais. |
| `/maquinas` | Dono ou administrador incluído | Cadastro de VMs, clientes, validade e credenciais. |

Aviso, timeout, remoção de timeout, expulsão, banimento e mudanças de configuração só acontecem se a mesma pessoa confirmar, no mesmo servidor e para o mesmo alvo, antes do prazo. O padrão é 60 segundos. Outro usuário, outro servidor, prazo vencido, cancelamento ou segundo clique não aplicam a ação. As respostas usam Components V2: texto em Text Display, dentro de Container, com a flag `IS_COMPONENTS_V2`. Não há embed legado no lugar dessa flag.

O bot recusa como alvo o dono do servidor, o próprio autor, o próprio bot e quem tem Administrador. O cargo de quem pune e o cargo do bot precisam estar acima do alvo. O dono do servidor pode punir sem o bit daquela permissão e acima da própria posição de cargo; a hierarquia e a permissão do bot continuam obrigatórias, assim como as proteções de alvo. Nos demais casos, moderador e bot precisam da permissão da ação.

Sem canal de logs utilizável, nenhuma punição é enviada ao Discord. Se o Discord recusar, a resposta diz que a punição não foi aplicada e a auditoria não fica como sucesso. Se o Discord aplicar e o canal de logs falhar, a resposta diz que a punição ocorreu e que o log não foi entregue.

Os comandos são só de servidor (`GuildInstall`, contexto Guild, sem DM) e só respondem nos IDs de `ALLOWED_GUILD_IDS`. A visibilidade padrão do Discord não substitui essas checagens.

## Permissões do bot

O convite não pede Administrador. Além de Kick, Ban, Moderate Members, View Channel, Send Messages e Embed Links, o ticket precisa de Manage Channels, Read Message History e Attach Files. A candidatura precisa de Manage Roles para conceder um cargo. O valor é `1099780181014`.

```text
https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot%20applications.commands&permissions=1099780181014
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

O banco é `data/moderation.sqlite`. As migrações 1 e 2 criam moderação e o catálogo antigo. A migração 3 copia os planos de 4 vCPU para o catálogo novo, apaga só o rótulo de preço temporário e não mexe no preço que a equipe já alterou. A coluna numérica `stock` continua no banco, junto com tickets, transcrições e auditoria. A migração 5 só acrescenta colunas de texto na aparência. Ela não apaga linhas, não zera preço e não reescreve o status de um ticket. `data/`, `node_modules/`, `.env` e logs ficam fora do Git.

## Catálogo e tickets

A marca padrão é Atlas. Se o banco ainda tiver o texto exato Nyx ou Nyx Cloud como padrão antigo, a migração troca só esse padrão. Preço, permissões, o número antigo de estoque e o texto histórico de uma transcrição não são reescritos. Um ticket `open` continua `open`. Um ticket `closed` continua `closed`.

Não há pagamento nem provisionamento. O catálogo é uma mensagem Components V2 com três seletores: 4 vCPUs, 8 vCPUs e 16 vCPUs. Escolher um período disponível abre o ticket privado na hora, sem modal de e-mail, sistema ou observações. Esgotado não abre ticket, mesmo que o clique venha de uma mensagem antiga. Abrir ou fechar não soma nem diminui a quantidade guardada na coluna `stock`. Quando preço ou disponibilidade mudam, a mensagem já publicada é editada no lugar.

| Produto | Semanal, 7 dias | Quinzenal, 15 dias | Mensal, 30 dias |
| --- | --- | --- | --- |
| 4 vCPUs | R$35,90, disponível | R$49,90, disponível | Esgotado, sem preço inventado |
| 8 vCPUs | sem preço, seletor desativado | sem preço | Esgotado, sem preço |
| 16 vCPUs | R$45,00, disponível | R$75,00, disponível | Esgotado, sem preço |

Não há plano de 6 horas nem de 1 dia. Cada pessoa só pode ter um ticket aberto por produto e duração. O canal nasce invisível para `@everyone` e visível para quem abriu, o cargo da equipe e o bot. Assumir é atômico e só a equipe, o dono ou um administrador incluído consegue. A transcrição sai em HTML escapado, só no canal privado configurado. O canal do ticket é apagado depois da contagem 5, 4, 3, 2 e 1, e somente se essa transcrição tiver sido salva. Se a transcrição, a permissão ou o texto das mensagens faltarem, o canal continua.

Antes do primeiro ticket, o dono abre `/configurar` e confirma a categoria, o cargo da equipe e o canal privado da transcrição.

Para preço e disponibilidade, o caminho é `/configurar`, depois **4 vCPU**, **8 vCPU** ou **16 vCPU**, depois a duração. O formulário pede preço em reais e `disponivel` ou `esgotado`. O resumo só grava depois de **Confirmar**. O 8 vCPU permanece fechado até receber um preço e ser marcado disponível. Não é preciso digitar ID de produto.

## Candidatura à equipe

`/configurar`, botão **Formulários**, guarda tudo por servidor. As inscrições nascem fechadas. O dono ou um administrador incluído confirma o canal público, o canal privado de análise, os cargos avaliadores e o cargo concedido na aprovação. `/formularios`, usado no canal público, publica o painel Components V2. Mudar abertura ou aparência edita esse painel no lugar.

O painel tem **Fazer formulário** e **Minha candidatura**. O texto fixo avisa que só avaliadores autorizados leem as respostas e que elas não vão para um canal público. As perguntas iniciais são motivação, experiência e disponibilidade. Dá para adicionar, editar, remover e reordenar, até 15 perguntas. O enunciado tem no máximo 45 caracteres, o complemento 100, a resposta curta 200 e a longa 1000. O modal do Discord aceita 5 campos, então o formulário segue em etapas de 5. O rascunho fica no banco, pode ser retomado e só é enviado depois da revisão e da confirmação. Não há pergunta padrão de senha, documento, endereço ou e-mail.

O canal de análise precisa ser de texto, invisível para `@everyone` e utilizável pelo bot. Se não for, o envio é recusado e o rascunho permanece. O painel de análise tem assumir, aprovar, recusar e apagar. Aprovar pede confirmação e concede somente o cargo escolhido. Recusar pede um motivo de 5 a 400 caracteres e não concede cargo. O candidato não analisa a própria candidatura. Um clique antigo, de outro servidor ou com ID inexistente não decide nada. Duas decisões ao mesmo tempo resultam em um único cargo. Se o Discord falhar, a pessoa sair ou o cargo sumir, a candidatura não fica marcada como aprovada e a aprovação pode ser tentada de novo.

O cargo é recusado quando é `@everyone`, gerenciado, o cargo da equipe dos tickets, tem Administrador, Gerenciar cargos ou Gerenciar servidor, ou está acima do bot ou de quem aprova. O bot precisa da permissão Gerenciar cargos no servidor. O registro fica até a pessoa apagar os próprios dados em `/candidatura` ou um avaliador confirmar a exclusão. Apagar o registro não tira um cargo já concedido. O aviso direto é opcional: se a DM falhar, o bot não diz que ela foi enviada.

Aparência fica em `/configurar`, botão **Aparência**. Dali saem **Visual do catálogo** (emoji, texto introdutório e banner HTTPS), **Mensagem do ticket** (emoji do título, saudação com `{produto}`, `{duracao}`, `{preco}`, `{usuario}` e `{equipe}`, mais banner), **Emojis dos botões** (assumir, liberar, transcrição e fechar), **Textos dos planos** (título, emoji e placeholder de cada seletor) e **FAQ e jogos** (textos privados; os botões só aparecem se houver texto). A prévia aparece antes da confirmação. Isso não muda o perfil global do bot e vale só para aquele servidor. Emoji inválido, URL que não seja HTTPS e menção solta são recusados.

## Máquinas virtuais

`/menu` abre o menu privado das VMs vinculadas à pessoa. `/maquinas`, ou o botão **Máquinas** em `/configurar`, é só do dono ou de um administrador incluído. A marca do painel é Atlas.

O menu mostra estado, IPs, tamanho, CPU, RAM, GPU, disco e validade. O que não foi cadastrado aparece como não informado. O seletor de categoria troca os botões na mesma mensagem: Energia, Conexão, Plano e validade, Armazenamento e Suporte. Ligar pede a Azure na hora. Desligar e reiniciar pedem confirmação e depois editam a mesma resposta para “Enviando solicitação para o Azure”. Uma operação de energia por VM fica bloqueada por 20 segundos.

Credenciais e PIN só aparecem na resposta privada do cliente, e só se o administrador gravou. A senha fica cifrada no SQLite com `AZURE_CREDENTIALS_KEY` ou, na falta dela, com o segredo do service principal. Trocar essa chave torna o texto antigo ilegível. Liberar PIN não entra na VM: registra o pedido para a equipe. Testar conexão olha o estado, o IP público e a porta TCP 47989. IPs privados não são consultados.

Aumentar o disco não chama a Azure no clique do cliente. O pedido fica pendente e a equipe aprova em `/maquinas`. O tamanho novo precisa ser maior, até `AZURE_MAX_OS_DISK_GB` (2048 no exemplo), e a VM precisa estar desalocada. O disco nunca diminui.

`/maquinas` mostra o bloco **Padrões Azure**: local, tamanho, sistema, disco máximo, snapshot, VNet e subnet. Esses valores só sugerem o cadastro. O formulário manual de nova VM continua disponível. **Importar da Azure** lista as VMs da assinatura, 25 por página, com filtro de resource group. A seleção lê tamanho, sistema, Spot ou Regular, IPs, disco e estado. CPU, RAM e GPU saem do resource SKU ou da tabela do `Standard_NC4as_T4_v3`. O cliente, a validade e as credenciais são opcionais no resumo e só entram depois da confirmação. Nenhuma VM é criada ou alterada na Azure. Para listar, o service principal precisa de leitura na assinatura ou nos grupos, por exemplo o papel Reader. Sem essa leitura, o painel avisa que a permissão falta.

`PANEL_COLOR` é a cor dos containers quando a aparência do servidor não define outra. Aceita hex com ou sem `#`. Valor inválido volta para `5865F2`.

`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY` e `AI_ASSISTANT_ENABLED` ficam reservados para um assistente futuro. Com `AI_ASSISTANT_ENABLED=false` nada disso é chamado.

Auto ligamento fica no menu de Energia e também pode ser pausado para o servidor inteiro. A cada minuto, se a Azure estiver configurada, o bot lê o instance view das VMs Spot marcadas para continuar ligadas. Se o estado desejado é `running` e a VM aparece `deallocated`, isso é tratado como eviction. Desligar pelo bot grava a intenção `stopped` e não religa. Falha de capacidade Spot espera 1, 2, 4, 8 e no máximo 15 minutos, até 6 tentativas, e depois descansa 30 minutos. Scheduled Events da Azure só existem de dentro da VM, então a distinção é feita por esse estado e pelo texto de eviction/preempt no instance view, não por um agente.

Sem `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` e `AZURE_SUBSCRIPTION_ID` o bot sobe normalmente e o menu avisa que a integração não está configurada. Para criar o service principal com o papel mínimo no grupo de recursos:

```bash
az ad sp create-for-rbac --name atlasby-vm --role "Virtual Machine Contributor" --scopes /subscriptions/ASSINATURA/resourceGroups/GRUPO
```

O papel Contributor também altera outros recursos da VM. Um papel personalizado mais estreito precisa de leitura, instance view, start, deallocate, restart e, só se forem aprovar aumento de disco, escrita do disco do sistema, além da leitura da interface de rede e do IP público. Ligar uma VM volta a cobrar computação. Spot é mais barata e pode ser interrompida. Desalocar para a cobrança de computação e mantém o disco. Pausar o auto ligamento evita que o bot religue sozinho.

O canal de log das VMs precisa ser privado. Senha e PIN não entram nesse registro.

## Host

O passo a passo verificado do Bot-Hosting.net, o backup por SFTP e o script manual inativo estão em [docs/bot-hosting.md](docs/bot-hosting.md). Entry file: `index.js`. Não use Replace all nem troca de tipo de runtime num servidor que já tem dados. Push para o GitHub não publica no host: não há webhook de push documentado na API verificada.

## O que falta para ficar no ar

1. Criar a aplicação no portal do Discord e guardar token e client ID só no host.
2. Convidar o bot com o link acima e posicionar o cargo.
3. Fazer o backup SFTP do servidor atual.
4. Ligar este repositório privado pelo painel, com Merge, Node.js 24 e entry `index.js`.
5. Preencher `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` e `ALLOWED_GUILD_IDS`. Canal de logs, preços e administradores não vão no ambiente.
6. O host que já usa `cursor/catalogo-components-v2-850e` não precisa trocar de branch. Este repositório não faz merge nem restart. O código novo só entra no processo quando quem opera o host reiniciar.
7. No Discord, o dono usa `/configurar` e confirma categoria, cargo, preço e disponível ou esgotado. `/catalogo` publica os seletores. Um período disponível abre o ticket. Em **Formulários**, confirma canais, avaliadores, cargo de aprovação e abertura. `/formularios` publica o painel. Quem já tem o bot no servidor precisa marcar Gerenciar cargos no cargo do bot; este repositório não altera cargos ao vivo.
8. Para as VMs, preencha no host só `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` e `AZURE_SUBSCRIPTION_ID`. Depois use `/maquinas` para cadastrar e vincular. Sem essas variáveis o menu continua no ar e avisa que a Azure não está configurada.
