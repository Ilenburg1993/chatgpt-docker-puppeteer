# 11-ROADMAP-FIXES — Plano de Correções por Prioridade

**Auditoria Profunda de `src/copilot`** · Abril 2026
**Base**: [10-ISSUES-CONSOLIDATED.md](./10-ISSUES-CONSOLIDATED.md)
**Documentado em**: 2026-04-18

---

## Critérios de Priorização

1. **Impacto na estabilidade**: crash, corrupção de dados, estado inconsistente
2. **Impacto no funcionamento**: feature inoperante, silently broken
3. **Esforço de implementação**: linhas de código, risco de regressão
4. **Pré-requisito bloqueante**: alguns fixes precisam ser feitos antes de outros

## Status de execução em `2026-04-17`

- **Concluído**: `F1.1`, `F1.2`, `F2.1`, `F2.2`, `F2.3`.
- **P2 já adiantados nesta execução**: `GAP-BOOT-05`, `GAP-BOOT-03`, `GAP-CHAN-03`, `GAP-LOOP-01`, `GAP-CORE-01`, `GAP-AGENT-01`, `GAP-HOOKS-01`, `GAP-HOOKS-02`, `GAP-HUB-02`.
- **P2 adicionais mitigados nesta execução**: `GAP-BOOT-01`, `GAP-BOOT-02`, `GAP-CHAN-01`.
- **P2 já adiantados nesta execução**: `GAP-HUB-03` também foi mitigado com fila de writes por sessão no `ConversationStore`.
- **Hardening adicional concluído**: `CAT-002` (Socket.IO `/copilot`) agora usa ACL por sessão, grants via JWT e gating de eventos por autorização.
- **Hardening adicional concluído**: `GAP-HOOKS-04` agora conta com `ask` para shell sensível e deny permanente por assinaturas destrutivas no preset de produção.
- **Smoke test**: `shell: terminal:llm-b` iniciou com sucesso e entrou em `READY`.
- **Boot log revalidado**: ruído de `custom-tools.json` opcional foi removido, F53 deixou de falhar falsamente em retomadas saudáveis, `SessionKeepalive` ganhou motivo explícito no log e `session.custom_agents_updated` foi promovido a evento conhecido do SDK.
- **Hardening arquitetural do agent**: `AgentContext` ganhou helpers semânticos, `withAgentErrorPolicy(...)` foi implementado e já adotado em `messaging` + `reconnect-policy`, `loop-manager`/`agent-messaging` reduziram bypasses de host, e `entry.js`/`presentation/agent-control.js` migraram para `getAgent()`.
- **Hardening arquitetural do agent (onda 2)**: mutation API ampliada, `session-setup` com menos dívida artificial de tipos e `bootReport` por step integrado ao health do agent.
- **Hardening arquitetural do agent (onda 3)**: contracts runtime explícitos (`runtime-contracts.js`), cleanup de listeners de `AbortSignal` em `turn-executor`, health com `riskFlags` + `recommendedAction`, e token canônico `ALWAYS_ALIVE_AGENT` resolvendo `getAgent()` no DI do terminal.
- **Hardening arquitetural do agent (onda 4)**: hooks alinhados ao SDK 0.2.0 sem boundary artificial em `session-setup`, wrappers canônicos para `last/foreground/serverRpc` no SDK client, e nova façade `agent-sdk-access` expondo cobertura total da superfície SDK ao runtime do agent.
- **Hardening arquitetural do agent (onda 5)**: `withAgentErrorPolicy(...)` passou a cobrir `dialog-controller`, wrappers de ownership e persistência auxiliar via `persistStateWithPolicy(...)`; `dialog/user-input-handler.js` deixou de gravar `pendingQuestion` em duplicidade, `agent-messaging.js` passou a limpar `pendingQuestion` pela policy canônica, `boot-steps.js` deixou de usar persistência nua no boot recovery e `initializer.js` foi migrado para a mesma rota canônica de persistência.
- **Hardening arquitetural do agent (onda 6)**: o runner de boot agora distingue steps `required` de steps opcionais degradáveis, registra `degraded/skipped` no `bootReport`, e o health/HTTP do agent passaram a reportar também degradação parcial do boot (`boot.steps_degraded`, `bootDegradedSteps`).
- **Hardening arquitetural do agent (onda 7)**: a leitura semântica do `AgentContext` avançou para `health`, `state`, facades e getters públicos do agent, reduzindo a dependência direta dos módulos quentes em `sessionState/dialogState/configState/...`.
- **Re-triado**: `F2.4` mudou de fix de runtime para revisão de JSDoc/comentários, porque não foi encontrado import runtime direto fora de `src/copilot/sdk/`.
- **Re-triado**: `GAP-SDK-01` deixou de ser sobre logging de `stopClient()` e passa a ser risco de versionamento em `waitForEvent`.
- **Próximo lote natural**: `F3` (P2/P3) com foco em `GAP-CHAN-02`, `GAP-HOOK-01`, `GAP-HOOKS-03`, além do hardening residual do `agent` (`AgentContext` ownership completo, hooks internos sob policy canônica e testes específicos de lazy singleton/reconnect/boot degradation`).

---

## FASE 1 — P0: Fixes Críticos (fazer ANTES de ativar LLM-B)

### F1.1 — BUG-CORE-01: Async handler rejections no EventBus

**Arquivo**: `src/copilot/core/event-bus.js`
**Onde**: método `#deliver()` (~linha 260-290)
**Risco atual**: Em Node.js 24 com `--unhandled-rejections=throw`, qualquer handler async que rejeite derruba o processo.

**Fix**:
```js
// ANTES
#deliver(event) {
    for (const handler of handlers) {
        void handler(event);  // ← engole rejeições
    }
}

// DEPOIS
#deliver(event) {
    for (const handler of handlers) {
        Promise.resolve(handler(event)).catch((err) => {
            this.#logger?.error('[EventBus] handler error', { event: event.type, err });
        });
    }
}
```

**Esforço**: 5 linhas. **Risco de regressão**: baixo.

---

### F1.2 — BUG-INFRA-01: Escrita atômica em `writeJson()`

**Arquivo**: `src/copilot/infra/storage.js`
**Onde**: função `writeJson()` (~linha 35-50)
**Risco atual**: Estado do agente corrompido após qualquer crash durante escrita.

**Fix**:
```js
import { rename, unlink, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function writeJson(filePath, data) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
    const content = JSON.stringify(data, null, 2) + '\n';
    const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
        await writeFile(tmpPath, content, 'utf-8');
        await rename(tmpPath, filePath);  // POSIX atomic
    } catch (err) {
        try { await unlink(tmpPath); } catch { /* ignore cleanup */ }
        throw err;
    }
}
```

**Esforço**: 15 linhas. **Risco de regressão**: baixo.

---

## FASE 2 — P1: Fixes Altos (antes de uso em browser/produção)

### F2.1 — BUG-CORS-01+02: CORS origin inválido

**Arquivo**: `src/copilot/server/middleware/cors.js`
**Risco atual**: Todas as requests de browser (dashboard, ferramentas locais) bloqueadas por CORS.

**Fix**:
```js
// Remover http://localhost:* do allowedOrigins (wildcard inválido)
// Substituir por matcher funcional:
const origin = req.headers.origin;
const isAllowed = !origin
    || /^https?:\/\/localhost(:\d+)?$/.test(origin)  // qualquer porta localhost
    || explicitOrigins.includes(origin);

if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
}
```

**Esforço**: 20 linhas. **Risco de regressão**: médio (middleware de segurança).

---

### F2.2 — BUG-KEEP-01: Keepalive ticks concorrentes

**Arquivo**: `src/copilot/agent/session/keepalive.js`
**Fix**: Adicionar guard de execução no início de `#tick()`:
```js
#running = false;

async #tick() {
    if (this.#running) return;  // guard overlap
    this.#running = true;
    try {
        await this.#doKeepalive();
    } finally {
        this.#running = false;
    }
}
```

**Esforço**: 8 linhas. **Risco de regressão**: baixo.

---

### F2.3 — BUG-SSE-01: Buffer overflow silencioso em SSE

**Arquivo**: `src/copilot/channel/sse-client.js`
**Fix**: Ao invés de silenciosamente descartar, emitir evento de erro:
```js
if (buf.length > MAX_BUF) {
    this.emit('error', new Error(
        `SSE buffer overflow: ${buf.length} bytes > ${MAX_BUF} limit. Response truncated.`
    ));
    buf = '';
    return;
}
```

**Esforço**: 5 linhas. **Risco de regressão**: baixo.

---

### F2.4 — ARCH-SDK-01: Imports diretos do SDK fora do barrel

**Status atual**: ℹ️ re-triado em `2026-04-17`.

Na revisão do código atual, não foram encontrados imports runtime diretos de `@github/copilot-sdk` fora de `src/copilot/sdk/`.
Os matches restantes fora dessa camada são referências em JSDoc, comentários e documentação.

**Ação revisada**: tratar como backlog de higiene arquitetural/documental, não como fix de runtime P1.

**Esforço**: pequeno. **Risco de regressão**: baixo.

**Arquivos afetados** (7 arquivos com import direto de `@github/copilot-sdk`):
- `src/copilot/tools/*.js`
- `src/copilot/hooks/registry.js`
- `src/copilot/agent/lifecycle/*.js`

**Fix**: Redirecionar imports via barrel `src/copilot/sdk/session/client.js` ou `src/copilot/sdk/index.js`.

**Esforço**: Mecânico, 7 arquivos. **Risco de regressão**: médio.

---

## FASE 3 — P2: Gaps Médios (sprint de qualidade)

| ID           | Esforço | Fix                                                                                                       |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| GAP-BOOT-05  | Trivial | `process.exitCode = 1` → `process.exit(1)`                                                                |
| GAP-BOOT-02  | Pequeno | `await copilotServerPromise` no bootstrap                                                                 |
| GAP-BOOT-01  | Pequeno | ~~Antecipar wiring/validação DI do terminal~~ ✅ mitigado com `wireTerminalDI()` idempotente antes do boot |
| GAP-BOOT-03  | Pequeno | Remover listener `pinnedLoader` no shutdown                                                               |
| GAP-HOOKS-01 | Pequeno | Logar warning quando `toolAllowList` está vazio                                                           |
| GAP-HOOKS-04 | Médio   | ~~Adicionar `permanentDenyList` de tools sempre-bloqueadas~~ ✅ mitigado com deny por padrões destrutivos  |
| GAP-HUB-03   | Médio   | ~~Mover `injectUserMessage` para dentro do mutex~~ ✅ mitigado com fila de writes por sessão no store      |
| GAP-HUB-02   | Médio   | Adicionar inflight counter antes de nulificar bridge                                                      |
| GAP-CHAN-03  | Trivial | Guard double-set em `setBridgeAgent()`                                                                    |
| GAP-CHAN-01  | Pequeno | ~~Remover purge O(n) com `shift()` no rate limiter~~ ✅ mitigado com índice lógico + compactação ocasional |
| GAP-CORE-01  | Pequeno | Suporte a async middleware no EventBus                                                                    |
| GAP-LC-01    | Trivial | ~~Emitir evento/log quando `agentStart()` ignora call~~ ✅ mitigado; avaliar se também deve lançar erro    |
| GAP-LOOP-01  | Pequeno | ~~Try/catch em `bootSendFn()`~~ ✅ mitigado com `Promise.resolve(...).catch(...)`                          |
| GAP-AGENT-01 | Médio   | Internalizar `__processQueue` via Symbol                                                                  |

---

## FASE 4 — P3: Melhorias (manutenção contínua)

| ID           | Fix Sugerido                                                                   |
| ------------ | ------------------------------------------------------------------------------ |
| GAP-TERM-01  | Aguardar `clearActiveSdkSessions()` no shutdown graceful                       |
| GAP-TERM-02  | Registrar SIGINT/SIGTERM handlers no bootstrap                                 |
| GAP-TERM-03  | Healthcheck verificar estado real do SDK                                       |
| GAP-HOOKS-02 | Logar warning ao usar preset sem PII patterns                                  |
| GAP-HOOKS-03 | Adicionar `auditSink` separado de logger padrão                                |
| GAP-INFRA-01 | Mover `clearActiveSdkSessions()` para após `client.stop()`                     |
| GAP-OBS-01   | Adicionar `metrics.reset()` para testes                                        |
| GAP-SDK-01   | Encapsular `waitForEvent` em wrapper local para reduzir risco de versionamento |
| GAP-HOOK-01  | Isolat retry/circuit state por `sessionId`                                     |

---

## Estimativa de Esforço Total

| Fase      | Issues | Esforço Estimado |
| --------- | ------ | ---------------- |
| F1 (P0)   | 2      | ~1h              |
| F2 (P1)   | 4      | ~3h              |
| F3 (P2)   | 12     | ~1 dia           |
| F4 (P3)   | 9      | ~1 dia           |
| **Total** | **27** | **~3 dias**      |

---

## Ordem de Execução Recomendada

```
F1.1 BUG-CORE-01 → F1.2 BUG-INFRA-01
    → F2.1 BUG-CORS-01+02 → F2.2 BUG-KEEP-01 → F2.3 BUG-SSE-01 → F2.4 ARCH-SDK-01
        → [Testes de integração]
            → F3 (batch)
                → [Testes unitários]
                    → F4 (manutenção)
                        → [Ativar terminal:llm-b em produção]
```

---

## Status: Auditoria Concluída

Todos os 12 documentos foram gerados:

| #   | Documento                                              | Status |
| --- | ------------------------------------------------------ | ------ |
| 00  | [PRE-AUDITORIA](./00-PRE-AUDITORIA.md)                 | ✅      |
| 01  | [TERMINAL-LLM-B](./01-TERMINAL-LLM-B.md)               | ✅      |
| 02  | [AGENT](./02-AGENT.md)                                 | ✅      |
| 03  | [SDK-CONFORMIDADE](./03-SDK-CONFORMIDADE.md)           | ✅      |
| 04  | [CHANNEL-COMMUNICATION](./04-CHANNEL-COMMUNICATION.md) | ✅      |
| 05  | [CONVERSATION-HUB](./05-CONVERSATION-HUB.md)           | ✅      |
| 06  | [CORE](./06-CORE.md)                                   | ✅      |
| 07  | [SERVER](./07-SERVER.md)                               | ✅      |
| 08  | [INFRA-OBSERVABILITY](./08-INFRA-OBSERVABILITY.md)     | ✅      |
| 09  | [HOOKS](./09-HOOKS.md)                                 | ✅      |
| 10  | [ISSUES-CONSOLIDATED](./10-ISSUES-CONSOLIDATED.md)     | ✅      |
| 11  | [ROADMAP-FIXES](./11-ROADMAP-FIXES.md)                 | ✅      |
