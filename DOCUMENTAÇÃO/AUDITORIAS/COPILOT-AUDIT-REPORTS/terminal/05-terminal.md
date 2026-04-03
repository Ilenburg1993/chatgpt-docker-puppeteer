# Auditoria Consolidada — Módulo `terminal/`

**Módulo**: `src/copilot/terminal/` **Fase**: F09 — Terminal Permanente LLM-B **Arquivos**: 14 |
**LOC Total**: 3321 **Data**: 2026-06-10 **Auditor**: Copilot Full-Audit MF-II

---

## 1. Visão Geral do Módulo

O módulo `terminal/` implementa o **Terminal Permanente LLM-B** — um servidor HTTP embutido
(porta 3009) com REPL readline, dialog loop persistente, gestão de sessões e interface SSE/Socket.io
para o dashboard. É o ponto de entrada do processo do agente LLM-B dentro do container.

### Responsabilidades centrais

| Área                  | Arquivos                                                        | LOC |
| --------------------- | --------------------------------------------------------------- | --- |
| Motor de diálogo      | `dialog.js`                                                     | 615 |
| Handlers HTTP         | `handlers-system.js`, `handlers-agent.js`, `handlers-dialog.js` | 883 |
| Servidor HTTP         | `server.js`                                                     | 344 |
| REPL readline         | `repl.js`                                                       | 340 |
| Contexto de arquivos  | `file-context.js`                                               | 351 |
| Orquestração          | `index.js`                                                      | 245 |
| Tabela de rotas       | `route-table.js`                                                | 214 |
| Estado compartilhado  | `state.js`                                                      | 143 |
| Contexto de workspace | `workspace-context.js`                                          | 82  |
| Barrels e boilerplate | `http-handlers.js`, `bootstrap.js`, `handlers-shared.js`        | 104 |

---

## 2. Arquitetura do Módulo

```
bootstrap.js (entry: isMain)
    └── startTerminalServer() ← index.js
         ├── DI: setHub, setBridgeAgent, setPermissionAgent, setFallbackAgent
         ├── PinnedFilesLoader (.github/skills, .github/instructions)
         ├── createInjectServer() ← server.js
         │    ├── ROUTE_TABLE ← route-table.js
         │    ├── Auth (timingSafeEqual) + Rate limiters
         │    └── Dispatch → http-handlers.js (barrel)
         │         ├── handlers-agent.js   (/inject, /pipeline, /context)
         │         ├── handlers-dialog.js  (/sessions, /memory, /hub-health)
         │         └── handlers-system.js  (/health, /config, /metrics, /git, /gh)
         ├── conversationHub.store.init() + createHubSession()
         ├── registerAgentEventListeners() ← events → broadcastSse
         │    └── dialog.js (broadcastSse, ensureDialogLoop, sendTurn)
         ├── startReflectionLoop() (optional)
         └── startRepl(injectServer) ← repl.js
              ├── CMD_ROUTES dispatch
              └── rl.on('line') → sendTurn | extractAtReferences + addAttachment

state.js  ←  shared mutable state (hubSessionId, busy, sseClients, attachmentQueue)
workspace-context.js  ←  cwd/gitRoot/branch (30s TTL cache)
file-context.js  ←  file read/embed/cache (30s TTL, MAX_EMBED_BYTES)
```

---

## 3. Tabela Consolidada de Achados

