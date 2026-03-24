# Terminal Permanente LLM-B — Guia Completo

**Versão**: 3.0 (Fase 3 — Watchdog + Hub persistido + SSE + Memória)
**Última atualização**: 2026-03-24
**Módulo**: `src/copilot/terminal-server.js`
**Porta inject**: `3009` (configurável via `LLM_B_TERMINAL_PORT`)

---

## O que é

O **Terminal Permanente LLM-B** é um processo Node.js que mantém uma sessão de diálogo
permanentemente aberta com a **LLM-B** (GPT-4.1 via GitHub Copilot SDK). Três atores podem
interagir em tempo real:

| Ator                       | Canal                                  | Como                                                |
| -------------------------- | -------------------------------------- | --------------------------------------------------- |
| **Você (Usuário)**         | stdin/stdout REPL                      | Digitando no terminal VS Code                       |
| **LLM-A (GitHub Copilot)** | `POST :3009/inject` ou `injectToLlmB()` | Injeção programática (módulo `inject-llmb.js`)     |
| **Clientes SSE**           | `GET :3009/events`                     | Stream proativo de respostas (`subscribeLlmB()`)    |

Cada turno é persistido no SQLite (`data/copilot.db`) e sobrevive a restarts.

---

## Arquitetura atual (Fase 3)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Terminal Permanente LLM-B (Fase 3)               │
│                                                                     │
│  stdin REPL ───────────────────────────────────────────────────┐   │
│  POST :3009/inject ───────────────────────────────────────────►│   │
│                                                                 │   │
│                                                    sendTurn()  │   │
│                                                         │      │   │
│                                               ┌─────────────────┐  │
│                                               │ llmBridgeClient │  │
│                                               │  .dialogTurn()  │  │
│                                               └────────┬────────┘  │
│                                                        │           │
│                                               ┌────────▼────────┐  │
│                                               │ AlwaysAliveAgent│  │
│                                               │  +Watchdog(5min)│  │
│                                               └────────┬────────┘  │
│                                                        │           │
│                                            @github/copilot-sdk     │
│                                                  GPT-4.1 (LLM-B)  │
│                                                        │           │
│                        ┌───────────────────────────────┘           │
│                        │                                           │
│                  printExchange()     conversationStore.writeTurn() │
│                  (stdout REPL)       (SQLite — sempre persistido)   │
│                        │                     │                     │
│                  broadcastSse()      copilot_conversation_turns     │
│                  (GET /events)       hub_sessions                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Pré-requisitos

### 1. Autenticação GitHub

```bash
gh auth status
# Deve mostrar: ✓ Logged in to github.com account <USUARIO>

# Se necessário:
gh auth login
```

### 2. Conta com acesso ao GitHub Copilot

A conta precisa ter Copilot habilitado (Individual, Business ou Enterprise).

### 3. Variáveis de ambiente (todas opcionais, exceto `COPILOT_SDK_ENABLED`)

```bash
COPILOT_SDK_ENABLED=true         # obrigatório
LLM_B_TERMINAL_PORT=3009         # porta inject (padrão: 3009)
LLM_B_TURN_TIMEOUT=120000        # timeout por turno em ms (padrão: 120s)
COPILOT_MODEL=gpt-4.1            # modelo (padrão: gpt-4.1)
LLM_B_BOOT_PROMPT="..."          # contexto inicial do dialog loop
```

---

## Como iniciar

### Recomendado — VS Code Task

Abra o **Command Palette** (`Ctrl+Shift+P`) → **Tasks: Run Task** → **`terminal:llm-b`**

Aguarde ~15s até o prompt `você>` aparecer.

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
╠══════════════════════════════════════════════════════════════════════════╣
║  Comandos: /status · /history [n] · /db-history [n] · /who · /clear    ║
║  Injeção LLM-A: POST http://localhost:3009 /inject                      ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### Exemplos de conversa

```
você> Analise src/copilot/ e liste os arquivos principais
🧠 LLM-B: Os principais módulos são: always-alive.js, terminal-server.js…
   [4200ms]

[llm-a] → Quais os riscos de regressão se mudarmos o #processQueue?
🧠 LLM-B: Os principais riscos são: race condition no mutex…
   [28500ms]

você> /db-history 5
── DB-Histórico (últimos 5 turnos) ──
  [14:22:01] 👤 Analise src/copilot/ e liste os arquivos…
  [14:22:05] 🧠 Os principais módulos são: always-alive.js…
  [14:22:38] 🤖 [llm-a] → Quais os riscos de regressão…
  [14:23:06] 🧠 Os principais riscos são: race condition…
─────────────────────────────────
```

