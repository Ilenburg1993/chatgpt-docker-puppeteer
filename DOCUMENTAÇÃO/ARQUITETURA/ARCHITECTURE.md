# Arquitetura Oficial do Sistema

**Propósito**: definir a arquitetura oficial, atual e operacional do `chatgpt-docker-puppeteer`.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## 1. Propósito do sistema

O projeto é uma plataforma Node.js 24+ para executar missões e tarefas com LLMs usando automação de
browser como atuador principal. O runtime foi desenhado para operar continuamente, com coordenação
por eventos, persistência transacional e múltiplos loops de trabalho que mantêm fila, missões,
tentativas, observabilidade e controle de execução.

Na prática, o sistema precisa sustentar simultaneamente:

- boot determinístico e seguro;
- despacho automático de tarefas;
- execução browser via Chrome externo;
- workflows de missão de longa duração;
- API, dashboard e realtime;
- serviços auxiliares de inferência e auditoria;
- invariantes de retry, recovery e rastreabilidade.

## 2. Princípios arquiteturais

- `src/main.js` é o bootstrap soberano do runtime principal.
- O NERV é o barramento primário de eventos e comandos entre subsistemas.
- O processo principal não gerencia o ciclo de vida do browser; ele se conecta a um Chrome externo.
- O sistema é SSOT-first: tarefas, tentativas, missões, eventos e artifacts convergem para estado
  persistido.
- A execução não depende de um único loop; ela é distribuída entre kernel e workers especializados.
- `src/agent/` faz parte do runtime do produto e não deve ser confundido com `agents/` na raiz.
- O baseline de arquitetura deve refletir a árvore real do código, não taxonomias históricas.

## 3. Fronteiras do runtime

### Runtime principal do produto

O runtime principal cobre:

- bootstrap e governança (`src/main.js`, `src/core/`);
- barramento e envelopes (`src/nerv/`);
- motor de decisão (`src/kernel/`, `src/orchestrator/`);
- plano operacional de workers (`src/agent/`);
- execução browser (`src/driver/`);
- infraestrutura persistente e de recursos (`src/infra/`);
- domínio de missão (`src/missions/`);
- API, dashboard e supervisão (`src/server/`, `src/dashboard-ui/`);
- serviços auxiliares do produto (`src/integration/`, `src/inference_gateway/`, `src/audit_agent/`).

### Toolchain, suporte e contexto auxiliar

Fora do runtime principal, mas estruturalmente relevantes:

- `DOCUMENTAÇÃO/`: documentação canônica;
- `.github/`: instruções permanentes para LLMs, workflows, agents e skills;
- `tests/`: harness e validação;
- `scripts/`: automação operacional;
- `assistant/`, `agents/`, `tools/`: áreas auxiliares que não substituem o runtime.

## 4. Boot e ciclo de vida

### Bootstrap canônico

`src/main.js` concentra:

- carregamento de ambiente;
- guards globais e restrições arquiteturais;
- resolução de autoridade e modo do servidor;
- criação do NERV;
- inicialização de `ConnectionOrchestrator`;
- criação do kernel;
- montagem dos workers SSOT de `src/agent/`;
- acoplamento opcional com server, dashboard e serviços auxiliares;
- graceful shutdown.

### Consequência arquitetural

O boot não é apenas “setup”. Ele compõe a topologia viva do runtime e define a ordem contratual em
que os subsistemas entram em operação. Mudanças estruturais relevantes precisam respeitar essa
composição.

## 5. Topologia de alto nível

O runtime pode ser entendido em oito planos:

1. **Plano de bootstrap e governança**
   - `src/main.js`
   - `src/core/`
2. **Plano de eventos**
   - `src/nerv/`
3. **Plano de decisão**
   - `src/kernel/`
   - `src/orchestrator/`
4. **Plano operacional de workers**
   - `src/agent/`
5. **Plano de execução browser**
   - `src/driver/`
6. **Plano de infraestrutura e persistência**
   - `src/infra/`
7. **Plano de domínio e superfícies**
   - `src/missions/`
   - `src/server/`
   - `src/dashboard-ui/`
