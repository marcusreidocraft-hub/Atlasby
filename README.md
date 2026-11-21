# Ignix Cloud PC

Painel de clientes da Ignix Cloud PC no Discord. O membro consulta o próprio plano e controla a própria máquina. A equipe cadastra os clientes por comandos separados. A interface usa Discord Components V2.

O entry point é `index.js`. O host em Node 24 faz pull ao reiniciar. Este repositório não reinicia a hospedagem.

## Instalação

```bash
npm ci
npm test
npm start
```

`npm run setup` só cria o banco em `DATA_DIR`, sem token e sem conectar ao Discord.

Preencha o ambiente no host, nunca no Git. O arquivo [`.env.example`](.env.example) lista todas as variáveis. Segredos ficam vazios.

## Variáveis

Obrigatórias para o processo conectar:

| Variável | Uso |
| --- | --- |
| `DISCORD_TOKEN` | token do bot |
| `DISCORD_CLIENT_ID` | ID da aplicação |
| `ALLOWED_GUILD_IDS` | servidores autorizados, separados por vírgula |

Sem `ALLOWED_GUILD_IDS` o bot sobe, mas não registra comandos nem responde.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `DATA_DIR` | `data` | pasta do `atlas.sqlite` |
| `AGENT_SECRET` | vazio | segredo igual em todas as VMs. Vazio desliga o PIN |
| `AGENT_PORT` | `7474` | porta do agente dentro da VM |
| `SERVER_PORT` | vazio | porta do webhook. Vazio desliga o servidor HTTP |
| `PUBLIC_URL` | vazio | origem HTTPS do webhook, sem barra no fim |
| `WYZECASH_API_KEY` | vazio | chave `wyze_…` da WyzeCash. Vazio desliga a cobrança |
| `WYZECASH_WEBHOOK_SECRET` | vazio | segredo de assinatura do webhook |
| `WYZECASH_API_BASE` | `https://app.wyzecash.com.br/v1` | endereço da API |
| `CONFIRMATION_TTL_SECONDS` | `60` | prazo da formatação, de 15 a 300 |
| `ENABLE_MESSAGE_CONTENT_INTENT` | falso | lida e não usada |
| `PANEL_COLOR` | `5865F2` | cor dos containers, com ou sem `#` |
| `PANEL_BANNER_URL` | vazio | imagem https da galeria e da miniatura |
| `SUPPORT_CHANNEL_URL` | vazio | botão Suporte / Tickets |
| `ADMIN_ROLE_IDS` | vazio | cargos que administram, além de quem tem Administrador |
| `ADMIN_LOG_CHANNEL_ID` | vazio | canal dos logs |
| `CREDENTIALS_KEY` | vazio | cifra senha RDP e PIN |
| `AZURE_CREDENTIALS_KEY` | vazio | usada se `CREDENTIALS_KEY` estiver vazia |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID` | vazios | ligam o provedor Azure |
| `AZURE_IMAGE_ID` | a versão Atlas2.0 1.0.0 | imagem da galeria usada para criar e formatar |
| `AZURE_SNAPSHOT_ID` | vazio | legado; só vale se a imagem configurada for um snapshot |
| `AZURE_LOCATION`, `AZURE_DEFAULT_VM_SIZE`, `AZURE_OS_TYPE`, `AZURE_VIRTUAL_NETWORK`, `AZURE_SUBNET`, `AZURE_MAX_OS_DISK_GB` | os do exemplo | região, tamanho padrão, rede e teto do disco |
| `AZURE_RESOURCE_GROUP` | vazio | grupo onde `/criar-maquina` cria a VM. Vazio bloqueia o assistente |
| `AZURE_NSG` | `Atlas-nsg` | grupo de segurança da placa de rede |
| `AZURE_ZONE` | vazio | zona 1, 2 ou 3. O SSD v2 usa a mesma zona da VM |
| `AZURE_DATA_IOPS` | `3000` | IOPS base sugerido do disco de dados |
| `EMOJI_CONTROLE`, `EMOJI_CALENDARIO`, `EMOJI_TICKET`, `EMOJI_MOONLIGHT`, `EMOJI_RDP`, `EMOJI_ALERTA`, `EMOJI_ENGRENAGEM`, `EMOJI_POWER` | vazios | opcionais; só preencha para trocar o emoji padrão |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY`, `AI_ASSISTANT_ENABLED` | o exemplo, `false` | reservadas; o bot não chama o Ollama |

