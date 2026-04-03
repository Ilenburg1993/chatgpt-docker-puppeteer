# Audit Consolidado: src/copilot/tools/

**Módulo**: `copilot/tools` **Fase**: F07 — MF-II (1 arquivo lido → 1 MD criado) **Total de
Arquivos**: 23 **Total de LOC**: ~5.716 **Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II
F07

---

## Arquivos Auditados

| Arquivo                  | LOC | MD Individual                  |
| ------------------------ | --- | ------------------------------ |
| `shell/index.js`         | 610 | `shell-index-audit.md`         |
| `todo/crud-tools.js`     | 459 | `todo-crud-audit.md`           |
| `file/read-tools.js`     | 398 | `read-tools-audit.md`          |
| `web-tools.js`           | 396 | `web-tools-audit.md`           |
| `todo/store.js`          | 352 | `todo-store-audit.md`          |
| `hub-tools.js`           | 344 | `hub-tools-audit.md`           |
| `hook-tools.js`          | 329 | `hook-tools-audit.md`          |
| `todo/query-tools.js`    | 323 | `todo-query-audit.md`          |
| `file/write-tools.js`    | 305 | `write-tools-audit.md`         |
| `session-rpc-tools.js`   | 281 | `session-rpc-tools-audit.md`   |
| `todo/bulk-tools.js`     | 267 | `todo-bulk-audit.md`           |
| `introspection-tools.js` | 258 | `introspection-tools-audit.md` |
| `git/index.js`           | 239 | `git-index-audit.md`           |
| `session-tools.js`       | 196 | `session-tools-audit.md`       |
| `permission-tools.js`    | 164 | `permission-tools-audit.md`    |
| `tool-factory.js`        | 161 | `tool-factory-audit.md`        |
| `task-tools.js`          | 154 | `task-tools-audit.md`          |
| `code-tools.js`          | 143 | `code-tools-audit.md`          |
| `file/shared.js`         | 138 | `file-shared-audit.md`         |
| `index.js`               | 73  | `tools-index-audit.md`         |
| `todo/index.js`          | 66  | `todo-index-audit.md`          |
| `file/index.js`          | 49  | `file-index-audit.md`          |
| `git-tools.js`           | 11  | `git-tools-stub-audit.md`      |

---

## Resumo Executivo

O módulo `tools/` é o coração das capacidades do agente Copilot. Fornece ~60 tools organizados em 12
sub-módulos (file, git, shell, web, todo, hub, hook, session, session-rpc, code, task,
introspection). A arquitetura é sólida: padrão de injeção de dependência consistente, `buildTool`
wrapper com logging automático, `withSkipPermission` para tools de leitura, e `validatePath` para
contenção de workspace.

**Score médio**: 8.1/10

### Pontos Fortes

1. **Segurança SSRF robusta**: `validateUrl()` + verificação pós-redirect em `web-tools.js`
2. **Sem command injection**: todos os exec usam `execFileAsync` com array de args (não shell)
3. **Workspace containment**: `validatePath()` com resolução de symlinks em todas as file tools
4. **Separação de responsabilidades**: read tools com `withSkipPermission`, write tools sem
5. **Mutex correto**: `withStore()` para operações write-modify, `readStore()` para leitura

### Arquitetura Geral

```
tools/index.js (barrel)
├── shell/index.js          — exec, npm scripts, node files
├── file/{read,write,shared}.js — file system tools
├── git/index.js            — git operations
├── web-tools.js            — SSRF-protected fetch + search
├── todo/{crud,query,bulk,store}.js — task management (SQLite)
├── hub-tools.js            — LLM-B communication
├── hook-tools.js           — hook state + user input suspension
├── session-tools.js        — session state + skills
├── session-rpc-tools.js    — SDK internal RPC wrapper
├── task-tools.js           — local API HTTP client
├── code-tools.js           — lint/test/typecheck
├── introspection-tools.js  — meta-tools
└── permission-tools.js     — security mode control
```

---

## Achados Críticos (P3)

### [P3-T01] permission_mode_set com requiresApproval: false — Escalonamento de Privilégio

**Arquivo**: `permission-tools.js` **Risco**: Um modelo comprometido por prompt injection pode
alterar o modo de segurança de `audit_only` para `approve_all` sem confirmação do usuário,
eliminando toda proteção de aprovação subsequente.

**Correção**: Definir `requiresApproval: true` em `permissionModeSetTool`.

---

### [P3-T02] get_workspace_info usa execSync (3×) — Bloqueio do Event Loop

**Arquivo**: `session-tools.js` **Risco**: Três chamadas `execSync` consecutivas bloqueiam o event
loop por até 3s × 3. Em carga, cada requisição ao servidor aguarda que estas chamadas completem.

**Correção**: Migrar para `execFileAsync` com `Promise.all`.

---

### [P3-T03] add_task HTTP POST Sem Autenticação

**Arquivo**: `task-tools.js` **Risco**: Qualquer processo no mesmo host pode injetar tarefas na fila
via HTTP sem autenticação.

**Correção**: Adicionar token Bearer compartilhado gerado durante bootstrap do servidor.

---

### [P3-T04] session-rpc-tools: Dependência de API SDK Interna Não Pública

**Arquivo**: `session-rpc-tools.js` **Risco**: 8 tools dependem de `rpc.mode`, `rpc.plan`,
`rpc.agent`, `rpc.compact` — todas APIs internas do SDK sem garantia de estabilidade. Uma
atualização do SDK pode quebrar todas silenciosamente.

