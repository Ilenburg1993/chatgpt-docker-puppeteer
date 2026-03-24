# Sprint: Terminal Permanente LLM-B

**Data início**: 2026-01-27
**Data última atualização**: 2026-03-25
**Versão do Plano**: v2.0 — Fase 5 (GitHub + Terminal Avançado)
**Status**: ✅ Fases 1-4 Concluídas — Fase 5 Em Execução
**Commit base Fase 5**: `d83aaacb`
**Autor**: LLM-A (GitHub Copilot)

---

## Objetivo Geral

Criar um **terminal de missão crítica** para o sistema AI, que combine:

- Conversa direta com LLM-B em sessão permanente
- Integração profunda com GitHub (issues, PRs, CI/CD)
- Operações Git integradas
- Interface REPL avançada com histórico persistente, aliases, paginação
- HTTP inject server para automação externa
- SSE stream para dashboards e observabilidade

---

## Histórico de Fases

### ✅ Fase 1 — Bootstrap do Terminal (Concluída)
- Terminal REPL conectado à LLM-B via `always-alive.js`
- `POST /inject` endpoint funcional
- Protocolo READY:/REPLY:/DONE:/STOPPED com filtro no readline
- BANNER inicial, /status, /history, /who, /clear, /restart, /quit

### ✅ Fase 2 — Integração Hub + PM2 (Concluída)
- ConversationHub com SQLite para persistência de sessões
- `hub_session_id` criado no start, passado para `always-alive`
- `/db-history [n]` para consultar SQLite diretamente
- PM2 ecosystem para processo permanente

### ✅ Fase 3 — SSE + Observabilidade (Concluída)
- `GET /events` — SSE stream com eventos: reply, ready, stalled, system
- `GET /events?level=critical` — filtro de eventos críticos
- `broadcastSse(event, data)` para propagação
- Watchdog de 5 minutos (P1)

### ✅ Fase 4 — Memória Semântica + Pipeline + UI (Concluída)
- **P5**: Semantic memory (`copilot_memories` + FTS5): `/remember`, `/recall`, `/forget`
- **P6**: Pipeline orchestration (`POST /pipeline`, steps sequenciais)
- **P7**: Reflection loop automático (env `LLM_B_REFLECTION_INTERVAL_MIN`)
- **P8**: SSE crítico (`_sseCriticalClients`, `?level=critical`)
- **P9**: `/db-sessions` + `GET /sessions` + `GET /sessions/:id/turns`
- **P10**: UI ANSI colorida (printExchange, BANNER cyan, cmdStatus visual)
- **Q1**: `DELETE /memory/:id` + `/forget <id>`
- **Q2**: `/count` (estatísticas de turnos e memórias)

---

## Fase 5 — GitHub CLI Integration + Terminal Avançado

**Meta**: Transformar o terminal de "REPL primitivo" em terminal de missão completo,
com integração nativa com o repositório GitHub, operações Git, e features avançadas de UX.

### Arquitetura da Fase 5

```
terminal-server.js
  ├── REPL dispatcher
  │     ├── /gh <cmd>    → gh-bridge.js → execFile('gh', [...])
  │     ├── /git <cmd>   → git-bridge.js → execFile('git', [...])
  │     └── /alias <cmd> → alias-store.js → resolve → dispatch
  ├── HTTP server (3009)
  │     ├── /gh/issues, /gh/prs, /gh/ci → gh-bridge.js
  │     └── /git/status, /git/log       → git-bridge.js
  └── SSE (push notifications de issues/PRs/CI)
```

---

### P11 — GitHub CLI Bridge (`gh-bridge.js`)

**Arquivo**: `src/copilot/gh-bridge.js`

**Objetivo**: Módulo auxiliar que encapsula todas as chamadas ao `gh` CLI,
retornando objetos JS estruturados. Usa `execFile` (não `exec`) para segurança.

**API pública do módulo:**