Trocar a chave de criptografia torna senha e PIN antigos ilegíveis.

## Publicar o painel

No canal desejado, um administrador usa `/painel-publicar`. A mensagem fica no canal, com os botões estáveis `atlas:panel:control` e `atlas:panel:plan`. Eles continuam válidos depois de reiniciar.

O botão **Suporte / Tickets** só aparece com `SUPPORT_CHANNEL_URL` ou depois de `/configurar suporte`. Se o link ou os emojis mudarem, publique de novo: a mensagem já enviada guarda o que tinha na hora.

## Comandos

Todos exigem a permissão Administrador ou um cargo de `ADMIN_ROLE_IDS`. A resposta é privada.

| Comando | O que faz |
| --- | --- |
| `/painel-publicar` | publica o painel neste canal |
| `/adicionar-cliente` | escolhe o membro e abre três modais, com no máximo cinco campos cada |
| `/editar-cliente` | o mesmo fluxo, com os dados atuais; senha e PIN em branco mantêm os gravados |
| `/remover-cliente` | pede confirmação e apaga o cadastro, não a VM |
| `/buscar-cliente` | busca por nome, máquina, ID ou IP |
| `/listar-clientes` | lista paginada |
| `/listar-vms` | lista as VMs da assinatura Azure, com estado e cliente vinculado |
| `/assinatura` | mostra a assinatura, o custo do mês e a cota Spot |
| `/renovar-plano` | escolhe semanal, quinzenal ou mensal; o vencimento é calculado e pode ser informado |
| `/configurar suporte` | grava a URL do botão de suporte |
| `/configurar logs` | grava o canal de log. O mesmo campo do `/configurar-atendimento` |
| `/configurar-atendimento` | cargo de suporte, categoria dos tickets e canal de logs |
| `/configurar emoji` | substitui um emoji deste servidor |

O cadastro pede nome do cliente, nome da máquina, IP de reserva, usuário RDP, senha RDP e plano. Depois, um seletor lista as VMs da assinatura. A escolha preenche o Resource ID e lê GPU, vCPU e RAM do tamanho da VM. **Nenhuma VM agora** deixa o hardware para o administrador informar, inclusive NVIDIA A10, e o Resource ID manual continua opcional. **Salvar** é o único passo que grava. `/listar-vms` mostra todas, inclusive as já vinculadas.

O IP público da VM, quando ela tem Resource ID, vem da interface de rede na Azure e substitui o IP digitado. Se a nuvem não tiver IP, fica o valor manual.

Planos: semanal soma 7 dias, quinzenal 15 e mensal 30, no fuso `America/Sao_Paulo`. A data de vencimento pode ser editada.

## Atendimento

Um administrador publica a central com `/atendimento-publicar` no canal desejado. O membro escolhe Suporte, Parcerias ou Outros, descreve o motivo e recebe o link do canal privado. A equipe usa o seletor **Ações administrativas** para chamar o cliente, abrir ou remover a sala de voz, adicionar ou remover um membro, gerar o Pix ou fechar o ticket. O horário do rodapé muda com `/configurar horario`. Um emoji da central muda com `/configurar ticket-emoji`. Quem não é da equipe vê que a ação é restrita. Fechar grava a transcrição no canal de logs.

## Termos

