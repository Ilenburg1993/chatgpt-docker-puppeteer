# PARTE-17C — Roadmap rev.5: Novas Faixas 35-42

**Data**: 2026-10-04
**Base**: PARTE-17C rev.4 (22 faixas) + Análise pós-sessão Faixas 28-34
**Estado**: Faixas 1-34 concluídas. Faixas 35-42 são as próximas.
**Framework**: Node.js 24+ ESM | Vitest 4 | 3.053 testes passando

---

## Contexto e Situação Atual

Após a conclusão das Faixas 28-34, o estado do `src/copilot/` é:

| Métrica                 |                      Valor |
| ----------------------- | -------------------------: |
| Testes passando         |          **3.053 / 3.053** |
| Specs em `sdk/`         | **39 specs, 1.040 testes** |
| Bypasses fora de `sdk/` |                      **0** |
| Typecheck errors        |  **33** (baseline estável) |
| God modules >400L       |                         22 |
| Cobertura `api/`        |                       ~10% |
| Cobertura `channel/`    |                         0% |

### Lacunas Prioritárias (nova auditoria)

```
🔴 ALTA
  tools/file/write-tools.js  (339L) — zero testes
  api/express/session-crud.js (371L) — zero testes
  api/express/session-messaging.js (292L) — zero testes

🟡 MÉDIA
  api/express/observability.js (310L) — zero testes
  sdk/custom-tools.js (327L) — apenas importação indireta
  sdk/agent-contract.js (76L) — zero testes
  sdk/bridge-contract.js (55L) — zero testes
  sdk/channel-contract.js (55L) — zero testes

🟢 BAIXA
  channel/* (1.497L total, 0 specs)
  sdk/tools-state.js (50L) — parcial
```

---

## Ordenação das Novas Faixas

```
GRUPO A — TOOLS COVERAGE (Faixas 35-36)
  Faixa 35 ━━> Faixa 36

GRUPO B — API EXPRESS COVERAGE (Faixas 37-38)
  Faixa 37 ━━> Faixa 38

GRUPO C — SDK CONTRACTS + CUSTOM TOOLS (Faixa 39)
  Faixa 39 (independente)

GRUPO D — CHANNEL COVERAGE + GOD MODULE DECOMPOSIÇÃO (Faixas 40-42)
  Faixa 40 ━━> Faixa 41 ━━> Faixa 42
```

---

## ═══ GRUPO A — TOOLS COVERAGE ═══

### Faixa 35 — Write Tools Test Suite 🔴

**Resolve**: `tools/file/write-tools.js` sem cobertura alguma (339L, 6 tools críticas)
**Cria**: `tests/unit/copilot/tools/file/test_write_tools.spec.js`

| Fase  | Ação                                                          | Testes |
| :---: | ------------------------------------------------------------- | :----: |
| F181  | `write_file_content`: escrita normal, validação de path       |   8    |
| F182  | `write_file_content`: falha se arquivo não existe, base64     |   5    |
| F183  | `atomicWrite` via spy: gravação temp + rename                 |   4    |
| F184  | `create_file`: cria novo, erro se já existir                  |   6    |
| F185  | `delete_file`: deleta, erro se não existe, valida path        |   5    |
| F186  | `copy_file` + `move_file`: cenários normais e erros           |   8    |
| F187  | `patch_file`: aplicação de patch, validação, erro sem context |   6    |
| F188  | Smoke: todas as 6 tools são exportadas no array               |   3    |

**Tests estimados**: ~45
**Commit**: `test(tools): F35 — write tools full test suite (F181-F188)`

---

### Faixa 36 — Shell Tools Expanded + Session Tools Coverage 🟡

**Resolve**: `tools/session-tools.js` e `shell/index.js` com cobertura parcial
**Cria ou expande**: spec existente para ambos

| Fase  | Ação                                                         | Testes |
| :---: | ------------------------------------------------------------ | :----: |
| F189  | `session-tools.js`: listar sessões, criar, carregar por nome |   8    |
| F190  | `session-tools.js`: erros de validação e SDK null            |   5    |
| F191  | `shell/exec_command`: blocklist, cwd validation, pipeline    |   10   |
| F192  | `shell/run_npm_script`: whitelist, timeout                   |   6    |
| F193  | `shell/run_node_file`: validação extensão, path traversal    |   6    |
| F194  | Regression: handler types (TS7031 fix via cast)              |   3    |

