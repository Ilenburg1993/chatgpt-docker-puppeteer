# Terminal Permanente LLM-B — Guia Completo

**Versão**: 5.0 (Fase 5 — GitHub CLI bridge, git bridge, alias store, novos comandos REPL e
endpoints HTTP) **Última atualização**: 2026-03-24 **Módulo**: `src/copilot/terminal-server.js`
**Porta inject**: `3009` (configurável via `LLM_B_TERMINAL_PORT`)

---

## O que é

O **Terminal Permanente LLM-B** é um processo Node.js que mantém uma sessão de diálogo
permanentemente aberta com a **LLM-B** (GPT-4.1 via GitHub Copilot SDK). Três atores podem interagir
em tempo real:

| Ator                       | Canal                                   | Como                                             |
| -------------------------- | --------------------------------------- | ------------------------------------------------ |
| **Você (Usuário)**         | stdin/stdout REPL                       | Digitando no terminal VS Code                    |
| **LLM-A (GitHub Copilot)** | `POST :3009/inject` ou `injectToLlmB()` | Injeção programática (módulo `inject-llmb.js`)   |
| **Clientes SSE**           | `GET :3009/events`                      | Stream proativo de respostas (`subscribeLlmB()`) |

Cada turno é persistido no SQLite (`data/copilot.db`) e sobrevive a restarts.

---

## Arquitetura atual (Fase 5)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Terminal Permanente LLM-B (Fase 5)                   │
│                                                                         │
│  stdin REPL ── /gh /git /alias /help ─────────────────────────────┐    │
│  POST :3009/inject ────────────────────────────────────────────►  │    │
│  POST :3009/pipeline ─────────────────────────────────────────►   │    │
│  GET  :3009/gh/issues|prs|ci ──────────────── gh-bridge.js        │    │
│  GET  :3009/git/status|log ────────────────── git-bridge.js       │    │
│                                                                    │    │
│                                                     sendTurn()    │    │
│                                                          │         │    │
│                                               ┌────────────────┐  │    │
│                                               │llmBridgeClient │  │    │
│                                               │ .dialogTurn()  │  │    │
│                                               └───────┬────────┘  │    │
│                                                       │            │    │
│                                               ┌───────▼────────┐  │    │
│                                               │AlwaysAliveAgent│  │    │
│                                               │ Watchdog(5min) │  │    │
│                                               │ Reflection(opt)│  │    │
│                                               └───────┬────────┘  │    │
│                                                       │            │    │
│                                            @github/copilot-sdk     │    │
│                                               GPT-4.1 (LLM-B)     │    │
│                                                       │            │    │
│                      ┌────────────────────────────────┘            │    │
│                      │                                             │    │
│                printExchange()   conversationStore.writeTurn()     │    │
│                (stdout REPL)     (SQLite — sempre persistido)       │    │
│                      │                     │                       │    │
│                broadcastSse()    copilot_conversation_turns         │    │
│                (GET /events)     copilot_hub_sessions               │    │
│                                 copilot_memories (P5)              │    │
│                                                                         │
│  Novos módulos (Fase 5):                                                │
│    gh-bridge.js   — GitHub CLI wrapper (issues/PRs/CI/releases/search) │
│    git-bridge.js  — Git CLI wrapper (status/log/branch/diff/stash/…)   │
│    alias-store.js — Aliases customizáveis persistidos em .aliases.json  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Pré-requisitos

### 1. Autenticação GitHub

```bash
gh auth status
# Deve mostrar: ✓ Logged in to github.com account <USUARIO>
gh auth login # se necessário
```

### 2. Variáveis de ambiente

```bash
COPILOT_SDK_ENABLED=true         # obrigatório
LLM_B_TERMINAL_PORT=3009         # porta inject (padrão: 3009)
LLM_B_TURN_TIMEOUT=120000        # timeout por turno em ms (padrão: 120s)
COPILOT_MODEL=gpt-4.1            # modelo (padrão: gpt-4.1)
LLM_B_BOOT_PROMPT="..."          # contexto inicial personalizado (opcional)
LLM_B_REFLECTION_INTERVAL_MIN=30 # ativa reflection loop (opt-in, padrão: desativado)
LLM_B_WATCHDOG_MS=300000         # intervalo watchdog em ms (padrão: 5min)
LLM_B_WATCHDOG_STALL_MS=900000   # limiar de inatividade para stalled (padrão: 15min)
```

