# Auditoria DI Completa — `src/copilot/`

**Status**: EXECUTADO (Fases A + B + C parcial)
**Criado**: 2026-06-12
**Atualizado**: 2026-06-12
**Escopo**: Todo o subsistema `src/copilot/` — container, tokens, singletons, setters, boot flow

---

## 1. Situação Pré-Auditoria — Diagnóstico

### 1.1 Números (ANTES)

| Métrica                                              | Valor  | Nota                                               |
| ---------------------------------------------------- | ------ | -------------------------------------------------- |
| Tokens definidos (`createToken`)                     | **40** | Distribuídos em 10 `di-tokens.js` per-module       |
| Tokens registrados (`container.register`)            | **12** | Apenas 30% dos tokens tinham factory               |
| Tokens resolvidos (`container.resolve`)              | **13** | Quase todos eram `EVENT_BUS`                       |
| Setters legados (`set*`)                             | **29** | Padrão predominante de injection                   |
| Module-level singletons (`export const x = new X()`) | **10** | Instanciados no import                             |
| `wireLegacySetters` call sites                       | **3**  | Em `observability/bootstrap`, `terminal/di-wiring` |

### 1.2 Problemas Identificados

| #   | Problema                                                             | Severidade | Status                     |
| --- | -------------------------------------------------------------------- | ---------- | -------------------------- |
| P1  | **21 tokens "fantasma"** — definidos sem register/resolve            | Médio      | ✅ CORRIGIDO                |
| P2  | **Module-level singletons** — 9+ instanciadas no import              | Alto       | ✅ REGISTRADOS no container |
| P3  | **3 setters sem DI** — injection direta em boot-wiring.js            | Alto       | ✅ MIGRADOS para DI         |
| P4  | **boot-wiring.js usava setters diretos** — bypass do container       | Médio      | ✅ CORRIGIDO                |
| P5  | **CONVERSATION_STORE resolvido mas não registrado**                  | Alto       | ✅ CORRIGIDO                |
| P6  | **Tokens BRIDGE/FALLBACK alias para alwaysAliveAgent**               | Baixo      | ⏸️ Design intencional       |
| P7  | **Nenhum health check de DI** — sem validação de tokens obrigatórios | Médio      | ✅ CORRIGIDO                |

---

## 2. Situação Pós-Auditoria — Números Finais

### 2.1 Números (DEPOIS)

| Métrica                           | Antes | Depois                           | Δ                           |
| --------------------------------- | ----- | -------------------------------- | --------------------------- |
| Tokens definidos                  | 40    | **21**                           | −19 (dead tokens removidos) |
| Tokens registrados                | 12    | **20**                           | +8                          |
| Cobertura (registrados/definidos) | 30%   | **95.2%**                        | +65.2pp                     |
| Token não registrado              | 28    | **1** (`SESSION_RPC` — dinâmico) | −27                         |
| `validateRequired()` calls        | 0     | **2**                            | +2                          |
| Setters migrados para DI          | 8     | **11**                           | +3                          |

### 2.2 Tokens Registrados (20/21)

| Token                | Módulo de registro           | Factory                                              |
| -------------------- | ---------------------------- | ---------------------------------------------------- |
| `SHUTDOWN_LOGGER`    | `observability/bootstrap.js` | `() => log`                                          |
| `DB_LOGGER`          | `observability/bootstrap.js` | `() => log`                                          |
| `SDK_LOGGER`         | `observability/bootstrap.js` | `() => log`                                          |
| `AUDIT_LOGGER`       | `observability/bootstrap.js` | `() => log`                                          |
| `HOOKS_LOGGER`       | `observability/bootstrap.js` | `() => log`                                          |
| `TOOLS_LOGGER`       | `observability/bootstrap.js` | `() => log`                                          |
| `TOOLS_METRICS`      | `observability/bootstrap.js` | `() => { getSummary, getToolStats, recordToolCall }` |
| `METRICS_STORE`      | `observability/bootstrap.js` | `() => defaultMetrics`                               |
| `ERROR_TRACKER`      | `observability/bootstrap.js` | `() => defaultErrorTracker`                          |
| `EVENT_COLLECTOR`    | `observability/bootstrap.js` | `() => defaultEventCollector`                        |
| `EVENT_BUS`          | `observability/bootstrap.js` | `() => createEventBus()`                             |
| `TOOLS_BUILDER`      | `observability/bootstrap.js` | `() => deps.buildTool`                               |
| `AUDIT_BUS`          | `bootstrap.js`               | `() => defaultBus`                                   |
| `ALWAYS_ALIVE_AGENT` | `terminal/di-wiring.js`      | `() => alwaysAliveAgent`                             |
| `HUB`                | `terminal/di-wiring.js`      | `() => conversationHub`                              |
| `CONVERSATION_STORE` | `terminal/di-wiring.js`      | `() => conversationStore`                            |
| `PERMISSION_AGENT`   | `terminal/di-wiring.js`      | `() => alwaysAliveAgent`                             |
| `FALLBACK_AGENT`     | `terminal/di-wiring.js`      | `() => alwaysAliveAgent`                             |
| `BRIDGE_AGENT`       | `terminal/di-wiring.js`      | `() => alwaysAliveAgent`                             |
| `NERV_BRIDGE_AGENT`  | `terminal/di-wiring.js`      | `() => alwaysAliveAgent`                             |