```js
// Issues
export async function listIssues(opts)             // → IssueItem[]
export async function viewIssue(number)            // → IssueDetail
export async function createIssue(title, body, opts) // → { url }
export async function closeIssue(number, reason)   // → void
export async function commentIssue(number, body)   // → void

// Pull Requests
export async function listPrs(opts)               // → PrItem[]
export async function viewPr(number)              // → PrDetail
export async function diffPr(number)              // → string (diff text)
export async function mergePr(number, opts)        // → void

// Actions/CI
export async function listRuns(opts)              // → RunItem[]
export async function viewRun(runId)              // → RunDetail
export async function watchRun(runId, cb)          // → void (polling)
export async function cancelRun(runId)             // → void
export async function rerunRun(runId)              // → void

// Releases
export async function listReleases(opts)           // → ReleaseItem[]
export async function viewRelease(tag)             // → ReleaseDetail

// Search
export async function searchIssues(query, opts)   // → SearchItem[]
export async function searchCode(query, opts)      // → CodeSearchItem[]

// Misc
export async function getStatus()                  // → StatusItem[] | null (403 fallback)
export async function getDefaultRepo()             // → string "owner/repo"
export async function rawApi(endpoint, opts)       // → any (JSON)
```

**Flags `gh` usados por tipo:**

```bash
# Issues
gh issue list  --json number,title,state,labels,author,createdAt,updatedAt --limit 15
gh issue view  <n> --json number,title,body,state,labels,author,comments,url
gh issue create --title "X" --body "Y" [--label L] --json url

# PRs
gh pr list  --json number,title,state,headRefName,author,isDraft,createdAt,mergeable --limit 15
gh pr view  <n> --json number,title,body,state,statusCheckRollup,reviews,author,url
gh pr diff  <n>    (sem --json, retorna diff text)
gh pr merge <n> [--squash|--merge|--rebase] --yes

# Runs
gh run list  --json databaseId,name,status,conclusion,event,createdAt,headBranch --limit 10
gh run view  <runId> --json name,status,conclusion,jobs,url
gh run watch <runId>   (sem --json, stream de progresso)
gh run cancel <runId>
gh run rerun <runId>

# Releases
gh release list --json tagName,name,isPrerelease,publishedAt --limit 10
gh release view <tag> --json tagName,name,body,publishedAt,assets

# Search
gh search issues "<query>" --json number,title,repository,state,url --limit 15
gh search code  "<query>" --json path,repository,textMatches --limit 10
```

**Tratamento de erros:**
- Output vazio → retorna array vazio / objeto null
- `403` / `Unauthorized` no stderr → fallback gracioso com mensagem
- Timeout 15s por execução (configável por env `LLM_B_GH_TIMEOUT_MS`)

**Env vars:**
- `LLM_B_GH_TIMEOUT_MS` — timeout por chamada gh CLI (default: 15000)
- `LLM_B_GH_DEFAULT_REPO` — repo padrão (ex: `owner/repo`; auto-detect se vazio)

---

### P12 — REPL: Comandos `/gh *`

**Arquivo**: `src/copilot/terminal-server.js` (novos cases no switch)

**Comandos novos:**

```
/gh issue list [--label X] [--state open|closed|all]
/gh issue <n>               → ver issue completa (título+body+labels+URL)
/gh issue create            → wizard interativo (título → body → [labels])
/gh issue close <n>         → fechar com confirmação

/gh pr list [--state open|closed|merged]
/gh pr <n>                  → ver PR (título+body+checks+branch+URL)
/gh pr diff <n>             → mostrar diff no terminal
/gh pr merge <n> [--squash|--rebase]
/gh pr checks <n>           → listar status dos CI checks do PR

/gh run list                → últimos runs (status colorido: ✅❌⏳)
/gh run <id>                → ver run detalhado (jobs)
/gh run watch <id>          → acompanhar progresso em tempo real (polling)
/gh run cancel <id>         → cancelar run
/gh run rerun <id>          → re-executar run

/gh release list            → últimas releases
/gh release <tag>           → ver release details

/gh search <query>          → busca issues + PRs no repo
/gh search code <query>     → busca em código

/gh status                  → notificações/menções (ou graceful fallback 403)

/gh api <endpoint>          → chamada raw ao GitHub API (output JSON formatado)
```

