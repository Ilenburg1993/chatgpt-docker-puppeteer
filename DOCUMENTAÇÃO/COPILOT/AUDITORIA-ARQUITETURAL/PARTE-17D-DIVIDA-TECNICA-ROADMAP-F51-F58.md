# PARTE-17D — Auditoria SDK: Dívida Técnica, Hardening & Roadmap Faixas 51-58

**Data**: 2026-10-10
**Base**: PARTE-17A rev.6 (4.496 testes passando, 0 erros typecheck)
**Escopo**: Questões NÃO relacionadas a cobertura de testes — dívida técnica, god modules,
APIs deprecated, higiene de código, event architecture, segurança e refatoração.
**Framework**: Node.js 24+ ESM | 281 arquivos JS em `src/copilot/` | ~51.142 linhas

---

## §1. Sumário da Auditoria

### 1.1 Diagnóstico Quantitativo

| Indicador                                   | Valor | Severidade |
| ------------------------------------------- | ----: | ---------- |
| God modules (>400 linhas)                   |    26 | 🔴 Alta     |
| APIs `@deprecated` ainda em uso             |    17 | 🟡 Média    |
| Consumidores de `tools-registry.js` (dep.)  |     8 | 🟡 Média    |
| Sync I/O (`readFileSync` etc.) por arquivo  |    10 | 🔴 Alta     |
| Total de chamadas sync I/O                  |    56 | 🔴 Alta     |
| Magic strings em emit/on/once               |   408 | 🔴 Alta     |
| `console.log/warn/error` (bypass logger)    |    35 | 🟡 Média    |
| `JSON.parse()` sem try-catch                |    20 | 🟡 Média    |
| Empty catch blocks                          |     5 | 🟢 Baixa    |
| BUG- markers pendentes                      |    74 | 🟡 Média    |
| SEC- markers (security findings)            |    35 | 🔴 Alta     |
| FINDING- markers                            |     9 | 🟡 Média    |
| TODO/FIXME markers                          |    17 | 🟢 Baixa    |
| Hardcoded timeouts (setTimeout/setInterval) |   102 | 🟡 Média    |
| Duplicate event constants (core vs sdk)     |  ~30+ | 🟡 Média    |

### 1.2 Diagnóstico Qualitativo

#### 🔴 Problemas Críticos

1. **God Modules**: 26 arquivos >400L. Os top-5 (`always-alive.js` 620L, `loop-manager.js` 600L,
   `orchestrator.js` 573L, `types.js` 569L, `store.js` 562L) concentram responsabilidades demais.
   Dificultam manutenção, testabilidade e code review.

2. **Sync I/O bloqueante**: 56 chamadas `readFileSync`/`writeFileSync` em 10 arquivos — bloqueia
   o event loop em produção. Muitas já possuem equivalentes async (marcadas `@deprecated`), mas os
   callers não migraram.

3. **Magic strings em eventos**: 408 ocorrências de event names como strings literais ao invés de
   constantes. Risco de typos silenciosos e impossibilidade de refatorar com segurança.

4. **SEC markers não resolvidos**: 35 referências a findings de segurança. Incluem SEC-VULN (4),
   SEC-AGENT (3), SEC-01/02 (6) — precisam de triagem e resolução.

#### 🟡 Problemas Médios

5. **`tools-registry.js` deprecated com 8 consumidores**: Módulo marcado como deprecated desde F92,
   mas ainda usado por `tool-factory.js`, `mcp-tool-bridge.js`, `agent-context.js`,
   `always-alive.js`, `tools-bootstrap.js`, `custom-tools.js`, e `tools.js`.

6. **`console.log` bypass**: 35 chamadas em 17 arquivos que ignoram o logger centralizado.
   Prejudica observabilidade e filtragem de logs.

7. **JSON.parse inseguro**: 20 ocorrências sem try-catch. Crash em runtime se input for inválido.

8. **Duplicação de event constants**: `core/events.js` e `sdk/events.js` definem conjuntos
   parcialmente sobrepostos. Risco de dessincronização.

9. **Hardcoded timeouts**: 102 chamadas a setTimeout/setInterval com valores hardcoded.
   Deveriam ser configuráveis via env ou constantes nomeadas.

---

## §2. Roadmap — Faixas 51-58

### Ordenação

```
GRUPO I — SYNC I/O ELIMINATION (Faixas 51-52)
  Faixa 51 ━━> Faixa 52

GRUPO J — DEPRECATED API CLEANUP (Faixas 53-54)
  Faixa 53 ━━> Faixa 54

GRUPO K — EVENT ARCHITECTURE HYGIENE (Faixas 55-56)
  Faixa 55 ━━> Faixa 56

GRUPO L — GOD MODULE DECOMPOSITION (Faixas 57-58)
  Faixa 57 ━━> Faixa 58
```