8. **Plano de serviços auxiliares**
   - `src/integration/`
   - `src/inference_gateway/`
   - `src/audit_agent/`

## 6. Mapa canônico dos subsistemas

### `src/main.js`

Função:

- compor o runtime principal;
- impor guards arquiteturais globais;
- resolver modos de operação;
- iniciar kernel, workers, NERV e integrações.

É o único entrypoint canônico do processo Maestro.

### `src/core/`

Função:

- contratos centrais de configuração e ambiente;
- validação e bootstrap de env;
- guards de entrypoint;
- autoridade, identidade, logging, retry e diagnóstico;
- schemas e validadores compartilhados.

É a camada normativa de base do runtime.

### `src/nerv/`

Função:

- barramento de eventos e comandos;
- buffers de entrada e saída;
- emissão, recepção e transporte;
- discovery, correlação e telemetria de envelopes.

O NERV é o tecido de comunicação da arquitetura. Quando um domínio já está nessa topologia, o
acoplamento preferencial é por eventos, não por chamadas diretas.

### `src/kernel/`

Função:

- pump principal do runtime;
- dreno de buffers NERV;
- políticas e telemetria do kernel;
- coordenação de execução de tarefas;
- bridge entre envelopes e execução concreta.

Peças importantes:

- `kernel.js`: fábrica e lifecycle do kernel;
- `execution_engine/`: motor de execução;
- `kernel_loop/`: loop soberano;
- `policy_engine/`: decisões de política;
- `task_runtime/`: estado e ciclo de vida da tarefa;
- `nerv_bridge/`: integração estrutural com o barramento;
- `observation_store/` e `telemetry/`: observação contínua.

### `src/orchestrator/`

Função:

- decidir como uma tarefa deve avançar;
- gerenciar contexto e checkpoints;
- suportar estratégias `SINGLE_SHOT`, `ITERATIVE` e `MULTI_STEP`;
- validar resultados e controlar progressão de passos.

O orchestrator é a camada de estratégia e qualidade; ele não substitui o kernel e não executa o
browser diretamente.

### `src/agent/`

Função:

- operar o plano de trabalho contínuo do runtime;
- coordenar loops periódicos de fila, missões, controle, watchdog e pós-processamento;
- conectar o estado SSOT do banco à execução real.

Esse diretório é um dos pontos centrais da arquitetura atual e estava subdocumentado. Ele não é um
“agente externo”; é o plano operacional interno do runtime.

Responsabilidades por arquivo:

- `agent_loop.js`: scheduler multiperiódico que coordena kernel e workers com frequências
  independentes.
- `queue_worker.js`: reivindica tarefas elegíveis, compõe contexto e despacha execução para o
  kernel.
- `task_control_watcher.js`: observa tarefas pausadas/canceladas e emite `DRIVER_ABORT` via NERV.
- `attempt_watchdog.js`: detecta tentativas travadas, reprograma ou escala.
- `mission_runner.js`: avança missões em `RUNNING`, cria tarefas para cada step do workflow e fecha
  a missão quando aplicável.
- `mission_planner_processor.js`: consome resultados do planner de missão e cria novas tarefas a
  partir das propostas geradas.
- `task_orchestration_worker.js`: faz o pós-processamento de tarefas `ITERATIVE` e `MULTI_STEP`,
  validando saídas e criando próximos passos quando necessário.
- `mission_execution_service.js`: aplica transições consistentes de missão e registra eventos.
- `workflow_next_step_builder.js`: monta a próxima tarefa derivada de um workflow em andamento.
- `task_state_projector.js`: consolida visão de estado derivada para tarefas.
- `task_attempt_invariants.js`: higiene de lock e invariantes de tentativas.

Diferença crítica:

- `src/agent/` = workers internos do runtime;
- `src/missions/` = domínio de missão, template e estado;
- `agents/` na raiz = artefatos auxiliares fora do runtime principal.

### `src/driver/`

Função:

- encapsular a execução browser;
- abstrair alvos e contratos por target;
- fornecer factory, drivers, guards, extractors e adaptadores NERV.

