# 14-FLUXO-AGENT-TERMINAL-SDK — Mapa canônico de fluxo

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Escopo**: `src/copilot/agent/*`,
`src/copilot/sdk/*`, `src/copilot/event-handlers/*`, `src/copilot/terminal/*`,
`src/copilot/observability/*`

---

## 1. Objetivo

Este documento existe para responder, de forma direta:

> quando um evento ou capability nasce no SDK, por quais camadas ele passa até aparecer no agent, no
> terminal, na observability e nas rotas compartilhadas?

Também explicita uma regra nova de governança:

> **sempre partir do vanilla do SDK; ampliar apenas por cima dele, nunca ao lado.**

---

## 2. Fluxo canônico de runtime

```text
Copilot SDK (client/session/rpc/generated events)
  -> src/copilot/sdk/
     -> wrappers/helpers/types canônicos
  -> src/copilot/event-handlers/
     -> tradução SessionEvent vanilla -> sinais internos estáveis
  -> src/copilot/agent/session/event-wirer.js
     -> callbacks.emit(...)
  -> AlwaysAliveAgent (EventEmitter + facades + health)
     -> presentation/agent-runtime.js
         -> presentation/runtime-controls.js
         -> presentation/runtime-health.js
         -> presentation/runtime-ownership.js
     -> presentation/runtime-overview.js
     -> presentation/runtime-status.js
   -> presentation/runtime-targeting.js
   -> presentation/runtime-request.js
         -> presentation/runtime-ui-state.js
         -> presentation/runtime-dialog.js
     -> terminal/frontend/           (consumer layer / projections)
     -> terminal/sdk-session-events.js
     -> terminal/repl-listeners.js
     -> terminal/terminal-agent-wiring.js
     -> observability/
     -> presentation/
     -> server/routes/
```

---

## 3. Papel de cada camada

### 3.1 `sdk/`

É a camada de verdade do **contrato vanilla**:

- tipos do SDK;
- client/session lifecycle;
- `mode.get/set`;
- `plan.read/update/delete`;
- sessions, foreground session, agents, RPCs, hooks, telemetry.

Se uma capability já existe no SDK, ela deve nascer aqui.

### 3.2 `event-handlers/`

É a camada que traduz `SessionEvent` vanilla para sinais estáveis do runtime local.

Exemplos:

- `session.mode_changed`
- `session.plan_changed`
- `tool.execution_progress`
- `tool.execution_partial_result`
- `assistant.reasoning_delta`
- `assistant.turn_start`
- `session.truncation`

Regra:

- **não** pular esta camada para interpretar payload bruto do SDK em vários lugares.

### 3.3 `agent/`

É a orquestração do runtime contínuo.

Responsável por:

- lifecycle;
- dialog loop;
- session wiring;
- health;
- estado compartilhado (`AgentContext`);
- API pública do runtime (`AlwaysAliveAgent`).

Mas o agent **não** deve reinventar contratos que já existem no SDK; ele deve expô-los por facade
quando isso for útil.

### 3.4 `terminal/frontend/`

É a **consumer layer** do terminal.

Responsável por:

- ler o runtime;
- montar projeções para comandos/UX;
- encapsular binding agent/sdk/hub para a borda terminal.

Exemplos:

- `llm-b-runtime.js` = gateway de runtime
- `llm-b-frontend.js` = projections orientadas à UX
- `sdk-session-projection.js` = projeção vanilla de `mode/plan`

### 3.4.1 `presentation/runtime-overview.js`

É a projection compartilhada de leitura rica do runtime default.

Responsável por concentrar:

- `runtimeId`
- `agentRuntimes`
- `snap`
- `health`
- `runtimeSessionId`
- `contextWindow` normalizado

Regra:

- terminal e server preferem ler essa base em vez de remontar `getStatusSnapshot()` +
  `getHealthSnapshot()` por conta própria.

### 3.4.2 `presentation/runtime-status.js`

É a payload layer compartilhada para bordas HTTP/SSE.

Responsável por pequenos payloads repetitivos como:

- `/status`
- `/session`
- SSE `connected`

Regra:

- rotas não devem continuar montando esses payloads ad hoc quando essa camada já existir.

### 3.4.3 `presentation/runtime-controls.js`

Concentra mutações/controles compartilhados do runtime default:

- pause/resume/stop/ping do dialog loop;
- handoff manager/history;
- snapshots do runtime;
- background compaction threshold.

### 3.4.3b `presentation/runtime-targeting.js`

É a camada de normalização compartilhada de `runtimeId` entre HTTP, REPL e accessors.

Responsável por:

- `normalizeRuntimeId()`
- `pickRuntimeId()`
- leitura canônica de `runtimeId` em payloads compartilhados.

Regra:

- nenhuma borda nova deve voltar a reimplementar trim/empty/fallback de `runtimeId` por conta
  própria.

### 3.4.4 `presentation/runtime-health.js`

