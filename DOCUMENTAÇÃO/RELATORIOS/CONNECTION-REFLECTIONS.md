CAPÍTULO I — PRINCÍPIO DE SOBERANIA DE PROCESSOS

(Process Sovereignty & Lifecycle Authority)

1. Objeto do Contrato

Este capítulo estabelece o Princípio de Soberania de Processos como fundamento estrutural do
sistema.

Seu objetivo é definir, de forma normativa e não ambígua, quem possui autoridade sobre o ciclo de
vida de cada processo, eliminando:

shutdowns implícitos

dependências temporais frágeis

efeitos colaterais entre processos

acoplamentos invisíveis de runtime

Este contrato é obrigatório para todos os processos do sistema (Maestro, Server, Worker, Drivers,
etc.).

2. Definição Fundamental

Um processo soberano é a única entidade autorizada a decidir sobre o seu próprio ciclo de vida.

Ciclo de vida inclui, de forma indivisível:

inicialização (boot)

escuta de sinais (SIGINT, SIGTERM, etc.)

decisão de shutdown

chamada de process.exit

liberação final de recursos

Nenhum processo pode, direta ou indiretamente, controlar o ciclo de vida de outro processo.

3. Classificação Canônica de Autoridade

Todo processo DEVE operar sob exatamente um dos seguintes regimes de autoridade:

3.1 standalone — Processo Soberano

Um processo em modo standalone:

É autoridade final sobre:

seus sinais

seu shutdown

seu process.exit

Registra handlers de sinais (SIGINT, SIGTERM, etc.)

Decide quando abortar ou continuar

Publica eventos de disponibilidade (ex: SERVER_READY)

Não assume supervisor externo

Exemplos típicos:

Server rodando isoladamente

Maestro executado como entrypoint único

Serviços em produção com PID próprio

3.2 delegated — Processo Delegado

Um processo em modo delegated:

NÃO registra handlers de sinais globais

NÃO chama process.exit por conta própria

NÃO assume controle sobre shutdown

Depende explicitamente de um processo soberano

Propaga falhas por exceção (throw), nunca por exit

Opera como subcomponente vivo de outro processo

Exemplos típicos:

Server iniciado dentro do Maestro

Subprocessos embutidos para testes

Execução controlada por harness externo

4. Regra de Resolução de Autoridade

A autoridade DEVE ser resolvida de forma:

explícita

determinística

validada contra enum fechado

logada no boot

Fonte canônica de verdade (ordem de precedência):

Parâmetro explícito de bootstrap

Variável de ambiente (SERVER_AUTHORITY)

Fallback determinístico (standalone)

Qualquer valor fora do conjunto permitido DEVE causar falha imediata de boot.

5. Invariantes Obrigatórios

As seguintes regras são invioláveis:

5.1 Exclusividade de Shutdown

Apenas o processo soberano pode:

registrar signal handlers

executar shutdown coordenado

chamar process.exit

Processos delegados nunca encerram o runtime global.

5.2 Proibição de Shutdown Implícito

É estritamente proibido:

encerrar o processo como efeito colateral de erro interno

chamar process.exit dentro de:

adapters

managers

pools

watchers

assumir que “falhar = sair”

Falhas DEVEM ser propagadas por exceção quando o processo não for soberano.

5.3 Isolamento de Sinais

Handlers de sinais só existem no processo soberano

Processos delegados:

não escutam sinais

não interferem em shutdown

não interceptam interrupções do SO

6. Implicações Arquiteturais

A adoção deste princípio implica, conscientemente:

6.1 Mais Disciplina, Menos Magia

Não há mais “processos que se desligam sozinhos”

Erros não “resolvem” problemas encerrando o sistema

Toda decisão de vida/morte é explícita

6.2 Eliminação de Acoplamento Temporal

Nenhum processo assume que outro:

já iniciou

ainda está vivo

será iniciado antes

Coordenação ocorre exclusivamente por contrato, não por timing

6.3 Base para Execução Parcial

Este princípio permite, de forma segura:

Server rodar sozinho

Maestro subir depois

Componentes entrarem e saírem dinamicamente

Ambientes de teste e debug sem hacks

7. Erros Arquiteturais vs Erros Operacionais

Este contrato distingue claramente:

Erro Arquitetural

Violação de autoridade

Processo delegado chamando process.exit

Registro indevido de signal handlers