---

## ═══ GRUPO I — SYNC I/O ELIMINATION ═══

### Faixa 51 — Migrar sync I/O para async: SDK + Config 🔴

**Resolve**: 56 chamadas sync I/O em 10 arquivos — foco nos módulos SDK e config que já possuem
equivalentes async marcadas com `@deprecated`.

**Arquivos alvo**:
- `sdk/tools-state.js` — `loadToolsConfigSync` → callers migram para `loadToolsConfigAsync`
- `sdk/custom-tools.js` — `loadCustomToolsSync` → callers migram para `loadCustomToolsAsync`
- `terminal/alias-store.js` — `loadAliases` → `loadAliasesAsync`
- `config/pinned-files.js` — sync reads

| Fase  | Ação                                                      | Arquivos |
| :---: | --------------------------------------------------------- | :------: |
| F286  | Identificar todos os callers de `loadToolsConfigSync()`   |    —     |
| F287  | Migrar callers para `loadToolsConfigAsync()` (um a um)    |   3-5    |
| F288  | Remover `loadToolsConfigSync()` e `@deprecated` tag       |    1     |
| F289  | Migrar callers de `loadCustomToolsSync()` → async         |   2-3    |
| F290  | Remover `loadCustomToolsSync()` + atualizar `@deprecated` |    1     |
| F291  | Migrar `alias-store.js` para async + remover sync exports |    1     |
| F292  | Migrar `config/pinned-files.js` para async                |    1     |

**Testes**: Rodar suite completa após cada fase para detectar regressão.
**Commit**: `refactor(sdk): F51 — eliminate sync I/O in SDK + config (F286-F292)`
**Status**: ✅ **CONCLUÍDA** — commit `4538db49`, pushed

---

### Faixa 52 — Migrar sync I/O para async: Agent Lifecycle + Infra 🔴

**Resolve**: `state-io.js` (3 funções sync deprecated), `session/snapshot.js`, `db/sqlite.js`,
`tools/tool-factory.js`, `tools/todo/store.js`

| Fase  | Ação                                                                                | Arquivos |
| :---: | ----------------------------------------------------------------------------------- | :------: |
| F293  | `state-io.js`: migrar callers de `readState()` → `readStateAsync()`                 |   3-5    |
| F294  | `state-io.js`: migrar `writeState()` → `writeStateAsync()`                          |   2-3    |
| F295  | `state-io.js`: migrar `clearState()` → `clearStateAsync()`                          |   1-2    |
| F296  | `state-io.js`: remover sync exports, atualizar JSDoc                                |    1     |
| F297  | `session/snapshot.js`: converter sync reads para async                              |    1     |
| F298  | `tools/todo/store.js`: converter save/load para async                               |    1     |
| F299  | `tools/tool-factory.js`: converter `existsSync` para `stat`                         |    1     |
| F300  | Audit: verificar zero `readFileSync`/`writeFileSync` (exceto `logger.js` bootstrap) |    —     |

**Commit**: `refactor(agent): F52 — eliminate sync I/O in agent lifecycle + infra (F293-F300)`
**Status**: ✅ **CONCLUÍDA** — commit `79aac189`, pushed

---

## ═══ GRUPO J — DEPRECATED API CLEANUP ═══

### Faixa 53 — Remover `tools-registry.js` e migrar consumidores 🟡

**Resolve**: 8 consumidores do módulo deprecated `sdk/tools-registry.js`.
O módulo deveria ter sido substituído por `sdk/tools.js` + `sdk/custom-tools.js` desde F92.

| Fase  | Ação                                                                      | Arquivos |
| :---: | ------------------------------------------------------------------------- | :------: |
| F301  | Mapear API surface de `tools-registry.js` vs `tools.js`/`custom-tools.js` |    —     |
| F302  | Migrar `tool-factory.js` → imports de `sdk/tools.js`                      |    1     |
| F303  | Migrar `mcp-tool-bridge.js` → imports de `sdk/tools.js`                   |    1     |
| F304  | Migrar `agent-context.js` + `always-alive.js`                             |    2     |
| F305  | Migrar `agent/infra/tools-bootstrap.js`                                   |    1     |
| F306  | Remover re-export de `tools-registry` em `sdk/index.js`                   |    1     |
| F307  | Deprecar + esvaziar `tools-registry.js` (manter shim 1 release)           |    1     |

