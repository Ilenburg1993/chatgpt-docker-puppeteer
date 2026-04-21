# 01 — BUGS E RACE CONDITIONS

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`

---

## SUMÁRIO

| Severidade  | Quantidade |
| ----------- | ---------- |
| Crítico (C) | 8          |
| Alto (A)    | 24         |
| Médio (M)   | 32         |
| Baixo (B)   | 12         |
| **Total**   | **76**     |

---

## BUGS CRÍTICOS (C)

### C-01 — `state-io.js:98` — State read failure silenciada completamente

```js
readStateAsync().catch(() => {});
```

**Impacto**: Se o state file corromper (JSON inválido, permissão, disco cheio), a aplicação continua
sem state — pode gerar sessões duplicadas, perda de contexto de dialog loop, ou crashloop.
**Arquivo**: `agent/lifecycle/state-io.js:98` **Fix**: Logar o erro e emitir evento de alerta.

### C-02 — `state-io.js:247` — Write queue rejection silenciada

```js
_writeQueue.then(() => undefined).catch(() => undefined);
```

**Impacto**: Perda silenciosa de writes no state file. Se a queue falhar persistentemente, o
state.json fica stale e futuras reinicializações podem usar dados desatualizados. **Arquivo**:
`agent/lifecycle/state-io.js:247` **Fix**: Logar e contar falhas; emitir `AGENT_STATE_WRITE_FAILED`
no bus.

### C-03 — `snapshot.js:139` — Lista de snapshots falha silenciosa

```js
listSnapshotsAsync().catch(() => {});
```

**Impacto**: Snapshots são usados para session rewind. Falha silenciosa significa que o agente não
sabe que não tem snapshots disponíveis — pode tentar rewind sem dados. **Arquivo**:
`agent/session/snapshot.js:139` (deprecated mas ainda chamado)

### C-04 — `snapshot.js:152` — Load snapshot falha silenciosa

```js
loadSnapshotAsync(snapshotId).catch(() => {});
```

**Impacto**: Mesmo que C-03 — snapshot-based recovery não funciona se o load falhar silenciosamente.
**Arquivo**: `agent/session/snapshot.js:152`

### C-05 — `always-alive.js:537` — `Symbol[dispose]` swallows stop errors

```js
this.stop().catch(() => undefined);
```

**Impacto**: No pattern `using agent = ...`, se `stop()` falhar (sessão travada, timeout), o erro é
completamente ignorado. Pode deixar recursos (WebSocket, timers, pids) orphaned. **Arquivo**:
`agent/always-alive.js:537`

### C-06 — `always-alive.js:746` — Top-level try/catch vaza EventBus

```js
} catch {
    // EventBus not available yet — ignore
}
```

**Impacto**: Se o `import()` dinâmico falhar por razão diferente de "módulo não encontrado" (ex:
syntax error no di-container.js), o bridge agent→EventBus nunca é configurado. Todos os 80+ event
types ficam sem bridge. **Arquivo**: `agent/always-alive.js:665-746` **Fix**: Catch seletivo —
rejeitar erros que não sejam MODULE_NOT_FOUND.

### C-07 — `todo/store.js:62-63` — `JSON.parse(readFileSync)` sem try-catch

```js
const raw = fs.readFileSync(TODOS_FILE, 'utf8');
const data = JSON.parse(raw);
```

**Impacto**: Se `todos.json` estiver corrompido (arquivo truncado, escrita parcial), `JSON.parse`
lança e o `count()` retorna sem valor definido → runtime error cascading. **Arquivo**:
`tools/todo/store.js:62-63`

### C-08 — 119 Map/Set instances sem WeakMap/WeakRef e zero FinalizationRegistry

**Impacto**: Em sessões de longa duração (8h+), Maps/Sets que acumulam entries sem limpeza causam
memory leak gradual. Nenhum uso de WeakMap/WeakRef em 389 arquivos. **Evidência**:
`grep 'new Map\|new Set' → 119 ocorrências`, `grep WeakMap → 0`

---

## BUGS ALTOS (A)

### A-01 — `tool-factory.js:39` — `readFileSync` dentro de handler async

```js
handler: async ({ path }) => readFileSync(path, encoding);
```

**Impacto**: Bloqueia o event loop durante leitura de arquivo. Em arquivos grandes (>1MB), pode
causar stall no processamento de outras requests. **Arquivo**: `tools/tool-factory.js:39`

### A-02 — `sdk/tools/core.js:88` — Mesmo que A-01

```js
handler: async ({ path }) => readFileSync(path, 'utf8');
```

**Arquivo**: `sdk/tools/core.js:88`

### A-03 — `sdk/tools/state.js:38` — Config load failure silenciada

```js
loadToolsConfigAsync().catch(() => {});
```

**Impacto**: Se tools config falhar ao carregar, o agente opera com config default — tools
customizadas não carregam. **Arquivo**: `sdk/tools/state.js:38`

### A-04 — `sdk/tools/custom.js:159` — Custom tools load failure silenciada

```js
loadCustomToolsAsync().catch(() => {});
```

**Impacto**: Custom tools silenciosamente indisponíveis. Usuário não sabe que configurou tools que
nunca carregaram. **Arquivo**: `sdk/tools/custom.js:159`

### A-05 — `quota-monitor.js:120-124` — Double nested silent catch

```js
_fetch().catch(() => {
    // retry
    _fetch().catch(() => {
```

**Impacto**: Quota check resiliente mas se ambas falharem, quota info fica stale indefinidamente.
Sem limite de staleness. **Arquivo**: `sdk/telemetry/quota-monitor.js:120-124`

### A-06 — `terminal-agent-wiring.js:66` — `setInterval` sem cleanup evidente

```js
const interval = setInterval(() => { ... }, 66);
```

**Impacto**: Se a função que cria este interval não retorna o handle para cleanup, ou se o módulo é
re-importado, cria timers orphans. **Arquivo**: `terminal/terminal-agent-wiring.js:66`

### A-07 — `conversation-hub/store.js:87` — Checkpoint timer pode não limpar em error

```js
const checkpointTimer = setInterval(...)
```

**Impacto**: Se a store inicializar mas falhar depois, o checkpoint timer pode continuar rodando
tentando checkpointar dados inválidos. **Arquivo**: `conversation-hub/store.js:87`

### A-08 — 178 `.on()` calls vs 55 `.off()`/`removeListener()` — 3:1 ratio

**Impacto**: Potential event listener leaks. Em sessões longas, listeners acumulam se não forem
removidos em error/cleanup paths. **Evidência**: `grep '.on(' → 178`,
`grep '.off(' + '.removeListener(' → 55`

### A-09 — `hub-ns.js:121` — JWT auth silenciosamente desabilitado

```js
log('WARN', `[hub-ns/copilot] JWT_SECRET inválido: ${secretErr.message}. Auth desabilitado.`);
```

**Impacto**: Se JWT_SECRET não for configurado ou for inválido, Socket.IO namespace opera sem
autenticação. Em produção, qualquer client pode se conectar. **Arquivo**:
`server/socket/hub-ns.js:121`

### A-10 — `task-tools.js:49,96,146` — `JSON.parse` sem try-catch em tool handlers

```js
const data = JSON.parse(body);
```

**Impacto**: Se o body HTTP não for JSON válido (timeout, partial response), o tool handler crasha e
o modelo recebe erro não informativo. **Arquivo**: `tools/task-tools.js:49, 96, 146`

### A-11 — `hook-tools.js:179` — `JSON.parse(line)` sem try-catch em stream

```js
return JSON.parse(line);
```

**Impacto**: Uma única linha malformada no audit log crasha o parser e interrompe toda a leitura.
**Arquivo**: `tools/hook-tools.js:179`

### A-12 — `gh/shared.js:52` — `JSON.parse` sem guarda

```js
return JSON.parse(raw);
```

**Impacto**: Se CLI retornar output não-JSON (ex: error message), crash. **Arquivo**:
`bridges/gh/shared.js:52`

### A-13 — `audit/pipeline-audit-log.js:295` — `JSON.parse` em stream sem guarda

```js
return JSON.parse(l);
```

**Impacto**: Mesmo padrão — uma linha corrompida no JSONL interrompe o pipeline audit. **Arquivo**:
`audit/pipeline-audit-log.js:295`

### A-14 — `config/env.js:42-68` — 27 exports consecutivos sem JSDoc

**Impacto**: Nenhuma documentação de tipo, default ou range válido para variáveis de ambiente.
Configuração incorreta é silenciosa. **Arquivo**: `config/env.js:42-68`

### A-15 — `always-alive.js:208` — Stale state fallback para sessionId

```js
return this.ctx.session?.sessionId ?? readState()?.sessionId ?? null;
```

**Impacto**: Pode retornar sessionId de uma sessão anterior (do state file) quando a sessão atual
ainda está inicializando. Clientes podem operar em sessão errada. **Arquivo**:
`agent/always-alive.js:208`

### A-16 — `loop-manager.js:456` — Dialog loop check silenciado

```js
.catch(() => false);
```

**Impacto**: Operação de check retorna `false` silenciosamente, mascarando o real motivo da falha.
**Arquivo**: `agent/dialog/loop-manager.js:456`

### A-17 — `terminal/alias-store.js:49` — Alias load silenciado

```js
loadAliasesAsync().catch(() => {});
```

**Impacto**: Se aliases falham ao carregar, comandos customizados do terminal não funcionam sem
aviso. **Arquivo**: `terminal/alias-store.js:49`

### A-18 — `server/routes/health.js:49` — Health check failure silenciada

```js
.catch(() => { ... })
```

**Impacto**: Health endpoint pode reportar healthy quando subsistema está em falha. **Arquivo**:
`server/routes/health.js:49`

### A-19 — `observability/error-alerting.js:232` — Alert check a cada 30s sem backoff

```js
_interval = setInterval(check, 30_000);
```

**Impacto**: Se o check for pesado (muitas métricas), 30s fixo pode ser insuficiente para completar.
Sem backoff, checks acumulam. **Arquivo**: `observability/error-alerting.js:232`

### A-20 — 51 magic numbers de timeout espalhados

**Impacto**: Timers com valores hardcoded (1000, 5000, 30000, 60000, 120000, 300000) espalhados sem
constantes nomeadas. Mudança de timeout requer grep+replace. **Evidência**: 51 ocorrências em
arquivos de produção.

### A-21 — Dialog loop `writeStateAsync` com catch logging apenas

```js
await writeStateAsync({ dialogPaused: true, ... }).catch(...)
await writeStateAsync({ dialogPaused: false }).catch(...)
await writeStateAsync({ dialogLoopActive: false }).catch(...)
```

**Impacto**: Se state write falhar, o dialog loop continua mas o state file fica inconsistente.
Próximo restart pode resumir em estado errado. **Arquivo**:
`agent/dialog/loop-manager.js:402, 430, 476`

### A-22 — `orchestrator.js:258` — Promise chain com catch-only logging

```js
const tail = next.then(() => {}).catch((e) => logSwallowed(e, '...'));
```

**Impacto**: Orquestração de hub com erros apenas logados. Se o orquestrador falhar, sessões podem
ficar em estado inconsistente. **Arquivo**: `conversation-hub/orchestrator.js:258`

### A-23 — `backpressure.js:73` — Mutex chain com catch-only logging

```js
this.#mutex = next.then(() => {}).catch((e) => logSwallowed(e, '...'));
```

**Impacto**: Se o mutex falhar, a próxima operação procede sem esperar, quebrando a exclusão mútua.
**Arquivo**: `agent/dialog/backpressure.js:73`

### A-24 — `store.js:133` — `JSON.parse(row.data)` sem try em loop DB

```js
tasks[row.id] = JSON.parse(row.data);
```

**Impacto**: Um registro corrupto no SQLite interrompe o carregamento de todos os tasks.
**Arquivo**: `tools/todo/store.js:133`

---

## BUGS MÉDIOS (M)

### M-01 — 27 blocos `catch(e)` sem `@type {any}`

**Impacto**: TypeScript strict mode pode inferir tipo errado. Inconsistência com padrão do projeto
(`/** @type {any} */ e`).

### M-02 — 8 blocos `catch {}` vazios

**Lista**: state-io.js:98, snapshot.js:139,152, tools/state.js:38, tools/custom.js:159,
alias-store.js:49, quota-monitor.js:120,124

### M-03 — `tools/file/shared.js:106` — Path resolution TOCTOU

```js
const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
```

**Impacto**: Entre check e use, o symlink pode mudar. Race condition em file-based tools.

### M-04 — `tools/shell/sandbox.js` — Regex-based command blocklist

**Impacto**: Regex patterns para bloquear comandos perigosos podem ser bypassados via encoding,
aliases, ou builtins.

### M-05 — `core/index.js` re-exporta de `events/` — violação de layering

```js
export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, PR_CONSUMING_EVENTS } from '../events/agent-events.js';
export { BaseEmitter, createEmitter } from '../events/create-emitter.js';
```

**Impacto**: `core/` deveria ser leaf node. Importar de `events/` cria dependência circular
potencial.

### M-06 — `core/di-tokens.js` re-exporta tokens de 9 módulos

**Impacto**: God barrel — mudança em qualquer di-tokens.js de qualquer módulo recompila core.

### M-07 — `server/routes/` sem schema validation em 10 de 12 POST/PUT routes

**Impacto**: Apenas webhooks e sessions têm Zod validation (Onda 6.0). Demais POST/PUT aceitam
payloads arbitrários.

### M-08 — `req.query['tag']` e `req.query['search']` sem sanitização em memory.js

**Impacto**: Potencial injection se handlers confiarem em valores sem validação.

### M-09 — `req.params` passados como string sem format validation

**Impacto**: handoffId, sessionId, memoryId aceitos sem verificar formato (UUID, etc).

### M-10 — Magic numbers duplicados entre modules

**Ex**: `60_000` aparece em 5+ locais como timeout padrão; `30_000` em 3+ locais como interval.

### M-11 — `observability/otel.js:198` — `any` cast no span

```js
const ctx = trace.setSpan(context.active(), /** @type {any} */ (span));
```

**Impacto**: Perde type safety do OpenTelemetry SDK.

### M-12 — Rate limiter state duplicado entre `server/` e `terminal/`

```
server/middleware/rate-limiter-state.js imports from terminal/rate-limiter-state.js
```

**Impacto**: Rate limiting compartilhado entre server e terminal pode causar contenção inesperada.

### M-13 — 40 imports de logger sem rotation

**Impacto**: Em sessões longas, logs podem crescer sem bound.

### M-14 — `observability/metrics.js:277` — Snapshot timer com interval fixo

**Impacto**: Se snapshot leva mais que o interval, snapshots acumulam.

### M-15 — `store.js:61` — Timer de checkpoint criado condicionalmente sem cleanup path

**Impacto**: Se a condição mudar durante runtime, timer antigo não é limpo.

### M-16 — `agent/dialog/turn-executor.js:116,180` — Promise chains com nested resolve/reject

**Impacto**: Complexidade de controle de fluxo dificulta debugging. Potential unhandled rejection se
resolve/reject thrown.

### M-17 — `channel/inject.js:418` — Arquivo grande (418 LOC) com múltiplas responsabilidades

### M-18 — `hooks/factory.js:417` — God Factory com 417 LOC

### M-19 — `conversation-hub/orchestrator.js:411` — Orquestrador monolítico

### M-20 — `observability/observers/dialog-task-handlers.js:426` — Observer monolítico

### M-21 — `observability/collectors/session-handlers.js:393` — Collector monolítico

### M-22 — `observability/observers/session-agent-handlers.js:383` — Observer monolítico

### M-23 — 4 mecanismos de event emission diferentes sem unificação

**Lista**: bridgeEmitter (core), EventBus (bus), createEventBus (factory), createEmitter (emitter)

### M-24 — `sdk/types.js:646` — God Type File

**Impacto**: Mudança em qualquer type recompila todos os consumidores.

### M-25 — `agent/always-alive.js:665-746` — 80+ linhas de event bridge mapping inline

**Impacto**: Manutenção difícil. Cada novo event type requer editar este bloco.

### M-26 — `server/sse/utils.js:164` — Heartbeat timer sem cleanup em error paths

### M-27 — `terminal/index.js:102` — Reflection timer global

### M-28 — `keepalive.js:27` — Keepalive timer sem backoff adaptativo

### M-29 — `boot-wiring.js:185` — Metrics timer criado em bootstrap

**Impacto**: Se bootstrap falhar parcialmente, timer pode ficar orphan.

### M-30 — `agent/dialog/watchdog.js:62` — Watchdog timer sem cleanup em paused state

### M-31 — `audit/pipeline-sdk-buffer.js` — @deprecated mas ainda importado

### M-32 — `types/events.js` — @deprecated mas pode ainda estar referenciado

---

## BUGS BAIXOS (B)

### B-01 — `agent.js` (raiz) — wrapper deprecated de 16 LOC sem importadores evidentes

### B-02 — `bootstrap.js` (raiz) — papel ambíguo vs `main.js`

### B-03 — `logs/` diretório vazio

### B-04 — `.github/` dentro de src/copilot — cópia do .github raiz

### B-05 — Console.log/warn residuais em código de produção (verificar)

### B-06 — `tools/todo/index.js` — @deprecated barrel

### B-07 — `conversation-hub/events.js` — @deprecated event definitions

### B-08 — `conversation-hub/socket-ns.js` — @deprecated socket namespace

### B-09 — `observability/index.js` — @deprecated barrel parcial

### B-10 — `sdk/tools/custom.js` — @deprecated custom tools loader

### B-11 — `sdk/tools/state.js` — @deprecated tools state

### B-12 — `terminal/alias-store.js` — @deprecated alias store

---

_76 bugs categorizados. Próximo: 02-GAPS-FUNCIONAIS.md_