→ Falha imediata, explícita e não recuperável

Erro Operacional

Porta ocupada

Dependência externa indisponível

Falha de conexão

→ Propagado ao soberano para decisão

8. Estado Canônico Esperado

Ao final do boot, todo processo DEVE ser capaz de afirmar:

qual é sua autoridade (standalone | delegated)

quem é o soberano (se delegado)

se pode ou não encerrar o runtime

quais recursos controla

Ambiguidade neste ponto é falha de contrato.

9. Cláusula de Encerramento

Este princípio é fundacional.

Todos os capítulos seguintes assumem que:

Nenhuma coordenação, comunicação ou boot sequence pode violar a soberania de processos aqui
definida.

---

CAPÍTULO II — CONTRATO DE COMUNICAÇÃO ÚNICA (NERV)

(Single Communication Substrate & IPC Elimination)

1. Objeto do Contrato

Este capítulo estabelece o Contrato de Comunicação Única, definindo o NERV como:

o único substrato legítimo de comunicação entre processos, subsistemas e camadas do sistema.

Seu objetivo é eliminar completamente IPC ad-hoc, comunicação implícita e acoplamentos laterais,
garantindo:

rastreabilidade total

determinismo de eventos

desacoplamento estrutural

observabilidade canônica

substituibilidade de topologia

Este contrato é obrigatório e global.

2. Definição Fundamental

Nenhum subsistema pode comunicar-se com outro fora do NERV.

Isso inclui — sem exceções implícitas:

IPC via filesystem

arquivos de discovery

pipes

sockets ad-hoc

chamadas diretas entre processos

variáveis globais compartilhadas

side-channels de runtime

Toda comunicação DEVE ocorrer como mensagem explícita no NERV.

3. Natureza do NERV

O NERV é definido como:

substrato lógico, não físico

contrato de mensagens, não implementação específica

canal soberano, independente de transporte

Ele pode operar sobre:

EventEmitter local

Socket.io

WebSocket

TCP

futuros transports

Sem que nenhuma camada acima dependa dessa escolha.

4. Tipos Canônicos de Mensagem

Toda comunicação NERV DEVE ser expressa em um dos tipos abaixo:

4.1 Event (EVENT)

Emissão unilateral

Não espera resposta

Representa fatos ocorridos

Imutável após publicação

Exemplos:

SERVER_READY

BROWSER_POOL_DEGRADED

MISSION_STARTED

4.2 Command (COMMAND)

Intenção explícita

Direcionada a um ator lógico

Pode falhar

Pode gerar eventos

Exemplos:

EXECUTE_TASK

START_MISSION

SHUTDOWN_REQUEST

4.3 Ack (ACK)

Confirmação explícita

Sempre associada a um COMMAND

Nunca implícita

Pode conter erro ou sucesso

5. Envelope Canônico

Toda mensagem DEVE ser encapsulada em um Envelope NERV, contendo no mínimo:

actor — quem emite

messageType — EVENT | COMMAND | ACK

actionCode — semântica explícita

correlationId — rastreabilidade causal

timestamp — ordenação lógica

payload — conteúdo semântico

Mensagens fora deste formato são inválidas por contrato.

6. Proibição Formal de IPC Tradicional

É estritamente proibido usar IPC para:

discovery de processos

handshake de readiness

coordenação de boot

troca de estado vivo

sinalização de shutdown

Exceção única (transitória)

IPC pode existir apenas como fallback de compatibilidade, quando:

documentado explicitamente

isolado

marcado como deprecated

com caminho de remoção definido

Exemplo típico: arquivo de estado legado enquanto migração está em curso.

7. Descoberta e Readiness 7.1 Regra Canônica

Readiness é um evento, não um arquivo.

Todo subsistema, ao tornar-se operacional, DEVE:

publicar um EVENT de readiness no NERV

conter metadata suficiente para consumo tardio

não assumir ouvintes imediatos

Exemplo canônico:

SERVER_READY

KERNEL_READY

CONTEXT_MANAGER_READY

7.2 Anti-padrão Proibido

É proibido:

“esperar arquivo aparecer”

“polling de diretório”

“verificar PID”

“ler porta gravada em disco”

Esses mecanismos não são comunicação, são acoplamento temporal.

8. Comunicação Entre Processos Soberanos

Quando dois processos soberanos coexistem:

Nenhum assume ordem de boot do outro