---

## Comandos do REPL

| Comando              | Descrição                                                               |
| -------------------- | ----------------------------------------------------------------------- |
| `/status`            | Status atual: agente, dialog loop ativo, hubSessionId, turnCount        |
| `/history [n]`       | Últimos N pares em memória (padrão: 10) — não persiste entre restarts   |
| `/db-history [n]`    | **Novo** — últimos N turnos persistidos no SQLite (padrão: 20)          |
| `/who`               | Lista atores e canais disponíveis                                       |
| `/clear`             | Limpa histórico em memória (SQLite mantido)                             |
| `/restart`           | Reinicia o dialog loop manualmente                                      |
| `/quit` / `/exit`    | Encerra o terminal                                                      |

> **Sobre `/answer`**: o comando `/answer <texto>` responde perguntas que a LLM-B fizer via
> `ask_user()`. Na prática, a LLM-B raramente usa esse mecanismo — prefere responder diretamente.
> Se aparecer a mensagem `Digite /answer <resposta>`, você pode responder com `/answer` ou
> simplesmente digitar texto normal (o comportamento é equivalente para a maioria dos casos).

### Ctrl+C

Pausa o readline mas **mantém o dialog loop ativo**. Para encerrar completamente, use `/quit`.

---

## Watchdog (P1) — proteção contra travamentos

O `AlwaysAliveAgent` monitora o dialog loop continuamente. Se não houver atividade por **5 minutos**
(configurável), o watchdog:

1. Emite o evento `dialog.stalled`
2. Persiste `[SISTEMA] Dialog loop reiniciado pelo watchdog` no Hub
3. Transmite evento SSE `stalled` para clientes conectados
4. Reinicia o dialog loop automaticamente

Logs típicos:

```
[watchdog] ⚠️  Dialog loop inativo há 302s — reiniciando automaticamente…
[boot] Dialog loop reiniciado pelo watchdog.
```

---

## Injeção HTTP (LLM-A → LLM-B)

### Via módulo oficial `inject-llmb.js` (recomendado)

```javascript
import { injectToLlmB, checkLlmBHealth, subscribeLlmB } from '#copilot/inject-llmb';

// Health check
const { ok, ready } = await checkLlmBHealth();

// Injetar e aguardar resposta
const { reply, durationMs } = await injectToLlmB('Analise src/kernel/ e aponte melhorias.');
console.log(`LLM-B (${durationMs}ms):`, reply);
```

### Via curl

```bash
curl -X POST http://127.0.0.1:3009/inject \
  -H 'Content-Type: application/json' \
  -d '{"message": "Execute npm run lint e informe erros.", "from": "llm-a"}'
```

### Via health check

```bash
curl http://127.0.0.1:3009/health
# {
#   "ok": true,
#   "dialogLoopActive": true,
#   "agentStatus": "waiting_for_input",
#   "busy": false,
#   "hubSessionId": "5966029b-...",
#   "sseClients": 0
# }
```

---

## Canal SSE (P3) — LLM-A ouve LLM-B em tempo real

**Novo em Fase 3**: a LLM-A pode subscrever eventos da LLM-B sem polling.

### Endpoint

```
GET :3009/events    →  text/event-stream
```

**Eventos emitidos:**

| Evento    | Quando                                      | Payload                              |
| --------- | ------------------------------------------- | ------------------------------------ |
| `reply`   | LLM-B emite uma resposta                    | `{ content: string, timestamp: ms }` |
| `ready`   | Dialog loop ficou pronto/reconectou         | `{ timestamp: ms }`                  |
| `stalled` | Watchdog detectou inatividade               | `{ stalledMs: number }`              |

### Via módulo oficial

```javascript
import { subscribeLlmB } from '#copilot/inject-llmb';

const sub = subscribeLlmB((evt) => {
    if (evt.type === 'reply') {
        console.log('LLM-B respondeu:', evt.data.content.slice(0, 80));
    }
    if (evt.type === 'stalled') {
        console.warn('LLM-B travou por', evt.data.stalledMs, 'ms — watchdog reiniciando');
    }
});

// Para desconectar:
sub.unsubscribe();
```

