# Auditoria de Refatoração — `src/copilot`

**Data:** 2026-06-22
**Escopo:** Todos os 96 arquivos JS de `src/copilot/`
**Abordagem:** Leitura integral de cada arquivo + análise acumulativa de padrões
**Compromisso:** Nenhuma alteração de código foi realizada — apenas documentação de oportunidades

---

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Inventário de Arquivos](#2-inventário-de-arquivos)
3. [Catálogo de Problemas de Refatoração (RF-001 a RF-055)](#3-catálogo-de-problemas)
4. [Análise por Domínio](#4-análise-por-domínio)
5. [Padrões Transversais](#5-padrões-transversais)
6. [Mapa de Prioridades](#6-mapa-de-prioridades)
7. [Propostas de Refatoração Detalhadas](#7-propostas-detalhadas)
8. [Riscos e Dependências](#8-riscos-e-dependências)
9. [Critérios de Done](#9-critérios-de-done)

---

## Status de Implementação

**Última atualização:** 2026-06-23
**Total:** 55 RFs catalogados | ✅ 51 concluídos | ⏭️ 4 skipados | ❌ 0 pendentes

### Legenda
- ✅ **CONCLUÍDO** — implementado e verificado (lint 0 erros)
- ⏭️ **SKIP** — decisão arquitetural de não implementar (motivo documentado)
- ❌ **PENDENTE** — ainda não implementado

### Tabela completa

| RF         | Arquivo                            | Título                                              | Status | Notas                                                                  |
| ---------- | ---------------------------------- | --------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| RF-001     | `agent/always-alive.js`            | Dupla inicialização de sessão                       | ✅      | `#initSession()` extraído                                              |
| RF-002     | `agent/always-alive.js`            | Lógica de retry duplicada                           | ✅      | `#waitForDialogRestartAndAnswer()` extraído                            |
| RF-003     | `conversation-hub/orchestrator.js` | Acoplamento ao singleton                            | ✅      | Injeção via construtor                                                 |
| RF-004     | `conversation-hub/orchestrator.js` | Método 200+ linhas (3 caminhos)                     | ✅      | Extraídos 3 submétodos privados                                        |
| RF-005     | `agent/session-manager.js`         | FS síncrono                                         | ✅      | Convertido para `fs/promises`                                          |
| RF-006     | `conversation-hub/store.js`        | SQL LIKE metachar injection                         | ✅      | Escape de metacaracteres + parametrização                              |
| RF-007     | `lib/client.js`                    | Estado de módulo — classe CopilotClientManager      | ⏭️      | Regra arquitetural "sem classes públicas" em lib/                      |
| RF-008     | `lib/utils.js`                     | `pickDefined()` helper                              | ✅      | Criado `lib/utils.js`; usado em routes/sessions.js                     |
| RF-009/010 | `lib/hooks.js`                     | `createHooks()` 200 linhas                          | ✅      | Extraídos `buildPreToolUseHandler()` + `buildErrorOccurredHandler()`   |
| RF-011     | `lib/tools-registry.js`            | 3 métodos de filtragem quase-iguais                 | ✅      | `getToolsBy(predicate)` extraído                                       |
| RF-012     | `tools/todo-tools.js`              | `priorityOrder` definido 3×                         | ✅      | Constante `PRIORITY_ORDER` no topo do módulo                           |
| RF-013     | `tools/todo-tools.js`              | `todoAddSubtaskTool` duplica `todoCreateTool`       | ✅      | `createTaskInternal()` extraído                                        |
| RF-014     | `terminal/http-handlers.js`        | `ALLOWED_FROM` duplicado                            | ✅      | Constante top-level                                                    |
| RF-015     | `routes/sessions.js`               | Memory leak no rate-limiter                         | ✅      | `setInterval` de purge adicionado                                      |
| RF-016     | (absorvido)                        | `pickDefined` spread — absorvido RF-008             | ✅      | —                                                                      |
| RF-017     | `terminal/server.js`               | Chain 250 linhas if/else rotas                      | ⏭️      | Alto risco de regressão sem cobertura E2E                              |
| RF-018     | `terminal/server.js`               | Dois rate-limiters duplicados                       | ✅      | `createRateLimiter()` factory extraído                                 |
| RF-019     | `bridges/gh-bridge.js`             | Paginação triplicada                                | ✅      | `paginate()` helper extraído                                           |
| RF-020     | `bridges/gh-bridge.js`             | `watchRun()` sem guarda de iterações                | ✅      | Parâmetro `maxAttempts` adicionado                                     |
| RF-021     | `tools/tool-factory.js`            | `buildTool` vs `defineTool` sem docs                | ✅      | JSDoc de módulo adicionado com orientação de uso                       |
| RF-022     | `terminal/dialog.js`               | `broadcastSse()` mescla SSE e Socket.io             | ✅      | `emitSse()` e `emitSocket()` separados                                 |
| RF-023     | `channel/client.js`                | Cleanup assimétrico de listeners                    | ✅      | `#registerDialogListeners()` + `#removeDialogListeners()`              |
| RF-024     | `channel/inject.js`                | Loop SSE duplicado                                  | ✅      | `_subscribeSse()` helper extraído                                      |
| RF-025     | `tools/session-rpc-tools.js`       | 8 tools com padrão repetido                         | ✅      | `wrapRpc()` helper extraído                                            |
| RF-026     | `tools/introspection-tools.js`     | `prefixMap` hardcoded em `list_tools`               | ✅      | Derivado do registry de tools                                          |
| RF-027     | `bridges/mcp-tool-bridge.js`       | Estado de módulo não resetável                      | ✅      | `_resetMcpState()` exportado                                           |
| RF-028     | `tools/web-tools.js`               | DDG regex brittle sem documentação                  | ✅      | Comentário de aviso adicionado                                         |
| RF-029     | `tools/hook-tools.js`              | Race condition singleton resolver                   | ✅      | Map `_pendingInputResolvers` com requestId                             |
| RF-030     | `tools/hook-tools.js`              | `readFileSync` no event loop                        | ✅      | Convertido para `readFile` async                                       |
| RF-031     | `tools/git/index.js`               | `execSync` bloqueante em git tools                  | ✅      | Convertido para `execFileAsync`                                        |
| RF-032     | `tools/session-tools.js`           | FS síncrono em handlers de tools                    | ✅      | Convertido para `fs/promises`                                          |
| RF-033     | `tools/session-tools.js`           | `SESSION_CONTEXT_STORE` efêmero sem docs            | ✅      | JSDoc explicando natureza efêmera adicionado                           |
| RF-034     | `lib/http-request.js`              | `httpRequest()` duplicado em 2 módulos              | ✅      | Criado `lib/http-request.js` compartilhado                             |
| RF-035     | `routes/middleware.js`             | `withErrorHandler()` duplicado                      | ✅      | Criado `routes/middleware.js`                                          |
| RF-036     | `routes/agent.js`                  | Rota `/telemetry` duplicada                         | ✅      | Rota duplicada removida; único handler                                 |
| RF-037     | `terminal/index.js`                | `startTerminalServer()` com 227 linhas de listeners | ✅      | `registerAgentEventListeners()` + `startReflectionLoop()` extraídos    |
| RF-038     | `terminal/commands/gh.js`          | `cmdGh()` 338 linhas repetitivas                    | ✅      | Dispatch table `SUBCOMMAND_HANDLERS` + 7 handlers                      |
| RF-039     | `bridges/nerv-bridge.js`           | Estado de módulo não resetável                      | ✅      | `_resetNervBridgeState()` exportado                                    |
| RF-040     | `config/tools/registry.js`         | Auto-init + estado não resetável                    | ✅      | `_resetRegistry()` exportado                                           |
| RF-041     | `terminal/workspace-context.js`    | `execSync` em `tryExec()`                           | ⏭️      | Usado apenas no startup, não em hot path                               |
| RF-042     | `bridges/alias-store.js`           | Auto-init `loadAliases()` no import                 | ✅      | Auto-call removido; chamada explícita em `terminal/index.js`           |
| RF-043     | `agent/entry.js`                   | `startWithRetry` recursivo                          | ✅      | Convertido para loop `for` com `MAX_ATTEMPTS`                          |
| RF-044     | `agent/entry.js`                   | Exit code incorreto                                 | ✅      | `process.exitCode` setado antes de `process.exit()`                    |
| RF-045     | `config/pinned-files-loader.js`    | `readFileSync` no callback do watcher               | ✅      | `readFile` async (fs/promises) em `#loadFile` e `#scheduleReload`     |
| RF-046     | `api/bridge-dialog.js`             | Timeout hardcoded com valores mágicos               | ✅      | `MIN_DIALOG_TIMEOUT_MS` + `MAX_DIALOG_TIMEOUT_MS`                      |
| RF-047     | `config/session-config.js`         | `DEFAULT_EXCLUDED_TOOLS` sem docs                   | ✅      | JSDoc com racional por entrada                                         |
| RF-048     | `lib/models.js`                    | Cache de models sem purge em erro                   | ✅      | Cache nullificado em catch; força retry na próxima chamada             |
| RF-049     | `tools/task-tools.js`              | Dynamic imports desnecessários                      | ✅      | Convertidos para imports estáticos no topo                             |
| RF-050     | `terminal-server.js`               | `isMain` check frágil                               | ✅      | Idioma canônico ESM com `fileURLToPath`                                |
| RF-051     | `agent/entry.js`                   | Signal race condition — `startWithRetry` sem await  | ✅      | Promise salva + `.catch()` com `process.exitCode = 1`                  |
| RF-052     | `agent.js`                         | Arquivo `@deprecated` sem remoção programada        | ✅      | JSDoc atualizado com data e confirmação de 0 dependentes em 2026-06-23 |
| RF-053     | `agent/webhook-manager.js`         | Dynamic imports de `http`/`https`                   | ✅      | Convertidos para imports estáticos no topo do módulo                   |
| RF-054     | `terminal/workspace-context.js`    | `getWorkspaceContext()` não cacheado                | ✅      | Cache com TTL 30s adicionado; invalida automaticamente                 |
| RF-055     | `terminal/commands/skills.js`      | `reload` sem implementação real                     | ✅      | Mensagem honesta sobre limitação; orientação correta ao usuário        |

---

### Próximas etapas

**Todos os 55 RFs foram implementados (50 concluídos, 5 skipados com justificativa arquitetural documentada).**

Os 5 itens skipados permanecem como decisões conscientes:
- **RF-007** — `lib/client.js`: regra "sem classes públicas" em `lib/`
- **RF-017** — `terminal/server.js`: alto risco de regressão sem cobertura E2E
- **RF-041** — `terminal/workspace-context.js`: execSync apenas no startup, não em hot path
- **RF-045** — absorvido por RF-032/RF-045: `readFile` async implementado em `pinned-files-loader.js`
- **RF-016** — absorvido por RF-008

---


Após leitura completa de todos os 96 arquivos JS em `src/copilot`, foram identificados **55 problemas de refatoração** (RF-001 a RF-055), distribuídos em 6 categorias de severidade.

### Distribuição por severidade

| Severidade | Qtd | Impacto                                       |
| ---------- | --- | --------------------------------------------- |
| CRÍTICO    | 2   | Segurança, corretude ou confiabilidade graves |
| ALTO       | 8   | Custo de manutenção muito elevado, bugs reais |
| MÉDIO      | 21  | Duplicação significativa, risco de regressão  |
| BAIXO      | 24  | Oportunidades de limpeza e consistência       |

### Top 5 problemas mais impactantes

1. **RF-006** — Injeção de metacaracteres SQL em `store.js` (LIKE sem escape) — risco de corrupção de dados
2. **RF-001/002** — Duplicação massiva em `always-alive.js` (1510 linhas, lógica de sessão e retry duplicadas)
3. **RF-004** — Método `#executeSendToLlmB()` com 200+ linhas e 3 caminhos de código embutidos
4. **RF-031** — `tools/git/index.js` usa `execSync` — bloqueia o event loop em todas as operações git de tools
5. **RF-029** — Singleton `_pendingInputResolver` em `hook-tools.js` — requisições concorrentes silenciosamente sobrescrevem a anterior

---

## 2. Inventário de Arquivos

### 2.1 — Mapa de tamanho e responsabilidade

| Arquivo                                                                              | Linhas | Responsabilidade                                     | Complexidade |
| ------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------- | ------------ |
| `agent/always-alive.js`                                                              | 1510   | Core do agente — sessão, retry, dialog loop, eventos | ⚠️ ALTA       |
| `tools/todo-tools.js`                                                                | 1167   | CRUD de tasks + subtasks todo list                   | MÉDIA        |
| `terminal/http-handlers.js`                                                          | 794    | Handlers HTTP crus do servidor terminal              | MÉDIA        |
| `tools/file-tools.js`                                                                | 761    | Ferramentas de filesystem (read/write/list)          | MÉDIA        |
| `bridges/gh-bridge.js`                                                               | 735    | Bridge GitHub CLI — issues, PRs, runs, releases      | MÉDIA        |
| `conversation-hub/store.js`                                                          | 906    | Store SQLite hub — turnos, sessões, memórias         | ALTA         |
| `routes/sessions.js`                                                                 | 654    | Rotas HTTP de sessões SDK                            | MÉDIA        |
| `terminal/dialog.js`                                                                 | 529    | SSE + Socket.io dialog loop do terminal              | ALTA         |
| `lib/hooks.js`                                                                       | 338    | Factories de SessionHooks (preToolFn, postToolFn)    | ALTA         |
| `channel/inject.js`                                                                  | 476    | Injeção SSE de mensagens LLM-A → LLM-B               | ALTA         |
| `tools/shell/index.js`                                                               | 598    | Shell tools com segurança extensa                    | ALTA         |
| `conversation-hub/orchestrator.js`                                                   | 490    | Orquestração de missões hub                          | ALTA         |
| `terminal/server.js`                                                                 | 573    | Servidor HTTP terminal LLM-B                         | ALTA         |
| `channel/client.js`                                                                  | 525    | Cliente SSE do canal LLM-B                           | ALTA         |
| `lib/telemetry.js`                                                                   | 402    | Telemetria leve de chamadas de ferramentas           | BAIXA        |
| `bridges/git-bridge.js`                                                              | 401    | Bridge git — status, log, diff, branch               | BAIXA        |
| `lib/client.js`                                                                      | 425    | Gerenciamento singleton do CopilotClient             | MÉDIA        |
| `lib/hooks.js`                                                                       | 338    | Factories de hooks                                   | ALTA         |
| `agent/session-manager.js`                                                           | 345    | Persistência de estado de sessão no disco            | MÉDIA        |
| `terminal/repl.js`                                                                   | 323    | Dispatcher de comandos REPL (switch ~40 casos)       | BAIXA        |
| `tools/session-rpc-tools.js`                                                         | 302    | 8 tools wrapper sobre session-rpc                    | MÉDIA        |
| `bridges/mcp-tool-bridge.js`                                                         | 310    | Circuit breaker para MCP tools                       | MÉDIA        |
| `config/custom-agents.js`                                                            | 322    | Configuração de agentes builtin e SDK                | BAIXA        |
| `tools/introspection-tools.js`                                                       | 267    | Meta-ferramentas de introspecção                     | BAIXA        |
| `lib/permissions.js`                                                                 | 250    | Factories de PermissionHandler                       | BAIXA        |
| `tools/hook-tools.js`                                                                | 250    | Tools de hook — input, tasks, skills                 | MÉDIA        |
| `lib/tools-registry.js`                                                              | 253    | Registry de Custom Tools                             | BAIXA        |
| `lib/session.js`                                                                     | 270    | Operações de sessão SDK                              | BAIXA        |
| `types/structured-message.js`                                                        | 346    | StructuredMessage schema e builders                  | BAIXA        |
| `terminal/file-context.js`                                                           | 328    | Embeds de arquivos no contexto                       | BAIXA        |
| `tools/web-tools.js`                                                                 | 337    | HTTP tools com proteção SSRF                         | MÉDIA        |
| `tools/hub-tools.js`                                                                 | 337    | Tools de comunicação hub                             | BAIXA        |
| `terminal/commands/gh.js`                                                            | 338    | Comando /gh — issues, PRs, runs, releases            | MÉDIA        |
| `terminal/index.js`                                                                  | 227    | Boot do servidor terminal                            | ALTA         |
| `routes/agent.js`                                                                    | 219    | Rotas HTTP do agente SDK                             | BAIXA        |
| `routes/client.js`                                                                   | 206    | Rotas HTTP de cliente SDK                            | BAIXA        |
| `terminal/commands/session.js`                                                       | 210    | Comandos de sessão do REPL                           | BAIXA        |
| `bridges/nerv-bridge.js`                                                             | 233    | Ponte EventBus NERV ↔ AlwaysAliveAgent               | BAIXA        |
| `config/system-prompt.js`                                                            | 217    | Constantes e builders de system prompt               | BAIXA        |
| `config/session-config.js`                                                           | 181    | Builders de configuração de sessão                   | BAIXA        |
| `config/pinned-files-loader.js`                                                      | 234    | Loader de arquivos pinned com watch                  | BAIXA        |
| `api/bridge-control.js`                                                              | 241    | Rotas de controle do agent (start/stop/health)       | BAIXA        |
| `config/tools/registry.js`                                                           | 241    | Registry de custom tools declarativas                | BAIXA        |
| `bridges/alias-store.js`                                                             | 164    | Store de aliases de comando                          | BAIXA        |
| `channel/audit.js`                                                                   | 169    | Auditoria assíncrona de tool calls                   | BAIXA        |
| `conversation-hub/hub.js`                                                            | 243    | ConversationHub singleton                            | BAIXA        |
| `tools/git/index.js`                                                                 | 213    | Git tools — git_status, git_log, git_commit          | ⚠️ MÉDIA      |
| `tools/session-tools.js`                                                             | 174    | Session tools — context, skills                      | BAIXA        |
| `tools/task-tools.js`                                                                | 202    | Task tools — queue + system health                   | BAIXA        |
| `tools/tool-factory.js`                                                              | 152    | Factory de tools (buildTool/defineTool)              | BAIXA        |
| `tools/code-tools.js`                                                                | 131    | Code tools — lint, test, typecheck                   | BAIXA        |
| `tools/permission-tools.js`                                                          | 132    | Permission tools — get/set mode                      | BAIXA        |
| `tools/index.js`                                                                     | 69     | Barrel de tools                                      | BAIXA        |
| ... (outros 40+ arquivos < 100 linhas são barrels, configs simples e classes limpas) |        |                                                      |

---

## 3. Catálogo de Problemas

> **Legenda de severidade:** 🔴 CRÍTICO | 🟠 ALTO | 🟡 MÉDIO | 🔵 BAIXO

---

### Bloco A — Segurança e Corretude

#### RF-006 🔴 CRÍTICO — Metacaracteres SQL em LIKE sem escape
**Arquivo:** `conversation-hub/store.js`
**Problema:** A query `WHERE sdk_turn_id LIKE '%${sdkTurnId}%'` não escapa `%` e `_` do valor `sdkTurnId`. Se um `sdkTurnId` contiver esses caracteres (possível em IDs externos), a query retornará linhas incorretas ou poderá ser abusada para varrer toda a tabela.
**Proposta:** Usar parametrização estrita e escapar metacaracteres antes do LIKE, ou converter para consulta exata (`=`) quando possível.

```js
// Atual — inseguro
db.prepare(`SELECT * FROM turns WHERE sdk_turn_id LIKE '%${sdkTurnId}%'`)

// Proposta — escapar metacaracteres
const escaped = sdkTurnId.replace(/%/g, '\\%').replace(/_/g, '\\_');
db.prepare(`SELECT * FROM turns WHERE sdk_turn_id LIKE ? ESCAPE '\\'`)
  .all(`%${escaped}%`);
```

---

#### RF-029 🔴 CRÍTICO — Singleton de callback em hook-tools.js (race condition)
**Arquivo:** `tools/hook-tools.js`
**Problema:** `_pendingInputResolver` é uma variável de módulo que armazena exatamente um callback de resolve. Se dois turnos fizerem uso da ferramenta `hook_wait_for_input` simultaneamente, o segundo callback sobrescreve o primeiro — o primeiro turno nunca recebe resposta, ficando pendente indefinidamente até o timeout.
**Proposta:** Substituir o singleton por uma fila (Map indexed por requestId único), ou rejeitar imediatamente se já há uma entrada pendente, com mensagem de erro clara.

```js
// Atual — singleton (inseguro para concorrência)
let _pendingInputResolver = null;

// Proposta — fila com requestId
const _pendingInputResolvers = new Map(); // requestId → resolve
// Cada chamada gera UUID único e retorna o requestId ao caller
```

---

### Bloco B — Duplicação de Lógica de Alto Impacto

#### RF-001 🟠 ALTO — Dupla inicialização de sessão em `always-alive.js`
**Arquivo:** `agent/always-alive.js`
**Problema:** A sequência de criação de sessão (bootstrap de tools, registro de hooks, handlers de eventos, setup do dialog loop) aparece tanto em `start()` quanto em `#tryReconnect()`. Qualquer mudança na lógica de boot deve ser replicada nos dois locais.
**Proposta:** Extrair método privado `#initSession()` que encapsula toda a sequência e é chamado por ambos.

---

#### RF-002 🟠 ALTO — Lógica de retry duplicada em `always-alive.js`
**Arquivo:** `agent/always-alive.js`
**Problema:** A lógica de espera e reenvio após falha no dialog loop (DL-PERM-05) está duplicada em dois branches de `#executeDialogTurn()`. Cada branch faz: `await waitForDialogReady()` → `await sendTurn()`, com mesma estrutura de try/catch.
**Proposta:** Extrair método `#waitForDialogRestartAndAnswer(message, role)` chamado por ambos os branches.

---

#### RF-004 🟠 ALTO — Método `#executeSendToLlmB()` com 200+ linhas (3 caminhos embutidos)
**Arquivo:** `conversation-hub/orchestrator.js`
**Problema:** O método concentra três caminhos de execução completamente distintos (dialog loop, structured message via RPC, simple chat) em um único corpo. Cada caminho tem seu próprio try/catch, lógica de retry e formatação de resposta. O método é ilegível e extremamente difícil de testar ou modificar com segurança.
**Proposta:** Extrair três métodos privados independentes:
- `#callViaDialogLoop(message, opts)`
- `#callViaStructuredRpc(message, opts)`
- `#callViaSimpleChat(message, opts)`

`#executeSendToLlmB()` passa a ser apenas o dispatcher entre eles.

---

#### RF-019 🟠 ALTO — Paginação triplicada em `bridges/gh-bridge.js`
**Arquivo:** `bridges/gh-bridge.js`
**Problema:** Os métodos `listIssues()`, `listPrs()` e `listRuns()` possuem bloco `while(page <= maxPages)` com chamada ao GitHub API idêntico ao corpo uns dos outros. Qualquer bug de paginação (ex: off-by-one, max-pages handling) deve ser corrigido em 3 lugares.
**Proposta:** Extrair função `paginate(fetchPage, pageSize, page)` reutilizável.

```js
async function paginate(fetchPage, { pageSize = 20, maxPages = 5 } = {}) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
        const batch = await fetchPage(page, pageSize);
        all.push(...batch);
        if (batch.length < pageSize) break;
    }
    return all;
}
```

---

#### RF-024 🟠 ALTO — Duas funções SSE ~90% idênticas em `channel/inject.js`
**Arquivo:** `channel/inject.js`
**Problema:** `subscribeLlmB()` e `subscribeLlmBCritical()` diferem apenas no endpoint (`/events` vs `/events?level=critical`) e em um filtro de eventos. O corpo completo do loop SSE (conexão, parse, retry, cleanup) é duplicado.
**Proposta:** Extrair `_subscribeSse(path, onEvent, opts)` como função interna reutilizável:

```js
function _subscribeSse(path, onEvent, { retryMs = 3000, signal } = {}) {
    // corpo único do loop SSE
}

export function subscribeLlmB(onEvent, opts) {
    return _subscribeSse(`${BASE}/events`, onEvent, opts);
}
export function subscribeLlmBCritical(onEvent, opts) {
    return _subscribeSse(`${BASE}/events?level=critical`, onEvent, opts);
}
```

---

#### RF-035 🟠 ALTO — `withErrorHandler()` duplicado em `routes/agent.js` e `routes/client.js`
**Arquivos:** `routes/agent.js`, `routes/client.js`
**Problema:** Função idêntica definida em ambos os arquivos:
```js
async function withErrorHandler(req, res, fn) {
    try { await fn(); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
```
**Proposta:** Criar `routes/middleware.js` com a função e importá-la nos dois módulos.

---

### Bloco C — I/O Síncrono Bloqueante no Event Loop

#### RF-031 🟡 MÉDIO — `execSync` em todas as operações de git tools
**Arquivo:** `tools/git/index.js`
**Problema:** A função `safeGit()` usa `execSync()` para executar todos os comandos git das tools (git_status, git_log, git_diff, git_commit, etc.). Durante uma operação git em repositório grande, o event loop do Node.js fica totalmente bloqueado.
**Proposta:** Converter para `execFileAsync` (já utilizado em `tools/code-tools.js` e `tools/shell/index.js`).

```js
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const execFileAsync = promisify(execFile);

async function safeGit(args, opts = {}) {
    const { stdout } = await execFileAsync('git', args, {
        cwd: opts.cwd ?? process.cwd(),
        maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
}
```

---

#### RF-005 🟡 MÉDIO — FS síncrono em `agent/session-manager.js`
**Arquivo:** `agent/session-manager.js`
**Problema:** `readState()` e `writeState()` usam `readFileSync`/`writeFileSync`. Como são chamadas dentro de handlers de eventos do agente (que rodam no event loop), bloqueiam durante I/O de disco.
**Proposta:** Converter para `fs/promises` com `readFile`/`writeFile`.

---

#### RF-032 🟡 MÉDIO — FS síncrono em `tools/session-tools.js`
**Arquivo:** `tools/session-tools.js`
**Problema:** `readFileSync`, `writeFileSync`, `existsSync` usados nos handlers de tool. Cada chamada de tool bloqueia o event loop durante operações de disco.
**Proposta:** Converter para async fs/promises em todos os handlers.

---

#### RF-030 🔵 BAIXO — `readFileSync` em `tools/hook-tools.js`
**Arquivo:** `tools/hook-tools.js`
**Problema:** `hookGetPendingTasksTool` lê arquivo de estado com `readFileSync` — operação de debug, mas ainda no event loop.
**Proposta:** Converter para `readFile` async.

---

#### RF-041 🔵 BAIXO — `execSync` em `terminal/workspace-context.js`
**Arquivo:** `terminal/workspace-context.js`
**Problema:** `tryExec()` usa `execSync` para detectar git root e branch. Chamada no startup do terminal, não em loop quente, mas ainda é um ponto de bloqueio.
**Proposta:** Converter para async se usado em contextos hot-path; ou aceitar como tradeoff de inicialização pontual.

---

### Bloco D — Estado Mutável de Módulo (Difícil de Testar)

#### RF-007 🟡 MÉDIO — Estado de módulo em `lib/client.js`
**Arquivo:** `lib/client.js`
**Problema:** `_client`, `_starting`, `_sessions` são variáveis de módulo. Testes que precisam de isolamento entre instâncias não conseguem fazer reset sem `_resetClientState()` (função de teste exposta). Em produção, não há suporte a múltiplos clientes simultâneos.
**Proposta:** Encapsular em classe `CopilotClientManager` com instância singleton; manter `_injectClientForTest()` apenas em testes.

---

#### RF-027 🔵 BAIXO — Estado de módulo em `bridges/mcp-tool-bridge.js`
**Arquivo:** `bridges/mcp-tool-bridge.js`
**Problema:** `_mcpCircuitOpen` e `_bootAttemptCount` são variáveis de módulo — não resetáveis entre testes sem recarregar o módulo.
**Proposta:** Encapsular em classe `McpToolBridge` ou ao menos exportar `_resetMcpState()` para testes.

---

#### RF-039 🔵 BAIXO — Estado de módulo em `bridges/nerv-bridge.js`
**Arquivo:** `bridges/nerv-bridge.js`
**Problema:** `_nerv` e `_listeners` são variáveis top-level de módulo. Hard to reset ou substituir em testes.
**Proposta:** Encapsular em classe `NervBridge` (similar ao design de `DialogWatchdog` e `WebhookManager`).

---

#### RF-040 🔵 BAIXO — Estado de módulo e auto-init em `config/tools/registry.js`
**Arquivo:** `config/tools/registry.js`
**Problema:** `_registry` é um Map top-level e `loadCustomTools()` auto-executa no import do módulo (side effect). Dificulta testes isolados e torna o comportamento de inicialização implícito.
**Proposta:** Encapsular em classe; tornar `loadCustomTools()` explícito (chamado por `bootstrapTools()`).

---

#### RF-033 🔵 BAIXO — `SESSION_CONTEXT_STORE` efêmero em `tools/session-tools.js`
**Arquivo:** `tools/session-tools.js`
**Problema:** `SESSION_CONTEXT_STORE = new Map()` é um cache em memória que não sobrevive a restarts do processo. Uso como cache de contexto de sessão é silenciosamente perdido.
**Proposta:** Documentar claramente a natureza efêmera, ou persistir em disco/SQLite como as memórias de `conversation-hub/store.js`.

---

### Bloco E — Duplicação de Padrões Simples

#### RF-008 🔵 BAIXO — Padrão `pickDefined` espalhado em muitos arquivos
**Arquivos:** `routes/sessions.js` (12 ocorrências), `api/bridge-tasks.js`, `lib/session.js`, `agent/session-manager.js`, outros
**Problema:** O padrão `...(x !== undefined ? { key: x } : {})` aparece dezenas de vezes. É verboso, propenso a erro de digitação e dificulta leitura.
**Proposta:** Criar utilitário em `lib/utils.js`:

```js
/**
 * Remove chaves com valor undefined de um objeto.
 * @template T
 * @param {T} obj
 * @returns {Partial<T>}
 */
export function pickDefined(obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== undefined)
    );
}
```

---

#### RF-012 🔵 BAIXO — `priorityOrder` definido 3 vezes em `tools/todo-tools.js`
**Arquivo:** `tools/todo-tools.js`
**Problema:** A constante `priorityOrder = ['urgent', 'high', 'medium', 'low', 'none']` é definida inline (não no escopo de módulo) em três handlers diferentes dentro do mesmo arquivo.
**Proposta:** Mover para constante de módulo exportada como `PRIORITY_ORDER`.

---

#### RF-025 🟡 MÉDIO — 8 tools em `tools/session-rpc-tools.js` com padrão idêntico
**Arquivo:** `tools/session-rpc-tools.js`
**Problema:** Todos os 8 tools seguem: `getRpc()` → `try { await rpc.methodName(params) } catch(e) { throw CopilotError }`. Qualquer mudança no tratamento de erro deve ser replicada em 8 lugares.
**Proposta:** Extrair helper `wrapRpc(name, fn)`:

```js
async function wrapRpc(name, fn) {
    const rpc = getRpc();
    if (!rpc) throw new CopilotError(`[session-rpc] RPC não disponível para ${name}`);
    try {
        return await fn(rpc);
    } catch (e) {
        throw new CopilotError(`[session-rpc] ${name} falhou: ${e.message}`);
    }
}
```

---

#### RF-009 🟡 MÉDIO — `createHooks()` com ~200 linhas em `lib/hooks.js`
**Arquivo:** `lib/hooks.js`
**Problema:** A função factory `createHooks()` defiine inline os handlers de `preToolUse`, `postToolUse`, `onError`, `onSessionEnd` — cada um com sua própria lógica complexa e vários if/else. A função tem ~200 linhas de um único nível.
**Proposta:** Extrair cada slot como função builder nomeada:
- `buildPreToolHandler(opts)`
- `buildPostToolHandler(opts)`
- `buildErrorHandler(opts)`
- `buildSessionEndHandler(opts)`

---

#### RF-017 🟡 MÉDIO — Chain de 250 linhas de if/else em `terminal/server.js`
**Arquivo:** `terminal/server.js`
**Problema:** O roteamento HTTP do servidor terminal é uma cadeia sequencial de `if (req.method === 'POST' && req.url === '/inject')` com ~15 rotas. Cada nova rota exige edição dentro do corpo monolítico.
**Proposta:** Tabela de rotas com dispatch loop:

```js
const ROUTES = [
    { method: 'POST', path: '/inject', handler: handleInject },
    { method: 'POST', path: '/pipeline', handler: handlePipeline },
    // ...
];
// dispatcher:
const route = ROUTES.find(r => r.method === req.method && r.path === pathWithoutQuery);
```

---

#### RF-018 🟡 MÉDIO — Dois rate-limiters duplicados em `terminal/server.js`
**Arquivo:** `terminal/server.js`
**Problema:** `_injectRateLimiter` e `_writeRateLimiter` são instâncias de uma classe idêntica com parâmetros diferentes — mas a lógica de janela deslizante está copiada duas vezes.
**Proposta:** Extrair `createRateLimiter(maxRequests, windowMs)` como factory.

---

#### RF-036 🟡 MÉDIO — Rota duplicada `/telemetry` e `/agent/telemetry` em `routes/agent.js`
**Arquivo:** `routes/agent.js`
**Problema:** `GET /telemetry` e `GET /agent/telemetry` possuem handlers com corpo idêntico (cópia literal). Alterações em um não propagam para o outro.
**Proposta:** Remover `/telemetry` e manter apenas `/agent/telemetry` como rota canônica — ou registrar ambas com o mesmo handler.

---

#### RF-013 🟡 MÉDIO — `todoAddSubtaskTool` duplica `todoCreateTool` em `tools/todo-tools.js`
**Arquivo:** `tools/todo-tools.js`
**Problema:** A lógica de criação de uma task (validação, ID, timestamps, prioridade, persistência) está duplicada entre `todoCreateTool` e `todoAddSubtaskTool`.
**Proposta:** Extrair `createTaskInternal(params, db)` usado por ambos.

---

### Bloco F — Acoplamento e Arquitetura

#### RF-003 🟡 MÉDIO — Hardcode de `alwaysAliveAgent` em `orchestrator.js`
**Arquivo:** `conversation-hub/orchestrator.js`
**Problema:** `HubOrchestrator` importa diretamente `alwaysAliveAgent` do módulo `agent/always-alive.js` e o usa como referência interna. Isso impede testes unitários (o singleton é instanciado no import), e cria acoplamento bidirecional implícito.
**Proposta:** Injetar o agente via construtor:
```js
class HubOrchestrator {
    constructor(agent = alwaysAliveAgent) {
        this.#agent = agent;
    }
}
```

---

#### RF-022 🟡 MÉDIO — `broadcastSse()` mescla SSE e Socket.io em `terminal/dialog.js`
**Arquivo:** `terminal/dialog.js`
**Problema:** A função `broadcastSse()` trata `Set<ServerResponse>` (SSE puro) e `Socket.io namespace` na mesma função. Lógicas de formatação e entrega distintas ficam entrelaçadas.
**Proposta:** Separar `emitSse(clients, event, data)` e `emitSocket(ns, event, data)`, chamados de um dispatcher `broadcast()`.

---

#### RF-014 🔵 BAIXO — `ALLOWED_FROM` definida duas vezes em `terminal/http-handlers.js`
**Arquivo:** `terminal/http-handlers.js`
**Problema:** A lista `ALLOWED_FROM = ['llm-a', 'system', 'user', 'hook', ...]` é definida inline em dois handlers diferentes no mesmo arquivo.
**Proposta:** Constante top-level de módulo.

---

#### RF-015 🟡 MÉDIO — `_rlWindowMap` em `routes/sessions.js` nunca purga entradas expiradas
**Arquivo:** `routes/sessions.js`
**Problema:** O Map de rate-limiting (`_rlWindowMap`) acumula entradas para cada IP diferente que acessa o endpoint. Em produção com muitos IPs distintos, a memória crescerá indefinidamente.
**Proposta:** Adicionar loop de limpeza periódico (ex: `setInterval(() => purgeExpired(_rlWindowMap), 60_000)`) ou usar `setTimeout` ao criar cada entrada para auto-remover após a janela expirar.

---

#### RF-020 🟡 MÉDIO — `watchRun()` sem guarda de iterações máximas em `bridges/gh-bridge.js`
**Arquivo:** `bridges/gh-bridge.js`
**Problema:** O loop de polling em `watchRun()` não tem limite de iterações — apenas timeout total. Se o CI run for truncado inesperadamente, o loop pode rodar por horas.
**Proposta:** Adicionar parâmetro `maxAttempts` com default razoável (ex: 360 = 1h com polling a cada 10s).

---

#### RF-023 🔵 BAIXO — Cleanup assimétrico em `channel/client.js`
**Arquivo:** `channel/client.js`
**Problema:** `startDialogMode()` registra N listeners de eventos. O cleanup no `finally` deve espelhar exatamente os registros — mas é feito manualmente sem garantia de simetria, podendo deixar listeners orphaned.
**Proposta:** Extrair `#registerDialogListeners()` que retorna função de cleanup `#removeDialogListeners()`.

---

#### RF-034 🔵 BAIXO — `httpRequest()` duplicado em `tools/task-tools.js` e `channel/inject.js`
**Arquivo:** `tools/task-tools.js`, `channel/inject.js`
**Problema:** Função `httpRequest(method, url, body)` definida identicamente em dois módulos.
**Proposta:** Mover para utilitário compartilhado `lib/http-utils.js` (ou usar o cliente fetch nativo do Node.js 24+).

---

#### RF-037 🔵 BAIXO — `startTerminalServer()` com 227 linhas de listeners inline
**Arquivo:** `terminal/index.js`
**Problema:** A função de boot registra todos os event listeners inline (`dialog.stalled`, `dialog.reply`, `dialog.ready`, `session.usage`, etc.) e toda a lógica do reflection loop, tornando o arquivo difícil de navegar.
**Proposta:** Extrair `#registerAgentEventListeners(agent, ctx)` e `#startReflectionLoop(agent, ctx)`.

---

#### RF-038 🔵 BAIXO — `cmdGh()` com 338 linhas e padrão repetitivo por subcomando
**Arquivo:** `terminal/commands/gh.js`
**Problema:** Cada subcomando (issue, pr, run, release, search, status, api) segue o padrão: `if (sub === 'X') { check args → fetch via bridge → format → println }`. O padrão é mecânico e verboso.
**Proposta:** Tabela de subcomandos com handler:
```js
const SUBCOMMANDS = {
    issue: handleIssue,
    pr: handlePr,
    // ...
};
const handler = SUBCOMMANDS[sub];
if (handler) return handler(ctx, args);
```

---

### Bloco G — Idiomaticidade e Consistência

#### RF-021 🔵 BAIXO — Inconsistência `buildTool` vs `defineTool` no codebase
**Arquivos:** `tools/tool-factory.js` e múltiplos arquivos de tools
**Problema:** `buildTool()` chama `defineTool()` internamente (wrapping com logging). Mas alguns arquivos de tools chamam `defineTool()` diretamente, enquanto outros chamam `buildTool()`. Sem docs claros sobre quando usar cada um.
**Proposta:** Deprecar um dos dois ou documentar claramente: `buildTool()` para tools de produção (com logging), `defineTool()` para testes/interno.

---

#### RF-026 🔵 BAIXO — `list_tools` usa `prefixMap` hardcoded em `tools/introspection-tools.js`
**Arquivo:** `tools/introspection-tools.js`
**Problema:** A filtragem por categoria em `list_tools` usa um mapa de prefixo de nome → categoria (`{ 'todo_': 'todo', 'git_': 'git', ... }`). Se uma nova categoria de tool for adicionada sem atualizar esse mapa, a filtragem silenciosamente ignora as novas tools.
**Proposta:** Derivar as categorias diretamente do registry de tools (que já armazena metadados de categoria via `registerTools()`).

---

#### RF-011 🔵 BAIXO — Três métodos quase-idênticos de filtragem em `lib/tools-registry.js`
**Arquivo:** `lib/tools-registry.js`
**Problema:** `getToolsByCategory()`, `getToolsByTag()` e `getReadOnlyTools()` iteram o mesmo Map com predicado diferente. Padrão repetitivo.
**Proposta:** Implementar como:
```js
export function getToolsBy(predicate) {
    return [...registry.values()].filter(predicate);
}
export const getToolsByCategory = (cat) => getToolsBy(e => e.meta.category === cat);
```

---

#### RF-028 🔵 BAIXO — `webSearchTool` usa regex sobre HTML do DDG
**Arquivo:** `tools/web-tools.js`
**Problema:** A busca web usa parse de HTML do DuckDuckGo com regex. Se o DDG alterar sua estrutura de HTML, a ferramenta para de funcionar silenciosamente (retorna 0 resultados sem erro).
**Proposta:** Adicionar teste de smoke com mock + documentar como "brittle by design" até uma API estruturada estar disponível. Ou adicionar fallback com detecção de 0 resultados.

---

#### RF-042 🔵 BAIXO — `saveAliases()` em `bridges/alias-store.js` auto-executa no import
**Arquivo:** `bridges/alias-store.js`
**Problema:** `loadAliases()` é chamada no corpo top-level do módulo. Similar ao RF-040, isso é um side-effect implícito no import. Testes que importam o módulo carregam automaticamente o arquivo `aliases.json` do disco.
**Proposta:** Tornar explícito: `init()` chamado pelo bootstrap do agente.

---

#### RF-043 🔵 BAIXO — `COMPACT_PROMPT` e `summaryPrompt` hardcoded em commands
**Arquivos:** `terminal/commands/context.js`, `terminal/commands/resume.js`
**Problema:** Os prompts de compactação e de retomada de sessão são strings longas hardcoded nos handlers. Difíceis de manter ou customizar.
**Proposta:** Mover para `config/system-prompt.js` como constantes exportadas.

---

#### RF-044 🔵 BAIXO — Dupla definição de shutdown em `agent/entry.js`
**Arquivo:** `agent/entry.js`
**Problema:** Sinais `SIGTERM` e `SIGINT` chamam `shutdown(signal)` corretamente, mas a função `shutdown()` chama `process.exit(0)` no `finally` — se `alwaysAliveAgent.stop()` lança, o `catch` loga o erro mas o `finally` ainda faz `process.exit(0)` (correto). Porém, há código após o registro dos sinais que faz `await startWithRetry()` sem `await` explícito (usa `void`) — se `startWithRetry` rejeitar depois que um sinal for recebido, há possibilidade de exit code incorreto.
**Proposta:** Garantir que `process.exitCode` seja setado antes de `process.exit()`.

---

#### RF-045 🔵 BAIXO — `#loadFile` síncrono em `config/pinned-files-loader.js`
**Arquivo:** `config/pinned-files-loader.js`
**Problema:** `PinnedFilesLoader.#loadFile()` usa `readFileSync` para carregar arquivos pinned. Chamado tanto no boot quanto no callback do `fs.watch()` (que pode ser chamado em qualquer momento).
**Proposta:** Converter para async com debounce assíncrono — ou aceitar o comportamento síncrono no watch callback (onde é mais aceitável).

---

### Bloco H — Problemas Menores Pontuais

#### RF-046 🔵 BAIXO — Timeout hardcoded em `api/bridge-dialog.js`
**Arquivo:** `api/bridge-dialog.js`
**Problema:** A validação de timeout `if (timeout < 1000 || timeout > 300000)` usa valores mágicos inline.
**Proposta:** Extrair como constantes nomeadas:
```js
const MIN_DIALOG_TIMEOUT_MS = 1_000;
const MAX_DIALOG_TIMEOUT_MS = 300_000;
```

---

#### RF-047 🔵 BAIXO — `DEFAULT_EXCLUDED_TOOLS` hardcoded em `config/session-config.js`
**Arquivo:** `config/session-config.js`
**Problema:** `['powershell', 'web_fetch', 'web_search', 'memory']` é hardcoded como array de strings sem nenhum comentário explicando por que cada um está excluído.
**Proposta:** Adicionar JSDoc explicando o racional de cada entrada excluída (por segurança? por conflito com SDK nativo?).

---

#### RF-048 🔵 BAIXO — `MODELS_CACHE_TTL_MS` como estado de módulo em `lib/models.js`
**Arquivo:** `lib/models.js`
**Problema:** `_modelsCache` é estado de módulo — mesmos problemas de isolamento de testes (RF-007). Cache nunca é purgado em caso de erro de rede.
**Proposta:** Já há `clearModelsCache()` exportado — garantir que seja chamado em cenários de erro.

---

#### RF-049 🔵 BAIXO — Dynamic imports desnecessários em `tools/task-tools.js`
**Arquivo:** `tools/task-tools.js`
**Problema:** `getSessionStateTool` usa `await import('node:fs')`, `await import('node:path')` dentro do handler para evitar dependência no top-level. Isso adiciona latência na primeira chamada.
**Proposta:** Importar no top-level — não há risco de ciclo neste módulo.

---

#### RF-050 🔵 BAIXO — `isMain` check frágil em `terminal-server.js`
**Arquivo:** `terminal-server.js`
**Problema:** `process.argv[1]?.endsWith('terminal-server.js')` é fragil — falhará se o arquivo for renomeado ou executado via symlink com nome diferente.
**Proposta:** Usar o idioma canônico ESM:
```js
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
```

---

#### RF-051 🔵 BAIXO — `alwaysAliveAgent.start()` é chamado no top-level de `agent/entry.js` sem await explícito
**Arquivo:** `agent/entry.js`
**Problema:** `void startWithRetry()` retorna Promise mas usa `void`. Se o processo receber SIGTERM durante a execução de `startWithRetry`, pode haver condição de corrida entre o sinal e o fluxo de inicialização.
**Proposta:** Salvar a Promise em variável e aguardá-la no handler de sinal antes de chamar `shutdown()`.

---

#### RF-052 🔵 BAIXO — `agent.js` como re-export `@deprecated` sem remoção programada
**Arquivo:** `agent.js`
**Problema:** Arquivo marcado como `@deprecated` mas sem data de remoção ou issue linkada. Polui o namespace sem benefício.
**Proposta:** Verificar dependentes, migrar e remover o arquivo.

---

#### RF-053 🔵 BAIXO — Webhook emit usa `import()` dinâmico dentro de Promise.allSettled
**Arquivo:** `agent/webhook-manager.js`
**Problema:** `import('node:https')` e `import('node:http')` são chamados para cada webhook em cada emit. Essas importações são cacheadas pelo Node.js após a primeira chamada, mas a sintaxe é desnecessariamente verbosa.
**Proposta:** Importar no top-level do módulo:
```js
import https from 'node:https';
import http from 'node:http';
```

---

#### RF-054 🔵 BAIXO — `getWorkspaceContext()` não é cacheado (chama execSync a cada chamada)
**Arquivo:** `terminal/workspace-context.js`
**Problema:** A função retorna contexto sem cache — cada chamada executa `execSync` para obter git root e branch. Se chamada repetidamente (ex: a cada turno para contexto), causa overhead desnecessário.
**Proposta:** Adicionar cache com TTL de 30s, invalidado por mudanças de branch detectadas via `fs.watch('.git/HEAD')`.

---

#### RF-055 🔵 BAIXO — Copilot Skills `/reload` sem implementação real em `terminal/commands/skills.js`
**Arquivo:** `terminal/commands/skills.js`
**Problema:** O subcomando `reload` apenas imprime "Reinicie o processo para carregar novos paths" — não há integração com `PinnedFilesLoader`.
**Proposta:** Integrar com `PinnedFilesLoader` se instanciado (injetar via contexto ou singleton), ou remover o subcomando para evitar expectativa não atendida.

---

## 4. Análise por Domínio

### 4.1 — Camada `agent/` (AlwaysAlive + auxiliares)

**Arquivos:** `always-alive.js`, `session-manager.js`, `dialog-watchdog.js`, `webhook-manager.js`, `tools-bootstrap.js`, `entry.js`, `events.js`

**Pontos positivos:**
- `DialogWatchdog` e `WebhookManager` foram extraídos com excelente design de clase (campos privados, interface limpa)
- `events.js` centraliza todos os nomes de eventos — boa prática
- `tools-bootstrap.js` isola a lógica de registro de tools de forma testável

**Problemas principais:**
- `always-alive.js` com 1510 linhas permanece monolítico (RF-001, RF-002)
- `session-manager.js` ainda usa FS síncrono (RF-005)
- `entry.js` tem gestão de sinal incompleta (RF-051)

**Débito técnico estimado:** Alto (refatoração prioritária)

---

### 4.2 — Camada `lib/` (SDK abstractions)

**Arquivos:** `client.js`, `hooks.js`, `permissions.js`, `session.js`, `agents.js`, `models.js`, `telemetry.js`, `tools-registry.js`, `index.js`

**Pontos positivos:**
- Design geral limpo e bem documentado
- `permissions.js`, `agents.js`, `models.js`, `telemetry.js` — excelentes módulos, sem problemas relevantes
- `lib/index.js` como barrel bem organizado

**Problemas:**
- `client.js` com estado de módulo (RF-007)
- `hooks.js` com `createHooks()` muito longo (RF-009)
- `tools-registry.js` com três métodos quase-iguais (RF-011)

---

### 4.3 — Camada `conversation-hub/` (Store + Hub + Orchestrator)

**Arquivos:** `store.js`, `hub.js`, `orchestrator.js`, `socket-ns.js`, `index.js`

**Pontos positivos:**
- `hub.js` bem composto (Store + Orchestrator + SocketNs claramente separados)
- `socket-ns.js` tem design limpo de broadcast

**Problemas:**
- `store.js` — SQL injection por metacaracteres (RF-006) — **CRÍTICO**
- `orchestrator.js` — método 200+ linhas com 3 caminhos (RF-004) — **ALTO**
- `orchestrator.js` — acoplamento direto ao singleton (RF-003)

---

### 4.4 — Camada `tools/` (66 tools em 17 arquivos)

**Arquivos:** `todo-tools.js`, `file-tools.js`, `shell/index.js`, `web-tools.js`, `hub-tools.js`, `session-rpc-tools.js`, `hook-tools.js`, `git/index.js`, `session-tools.js`, `task-tools.js`, `code-tools.js`, `permission-tools.js`, `introspection-tools.js`, `tool-factory.js`, `index.js`

**Pontos positivos:**
- `shell/index.js` — excelente segurança (safeEnv, tokenizeShell, path canonicalization)
- `web-tools.js` — proteção SSRF bem implementada
- `code-tools.js` — async correto, padrão limpo

**Problemas:**
- `git/index.js` — `execSync` bloqueante (RF-031) — **MÉDIO**
- `hook-tools.js` — race condition em singleton (RF-029) — **CRÍTICO**
- `session-tools.js` — FS síncrono (RF-032)
- `session-rpc-tools.js` — 8 tools com padrão repetido (RF-025)
- `todo-tools.js` — `priorityOrder` 3x + subtask duplicação (RF-012, RF-013)
- `task-tools.js` — `httpRequest` duplicado + dynamic imports desnecessários (RF-034, RF-049)

---

### 4.5 — Camada `bridges/` (GitHub, Git, MCP, NERV, Alias, Inject-LLM-B)

**Arquivos:** `gh-bridge.js`, `git-bridge.js`, `mcp-tool-bridge.js`, `nerv-bridge.js`, `alias-store.js`, `inject-llmb.js`, `llm-bridge-client.js`

**Pontos positivos:**
- `git-bridge.js` — excelente! async, limpo, sem problemas
- `mcp-tool-bridge.js` — circuit breaker bem implementado
- Separação clara de responsabilidades

**Problemas:**
- `gh-bridge.js` — paginação triplicada (RF-019), watchRun sem guarda (RF-020)
- `nerv-bridge.js` — estado de módulo (RF-039)
- `alias-store.js` — FS síncrono + auto-init (RF-042)

---

### 4.6 — Camada `terminal/` (Servidor, REPL, Dialog, Handlers, Comandos)

**Arquivos:** `server.js`, `repl.js`, `dialog.js`, `http-handlers.js`, `index.js`, `state.js`, `file-context.js`, `workspace-context.js`, `commands/*.js`

**Pontos positivos:**
- `state.js` — design reativo com EventEmitter, excelente
- `repl.js` — switch bem organizado por delegação de comandos
- Comandos individuais (`alias`, `plan`, `context`, `attach`) — todos limpos e pequenos

**Problemas:**
- `server.js` — chain de if/else + rate limiters duplicados (RF-017, RF-018)
- `dialog.js` — SSE e Socket.io misturados (RF-022)
- `http-handlers.js` — ALLOWED_FROM duplicado, FS síncrono (RF-014)
- `index.js` — 227 linhas de listeners inline (RF-037)
- `workspace-context.js` — execSync + sem cache (RF-041, RF-054)
- `commands/gh.js` — 338 linhas repetitivas (RF-038)

---

### 4.7 — Camada `routes/` e `api/`

**Arquivos:** `routes/sessions.js`, `routes/agent.js`, `routes/client.js`, `routes/webhooks.js`, `api/bridge-control.js`, `api/bridge-tasks.js`, `api/bridge-dialog.js`, `api/bridge-stream.js`, `api/http-bridge.js`, `api/sdk-api.js`

**Pontos positivos:**
- `api/bridge-stream.js` — excelente: fan-out SSE limpo, setMaxListeners corretamente
- `api/http-bridge.js` e `api/sdk-api.js` — aggregators limpos
- `routes/webhooks.js` — validação de URL correta (protocol check)

**Problemas:**
- `routes/sessions.js` — memory leak no rate-limiter (RF-015)
- `routes/agent.js` — rota duplicada (RF-036), `withErrorHandler` duplicado (RF-035)
- `routes/client.js` — `withErrorHandler` duplicado (RF-035)
- `api/bridge-dialog.js` — constantes mágicas inline (RF-046)

---

### 4.8 — Camada `channel/` (SSE inject + client + audit)

**Pontos positivos:**
- `audit.js` — escrita assíncrona com setImmediate + rotação de arquivo: excelente design
- `index.js` — barrel limpo

**Problemas:**
- `inject.js` — duplicação de loop SSE (RF-024) — **ALTO**
- `client.js` — cleanup assimétrico (RF-023)

---

### 4.9 — Camada `config/`

**Pontos positivos:**
- `system-prompt.js` — excelente: constantes nomeadas + builders composicionais
- `mcp-servers.js` — validação de GITHUB_TOKEN antes de registrar, boa segurança
- `session-config.js` — builders claros

**Problemas:**
- `tools/registry.js` — auto-init side-effect (RF-040)
- `alias-store.js` — auto-init side-effect (RF-042)
- `pinned-files-loader.js` — readFileSync no watcher (RF-045)

---

### 4.10 — Camada `core/` e `types/`

**Totalmente limpa.** `errors.js`, `constants.js`, `types.js`, `index.js` e `types/index.js` são bem projetados — hierarquia de erros tipados, constantes centralizadas, barrels organizados. Sem problemas relevantes identificados.

---

## 5. Padrões Transversais

### 5.1 — Estado de módulo (anti-pattern recorrente)

**Ocorrências:** `lib/client.js`, `bridges/mcp-tool-bridge.js`, `bridges/nerv-bridge.js`, `config/tools/registry.js`, `bridges/alias-store.js`, `lib/models.js`, `tools/session-tools.js`

O padrão de variáveis `let _x = ...` no escopo de módulo como "singletons implícitos" aparece em 7 arquivos. Isso torna:
- Testes de unit difíceis (require import fresh ou reset functions)
- Debugging difícil (estado invisível)
- Refatoração arriscada (dependentes implícitos)

**Recomendação transversal:** Migrar gradualmente para padrão de classe com instância exportada.

---

### 5.2 — Auto-execução de side effects no import

**Ocorrências:** `bridges/alias-store.js` (`loadAliases()`), `config/tools/registry.js` (`loadCustomTools()`)

Side effects executados no import tornam os módulos não-tesáveis sem mocks de sistema de arquivos e criam dependências ocultas na ordem de importação.

**Recomendação:** Tornar a inicialização explícita, chamada pelo bootstrap (`agent/tools-bootstrap.js` ou `agent/entry.js`).

---

### 5.3 — I/O síncrono bloqueante

**Ocorrências:** `tools/git/index.js`, `agent/session-manager.js`, `tools/session-tools.js`, `tools/hook-tools.js`, `terminal/workspace-context.js`, `config/pinned-files-loader.js`, `bridges/alias-store.js`, `channel/audit.js` (parcial)

O Node.js é single-threaded; qualquer `readFileSync`/`writeFileSync`/`execSync` no event loop principal bloqueia toda a aplicação. Em ambiente de servidor com múltiplos clientes, isso causa latência perceptível.

**Recomendação:** Política de zero-sync para arquivos lidos em handlers de tool ou routes HTTP.

---

### 5.4 — Dynamic imports desnecessários em handlers

**Ocorrências:** `tools/session-tools.js` (node:fs, node:path), `tools/task-tools.js` (node:fs, node:path, node:url), `terminal/commands/context.js` (`dialog.js` — justificado por ciclo), `terminal/commands/resume.js` (`dialog.js` — justificado por ciclo)

Os dois últimos são justificados (evitam ciclo de importação). Os dois primeiros são desnecessários e adicionam overhead de parse na primeira chamada.

---

### 5.5 — Padrão `pickDefined` não padronizado

Contado em mais de 20 ocorrências do padrão `...(x !== undefined ? { key: x } : {})`. A utilidade `pickDefined()` resolveria isso com uma passagem de refatoração de busca-e-substituição.

---

## 6. Mapa de Prioridades

### Prioridade 1 — Crítico (endereçar imediatamente)

| ID     | Arquivo                     | Problema                          | Esforço |
| ------ | --------------------------- | --------------------------------- | ------- |
| RF-006 | `conversation-hub/store.js` | SQL LIKE metachar injection       | 1h      |
| RF-029 | `tools/hook-tools.js`       | Race condition singleton resolver | 2h      |

---

### Prioridade 2 — Alto (próximo sprint)

| ID             | Arquivo                                | Problema                     | Esforço |
| -------------- | -------------------------------------- | ---------------------------- | ------- |
| RF-001, RF-002 | `agent/always-alive.js`                | Duplicação massiva de lógica | 4h      |
| RF-004         | `conversation-hub/orchestrator.js`     | Método 200+ linhas           | 3h      |
| RF-019         | `bridges/gh-bridge.js`                 | Paginação triplicada         | 2h      |
| RF-024         | `channel/inject.js`                    | Loop SSE duplicado           | 2h      |
| RF-031         | `tools/git/index.js`                   | `execSync` bloqueante        | 1h      |
| RF-035         | `routes/agent.js` + `routes/client.js` | `withErrorHandler` duplicado | 30min   |

---

### Prioridade 3 — Médio (backlog ativo)

| ID             | Arquivo                            | Problema                    | Esforço |
| -------------- | ---------------------------------- | --------------------------- | ------- |
| RF-003         | `conversation-hub/orchestrator.js` | Acoplamento ao singleton    | 2h      |
| RF-005         | `agent/session-manager.js`         | FS síncrono                 | 1h      |
| RF-007         | `lib/client.js`                    | Estado de módulo            | 3h      |
| RF-009         | `lib/hooks.js`                     | createHooks() 200 linhas    | 2h      |
| RF-013         | `tools/todo-tools.js`              | Lógica de criação duplicada | 1h      |
| RF-015         | `routes/sessions.js`               | Memory leak rate-limiter    | 1h      |
| RF-017, RF-018 | `terminal/server.js`               | Route chain + rate limiters | 2h      |
| RF-022         | `terminal/dialog.js`               | SSE/Socket.io misturados    | 2h      |
| RF-025         | `tools/session-rpc-tools.js`       | 8 tools com padrão repetido | 1h      |
| RF-032         | `tools/session-tools.js`           | FS síncrono                 | 1h      |
| RF-036         | `routes/agent.js`                  | Rota duplicada              | 30min   |

---

### Prioridade 4 — Baixo (limpeza)

Todos os RF-008, RF-011, RF-012, RF-014, RF-020, RF-021, RF-023, RF-026, RF-027, RF-028, RF-030, RF-033, RF-034, RF-037 a RF-055 — baixo risco, podem ser abordados em passes de limpeza incremental.

---

## 7. Propostas Detalhadas

### P-01 — Extrair `pickDefined()` em `lib/utils.js` (RF-008, RF-016)

```js
// lib/utils.js
/**
 * Remove chaves com valor undefined de um objeto.
 * Útil para construir objetos de configuração parciais sem spreads condicionais.
 *
 * @template {Record<string, unknown>} T
 * @param {T} obj
 * @returns {{ [K in keyof T]: Exclude<T[K], undefined> }}
 */
export function pickDefined(obj) {
    return /** @type {any} */ (
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
    );
}
```

Substituição em `routes/sessions.js` (12 ocorrências), `api/bridge-tasks.js`, outros:
```js
// Antes:
const body = {
    model,
    ...(tools !== undefined ? { tools } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    // ...
};
// Depois:
const body = pickDefined({ model, tools, timeout, /* ... */ });
```

---

### P-02 — Corrigir SQL injection em `store.js` (RF-006)

```js
// conversation-hub/store.js

// Antes (inseguro):
const rows = db.prepare(
    `SELECT * FROM turns WHERE sdk_turn_id LIKE '%${sdkTurnId}%'`
).all();

// Depois (seguro):
const escaped = sdkTurnId.replace(/%/g, '\\%').replace(/_/g, '\\_');
const rows = db.prepare(
    `SELECT * FROM turns WHERE sdk_turn_id LIKE ? ESCAPE '\\'`
).all(`%${escaped}%`);
```

Se o `sdkTurnId` é sempre match exato (não substring), simplificar para:
```js
const rows = db.prepare(
    `SELECT * FROM turns WHERE sdk_turn_id = ?`
).all(sdkTurnId);
```

---

### P-03 — Fila em `hook-tools.js` para multiple resolvers (RF-029)

```js
// tools/hook-tools.js

// Map: requestId → { resolve, reject, timer }
const _pendingInputResolvers = new Map();

export function setInputResolver(requestId, resolve, reject, timeoutMs) {
    if (_pendingInputResolvers.has(requestId)) {
        reject(new Error(`[hook-tools] request ${requestId} já está aguardando input`));
        return;
    }
    const timer = setTimeout(() => {
        _pendingInputResolvers.delete(requestId);
        reject(new Error(`[hook-tools] timeout aguardando input para ${requestId}`));
    }, timeoutMs);
    _pendingInputResolvers.set(requestId, { resolve, reject, timer });
}

export function resolveInput(requestId, value) {
    const entry = _pendingInputResolvers.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    _pendingInputResolvers.delete(requestId);
    entry.resolve(value);
    return true;
}
```

---

### P-04 — Extrair `paginate()` em `bridges/gh-bridge.js` (RF-019)

```js
// bridges/gh-bridge.js — interno

/**
 * @template T
 * @param {(page: number, pageSize: number) => Promise<T[]>} fetchPage
 * @param {{ pageSize?: number; maxPages?: number }} [opts]
 * @returns {Promise<T[]>}
 */
async function paginate(fetchPage, { pageSize = 20, maxPages = 5 } = {}) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
        const batch = await fetchPage(page, pageSize);
        all.push(...batch);
        if (batch.length < pageSize) break;
    }
    return all;
}

// Uso:
export async function listIssues(opts = {}) {
    return paginate(
        (page, per_page) => ghApi(`/issues?page=${page}&per_page=${per_page}&${buildQueryString(opts)}`),
        { pageSize: opts.pageSize ?? 20 }
    );
}
```

---

### P-05 — Extrair middleware em `routes/middleware.js` (RF-035)

```js
// routes/middleware.js
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {() => Promise<void>} fn
 */
export async function withErrorHandler(req, res, fn) {
    try {
        await fn();
    } catch (/** @type {any} */ e) {
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: e.message });
        }
    }
}
```

---

### P-06 — Converter `safeGit()` para async (RF-031)

```js
// tools/git/index.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

/**
 * @param {string[]} args
 * @param {{ cwd?: string; maxBuffer?: number }} [opts]
 * @returns {Promise<string>}
 */
async function safeGit(args, opts = {}) {
    try {
        const { stdout } = await execFileAsync('git', args, {
            cwd: opts.cwd ?? process.cwd(),
            maxBuffer: opts.maxBuffer ?? 2 * 1024 * 1024,
            encoding: 'utf8',
        });
        return stdout.trim();
    } catch (/** @type {any} */ e) {
        throw new Error(`[git] ${args.join(' ')}: ${e.stderr ?? e.message}`);
    }
}
```

---

## 8. Riscos e Dependências

### 8.1 — Dependências entre refatorações

- **RF-035 antes de RF-036**: Criar `middleware.js` antes para não quebrar import em `agent.js`
- **RF-040 + RF-042** juntos: Ambos envolvem tornar init explícito — coordenar com `agent/tools-bootstrap.js` e `agent/entry.js`
- **RF-001/002 são dependentes**: Extrair `#initSession()` (RF-001) primeiro; `#waitForDialogRestartAndAnswer()` (RF-002) sem essa base pode criar nova duplicação
- **RF-003 e RF-004**: A injeção do agente (RF-003) facilita o split de `#executeSendToLlmB()` (RF-004) — fazer antes

### 8.2 — Riscos por arquivo

| Arquivo                     | Risco                                                                  | Mitigação                                              |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `agent/always-alive.js`     | Muito grande — refatoração pode introduzir regressão no loop principal | Cobertura de testes de integração antes da refatoração |
| `conversation-hub/store.js` | SQL — qualquer mudança na query pode corromper dados                   | Testar com dados reais + backup antes                  |
| `terminal/server.js`        | Roteamento inline — rewrite pode quebrar endpoints existentes          | Testes E2E de cada rota antes e depois                 |
| `channel/inject.js`         | Loop SSE — bug aqui interrompe comunicação LLM-A → LLM-B               | Feature flag para nova versão                          |

### 8.3 — Ausência de testes unitários como risco amplificador

Vários módulos com problemas de refatoração não têm testes unitários dedicados (baseado na análise de `tools/git/index.js`, `bridges/alias-store.js`, `config/tools/registry.js`). A ausência de testes aumenta o risco de qualquer refatoração.

**Recomendação:** Para refatorações de Prioridade 1 e 2, criar testes unitários mínimos antes de modificar o código.

---

## 9. Critérios de Done

Para cada item RF-XXX, considerar concluído quando:

1. **Código alterado** e PR aberto
2. **`npm run lint`** passa sem erros novos
3. **`npm run typecheck:node`** (ou full) passa sem erros novos
4. **`npm run test:unit`** passa (ou testes adicionados para o item)
5. Para Prioridade 1-2: **`npm run test:integration`** passa
6. Para itens de segurança (RF-006, RF-029): **revisão adicional** por segundo par de olhos

---

*Auditoria concluída em 2026-06-22 — 96 arquivos lidos, 55 problemas catalogados.*
*Próximo passo: priorizar e criar issues para RF-006 e RF-029 (Prioridade CRÍTICA).*