---

## Como iniciar

### Recomendado — VS Code Task

`Ctrl+Shift+P` → **Tasks: Run Task** → **`terminal:llm-b`**

Aguarde ~15s até o prompt `você›` aparecer.

### Via npm

```bash
npm run terminal:llm-b
```

### Via PM2 (processo permanente)

```bash
COPILOT_TERMINAL_ENABLED=true COPILOT_SDK_ENABLED=true \
  npx pm2 start ecosystem.config.cjs --only llm-b-terminal

npx pm2 logs llm-b-terminal
npx pm2 stop llm-b-terminal
```

> Em modo PM2 não há stdin — use injeção HTTP.

---

## Interface do REPL

Banner atual:

```
╔══════════════════════════════════════════════════════════════════════════╗
║            Terminal LLM-B — Sessão Permanente Aberta                    ║
╚══════════════════════════════════════════════════════════════════════════╝
  /status · /history [n] · /db-history [n] · /db-sessions [n] · /who · /clear · /restart
  /remember [tag:] texto · /recall [tag] · /recall ?busca · /forget <id> · /count
  /gh issue list · /gh pr list · /gh run list · /git status · /git log · /alias · /help
  POST :3009/inject  ·  POST :3009/pipeline  ·  GET :3009/events  ·  GET :3009/sessions  ·  POST/GET :3009/memory
  GET :3009/gh/issues  ·  GET :3009/gh/prs  ·  GET :3009/gh/ci  ·  GET :3009/git/status  ·  GET :3009/git/log
```

---

## Comandos do REPL

| Comando                     | Descrição                                                             |
| --------------------------- | --------------------------------------------------------------------- |
| `/status`                   | Status: agente, dialog loop, hubSessionId, turnCount, inject port     |
| `/history [n]`              | Últimos N pares em memória (padrão: 10) — não persiste entre restarts |
| `/db-history [n]`           | Últimos N turnos persistidos no SQLite (padrão: 20)                   |
| `/db-sessions [n]`          | **(P9)** Últimas N hub_sessions persistidas (padrão: 10)              |
| `/remember [tag:] conteúdo` | **(P5)** Persiste memória semântica com tag livre                     |
| `/recall [tag]`             | **(P5)** Recupera memórias por tag                                    |
| `/recall ?busca textual`    | **(P5)** Busca FTS5 nas memórias                                      |
| `/forget <id>`              | **(Q1)** Remove memória por ID                                        |
| `/count`                    | **(Q2)** Estatísticas de uso da sessão (turnos, memórias, etc.)       |
| `/who`                      | Lista atores e canais disponíveis                                     |
| `/clear`                    | Limpa histórico em memória (SQLite mantido)                           |
| `/restart`                  | Reinicia o dialog loop manualmente                                    |
| `/gh <subcomando>`          | **(Fase 5)** Comandos GitHub CLI                                      |
| `/git <subcomando>`         | **(Fase 5)** Comandos git                                             |
| `/alias [list\|set\|rm]`    | **(Fase 5)** Gerenciar aliases de comandos                            |
| `/help`                     | **(Fase 5)** Ajuda completa de todos os comandos                      |
| `/quit` / `/exit`           | Encerra o terminal                                                    |

### Novos comandos da Fase 5

#### `/gh` — GitHub CLI integrado

```
/gh issue list [--state open|closed|all] [--limit N]
/gh issue view <número>
/gh issue create <título> [corpo]
/gh issue close <número>
/gh issue comment <número> <comentário>
/gh pr list [--state open|closed|merged|all] [--limit N]
/gh pr view <número>
/gh pr diff <número>
/gh run list [--limit N] [--workflow <nome>]
/gh run view <id>
/gh run watch <id>
/gh release list [--limit N]
/gh release view <tag>
/gh search issues <query>
/gh search code <query>
/gh status
/gh api <endpoint>
```

#### `/git` — git integrado

```
/git status
/git log [N]           — padrão: 20 commits
/git log --oneline [N] — formato compacto
/git branch
/git diff              — unstaged
/git diff --staged     — staged
/git pull
/git push [remote branch]
/git add <arquivo>
/git commit <mensagem>
/git stash
/git stash --pop
/git stash --message <msg>
/git stash list
```

#### `/alias` — aliases customizáveis

