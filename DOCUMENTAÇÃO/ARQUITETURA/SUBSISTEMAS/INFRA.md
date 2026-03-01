**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da infraestrutura persistente e operacional do runtime.  
**Quando consultar**: ao alterar DB, browser pool, storage, locks, queue, proxy, transporte ou conexão com o ambiente browser.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# INFRA

**Propósito**: documentar `src/infra/` como a base material do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/infra/` sustenta os recursos que permitem ao runtime operar:

- persistência SSOT;
- locks e coordenação concorrente;
- browser pool e conexão com Chrome externo;
- storage de artifacts e respostas;
- queue support;
- proxy, transporte e IPC.

Infra não é “um detalhe”. Ela define as bases de consistência, retry e observabilidade sobre as
quais `agent`, `kernel`, `driver` e `server` operam.

## Princípio central

O sistema **não** deve passar a gerenciar um browser local como novo padrão arquitetural.

A camada de infra:

- valida e usa `browserEndpoint`;
- conecta ao ambiente browser externo;
- mantém pool e health;

mas não muda a restrição canônica: o browser continua externo ao processo principal.

## Estrutura interna de `src/infra/`

### `ConnectionOrchestrator.js`

É a borda entre o runtime e o ambiente browser.

Responsabilidades:

- resolver estratégias de conexão;
- detectar ambiente e estado de conectividade;
- conectar ao browser já exposto;
- selecionar e validar páginas;
- manter histórico de estados e incidentes;
- classificar falhas como perda de browser, página inválida, page closed, etc.

Ele é um orquestrador de conexão, não o dono do browser.

### `browser_pool/`

É a camada de alocação, health e proteção de páginas/browser sessions.

Peças principais:

- `pool_manager.js`: pool principal de páginas/instâncias;
- `circuit_breaker.js`: degradação e contenção em caso de falhas;
- `PeriodicHealthMonitor.js`: monitor periódico de saúde;
- `PageValidator.js`: validação estrutural de páginas;
- `PageLifecycleMonitor.js`: rastreio de ciclo de vida;
- `puppeteer_guard.js`: guard arquitetural para impedir `puppeteer.launch()` fora do contrato.

Responsabilidades:

- inicializar o pool contra `browserEndpoint.url`;
- alocar e reciclar páginas;
- detectar degradação e aplicar circuit breaker;
- impedir que o runtime derive para gerenciamento local indevido do browser.

Aprofundamento específico: [BROWSER_POOL.md](./BROWSER_POOL.md).

### `db/`

É o centro da persistência SSOT.

Peças principais:

- `sqlite.js`: singleton de conexão SQLite e aplicação de migrations;
- `migrations.js`: evolução do schema;
- `task_repo.js`, `task_attempt_repo.js`, `events_repo.js`: núcleo de tasks/tentativas/eventos;
- `mission_repo.js`, `mission_step_repo.js`: persistência de missão;
- repositórios auxiliares de auditoria, inferência, RBAC, preferências e controle.

Responsabilidades:

- aplicar migrations;
- garantir WAL, foreign keys e pragmas de concorrência;
- oferecer repositórios por domínio;
- sustentar o modelo SSOT do sistema.

Aprofundamento específico: [INFRA_DB.md](./INFRA_DB.md).

### `locks/`

Coordena exclusão mútua e proteção de operações críticas.

Peças principais:

- `lock_manager.js`
- `process_guard.js`
- `resilient_lock.js`

Responsabilidades:

- garantir aquisição owner-safe por arquivo;
- validar liveness de processos antes de quebrar locks;
- liberar recursos em cenários de crash e sinais de término.

Aprofundamento específico: [LOCKS.md](./LOCKS.md).

### `storage/`

É a camada de artifacts e resultados.

Peças principais:

- `artifact_store.js`
- `response_adapter.js`
- `response_store.js`
- `response_store_v2.js`
- `task_store.js`
- `dna_store.js`
- `dna_evolution.js`

Responsabilidades:

- persistir artifacts textuais, JSON e binários;
- manter storage de respostas e metadados associados;
- apoiar evolução de identidade/genoma onde aplicável.

Características relevantes:

- `artifact_store.js` impõe path safety e limites de tamanho;
- `response_store_v2.js` escreve múltiplos formatos e mantém espelho legado opcional;
- existe um backup local histórico (`artifact_store.js.backup`) que não faz parte do contrato vivo.

Aprofundamento específico: [STORAGE.md](./STORAGE.md).

### `queue/`

É a camada utilitária de suporte à fila.

Peças principais:

- `scheduler.js`
- `query_engine.js`
- `task_loader.js`
- `cache.js`

Ela não substitui `QueueWorker` de `src/agent/`, mas oferece base para sua operação.

### `proxy/`

Abriga o serviço de proxy do Chrome.

Peça principal:

- `chromeProxyService.js`

Função:

- servir como ponte entre o runtime/container e o Chrome externo quando a topologia exigir.

### `transport/`

Acomoda adaptadores de transporte.

Peça principal:

- `socket_io_adapter.js`

Função:

- conectar um transporte Socket.io ao NERV;
- iniciar/parar conexão;
- enviar frames;
- repassar inbound para o barramento.

### `fs/`, `ipc/`, `io.js`, `system.js`, `http_client_utils.js`

Esses módulos fornecem:

- utilitários de filesystem;
- buffers e mecanismos de IPC;
- operações de I/O;
- helpers de sistema e HTTP.

## Fluxos operacionais centrais

### Fluxo de conexão browser

1. O runtime resolve `browserEndpoint`.
2. `ConnectionOrchestrator` conecta e valida o ambiente.
3. `BrowserPoolManager` usa esse endpoint para inicializar o pool.
4. Os drivers recebem páginas a partir do pool.

### Fluxo de persistência SSOT

1. O processo chama `getDb()`.
2. O SQLite singleton é aberto.
3. Pragmas e migrations são aplicados.
4. Repositórios passam a operar sobre o mesmo arquivo SSOT.

### Fluxo de artifact/result

1. Driver, adapter ou worker produz saída.
2. A camada `storage/` persiste artifact/response.
3. A task e a tentativa referenciam esses artifacts via repositórios.

## Relação com outros subsistemas

### Infra x Agent

- `src/agent/` consome DB, locks, queue e storage.
- A saúde do plano operacional depende diretamente de `infra`.

### Infra x Driver

- `driver` depende do pool, storage e base de artifacts.
- `DriverNERVAdapter` também persiste artifacts via `artifact_store`.

### Infra x Server

- `server` depende de DB, RBAC, token blocklist, telemetry e infraestrutura de runtime.

## Restrições e guardrails

- `browserEndpoint.url` é obrigatório para a topologia canônica de pool.
- `puppeteer_guard.js` existe para impedir desvio arquitetural.
- `ConnectionOrchestrator` deve continuar sendo lido como camada de conexão, não launcher soberano
  do browser local.

## Dívida e observações estruturais

- Há arquivos de backup em `storage/` (`artifact_store.js.backup`) que não são baseline.
- A camada `infra` já concentra múltiplos domínios persistentes (tasks, mission, audit, inferência,
  RBAC), o que a torna um ponto crítico de consistência.

## Referências no código

- `src/infra/ConnectionOrchestrator.js`
- `src/infra/browser_pool/pool_manager.js`
- `src/infra/browser_pool/circuit_breaker.js`
- `src/infra/browser_pool/PeriodicHealthMonitor.js`
- `src/infra/browser_pool/puppeteer_guard.js`
- `src/infra/db/sqlite.js`
- `src/infra/db/task_repo.js`
- `src/infra/db/task_attempt_repo.js`
- `src/infra/db/events_repo.js`
- `src/infra/db/mission_repo.js`
- `src/infra/locks/resilient_lock.js`
- `src/infra/storage/artifact_store.js`
- `src/infra/storage/response_store_v2.js`
- `src/infra/transport/socket_io_adapter.js`