### Via curl (debug)

```bash
curl -N http://127.0.0.1:3009/events
# : connected
# event: ready
# data: {"timestamp":1742820600000}
# event: reply
# data: {"content":"Os principais módulos são...","timestamp":1742820634123}
```

---

## Hub persistido (P2 + P4) — histórico e eventos de sistema

Todos os turnos são gravados em `data/copilot.db`:

```
Tabela copilot_hub_sessions     → 1 registro por inicialização do terminal
Tabela copilot_conversation_turns → N turnos (user, llm_b, llm_a, [SISTEMA])
```

### Consultar via REPL

```
/db-history 20     → últimos 20 turnos com timestamp e emoji por role
```

### Consultar via SQLite

```bash
sqlite3 data/copilot.db "SELECT role, content FROM copilot_conversation_turns LIMIT 5;"
sqlite3 data/copilot.db "SELECT id, title, created_at FROM copilot_hub_sessions;"
```

### Eventos de sistema persistidos automaticamente

- Início do terminal → hub session criada
- Reconexão do SDK → `[SISTEMA] Session reconectada: <sessionId>`
- Falha fatal do SDK → `[SISTEMA] session.fatal após N tentativas: <erro>`
- Watchdog reiniciou → `[SISTEMA] Dialog loop reiniciado pelo watchdog.`

---

## Fluxo completo de dados

```
[Usuário digita]  [LLM-A inject]
       │                │
       └────────────────┘
                │
         sendTurn(message, actor)
                │
         ensureDialogLoop()
                │
         llmBridgeClient.dialogTurn(message)
                │
         AlwaysAliveAgent  ←── watchdog (5min)
                │
         @github/copilot-sdk → GPT-4.1
                │
             reply
                │
    ┌───────────┼────────────────┐
    │           │                │
printExchange()  writeTurn()  broadcastSse()
  (REPL stdout) (SQLite Hub)  (GET /events SSE)
```

---

## Variáveis de ambiente

| Variável                   | Padrão    | Descrição                                                |
| -------------------------- | --------- | -------------------------------------------------------- |
| `COPILOT_SDK_ENABLED`      | `false`   | **Obrigatório** — habilita o subsistema copilot          |
| `COPILOT_TERMINAL_ENABLED` | `false`   | Habilita o processo PM2 `llm-b-terminal`                 |
| `LLM_B_TERMINAL_PORT`      | `3009`    | Porta do servidor HTTP de injeção                        |
| `LLM_B_BOOT_PROMPT`        | _(vazio)_ | Contexto enviado ao iniciar o dialog loop                |
| `LLM_B_TURN_TIMEOUT`       | `120000`  | Timeout (ms) por turno                                   |
| `COPILOT_MODEL`            | `gpt-4.1` | Modelo LLM-B                                             |

---

## Roadmap — próximas fases

| Sprint | Upgrade                              | Status       |
| ------ | ------------------------------------ | ------------ |
| P1     | Watchdog dialog loop (5min)          | ✅ Fase 3    |
| P2     | `/db-history` (SQLite persistido)    | ✅ Fase 3    |
| P3     | SSE `/events` + `subscribeLlmB()`   | ✅ Fase 3    |
| P4     | Eventos sistema persistidos no Hub   | ✅ Fase 3    |
| P5     | Memória semântica (`/remember`, `/recall`) | 🔜 Fase 4 |
| P6     | Orquestração de pipelines (`POST /pipeline`) | 🔜 Fase 4 |
| P7     | Loop de reflexão automático          | 🔜 Fase 4    |
| P8     | Alertas proativos filtrados          | 🔜 Fase 4    |
| P9     | Auditoria `/db-sessions` + export MD | 🔜 Fase 4    |
| P10    | Interface terminal aprimorada        | 🔜 Fase 4    |

---

## Troubleshooting

### Terminal trava em "[boot] Ativando dialog loop…"

```bash
gh auth status              # precisa estar autenticado
echo $COPILOT_SDK_ENABLED   # deve ser 'true'
```

### "Hub não disponível"

O ConversationStore inicializa de forma standalone (sem servidor Express). Se houver erro, verifique
permissões do diretório `data/`.