```
/alias                     — listar todos (built-in + customizados)
/alias list                — mesma coisa
/alias set <nome> <cmd>    — criar alias (ex: /alias set /issues /gh issue list)
/alias remove <nome>       — remover alias customizado
/alias reset               — restaurar aliases padrão

# Aliases embutidos
/issues → /gh issue list
/prs    → /gh pr list
/runs   → /gh run list
/ci     → /gh run list
/log    → /git log
/st     → /git status
/diff   → /git diff
```

### Exemplos

```
você› Analise src/copilot/ e liste os módulos
  🧠  LLM-B  [14:22:05] 4.2s
  Os principais módulos são: always-alive.js, terminal-server.js…

você› /remember arquitetura: LLM-B opera modo dialog loop via ask_user, 1 PR total
  ✓ Memória salva [arquitetura] a1b2c3d4…

você› /recall arquitetura
  Memórias [arquitetura]
  ─────────────────────────────────────────────
  [24/03/2026 14:23:00] arquitetura  LLM-B opera modo dialog loop…

você› /db-sessions 3
  Últimas 3 hub sessions
  ──────────────────────────────────────────────────────────────
  active  24/03/2026 14:20:00  a1b2c3d4  Terminal Permanente LLM-B ← atual
  closed  23/03/2026 09:15:00  e5f6g7h8  Terminal Permanente LLM-B
```

---

## Injeção HTTP — endpoints disponíveis

### `GET /health`

```bash
curl http://127.0.0.1:3009/health
# { "ok": true, "dialogLoopActive": true, "agentStatus": "waiting_for_input",
#   "busy": false, "hubSessionId": "...", "sseClients": 0 }
```

### `POST /inject` — turno único

```bash
curl -X POST http://127.0.0.1:3009/inject \
  -H 'Content-Type: application/json' \
  -d '{"message": "Execute npm run lint e informe erros.", "from": "llm-a"}'
# { "ok": true, "reply": "...", "durationMs": 18500, "from": "llm-a" }
```

### `POST /pipeline` — sequência de turnos (P6)

Executa múltiplos prompts em sequência. Se um step retornar null (LLM-B ocupada), o pipeline é
abortado com HTTP 409.

```bash
curl -X POST http://127.0.0.1:3009/pipeline \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "llm-a",
    "steps": [
      { "prompt": "Olá, você está disponível?", "waitMs": 0 },
      { "prompt": "Agora analise src/copilot/ e liste bugs potenciais." },
      { "prompt": "Gere um resumo executivo em 3 linhas.", "waitMs": 2000 }
    ]
  }'
# { "ok": true, "results": [
#   { "step": 1, "prompt": "...", "reply": "...", "durationMs": 12000 },
#   { "step": 2, ...},
#   { "step": 3, ...}
# ]}
```

### `GET /events` — SSE streaming (P3 + P8)

```bash
curl -N http://127.0.0.1:3009/events                  # todos os eventos
curl -N "http://127.0.0.1:3009/events?level=critical" # apenas stalled/fatal/system
```

**Eventos emitidos:**

| Evento    | Quando                              | Payload                        | Crítico |
| --------- | ----------------------------------- | ------------------------------ | ------- |
| `reply`   | LLM-B emite uma resposta            | `{ content, timestamp }`       | ❌      |
| `ready`   | Dialog loop pronto/reconectou       | `{ timestamp }`                | ❌      |
| `stalled` | Watchdog detectou inatividade       | `{ stalledMs }`                | ✅      |
| `system`  | Evento de sistema (reflection, etc) | `{ type, content, timestamp }` | ✅      |
| `fatal`   | Falha irrecuperável do SDK          | `{ message }`                  | ✅      |

### `GET /sessions` — listagem (P9)

```bash
curl "http://127.0.0.1:3009/sessions?limit=5"
# { "ok": true, "sessions": [...], "current": "<hubSessionId>" }
```

### `GET /sessions/:id/turns` — turnos de sessão (P9)

```bash
curl "http://127.0.0.1:3009/sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890/turns?limit=20"
# { "ok": true, "turns": [...], "sessionId": "..." }
```

### `POST /memory` — persistir memória (P5)

```bash
curl -X POST http://127.0.0.1:3009/memory \
  -H 'Content-Type: application/json' \
  -d '{"tag": "arquitetura", "content": "LLM-B usa 1 PR para todo o dialog loop"}'
# { "ok": true, "id": "uuid-gerado" }
```

### `GET /memory` — recuperar memórias (P5)

