# PARTE-24E — CONSOLIDAÇÃO BOOTSTRAP & INTEGRAÇÃO PROFUNDA

> **Documento**: PARTE-24E-CONSOLIDACAO-BOOTSTRAP.md
> **Versão**: 1.0
> **Data**: 2026-04-12
> **Escopo**: Consolidação dos entry points, unificação do boot, integração robusta com server/pm2/terminal
> **Pré-requisito**: PARTE-24A/B/C/D + Ondas 1-2 concluídas

---

## 1. Diagnóstico Pós-Onda 2

### 1.1. Conquistas

| Conquista | Status |
|-----------|--------|
| Zero imports `#core/` em src/copilot/ | ✅ |
| `bootstrap.js` canônico criado | ✅ |
| `terminal/bootstrap.js` thin criado | ✅ |
| `server/main.js` chama `bootCopilot` antes do wiring | ✅ |
| Smoke test de autonomia | ✅ |

### 1.2. Problemas Remanescentes (Boot & Integração)

| # | Problema | Gravidade | Localização |
|---|---------|-----------|-------------|
| B1 | **PM2 `copilot-sdk-agent` aponta para `src/copilot/agent.js` — ARQUIVO INEXISTENTE** | 🔴 CRÍTICO | ecosystem.config.cjs:411 |
| B2 | **`agent/lifecycle/entry.js` (250 LOC) duplica boot completo** — bootstrapObservability(), bootstrapLateDeps(), setAuditBus(), DI registers, event wiring, tudo inline | 🔴 ALTO | agent/lifecycle/entry.js |
| B3 | **`server/main.js` faz 70 LOC de wiring copilot inline** — NERV bridge, ConversationHub, AlwaysAliveAgent autostart, tudo com dynamic imports | 🟡 MÉDIO | server/main.js:732-810 |
| B4 | **`bootstrap.js` atual é minimal** — chama `bootstrapObservability()` e delega, mas não faz DI Module registration completo | 🟡 MÉDIO | bootstrap.js |
| B5 | **3 entry points com boot parcial/duplicado** — terminal usa bootstrap.js, server usa inline, PM2 usa entry.js | 🔴 ALTO | multi |
| B6 | **`observability/bootstrap.js` chamada em 2 locais** — entry.js e bootstrap.js, sem idempotency guard | 🟡 MÉDIO | observability/bootstrap.js |
| B7 | **Terminal `startTerminalServer()` faz 120+ LOC de DI wiring** — container.register(), wireLegacySetters(), PinnedFilesLoader, etc. | 🟡 MÉDIO | terminal/index.js |

### 1.3. Mapa Atual de Entry Points

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINT 1: Server (src/server/main.js)                            │
│  ├─ bootCopilot({ mode: 'server' })       [L51 — novo, mínimo]        │
│  ├─ Dynamic import #copilot/bridges       [inline, 15 LOC]             │
│  ├─ Dynamic import #copilot/events        [inline, 5 LOC]              │
│  ├─ Dynamic import #copilot/agent         [inline, 15 LOC]             │
│  ├─ Dynamic import #copilot/conv-hub      [inline, 10 LOC]             │
│  └─ Total: ~70 LOC de wiring copilot inline                            │
├─────────────────────────────────────────────────────────────────────────┤
│  ENTRY POINT 2: Terminal (src/copilot/terminal/bootstrap.js)           │
│  ├─ bootCopilot({ mode: 'terminal' })                                  │
│  │   ├─ bootstrapObservability()                                       │
│  │   └─ startTerminalServer()             [252 LOC com DI wiring]      │
│  └─ Total: 3 LOC thin + 252 LOC de init                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ENTRY POINT 3: PM2 Agent (src/copilot/agent/lifecycle/entry.js)       │
│  ├─ bootstrapObservability()              [DUPLICADO]                  │
│  ├─ bootstrapLateDeps({ buildTool })      [DUPLICADO]                  │
│  ├─ setAuditBus(defaultBus)              [inline]                      │
│  ├─ container.register(AUDIT_BUS)        [inline]                      │
│  ├─ 200+ LOC de event wiring/lifecycle   [custom boot]                 │
│  └─ Total: ~250 LOC de boot standalone                                  │
│  ⚠️ PM2 config cita agent.js (inexistente) — entry.js não é chamável!  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Arquitetura Boot Ideal (Proposta)

### 2.1. Princípio: Single Boot Path → Multiple Modes

```
                      ┌──────────────────────┐
                      │   copilot/bootstrap.js│  ← ÚNICO orchestrador de boot
                      │   bootCopilot({mode}) │
                      └───────────┬──────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                    │
         mode='terminal'    mode='server'        mode='agent'
              │                   │                    │
    ┌─────────▼──────────┐ ┌─────▼────────┐ ┌────────▼──────────┐
    │ terminal/index.js  │ │ retorna DI   │ │ agent lifecycle   │
    │ startTerminalServer│ │ p/ server    │ │ (loop permanente)  │
    └────────────────────┘ └──────────────┘ └───────────────────┘
```