Nenhum bloqueia esperando resposta síncrona

Comunicação é assíncrona por EVENT

Coordenação ocorre por policy, não por timing

9. Sincronia vs Assincronia Regra Canônica

NERV é semanticamente assíncrono, mesmo quando o transporte for síncrono.

Isso implica:

nunca depender de retorno imediato

nunca travar boot esperando ACK

tratar ausência como estado possível

usar timeouts explícitos quando necessário

10. Observabilidade e Auditoria

Toda mensagem NERV é:

auditável

rastreável

logável

replayável (conceitualmente)

Isso permite:

forensics pós-falha

reconstrução de boot

análise de causalidade

debugging distribuído

11. Benefícios Estruturais Diretos

A adoção plena deste contrato produz:

eliminação de deadlocks de boot

remoção de dependências invisíveis

capacidade de hot-attach/detach

execução parcial do sistema

testes determinísticos

menor custo cognitivo global

12. Erros Arquiteturais vs Erros Operacionais Erro Arquitetural

Comunicação fora do NERV

Mensagem sem envelope

Uso de IPC para coordenação viva

→ Falha imediata de contrato

Erro Operacional

Transporte indisponível

Mensagem não entregue

Latência excessiva

→ Tratado por retry, backoff ou degradação

13. Estado Canônico Esperado

Ao final deste capítulo, todo subsistema DEVE:

conhecer apenas o NERV como meio de comunicação

não depender de IPC para operar

não assumir topologia física

não conhecer PIDs, arquivos ou portas alheias

14. Cláusula de Continuidade

Os capítulos seguintes assumem como verdadeiro que:

Toda coordenação entre processos ocorre via NERV, e apenas via NERV.

Sem esta premissa, nenhuma das garantias posteriores se sustenta.

CAPÍTULO III — CONTRATO DE BOOT DETERMINÍSTICO E DEGRADAÇÃO CONTROLADA

(Deterministic Bootstrap & Controlled Degradation)

1. Objeto do Contrato

Este capítulo define as regras soberanas de inicialização (boot) do sistema e de seus subsistemas,
estabelecendo:

determinismo estrutural

independência temporal entre processos

tolerância explícita à ausência de dependências

degradação controlada como estado legítimo

eliminação de deadlocks de boot

O objetivo é garantir que o sistema possa iniciar, operar parcialmente e evoluir de estado sem
colapsar, independentemente da ordem de subida dos processos.

2. Princípio Fundamental

Boot não é sincronização. Boot é declaração de estado.

Nenhum subsistema pode assumir:

que outro já está ativo

que outro irá subir

que outro responderá imediatamente

que a topologia é fixa

Toda suposição desse tipo é ilegal por contrato.

3. Estados Canônicos de Boot

Todo subsistema DEVE reconhecer explicitamente os seguintes estados:

3.1 NOT_STARTED

Processo ainda não inicializado

Nenhuma suposição permitida

3.2 BOOTING

Inicialização em curso

Recursos sendo alocados

Nenhuma dependência externa pode ser exigida

3.3 READY

Subsistema operacional

Capaz de receber mensagens NERV

Publica evento de readiness

Exemplo:

EVENT: KERNEL_READY EVENT: SERVER_READY EVENT: BROWSER_POOL_READY

3.4 DEGRADED

Subsistema ativo

Funcionalidade parcial

Dependências ausentes ou indisponíveis

Estado válido e suportado

3.5 FAILED

Boot abortado

Erro irrecuperável

Processo termina

4. Ordem de Boot: Regra Negativa

Nenhum subsistema pode depender da ordem de boot de outro.

Isto implica:

o SERVER pode subir antes do MAESTRO

o MAESTRO pode subir sem SERVER

o KERNEL pode subir sem BROWSER

o BROWSER pode tornar-se disponível depois

A coordenação ocorre após o boot, via NERV.

5. Publicação de Readiness

Todo subsistema, ao atingir READY, DEVE:

emitir um EVENT no NERV

conter metadata suficiente para consumo tardio

não assumir ouvintes ativos no momento da emissão

Exemplo mínimo de payload: { "role": "server", "status": "ready", "capabilities": ["http",
"socket"], "authority": true }

6. Consumo de Readiness

Todo subsistema PODE:

ouvir eventos de readiness

reagir de forma assíncrona

atualizar seu estado interno

Mas NUNCA pode:

bloquear boot esperando readiness

travar thread aguardando evento

assumir que readiness ocorrerá

7. Degradação Controlada 7.1 Definição

Degradação é um estado operacional explícito, não um erro.

Um subsistema está em DEGRADED quando:

depende de outro subsistema ausente

mas pode operar parcialmente

sem violar invariantes internas

7.2 Exemplos Canônicos

MAESTRO sem Browser Pool

DRIVER sem Chrome

SERVER sem clientes conectados

KERNEL sem missões ativas

Todos são estados válidos.

8. Proibição de Falha em Cascata

É proibido que:

a falha de um subsistema

provoque o shutdown automático de outro

exceto quando explicitamente configurado por policy

Falha ≠ Colapso sistêmico.

9. Retry, Timeout e Backoff

Quando um subsistema tenta usar outro que está ausente:

retries DEVEM ser explícitos

timeouts DEVEM ser finitos

backoff DEVE ser determinístico

É proibido:

retry infinito silencioso

loop de busy-wait

polling agressivo

10. Hot-Attach e Late Binding

O sistema DEVE suportar:

entrada tardia de subsistemas

reconexão após falha

substituição de instâncias

Sem reiniciar o processo local.

Exemplo:

Chrome sobe depois do MAESTRO

SERVER reinicia sem derrubar KERNEL

Browser Pool reaparece dinamicamente

11. Boot e Autoridade Regra Canônica

Autoridade é declarada, nunca inferida.

Um processo pode declarar-se:

autoridade HTTP

autoridade de execução

autoridade de coordenação

Essa autoridade:

é explícita

é publicada via NERV

pode coexistir com outras

12. Anti-Padrões Proibidos

São proibidos por contrato:

“esperar porta abrir”

“esperar arquivo existir”

“sleep fixo no boot”

“retry até funcionar”

“assumir localhost”

Todos estes introduzem dependência temporal implícita.

13. Falha de Boot

Boot DEVE falhar apenas quando:

invariantes internas são violadas

recursos essenciais locais falham

configuração é inválida

Boot NÃO DEVE falhar porque:

outro processo não está ativo

rede externa está indisponível

dependência remota ainda não subiu

14. Observabilidade de Boot

Cada fase de boot DEVE:

ser logada

ser identificável

ser rastreável

Boot é parte do comportamento observável do sistema.

15. Estado Esperado ao Final do Capítulo

Após este contrato:

processos podem subir em qualquer ordem

degradação é suportada e explícita

recovery é possível sem restart global

não há deadlocks de boot

readiness é evento, não condição de bloqueio

16. Cláusula de Continuidade

Os capítulos seguintes assumem como verdade que:

Boot é determinístico, não bloqueante, e tolerante à ausência.

O próximo passo natural é formalizar as fronteiras externas.

CAPÍTULO IV — CONTRATO DE FRONTEIRA EXTERNA E PORTAS CANÔNICAS

(External Boundary & Canonical Port Contract)

1. Objeto do Contrato

Este capítulo define como o sistema se relaciona com o exterior, estabelecendo:

o conceito formal de fronteira

a distinção entre porta lógica e porta física

a classificação canônica de portas por plano

regras de exposição, forwarding e binding

proibições explícitas de acoplamento indevido

O objetivo é garantir que a topologia de rede seja explícita, auditável e não ambígua,
independentemente do ambiente (bare metal, Docker, Dev Container, VS Code, CI).

2. Princípio Fundamental

Portas não são detalhes de implementação. Portas são contratos.

Toda porta aberta ou acessível constitui:

uma superfície de ataque

um compromisso de compatibilidade

uma promessa de estabilidade semântica

Logo, nenhuma porta pode existir sem contrato explícito.

3. Definição de Fronteira 3.1 Fronteira Externa

Define-se como fronteira externa qualquer ponto pelo qual:

dados entram no sistema

dados saem do sistema

controle é exercido

observabilidade é exposta

Exemplos:

HTTP server

WebSocket hub

endpoint de browser remoto

métricas

debug

3.2 Porta Canônica

Uma porta canônica é:

semanticamente estável

documentada

intencional

única para seu propósito

Uma porta não é canônica quando:

é efêmera

é implícita

é herdada de defaults de tooling

existe apenas “porque funcionou”

4. Separação por Planos

O sistema adota arquitetura por planos, cada um com regras próprias.