```bash
curl "http://127.0.0.1:3009/memory?tag=arquitetura&limit=10"
curl "http://127.0.0.1:3009/memory?search=dialog+loop&limit=5"
# { "ok": true, "memories": [{ "id", "tag", "content", "created_at", "hub_session_id" }] }
```

### `GET /gh/issues` — issues via gh CLI (Fase 5)

```bash
curl "http://127.0.0.1:3009/gh/issues?state=open&limit=15"
# { "ok": true, "issues": [...] }
```

### `GET /gh/prs` — pull requests via gh CLI (Fase 5)

```bash
curl "http://127.0.0.1:3009/gh/prs?state=open&limit=15"
# { "ok": true, "prs": [...] }
```

### `GET /gh/ci` — runs de CI via gh CLI (Fase 5)

```bash
curl "http://127.0.0.1:3009/gh/ci?limit=15"
# { "ok": true, "runs": [...] }
```

### `GET /git/status` — status do repositório (Fase 5)

```bash
curl "http://127.0.0.1:3009/git/status"
# { "ok": true, "entries": [{ "xy", "path", "label", "color" }] }
```

### `GET /git/log` — log de commits (Fase 5)

```bash
curl "http://127.0.0.1:3009/git/log?n=20"
# { "ok": true, "entries": [{ "hash", "abbrevHash", "authorName", "authorDate", "subject", "refNames" }] }
```

---

## Via módulo oficial `inject-llmb.js`

```javascript
import {
  injectToLlmB,
  checkLlmBHealth,
  subscribeLlmB,
  waitForLlmBReady,
} from '#copilot/inject-llmb';

// Health check
const { ok, ready, busy } = await checkLlmBHealth();

// Aguardar prontidão (com timeout)
await waitForLlmBReady({ maxWaitMs: 30_000 });

// Injetar turno único
const { reply, durationMs } = await injectToLlmB('Analise src/kernel/');
console.log(`LLM-B (${durationMs}ms):`, reply);

// Subscrever SSE
const sub = subscribeLlmB((evt) => {
  if (evt.type === 'reply') console.log('resposta:', evt.data.content.slice(0, 80));
  if (evt.type === 'stalled') console.warn('watchdog:', evt.data.stalledMs, 'ms');
});
sub.unsubscribe(); // quando terminar
```

---

## Watchdog (P1) — proteção contra travamentos

O `AlwaysAliveAgent` monitora o dialog loop continuamente. Parâmetros configuráveis:

- `LLM_B_WATCHDOG_MS` — intervalo de checagem (padrão: 5min)
- `LLM_B_WATCHDOG_STALL_MS` — inatividade para emitir `dialog.stalled` (padrão: 15min)

Ao detectar travamento:

1. Emite `dialog.stalled`
2. Persiste `[SISTEMA] Watchdog…` no Hub
3. Emite evento SSE `stalled`
4. Reinicia dialog loop automaticamente

---

## Memória Semântica (P5)

Tabela `copilot_memories` com FTS5 nativo. Use para salvar insights e contexto cross-session.

```bash
# Listar todas
sqlite3 data/copilot.db "SELECT tag, content FROM copilot_memories ORDER BY created_at DESC LIMIT 10;"

# Busca FTS5
sqlite3 data/copilot.db "SELECT content FROM copilot_memories_fts WHERE copilot_memories_fts MATCH 'dialog loop';"
```

---

## Pipeline de Turnos (P6)

`POST /pipeline` executa uma lista de prompts sequencialmente, com `waitMs` opcional entre steps.
Aborta na primeira falha (LLM-B ocupada → HTTP 409 com `results` parcial).

Ideal para: análises multi-etapa, geração de relatórios, workflows automatizados de LLM-A.

---

## Reflection Loop (P7)

Envio periódico automático de um meta-prompt de reflexão à LLM-B. Ativado via env var:

```bash
LLM_B_REFLECTION_INTERVAL_MIN=30 # reflexão a cada 30 minutos
```

A LLM-B faz uma auto-avaliação da conversa e o resultado é transmitido via SSE
`system { type: 'reflection' }`.

---

## Hub persistido — esquema SQLite