### 2.2. Modos de Boot

| Modo | Caller | Entry Point Thin | O que bootstrap.js faz |
|------|--------|-----------------|----------------------|
| `terminal` | `npm run terminal:llm-b` | `terminal/bootstrap.js` (3 LOC) | L0-L2 DI + startTerminalServer() |
| `server` | `src/server/main.js` | inline `await bootCopilot()` | L0-L2 DI + retorna (server faz wiring NERV/socket) |
| `agent` | PM2 `copilot-sdk-agent` | `src/copilot/agent.js` (3 LOC) | L0-L2 DI + agent lifecycle loop |

### 2.3. Camadas de Boot (Sequential)

```
BOOT SEQUENCE (todas as modes):
─────────────────────────────────────────────────────────────
  PHASE 0 — KERNEL
    ├─ Container singleton ready (already exists at module load)
    ├─ L0 tokens defined (di-tokens.js)
    └─ Error classes loaded

  PHASE 1 — OBSERVABILITY (idempotente)
    ├─ bootstrapObservability() — loggers, error tracker, EventBus
    ├─ Middleware pipeline registered (correlation, timestamp, schema)
    └─ Log observer wired

  PHASE 2 — LATE DEPS (quando disponível)
    ├─ bootstrapLateDeps({ buildTool }) — tools builder
    ├─ AuditBus registered
    └─ Legacy setters wired

  PHASE 3 — MODE-SPECIFIC
    ├─ terminal: startTerminalServer()
    ├─ server: (noop — caller faz wiring)
    └─ agent: initAgentLoop() (novo)
─────────────────────────────────────────────────────────────
```

### 2.4. Idempotency Guard

```js
let _booted = false;

export async function bootCopilot({ mode }) {
    if (_booted) {
        log('WARN', '[bootstrap] bootCopilot já executado — ignorando chamada duplicada.');
        return;
    }
    _booted = true;
    // ... boot sequence
}
```

---

## 3. Plano de Execução Detalhado

### ONDA 2.5 — Boot Consolidation (Faixas L53.1–L53.7)

> Inserida entre Onda 2 e Onda 3 para estabilizar o boot antes de atacar ciclos.

#### L53.1 — Criar `src/copilot/agent.js` (PM2 thin entry)

**O que**: Criar arquivo faltante que PM2 referencia.

```js
// @ts-check
import { bootCopilot } from './bootstrap.js';
bootCopilot({ mode: 'agent' }).catch(err => {
    console.error('[agent] Fatal:', err);
    process.exitCode = 1;
});
```

**Acceptance**: PM2 `copilot-sdk-agent` resolve para arquivo existente.

#### L53.2 — Expandir `bootstrap.js` com Phase 0-2

**O que**: `bootCopilot()` executa L0 (kernel) + L1 (observability) + L2 (late deps) antes de delegar.

```js
export async function bootCopilot({ mode }) {
    if (_booted) return;
    _booted = true;

    // Phase 0: kernel — container já existe via module singletons
    log('INFO', `[bootstrap] mode=${mode}`);

    // Phase 1: observability (idempotente)
    bootstrapObservability();

    // Phase 2: late deps (tools, audit bus)
    const { buildTool } = await import('./tools/index.js');
    const { defaultBus } = await import('./hooks/index.js');
    bootstrapLateDeps({ buildTool });
    container.register(AUDIT_BUS, () => defaultBus, 'singleton');
    const { setAuditBus } = await import('./audit/index.js');
    setAuditBus(defaultBus);

    // Phase 3: mode-specific
    if (mode === 'terminal') {
        const { startTerminalServer } = await import('./terminal/index.js');
        await startTerminalServer();
    } else if (mode === 'agent') {
        const { startAgentLoop } = await import('./agent/lifecycle/entry.js');
        await startAgentLoop();
    }
    // mode='server': noop — caller (server/main.js) faz wiring NERV/socket
}
```

**Acceptance**: Typecheck clean. `node src/copilot/bootstrap.js` (sem args) falha graciosamente com erro claro.

#### L53.3 — Refatorar `agent/lifecycle/entry.js` → exportar `startAgentLoop()`

**O que**: entry.js perde o boot inline (bootstrapObservability, AUDIT_BUS, etc.) — agora é executado via bootstrap.js. Exports `startAgentLoop()` que faz apenas o lifecycle do agent (event wiring, retries, shutdown).

**Acceptance**: entry.js < 200 LOC. Zero bootstrapObservability() chamado inline.

#### L53.4 — Idempotency guard em `observability/bootstrap.js`

**O que**: Adicionar `if (_booted) return;` em `bootstrapObservability()` para que chamadas duplicadas sejam seguras.

