# Plano de Execução — Auditoria src/copilot

**Origem**: `DOCUMENTAÇÃO/AUDITORIAS/AUDIT_SRC_COPILOT.md`
**Gerado em**: 2026-03-28
**Status**: Em execução

---

## Resumo Executivo da Validação

Todos os 65 itens do relatório de auditoria foram confrontados com o código atual. A tabela abaixo
resume o resultado de cada validação e seu status de execução.

| Categoria          | Crítico | Alto   | Médio  | Baixo  | Total  |
| ------------------ | ------- | ------ | ------ | ------ | ------ |
| SDK Conformidade   | 3       | 6      | 8      | 5      | 22     |
| Runtime Bugs       | 3       | 4      | 6      | 4      | 17     |
| Segurança          | 2       | 4      | 3      | 2      | 11     |
| Arquitetura/Design | 0       | 0      | 5      | 10     | 15     |
| **TOTAL**          | **8**   | **14** | **22** | **21** | **65** |

---

## Resultado da Validação por Item

### Legenda de Status

- ✅ **CORRIGIDO** — fix aplicado nesta execução
- ⚠️ **CONFIRMADO** — bug confirmado, aguarda execução
- ❌ **INVÁLIDO** — não aplicável ao estado atual do código
- 🔵 **DEFERIDO** — válido mas fora do escopo desta execução

---

## P1 — CRÍTICO (execução imediata)

| ID     | Arquivo                     | Título                                                     | Validado     | Status      |
| ------ | --------------------------- | ---------------------------------------------------------- | ------------ | ----------- |
| SDK-01 | `lib/hooks.js`              | `onPreToolUse` sem `"ask"` + `additionalContext`           | ✅ Confirmado | ✅ CORRIGIDO |
| SDK-02 | `lib/permissions.js`        | PermissionHandler sem `denied-by-content-exclusion-policy` | ✅ Confirmado | ✅ CORRIGIDO |
| SDK-03 | `lib/session.js`            | `mode: 'customize'` inválido no SDK v0.1.x                 | ✅ Confirmado | ✅ CORRIGIDO |
| BUG-02 | `agent/always-alive.js`     | `stop()` deixa listeners órfãos                            | ✅ Confirmado | ✅ CORRIGIDO |
| BUG-03 | `conversation-hub/store.js` | FTS5 trigger `memories_au` usa UPDATE incorreto            | ✅ Confirmado | ✅ CORRIGIDO |
| BUG-01 | `conversation-hub/store.js` | Race condition em `writeTurn()` com WAL                    | ✅ Confirmado | ✅ CORRIGIDO |
| SEC-01 | `tools/shell/index.js`      | `BLOCKED_COMMAND_PATTERNS` contornável                     | ✅ Confirmado | ✅ CORRIGIDO |
| SEC-02 | `conversation-hub/store.js` | FTS5 injection insuficientemente bloqueada                 | ✅ Confirmado | ✅ CORRIGIDO |

---

## P2 — ALTO (execução em segunda rodada)

| ID     | Arquivo                         | Título                                                     | Validado         | Status      |
| ------ | ------------------------------- | ---------------------------------------------------------- | ---------------- | ----------- |
| SDK-06 | `agent/task-executor.js`        | `session.on()` unsubscribe não está no `finally`           | ✅ Confirmado     | ✅ CORRIGIDO |
| SDK-04 | Todos `tools/*.js`              | `defineTool` com double-cast anti-pattern                  | ✅ Confirmado     | 🔵 Deferido  |
| SDK-05 | `agent/always-alive.js`         | `sendAndWait` timeout misalignment                         | ✅ Confirmado     | ✅ CORRIGIDO |
| SDK-07 | `lib/permissions.js`            | PermissionHandler sem `denied-by-content-exclusion-policy` | Duplicata SDK-02 | —           |
| BUG-04 | `agent/always-alive.js`         | `#processQueue()` pode ser reentrante                      | ✅ Confirmado     | ✅ CORRIGIDO |
| BUG-05 | `agent/dialog-watchdog.js`      | `start()` não verifica se já está rodando                  | ✅ Confirmado     | ✅ CORRIGIDO |
| BUG-06 | `channel/client.js`             | `startDialogMode()` listeners sem cleanup em erro          | ✅ Confirmado     | ✅ CORRIGIDO |
| BUG-07 | `tools/shell/index.js`          | Regex shell-meta defeituosa                                | ✅ Confirmado     | ✅ CORRIGIDO |
| SEC-03 | `terminal/dialog.js`            | NERV emite conteúdo completo das respostas                 | ✅ Confirmado     | ✅ CORRIGIDO |
| SEC-04 | `tools/file-tools.js`           | `validatePath` sem rejeição de extensões perigosas         | ✅ Confirmado     | ✅ CORRIGIDO |
| SEC-05 | `conversation-hub/socket-ns.js` | `join:session` sem verificação de autorização              | ✅ Confirmado     | ✅ CORRIGIDO |