Um administrador publica os Termos de Uso com `/termos`. O canal é opcional e, se ficar vazio, a publicação sai no canal atual. O texto fica em `src/content/termos.js`. A mensagem abre com o título Termos de Uso - Ignix e termina com a data da publicação. O link de suporte da seção de atendimento sai de `/configurar suporte`.

## Anúncio

Um administrador publica com `/anuncio publicar`. O canal é opcional. O comando abre um formulário com título, texto, rodapé, URL da imagem e botão no formato `texto|https://`. Antes de enviar, aparece uma prévia com Publicar, Editar e Cancelar. A imagem anexada em `imagem` vale mais que a URL. `miniatura` ou `url_miniatura` fica ao lado do título. `cor` aceita hexadecimal e, vazia, usa a cor do painel. `mencionar` aceita um cargo, `@everyone` ou `@here`. `emoji` troca o megafone do título; `nenhum` o omite. `/anuncio editar mensagem:` reabre um anúncio que este bot publicou. O canal de logs recebe o registro.

## Convites

Um administrador publica o painel com `/convites painel`. O canal é opcional. `/convites canal` define onde o bot cria o link pessoal, sem prazo e sem limite de usos. O membro aperta **Criar convite** e recebe o link, a contagem válida, os pendentes, a próxima meta e a lista de convidados. **Atualizar** relê os dados.

O convite fica pendente por 24 horas. Só depois disso entra na conta. Se a pessoa sair antes ou depois, o status vira saiu e, se já contava, volta um convite. O indicador recebe um privado. Se o privado estiver fechado, o bot só registra o aviso. A mesma pessoa não conta duas vezes.

As metas padrão são 10 convites = 6 horas, 20 = 12 horas, 30 = 24 horas, 40 = 3 dias e 55 = 1 semana. Cada meta gera uma bonificação uma única vez. O canal de logs recebe **Entregar** e **Recusar**. Entregar estende o plano ativo; sem plano ativo, fica marcado para a equipe aplicar na mão. A contagem pode cair depois da entrega, e a bonificação não é desfeita.

`/convites ver`, `/convites ajustar`, `/convites resetar` e `/convites ranking` são de administrador. O bot precisa dos intents **Guild Members** e **Guild Invites**, e das permissões **Gerenciar Servidor** e **Criar Convite**. Sem o intent de membros ele não recebe quem entra ou sai. Sem Gerenciar Servidor ele avisa no log e não lê os links.

## Assinatura

`/assinatura` responde em privado. O painel mostra o nome, o ID abreviado, o estado, a oferta e o tenant. O custo traz o mês atual, o mês anterior, a moeda e os cinco serviços mais caros. A cota de Brazil South lista os vCPU Spot, os vCPU regionais e a família NCASv3_T4, com uma barra de uso. **Atualizar** reaproveita a consulta por 10 minutos. **Forçar** consulta de novo. O seletor troca a região da cota entre Brazil South, East US, East US 2, South Central US e West US 2.

O aplicativo precisa das funções **Leitor** e **Cost Management Reader** na assinatura. Sem elas, o painel avisa e mostra só o que conseguiu ler. O crédito de avaliação ou de Azure for Students aparece quando a API de saldo responde. Contributor continua necessário para criar VM; ele não substitui a leitura de custo.

## Criar máquina

Um administrador usa `/criar-maquina`. O assistente pede o membro, o tamanho T4, Spot ou Normal, o disco, o NSG da mesma região e, no SSD v2, tamanho, IOPS, taxa e zona. Dá para usar o NSG do ambiente, escolher um existente ou criar o NSG da Ignix com Moonlight, RDP e o agente de PIN. A revisão expira no mesmo prazo das outras confirmações. A criação mostra o andamento e, no fim, cadastra o cliente com plano mensal. Se a Azure recusar, o bot apaga o que chegou a criar. O aplicativo precisa da função Contributor no grupo de recursos ou na assinatura.

## O que o cliente vê