Peças importantes:

- `factory.js`: auto-discovery, lazy-loading e pooling de drivers;
- `core/TargetDriver.js`: contrato-base dos drivers;
- `targets/`: implementações por alvo;
- `guards/`, `extractors/`, `modules/`, `trackers/`: especializações de execução.

O driver é o atuador do sistema, mas não decide sozinho o fluxo nem gerencia o browser localmente.

### `src/infra/`

Função:

- fornecer a infraestrutura persistente e operacional;
- sustentar browser pool, DB, queue, locks, FS, storage, proxy e transporte;
- hospedar componentes de integração local e utilitários de sistema.

Peças importantes:

- `ConnectionOrchestrator.js`: coordenação de conexões/browser endpoint;
- `browser_pool/`: recursos de pool e guards de browser;
- `db/`: repositórios, SQLite, eventos e SSOT;
- `queue/`, `locks/`, `storage/`: base operacional dos workers;
- `proxy/`, `transport/`, `ipc/`, `fs/`: suporte de comunicação e I/O.

### `src/missions/`

Função:

- modelar o domínio de missões de longa duração;
- gerenciar estado, progresso, workflow e templates;
- fornecer geração de workflow e processamento de feedback.

Peças importantes:

- `mission_manager.js`: ciclo de vida de missão e integração com NERV;
- `mission_state_manager.js`: persistência/estado da missão;
- `workflow_generator.js`: geração de workflows;
- `feedback_processor.js`: aproveitamento de feedback;
- `templates/`: catálogo de templates de missão.

`src/missions/` define o domínio. `src/agent/` executa o trabalho contínuo que mantém esse domínio
progredindo.

### `src/server/`

Função:

- expor API, dashboard API, realtime, supervisão e watchers;
- publicar e consumir eventos de runtime para a interface externa;
- operar o processo de servidor quando em modo integrado ou split.

Peças importantes:

- `main.js`: bootstrap do processo server;
- `engine/`: engine HTTP/socket/lifecycle;
- `api/` e `dashboard-api/`: rotas e superfícies;
- `realtime/`: feed e bridge de eventos;
- `supervisor/`, `watchers/`, `handlers/`, `middleware/`: operação e observabilidade.

### `src/dashboard-ui/`

Função:

- frontend do dashboard operacional;
- interface separada do backend;
- consumidor da API e das superfícies realtime do `src/server/`.

É parte da solução, mas não do runtime Node de backend.

### `src/integration/`

Função:

- integrar MCP, LSP e ferramentas externas;
- registrar tools e encapsular adaptadores de integração técnica.

### `src/inference_gateway/`

Função:

- expor um gateway HTTP separado para inferência complementar;
- aplicar políticas por perfil/cliente;
- centralizar regras de roteamento e persistência de políticas.

É um serviço auxiliar do ecossistema, ativado por flag, e não o motor principal da automação.

### `src/audit_agent/`

Função:

- operar um serviço auxiliar de auditoria em background;
- hidratar jobs, montar contexto, chamar triagem LLM e patch author LLM;
- expor uma API HTTP própria para o agente de auditoria.

Também é um serviço opt-in e separado do runtime central.

### `src/copilot/`

Função:

- integrar o sistema com o GitHub Copilot SDK (LLM-B) de forma programática;
- manter uma sessão de diálogo permanente e reutilizável com a LLM-B;
- expor um hub de conversa persistente para comunicação tri-party (LLM-A ↔ LLM-B ↔ Usuário);
- fornecer terminal permanente com acesso simultâneo por stdin e por HTTP.

Peças importantes:

- `agent.js`: processo standalone do Copilot SDK Agent (entrypoint PM2 `copilot-sdk-agent`);
- `always-alive.js` (`AlwaysAliveAgent`): agente com dialog loop permanente; getters `status`, `dialogLoopActive`; métodos `start()`, `sendDialogTurn()`, `answerPendingQuestion()`;
- `llm-bridge-client.js` (`LlmBridgeClient`): cliente de diálogo com métodos `startDialogMode()`, `dialogTurn()`, `stopDialogMode()`, `chatStructured()`; singleton `llmBridgeClient` exportado;
- `nerv-bridge.js` (`copilotNervBridge`): ponte de eventos Copilot → NERV; `mount(nerv)`, `unmount()`;
- `cli-terminal.js`: REPL CLI leve via readline, usa `llmBridgeClient.dialogTurn()` por mensagem;
- `terminal-server.js`: **Terminal Permanente LLM-B** — REPL com dois atores (stdin e HTTP `:3009/inject`), auto-boot do dialog loop, integração com `ConversationHub` para persistência;
- `conversation-hub/`: ConversationHub — `store.js` (SQLite), `orchestrator.js`, `socket-ns.js` (Socket.io `/copilot`), `hub.js` (singleton `conversationHub`); API REST em `src/server/api/copilot-hub-router.js`.

Restrições:

- Não chamar `puppeteer.launch()` neste módulo.
- `alwaysAliveAgent` e `llmBridgeClient` são singletons — nunca instanciar diretamente em código novo.
- `COPILOT_SDK_ENABLED=true` é requisito para ativar o processo; o código usa lazy import para não quebrar quando desabilitado.
- O terminal permanente (`terminal-server.js`) opera na porta `LLM_B_TERMINAL_PORT` (padrão `3009`); o servidor principal opera em `3008`.

### `src/shared/`

Função:

- concentrar utilitários compartilhados entre domínios;
- abrigar contratos NERV compartilhados, telemetria, IPC e helpers transversais.

### `src/state/`

Função:

- guardar estruturas de estado auxiliares e documentação local de estado.

### `src/types/`

Função:

- taxonomia de tipos e contratos por domínio (`core`, `driver`, `infra`, `kernel`, `missions`,
  `nerv`, `orchestrator`, `server`, `shared`, `validation`).

### `src/logic/` e `src/validation/`

Função:

- regras semânticas e validadores de domínio;
- validações especializadas, incluindo `llm_judge`.

### Relação correta entre `kernel`, `orchestrator`, `agent`, `missions`, `infra` e `driver`

- `kernel` é o motor de execução e pump;
- `orchestrator` define estratégia e validação;
- `agent` mantém os loops operacionais e a progressão contínua do sistema;
- `missions` define o domínio;
- `infra` sustenta persistência, locks, queue e storage;
- `driver` realiza a ação no alvo.

Essa separação é central para entender a arquitetura atual.

## 7. Fluxos principais

### Fluxo de boot

1. `src/main.js` carrega ambiente e aplica guards.
2. O NERV é criado e preparado.
3. `ConnectionOrchestrator` e infraestrutura base são inicializados.
4. O kernel sobe em modo compatível com pump manual.
5. Os workers de `src/agent/` são instanciados.
6. `AgentLoop` passa a coordenar kernel e workers.
7. Server, dashboard e serviços auxiliares podem ser acoplados conforme modo/configuração.

### Fluxo de despacho automático

1. `queue_worker.js` reivindica uma tarefa elegível no SSOT.
2. O contexto da tarefa é composto a partir de inputs e artifacts.
3. A tarefa é despachada ao kernel.
4. O kernel drena buffers NERV, coordena execução e aciona o driver.
5. O driver interage com o alvo via Chrome externo.
6. Resultados, tentativas, eventos e artifacts voltam para DB/storage.

### Fluxo de missão

1. `src/missions/` define a missão, workflow e política.
2. `mission_runner.js` acompanha missões em `RUNNING`.
3. Cada step gera tarefas concretas.
4. `task_orchestration_worker.js` decide continuidade para estratégias iterativas.
5. `mission_execution_service.js` aplica transições consistentes de status e progresso.

### Fluxo de controle e recuperação

1. O usuário pausa ou cancela uma tarefa.
2. `task_control_watcher.js` detecta o estado de controle.
3. O watcher emite `DRIVER_ABORT` via NERV.
4. Locks e eventos são reconciliados.
5. `attempt_watchdog.js` cobre stuck states, timeouts e reschedule quando necessário.