### Porta 3009 ocupada

```bash
lsof -i :3009
kill -9 <PID>
```

### Watchdog reiniciando em loop

Indica que o dialog loop está travando mais de uma vez por 5 minutos. Verifique:

```bash
npm logs llm-b-terminal  # ou logs/terminal-server.log
```

---

## Referências

- Código: [src/copilot/terminal-server.js](../../src/copilot/terminal-server.js)
- Agente: [src/copilot/always-alive.js](../../src/copilot/always-alive.js)
- Injeção LLM-A: [src/copilot/inject-llmb.js](../../src/copilot/inject-llmb.js)
- Hub store: [src/copilot/conversation-hub/store.js](../../src/copilot/conversation-hub/store.js)
- Plano sprint: [PLANOS/SPRINT-TERMINAL-LLM-B.md](../PLANOS/SPRINT-TERMINAL-LLM-B.md)
- Arquitetura: [ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md)


---

## O que é

O **Terminal Permanente LLM-B** é um processo Node.js que mantém uma sessão de diálogo
permanentemente aberta com a **LLM-B** (GPT-4.1 via GitHub Copilot SDK). Dois atores podem se
comunicar com a LLM-B ao mesmo tempo:

| Ator                       | Canal                            | Como                              |
| -------------------------- | -------------------------------- | --------------------------------- |
| **Você (Usuário)**         | stdin/stdout (readline REPL)     | Digitando diretamente no terminal |
| **LLM-A (GitHub Copilot)** | HTTP `POST :3009/inject`         | Injeção programática              |
| **Qualquer cliente**       | HTTP `POST :3008/api/hub/inject` | Via servidor principal (proxy)    |

Cada turno é persistido no SQLite (`data/copilot.db`) via `ConversationHub`, permitindo auditoria e
consulta histórica ilimitada.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                   Terminal Permanente LLM-B                 │
│                                                             │
│  stdin/stdout ──► sendTurn() ──►  llmBridgeClient          │
│                        │          .dialogTurn()             │
│  POST :3009/inject ───►│               │                    │
│                        │               ▼                    │
│  POST :3008/api/hub/ ──►     AlwaysAliveAgent               │
│      inject (proxy)   │      .sendDialogTurn()              │
│                        │               │                    │
│                        │               ▼                    │
│                        │     @github/copilot-sdk            │
│                        │     → GPT-4.1 (LLM-B)             │
│                        │               │                    │
│                        │     ◄── reply (stream)             │
│                        │               │                    │
│                        ▼               ▼                    │
│               printExchange()   hub.store.writeTurn()       │
│               (stdout display)  (SQLite persist)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Pré-requisitos

### 1. Autenticação GitHub

```bash
# Verificar se está autenticado
gh auth status
# Deve mostrar: ✓ Logged in to github.com account <USUARIO>

# Se não tiver:
gh auth login
```

### 2. Conta com acesso ao GitHub Copilot

A conta autenticada precisa ter acesso ao **GitHub Copilot** (Individual, Business ou Enterprise).

### 3. Variáveis de ambiente (opcionais)

```bash
# Porta do servidor inject (padrão: 3009)
export LLM_B_TERMINAL_PORT=3009

# Mensagem de contexto enviada na primeira vez que o dialog loop sobe
# (opcional — se não definido, o loop sobe sem prompt inicial)
export LLM_B_BOOT_PROMPT="Você é um agente de engenharia de software especializado neste repositório."

# Modelo LLM-B (padrão: gpt-4.1)
export COPILOT_MODEL=gpt-4.1

# Timeout por turno em ms (padrão: 120000)
export LLM_B_TURN_TIMEOUT=120000

# Habilitar SDK (necessário)
export COPILOT_SDK_ENABLED=true
```

---

## Como iniciar

### Maneira mais simples — via VS Code (recomendada)

Abra o **Command Palette** (`Ctrl+Shift+P`) → **Tasks: Run Task** → **`terminal:llm-b`**

Isso abre um painel de terminal dedicado chamado "Terminal LLM-B" com o REPL interativo. Basta
aguardar ~15s até aparecer o prompt `você>`.

### Via npm (em qualquer terminal)

```bash
npm run terminal:llm-b
```