4.1 Plano de Interface Humana (UI)

Finalidade: interação humana direta Características:

HTTP

navegadores

dashboards

consoles visuais

Portas típicas:

3000 — Dashboard principal 3001 — Playground / DEV 3002 — Operações / observabilidade

Regras:

podem ser forwarded

podem notificar

são explicitamente visíveis

nunca devem ser usadas por automação interna

4.2 Plano de Execução / API

Finalidade: controle funcional do sistema Características:

APIs REST

Socket.io

comandos

eventos externos

Porta canônica:

3008 — API / Execução

Regras:

pode ser usada por clientes externos

é superfície estável

exige versionamento e compatibilidade

4.3 Plano de Observabilidade

Finalidade: introspecção técnica Características:

métricas

healthchecks

status

telemetria

Porta canônica:

9100 — Métricas / Health

Regras:

leitura preferencialmente

sem efeitos colaterais

pode ser forwardada silenciosamente

4.4 Plano de Debug (Opt-in)

Finalidade: diagnóstico local Características:

ferramentas de desenvolvimento

debugging ativo

inspeção de runtime

Portas típicas:

9229 — Node.js inspect 9230 — fallback debug

Regras:

nunca autoexpostas

opt-in explícito

uso temporário

jamais dependidas em produção

4.5 Plano de Controle / Infraestrutura

Finalidade: controle interno e coordenação técnica Características:

não humanas

não públicas

sensíveis

Faixa reservada:

9221–9224

5. O Caso Canônico: Porta 9224 5.1 Definição

A porta 9224 é definida como:

Porta canônica de fronteira de controle para o Chrome externo via proxy DevTools.

Ela não é:

porta do Chrome

porta de UI

porta de debug humano

porta de desenvolvimento genérico

Ela é:

interface lógica estável

boundary port

façade de infraestrutura

ponto de desacoplamento

5.2 Distinção Crítica: 9222 vs 9224 Porta Significado 9222 Porta física padrão do Chrome (volátil,
local, insegura) 9224 Porta lógica de contrato (proxyada, controlada, estável)

Regra absoluta:

O sistema nunca depende de 9222.

6. Porta Lógica vs Porta Física 6.1 Porta Física

depende do processo real

pode mudar

não é garantida

não é contrato

Exemplo:

Chrome.exe --remote-debugging-port=9222

6.2 Porta Lógica

é estável

é documentada

é proxyável

é substituível

Exemplo:

browserEndpoint = http://host:9224

7. Binding: Regra Obrigatória

Toda porta de fronteira DEVE:

escutar em 0.0.0.0

É proibido:

127.0.0.1 localhost

quando o endpoint é consumido por:

containers

processos externos

múltiplos hosts

8. Forwarding e Topologia 8.1 Forwarding ≠ Arquitetura

Port forwarding:

não muda contratos

não muda semântica

não cria dependência

apenas altera caminho físico

Logo:

Forwarding é decisão topológica, não arquitetural.

8.2 Política Recomendada (VS Code / Dev Container)

deny-by-default

allowlist explícita

forwarding silencioso para portas sensíveis

Exemplo canônico para 9224:

"9224": { "label": "Browser Endpoint — Contract Boundary", "onAutoForward": "silent",
"requireLocalPort": true }

9. Proibições Arquiteturais

São explicitamente proibidos:

uso direto de localhost:9222

dependência de default Puppeteer

inferência automática de porta

uso de porta sem documentação

exposição implícita por tooling

10. Segurança por Design

A classificação por planos garante:

redução de superfície de ataque

separação de responsabilidades

clareza de auditoria

previsibilidade operacional

11. Falha de Conectividade

Falha em uma porta:

não derruba o sistema

gera degradação

é observável

é recuperável

Portas são fronteiras, não fundações.

12. Estado Esperado ao Final do Capítulo

Após este contrato:

toda porta tem significado

nenhuma porta é “acidental”

9224 é a única fronteira de browser

9222 é irrelevante para o sistema

forwarding é ferramenta, não suposição

ambientes diferentes não quebram o contrato

CAPÍTULO V — CONTRATO DE DEPENDÊNCIAS EXTERNAS E INTEGRAÇÃO TARDIA

(External Dependencies & Late Binding Contract)

1. Objeto do Contrato

Este capítulo formaliza o modo pelo qual o sistema:

reconhece dependências externas