**Display formatado (ANSI):**

```
Issues:
  #42  [open]  feat: implementar webhook  [enhancement]  por alice  há 3d
  #38  [open]  bug: crash no kernel       [bug critical]  por bob   há 7d

PRs:
  #15  [open]  feat: novo driver  main←feature/driver  ✅ CI  por alice  rascunho?

Runs:
  #8842  CI Pipeline  ✅ success  push→main  há 2h
  #8841  CI Pipeline  ❌ failure  push→main  há 5h
  #8840  CI Pipeline  ⏳ in_progress  push→feature  há 10m
```

---

### P13 — REPL: Comandos `/git *`

**Arquivo**: `src/copilot/git-bridge.js` (novo) + `terminal-server.js`

**Objetivo**: Operações Git comuns acessíveis diretamente do REPL.

**Comandos:**

```
/git status           → arquivos modificados/staged/unstaged (colorido)
/git log [n]          → últimos N commits (default 10) com hash, autor, data, msg
/git log --oneline [n]→ formato compacto
/git diff [file]      → diff working tree (ou arquivo específico)
/git diff --staged    → diff staged changes
/git branch           → lista branches (atual em verde)
/git branch <name>    → cria nova branch (com confirmação)
/git checkout <name>  → troca de branch (com confirmação)
/git pull             → git pull da branch atual (com output)
/git push             → git push seguro
/git add <file|.>     → staging de arquivos
/git commit -m "msg"  → commit com mensagem
/git stash            → git stash (+ listar stash entries)
/git stash pop        → git stash pop
```

**API do módulo:**

```js
export async function gitStatus()          // → StatusEntry[]
export async function gitLog(n, oneline)   // → LogEntry[]
export async function gitDiff(opts)        // → string
export async function gitBranch()          // → BranchEntry[]
export async function gitCheckout(name)    // → string
export async function gitPull()            // → string
export async function gitPush(opts)        // → string
export async function gitAdd(paths)        // → void
export async function gitCommit(msg)       // → string (hash)
export async function gitStash(pop)        // → string
```

---

### P14 — Histórico Persistente do REPL

**Arquivo**: `src/copilot/terminal-server.js`

**Objetivo**: Histórico de comandos sobrevive a restarts.

**Implementação:**

```js
// Carregar histórico salvo ao inicializar readline
const historyFile = process.env.LLM_B_HISTORY_FILE
    ?? path.join(os.homedir(), '.copilot-terminal-history');
const historySize = parseInt(process.env.LLM_B_HISTORY_SIZE ?? '1000', 10);

function loadHistory() {
    try { return fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean); }
    catch { return []; }
}
function saveHistory(history) {
    fs.writeFileSync(historyFile, history.slice(0, historySize).join('\n'));
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize,
    history: loadHistory(),
    terminal: true,
});
rl.on('close', () => saveHistory(rl.history));
```

**Env vars:**
- `LLM_B_HISTORY_FILE` — caminho do arquivo (default: `~/.copilot-terminal-history`)
- `LLM_B_HISTORY_SIZE` — tamanho máximo (default: 1000)

---

### P15 — Sistema de Aliases

**Arquivo**: `src/copilot/alias-store.js` (novo) + `terminal-server.js`

**Objetivo**: Usuário pode criar atalhos para comandos longos.

**Comandos REPL:**

```
/alias                        → listar todos os aliases
/alias set <nome> <comando>   → criar alias
/alias rm <nome>              → remover alias
/alias reset                  → restaurar aliases padrão
```

**Aliases pré-definidos (built-in):**

```json
{
  "/issues": "/gh issue list",
  "/prs":    "/gh pr list",
  "/runs":   "/gh run list",
  "/ci":     "/gh run list",
  "/log":    "/git log",
  "/st":     "/git status",
  "/diff":   "/git diff",
  "/gst":    "/git status",
  "/glog":   "/git log 20"
}
```