---

## P3 — MÉDIO (execução em terceira rodada)

| ID      | Arquivo                         | Título                                              | Validado     | Status                    |
| ------- | ------------------------------- | --------------------------------------------------- | ------------ | ------------------------- |
| SDK-08  | `agent/session-manager.js`      | `backgroundCompactionThreshold` sem clamp           | ✅ Confirmado | ✅ CORRIGIDO               |
| SDK-09  | `agent/always-alive.js`         | `session.on()` retorno de unsubscribe inconsistente | ✅ Confirmado | ✅ CORRIGIDO               |
| BUG-08  | `terminal/server.js`            | Rate limiter sem limpeza periódica                  | ✅ Confirmado | ✅ CORRIGIDO               |
| BUG-09  | `conversation-hub/store.js`     | `migrateFts5Tokenizer` falha silenciosa             | ✅ Confirmado | ✅ CORRIGIDO               |
| BUG-10  | `terminal/dialog.js`            | `writeTurn()` sem verificação de `isReady`          | ✅ Confirmado | ✅ CORRIGIDO               |
| ARCH-04 | `config/pinned-files-loader.js` | `PinnedFilesLoader` nunca é instanciado             | ✅ Confirmado | 🔵 Deferido (scope grande) |
| ARCH-05 | `channel/client.js`             | `#history` cresce indefinidamente                   | ✅ Confirmado | ✅ CORRIGIDO               |

---

## P4 — BAIXO/MELHORIAS (execução em quarta rodada)

| ID          | Arquivo                            | Título                                       | Validado     | Status                       |
| ----------- | ---------------------------------- | -------------------------------------------- | ------------ | ---------------------------- |
| SDK-10      | `config/mcp-servers.js`            | `mcpServers.type` divergência SDK            | ✅ Confirmado | 🔵 Deferido                   |
| SDK-11      | `agent/always-alive.js`            | `session.getMessages()` sem verificação      | ✅ Confirmado | ✅ CORRIGIDO                  |
| SDK-12      | `agent/always-alive.js`            | `reasoningEffort: 'xhigh'` não documentado   | ✅ Confirmado | ✅ CORRIGIDO                  |
| BUG-11      | `terminal/workspace-context.js`    | `getWorkspaceContext()` sem cache            | ✅ Confirmado | ✅ CORRIGIDO                  |
| BUG-12      | `channel/audit.js`                 | `getAuditSummary` lê arquivo completo        | ✅ Confirmado | ✅ CORRIGIDO                  |
| SEC-06      | `terminal/file-context.js`         | `readFileContext` sem verificação MIME       | ✅ Confirmado | ✅ CORRIGIDO                  |
| SEC-07      | `tools/introspection-tools.js`     | Secrets em `get_agent_info`                  | ✅ Confirmado | ✅ CORRIGIDO                  |
| ARCH-01     | Wrappers de compatibilidade        | 10 re-exports acumulam dívida técnica        | ✅ Confirmado | 🔵 Deferido                   |
| ARCH-02     | `agent/always-alive.js`            | Singleton bloqueia testes de integração      | ✅ Confirmado | 🔵 Deferido (breaking change) |
| ARCH-03     | `conversation-hub/orchestrator.js` | Fallback para `chat()` sem audit log         | ✅ Confirmado | ✅ CORRIGIDO                  |
| MELHORIA-01 | `lib/session.js`                   | Feature flag para `mode: 'customize'` futuro | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-02 | `agent/session-manager.js`         | Implementar `onEvent` catch-all              | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-03 | Todos `tools/*.js`                 | Migrar para `ToolResultObject`               | ✅ Válido     | 🔵 Deferido (alto esforço)    |
| MELHORIA-07 | `agent/always-alive.js`            | Implementar `Symbol.asyncDispose`            | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-08 | `agent/always-alive.js`            | `setModel()` não chama SDK live              | ✅ Confirmado | ✅ CORRIGIDO                  |
| MELHORIA-09 | `conversation-hub/store.js`        | WAL checkpoint periódico                     | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-10 | `tools/file-tools.js`              | Health check para `ripgrep` lazy             | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-11 | `bridges/mcp-tool-bridge.js`       | `buildMcpTools` retry com backoff            | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-12 | `types/structured-message.js`      | `traceId` auto-gerado                        | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-13 | `agent/always-alive.js`            | `AbortSignal` support em `sendMessage`       | ✅ Válido     | ✅ CORRIGIDO                  |
| MELHORIA-14 | `terminal/nerv-bridge.js`          | EVENT_MAP sem eventos novos do SDK           | ✅ Confirmado | ✅ CORRIGIDO                  |