**Controlar VM** abre um cartão privado em imagem: Ignix, Seu poder em nuvem, status, GPU e vCPU, IP, tempo do plano, plano e última consulta. Se a imagem não puder ser gerada, o mesmo conteúdo aparece em texto. Os botões são Ligar ou Desligar, Liberar PIN, Acesso RDP, Formatar VM, Atualizar e Desparear dispositivos. Liberar PIN pede os 4 dígitos do Moonlight e envia ao agente da VM.

**Consultar plano** mostra plano, início, vencimento, tempo restante e status.

PIN, usuário, senha e IP do RDP saem só na resposta privada de quem é o dono do registro. Cada botão confere o `userId`. Um membro não abre a máquina de outro.

Formatar pede um botão vermelho e, em seguida, um modal com o nome da máquina ou `CONFIRMAR`. A confirmação expira. Na Azure, a VM é desligada e o disco do sistema é recriado pela imagem da galeria. O IP e o vínculo do cliente permanecem. Sem Azure ou sem resource ID, nada é alterado na nuvem: o pedido fica no log e a equipe é avisada.

Ligar e desligar usam o resource ID. Sem Azure, o status local não muda e a equipe é avisada. A linha de instância Spot lembra de ligar de novo se a máquina cair.

## Emojis

Não é preciso preencher `EMOJI_*`. O código já traz os emojis do servidor como padrão. A ordem é: `/configurar emoji` neste servidor, depois a variável de ambiente se estiver preenchida, depois esse padrão, depois o Unicode.

O padrão só entra no botão se o bot enxergar o emoji no cache (`guild.emojis.fetch` ou o cache do client). Sem esse acesso, o botão usa o Unicode, porque um emoji inválido impede a mensagem.

| Chave | Padrão | Uso | Unicode |
| --- | --- | --- | --- |
| `controle` | `<:8688gaming:1568512664705961985>` | título e Controlar VM | 🎮 |
| `calendario` | `<:timer:1568512986484711425>` | Consultar plano e tempo | 🗓️ |
| `ticket` | `<:49457ticket:1568512619722309644>` | Suporte / Tickets | 🎟️ |
| `moonlight` | `<:moonzinho:1568512334245138452>` | PIN Moonlight | 🌙 |
| `rdp` | `<:rdp:1568512345825878049>` | Acesso RDP | 🖥️ |
| `alerta` | `<:5577warning:1568512629847101531>` | Formatar VM | ⚠️ |
| `engrenagem` | `<:dgear:1568512697002098728>` | Atualizar | ⚙️ |
| `power` | `<:disactiv:1568512700739362897>` | Ligar e Desligar | ⏻ |
| `ligada` | `<:reduto_on:1570365824810877048>` | status Ligada | 🟢 |
| `desligar` | `<:desligar:1570370496673873952>` | botão Desligar VM | ⏹️ |

Quando um título, status ou campo combina com outro emoji do mesmo servidor, ele também entra, se o bot o enxergar: monitor, windows, world, externallink, mail, pencil, tools, star, cash, bell, megaphone, 8011admin, 47106member, 1906add, 53136verified, 12560blackarrow, 7957link, 44216vip e gavel. Fora do cache, esse detalhe fica sem emoji. Publique o painel de novo se trocar um emoji da mensagem do canal.

## Provedor

Com as quatro variáveis Azure, o bot usa `@azure/identity` e `@azure/arm-compute`. O ID da máquina é o resource ID completo da VM. Formatar recria o disco do sistema pela imagem especializada da galeria, sem perfil de sistema, e deixa a VM desligada. Consulta de estado espera 20 segundos; ligar, desligar e formatar esperam até 90 segundos por etapa. A interação é adiada antes dessas chamadas.

Sem as quatro variáveis, o provedor manual só registra e avisa a equipe.