| ID   | Arquivo                | Severidade | Título                                                                                                       |
| ---- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| T-01 | `dialog.js`            | P4         | Polling loop `_tryStartDialogLoop` continua após rejeição                                                    |
| T-02 | `dialog.js`            | P4         | `_executeTurn` errors silenciados via `.catch(() => null)`                                                   |
| T-03 | `dialog.js`            | P4         | SSE clientes mortos detectados apenas na próxima escrita                                                     |
| T-04 | `server.js`            | P4         | Ausência de handler `OPTIONS` para CORS preflight                                                            |
| T-05 | `repl.js`              | P4         | `_cmdRestart` race condition com `dialog.ready`                                                              |
| T-06 | `handlers-agent.js`    | P4         | `handlePipeline` `waitMs` sem limite superior                                                                |
| T-07 | `handlers-agent.js`    | P4         | Errors em attachments mascarados como inline strings                                                         |
| T-08 | `handlers-dialog.js`   | P4         | `handleHubHealth` faz dois full scans com `limit:1000`                                                       |
| T-09 | `handlers-system.js`   | P4         | `readSkillsConfig`/`writeSkillsConfig` usam sync I/O                                                         |
| T-10 | `handlers-system.js`   | P4         | `_infiniteSessionConfig` não persiste entre restarts                                                         |
| T-11 | `file-context.js`      | P4         | `extractAtReferences` corresponde a emails (`@domain.tld`)                                                   |
| T-12 | `file-context.js`      | P4         | `readDirectoryContext` leitura sequencial (não paralela)                                                     |
| T-13 | `file-context.js`      | P4         | Blobs binários decodificados como UTF-8 sem verificar mimeType                                               |
| T-14 | `index.js`             | P4         | `registerAgentEventListeners` acumula se chamada N vezes                                                     |
| T-15 | `index.js`             | P4         | Watchdog `dialog.stopped` ignora `dialogPaused` state                                                        |
| T-16 | `route-table.js`       | P4         | Ausência de rota `OPTIONS` (complementa T-04)                                                                |
| T-17 | `workspace-context.js` | P4         | `detectGitRoot` sempre chama `execSync` em non-git dirs                                                      |
| T-18 | `server.js`            | P5         | `timingSafeEqual` dependente de `&&` short-circuit` **[INVESTIGADO — já usa padEnd; comportamento correto]** |
| T-19 | `server.js`            | P5         | Rate limiter em memória — perdido a cada restart                                                             |
| T-20 | `index.js`             | P5         | `reflectionTimer` sem referência armazenada (não cancelável) **[FIXED]**                                     |
| T-21 | `index.js`             | P5         | Sem handler `SIGTERM`/`SIGINT` para shutdown gracioso **[FIXED]**                                            |
| T-22 | `state.js`             | P5         | `_attachmentQueue` sem limite de tamanho **[FIXED — MAX_ATTACHMENT_QUEUE=50]**                               |
| T-23 | `state.js`             | P5         | `setMaxListeners(20)` hardcoded **[FIXED — via TERMINAL_MAX_LISTENERS env]**                                 |
| T-24 | `handlers-agent.js`    | P5         | `ALLOWED_FROM` contém ambas formas `llm-a`/`llm_a` **[INVESTIGADO — intencional]**                           |
| T-25 | `handlers-dialog.js`   | P5         | Parâmetro `status` não validado em `handleListSessions` **[FIXED]**                                          |
| T-26 | `handlers-dialog.js`   | P5         | `handleListTurns` sem `totalCount` na paginação                                                              |
| T-27 | `repl.js`              | P5         | Ctrl+C não cancela turno em andamento                                                                        |
| T-28 | `workspace-context.js` | P5         | `execSync` bloqueia event loop (mitigado por TTL 30s)                                                        |
| T-29 | `dialog.js`            | P5         | Constante de truncamento SSE 64k inline (não compartilhada)                                                  |
| T-30 | `handlers-system.js`   | P5         | `handleHealth` chama DB em cada health check (sem cache)                                                     |

**Total**: 17x P4, 13x P5

---

## 4. Análise de Risco por Área

### 4.1 Dialog Loop (Alta integridade operacional)

`dialog.js` é o componente mais crítico. O mutex TERM-01 e o coalescimento DL-PERM-02 são
implementações robustas com múltiplas melhorias aplicadas (BUG-N05, BUG-N07, BUG-N11, PERF-N06,
SEC-VULN-02). O risco residual principal (T-01, polling não-cancelável) é de baixo impacto em
operação normal.

### 4.2 Servidor HTTP (Boa cobertura de segurança)

`server.js` trata bem autenticação (timingSafeEqual, SEC-04), rate limiting (3 limiters, GAP-01),
payload limit (2MB). O gap mais relevante é a ausência de handler OPTIONS (T-04/T-16) que pode
causar falhas de preflight CORS em clientes de dashboard.

### 4.3 Handlers (Boa qualidade, algumas omissões de UX)

Os handlers são thin layers que delegam para stores e para `sendTurn`. Os achados P4 são
principalmente de UX e performance: `handleHubHealth` O(n) desnecessário (T-08), sync I/O em skills
(T-09), `waitMs` sem cap em pipeline (T-06).

### 4.4 File Context (Funcional, oportunidades de robustez)

`file-context.js` tem o regex de extração de `@references` que pode false-positive em emails (T-11)
— isso pode frustrar usuários. O sequential read em directory (T-12) é oportunidade de perf fácil.

---

## 5. Top 5 Correções Prioritárias

| Prioridade | Achado                                                                  | Impacto                                                      |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1          | **T-04/T-16** — Adicionar handler `OPTIONS` para preflight CORS         | Desbloqueia requests do dashboard com `Authorization` header |
| 2          | **T-15** — Watchdog `dialog.stopped` verificar `dialogPaused`           | Previne restart indesejado quando loop está pausado          |
| 3          | **T-05** — `_cmdRestart` registrar `once('dialog.ready')` ANTES do stop | Race condition que pode causar timeout de 30s                |
| 4          | **T-08** — `handleHubHealth` usar `COUNT(*)` ao invés de `limit:1000`   | Reduz carga em health checks frequentes                      |
| 5          | **T-11** — `extractAtReferences` excluir pattern de email               | Prevents false-positive attachment de `@domain.tld`          |

---

## 6. Boas Práticas Identificadas

- TERM-01 (mutex Promise-chain) — padrão elegante para serialização sem Locks
- DL-PERM-02 (coalescimento de `ensureDialogLoop`) — previne boot duplo em race
- BUG-N05/N11/N07 — série de bug fixes aplicados com comentários de rastreabilidade
- PinnedFilesLoader no boot — contexto rico para LLM-B from first turn
- `state.js` com defensive copy em `getAttachmentQueue()` — proteção contra aliasing
- `route-table.js` declarativa com `skipAuth` auditável — boa visibilidade de superfície de
  segurança
- `workspace-context.js` com env override `COPILOT_WORKING_DIRECTORY` — testável
- `bootstrap.js` isMain guard ESM — padrão correto para dual use (import vs exec)

---

## 7. Score do Módulo

| Dimensão             | Nota       |
| -------------------- | ---------- |
| Correção lógica      | 8.0/10     |
| Segurança            | 8.0/10     |
| Performance          | 7.5/10     |
| Observabilidade      | 8.5/10     |
| Manutenibilidade     | 8.0/10     |
| **Global terminal/** | **8.0/10** |

---

## 8. Arquivos Auditados

| Arquivo                | LOC | MD Individual                | Score   |
| ---------------------- | --- | ---------------------------- | ------- |
| `dialog.js`            | 615 | `dialog-audit.md`            | 8.5/10  |
| `handlers-system.js`   | 484 | `handlers-system-audit.md`   | 8.0/10  |
| `file-context.js`      | 351 | `file-context-audit.md`      | 7.7/10  |
| `server.js`            | 344 | `server-audit.md`            | 8.4/10  |
| `repl.js`              | 340 | `repl-audit.md`              | 8.0/10  |
| `handlers-agent.js`    | 245 | `handlers-agent-audit.md`    | 7.2/10  |
| `index.js`             | 245 | `terminal-index-audit.md`    | 7.3/10  |
| `route-table.js`       | 214 | `route-table-audit.md`       | 8.8/10  |
| `handlers-dialog.js`   | 154 | `handlers-dialog-audit.md`   | 7.0/10  |
| `state.js`             | 143 | `state-audit.md`             | 8.2/10  |
| `workspace-context.js` | 82  | `workspace-context-audit.md` | 8.2/10  |
| `http-handlers.js`     | 48  | `http-handlers-audit.md`     | 9.0/10  |
| `bootstrap.js`         | 40  | `bootstrap-audit.md`         | 9.2/10  |
| `handlers-shared.js`   | 16  | `handlers-shared-audit.md`   | 10.0/10 |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II. Fase F09 COMPLETA._
