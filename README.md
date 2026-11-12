# Atlas Cloud PC

Painel de clientes da Atlas Cloud PC no Discord. O membro consulta o próprio plano e controla a própria máquina. A equipe cadastra os clientes por comandos separados. A interface usa Discord Components V2.

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
| `AZURE_SNAPSHOT_ID` | vazio | snapshot usado ao formatar |
| `AZURE_LOCATION`, `AZURE_DEFAULT_VM_SIZE`, `AZURE_OS_TYPE`, `AZURE_VIRTUAL_NETWORK`, `AZURE_SUBNET`, `AZURE_MAX_OS_DISK_GB` | os do exemplo | lidas para o host; o painel não cria VM |
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
| `/renovar-plano` | escolhe semanal, quinzenal ou mensal; o vencimento é calculado e pode ser informado |
| `/configurar suporte` | grava a URL do botão de suporte |
| `/configurar logs` | grava o canal de log |
| `/configurar emoji` | substitui um emoji deste servidor |

O cadastro pede nome do cliente, nome da máquina, IP de reserva, usuário RDP, senha RDP e plano. Depois, um seletor lista as VMs da assinatura. A escolha preenche o Resource ID e lê GPU, vCPU e RAM do tamanho da VM. **Nenhuma VM agora** deixa o hardware para o administrador informar, inclusive NVIDIA A10, e o Resource ID manual continua opcional. **Salvar** é o único passo que grava. `/listar-vms` mostra todas, inclusive as já vinculadas.

O IP público da VM, quando ela tem Resource ID, vem da interface de rede na Azure e substitui o IP digitado. Se a nuvem não tiver IP, fica o valor manual.

Planos: semanal soma 7 dias, quinzenal 15 e mensal 30, no fuso `America/Sao_Paulo`. A data de vencimento pode ser editada.

## O que o cliente vê

**Controlar VM** abre um cartão privado em imagem: Atlas, Seu poder em nuvem, status, GPU e vCPU, IP, tempo do plano, plano e última consulta. Se a imagem não puder ser gerada, o mesmo conteúdo aparece em texto. Os botões são Ligar ou Desligar, Liberar PIN, Acesso RDP, Formatar VM, Atualizar e Desparear dispositivos. Liberar PIN pede os 4 dígitos do Moonlight e envia ao agente da VM.

**Consultar plano** mostra plano, início, vencimento, tempo restante e status.

PIN, usuário, senha e IP do RDP saem só na resposta privada de quem é o dono do registro. Cada botão confere o `userId`. Um membro não abre a máquina de outro.

Formatar pede um botão vermelho e, em seguida, um modal com o nome da máquina ou `CONFIRMAR`. A confirmação expira. Na Azure, a VM é desligada e o disco do sistema é recriado a partir de `AZURE_SNAPSHOT_ID`. Sem Azure, sem resource ID ou sem snapshot, nada é alterado na nuvem: o pedido fica no log e a equipe é avisada.

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

Com as quatro variáveis Azure, o bot usa `@azure/identity` e `@azure/arm-compute`. O ID da máquina é o resource ID completo da VM. Formatar copia `AZURE_SNAPSHOT_ID` para um disco novo e troca o disco do sistema. A VM fica desligada. Consulta de estado espera 20 segundos; ligar, desligar e formatar esperam até 90 segundos por etapa. A interação é adiada antes dessas chamadas.

Sem as quatro variáveis, o provedor manual só registra e avisa a equipe.

O log vai para `ADMIN_LOG_CHANNEL_ID` ou para o canal de `/configurar logs`, e também para a tabela `action_logs`. Senha e PIN não entram nesse texto.

## Agente na VM

Todas as máquinas usam o mesmo `AGENT_SECRET`. Ele entra no bot e no `agent.config.json` da imagem base. Uma VM criada dessa imagem já fala com o bot, sem token por cliente.

1. Na VM base, instale o Sunshine e defina o usuário e a senha do painel web.
2. Copie a pasta `agent` para a VM.
3. Preencha `agent/agent.config.json`: `AgentSecret` com o mesmo valor de `AGENT_SECRET`, `SunshineUser` e `SunshinePassword` com o painel do Sunshine. `AgentPort` fica `7474` se você não mudar `AGENT_PORT`.
4. Abra o PowerShell como Administrador nessa pasta e execute `.\install.ps1`.
5. O instalador copia os arquivos para `C:\ProgramData\AtlasCloudPC\`, libera a porta TCP no firewall do Windows e registra a tarefa **Atlas Cloud PC Agent**. Ela sobe com o Windows, como SYSTEM, reinicia após falha e não tem limite de tempo.
6. No grupo de segurança da Azure, libere entrada TCP `7474` para o endereço de saída do bot. O bot chama `http://<IP público da VM>:7474`.
7. Confira o agente e capture a imagem. As próximas VMs saem com o agente e o mesmo segredo.

O agente escuta `http://+:7474/` e só aceita `Authorization: Bearer` com comparação em tempo constante. `POST /pin` manda `{pin, name:"Cliente"}` ao Sunshine em `https://127.0.0.1:47990/api/pin`. O certificado autoassinado só é aceito nesse endereço. `POST /unpair-all` chama `/api/clients/unpair-all`. `GET /health` diz se o agente está online. O PIN não é gravado em log.

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
| Formatação | frase errada, outro usuário, prazo e `CONFIRMAR`; o snapshot é copiado na ordem certa |
| Painéis | Components V2, textos, botões e galeria |
| Adiamento | o defer acontece antes da leitura na Azure |
| Ambiente | o exemplo contém as variáveis e os segredos ficam vazios |

No Discord, depois que o host reiniciar o processo: publique o painel, cadastre um cliente de teste, clique em Controlar VM com a conta do cliente e com outra conta, consulte o plano, mostre PIN e RDP, atualize, ligue e desligue, e só então teste a formatação com o nome da máquina.

## Limitações

Há uma máquina por membro em cada servidor. O banco antigo não é importado. Formatar troca o disco do sistema e deixa a VM desligada; discos de dados não entram nessa operação. O cartão usa `@resvg/resvg-wasm` e a fonte Inter. O IP público usa `@azure/arm-network`. A cor `PANEL_COLOR` passa a valer no próximo processo. Ollama permanece desligado.