**Persistência**: `~/.copilot-aliases.json` ou env `LLM_B_ALIASES_FILE`

---

### P16 — Endpoints HTTP para GitHub e Git

**Arquivo**: `src/copilot/terminal-server.js`

**Novos endpoints:**

```
GET  /gh/issues?state=open&limit=15&label=bug   → JSON array de issues
GET  /gh/issues/:n                              → JSON issue detail
POST /gh/issues                                 → body: {title, body, labels[]} → {url}
POST /gh/issues/:n/comment                      → body: {body} → {ok}
GET  /gh/prs?state=open&limit=15                → JSON array de PRs
GET  /gh/prs/:n                                 → JSON PR detail
GET  /gh/prs/:n/diff                            → text/plain diff
POST /gh/prs/:n/merge                           → body: {method} → {ok}
GET  /gh/ci?limit=10                            → JSON array de runs
GET  /gh/ci/:runId                              → JSON run detail
POST /gh/ci/:runId/cancel                       → {ok}
POST /gh/ci/:runId/rerun                        → {ok}
GET  /gh/releases?limit=10                      → JSON array releases
GET  /gh/releases/:tag                          → JSON release detail
GET  /gh/search?q=<query>&type=issues|prs|code  → JSON search results
GET  /gh/status                                 → JSON notificações / fallback
GET  /git/status                                → JSON status entries
GET  /git/log?n=10&oneline=true                 → JSON log entries
GET  /git/diff?staged=false&file=               → text/plain diff
GET  /git/branch                                → JSON branch list
```

---

### P17 — SSE: Push Notifications de GitHub

**Arquivo**: `src/copilot/terminal-server.js`

**Objetivo**: Polling periódico do GitHub para notificar novos issues/PRs/CI via SSE.

**Novos SSE event types:**

```
gh:issue:new     → { number, title, author, url }
gh:pr:new        → { number, title, author, branch }
gh:ci:update     → { runId, name, status, conclusion }
gh:ci:complete   → { runId, name, conclusion, url }
```

**Env vars:**
- `LLM_B_GH_POLL_INTERVAL_MIN` — intervalo de polling (default: 5)
- `LLM_B_GH_NOTIFICATIONS` — enable/disable (`true`|`false`, default: `true`)

---

## Ordem de Implementação (Fase 5)

