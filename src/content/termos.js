export const TERMS_EMOJI = "<:7232rules:1568512643961061386>";
export const TERMS_TITLE = "Termos de Uso - Ignix";
export const TERMS_INTRO = "Ao contratar, acessar ou utilizar os serviços da Ignix Cloud PC, o usuário declara ter lido e concordado com estes Termos de Uso.";

export const TERMS_SECTIONS = Object.freeze([
  {
    number: 1,
    title: "Sobre o serviço",
    paragraphs: [
      "A Ignix Cloud PC fornece acesso temporário a computadores virtuais em nuvem, destinados principalmente a jogos, aplicações gráficas e outras atividades compatíveis com a infraestrutura disponibilizada.",
      "Cada oferta apresentará as principais características do serviço, incluindo configuração da máquina, período contratado, preço e demais condições aplicáveis.",
      "As máquinas são disponibilizadas por período determinado e devem ser consideradas ambientes temporários. Ao término do período contratado, a instância poderá ser encerrada, reprovisionada ou excluída, incluindo os arquivos, programas, configurações e demais dados armazenados nela.",
      "Uma nova contratação poderá resultar na disponibilização de uma nova máquina, não existindo garantia de continuidade ou preservação dos dados da instância utilizada anteriormente.",
    ],
  },
  {
    number: 2,
    title: "Infraestrutura",
    paragraphs: [
      "A infraestrutura computacional utilizada pela Ignix Cloud PC é baseada atualmente em serviços de nuvem da Microsoft Azure.",
      "Parte ou a totalidade das instâncias disponibilizadas pela Ignix poderá utilizar o modelo Azure Spot, sujeito às características específicas descritas nestes Termos.",
      "A Ignix poderá alterar componentes da infraestrutura, regiões, tecnologias, fornecedores ou métodos de provisionamento quando necessário para segurança, disponibilidade, desempenho, expansão ou manutenção do serviço, desde que sejam preservadas as características essenciais do plano contratado.",
      "A utilização de determinado fornecedor, região, modelo de hardware ou arquitetura em uma contratação não garante sua utilização em contratações futuras.",
    ],
  },
  {
    number: 3,
    title: "Hardware",
    paragraphs: [
      "As especificações anunciadas correspondem aos recursos mínimos oferecidos para o plano contratado.",
      "Dependendo da disponibilidade da infraestrutura, a Ignix poderá disponibilizar, sem custo adicional, hardware equivalente ou superior ao anunciado.",
      "A disponibilização de hardware superior em determinada contratação não cria direito adquirido nem garantia de recebimento da mesma configuração em compras futuras.",
      "Por se tratar de infraestrutura em nuvem, modelos específicos de CPU, GPU e outros componentes poderão variar.",
      "A Ignix poderá utilizar diferentes modelos ou gerações de hardware desde que os recursos entregues sejam compatíveis com as características mínimas anunciadas para o plano.",
    ],
  },
  {
    number: 4,
    title: "Planos e duração",
    paragraphs: [
      "A Ignix poderá oferecer planos com duração em horas, dias, semanas ou períodos maiores, incluindo planos de até 30 dias ou outros períodos expressamente apresentados no momento da contratação.",
      "A existência de determinado período em uma oferta não obriga a Ignix a mantê-lo permanentemente disponível.",
      "O período contratado começa a ser contado a partir do momento em que a instância é disponibilizada ao usuário, salvo quando a oferta estabelecer expressamente condição diferente.",
      "A máquina será considerada disponibilizada quando as informações necessárias para seu acesso forem fornecidas ao usuário ou quando a Ignix comunicar que a instância está pronta para utilização.",
      "Desligar a máquina, desconectar-se, não acessar a instância ou deixar de utilizá-la voluntariamente não pausa nem interrompe a contagem do período contratado.",
      "Interrupções decorrentes da infraestrutura Spot serão tratadas conforme as disposições específicas destes Termos.",
    ],
  },
  {
    number: 5,
    title: "Prazo de entrega e provisionamento",
    paragraphs: [
      "Após a confirmação do pagamento, a Ignix poderá levar até 72 horas para provisionar e disponibilizar a instância contratada.",
      "O prazo poderá ser inferior, mas nenhum horário específico de entrega é garantido, salvo quando expressamente informado na oferta.",
      "Quando a disponibilização depender de informações, confirmações ou ações do usuário, o prazo poderá ficar suspenso enquanto essas informações não forem fornecidas.",
      "Análises necessárias relacionadas a suspeitas de fraude, inconsistências no pagamento ou problemas no pedido também poderão afetar temporariamente o processo de provisionamento.",
      "O período contratado da máquina não começa a ser consumido durante o processo normal de provisionamento inicial. A contagem começa somente após a disponibilização da instância ao usuário.",
      "Caso a Ignix não consiga disponibilizar a instância dentro do prazo informado por motivo atribuível à própria Ignix, o usuário poderá solicitar o cancelamento e restituição do valor correspondente ou, se desejar, concordar com um novo prazo de entrega.",
      "Nada nesta cláusula limita direitos assegurados pela legislação aplicável.",
    ],
  },
  {
    number: 6,
    title: "Instâncias Azure Spot",
    paragraphs: [
      "As instâncias disponibilizadas pela Ignix Cloud PC poderão operar utilizando a modalidade Azure Spot da Microsoft Azure.",
      "Instâncias Spot utilizam capacidade computacional disponível temporariamente na infraestrutura da Microsoft e, por sua própria natureza, possuem prioridade inferior às instâncias convencionais.",
      "Isso significa que uma instância Spot poderá ser interrompida, desalocada ou removida pela infraestrutura da Microsoft Azure quando a capacidade utilizada for necessária para outras cargas ou quando outras condições aplicáveis ao serviço Spot determinarem sua retirada.",
      "Não há garantia de disponibilidade contínua ou de que uma instância Spot permanecerá ativa durante todo o período contratado sem interrupções.",
      "Uma interrupção Spot também poderá ocorrer de maneira repentina e com pouco tempo de aviso.",
      "O usuário reconhece, portanto, que interrupções ocasionais decorrentes da natureza da infraestrutura Spot constituem uma característica técnica do serviço.",
      "Quando uma instância for afetada por uma remoção ou desalocação Spot, a Ignix poderá tentar restabelecer a mesma máquina, reprovisionar a instância, migrar o usuário para outra capacidade disponível ou fornecer uma máquina equivalente.",
      "A possibilidade e o tempo necessário para restabelecimento dependerão da disponibilidade de capacidade na infraestrutura da Microsoft Azure e das características técnicas do plano contratado.",
      "Caso uma interrupção Spot impeça de maneira relevante a utilização do serviço por período significativo, a Ignix poderá, conforme as circunstâncias, conceder extensão proporcional do período contratado, substituir a instância ou adotar outra solução adequada.",
      "Nenhuma disposição desta seção exclui direitos legalmente assegurados ao consumidor.",
    ],
  },
  {
    number: 7,
    title: "Disponibilidade",
    paragraphs: [
      "A comercialização e disponibilização dos planos dependem da existência de capacidade computacional adequada na infraestrutura utilizada pela Ignix.",
      "Por utilizar capacidade Spot, a disponibilidade de determinadas configurações poderá variar ao longo do tempo, inclusive após uma instância ter sido inicialmente provisionada.",
      "Mesmo após a realização de um pedido, circunstâncias técnicas poderão impedir temporariamente o provisionamento da configuração originalmente prevista.",
      "Nessas situações, a Ignix poderá oferecer ao usuário uma configuração equivalente ou superior, aguardar nova disponibilidade mediante concordância do usuário ou realizar o cancelamento e restituição correspondente.",
      "A Ignix poderá temporariamente interromper novas vendas ou limitar a quantidade de instâncias disponíveis sempre que necessário para preservar a estabilidade do serviço.",
    ],
  },
  {
    number: 8,
    title: "Ofertas promocionais",
    paragraphs: [
      "Ofertas promocionais poderão possuir quantidade limitada de unidades, prazo determinado, público específico e outras condições próprias.",
      "O encerramento ou esgotamento de uma promoção não obriga a Ignix a disponibilizar novas unidades pelo mesmo preço.",
      "Promoções, descontos, upgrades ou condições concedidas anteriormente não criam direito à repetição do mesmo benefício em futuras contratações.",
      "São válidos o preço e as condições apresentados ao usuário no momento da compra.",
    ],
  },
  {
    number: 9,
    title: "Desempenho",
    paragraphs: [
      "A Ignix fornece a infraestrutura computacional necessária ao funcionamento da instância, mas a experiência final também depende de fatores externos.",
      "Entre esses fatores estão a conexão do usuário, localização, rota de rede, dispositivo utilizado, resolução, codec, software de streaming, capacidade disponível na infraestrutura de nuvem, servidores dos jogos e serviços de terceiros.",
      "Latência, qualidade de imagem, FPS, bitrate, estabilidade ou desempenho de determinado jogo poderão variar.",
      "A Ignix não garante desempenho específico em todos os jogos ou aplicações, nem compatibilidade permanente com todos os softwares, launchers, sistemas anti-cheat ou serviços de terceiros.",
      "Atualizações realizadas por jogos, sistemas operacionais, launchers, drivers, anti-cheats ou outros fornecedores poderão modificar ou impedir o funcionamento de determinados softwares em ambientes de nuvem.",
    ],
  },
  {
    number: 10,
    title: "Manutenções, interrupções e falhas externas",
    paragraphs: [
      "A Ignix poderá realizar manutenções, atualizações, migrações ou outras intervenções técnicas necessárias para manter a segurança e estabilidade do serviço.",
      "Também poderão ocorrer interrupções decorrentes de desalocação de capacidade Spot pela Microsoft Azure.",
      "Falhas ou indisponibilidades da Microsoft Azure, provedores de rede, sistemas de pagamento, plataformas de jogos ou outros fornecedores independentes também poderão afetar temporariamente o serviço.",
      "Sempre que tecnicamente possível, a Ignix poderá buscar restaurar, migrar ou reprovisionar uma instância afetada.",
      "Quando um problema comprovadamente atribuível à infraestrutura sob responsabilidade direta da Ignix prejudicar de maneira relevante o período contratado, poderão ser oferecidos, conforme o caso, extensão proporcional do período, substituição da instância ou restituição correspondente.",
      "Interrupções decorrentes de infraestrutura Spot serão analisadas conforme sua duração e impacto efetivo sobre a utilização do serviço, sem prejuízo dos direitos legalmente assegurados ao consumidor.",
    ],
  },
  {
    number: 11,
    title: "Contas, jogos e serviços de terceiros",
    paragraphs: [
      "O usuário é responsável pelas próprias contas, licenças, jogos e softwares utilizados ou instalados na máquina.",
      "A contratação da Ignix não concede automaticamente licenças para Windows, jogos, programas ou serviços que exijam aquisição ou assinatura própria, exceto quando isso estiver expressamente incluído na oferta.",
      "A Ignix não possui controle sobre bloqueios, suspensões, limitações ou outras medidas aplicadas por Steam, Epic Games, Riot Games, Roblox, Microsoft, publishers, sistemas anti-cheat ou qualquer outro serviço externo.",
      "A utilização da infraestrutura da Ignix não garante que uma conta, jogo ou software será considerado elegível ou compatível por serviços de terceiros.",
    ],
  },
  {
    number: 12,
    title: "Dados armazenados na instância",
    paragraphs: [
      "As máquinas da Ignix devem ser consideradas temporárias.",
      "O usuário é responsável por manter cópias de segurança de todos os arquivos, saves, documentos ou outras informações que deseje preservar.",
      "Após o encerramento, expiração, cancelamento, reprovisionamento ou substituição da instância, os arquivos e configurações nela existentes poderão ser excluídos permanentemente e sem possibilidade de recuperação.",
      "Uma remoção ou desalocação Spot também poderá exigir reprovisionamento ou substituição da máquina.",
      "Por esse motivo, o usuário não deverá presumir que arquivos armazenados exclusivamente dentro da instância permanecerão disponíveis durante todo o período contratado.",
      "A Ignix Cloud PC não deve ser utilizada como serviço permanente de armazenamento ou backup.",
      "O usuário deverá manter cópias externas dos dados considerados importantes.",
    ],
  },
  {
    number: 13,
    title: "Uso permitido",
    paragraphs: [
      "O usuário poderá utilizar sua instância para jogos e outras atividades lícitas compatíveis com os recursos disponibilizados.",
      "É proibida a utilização da infraestrutura para mineração de criptomoedas; ataques DDoS ou DoS; distribuição ou operação de malware; phishing; fraude; spam; invasão ou tentativa de acesso não autorizado a sistemas; roubo ou coleta indevida de credenciais; exploração abusiva de vulnerabilidades; distribuição de conteúdo ilícito; ou qualquer atividade destinada a causar prejuízo à Ignix, à infraestrutura, a outros usuários ou a terceiros.",
      "Também é proibida a revenda, sublicenciamento, compartilhamento comercial ou disponibilização pública da instância sem autorização expressa da Ignix.",
      "A utilização que represente risco técnico, jurídico, financeiro ou de segurança poderá resultar na suspensão preventiva da instância enquanto a situação é analisada.",
    ],
  },
  {
    number: 14,
    title: "Consumo de recursos",
    paragraphs: [
      "Salvo quando expressamente indicado na oferta, os planos permitem utilização da máquina durante todo o período contratado e não possuem limite artificial de horas de jogo dentro desse período.",
      "Isso não autoriza a utilização deliberadamente abusiva dos recursos para finalidades incompatíveis com o serviço contratado ou atividades capazes de comprometer a estabilidade da infraestrutura.",
      "A Ignix poderá aplicar medidas técnicas quando uma utilização representar risco concreto à segurança, disponibilidade ou integridade da infraestrutura.",
    ],
  },
  {
    number: 15,
    title: "Suspensão e encerramento",
    paragraphs: [
      "A Ignix poderá suspender temporariamente ou encerrar uma instância quando existirem evidências razoáveis de violação destes Termos, fraude, atividade ilícita, comprometimento de segurança ou risco relevante à infraestrutura ou a terceiros.",
      "Sempre que razoavelmente possível e quando isso não criar risco adicional à segurança, o usuário será informado sobre o motivo da medida.",
      "Quando a suspensão ou encerramento decorrer de violação comprovadamente causada pelo usuário, o período restante poderá ser perdido, sem prejuízo dos direitos que não possam ser excluídos pela legislação aplicável.",
      "A desalocação automática de uma instância Spot pela Microsoft Azure não será considerada suspensão disciplinar causada pelo usuário.",
    ],
  },
  {
    number: 16,
    title: "Cancelamentos e reembolsos",
    paragraphs: [
      "Os direitos obrigatórios previstos na legislação brasileira permanecem integralmente preservados, inclusive aqueles aplicáveis às contratações realizadas pela internet e o direito de arrependimento quando legalmente aplicável.",
      "Solicitações de cancelamento serão analisadas considerando a legislação aplicável e o estado de execução do serviço.",
      "Problemas técnicos comprovadamente atribuíveis à infraestrutura da Ignix poderão resultar, conforme a situação, em extensão proporcional do período contratado, substituição da instância ou restituição correspondente.",
      "Interrupções Spot serão avaliadas de acordo com sua duração, impacto e possibilidade de restabelecimento do serviço.",
      "Em caso de quedas, interrupções ou desalocações da modalidade Spot, e também nas reservas, a compra é final. Não há reembolso nessas situações. Elas são atendidas pelo restabelecimento ou pela substituição da instância, ou por extensão proporcional do período contratado.",
      "Problemas provocados exclusivamente pela conexão ou equipamento do usuário, configurações realizadas pelo próprio usuário, indisponibilidade dos servidores de um jogo ou incompatibilidade de software ou serviço de terceiros não caracterizam, isoladamente, falha da infraestrutura fornecida pela Ignix.",
      "Nada nesta cláusula deverá ser interpretado como renúncia ou limitação de direitos legalmente assegurados ao consumidor.",
    ],
  },
  {
    number: 17,
    title: "Pagamentos e prevenção a fraudes",
    paragraphs: [
      "O usuário deverá fornecer informações verdadeiras e utilizar somente meios de pagamento para os quais possua autorização.",
      "A Ignix poderá realizar verificações razoáveis destinadas à confirmação de pagamentos e prevenção a fraudes.",
      "Pagamentos identificados como potencialmente fraudulentos, pagamentos contestados irregularmente ou operações provenientes de atividade ilícita poderão resultar na suspensão do pedido, conta ou instância enquanto a situação for analisada.",
      "Chargebacks ou contestações de pagamento não eliminam obrigações ou responsabilidades decorrentes de fraude comprovada ou utilização indevida do serviço.",
    ],
  },
  {
    number: 18,
    title: "Responsabilidade do usuário",
    paragraphs: [
      "O usuário é responsável pelas atividades realizadas dentro de sua instância e deverá manter protegidas suas credenciais de acesso.",
      "Senhas, tokens e demais informações confidenciais não deverão ser compartilhados com terceiros não autorizados.",
      "Caso o usuário suspeite que outra pessoa obteve acesso indevido à sua conta ou máquina, deverá comunicar a Ignix assim que possível e, quando aplicável, alterar suas credenciais.",
      "A Ignix não se responsabiliza por perda de dados ou ações realizadas por terceiros que tenham obtido acesso em razão do compartilhamento voluntário ou exposição das credenciais pelo próprio usuário, sem prejuízo das responsabilidades legalmente atribuíveis à Ignix.",
    ],
  },
  {
    number: 19,
    title: "Limitação de responsabilidade",
    paragraphs: [
      "A Ignix empregará esforços razoáveis para disponibilizar e manter a infraestrutura funcional durante o período contratado.",
      "Por utilizar infraestrutura Azure Spot, a Ignix não garante disponibilidade ininterrupta da mesma máquina física ou virtual durante todo o período contratado.",
      "A Ignix não poderá ser responsabilizada por falhas diretamente provocadas pela conexão do usuário, equipamentos do usuário, servidores de jogos, serviços de terceiros ou eventos fora de seu controle razoável, sem prejuízo das responsabilidades obrigatórias previstas em lei.",
      "A Ignix também não garante que determinado jogo, programa, serviço, modificação ou sistema anti-cheat continuará funcionando indefinidamente na infraestrutura oferecida.",
      "Nenhuma disposição destes Termos deverá ser interpretada como exclusão ou limitação de responsabilidade quando tal exclusão ou limitação for proibida pela legislação aplicável.",
    ],
  },
  {
    number: 20,
    title: "Privacidade e tratamento de dados",
    paragraphs: [
      "Para possibilitar a contratação, identificação do usuário, pagamentos, atendimento, segurança, prevenção a fraudes e operação do serviço, a Ignix poderá tratar dados pessoais necessários a essas finalidades.",
      "Esses dados poderão incluir o ID da conta do Discord utilizada na contratação, atendimento ou vinculação ao serviço, além das informações presentes nos comprovantes ou registros de pagamento necessárias à identificação e confirmação da transação.",
      "No caso de pagamentos via Pix, poderão ser tratados dados como valor, data, identificador da transação e informações do pagador disponibilizadas pelo respectivo sistema ou comprovante de pagamento.",
      "Essas informações serão utilizadas para prestação do serviço, suporte, confirmação de pagamentos, segurança, prevenção a fraudes e cumprimento de obrigações legais ou regulatórias.",
      "A operação da Ignix depende também de fornecedores de infraestrutura e tecnologia, principalmente a Microsoft Azure.",
      "Durante a utilização desses serviços, informações técnicas relacionadas ao acesso, dispositivo, conexão, endereço IP, rede, telemetria ou desempenho poderão ser processadas diretamente pelos respectivos fornecedores conforme suas próprias políticas de privacidade e termos de serviço.",
      "O tratamento realizado de forma independente por esses fornecedores estará sujeito às respectivas políticas e condições.",
      "A Ignix não comercializa dados pessoais de seus usuários.",
      "Os dados mantidos diretamente pela Ignix serão conservados somente pelo período necessário para as finalidades relacionadas à prestação do serviço, segurança, prevenção a fraudes ou cumprimento de obrigações legais e regulatórias.",
    ],
  },
  {
    number: 21,
    title: "Alterações no serviço",
    paragraphs: [
      "A Ignix poderá modificar a infraestrutura, tecnologias utilizadas, métodos de acesso, planos disponíveis e características operacionais do serviço ao longo do tempo.",
      "Isso poderá incluir alterações de região, tipo de instância, modelo de hardware, tecnologia de virtualização ou modalidade de capacidade utilizada.",
      "Alterações que ocorram após uma contratação não reduzirão deliberadamente os recursos essenciais já garantidos ao usuário durante o período contratado, salvo quando necessárias por razões técnicas, de segurança, legais ou decorrentes de circunstâncias fora do controle razoável da Ignix.",
      "Quando uma alteração exigir substituição da instância durante um período ativo, a Ignix buscará preservar o tempo restante contratado.",
    ],
  },
  {
    number: 22,
    title: "Alterações nestes Termos",
    paragraphs: [
      "A Ignix poderá atualizar estes Termos para refletir mudanças no serviço, infraestrutura, práticas operacionais ou legislação aplicável.",
      "Alterações relevantes não modificarão retroativamente as condições econômicas de uma contratação já realizada, salvo quando necessário para cumprimento de obrigação legal.",
      "A versão vigente destes Termos ficará disponível aos usuários com indicação de sua data de atualização.",
    ],
  },
  {
    number: 23,
    title: "Atendimento",
    paragraphs: [
      "Dúvidas, problemas técnicos, solicitações relacionadas ao serviço, cancelamentos ou outras questões poderão ser encaminhadas pelos canais oficiais da Ignix.",
      "Suporte: {suporte}",
      "Responsável pelo serviço: Ignix Cloud PC.",
    ],
  },
  {
    number: 24,
    title: "Legislação aplicável",
    paragraphs: [
      "Estes Termos são regidos pela legislação da República Federativa do Brasil.",
      "Permanecem preservados os direitos do consumidor e as regras legais de competência aplicáveis.",
      "Nenhuma disposição destes Termos deverá ser utilizada para restringir foro, direito ou garantia que a legislação atribua obrigatoriamente ao usuário.",
    ],
  },
]);

export function supportLabel(url) {
  const value = String(url ?? "").trim();
  if (/^https?:\/\//.test(value)) return value;
  return "link ainda não configurado neste servidor";
}