O log vai para `ADMIN_LOG_CHANNEL_ID` ou para o canal de `/configurar logs`, e também para a tabela `action_logs`. Senha e PIN não entram nesse texto.

## Agente na VM

Todas as máquinas usam o mesmo `AGENT_SECRET`. Ele entra no bot e no `agent.config.json` da imagem base. Uma VM criada dessa imagem já fala com o bot, sem token por cliente.

1. Na VM base, instale o Sunshine e defina o usuário e a senha do painel web.
2. Copie a pasta `agent` para a VM.
3. Preencha `agent/agent.config.json`: `AgentSecret` com o mesmo valor de `AGENT_SECRET`, `SunshineUser` e `SunshinePassword` com o painel do Sunshine. `AgentPort` fica `7474` se você não mudar `AGENT_PORT`.
4. Abra o PowerShell como Administrador nessa pasta e execute `.\install.ps1`.
5. O instalador copia os arquivos para `C:\ProgramData\AtlasCloudPC\`, libera a porta TCP no firewall do Windows e registra a tarefa **Ignix Cloud PC Agent**. Ela sobe com o Windows, como SYSTEM, reinicia após falha e não tem limite de tempo.
6. No grupo de segurança da Azure, libere entrada TCP `7474` para o endereço de saída do bot. O bot chama `http://<IP público da VM>:7474`.
7. Confira o agente e capture a imagem. As próximas VMs saem com o agente e o mesmo segredo.

O agente escuta `http://+:7474/` e só aceita `Authorization: Bearer` com comparação em tempo constante. Falhas de início, do listener e do Sunshine ficam em `C:\ProgramData\AtlasCloudPC\agent.log`, sem PIN e sem segredo. Se `agent.config.json` não estiver ao lado do instalador, a instalação para e avisa. `POST /pin` manda `{pin, name:"Cliente"}` ao Sunshine em `https://127.0.0.1:47990/api/pin`. O certificado autoassinado só é aceito nesse endereço. `POST /unpair-all` chama `/api/clients/unpair-all`. `GET /health` diz se o agente está online. O PIN não é gravado em log.

Sem `AGENT_SECRET`, o bot avisa o administrador e não chama a VM. Se a VM estiver desligada, a resposta pede para ligá-la. Se o agente não responder em 12 segundos, a mensagem é: "Agente da VM não respondeu, tente de novo em instantes".

## Como testar

```bash
npm test
```

Os testes não usam Discord, Azure nem segredo real.

| Função | O que o teste confere |
| --- | --- |
| Permissão | Administrador, dono e cargo entram; o resto não grava |
| Isolamento | outro membro não vê IP, senha nem dispara a energia |
| Criptografia | a senha cifrada abre com a chave e não aparece no banco nem no log |
| Vencimento | 7, 15 e 30 dias, status vencido e data editada |
| Formatação | frase errada, outro usuário, prazo e `CONFIRMAR`; a VM é atualizada pela imagem, sem `osProfile` |
| Painéis | Components V2, textos, botões e galeria |
| Adiamento | o defer acontece antes da leitura na Azure |
| Ambiente | o exemplo contém as variáveis e os segredos ficam vazios |

No Discord, depois que o host reiniciar o processo: publique o painel, cadastre um cliente de teste, clique em Controlar VM com a conta do cliente e com outra conta, consulte o plano, mostre PIN e RDP, atualize, ligue e desligue, e só então teste a formatação com o nome da máquina.

## Loja

A loja é fixa: IGNIX CLOUD, três planos T4 e os preços do catálogo. `/configurar-loja publicar` grava o canal em que o comando foi usado e edita a mesma mensagem. Se ela foi apagada, publica outra. `/configurar-loja compras` liga ou desliga todas as compras. `/configurar-loja status` mostra a disponibilidade, as ofertas e o link do painel.