| Prioridade | Item                              | Impacto | Complexidade |
| ---------- | --------------------------------- | ------- | ------------ |
| P1 (Alta)  | P11 — gh-bridge.js                | Alta    | Média        |
| P2 (Alta)  | P12 — REPL /gh *                  | Alta    | Média        |
| P3 (Alta)  | P13 — REPL /git * + git-bridge.js | Alta    | Baixa        |
| P4 (Alta)  | P14 — Histórico persistente       | Média   | Baixa        |
| P5 (Média) | P15 — Aliases                     | Média   | Baixa        |
| P6 (Média) | P16 — HTTP /gh/* /git/*           | Alta    | Média        |
| P7 (Média) | P17 — SSE Push Notifications      | Média   | Alta         |

---

## BANNER Atualizado (pós-Fase 5)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║         Terminal LLM-B — Sessão Permanente  ·  GitHub + Git + AI           ║
╚══════════════════════════════════════════════════════════════════════════════╝
  Conversa:  <texto>  ·  /status · /history · /db-history · /db-sessions
             /remember · /recall · /forget · /count · /who · /clear
  GitHub:    /gh issue list|<n>|create · /gh pr list|<n>|diff|merge|checks
             /gh run list|<id>|watch   · /gh search <q> · /gh status
  Git:       /git status · /git log · /git diff · /git branch · /git pull
  Atalhos:   /issues · /prs · /runs · /ci · /log · /st · /diff
             /alias [set|rm|reset]
  Injeção:   POST  http://localhost:3009/inject
  SSE:       GET   http://localhost:3009/events[?level=critical]
  GitHub:    GET   http://localhost:3009/gh/issues|prs|ci|releases|search
  Git API:   GET   http://localhost:3009/git/status|log|diff|branch
  Memória:   POST/GET/DELETE http://localhost:3009/memory
```

---

## Variáveis de Ambiente — Referência Completa (Fases 1-5)

| Variável                        | Default                       | Descrição                           |
| ------------------------------- | ----------------------------- | ----------------------------------- |
| `LLM_B_TERMINAL_PORT`           | `3009`                        | Porta do servidor HTTP              |
| `LLM_B_WATCHDOG_INTERVAL_MS`    | `30000`                       | Intervalo do watchdog               |
| `LLM_B_WATCHDOG_STALL_MS`       | `300000`                      | Timeout para dialog stalled (5min)  |
| `LLM_B_REFLECTION_INTERVAL_MIN` | `0` (off)                     | Intervalo de reflexão automática    |
| `LLM_B_GH_TIMEOUT_MS`           | `15000`                       | Timeout de chamadas gh CLI          |
| `LLM_B_GH_DEFAULT_REPO`         | auto-detect                   | Repo padrão (`owner/repo`)          |
| `LLM_B_GH_POLL_INTERVAL_MIN`    | `5`                           | Intervalo de polling GitHub via SSE |
| `LLM_B_GH_NOTIFICATIONS`        | `true`                        | Habilitar polling de notificações   |
| `LLM_B_HISTORY_FILE`            | `~/.copilot-terminal-history` | Arquivo de histórico REPL           |
| `LLM_B_HISTORY_SIZE`            | `1000`                        | Tamanho máximo do histórico         |
| `LLM_B_ALIASES_FILE`            | `~/.copilot-aliases.json`     | Arquivo de aliases customizados     |

---

## Checklist de Implementação (Fase 5)

### P11 — gh-bridge.js
- [ ] `listIssues(opts)` com `--json` e timeout
- [ ] `viewIssue(n)` com body formatado
- [ ] `createIssue(title, body, opts)` retorna URL
- [ ] `closeIssue(n)` / `commentIssue(n, body)`
- [ ] `listPrs(opts)` com metadata CI
- [ ] `viewPr(n)` com statusCheckRollup
- [ ] `diffPr(n)` retorna texto diff
- [ ] `mergePr(n, method)` com --yes
- [ ] `listRuns(opts)` com ícones de status
- [ ] `viewRun(id)` com jobs list
- [ ] `watchRun(id, cb)` polling até conclusão
- [ ] `cancelRun(id)` / `rerunRun(id)`
- [ ] `listReleases(opts)` / `viewRelease(tag)`
- [ ] `searchIssues(q)` / `searchCode(q)`
- [ ] `getStatus()` com fallback 403
- [ ] `getDefaultRepo()` via `gh repo view`
- [ ] `rawApi(endpoint)` para chamadas custom
- [ ] Timeout configurável via env
- [ ] Usar `execFile` (não `exec`), sem shell injection

### P12 — REPL /gh *
- [ ] `/gh issue list` com tabela ANSI
- [ ] `/gh issue <n>` com body + labels + URL
- [ ] `/gh issue create` wizard interativo
- [ ] `/gh pr list` com estado CI
- [ ] `/gh pr <n>` detalhado
- [ ] `/gh pr diff <n>` com highlighting básico
- [ ] `/gh pr merge <n>` com método
- [ ] `/gh pr checks <n>`
- [ ] `/gh run list` com ícones coloridos
- [ ] `/gh run <id>` detalhado
- [ ] `/gh run watch <id>` polling ao vivo
- [ ] `/gh run cancel <id>` / `/gh run rerun <id>`
- [ ] `/gh release list` e `/gh release <tag>`
- [ ] `/gh search <q>` combinado
- [ ] `/gh search code <q>`
- [ ] `/gh status` com fallback
- [ ] `/gh api <endpoint>` raw

### P13 — REPL /git * + git-bridge.js
- [ ] `gitStatus()` com cores por estado
- [ ] `gitLog(n)` com formato legível
- [ ] `gitDiff(opts)` com linha count
- [ ] `gitBranch()` com branch atual destacada
- [ ] `gitCheckout(name)` com confirmação
- [ ] `gitPull()` / `gitPush(opts)` com saída
- [ ] `gitAdd()` / `gitCommit()` / `gitStash()`
- [ ] REPL: `/git status|log|diff|branch|checkout|pull|push|add|commit|stash`

### P14 — Histórico Persistente
- [ ] `loadHistoryFromFile()` no init do readline
- [ ] `saveHistoryToFile(rl.history)` no `close`
- [ ] Env `LLM_B_HISTORY_FILE` e `LLM_B_HISTORY_SIZE`

### P15 — Aliases
- [ ] `alias-store.js` com load/save JSON
- [ ] Aliases built-in: /issues, /prs, /runs, /ci, /log, /st, /diff
- [ ] REPL: `/alias`, `/alias set`, `/alias rm`, `/alias reset`
- [ ] Resolver alias no dispatcher ANTES do switch

### P16 — HTTP /gh/* /git/*
- [ ] `GET /gh/issues`, `GET /gh/issues/:n`
- [ ] `POST /gh/issues`, `POST /gh/issues/:n/comment`
- [ ] `GET /gh/prs`, `GET /gh/prs/:n`, `GET /gh/prs/:n/diff`
- [ ] `POST /gh/prs/:n/merge`
- [ ] `GET /gh/ci`, `GET /gh/ci/:runId`
- [ ] `POST /gh/ci/:runId/cancel`, `POST /gh/ci/:runId/rerun`
- [ ] `GET /gh/releases`, `GET /gh/releases/:tag`
- [ ] `GET /gh/search`
- [ ] `GET /git/status`, `GET /git/log`, `GET /git/diff`, `GET /git/branch`

### P17 — SSE Push Notifications
- [ ] Polling interval configurável
- [ ] Estado interno `_ghLastKnown` para diff de novidades
- [ ] Eventos SSE: `gh:issue:new`, `gh:pr:new`, `gh:ci:update`, `gh:ci:complete`
- [ ] Env `LLM_B_GH_POLL_INTERVAL_MIN`, `LLM_B_GH_NOTIFICATIONS`

---

## Diagrama de Componentes (Fase 5)

```
┌─────────────────────────────────────────┐
│            Terminal LLM-B               │
│  terminal-server.js (REPL + HTTP 3009)  │
│                                         │
│  ┌───────────────┐  ┌─────────────────┐ │
│  │  REPL /gh *   │  │   REPL /git *   │ │
│  └───────┬───────┘  └────────┬────────┘ │
│          │                   │          │
│  ┌───────▼───────┐  ┌────────▼────────┐ │
│  │  gh-bridge.js │  │ git-bridge.js   │ │
│  │  execFile(gh) │  │ execFile(git)   │ │
│  └───────┬───────┘  └────────┬────────┘ │
│          │                   │          │
│  ┌───────▼───────────────────▼────────┐ │
│  │        alias-store.js              │ │
│  │    (resolve aliases → dispatch)    │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │   SSE Push (P17) — polling       │   │
│  │   → broadcastSse()               │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
           │                   │
     ┌─────▼─────┐       ┌─────▼─────┐
     │  gh CLI   │       │  git CLI  │
     └─────┬─────┘       └─────┬─────┘
           │                   │
     ┌─────▼───────────────────▼──────┐
     │    GitHub API / Local Repo     │
     └────────────────────────────────┘
```

---

## Métricas de Sucesso

- Terminal com 40+ comandos REPL (atual Fase 4: 14 comandos)
- Integração gh CLI com 20+ subcomandos (/gh issue, pr, run, search, release, api)
- Integração git com 10+ operações (/git status, log, diff, branch, pull, push…)
- Histórico persistente (sobrevive restarts via arquivo)
- HTTP endpoints cobrindo GitHub e Git (20+ rotas)
- SSE com eventos GitHub (issues/PRs/CI updates)
- Sistema de aliases com built-ins e customização
- Zero erros TypeScript no typecheck
- Zero erros ESLint

---

*Última atualização: 2026-03-25 — Plano v2.0 escrito por LLM-A*