### Fluxo de serviços auxiliares

- `src/inference_gateway/` expõe inferência complementar sob política.
- `src/audit_agent/` roda como processo opt-in com triagem e geração de patch.
- `src/integration/` conecta ferramentas externas, MCP e LSP.

## 8. Mapa estável de diretórios

### Código e runtime

- `src/`: runtime do produto e serviços auxiliares.
- `src/agent/`: plano operacional de workers e loops SSOT.
- `src/missions/`: domínio de missão e workflow.
- `src/dashboard-ui/`: frontend do dashboard.

### Testes

- `tests/unit/`: testes unitários.
- `tests/integration/`: testes de integração.
- `tests/e2e/`: fluxos fim a fim.
- `tests/regression/`: cobertura de regressão.
- `tests/nightly/`: rotinas pesadas/periódicas.
- `tests/manual/`: testes guiados/manualizados.
- `tests/fixtures/`, `tests/helpers/`, `tests/mocks/`, `tests/support/`, `tests/scripts/`,
  `tests/python/`: suporte ao harness.
- `tests/legacy/`: quarentena de testes legados ainda não promovidos.

### Automação e documentação

- `scripts/`: automação por famílias (`audit/`, `ci/`, `ops/`, `setup/`, `health/`, `build/`,
  `analysis/`, `env/`, `codemods/`, `fixes/`, `legacy/`).
- `DOCUMENTAÇÃO/`: documentação canônica.
- `DOCUMENTAÇÃO/ARQUITETURA/`: baseline e aprofundamentos de arquitetura.
- `DOCUMENTAÇÃO/ARQUIVO_MORTO/`: histórico arquivado.
- `.github/`: instruções permanentes para agentes, skills, workflows e configuração de Copilot.

### Áreas auxiliares

- `assistant/`, `agents/`, `tools/`: suporte, inventários e componentes auxiliares fora do núcleo do
  runtime.

## 9. Decisões e restrições obrigatórias

- `src/main.js` continua sendo o bootstrap soberano.
- `src/agent/` faz parte da arquitetura oficial; não tratá-lo como detalhe secundário.
- Não confundir `src/agent/` com `agents/` da raiz.
- Não introduzir `puppeteer.launch()` como novo padrão do runtime.
- Não adicionar gerenciamento local de browser como fonte de verdade.
- A integração browser deve continuar usando o Chrome externo já disponível por DevTools.
- O NERV permanece a fronteira principal de desacoplamento entre domínios já integrados ao
  barramento.
- Mudanças estruturais relevantes devem atualizar este documento, `SUBSYSTEMS.md`,
  `ARCHITECTURE_DIAGRAMS.md` e os documentos permanentes em `.github`.

## 10. Rota para aprofundamento