**Tests estimados**: ~38
**Commit**: `test(tools): F36 — session-tools + shell expanded (F189-F194)`

---

## ═══ GRUPO B — API EXPRESS COVERAGE ═══

### Faixa 37 — Session CRUD API Test Suite 🔴

**Resolve**: `api/express/session-crud.js` (371L) + `session-messaging.js` (292L) sem cobertura
**Cria**: `tests/unit/copilot/api/test_session_crud.spec.js`

| Fase  | Ação                                                    | Testes |
| :---: | ------------------------------------------------------- | :----: |
| F195  | `GET /sessions/active` e `GET /sessions/last`           |   6    |
| F196  | `POST /sessions/:id/create`: body validation, SDK mock  |   8    |
| F197  | `GET /sessions/:id`: found, not found                   |   4    |
| F198  | `DELETE /sessions/:id/delete`, `POST .../disconnect`    |   6    |
| F199  | `POST .../resume`: validação modelo, SDK mock           |   6    |
| F200  | `POST .../foreground`, `GET .../compaction-history`     |   6    |
| F201  | `session-messaging`: `/send` e `/respond` endpoint      |   8    |
| F202  | `session-messaging`: validações, SDK null, model switch |   6    |

**Tests estimados**: ~50
**Commit**: `test(api): F37 — session CRUD + messaging API tests (F195-F202)`

---

### Faixa 38 — API Observability + Hooks Routes 🟡

**Resolve**: `api/express/observability.js` (310L) + `api/express/hooks.js` sem cobertura isolada
**Cria**: `tests/unit/copilot/api/test_api_observability.spec.js`

| Fase  | Ação                                                      | Testes |
| :---: | --------------------------------------------------------- | :----: |
| F203  | `GET /metrics/summary`: formato, métricas vazias          |   5    |
| F204  | `GET /metrics/tool-stats`: stats, filtro por tool         |   5    |
| F205  | `GET /health/status`: healthy, degraded                   |   5    |
| F206  | `POST /hooks/register`, `POST /hooks/unregister`          |   6    |
| F207  | `GET /hooks/list`: formato, vazio, filtro                 |   4    |
| F208  | Error propagation: middleware, CopilotError → HTTP status |   6    |

**Tests estimados**: ~31
**Commit**: `test(api): F38 — observability + hooks route tests (F203-F208)`

---

## ═══ GRUPO C — SDK CONTRACTS + CUSTOM TOOLS ═══

### Faixa 39 — SDK Contracts + Custom Tools Coverage 🟡

**Resolve**: `sdk/agent-contract.js`, `bridge-contract.js`, `channel-contract.js` (186L total)
  + `sdk/custom-tools.js` (327L) com cobertura insuficiente
**Cria**: `tests/unit/copilot/sdk/test_sdk_contracts_f39.spec.js`

| Fase  | Ação                                                   | Testes |
| :---: | ------------------------------------------------------ | :----: |
| F209  | `agent-contract.js`: shape validation, required props  |   6    |
| F210  | `bridge-contract.js`: contract checks                  |   4    |
| F211  | `channel-contract.js`: contract checks                 |   4    |
| F212  | `custom-tools.js`: `buildCustomTool` com config válida |   6    |
| F213  | `custom-tools.js`: validação de parâmetros Zod         |   4    |
| F214  | `custom-tools.js`: integração com tools-registry       |   5    |
| F215  | `tools-state.js`: enable/disable, getDisabled completo |   5    |

**Tests estimados**: ~34
**Commit**: `test(sdk): F39 — contracts + custom-tools coverage (F209-F215)`

---

## ═══ GRUPO D — CHANNEL + GOD MODULES ═══

### Faixa 40 — Channel Module Coverage 🟡

**Resolve**: `src/copilot/channel/` (0% cobertura, ~1.497L, 7 arquivos)
**Foco**: `channel/inject.js` (451L) e `channel/client.js` (557L)
**Cria**: `tests/unit/copilot/channel/test_channel_inject.spec.js`
         `tests/unit/copilot/channel/test_channel_client.spec.js`