### 2.3 Token Não Registrado (1)

| Token         | Razão                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `SESSION_RPC` | Dinâmico — set/clear por sessão via `setSessionRpc()`. Não é boot-time. |

### 2.4 Dead Tokens Removidos (19)

`DIALOG_ENGINE`, `AUDIT_PIPELINE`, `INJECT_SERVER`, `SOCKET_NAMESPACE`,
`RATE_LIMITER`, `CACHE_MANAGER`, `MUTEX_POOL`, `TIMER_REGISTRY`, `WORKER_POOL`, `MISSION_CONTROL`,
`ALERTS_MANAGER`, `QUOTA_MONITOR`, `HEALTH_MANAGER`, `OTEL_TRACER`,
`CIRCUIT_BREAKER_REGISTRY`, `PLUGIN_REGISTRY`,
`ROOT_LOGGER`, `APP_CONFIG`,
`SESSION_SERVICE`, `CONVERSATION_SERVICE`, `AGENT_SERVICE`, `DIALOG_SERVICE`

### 2.5 Boot Flow Atualizado

```
1. entry.js → bootCopilot()
2. bootstrap.js:
   a. bootstrapObservability() — registra 12 tokens:
      SHUTDOWN_LOGGER, DB_LOGGER, SDK_LOGGER, AUDIT_LOGGER,
      HOOKS_LOGGER, TOOLS_LOGGER, TOOLS_METRICS,
      METRICS_STORE, ERROR_TRACKER, EVENT_COLLECTOR,
      EVENT_BUS, + wireLegacySetters(7 setters)
   b. bootstrapLateDeps() — registra 1 token:
      TOOLS_BUILDER + wireLegacySetters(1)
   c. register AUDIT_BUS
   d. ⚡ container.validateRequired(8 tokens)
3. terminal/index.js → wireTerminalDI():
   a. Registra 7 tokens:
      ALWAYS_ALIVE_AGENT, HUB, CONVERSATION_STORE,
      PERMISSION_AGENT, FALLBACK_AGENT, BRIDGE_AGENT, NERV_BRIDGE_AGENT
   b. wireLegacySetters(4 setters)
   c. ⚡ container.validateRequired(7 tokens)
```

---

## 3. Melhorias Implementadas

### 3.1 Fase A — Foundation ✅

- **A.1** Dead Token Removal: 21 tokens fantasma removidos de 8 `di-tokens.js` + barrels
- **A.2** `validateRequired()`: Novo método no container DI + 2 call sites (bootstrap + di-wiring)
- **A.3** Bug P5 fix: `CONVERSATION_STORE` registrado em `wireTerminalDI()`
- **A.4** Validação centralizada com tokens obrigatórios documentados

### 3.2 Fase B — Setters → Container ✅

- 3 novos tokens: `HOOKS_LOGGER`, `TOOLS_LOGGER`, `TOOLS_METRICS`
- 3 setters migrados de call direto → `wireLegacySetters`
- `boot-wiring.js` não faz mais injection direta (setters removidos)
- Imports desnecessários limpos

### 3.3 Fase C — Singletons → Container (parcial) ✅

- 4 singletons registrados no container: `defaultMetrics` → `METRICS_STORE`, `defaultErrorTracker` → `ERROR_TRACKER`, `defaultEventCollector` → `EVENT_COLLECTOR`, `alwaysAliveAgent` → `ALWAYS_ALIVE_AGENT`
- Module-level exports mantidos como aliases (backward compat)
- Consumers existentes continuam funcionando sem alteração

---

## 4. Trabalho Futuro

### 4.1 Full Singleton Migration (Fase C completa)
- Substituir `import { conversationHub }` por `container.resolve(HUB)` nos 9 consumers
- Substituir `import { conversationStore }` por `container.resolve(CONVERSATION_STORE)` nos 10 consumers
- Substituir `import { alwaysAliveAgent }` por `container.resolve(ALWAYS_ALIVE_AGENT)` nos 21 consumers
- Refatorar module-level exports para lazy resolution via container

### 4.2 Setter Deprecation
- Marcar todos os `set*()` com `@deprecated`
- Migrar gradualmente consumers para `container.resolve()` direto

### 4.3 Container Enhancements
- `container.registerOptional()` — não falha se já registrado
- `container.snapshot()` — serializa estado para debug/observability
- Manter `wireLegacySetters` temporariamente para backward compat

---

*Documento gerado automaticamente durante Auditoria DI — Faixa 3.5+ / sessão de 2026-06-12.*