- Hub de arquitetura: [README.md](./README.md)
- Índice de deep-dives: [SUBSISTEMAS/README.md](./SUBSISTEMAS/README.md)
- Camada operacional de workers: [SUBSISTEMAS/AGENT_RUNTIME.md](./SUBSISTEMAS/AGENT_RUNTIME.md)
- Estratégia e iteração: [SUBSISTEMAS/ORCHESTRATOR.md](./SUBSISTEMAS/ORCHESTRATOR.md)
- Base transversal compartilhada: [SUBSISTEMAS/SHARED.md](./SUBSISTEMAS/SHARED.md)
- Camada de contratos e type checking: [SUBSISTEMAS/TYPES.md](./SUBSISTEMAS/TYPES.md)
- Lógica transversal e heurísticas: [SUBSISTEMAS/LOGIC.md](./SUBSISTEMAS/LOGIC.md)
- Validação semântica especializada: [SUBSISTEMAS/VALIDATION.md](./SUBSISTEMAS/VALIDATION.md)
- Estado runtime em disco: [SUBSISTEMAS/STATE_RUNTIME.md](./SUBSISTEMAS/STATE_RUNTIME.md)
- Integrações técnicas: [SUBSISTEMAS/INTEGRATION.md](./SUBSISTEMAS/INTEGRATION.md)
- Gateway de inferência: [SUBSISTEMAS/INFERENCE_GATEWAY.md](./SUBSISTEMAS/INFERENCE_GATEWAY.md)
- Agente de auditoria: [SUBSISTEMAS/AUDIT_AGENT.md](./SUBSISTEMAS/AUDIT_AGENT.md)
- Domínio de missão: [SUBSISTEMAS/MISSIONS.md](./SUBSISTEMAS/MISSIONS.md)
- Frontend operacional: [SUBSISTEMAS/DASHBOARD_UI.md](./SUBSISTEMAS/DASHBOARD_UI.md)
- Mapa detalhado de subsistemas: [SUBSYSTEMS.md](./SUBSYSTEMS.md)
- Diagramas: [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md)
- Fluxos de dados: [DATA_FLOW.md](./DATA_FLOW.md)
- Boot: [BOOT_PROCESS_DEEP_DIVE.md](./BOOT_PROCESS_DEEP_DIVE.md)
- Driver: [SUBSISTEMAS/DRIVER.md](./SUBSISTEMAS/DRIVER.md)
- Pipeline granular do driver: [SUBSISTEMAS/DRIVER_MODULES.md](./SUBSISTEMAS/DRIVER_MODULES.md)
- Infra: [SUBSISTEMAS/INFRA.md](./SUBSISTEMAS/INFRA.md)
- Pool e saúde do browser: [SUBSISTEMAS/BROWSER_POOL.md](./SUBSISTEMAS/BROWSER_POOL.md)
- SSOT e persistência transacional: [SUBSISTEMAS/INFRA_DB.md](./SUBSISTEMAS/INFRA_DB.md)
- Materialização em disco: [SUBSISTEMAS/STORAGE.md](./SUBSISTEMAS/STORAGE.md)
- Coordenação concorrente: [SUBSISTEMAS/LOCKS.md](./SUBSISTEMAS/LOCKS.md)
- Kernel: [SUBSISTEMAS/KERNEL.md](./SUBSISTEMAS/KERNEL.md)
- Runtime técnico de tasks:
  [SUBSISTEMAS/KERNEL_TASK_RUNTIME.md](./SUBSISTEMAS/KERNEL_TASK_RUNTIME.md)
- NERV: [SUBSISTEMAS/NERV.md](./SUBSISTEMAS/NERV.md)
- Transporte físico do NERV: [SUBSISTEMAS/NERV_TRANSPORT.md](./SUBSISTEMAS/NERV_TRANSPORT.md)
- Server: [SUBSISTEMAS/SERVER.md](./SUBSISTEMAS/SERVER.md)
- Domínio de controle do server: [SUBSISTEMAS/SERVER_DOMAIN.md](./SUBSISTEMAS/SERVER_DOMAIN.md)
- Streaming contínuo do server: [SUBSISTEMAS/SERVER_REALTIME.md](./SUBSISTEMAS/SERVER_REALTIME.md)
- Guardrails HTTP do server: [SUBSISTEMAS/SERVER_MIDDLEWARE.md](./SUBSISTEMAS/SERVER_MIDDLEWARE.md)
- Protocolos expostos do server: [SUBSISTEMAS/SERVER_HANDLERS.md](./SUBSISTEMAS/SERVER_HANDLERS.md)
- Sensores reativos do server: [SUBSISTEMAS/SERVER_WATCHERS.md](./SUBSISTEMAS/SERVER_WATCHERS.md)
- Assistentes e LLM services:
  [SUBSISTEMAS/ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md](./SUBSISTEMAS/ARQUITETURA_ASSISTENTES_E_LLM_SERVICES.md)
- Materiais não-baseline: [ESPECIALIZADOS/README.md](./ESPECIALIZADOS/README.md)
- Histórico arquivado:
  [../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md](../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md)

## 11. Status e manutenção documental

- Este é o único documento-mestre de arquitetura.
- O baseline precisa acompanhar a árvore real de `src/`.
- Quando um diretório ganha função estável, ele precisa ser explicitado aqui.
- Quando um diretório deixa de ser estrutural, ele deve ser rebaixado ou removido do baseline.