```sql
-- Sessões do hub
copilot_hub_sessions(id, sdk_session_id, title, status, metadata, created_at, updated_at)

-- Turnos de conversa
copilot_conversation_turns(
    id, hub_session_id, sdk_session_id, role,
    content, structured, tools_used, turn_number,
    created_at, duration_ms, model, user_read, metadata
)

-- Memórias semânticas (P5) + FTS5
copilot_memories(id, hub_session_id, tag, content, metadata, created_at, updated_at)
copilot_memories_fts  -- virtual table (triggers automáticos)
```

---

## Variáveis de ambiente (completo)

| Variável                        | Padrão     | Descrição                                       |
| ------------------------------- | ---------- | ----------------------------------------------- |
| `COPILOT_SDK_ENABLED`           | `false`    | **Obrigatório** — habilita subsistema copilot   |
| `COPILOT_TERMINAL_ENABLED`      | `false`    | Habilita processo PM2 `llm-b-terminal`          |
| `LLM_B_TERMINAL_PORT`           | `3009`     | Porta do servidor HTTP de injeção               |
| `LLM_B_TURN_TIMEOUT`            | `120000`   | Timeout (ms) por turno                          |
| `COPILOT_MODEL`                 | `gpt-4.1`  | Modelo LLM-B                                    |
| `LLM_B_BOOT_PROMPT`             | _(padrão)_ | Contexto inicial personalizado                  |
| `LLM_B_REFLECTION_INTERVAL_MIN` | `0`        | Intervalo do reflection loop em minutos (0=off) |
| `LLM_B_WATCHDOG_MS`             | `300000`   | Intervalo de checagem do watchdog (ms)          |
| `LLM_B_WATCHDOG_STALL_MS`       | `900000`   | Inatividade para emitir `dialog.stalled` (ms)   |

---

## Roadmap — status por fase

| Sprint | Upgrade                                    | Status    |
| ------ | ------------------------------------------ | --------- |
| P1     | Watchdog dialog loop                       | ✅ Fase 3 |
| P2     | `/db-history` (SQLite persistido)          | ✅ Fase 3 |
| P3     | SSE `/events` + `subscribeLlmB()`          | ✅ Fase 3 |
| P4     | Eventos sistema persistidos no Hub         | ✅ Fase 3 |
| P5     | Memória semântica (`/remember`, `/recall`) | ✅ Fase 4 |
| P6     | Pipeline de turnos (`POST /pipeline`)      | ✅ Fase 4 |
| P7     | Reflection loop automático                 | ✅ Fase 4 |
| P8     | Alertas SSE críticos (`?level=critical`)   | ✅ Fase 4 |
| P9     | Auditoria `/db-sessions` + `GET /sessions` | ✅ Fase 4 |
| P10    | UI terminal aprimorada (ANSI colors)       | ✅ Fase 4 |
| Q1     | `/forget <id>` — remover memória           | ✅ Fase 5 |
| Q2     | `/count` — estatísticas de uso             | ✅ Fase 5 |
| Q3     | GitHub CLI bridge (`/gh`)                  | ✅ Fase 5 |
| Q4     | Git bridge (`/git`)                        | ✅ Fase 5 |
| Q5     | Alias store (`/alias`)                     | ✅ Fase 5 |
| Q6     | Endpoints REST `/gh/*` e `/git/*`          | ✅ Fase 5 |
| Q7     | Dashboard web para Hub (Socket.io)         | 🔜 Fase 6 |
| Q8     | Export MD/JSON de sessão via REPL          | 🔜 Fase 6 |
| Q9     | `injectPipeline()` em inject-llmb.js       | 🔜 Fase 6 |
| Q10    | Diff visual colorizado no REPL             | 🔜 Fase 6 |
| Q6     | Multi-session switching (`/switch`)        | 🔜 Fase 5 |

---

## Troubleshooting

### Terminal trava em "Conectando ao agente…"

```bash
gh auth status            # precisa estar autenticado
echo $COPILOT_SDK_ENABLED # deve ser 'true'
```

### "Hub não disponível"

ConversationStore inicializa standalone. Verifique permissões de `data/`.

### Porta 3009 ocupada

```bash
lsof -i :3009
kill -9 <PID>
```

### Watchdog reiniciando em loop

```bash
npm run logs:follow # ou logs/terminal-server.log
```

---

## Referências

- Código: `src/copilot/terminal-server.js`
- Agente: `src/copilot/always-alive.js`
- Injeção LLM-A: `src/copilot/inject-llmb.js`
- Hub store: `src/copilot/conversation-hub/store.js`
- Arquitetura: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`

**Módulo**: `src/copilot/terminal-server.js`