integra serviços fora de seu domínio

evita acoplamento de ciclo de vida

permite boot parcial ou total

mantém determinismo mesmo em falha

O foco não é como usar dependências externas, mas como não ser governado por elas.

2. Princípio Fundamental

Dependências externas nunca são soberanas.

Ou, de forma operacional:

o sistema não assume

o sistema não cria

o sistema não gerencia

o sistema não encerra

o sistema não repara

qualquer recurso que esteja fora de seu processo.

3. Definição de Dependência Externa

Considera-se dependência externa qualquer recurso que:

possui ciclo de vida próprio

pode falhar independentemente

não está sob controle direto do processo

pode ser substituído sem alterar o núcleo

Exemplos canônicos:

Chrome (DevTools Protocol)

Proxy DevTools

Server externo (modo split)

Serviços de observabilidade

Infraestrutura de rede

Processos humanos (operador)

4. Regra de Ouro: Integração Tardia (Late Binding)

Toda dependência externa deve obedecer a:

criação ≠ integração

Ou seja:

o sistema não depende da criação

o sistema apenas depende da presença no momento da conexão

Consequência direta

O boot do sistema deve ser possível em três estados:

Dependência disponível

Dependência indisponível

Dependência aparece após o boot

5. Chrome como Dependência Externa Canônica 5.1 Status Arquitetural do Chrome

Chrome é formalmente definido como:

externo

opcional

substituível

não confiável

não determinístico

Logo:

Chrome nunca participa do boot soberano.

5.2 Forma Única de Integração

A única forma válida de integração é:

connect(browserEndpoint)

Proibições explícitas:

launch

executablePath

download

install

spawn

kill

Qualquer tentativa de executar essas ações é erro arquitetural, não bug.

6. Browser Pool como Camada de Mediação

O Browser Pool:

não gerencia browsers

gerencia conexões

gerencia disponibilidade

gerencia degradação

Ele atua como:

buffer ontológico entre o sistema e o mundo externo

6.1 Estados Canônicos do Pool Estado Significado full Conexões ativas disponíveis degraded Pool
indisponível, sistema ativo recovering Tentativa de reconexão unavailable Dependência ausente

Nenhum desses estados pode:

travar o sistema

quebrar invariantes

alterar contratos internos

7. Boot Parcial como Estado Válido 7.1 Definição

Boot parcial é o estado em que:

o núcleo está ativo

o NERV está ativo

o server pode estar ativo

dependências externas estão ausentes

Isso não é falha.

É um estado legítimo de operação.

7.2 Regras do Boot Parcial

tarefas dependentes são bloqueadas

sistema permanece responsivo

logs indicam degradação

reconexão pode ocorrer a qualquer momento

8. Server como Dependência Opcional 8.1 Modos Canônicos

O server pode operar em:

standalone — server sozinho

delegated — server sob Maestro

split — server externo

disabled — sem camada server

Nenhum desses modos altera:

contratos do Kernel

semântica do NERV

fluxo de missões

8.2 Descoberta: Evento > IPC

A descoberta canônica ocorre via:

NERV.EVENT.SERVER_READY

IPC por arquivo:

é permitido

é legado

é auxiliar

nunca é fonte primária

9. Retry, Timeout e Backoff

Toda integração externa deve declarar:

timeout explícito

número máximo de tentativas

política de backoff

condição de abandono

Exemplo normativo:

retry: exponencial maxRetries: N timeout: T ms onFailure: degrade

Nunca:

retry infinito

sleep silencioso

fallback implícito

10. Falha Externa ≠ Falha Sistêmica

Cláusula central:

Falha externa é ruído, não colapso.

Portanto:

logs são WARN, não FATAL

estado é degradado, não abortado

operador é informado

sistema permanece governável

11. Responsabilidade do Operador

Cabe ao operador:

subir Chrome

garantir proxy

verificar rede

validar endpoints

Cabe ao sistema:

informar claramente

nunca mascarar falha

nunca “consertar” o mundo

12. Estado Esperado ao Final do Capítulo

Após este contrato:

dependências não governam o sistema

boot é sempre possível

Chrome pode subir antes ou depois

server pode existir sozinho

Maestro não é refém do mundo externo

falhas são estados, não exceções

13. Encerramento do Documento

Com este capítulo, o contrato se completa:

Boot soberano

Comunicação canônica (NERV)

Topologia flexível

