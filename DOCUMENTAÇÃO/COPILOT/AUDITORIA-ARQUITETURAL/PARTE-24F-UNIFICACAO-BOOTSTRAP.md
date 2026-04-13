# PARTE-24F — ANÁLISE PROFUNDA: UNIFICAÇÃO DO BOOTSTRAP COPILOT

> **Documento**: PARTE-24F-UNIFICACAO-BOOTSTRAP.md
> **Versão**: 1.0
> **Data**: 2026-04-12
> **Escopo**: Análise completa de por quê existem 3 entry points, proposta de unificação canônica, Q&A detalhado, novo roadmap

---

## 1. DIAGNÓSTICO — POR QUE EXISTEM 3 ENTRY POINTS?

### 1.1. Inventário Atual

```
ENTRY POINT #1: process "server" (index.js → src/main.js → src/server/main.js)
  PM2 name:    "chatgpt-app"
  Ativação:    Sempre (processo principal)
  Copilot via: dynamic import → bootCopilot({ mode: 'server' }) + 80 LOC inline wiring
  O que faz:   Inicia Express HTTP, sobe socket.io, NERV, mounts copilot como addon
  Copilot é:   Um ADDON do server (se COPILOT_SDK_ENABLED !== 'false')

ENTRY POINT #2: process "copilot-sdk-agent" (src/copilot/agent.js → bootstrap → entry.js)
  PM2 name:    "copilot-sdk-agent"
  Ativação:    COPILOT_SDK_ENABLED=true (explícito, desligado por padrão)
  O que faz:   Roda AlwaysAliveAgent como PROCESSO SEPARADO do server
  Propósito:   Produção — agent e server em processos isolados
  Resultado:   Agent recebe mensagens via HTTP bridge, não via socket inline

ENTRY POINT #3: process "llm-b-terminal" (src/copilot/terminal/bootstrap.js → bootstrap → terminal/index.js)
  PM2 name:    "llm-b-terminal"
  Ativação:    COPILOT_TERMINAL_ENABLED=true (explícito, desligado por padrão)
  O que faz:   Terminal REPL para LLM-B com inject server HTTP em :3009
  Propósito:   Interface de desenvolvimento — humano ou LLM-A conversa com LLM-B via terminal
  Resultado:   Agent com REPL readline + SSE events + hot-reload de skills
```

### 1.2. Q&A Detalhado

#### Q: Por que 3 entry points separados?

**A**: Razão histórica + 3 contextos de deployment diferentes:

1. **Server (entry #1)**: O sistema nasceu como servidor web. O copilot foi adicionado DEPOIS como addon embarcado. O server faz wiring inline porque precisa de objetos (`io`, `nerv`) que só existem no contexto Express.

2. **PM2 Agent (entry #2)**: Em produção, rodar o agent dentro do server é problemático — um crash do agent mata o server. A solução foi um processo PM2 separado (`copilot-sdk-agent`). Como é processo isolado, precisa de boot próprio completo (DI, observability, agent loop, IPC).

3. **Terminal (entry #3)**: Ferramenta de desenvolvimento — VS Code Task que abre um REPL interativo. Não precisa de Express nem de socket.io. É standalone com seu próprio inject server(:3009).

#### Q: Isso não deveria ser apenas 1 entry point?

**A**: **Sim e não.** A realidade de multi-processo (PM2) exige que cada processo tenha seu próprio bootstrap de DI — `bootstrapObservability()`, `bootstrapLateDeps()`, etc. precisam rodar em cada processo. Porém, todos esses calls JÁ são unificados via `bootCopilot()` no `bootstrap.js` canônico.

O que pode (e deve) ser unificado:

| Antes (3 boots parciais) | Depois (1 boot + 3 modos) |
|--------------------------|---------------------------|
| server: inline wiring 80 LOC | server: `bootCopilot({ mode: 'server' })` + hooks integrados |
| agent: entry.js fazia boot + lifecycle | agent: `bootCopilot({ mode: 'agent' })` (já funciona) |
| terminal: bootstrap.js → startTerminalServer | terminal: `bootCopilot({ mode: 'terminal' })` (já funciona) |

**O que NÃO pode ser unificado em 1 processo**: server, agent e terminal são processos
separados por design (PM2). Cada um precisa instanciar seu próprio DI container, loggers, etc.
Isso é uma decisão arquitetural correta — não um defeito.

#### Q: O server deveria parar de fazer wiring inline?

**A**: **Sim.** O trecho de 80 LOC em `server/main.js` (linhas 744-820) que faz:
- `nervEventBusAdapter.mount()`
- `conversationHub.init({ io, nerv })`
- `alwaysAliveAgent.start()`

...deveria ser movido para dentro do `bootCopilot({ mode: 'server' })`, recebendo `io` e `nerv` como parâmetros. Isso é o maior gap de consolidação restante.

#### Q: terminal:llm-b deveria ser o ponto padrão?

**A**: Depende do contexto:

| Contexto | Entry point padrão | Razão |
|----------|-------------------|-------|
| Desenvolvimento (VS Code) | `npm run terminal:llm-b` | Task do VS Code com REPL |
| Produção (Docker/PM2) | `index.js` (server) | HTTP API + dashboard |
| Produção (agent separado) | PM2 `copilot-sdk-agent` | Isolamento de processo |

**Proposta**: O terminal:llm-b continua sendo o entry point padrão para **desenvolvimento**.
Em produção, o server é o entry point. O PM2 agent é para deploys com isolamento.

#### Q: Qual o entry point CANÔNICO?

**A**: O **bootstrap.js** (`src/copilot/bootstrap.js`) é o entry point canônico. Todos os 3 modos convergem para ele:

```
terminal/bootstrap.js  ──→ bootCopilot({ mode: 'terminal' })
agent.js               ──→ bootCopilot({ mode: 'agent' })
server/main.js         ──→ bootCopilot({ mode: 'server' })
```

Os entry points thin (`agent.js`, `terminal/bootstrap.js`) são apenas **delegators** de 3 LOC que chamam `bootCopilot()`.

---

## 2. SITUAÇÃO ATUAL vs. IDEAL

### 2.1. Situação Atual (pós-Onda 2.5)

```
┌──────────────────────────────────────────────────────────────────────┐
│ bootstrap.js — bootCopilot({ mode })                                 │
│   Phase 1: bootstrapObservability()              ✅                  │
│   Phase 2: bootstrapLateDeps + AUDIT_BUS         ✅                  │
│   Phase 3:                                                           │
│     terminal → startTerminalServer()             ✅ (completo)       │
│     agent   → startAgentLoop()                   ✅ (completo)       │
│     server  → NOOP (retorna)                     ⚠️ INCOMPLETO      │
│              server/main.js faz 80 LOC inline    ⚠️ DUPLICAÇÃO       │
└──────────────────────────────────────────────────────────────────────┘
```

**Problema**: O modo `server` é o ÚNICO que não incorpora todo seu wiring no `bootCopilot()`. Os outros dois modos já são completamente auto-contidos.

### 2.2. Situação Ideal

```
┌──────────────────────────────────────────────────────────────────────┐
│ bootstrap.js — bootCopilot({ mode, context? })                       │
│   Phase 1: bootstrapObservability()                                  │
│   Phase 2: bootstrapLateDeps + AUDIT_BUS                             │
│   Phase 3: mode-specific                                             │
│     terminal → startTerminalServer()             ✅ auto-contido     │
│     agent   → startAgentLoop()                   ✅ auto-contido     │
│     server  → startServerCopilot({ io, nerv })   ✅ auto-contido     │
│              Todo wiring NERV/Hub/Agent dentro                       │
│              server/main.js: apenas 1 call                           │
└──────────────────────────────────────────────────────────────────────┘
```

**server/main.js (ideal)**:
```js
// Antes: 80 LOC de wiring inline
// Depois: 1 chamada
if (COPILOT_SDK_ENABLED !== 'false') {
    const { bootCopilot } = await import('#copilot/bootstrap');
    await bootCopilot({
        mode: 'server',
        context: {
            io: socketHub.getIO(),
            nerv,
        },
    });
}
```

---

## 3. GAPS RESTANTES PARA UNIFICAÇÃO TOTAL

| # | Gap | Complexidade | Módulos |
|---|-----|-------------|---------|
| U1 | **Mover wiring NERV/EventBus de server/main.js para bootstrap** | Alta | bootstrap, bridges |
| U2 | **Mover ConversationHub.init() de server/main.js para bootstrap** | Média | bootstrap, conversation-hub |
| U3 | **Mover agent autostart de server/main.js para bootstrap** | Média | bootstrap, agent |
| U4 | **Aceitar `context: { io, nerv }` em bootCopilot** | Baixa | bootstrap |
| U5 | **Remover 80 LOC inline de server/main.js** | Baixa (após U1-U3) | server/main.js |
| U6 | **Smoke test: server mode boot completo** | Baixa | tests |

---

## 4. ROADMAP DE UNIFICAÇÃO

### Onda 2.6 — Server Boot Unification (L53.8–L53.13)

> Objetivo: O modo `server` de `bootCopilot()` deve ser tão auto-contido quanto `terminal` e `agent`.

#### L53.8 — Expandir BootOptions com `context`

**O que**: `bootCopilot()` aceita `context?: { io?, nerv? }` opcional.

```js
/**
 * @typedef {object} BootOptions
 * @property {CopilotBootMode} mode
 * @property {{ io?: any; nerv?: any }} [context] Objetos do server (apenas mode=server)
 */
```

**Acceptance**: Typecheck clean. Modos terminal/agent ignoram context.

#### L53.9 — Criar `src/copilot/server/wiring.js`

**O que**: Novo módulo que encapsula TODO o wiring que hoje está inline em server/main.js:
1. `nervEventBusAdapter.mount(eventBus, nerv)`
2. Inbound NERV commands (SEND_MESSAGE, PAUSE, RESUME, RESTART)
3. `conversationHub.init({ io, nerv })`
4. `alwaysAliveAgent.start()` (se COPILOT_AGENT_AUTOSTART !== 'false')

```js
// src/copilot/server/wiring.js
export async function wireServerCopilot({ io, nerv }) { ... }
```

**Acceptance**: `wireServerCopilot()` < 100 LOC. Tudo que server/main.js fazia inline agora está neste módulo.

#### L53.10 — Integrar `wireServerCopilot` no bootstrap mode=server

**O que**: `bootCopilot({ mode: 'server', context: { io, nerv } })` chama `wireServerCopilot()`.

```js
} else if (mode === 'server') {
    if (context?.io || context?.nerv) {
        const { wireServerCopilot } = await import('./server/wiring.js');
        await wireServerCopilot(context);
    }
    log('INFO', '[bootstrap] Modo server — copilot integrado.');
}
```

**Acceptance**: O wiring é feito dentro do bootstrap, não inline no server.

#### L53.11 — Remover 80 LOC inline de server/main.js

**O que**: Substituir todo o bloco NERV adapter + ConversationHub + agent autostart por 1 chamada a `bootCopilot()`.

**Antes** (server/main.js ~80 LOC):
```js
bootCopilot({ mode: 'server' });
// Depois vem 80 LOC de wiring inline...
```

**Depois** (server/main.js ~5 LOC):
```js
await bootCopilot({
    mode: 'server',
    context: {
        io: socketHub.getIO(),
        nerv,
    },
});
```

**Acceptance**: server/main.js perde ~80 LOC de copilot wiring. Server inicia normalmente.

#### L53.12 — Criar `src/copilot/server/` directory (se não existir)

**O que**: Verificar se `src/copilot/server/` existe como módulo. Se não, criar com `wiring.js` + futuro `index.js`.

> Nota: NÃO confundir com `src/server/` (o server HTTP). `src/copilot/server/` é o sub-módulo copilot para integração com o server.

**Acceptance**: `src/copilot/server/wiring.js` existe e é importável via `#copilot/server/wiring`.

#### L53.13 — Smoke test de server mode boot

**O que**: Expandir smoke test para verificar que server mode chama wireServerCopilot quando context é fornecido.

---

## 5. RESULTADO FINAL (Pós-Onda 2.6)

### Diagrama Unificado

```
┌─────────────────────────────────────────────────────────────────────┐
│                    bootstrap.js (CANÔNICO)                          │
│                    bootCopilot({ mode, context? })                   │
│                                                                      │
│  Phase 1: bootstrapObservability()                                   │
│  Phase 2: bootstrapLateDeps(), AUDIT_BUS                            │
│  Phase 3: switch(mode)                                               │
│    ├── 'terminal' → startTerminalServer()         [terminal/]        │
│    ├── 'agent'    → startAgentLoop()              [agent/lifecycle/]  │
│    └── 'server'   → wireServerCopilot(context)    [server/wiring]    │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
     ┌────────────────┼────────────────┐
     │                │                │
  agent.js       terminal/         server/main.js
  (3 LOC)        bootstrap.js      (5 LOC do
                 (3 LOC)           bootCopilot call)
     │                │                │
     ▼                ▼                ▼
  PM2 process    VS Code Task      Express process
  standalone     standalone        embarcado
```

### Métricas Projetadas

| Métrica | Pré-Unificação | Pós-Unificação |
|---------|---------------|----------------|
| Boot code em server/main.js | 80 LOC inline | **5 LOC** |
| Modos com boot completo em bootstrap | 2/3 | **3/3** |
| Nº de locais com wiring NERV adapter | 1 (server/main.js) | **1 (server/wiring.js)** |
| Nº de locais com agent autostart | 1 (server/main.js) | **1 (server/wiring.js)** |
| Nº de entry points thin | 2 (agent.js, terminal/bootstrap) | **2** (sem mudança) |
| Entry point canônico | bootstrap.js | **bootstrap.js** (reforçado) |

### Por que 3 processos e não 1?

| Processo | Razão inalterável |
|----------|-------------------|
| **server** | Hospital Express + socket.io + NERV. Processo pesado com muitas responsabilidades. |
| **agent** | Isolamento: crash do agent não mata o server. PM2 restart automático. |
| **terminal** | Tool de dev: REPL interativo, não existe em produção. |

Os 3 processos são por design — a unificação é do **boot code**, não dos processos.

---

## 6. CHANGELOG

| Versão | Data | Mudanças |
|--------|------|---------|
| 1.0 | 2026-04-12 | Análise Q&A, diagnóstico, proposta de Onda 2.6 |