A disponibilidade sai da cota da Azure na região `AZURE_LOCATION`. Em Spot, os vCPU livres de baixa prioridade precisam cobrir o plano. Em Normal, a família NCASv3_T4 e os vCPU regionais precisam cobrir juntos. A consulta fica em cache por 2 minutos. A cada `STORE_REFRESH_MS` (entre 2 e 5 minutos, padrão 3) o bot reavalia e só edita o painel se a disponibilidade, uma oferta ou as unidades mudaram. Sem Azure, o plano aparece como Indisponível e o botão fica desativado. `STORE_BANNER_URL` é o banner do topo. Vazio, o painel segue só com o texto.

`/criar-oferta` pede produto, duração, preço promocional (`29,90`), unidades, início e fim em `AAAA-MM-DD HH:MM`, no fuso de São Paulo. O preço precisa ser menor que o original. Não pode haver outra oferta ativa do mesmo produto e plano no mesmo período. O painel mostra o preço antigo riscado, o novo, o desconto e o tempo `<t:...:R>`. A unidade sai na hora da compra e volta se o pedido for cancelado antes da entrega. `/remover-oferta` completa as ofertas ativas.

Também ficam `/pedidos`, `/pedido`, `/cancelar-pedido`, `/configurar-cargo`, `/configurar-azure`, `/configurar-imagem` e `/assinatura`. A categoria dos pedidos continua em `/configurar-atendimento`. Não há mais `/configurar-loja banner`, `texto`, `canal` ou `produto`, nem `/configurar-horas`, `/estoque`, `/adicionar-estoque` ou `/remover-estoque`.

O Pix sai pela WyzeCash. Não há ambiente de testes: toda cobrança é de produção e vale 30 minutos.

A chave é criada no painel da WyzeCash, em Integrações e API › Developer API (Chaves de API), com as permissões `payments:create` e `payments:get`. Ela aparece uma vez e vai em `WYZECASH_API_KEY`. O bot não grava essa chave em log.

O webhook é cadastrado em Integrações e API › Webhooks. A URL é `https://<seu domínio>/webhooks/wyzecash`. Com `PUBLIC_URL` definida, use `<PUBLIC_URL>/webhooks/wyzecash`. O processo escuta essa rota na `SERVER_PORT`. Marque os eventos `payment.paid` e `payment.expired`. O segredo que o painel mostra vai em `WYZECASH_WEBHOOK_SECRET`. A assinatura é o HMAC-SHA256 de `t.` mais o corpo cru, no cabeçalho `X-WyzeCash-Signature`, e só então o pedido é liberado. Um evento repetido não entrega a máquina duas vezes.

O ticket de compra mostra o valor, a oferta quando houver, o QR Code, o Copia e Cola e os botões Copiar código e Já paguei. Já paguei consulta a cobrança uma vez. Enquanto o pedido está pendente, o bot consulta de novo no mesmo intervalo da loja, entre 2 e 5 minutos. Pago, o painel passa a Pagamento confirmado e a VM segue o provisionamento, o cargo e a mensagem privada. Expirar ou cancelar antes da entrega devolve a unidade da oferta. A unidade sai na hora da compra, para duas pessoas não levarem a última.

Antes da primeira venda, publique a loja, defina cargo e rede (`/configurar-azure`, grupo, vnet, subnet e NSG). A imagem padrão da galeria é specialized e Trusted Launch. `/configurar-imagem` troca essa origem; a definição sem versão usa a última. A máquina só é marcada como entregue depois do `GET /health` na porta 7474. Se o agente não responder, o pedido fica em acompanhamento e o alerta vai ao canal de logs.

## Limitações

Há uma máquina por membro em cada servidor. O banco antigo não é importado. Formatar troca o disco do sistema e deixa a VM desligada; discos de dados não entram nessa operação. O cartão usa `@resvg/resvg-wasm` e a fonte Inter. O IP público usa `@azure/arm-network`. A cor `PANEL_COLOR` passa a valer no próximo processo. Ollama permanece desligado.