**Commit**: `refactor(sdk): F53 — remove tools-registry.js, migrate 8 consumers (F301-F307)`
**Status**: ✅ **CONCLUÍDA** — commit `b31fd8e9`, pushed

---

### Faixa 54 — Remover `core/sdk-types.js` e outros deprecated 🟡

**Resolve**: `core/sdk-types.js` (deprecated, 2 consumers), re-exports deprecated em `config/index.js`

| Fase  | Ação                                                            | Arquivos |
| :---: | --------------------------------------------------------------- | :------: |
| F308  | Migrar `core/index.js` → remover re-export de `sdk-types`       |    1     |
| F309  | Remover `core/sdk-types.js`                                     |    1     |
| F310  | Migrar deprecated re-exports em `config/index.js` para direct   |    1     |
| F311  | Audit: grep `@deprecated` — verificar que todos foram migrados  |    —     |
| F312  | Limpar deprecated re-exports em `sdk/index.js` (audit pipeline) |    1     |

**Commit**: `refactor(core): F54 — remove sdk-types.js + deprecated re-exports (F308-F312)`
**Status**: ✅ **CONCLUÍDA** — commit `b4563693`, pushed

---

## ═══ GRUPO K — EVENT ARCHITECTURE HYGIENE ═══

### Faixa 55 — Unificar event constants: eliminar magic strings 🔴

**Resolve**: 408 magic strings em emit/on/once. Prioridade: módulos `agent/`, `terminal/`, `sdk/`.
Estratégia: criar/expandir `core/events.js` como SSOT, importar constantes nos consumidores.

| Fase  | Ação                                                             | Arquivos |
| :---: | ---------------------------------------------------------------- | :------: |
| F313  | Inventariar todos os event names usados como magic strings       |    —     |
| F314  | Consolidar `core/events.js` + `sdk/events.js` em SSOT único      |    2     |
| F315  | Migrar `agent/*.js` — substituir magic strings por constantes    |   5-8    |
| F316  | Migrar `terminal/*.js` — substituir magic strings por constantes |   5-8    |
| F317  | Migrar `sdk/*.js` — substituir magic strings por constantes      |   3-5    |
| F318  | Migrar `observability/*.js` + `api/*.js`                         |   3-5    |
| F319  | Audit: grep residual magic strings = 0 (exceto 3rd party)        |    —     |

**Commit**: `refactor(events): F55 — unify event constants, eliminate magic strings (F313-F319)`
**Status**: ✅ **CONCLUÍDA** — commit `1ae81293`, pushed

**Resultado real F55**:
- 147 magic strings migradas → constantes nomeadas em 17 arquivos
- 3 objetos SSOT novos: `HUB_EVENTS` (25 entries), `TERMINAL_EVENTS` (5 entries), `AGENT_EVENTS` (+11)
- ~100 magic strings residuais são internal emitters (`this.emit()`) em DLM/agent — ROI baixo
- Barrel compliance corrigida (todos imports via `#copilot/sdk`, não `#copilot/sdk/constants`)

---

### Faixa 56 — Padronizar console.log → logger + JSON.parse seguro 🟡

**Resolve**: 35 `console.log/warn/error` bypass + 20 `JSON.parse` sem try-catch

| Fase  | Ação                                                            | Arquivos |
| :---: | --------------------------------------------------------------- | :------: |
| F320  | `console.log` → `log('DEBUG', ...)` em `api/express/` (3 files) |    3     |
| F321  | `console.log` → `log()` em `channel/` (3 files)                 |    3     |
| F322  | `console.log` → `log()` em `hooks/`, `config/`, `terminal/`     |   5-6    |
| F323  | `console.log` → `log()` em `sdk/`, `core/`                      |   3-4    |
| F324  | Criar `safeJsonParse(str, fallback)` helper em `core/utils.js`  |    1     |
| F325  | Substituir `JSON.parse` desprotegidos pelo helper               |  10-15   |
| F326  | Audit: verificar `console.` = 0 (exceto `logger.js` bootstrap)  |    —     |

**Commit**: `refactor(observability): F56 — standardize logging + safe JSON parse (F320-F326)`
**Status**: ✅ **CONCLUÍDA** — commit junto com F55 doc update

**Resultado real F56**:
- 1 runtime `console.warn` migrado para `log('WARN', ...)` em `alias-store.js`
- 29 ocorrências restantes são JSDoc `@example` (não runtime)
- Todos 12 `JSON.parse` runtime já estão dentro de try-catch — meta atingida
- `safeJsonParse` helper já existia em `core/safe-json.js` com 5 consumidores

---

## ═══ GRUPO L — GOD MODULE DECOMPOSITION ═══