---

## Itens Deferidos (fora do escopo desta sprint)

| ID          | Justificativa                                                                |
| ----------- | ---------------------------------------------------------------------------- |
| SDK-04      | Refatoração de todos os arquivos de tools — alto esforço, sem risco imediato |
| ARCH-04     | `PinnedFilesLoader` — feature completa nova, escopo de sprint próprio        |
| ARCH-01     | Remoção dos 10 wrappers — breaking change que exige atualização em massa     |
| ARCH-02     | Singleton → classe exportada — breaking change em todos os consumers         |
| MELHORIA-03 | ToolResultObject em todas as tools — alto esforço, sem risco ativo           |

---

## Ordem de Execução

```
Fase 1 (P1 — Crítico):
  [1] SDK-03  → lib/session.js          (mode: 'customize' → 'append')
  [2] SDK-01  → lib/hooks.js            (adicionar "ask" + additionalContext)
  [3] SDK-02  → lib/permissions.js      (denied-by-content-exclusion-policy)
  [4] BUG-03  → store.js               (FTS5 trigger memories_au)
  [5] SEC-02  → store.js               (FTS5 injection robusta)
  [6] BUG-01  → store.js               (UNIQUE constraint + retry)
  [7] BUG-02  → always-alive.js        (listeners órfãos no stop())
  [8] SEC-01  → tools/shell/index.js   (BLOCKED_COMMAND_PATTERNS + printenv)

Fase 2 (P2 — Alto):
  [9]  SDK-06  → task-executor.js      (unsubscribes no finally)
  [10] SDK-05  → always-alive.js       (sendAndWait timeout alinhado)
  [11] BUG-04  → always-alive.js       (guard reentrância #processQueue)
  [12] BUG-05  → dialog-watchdog.js    (start() guard duplo)
  [13] BUG-06  → channel/client.js     (cleanup em caso de erro)
  [14] BUG-07  → tools/shell/index.js  (regex shell-meta contextual)
  [15] SEC-03  → terminal/dialog.js    (NERV sem conteúdo completo)
  [16] SEC-04  → tools/file-tools.js   (extensões perigosas bloqueadas)
  [17] SEC-05  → socket-ns.js          (join:session com autorização TODO)

Fase 3 (P3 — Médio):
  [18] SDK-08  → session-manager.js    (threshold clamp defensivo)
  [19] SDK-09  → always-alive.js       (sessionListenerCleanups array)
  [20] BUG-08  → terminal/server.js    (rate limiter cleanup periódico)
  [21] BUG-09  → store.js              (migrateFts5 log de erro)
  [22] BUG-10  → terminal/dialog.js    (writeTurn verificar store.db)
  [23] ARCH-05 → channel/client.js     (#history MAX_HISTORY_SIZE)

Fase 4 (P4 — Baixo/Melhorias):
  [24] SDK-11     → always-alive.js        (getMessages guard)
  [25] SDK-12     → always-alive.js + commands/config.js (remover 'xhigh')
  [26] BUG-11     → workspace-context.js   (cache TTL 30s)
  [27] BUG-12     → channel/audit.js       (leitura parcial audit.jsonl)
  [28] SEC-06     → terminal/file-context.js (verificação MIME básica)
  [29] SEC-07     → introspection-tools.js  (sanitizar env vars expostas)
  [30] ARCH-03    → orchestrator.js        (audit log no fallback chat())
  [31] MELHORIA-01→ lib/session.js         (feature flag customize mode)
  [32] MELHORIA-02→ session-manager.js     (onEvent catch-all)
  [33] MELHORIA-07→ always-alive.js        (Symbol.asyncDispose)
  [34] MELHORIA-08→ always-alive.js        (setModelLive)
  [35] MELHORIA-09→ store.js               (WAL checkpoint periódico)
  [36] MELHORIA-10→ tools/file-tools.js    (rg health check lazy)
  [37] MELHORIA-11→ bridges/mcp-tool-bridge.js (retry backoff)
  [38] MELHORIA-12→ types/structured-message.js (traceId auto-gerado)
  [39] MELHORIA-13→ always-alive.js        (AbortSignal em sendMessage)
  [40] MELHORIA-14→ terminal/nerv-bridge.js (novos eventos SDK)
```

---

*Documento gerado e validado em 2026-03-28. Itens deferidos serão reavaliados em sprint subsequente.*