| Fase  | Ação                                                  | Testes |
| :---: | ----------------------------------------------------- | :----: |
| F216  | `channel/inject.js`: `injectChannel` básico, headers  |   7    |
| F217  | `channel/inject.js`: validação URL, token, rate limit |   6    |
| F218  | `channel/inject.js`: error scenarios, retry           |   5    |
| F219  | `channel/client.js`: `createChannelClient` init       |   6    |
| F220  | `channel/client.js`: `send`, `receive`, disconnect    |   8    |
| F221  | `channel/client.js`: mode switching, lifecycle        |   5    |

**Tests estimados**: ~37
**Commit**: `test(channel): F40 — channel inject + client coverage (F216-F221)`

---

### Faixa 41 — God Module Decomposição: rpc.js 🟡

**Resolve**: `sdk/rpc.js` (484L) é god module — extrair subsistemas como módulos testáveis
**Refatora**: split de `sdk/rpc.js` → `sdk/rpc/` como sub-diretório modular

| Fase  | Ação                                                             | Testes |
| :---: | ---------------------------------------------------------------- | :----: |
| F222  | Criar `sdk/rpc/model.js` (getCurrent, switchTo)                  |   5    |
| F223  | Criar `sdk/rpc/mode.js` (get, set)                               |   5    |
| F224  | Criar `sdk/rpc/plan.js` (read, update, delete)                   |   6    |
| F225  | Criar `sdk/rpc/shell.js` (exec, kill)                            |   6    |
| F226  | Criar `sdk/rpc/ui.js` (elicitation)                              |   5    |
| F227  | Manter `sdk/rpc.js` como re-export barrel (zero breaking change) |   3    |
| F228  | Atualizar testes existentes para apontar para novos sub-módulos  |   0    |

**Tests estimados**: ~30 novos + manutenção dos existentes
**Commit**: `refactor(sdk): F41 — rpc.js decomposed into sdk/rpc/ submodules (F222-F228)`

---

### Faixa 42 — Typecheck Hardening: Eliminar os 33 Erros Baseline 🟡

**Resolve**: os 33 erros de typecheck que existiam antes desta sessão (pré-existentes)
**Tipo de trabalho**: auditoria + correção cirúrgica de cada erro

| Fase  | Ação                                                        | Testes  |
| :---: | ----------------------------------------------------------- | :-----: |
| F229  | Inventário dos 33 erros: categorizar por arquivo e tipo     |    —    |
| F230  | Corrigir erros `TS2345` em `session-messaging.js`           | 0 (fix) |
| F231  | Corrigir erros `TS2304/TS2345` em specs (test files)        | 0 (fix) |
| F232  | Corrigir erros `TS7031` (binding element implicitly any)    | 0 (fix) |
| F233  | Corrigir erros remanescentes em `session_lifecycle.spec.js` | 0 (fix) |
| F234  | Verificar `npm run typecheck:node` → 0 errors               |    —    |
| F235  | Verificar `npm run typecheck:full` → sem novos erros        |    —    |

**Tests estimados**: 0 (fix-only)
**Commit**: `fix(types): F42 — eliminate all 33 baseline typecheck errors (F229-F235)`

---

## Estimativa Global (Faixas 35-42)

| Dimensão                |                     Valor |
| ----------------------- | ------------------------: |
| Faixas                  |                     **8** |
| Fases                   |        **55** (F181-F235) |
| Testes novos estimados  |                  **~235** |
| Arquivos novos de teste |                    **~8** |
| Arquivos modificados    | **~5** (F41 decomposição) |

### Meta ao final da Faixa 42

| Métrica              | Atual |                  Meta |
| -------------------- | ----: | --------------------: |
| Testes passando      | 3.053 |      **+230 = 3.283** |
| Typecheck errors     |    33 |                 **0** |
| Cobertura `api/`     |  ~10% |              **~60%** |
| Cobertura `channel/` |    0% |              **~50%** |
| God modules >400L    |    22 | **21** (rpc.js split) |
| Bypasses fora sdk/   |     0 |        **0** (manter) |

---

## Priorização para Início Imediato

**Início recomendado**: Faixa 35 (write-tools) — maior criticidade operacional,
arquivo 100% sem cobertura com 6 tools de escrita de arquivos (path traversal,
atomic write, delete — todas de risco de segurança).

**Ordem sugerida**:
1. **F35** → F36 (tools coverage — operacionais)
2. **F37** → F38 (api coverage — alta visibilidade)
3. **F39** (sdk contracts — completude)
4. **F42** (typecheck — cleanup técnico)
5. F40 → F41 (channel + refactor — menor urgência)