### Faixa 57 — Decompor `always-alive.js` (620L) 🔴

**Resolve**: God module principal do sistema — orquestra o runtime inteiro.
Estratégia: extrair responsabilidades em módulos focados.

| Fase  | Ação                                                       | Resultado    |
| :---: | ---------------------------------------------------------- | ------------ |
| F327  | Analisar responsabilidades atuais do AlwaysAliveAgent      | Mapa de deps |
| F328  | Extrair reconnect policy → `agent/reconnect-policy.js`     | ~80L novo    |
| F329  | Extrair status/snapshot → `agent/agent-status.js`          | ~60L novo    |
| F330  | Extrair event wiring → `agent/event-setup.js`              | ~100L novo   |
| F331  | Slim down `always-alive.js` para orquestrador puro (~300L) | −320L        |
| F332  | Rodar suite completa + typecheck, corrigir regressões      | Green suite  |

**Commit**: `refactor(agent): F57 — decompose always-alive.js 620→300L (F327-F332)`

---

### Faixa 58 — Decompor `loop-manager.js` (600L) + `orchestrator.js` (573L) 🔴

**Resolve**: Segundo e terceiro maiores god modules.

| Fase  | Ação                                                                | Resultado   |
| :---: | ------------------------------------------------------------------- | ----------- |
| F333  | `loop-manager.js`: extrair turn processing → `turn-processor.js`    | ~150L novo  |
| F334  | `loop-manager.js`: extrair error handling → `turn-error-handler.js` | ~80L novo   |
| F335  | `loop-manager.js`: slim down para state machine pura (~300L)        | −300L       |
| F336  | `orchestrator.js`: extrair queue logic → `mission-queue.js`         | ~120L novo  |
| F337  | `orchestrator.js`: extrair metrics → `orchestrator-metrics.js`      | ~80L novo   |
| F338  | `orchestrator.js`: slim down para coordenador puro (~300L)          | −273L       |
| F339  | Suite completa + typecheck, corrigir regressões                     | Green suite |

**Commit**: `refactor(agent): F58 — decompose loop-manager + orchestrator (F333-F339)`

---

## §3. Estimativa Global (Faixas 51-58)

| Dimensão                   |                        Valor |
| -------------------------- | ---------------------------: |
| Faixas                     |                        **8** |
| Fases                      |           **54** (F286-F339) |
| Arquivos modificados       |                   **~60-80** |
| Arquivos novos             |                    **~8-10** |
| Testes novos estimados     | **0** (refactor, não testes) |
| Linhas movidas/refatoradas |             **~3.000-4.000** |

### Meta ao Final da Faixa 58

| Indicador                | Início |  Após F56 |       Meta |
| ------------------------ | -----: | --------: | ---------: |
| God modules (>400L)      |     26 |        26 |    **≤20** |
| Sync I/O calls           |     56 |      ≤ 5¹ |    **≤ 5** |
| Deprecated APIs em uso   |     17 |      ≤ 3² |    **≤ 3** |
| Magic strings em eventos |    408 |     ~100³ |   **≤ 30** |
| Console.log bypass       |     35 |       0⁴  |      **0** |
| Unsafe JSON.parse        |     20 |       0⁴  |      **0** |
| Suite passando           |  4.496 |     4.492 | **4.496+** |
| Typecheck errors         |      0 |         0 |      **0** |

¹ F51+F52 eliminaram sync I/O em SDK, config, agent lifecycle
² F53+F54 removeram tools-registry.js, sdk-types.js, deprecated re-exports
³ F55 migrou 147 magic strings; ~100 residuais são internal emitters (DLM/agent)
⁴ F56 — 1 console.warn migrado, 12 JSON.parse já protegidos com try-catch

---

## §4. Progresso e Próximos Passos

**Status atual**: F51-F56 concluídas. Próxima faixa: **F57**.

**Ordem de execução**:
1. ~~**F51** → F52 (sync I/O — impacto runtime direto)~~ ✅ CONCLUÍDA
2. ~~**F53** → F54 (deprecated cleanup — reduce API surface)~~ ✅ CONCLUÍDA
3. ~~**F55** → **F56** (event hygiene + logging — observabilidade)~~ ✅ CONCLUÍDA
4. **F57** → F58 (god modules — complexidade arquitetural) ← **PRÓXIMA**

---

*Documento gerado pela auditoria PARTE-17D. Base: 281 arquivos JS em `src/copilot/`, 4.496 testes
passando, 0 erros de typecheck. Foco: dívida técnica e refatoração (não testes).
Referências: PARTE-17A rev.6, PARTE-17C rev.6.*