> **Não requer configuração extra** — o terminal detecta e ativa `COPILOT_SDK_ENABLED`
> automaticamente.

O terminal vai exibir o banner e aguardar conexão com LLM-B:

```
╔══════════════════════════════════════════════════════════════════════════╗
║            Terminal LLM-B — Sessão Permanente Aberta                    ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Comandos: /status · /history [n] · /who · /clear · /quit               ║
║  Injeção LLM-A: POST http://localhost:3009 /inject                      ║
╚══════════════════════════════════════════════════════════════════════════╝

[boot] Inicializando sessão com LLM-B…
[boot] Ativando dialog loop com LLM-B…
[llm-b] ✅ LLM-B sinalizada READY — terminal ativo.
[hub] Sessão de conversa criada: <uuid>
você>
```

### Modo PM2 (processo permanente)

```bash
# Iniciar via PM2 (processo permanente com auto-restart)
COPILOT_TERMINAL_ENABLED=true COPILOT_SDK_ENABLED=true \
  npx pm2 start ecosystem.config.cjs --only llm-b-terminal

# Ver logs em tempo real
npx pm2 logs llm-b-terminal

# Para o processo
npx pm2 stop llm-b-terminal

# Reiniciar
npx pm2 restart llm-b-terminal
```

> **Nota**: O processo PM2 não tem stdin interativo — use injeção HTTP para enviar mensagens quando
> em modo PM2.

### Modo integrado (com servidor Express principal)

O servidor Express (porta 3008) já inclui a rota proxy `/api/hub/inject`. Para habilitar:

```bash
# Iniciar o servidor principal com Copilot SDK habilitado
COPILOT_SDK_ENABLED=true npm start

# Depois, em outro terminal, iniciar o terminal LLM-B:
COPILOT_SDK_ENABLED=true COPILOT_TERMINAL_ENABLED=true \
  node --strip-types src/copilot/terminal-server.js
```

---

## Regime de operação normal

Este é o fluxo oficial para sessões de trabalho longas e contínuas com a LLM-B.

### Setup mínimo (apenas o terminal — recomendado)

> Não requer o servidor Express principal. O terminal é autossuficiente.

**Passo 1**: Abra VS Code Command Palette (`Ctrl+Shift+P`) → **Tasks: Run Task** →
**`terminal:llm-b`**

**Passo 2**: Aguarde o prompt `você>` (≈15s na primeira sessão, ≈5s nas seguintes)

**Passo 3**: Comece a conversar!

### Comunicação simultânea (você + LLM-A)

```
┌─────────────────────────────────────────────────────────────┐
│  Terminal VS Code "Terminal LLM-B"                          │
│                                                             │
│  você> Analise src/copilot/ e liste os arquivos principais  │
│  🧠 LLM-B: Claro! Os arquivos principais são...           │
│                                                             │
│  [llm-a] → Agora compare com src/kernel/                   │  ← LLM-A injetou via HTTP
│  🧠 LLM-B: Comparando os dois módulos...                   │
│                                                             │
│  você> Quais seriam as prioridades de refatoração?          │
│  🧠 LLM-B: Com base na análise completa...                 │
└─────────────────────────────────────────────────────────────┘
```

**LLM-A injeta enquanto o terminal está aberto** via:

```javascript
await fetch('http://127.0.0.1:3009/inject', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Sua pergunta aqui', from: 'llm-a' }),
});
```

A mensagem aparece no terminal do usuário em tempo real com prefixo `[llm-a]`.

### Setup com histórico SQLite (opcional)

Para persistir turnos no banco de dados e ter acesso ao dashboard:

```bash
# Terminal 1 — servidor Express (porta 3008)
npm start

# Terminal 2 — terminal LLM-B (porta 3009)
npm run terminal:llm-b
```

---

## Como usar (REPL interativo)

Com o terminal ativo e o prompt `você>` visível, basta digitar mensagens normalmente:

```
você> Olá! Você pode analisar o arquivo src/copilot/always-alive.js e me dizer o que ele faz?
🤖 LLM-B: Claro! O arquivo `always-alive.js` implementa o `AlwaysAliveAgent`...
   [2340ms]

você> Agora liste os arquivos da pasta src/copilot/ e me dê um resumo de cada um.
🤖 LLM-B: Vou listar os arquivos...
   [1890ms]
```

### Comandos especiais do REPL

