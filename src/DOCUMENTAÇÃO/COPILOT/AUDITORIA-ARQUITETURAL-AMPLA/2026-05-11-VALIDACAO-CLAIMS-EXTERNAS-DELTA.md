# 2026-05-11 — Validação incremental das claims externas (`src/copilot`)

> **Contexto**: revalidação após estabilização do escopo `src/copilot` + testes Vitest relacionados.
> **Baseline validada (atualizada ao fim da rodada)**: `typecheck strict` green, `eslint` green,
> `npm run test:copilot` green.

---

## 1. Pré-condições verificadas

- `npm run typecheck:strict:src.copilot` ✅
- `npx eslint src/copilot tests/unit/copilot tests/integration/copilot` ✅
- `npm run test:copilot` ✅
- `git status -sb` → `## main...origin/main` ✅
- divergência `HEAD...@{u}` = `0 0` ✅

Essas validações removem ruído de regressão local e permitem avaliar as claims externas sobre a base
já corrigida e publicada.

---

## 2. Matriz de revalidação objetiva

| Claim externa                                                   | Estado em 2026-05-11                                      | Evidência no código atual                                                                                                                                                                                                                                           | Conclusão prática                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUG-01` — `getAllTools(registry)` ignora registry              | **Obsoleta / falso positivo no estado atual**             | `src/copilot/tools/bootstrap.js` passou a expor `getAllStaticTools()` e o compat `getAllTools()` sem parâmetro; a agregação atual inclui `fileReadTools`, `indexTools`, `scopeTools` e `fileWriteTools`.                                                            | A claim não descreve mais a topologia atual do bootstrap.                                                                                                 |
| `BUG-02` — timeout RPC morto/ignorado                           | **Corrigida, com semântica advisory explícita**           | `src/copilot/tools/session/session-rpc-tools.js` agora implementa `resolveRpcTimeoutMs(timeoutMs)` e `wrapRpc()` registra `rpcTimeout=disabled advisory=<valor>`.                                                                                                   | O comportamento continua **não-bloqueante por tempo**, mas não é mais código morto silencioso.                                                            |
| `BUG-03` — fallback da tool factory perde schema                | **Corrigida**                                             | `src/copilot/tools/infra/tool-factory.js` materializa `buildPlainToolOptions()` → `normalizeParameters()` antes do fallback `makePlainTool()`.                                                                                                                      | O caminho recoverable não perde mais contrato de parâmetros da mesma forma descrita na auditoria externa.                                                 |
| `SEC-01` — `safeEnv._cache` frágil                              | **Corrigida**                                             | `src/copilot/tools/shell/sandbox.js` usa `_safeEnvCache` privado de módulo e `SAFE_ENV_CACHE_TTL_MS = 5000`; não há mais cache acoplado como propriedade da função.                                                                                                 | A vulnerabilidade apontada não permanece no formato descrito.                                                                                             |
| `SEC-03` — geração de `requestId` antes do limite               | **Corrigida**                                             | `src/copilot/tools/hook/hook-tools.js` verifica `_getPendingInputCount() >= 5` antes de chamar `_nextInputId()`.                                                                                                                                                    | A janela de inconsistência descrita na claim foi eliminada.                                                                                               |
| `BUG-11` — requests estruturados podem ficar órfãos no shutdown | **Mitigada fortemente / essencialmente corrigida**        | `src/copilot/tools/hook/hook-tools.js` expõe `cancelAllUserInputRequests()` com integração a `ToolSessionContext` e a `cancelAllPendingStructuredUserInput()` do SDK. O timeout local também só resolve se `_deletePendingInput(requestId)` ainda for bem-sucedido. | O problema original de teardown ausente deixou de existir como descrito; resta validar uso consistente desse cancelamento em todos os pontos de teardown. |
| `SDK-BUG-03` — overwrite silencioso no registry                 | **Corrigida**                                             | `src/copilot/sdk/tools/registry.js` agora faz `log('WARN', ...)` quando `registry.entries.has(safeTool.name)`.                                                                                                                                                      | Duplicatas não são mais totalmente silenciosas.                                                                                                           |
| `OBS-BUG-03` / `SYS-GAP-04` — denies não entram em métricas     | **Corrigida no runtime canônico do agent**                | `src/copilot/agent/ports/hook-port.js` passou a chamar `recordBlockedToolCall(toolName)` em decisões `deny`; `src/copilot/observability/tool-stats.js` expõe `blocked` / `lastBlockedIso`; `get_tool_health` agrega `totalBlocked`.                                 | O blind spot quantitativo deixa de existir no fluxo principal Always-Alive → SDK session → hooks do agent.                                                |
| `BUG-04` / `BUG-10` — limites `Infinity` nas file tools         | **Ainda ativa, mas com trade-off arquitetural explícito** | `src/copilot/tools/file/shared.js` mantém `MAX_CONTENT_BYTES`, `MAX_SEARCH_OUTPUT`, `MAX_LIST_ENTRIES` e `MAX_DIFF_OUTPUT` como `Number.POSITIVE_INFINITY`, com comentário explícito de que são limites “informativos históricos” e não bloqueantes para LLM-B.     | O risco operacional permanece; a decisão agora é claramente policy-driven, não mero esquecimento.                                                         |

---

## 3. Leitura arquitetural do delta

### 3.1 Deep-dive — blind spot de denies: confirmado e fechado nesta rodada

A claim `OBS-BUG-03` / `SYS-GAP-04` foi revalidada com leitura cruzada de runtime:

- `src/copilot/hooks/presets/production.js` registra decisões `deny` em `audit(...)`, que por sua
  vez escreve em `auditSink`/`defaultAuditLog`.
- `src/copilot/hooks/tool-interceptor.js` também retorna `permissionDecision: 'deny'` após
  `log('WARN', ...)`, mas não registra métrica operacional local.
- `src/copilot/observability/tool-stats.js` contabiliza chamadas apenas via
  `recordToolCall()`/`wrapWithStats()`, isto é, **após execução do handler** ou em bridges que
  registram explicitamente a chamada.

Conclusão após a transformação desta rodada: o sistema continua **auditando** bloqueios e agora
também os promove ao plano principal de **métricas agregadas de tools** no runtime canônico do
agent. O bug original deixa de ser ativo nesse fluxo.

### 3.2 O que mudou de categoria

As claims externas mais úteis, após a estabilização do código, se repartem em três grupos:

1. **Claims já superadas pelo código**
   - `BUG-02`
   - `BUG-03`
   - `SEC-01`
   - `SEC-03`
   - `SDK-BUG-03`

2. **Claims que ficaram desatualizadas por mudança de arquitetura/superfície**
   - `BUG-01`

3. **Claims ainda válidas e que merecem continuidade da auditoria**
   - `BUG-04` / `BUG-10`
   - `BUG-24` / `BUG-25`

### 3.3 O que isso significa para o rebuild canônico

O centro de gravidade da auditoria saiu de “quebras imediatas da factory/bootstrap” e foi para
**governança de observabilidade, limites operacionais e convergência de contratos**.

Em outras palavras:

- o subsistema hoje está **estável e testado**;
- o risco dominante deixou de ser regressão básica e passou a ser **coerência arquitetural**;
- as próximas decisões precisam ser **policy-first**, não mais “patch-first”.

---

## 4. Backlog imediato derivado da revalidação

### Prioridade A — continuar auditoria objetiva

1. Decidir formalmente a política para `Infinity` nas file tools:
   - manter liberdade plena da LLM-B com risco assumido;
   - introduzir limites reais configuráveis;
   - introduzir streaming/chunking/negociação por domínio.
2. Verificar se `cancelAllUserInputRequests()` é chamado por **todos** os teardowns relevantes.
3. Encapsular o state do MCP bridge e aproximá-lo da factory/telemetria canônicas.

### Prioridade B — consolidar arquitetura target

1. Formalizar contratos canônicos de tool (`ToolDefinition`, `Telemetry`, `PermissionDecision`,
   `UserInputBridge`).
2. Fechar o gap entre `ToolSessionContext` e o path legado de user-input.
3. Revalidar restrições de boundary além de `tools/`, especialmente no `terminal/`.

---

## 5. Conclusão operacional

O prompt original desta frente foi cumprido antes desta etapa de auditoria:

- o escopo `src/copilot` foi reestabilizado;
- o pacote de testes/lint/typecheck ficou verde;
- os commits foram organizados e enviados para `main`.

Com isso, a auditoria passa a operar sobre uma base confiável. A partir daqui, o trabalho de maior
valor é **separar risco arquitetural real de documentação externa já obsoleta**.