**Acceptance**: Chamar 2x não causa side-effects nem throws.

#### L53.5 — Mover DI wiring de `terminal/index.js` para helpers

**O que**: Os 30 LOC de `container.register()` + `wireLegacySetters()` em `startTerminalServer()` devem ficar em `terminal/di-wiring.js` (extracted helper).

**Acceptance**: `startTerminalServer()` < 180 LOC.

#### L53.6 — Documentar bootstrap sequence em ARCHITECTURE.md

**O que**: Adicionar seção "Boot Sequence" com diagrama dos 3 modos + phase descriptions.

#### L53.7 — Smoke test dos 3 modos de boot

**O que**: Expandir `check-copilot-autonomy.mjs` ou criar novo script que verifica:
1. `src/copilot/agent.js` existe
2. `src/copilot/terminal/bootstrap.js` existe
3. `src/copilot/bootstrap.js` exporta `bootCopilot`
4. PM2 config entry points resolvem para arquivos existentes

---

## 4. Visão Futura — Espaço para Upgrades

### 4.1. Plugin-Driven Boot (Onda 5+)

```js
// Futuro: módulos se auto-registram via plugin pattern
const modules = await discoverModules('./src/copilot/*/module.js');
for (const mod of modules) {
    await mod.register(container);
}
```

### 4.2. Health-Ready Boot

```js
// Futuro: boot com health checks
await bootCopilot({
    mode: 'server',
    healthChecks: true,        // registra GET /health
    metricsEndpoint: true,     // registra GET /metrics
    gracefulShutdown: true,    // registra SIGTERM/SIGINT
});
```

### 4.3. Multi-Process Boot

```
pm2 start ecosystem.config.cjs
  ├─ server (mode=server)         → API HTTP + dashboard
  ├─ copilot-sdk-agent (mode=agent) → agent loop permanente
  └─ llm-b-terminal (mode=terminal) → REPL + inject server
```

Cada processo chama `bootCopilot()` com seu modo. O DI container é per-process (não shared). A comunicação inter-processo é via NERV/EventBus/HTTP, não via imports.

### 4.4. Container Scoping

```js
// Futuro: child containers para isolamento
const agentScope = container.createChild();
agentScope.register(SESSION, () => new Session());
// Agent resolve SESSION do child, outros tokens do parent
```

### 4.5. Lifecycle Hooks

```js
// Futuro: lifecycle hooks para observabilidade do boot
bootCopilot({
    mode: 'terminal',
    onPhaseComplete: (phase, duration) => {
        metrics.record('boot.phase', { phase, ms: duration });
    },
});
```

---

## 5. Impacto no Roadmap Existente

### Integração com Ondas 3-6

| Onda | Impacto da consolidação |
|------|------------------------|
| **Onda 3** (Cycle Elimination) | Ciclo `config↔observability` mais fácil de quebrar com boot sequencial garantido |
| **Onda 4** (God Module Decomp) | `entry.js` (250 LOC) encolhe para <200 LOC como efeito colateral |
| **Onda 5** (Boot & Wiring) | L71-L73 ficam mais simples — bootstrap.js já é o single path. DI Module pattern se conecta naturalmente |
| **Onda 6** (Test & Polish) | Smoke test de boot (L76) fica trivial com 3 modos testáveis |

### Novas Faixas Inseridas (L53.1–L53.7)

Estas faixas ficam na **Onda 2.5** (entre Onda 2 e Onda 3).

| Faixa | Nome | Prioridade | Módulos |
|-------|------|-----------|---------|
| L53.1 | Criar `src/copilot/agent.js` (PM2 thin) | P0 | copilot root |
| L53.2 | Expandir bootstrap.js com Phase 0-2 | P0 | bootstrap |
| L53.3 | Refatorar entry.js → exports startAgentLoop | P0 | agent/lifecycle |
| L53.4 | Idempotency guard em observability/bootstrap | P1 | observability |
| L53.5 | Extrair DI wiring de terminal/index.js | P1 | terminal |
| L53.6 | Documentar boot sequence | P2 | docs |
| L53.7 | Smoke test 3 modos de boot | P1 | tests |

---

## 6. Score Projetado

| Métrica | Pós-Onda 2 | Pós-Onda 2.5 |
|---------|-----------|--------------|
| Entry points duplicados | 3 (parcial) | **1 canônico** |
| PM2 broken entries | 1 | **0** |
| Boot code duplication | ~250 LOC | **<30 LOC** |
| Idempotency guards | 0 | **2** (bootstrap + obs) |
| Score global | 6.8 | **7.0** |

---

## 7. Changelog

| Versão | Data | Mudanças |
|--------|------|---------|
| 1.0 | 2026-04-12 | Diagnóstico pós-Onda 2, proposta de Onda 2.5 |