| Comando            | Descrição                                                              |
| ------------------ | ---------------------------------------------------------------------- |
| `/status`          | Mostra status atual: agente, dialogLoopActive, hubSessionId, turnCount |
| `/history [n]`     | Exibe os últimos N pares de mensagens (padrão: 10)                     |
| `/who`             | Lista os atores disponíveis e como cada um acessa o terminal           |
| `/clear`           | Limpa o histórico em memória (não afeta SQLite)                        |
| `/answer <texto>`  | Responde uma pergunta pendente da LLM-B (se ela usou `ask_user`)       |
| `/restart`         | Para e reinicia o dialog loop (útil após timeout)                      |
| `/quit` ou `/exit` | Encerra o terminal graciosamente                                       |

### Ctrl+C

Pressionar `Ctrl+C` **pausa o readline** mas **NÃO encerra o dialog loop**. A LLM-B permanece
aguardando. Para sair completamente, use `/quit`.

---

## Injeção de mensagens via HTTP

### Via servidor inject direto (:3009)

```bash
# Injetar mensagem de LLM-A
curl -X POST http://127.0.0.1:3009/inject \
  -H 'Content-Type: application/json' \
  -d '{"message": "Olá LLM-B! Execute npm run test:unit e informe o resultado.", "from": "llm-a"}'

# Resposta:
# {
#   "ok": true,
#   "reply": "Executando npm run test:unit...",
#   "durationMs": 3421,
#   "from": "llm-a"
# }

# Health check
curl http://127.0.0.1:3009/health
# {
#   "ok": true,
#   "dialogLoopActive": true,
#   "agentStatus": "idle",
#   "busy": false,
#   "hubSessionId": "f3b2c1a0-..."
# }
```

### Via servidor Express principal (:3008)

O servidor Express proxeia para o terminal internamente — você não precisa conhecer a porta 3009:

```bash
# Via servidor principal (útil quando terminal e servidor rodam em processos diferentes)
curl -X POST http://localhost:3008/api/hub/inject \
  -H 'Content-Type: application/json' \
  -d '{"message": "Revise o arquivo src/main.js e aponte melhorias.", "from": "llm-a"}'
```

**Respostas de erro do proxy:**

- `503 Terminal LLM-B inacessível` — terminal não está rodando
- `504 Terminal LLM-B não respondeu a tempo` — timeout de 10s

### De dentro de código LLM-A (Node.js)

```javascript
// LLM-A enviando mensagem ao terminal
const response = await fetch('http://127.0.0.1:3009/inject', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Analise o último commit e valide se há erros de lint.',
    from: 'llm-a',
  }),
});
const { reply, durationMs } = await response.json();
console.log('LLM-B respondeu em', durationMs, 'ms:', reply);
```

---

## Histórico via ConversationHub

Cada conversa cria uma **hub_session** permanente no SQLite. Para consultar:

```bash
# Listar sessões (via API Express)
curl http://localhost:3008/api/hub/sessions | jq '.sessions[:3]'

# Ver turnos de uma sessão específica
curl http://localhost:3008/api/hub/sessions/ < hubSessionId > /turns | jq '.turns[:5]'

# Stream de eventos em tempo real (SSE)
curl -N http://localhost:3008/api/hub/sessions/ < hubSessionId > /stream
```

---

## Sessão contínua LLM-A ↔ LLM-B (modo conversa)

Para uma conversa longa e iterativa via script (sem REPL):

```javascript
// src/copilot/minha-conversa.mjs
// Execução: node --strip-types src/copilot/minha-conversa.mjs

import { alwaysAliveAgent } from './always-alive.js';
import { llmBridgeClient } from './llm-bridge-client.js';

// 1. Iniciar agente e dialog mode
await alwaysAliveAgent.start();
await llmBridgeClient.startDialogMode('Você é um especialista em Node.js e ESM.');

// 2. Conversa contínua (mesmo contexto mantido entre turnos)
const r1 = await llmBridgeClient.dialogTurn('Liste os subsistemas do projeto.');
console.log('LLM-B:', r1);

const r2 = await llmBridgeClient.dialogTurn('Agora foque no src/copilot/. Qual o fluxo completo?');
console.log('LLM-B:', r2);

const r3 = await llmBridgeClient.dialogTurn('Proponha 3 melhorias de arquitetura.');
console.log('LLM-B:', r3);

// 3. Encerrar
await llmBridgeClient.stopDialogMode();
await alwaysAliveAgent.stop();
```

