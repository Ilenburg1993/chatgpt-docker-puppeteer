# Subsistemas do Runtime

**Propósito**: inventariar os subsistemas atuais do runtime com foco em responsabilidade real de cada diretório.  
**Status documental**: Canônico de apoio.  
**Escopo**: detalhar a topologia operacional sem substituir o baseline de `ARCHITECTURE.md`.  
**Quando consultar**: ao decidir onde uma mudança deve viver ou ao explicar a função de uma pasta do runtime.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](./ARCHITECTURE.md).  
**Última atualização**: 28 de fevereiro de 2026.

## Visão geral

O runtime atual não é apenas “kernel + driver”. Ele está organizado em planos complementares:

- governança e bootstrap;
- barramento de eventos;
- decisão e estratégia;
- workers operacionais;
- execução browser;
- infraestrutura e persistência;
- domínio de missão;
- superfícies externas e serviços auxiliares.

Os deep-dives por subsistema agora ficam concentrados em [SUBSISTEMAS/README.md](./SUBSISTEMAS/README.md).

## Núcleo estrutural

### `src/main.js`

- Entry point soberano do processo principal.
- Orquestra boot, guards, modos de operação e shutdown.
- Conecta kernel, NERV, infra, workers e superfícies externas.

### `src/core/`

- Configuração, ambiente, guards, identidade, logging, retry, schemas e validadores base.
- Define o contrato mínimo necessário para todo o resto do runtime.

### `src/nerv/`

- Barramento principal de envelopes, eventos e comandos.
- Faz emissão, recepção, transporte, correlação, discovery e health.
- É a infraestrutura lógica de desacoplamento entre domínios.

## Decisão e estratégia

### `src/kernel/`

- Pump principal do runtime.
- Drena buffers do NERV.
- Executa políticas, observação, runtime de tarefas e telemetria do kernel.

Subáreas relevantes:

- `execution_engine/`
- `kernel_loop/`
- `policy_engine/`
- `task_runtime/`
- `nerv_bridge/`
- `observation_store/`
- `telemetry/`

### `src/orchestrator/`

- Gerencia contexto, checkpoints, iteração e validação.
- Decide progressão de steps e estratégias de execução.
- Complementa o kernel, mas não substitui o motor de execução.

## Plano operacional de workers

### `src/agent/`

- É a camada de workers periódicos e contínuos do runtime.
- Faz a ponte entre SSOT persistido, controle operacional e execução real.
- É parte central da arquitetura atual.

Componentes principais:

- `agent_loop.js`: scheduler multiperiódico dos loops do runtime.
- `queue_worker.js`: reivindica tarefas prontas e as despacha.
- `task_control_watcher.js`: converte pausa/cancelamento em abort operacional.
- `attempt_watchdog.js`: detecta stuck states e reprograma execução.
- `mission_runner.js`: avança missões em andamento.
- `mission_planner_processor.js`: transforma propostas do planner em novas tarefas.
- `task_orchestration_worker.js`: decide próximos passos após execução iterativa.
- `mission_execution_service.js`: transições consistentes de missão.
- `workflow_next_step_builder.js`: composição do próximo step.
- `task_state_projector.js`: projeção de estado derivado.
- `task_attempt_invariants.js`: higiene de lock e invariantes de tentativa.

### Diferença crítica: `src/agent/` x `src/missions/` x `agents/`

- `src/agent/`: workers internos do runtime.
- `src/missions/`: domínio de missão, workflow, template e estado.
- `agents/` na raiz: componentes auxiliares fora do runtime central.

Essa distinção precisa ser respeitada em design, documentação e leitura por LLMs.

## Execução browser

### `src/driver/`

- Encapsula a execução no alvo.
- Centraliza factory, drivers, pooling, guards, extractors e adaptadores.
- Usa Chrome externo, sem assumir ownership do ciclo de vida do browser.

Subáreas relevantes:

- `core/`
- `targets/`
- `guards/`
- `extractors/`
- `modules/`
- `nerv_adapter/`
- `trackers/`

## Infraestrutura e persistência

### `src/infra/`

- DB, queue, locks, storage, FS, proxy, IPC, transport e browser pool.
- É a base material dos workers, do kernel e do driver.

Subáreas relevantes:

- `browser_pool/`
- `db/`
- `fs/`
- `ipc/`
- `locks/`
- `proxy/`
- `queue/`
- `storage/`
- `transport/`

### Papel especial de `ConnectionOrchestrator`

- Coordena conexão com o ambiente browser já existente.
- Faz parte da borda entre runtime e Chrome externo.

## Domínio de missão

### `src/missions/`

- Modela missão, templates, geração de workflow, estado e feedback.
- Mantém a visão de negócio de longa duração.
- Alimenta o plano operacional que vive em `src/agent/`.

Arquivos-chave:

- `mission_manager.js`
- `mission_state_manager.js`
- `workflow_generator.js`
- `feedback_processor.js`
- `templates/`

## Superfícies externas

### `src/server/`

- API, dashboard API, realtime, supervisão, watchers e bootstrap do servidor.
- Publica a visão externa do runtime e os canais operacionais para UI.

Subáreas relevantes:

- `api/`
- `dashboard-api/`
- `engine/`
- `handlers/`
- `middleware/`
- `realtime/`
- `supervisor/`
- `watchers/`

### `src/dashboard-ui/`

- Frontend do dashboard.
- Consome o contrato exposto por `src/server/`.
- Não substitui a camada de backend.

## Serviços auxiliares do produto

### `src/integration/`

- Integrações MCP, LSP, tools e registries técnicos.

### `src/inference_gateway/`

- Serviço HTTP auxiliar de inferência e políticas.
- Ativado por flag, com lifecycle separado.

### `src/audit_agent/`

- Serviço auxiliar de auditoria em background.
- Executa triagem, montagem de contexto e patch authoring assistido.

## Camadas transversais

### `src/shared/`

- Utilitários, contratos e helpers compartilhados entre domínios.

### `src/state/`

- Estruturas auxiliares de estado e documentação local desse estado.

### `src/types/`

- Contratos tipados por domínio do runtime.

### `src/logic/`

- Regras semânticas e lógica de suporte.

### `src/validation/`

- Validações especializadas, incluindo avaliação/juiz LLM.

## Diretórios fora de `src/` que influenciam arquitetura

### `tests/`

- Expressa o comportamento esperado do sistema.
- Está organizado por categoria (`unit`, `integration`, `e2e`, `regression`, `nightly`, `legacy`,
  etc.).

### `scripts/`

- Automação operacional, CI, setup, health, auditoria e manutenção.

### `DOCUMENTAÇÃO/`

- Fonte canônica do contrato narrativo da arquitetura.

### `.github/`

- Camada permanente de instruções para LLMs, skills e workflows.
- Precisa refletir a mesma taxonomia deste documento.

## Regras de manutenção

- Se um diretório novo entrar na topologia estável, ele deve aparecer aqui e em `ARCHITECTURE.md`.
- Se um diretório sair do centro do runtime, ele deve ser reclassificado.
- Se `src/agent/` ganhar novos workers estruturais, eles devem ser descritos explicitamente.