Fronteiras explícitas

Dependências não soberanas

O sistema deixa de ser:

“um processo que espera o mundo estar certo”

e passa a ser:

um núcleo que permanece íntegro mesmo quando o mundo está errado.

ADENDO CONTRATUAL — BINDING, ESCUTA E FRONTEIRAS DE REDE

(Binding & Network Boundary Contract)

Este adendo é parte integrante do Contrato Arquitetural v1.0 e tem precedência sobre convenções
implícitas, defaults de frameworks e heurísticas de ambiente.

1. O problema que o binding resolve

Em sistemas distribuídos, não é a porta que define acessibilidade, mas:

(interface de escuta) + (topologia de rede)

Ou seja:

localhost:9224 pode ser inacessível

0.0.0.0:9224 pode ser necessário

port-forwarding pode ou não existir

o contrato pode ser correto e o sistema ainda assim falhar

Logo, binding é um contrato de fronteira, não um detalhe técnico.

2. Definição formal de Binding

Binding é definido como:

O conjunto de regras que determinam em quais interfaces de rede um serviço escuta e, portanto, quem
pode alcançá-lo.

No contexto deste sistema, binding não é opcional nem implícito.

3. Regra Fundamental de Binding (Normativa)

Todo endpoint que representa uma fronteira arquitetural DEVE escutar em 0.0.0.0.

Isso inclui, obrigatoriamente:

Chrome Proxy Service (porta 9224)

Server HTTP quando rodando em container

Qualquer gateway de integração externa

Proibição explícita

É proibido, para fronteiras canônicas:

bindar apenas em 127.0.0.1

depender de localhost

assumir DNS mágico

confiar em auto-forward implícito

4. Justificativa técnica (não filosófica) 4.1 Containers

Em ambiente containerizado:

127.0.0.1 = namespace do container

Logo:

host não enxerga

VS Code não forwarda

Chrome externo não conecta

Puppeteer falha silenciosamente

4.2 VS Code Dev Containers

VS Code só consegue forwardar portas que:

estão efetivamente bound

estão escutando em interface visível

não estão restritas ao loopback interno

4.3 Proxies e NAT

Para que um proxy funcione como fachada estável:

ele precisa ser alcançável por múltiplas origens

binding local quebra essa propriedade

5. Binding no Contrato de Browser 5.1 Regra Canônica browserEndpoint.url → deve apontar para um
   serviço que escuta em 0.0.0.0

Não importa se o Chrome “real” escuta em 127.0.0.1.

O proxy é quem deve cumprir o contrato.

5.2 Responsabilidade clara Componente Responsabilidade Chrome real Pode escutar em localhost Proxy
DevTools DEVE escutar em 0.0.0.0 Sistema Assume endpoint válido DevContainer Decide forwarding VS
Code Meio de transporte 6. Binding ≠ Forwarding

É crucial separar:

Binding

“Onde o serviço escuta”

Forwarding

“Como o tráfego chega até lá”

O contrato governa binding. O operador decide forwarding.

Misturar os dois leva a erros arquiteturais.

7. Cláusula de Verificação Obrigatória

Todo serviço de fronteira DEVE ser validável com:

ss -lntp | grep 9224

# ou

netstat -an | grep 9224

Resultado esperado:

0.0.0.0:9224

Qualquer outro resultado é violação contratual.

8. Implicações diretas no Dev Container 8.1 O que NÃO é responsabilidade do contrato

abrir browser

notificar usuário

expor UI

decidir ergonomia

8.2 O que É responsabilidade do contrato

garantir que, se alguém tentar conectar, é tecnicamente possível

9. Estado correto esperado

Com o contrato aplicado:

Chrome pode estar no host, VM ou remoto

Proxy escuta em 0.0.0.0:9224

Container conecta sem hacks

VS Code forwarding é opcional

Boot não depende de topologia específica

10. Erros comuns (formalmente proibidos)

“Funciona na minha máquina”

“VS Code cuida disso”

“localhost deve funcionar”

“é só mudar a porta”

“Docker vai resolver”

Todos são anti-contratos.

11. Síntese final

A frase correta para este sistema é:

Portas são contratos lógicos. Binding é soberania técnica. Forwarding é conveniência operacional.

Sem o binding explícito, o sistema é conceitualmente correto e operacionalmente frágil.

Com o binding canônico, ele se torna topologicamente robusto.
