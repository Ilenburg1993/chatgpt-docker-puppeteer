# 52 — Auditoria completa: boot, lifecycle e shutdown do `terminal:llm-b`

**Data:** 2026-04-29  
**Escopo:** `npm run terminal:llm-b` → `src/copilot/terminal/bootstrap.js` → `bootCopilot()` →
`startTerminalServer()` → `AlwaysAliveAgent` → SDK session/runtime → graceful shutdown.

---

## Sumário executivo

O ciclo `terminal:llm-b` já está bem mais maduro do que nas fases iniciais da auditoria: existe boot
canônico único, composition root (`runtime-wiring`), DI progressivo, preflight SDK, servidor HTTP
local, hub persistente, REPL/headless, timer registry e shutdown central.

Ainda assim, a auditoria encontrou três classes de risco:

1. **Shutdown parcialmente idempotente, mas sem promise compartilhada.** Um segundo sinal durante
   shutdown retorna imediatamente em `runShutdown()`; como `terminal/bootstrap.js` chama
   `process.exit(0)` no `finally`, um segundo `SIGTERM/SIGINT` pode encerrar o processo antes dos
   handlers já em andamento terminarem.
2. **Boot parcialmente inicializado não faz cleanup no `catch` fatal.** `terminal/bootstrap.js` sai
   com `process.exit(1)` quando `bootCopilot()` falha, mas não chama `runShutdown('boot_failure')`.
   Se a falha ocorrer após observability, servidor, timers ou listeners terem sido registrados, o
   processo depende do exit bruto para encerrar recursos.
3. **Ownership e shutdown ainda estão distribuídos demais.** `terminal/index.js`, `server/index.js`,
   `runtime-wiring.js`, `agent/lifecycle/agent-lifecycle.js`, `core/timer-registry.js`,
   `conversation-hub/hub.js` e `observability/bootstrap.js` registram handlers diretamente. A ordem
   funciona, mas o contrato de fases de shutdown ainda é implícito.

---

## Fluxo atual observado

### Entrada

- `package.json`
  - script: `terminal:llm-b`
  - comando:
    `COPILOT_LOG_LEVEL=INFO COPILOT_SDK_ENABLED=true node --strip-types src/copilot/terminal/bootstrap.js`

- `ecosystem.config.cjs`
  - processo PM2 opcional: `llm-b-terminal`
  - `kill_timeout: 10000`
  - `autorestart: true`
  - env padrão: `COPILOT_TERMINAL_ENABLED=true`, `LLM_B_TERMINAL_PORT=3009`

### `terminal/bootstrap.js`

Responsabilidades atuais:

- registra `SIGTERM`;
- registra `SIGINT` apenas em modo headless (`!process.stdin.isTTY`);
- chama `bootCopilot()`;
- em falha fatal, imprime erro e encerra com `process.exit(1)`.

Leitura crítica:

- o registro de sinais é mínimo e delega para `runShutdown()`, o que é correto;
- em TTY, `SIGINT` fica sob controle do REPL, que preserva o dialog loop e instrui o usuário a usar
  `/quit`;
- o caminho de falha de boot não executa shutdown central, o que deixa cleanup parcial dependente de
  exit bruto.

### `bootstrap.js`

Fases reais:

1. `readCopilotBootConfig()` + `createCopilotBootPlan()`;
2. `bootstrapObservability()`;
3. `ERROR_TRACKER.registerGlobalHandlers()`;
4. `bootstrapLateDeps()`;
5. wiring do audit bus;
6. validação DI;
7. `runCopilotSdkBootPreflight()`;
8. imports tardios de `runtime-wiring`, `terminal/index`, `todo/store`;
9. `wireCopilotRuntimeDI()`;
10. `startTerminalServer(...)`.

Pontos positivos:

- boot idempotente via `_booted`;
- composição tardia reduz ciclos;
- preflight SDK para ping/auth/model;
- boot plan auditável.

Pontos frágeis:

- `bootPlan` é informativo; não executa fases nem registra duração/resultado por fase;
- `_booted` volta a `false` em erro, mas recursos já registrados não são necessariamente limpos;
- falhas depois de `bootstrapObservability()` deixam handlers globais e shutdown handlers
  registrados.

### `runtime-wiring.js`

Responsabilidades:

- registra tokens do runtime vivo (`ALWAYS_ALIVE_AGENT`, `HUB`, `CONVERSATION_STORE`, bridges);
- injeta setters legados;
- registra `copilot.agent.stop` no shutdown.

Pontos positivos:

- composition root explícito;
- idempotência de wiring;
- agent stop tem timeout próprio de 30s.

Pontos frágeis:

- prioridade `10` compete com outros handlers de terminal também em `10`;
- não há documento/enum de prioridades;
- o handler pega `getAgent()` no shutdown, podendo instanciar o agente se shutdown ocorrer depois do
  wiring mas antes de uso efetivo. Hoje isso é provavelmente aceitável, mas é uma borda sutil.

### `terminal/index.js`

Responsabilidades:

- aliases;
- wiring runtime;
- pinned files loader;
- bridge para EventBus;
- hub session permanente;
- servidor HTTP/Socket.IO;
- listeners de agent;
- reflection loop;
- cleanup diário de TODOs;
- handlers de shutdown de terminal;
- REPL/headless.

Pontos positivos:

- timers críticos já entram em `timer-registry`;
- pinned loader e listeners possuem cleanup;
- servidor é fechado por handler próprio;
- suporta headless sem REPL.

Pontos frágeis:

- `copilot.server` é registrado em `server/index.js` e `terminal.injectServer` também fecha o mesmo
  servidor. O close é idempotente, mas o ownership fica duplicado.