---

## Fluxo completo de dados

```
[Usuário digita no REPL]
       │
       ▼
sendTurn(message, 'user')
       │
       ├── ensureDialogLoop()  ← garante que AlwaysAliveAgent + dialog mode estão ativos
       │
       ├── llmBridgeClient.dialogTurn(message)
       │         │
       │         ▼
       │   AlwaysAliveAgent.sendDialogTurn()
       │         │
       │         ▼
       │   @github/copilot-sdk → GPT-4.1 (LLM-B)
       │         │
       │         ▼
       │   reply (string completa)
       │
       ├── printExchange(actor, message, reply, durationMs)  ← exibe no stdout
       │
       └── hub.store.writeTurn(_hubSessionId, { role: 'user', content: message })
           hub.store.writeTurn(_hubSessionId, { role: 'llm_b', content: reply, durationMs })
                │
                ▼
           SQLite: data/copilot.db → tabela copilot_conversation_turns
```

---

## Variáveis de ambiente (referência completa)

| Variável                   | Padrão    | Descrição                                                |
| -------------------------- | --------- | -------------------------------------------------------- |
| `COPILOT_SDK_ENABLED`      | `false`   | **Obrigatório** — habilita o subsistema copilot          |
| `COPILOT_TERMINAL_ENABLED` | `false`   | Habilita o processo PM2 `llm-b-terminal`                 |
| `LLM_B_TERMINAL_PORT`      | `3009`    | Porta do servidor HTTP de injeção                        |
| `LLM_B_BOOT_PROMPT`        | _(vazio)_ | Prompt de contexto enviado ao iniciar o dialog loop      |
| `LLM_B_TURN_TIMEOUT`       | `120000`  | Timeout (ms) para aguardar resposta da LLM-B             |
| `COPILOT_MODEL`            | `gpt-4.1` | Modelo LLM-B                                             |
| `COPILOT_CLI_URL`          | _(vazio)_ | URL do CLI Copilot externo (opcional — para modo cliUrl) |

---

## Troubleshooting

### "AlwaysAliveAgent timeout aguardando idle"

O SDK pode demorar para conectar na primeira vez (15-30s). Aumente `LLM_B_TURN_TIMEOUT`.

### "Hub não disponível na boot"

O `ConversationHub` depende do banco SQLite estar inicializado. Isso acontece automaticamente quando
o servidor Express principal inicia. Se rodar o terminal standalone antes do servidor, os turnos não
serão persistidos mas o terminal funcionará normalmente.

### Terminal trava em "[boot] Ativando dialog loop com LLM-B…"

Verifique:

```bash
gh auth status            # precisa estar autenticado
echo $COPILOT_SDK_ENABLED # deve ser 'true'
```

### "Terminal LLM-B inacessível" na rota /api/hub/inject

O terminal não está rodando. Inicie-o:

```bash
COPILOT_SDK_ENABLED=true node --strip-types src/copilot/terminal-server.js
```

### Múltiplos processos na porta 3009

```bash
lsof -i :3009
kill -9 <PID>
```

---

## Referências

- Código: [src/copilot/terminal-server.js](../../src/copilot/terminal-server.js)
- Agente: [src/copilot/always-alive.js](../../src/copilot/always-alive.js)
- Bridge: [src/copilot/llm-bridge-client.js](../../src/copilot/llm-bridge-client.js)
- Hub: [src/copilot/conversation-hub/hub.js](../../src/copilot/conversation-hub/hub.js)
- Router: [src/server/api/copilot-hub-router.js](../../src/server/api/copilot-hub-router.js)
- Arquitetura: [ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md) — seção `src/copilot/`
- Plano sprint: [PLANOS/SPRINT-TERMINAL-LLM-B.md](../PLANOS/SPRINT-TERMINAL-LLM-B.md)
- Guia LLM-A:
  [src/copilot/LLM-A-COMMUNICATION-GUIDE.md](../../src/copilot/LLM-A-COMMUNICATION-GUIDE.md)
- Operacional SDK: [COPILOT-SDK-OPERACIONAL.md](../COPILOT-SDK-OPERACIONAL.md)