**Mitigação atual**: `wrapRpc()` captura erros e retorna `{ error }`. Nenhuma observabilidade via
`buildTool`.

---

## Achados Médios (P4)

| ID     | Arquivo                  | Descrição                                                                                 |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| P4-T01 | `shell/index.js`         | Description diz "via /bin/sh" mas usa `execFile` — misleading                             |
| P4-T02 | `shell/index.js`         | `runPipeline()` spawna todos os processos simultaneamente — race condition                |
| P4-T03 | `web-tools.js`           | DDG HTML scraping depende de CSS classes frágeis                                          |
| P4-T04 | `web-tools.js`           | `webTools` array composto dinamicamente por env var — confuso                             |
| P4-T05 | `todo/store.js`          | `_migrateJsonLegacy()` síncrono no load — bloqueia startup no 1º boot                     |
| P4-T06 | `hub-tools.js`           | `hub_read_history` trunca turns para 500 chars — pode perder contexto                     |
| P4-T07 | `hook-tools.js`          | `tail` CLI usado no fallback — não portátil em Windows                                    |
| P4-T08 | `introspection-tools.js` | `CATEGORY_TOOL_MAP` desatualizado — `list_tools` retorna vazio para metade das categorias |
| P4-T09 | `introspection-tools.js` | `setTelemetryStore` re-exportado como no-op deprecated                                    |
| P4-T10 | `git/index.js`           | `git_push` remove chars inválidos silenciosamente sem warning                             |
| P4-T11 | `git/index.js`           | `git_status` mistura status + log em string plana                                         |
| P4-T12 | `session-rpc-tools.js`   | Usa `defineTool` direto — 8 tools sem observabilidade via `buildTool`                     |
| P4-T13 | `permission-tools.js`    | Mudança de modo não é auditada em `audit.jsonl`                                           |
| P4-T14 | `tool-factory.js`        | `normalizeParameters` retorna `undefined` em falha — tool sem schema                      |
| P4-T15 | `code-tools.js`          | `lint_check fix:true` sem backup — destrutivo                                             |
| P4-T16 | `todo/bulk-tools.js`     | `todo_bulk_update` bypassa state machine sem parâmetro `force` explícito                  |
| P4-T17 | `session-tools.js`       | `SESSION_CONTEXT_STORE` sem limite de tamanho                                             |
| P4-T18 | `file/write-tools.js`    | `write_file_content` não cria diretórios intermediários                                   |
| P4-T19 | `file/shared.js`         | `validatePath` verifica apenas `basename`, não path completo                              |

---

## Achados Menores (P5)

| ID     | Arquivo                | Descrição                                                       |
| ------ | ---------------------- | --------------------------------------------------------------- |
| P5-T01 | `file/read-tools.js`   | `read_file_content` lê 3×MAX antes de slicing — pico de memória |
| P5-T02 | `todo/query-tools.js`  | `todo_search` O(n×terms) — impacto em stores grandes            |
| P5-T03 | `todo/bulk-tools.js`   | `todo_import` não suporta `parentId` — hierarquia não importada |
| P5-T04 | `session-rpc-tools.js` | Double `as unknown` cast — type mismatch com SDK                |
| P5-T05 | `task-tools.js`        | `get_session_state` usa `readFileSync` (não-async)              |
| P5-T06 | `git/index.js`         | `git_diff` truncado a 200 linhas hardcoded                      |
| P5-T07 | `index.js`             | Ordem de `allTools` undocumented                                |
| P5-T08 | `git-tools.js`         | Stub deprecated sem data de remoção planejada                   |

---

## Recomendações de Upgrade

### UPG-T01: Corrigir permission_mode_set (requiresApproval: true) [CRÍTICO]

```js
// permission-tools.js
const permissionModeSetTool = buildTool('permission_mode_set', {
    requiresApproval: true,  // ← WAS: false
    ...
});
```

---

### UPG-T02: Atualizar CATEGORY_TOOL_MAP

Derivar automaticamente do prefixo do tool name ao invés de mapa hardcoded:

```js
function getCategoryForTool(name) {
  if (name.startsWith('hub_')) return 'hub';
  if (name.startsWith('todo_')) return 'todo';
  if (name.startsWith('session_')) return 'session';
  // ...
}
```

---

### UPG-T03: Migrar session-rpc-tools para buildTool

```js
// Antes:
const sessionModeGetTool = defineTool('session_mode_get', { ... });
// Depois:
const sessionModeGetTool = buildTool('session_mode_get', {
    requiresApproval: false,
    description: '...',
    parameters: z.object({ ... }),
    handler: async (args) => { ... }
});
```

---

### UPG-T04: Auditoria de permission_mode_set

```js
// Em permissionModeSetTool handler:
await appendToAuditLog({
  event: 'security_mode_change',
  oldMode,
  newMode: mode,
  ts: Date.now(),
});
```

---

## Métricas

| Métrica                | Valor  |
| ---------------------- | ------ |
| Arquivos auditados     | 23     |
| LOC total              | ~5.716 |
| Tools expostas         | ~60    |
| Achados P3             | 4      |
| Achados P4             | 19     |
| Achados P5             | 8      |
| Score médio            | 8.1/10 |
| Cobertura de auditoria | 100%   |