- `timers.cancelAll` roda em prioridade `5`, antes de `copilot.agent.stop`. Isso é defensável, mas
  não está declarado como contrato.
- `SIGHUP` é propositalmente ignorado, mas o listener não é removido em testes/reboots internos.

### `server/index.js`

Responsabilidades:

- monta Express;
- monta rotas;
- cria HTTP server;
- cria Socket.IO quando recebe hub;
- registra shutdown `copilot.server`;
- retorna `close()` idempotente.

Pontos positivos:

- close idempotente com `closeInFlight`;
- separação boa entre server e terminal.

Pontos frágeis:

- ownership duplicado com `terminal.injectServer`;
- `httpServer.close()` não trata explicitamente `ERR_SERVER_NOT_RUNNING`, embora o fluxo atual de
  `closeInFlight` reduza muito o risco.

### `core/shutdown.js`

Responsabilidades:

- registry de handlers nomeados;
- prioridade;
- timeout por handler;
- idempotência por boolean `shuttingDown`.

Ponto crítico:

- a idempotência atual não compartilha a promise do shutdown em andamento. Chamadas concorrentes
  retornam `undefined` imediatamente, não aguardam o mesmo ciclo.

### `AlwaysAliveAgent` e lifecycle

Fluxo principal:

- `agentStart()`
  - status `starting`;
  - limpa graceful shutdown flag;
  - inicia métricas;
  - cria client SDK;
  - `initSession()`;
  - `wireAgentSessionRuntime()`;
  - status `idle`;
  - `ready`.

- `agentStop()`
  - espera boot se estiver `starting`;
  - espera processing/input até timeout;
  - desativa dialog loop;
  - salva snapshot;
  - persiste graceful shutdown;
  - para timers internos, quota, keepalive e métricas;
  - drena background tasks;
  - drena queue;
  - solta observers/listeners;
  - desconecta sessão;
  - para client;
  - limpa ownership;
  - emite `stopped`.

Pontos positivos:

- o stop é relativamente completo;
- shutdown preserva intenção de dialog loop quando configurado;
- session ownership é explicitamente sincronizado/limpo;
- reconexão aborta quando `isShuttingDown()`.

Pontos frágeis:

- `agentStart()` em falha depois de criar client/session não chama cleanup simétrico; ele seta
  status `stopped` e relança.
- a fronteira entre stop de agent, stop de client default SDK e preflight client é complexa e ainda
  exige cuidado em cenários de erro no meio do boot.
- background tasks têm drain, mas o resultado não é reportado ao shutdown central.

---

## Situação ideal proposta

O ciclo ideal deve ser governado por um **contrato explícito de runtime lifecycle**, não apenas por
handlers soltos:

1. **Boot como pipeline executável**
   - cada fase tem nome, owner, timeout, rollback opcional e relatório;
   - falha em qualquer fase aciona shutdown parcial;
   - relatório final fica disponível para terminal/status/diagnóstico.

2. **Shutdown como operação single-flight**
   - todas as chamadas concorrentes aguardam a mesma promise;
   - segundo sinal não aborta cleanup em progresso;
   - cada handler reporta `ok/degraded/timeout/error`;
   - ordem de prioridades é documentada e testada.

3. **Ownership único por recurso**
   - servidor HTTP tem um owner de shutdown;
   - timers têm owner claro;
   - agent/client/session têm owner claro;
   - terminal só fecha recursos que ele criou.

4. **Rollback de boot**
   - falha após observability/server/timers deve executar `runShutdown('boot_failure')`;
   - agent start parcial deve fazer cleanup de client/session quando falhar depois de alocar
     recursos.

5. **Observabilidade de lifecycle**
   - boot e shutdown emitindo eventos/metrics;
   - `/status` e `/health` expondo último boot report e último shutdown report;
   - logs com phase/id/duration.

6. **Contratos de teste**
   - concorrência de `runShutdown()`;
   - boot failure cleanup;
   - start/stop idempotentes;
   - signal matrix headless/TTY;
   - server close single owner.

---

## Achados priorizados

| Prioridade | Achado                                                           | Impacto                                               | Correção recomendada                                             |
| ---------- | ---------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| P0         | `runShutdown()` não compartilha promise em andamento             | Segundo sinal pode encerrar antes do cleanup          | tornar shutdown single-flight                                    |
| P0         | `terminal/bootstrap.js` não roda shutdown em falha fatal de boot | Recursos parciais podem ficar sem cleanup estruturado | chamar `runShutdown('boot_failure')` antes de `process.exit(1)`  |
| P1         | Ownership duplicado do HTTP server                               | Ruído arquitetural e risco futuro                     | escolher owner único ou documentar close idempotente no contrato |
| P1         | Prioridades de shutdown implícitas                               | Regressões silenciosas ao adicionar handlers          | criar constantes/fases de shutdown                               |
| P1         | `agentStart()` sem cleanup simétrico em falha parcial            | Client/session podem ficar vivos até exit             | encapsular start em rollback best-effort                         |
| P2         | Boot plan apenas descritivo                                      | Baixa rastreabilidade de fase                         | transformar em executor/recorder incremental                     |
| P2         | Status não expõe shutdown report                                 | Diagnóstico pós-morte limitado                        | persistir último shutdown report                                 |
| P3         | `SIGHUP` listener permanente                                     | Pequeno acúmulo em cenários de teste/reboot           | registrar via lifecycle host removível                           |

---

## Decisão imediata

A primeira implementação deve atacar os dois P0:

1. `core/shutdown.js`: single-flight promise + testes de concorrência.
2. `terminal/bootstrap.js`: shutdown central no caminho de falha fatal de boot + teste de contrato.

Depois disso, a próxima faixa deve consolidar prioridades/fases e ownership do servidor.