Concentra a projection de health compartilhada do runtime:

- fallback legado;
- shape HTTP-safe;
- projeção para registry de módulos.

### 3.4.5 `presentation/runtime-ownership.js`

Concentra o vínculo canônico entre sessão SDK ativa e hub session, reduzindo imports diretos de
ownership fora da camada compartilhada.

### 3.4.6 `presentation/runtime-ui-state.js` / `runtime-dialog.js`

São façades de transição arquitetural.

Objetivo:

- impedir que `presentation/` volte a importar `terminal/state.js`, `terminal/file-context.js` e
  `terminal/dialog.js` diretamente em múltiplos arquivos;
- concentrar esse boundary em dois pontos explícitos, enquanto o eventual estado ainda vive no
  terminal.

### 3.5 `terminal/dialog/`

Transforma a verdade já lida em:

- prompt dinâmico;
- waiting prompt;
- renderização de turnos;
- SSE de diálogo;
- coordenação do envio do turno.

Não deve criar semântica paralela do SDK.

### 3.6 `terminal/sdk-session-events.js`

Traduz sinais vanilla **já emitidos pelo agent** para a UX local do terminal.

Exemplos surfacados:

- `session.mode_changed`
- `session.plan_changed`
- `session.task_complete`
- `session.truncation`
- `session.snapshot_rewind`
- `session.shutdown`
- `session.handoff`
- `session.workspace_file_changed`
- `assistant.turn_start`
- `assistant.turn_end`

### 3.7 `terminal/repl-listeners.js`

Fica com a cola REPL/runtime de alto nível:

- question pending;
- tool lifecycle;
- compaction;
- intent;
- subagentes;
- stop/watchdog.

Ele não deve ser o lugar principal de reinterpretar payload vanilla do SDK quando já existir um
módulo dedicado.

### 3.8 `terminal/terminal-agent-wiring.js`

É o wiring de servidor/SSE/streaming contínuo do terminal.

Responsável por:

- deltas;
- usage/context;
- ready/reply/stopped;
- watchdog/restart;
- stream de task.

### 3.9 `observability/`

Consome sinais estabilizados para:

- logs;
- métricas;
- collectors;
- timelines;
- tracing.

Observability coleta — não governa semântica do SDK.

---

## 4. Onde a confusão nascia

As principais fontes de confusão eram:

1. **plan mode local paralelo** ao SDK;
2. frontend do terminal misturando projeção runtime com consumo de `mode/plan` vanilla;
3. `repl-listeners.js` acumulando sinais de naturezas muito diferentes;
4. READMEs antigos descrevendo topologias já superadas;
5. arquitetura viva espalhada entre runtime, UX e auditoria.

---

## 5. Estado atual após a rodada

### Corrigido / mitigado

- `plan local` saiu da hot path;
- `/plan` usa apenas o SDK vanilla;
- `sdk-session-projection.js` separa `mode/plan` do restante do frontend;
- `sdk-session-events.js` separa sinais vanilla da sessão SDK da cola REPL genérica;
- `runtime-overview.js` separa a leitura compartilhada do runtime default das projections locais do
  terminal;
- `runtime-status.js` separa payloads HTTP/SSE repetitivos das rotas de controle/stream;
- `runtime-targeting.js` separa a semântica compartilhada de `runtimeId` entre HTTP, REPL e
  accessors;
- `runtime-controls.js` separa controles/mutações compartilhadas do runtime das bordas concretas;
- `runtime-health.js` tira do `server/routes/*` a montagem compartilhada de health do agent;
- `runtime-ownership.js` separa o vínculo SDK↔hub da montagem das rotas SDK;
- `runtime-ui-state.js` e `runtime-dialog.js` reduzem o leak estrutural de `presentation/` para
  `terminal/*`;
- projections de status/config/health já distinguem também `requestedRuntimeId`, `runtimeFound` e
  `usedDefaultRuntimeFallback` quando uma borda pede um runtime inexistente;
- o terminal já surfaca vários sinais vanilla antes invisíveis;
- os READMEs locais passaram a explicar melhor as fronteiras de responsabilidade.

### Ainda aberto

- continuar reduzindo pontos onde o terminal conhece detalhes demais do runtime do agent;
- manter a cobertura de testes acompanhando cada extração de fronteira;
- atualizar documentos históricos antigos fora da trilha ativa quando forem tocados novamente.

---

## 6. Regra operacional daqui para frente

Para qualquer capability nova:

1. verificar se o SDK vanilla já oferece algo análogo;
2. se sim, começar em `sdk/`;
3. traduzir/normalizar em `event-handlers/` quando for evento;
4. expor por facade no `agent/` se virar capability pública do runtime;
5. consumir no `terminal/frontend/` ou `terminal/dialog/`;
6. só então ampliar UX/observability.

Se a implementação começar fora desse fluxo, há alto risco de drift arquitetural.
