# 07 — ROADMAP MASTER: SDK Copilot 100% Coverage

**Data**: 2026-03-21 | **Revisado**: 2026-03-21
**Status**: Versão Definitiva (pós revisão crítica)
**Referências**: Todos os documentos 00–06 desta auditoria

---

## Visão Geral

Este roadmap organiza TODO o trabalho necessário para levar o `src/copilot/` de ~75% para 100% de
cobertura do `@github/copilot-sdk`, corrigir bugs catalogados, e migrar para a arquitetura ideal
descrita em [05-ARQUITETURA-IDEAL.md](./05-ARQUITETURA-IDEAL.md).

**Estimativa total**: ~208h
**Organização**: 9 Faixas × múltiplas Fases × Subfases

---

## Legenda

| Símbolo | Significado                                |
| ------- | ------------------------------------------ |
| 🔴       | P0 — Crítico (bugs, type safety)           |
| 🟠       | P1 — Alto (features core, observabilidade) |
| 🟡       | P2 — Moderado (features experimentais)     |
| 🟢       | P3 — Baixo (otimização, polish)            |
| ⬜       | Não iniciado                               |
| 🔵       | Em progresso                               |
| ✅       | Concluído                                  |

---

## FAIXA A — Bug Fixes & Misalignments

**Referência**: [03-BUGS-MISALIGNMENTS.md](./03-BUGS-MISALIGNMENTS.md)
**Estimativa**: ~18h
**Risco**: Baixo (correções pontuais)

### Fase A1 — Bugs Diretos (~3.5h) 🔴

| #    | Subfase                             | Descrição                                                       | Estimativa | Ref    |
| ---- | ----------------------------------- | --------------------------------------------------------------- | ---------- | ------ |
| A1.1 | ✅ ~~Remover `injectHookContext`~~   | FALSO POSITIVO — campo é flag interno consumido por initializer | 0h         | BUG-01 |
| A1.2 | ✅ ~~Corrigir system message mode~~  | RECLASSIFICADO — `customize`+`content` válido no SDK; defer→I   | 0h         | BUG-02 |
| A1.3 | ✅ Eliminar `Record<string,unknown>` | Refatorado para `Partial<SessionConfig>` com tipos SDK reais    | 2h         | BUG-03 |
| A1.4 | ✅ Validar `reasoningEffort`         | Validação contra `REASONING_EFFORTS` + warn log                 | 0.5h       | BUG-06 |
| A1.5 | ✅ Alinhar compaction threshold      | Usa `INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD` | 0.5h       | BUG-10 |
| A1.6 | ✅ Testes de regressão               | 11 testes em `test_lifecycle_a1_fixes.spec.js`                  | 0.5h       | —      |

### Fase A2 — Misalignments (~6h) 🟠

| #    | Subfase                          | Descrição                                                                                               | Estimativa | Ref       |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| A2.1 | ✅ ~~Threshold compaction~~       | Absorvido por A1.5 — já alinhado a 0.8                                                                  | 0h         | BUG-10-10 |
| A2.2 | ✅ Cobrir SessionConfig faltantes | `clientName` e `workingDirectory` adicionados; demais campos são features avançadas sem infra (Faixa C) | 1h         | BUG-07    |
| A2.3 | ✅ WARN `approveAll` fallback     | Log WARN quando `onPermissionRequest` não fornecido; fallback preservado para compat                    | 0.5h       | BUG-08    |
| A2.4 | ✅ Testes de regressão            | 4 testes (clientName present/absent, approveAll WARN/no-WARN) em `test_lifecycle_a1_fixes.spec.js`      | 0.5h       | —         |

### Fase A3 — Dead Code Cleanup (~6h) 🟠

| #    | Subfase                      | Descrição                                                                                                                                                                  | Estimativa | Ref    |
| ---- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| A3.1 | ✅ Migrar boot-wiring         | `boot-wiring.js` refatorado: `client.on()` → `onLifecycleEvents()` via `client-events.js`                                                                                  | 1h         | BUG-04 |
| A3.2 | ✅ Wire experimental RPC      | Reescrita completa de `experimental.js` (SDK-aligned, 20 funções), criação de `experimental-rpc-tools.js` (20 tools), wiring via `setExperimentalSession()`, 45 testes F22 | 4h         | BUG-05 |
| A3.3 | ✅ Audit trail para dead code | Reclassificações documentadas no doc 03. BUG-04→DEBT, BUG-05 DEAD CODE (Faixa D), BUG-11→FALSO POS.                                                                        | 0.5h       | —      |
| A3.4 | ✅ Testes lifecycle + campos  | 16 testes A3 em `test_lifecycle_a1_fixes.spec.js`: boot-wiring imports, 7 campos SessionConfig × 2                                                                         | 1h         | —      |
| A3.5 | ✅ BUG-09 SectionTransformFn  | 3 testes adicionados em `test_sdk_system_message.spec.js`: sync, async, customizeSystemMessage                                                                             | 0.5h       | BUG-09 |
| A3.6 | ✅ BUG-11 catch-all avaliado  | `wireCatchAll()` apenas loga eventos desconhecidos — reclassificado FALSO POSITIVO                                                                                         | 0h         | BUG-11 |
| A3.7 | ✅ BUG-08 JSDoc documentação  | `rpc/session.js:modelSwitchTo()` JSDoc note →preferir `session.setModel()`                                                                                                 | 0h         | BUG-08 |
| A3.8 | ✅ BUG-07 All SessionConfig   | 7 novos campos (availableTools,excludedTools,configDir,onEvent,agent,skillDirectories,disabledSkills)                                                                      | 0.5h       | BUG-07 |

---

## FAIXA I — System Prompt Modular (Replace-First)

**Referência**: [08-SYSTEM-PROMPT-MODULAR.md](./08-SYSTEM-PROMPT-MODULAR.md)
**Estimativa**: ~14h
**Risco**: Baixo (modular, backward compat via facade)
**Resolve**: BUG-02, GAP-E02, cobertura 10/10 seções SDK

> Controle total do system prompt com modo `replace` como padrão, estrutura modular com 1 arquivo
> por seção, e troca fácil para `customize` via flag.

### Fase I1 — Estrutura e Migração (~6h) ✅

| #    | Subfase                                      | Descrição                                               | Status |
| ---- | -------------------------------------------- | ------------------------------------------------------- | ------ |
| I1.1 | ✅ Criar pasta `config/system-prompt/`        | Estrutura: index.js, mode.js, sections/, sdk-defaults/  | DONE   |
| I1.2 | ✅ Migrar 7 constantes existentes             | AGENT_IDENTITY→identity.js, AGENT_TONE→tone.js, etc.    | DONE   |
| I1.3 | ✅ Criar 3 seções novas                       | safety.js, tool-instructions.js, custom-instructions.js | DONE   |
| I1.4 | ✅ Implementar assembler dual-mode (index.js) | buildSystemMessage() com replace/customize switch       | DONE   |
| I1.5 | ✅ Backward compat facade em system-prompt.js | Re-exports para compatibilidade                         | DONE   |

### Fase I2 — Integração e Captura (~5h) ✅

| #    | Subfase                              | Descrição                                               | Status |
| ---- | ------------------------------------ | ------------------------------------------------------- | ------ |
| I2.1 | ✅ Atualizar lifecycle.js             | Passthrough automático (sem mudança necessária)         | DONE   |
| I2.2 | ✅ Atualizar initializer.js           | Wire do novo buildSystemMessage() via importação direta | DONE   |
| I2.3 | ✅ Implementar captura SDK defaults   | SectionTransformFn para extrair conteúdo padrão         | DONE   |
| I2.4 | ⬜ Documentar SDK defaults capturados | Salvar em sdk-defaults/ como referência                 | FUTURO |
| I2.5 | ✅ Flag de modo via env               | COPILOT_SYSTEM_PROMPT_MODE=replace\|customize           | DONE   |

### Fase I3 — Testes (~3h) ✅

| #    | Subfase                        | Descrição                                        | Status |
| ---- | ------------------------------ | ------------------------------------------------ | ------ |
| I3.1 | ✅ Testes unitários por seção   | 10 seções verificadas: CONTENT + ACTION          | DONE   |
| I3.2 | ✅ Teste de assembler dual-mode | replace vs customize produzem output válido      | DONE   |
| I3.3 | ✅ Teste de backward compat     | Funções antigas continuam funcionando via facade | DONE   |

---

## FAIXA B — Event Handlers 100% Coverage

**Referência**: [02-GAPS-FUNCIONAIS-SDK.md](./02-GAPS-FUNCIONAIS-SDK.md) Faixa D
**Estimativa**: ~32h
**Risco**: Baixo-Moderado (aditivo)

### Fase B1 — Session Events (~10h) 🟠

| #    | Subfase                                | Descrição                               | Estimativa |
| ---- | -------------------------------------- | --------------------------------------- | ---------- |
| B1.1 | ⬜ `session.idle` handler               | Detectar sessão ociosa, emitir para hub | 2h         |
| B1.2 | ⬜ `session.error` handler              | Error categorization + recovery logic   | 2h         |
| B1.3 | ⬜ `session.abort` handler              | Cleanup resources on abort              | 1h         |
| B1.4 | ⬜ `session.paused` / `session.resumed` | State tracking para UI                  | 2h         |
| B1.5 | ⬜ `session.snapshot_created`           | Snapshot tracking para rewind           | 1h         |
| B1.6 | ⬜ Testes para session events           | Mock events + verify handler behavior   | 2h         |

### Fase B2 — MCP & OAuth Events (~8h) 🟠

| #    | Subfase                               | Descrição                                  | Estimativa |
| ---- | ------------------------------------- | ------------------------------------------ | ---------- |
| B2.1 | ⬜ `mcp.server_status_changed` handler | Bridge MCP status → EventBus               | 2h         |
| B2.2 | ⬜ `mcp.oauth_*` handlers (4 events)   | OAuth flow: start, complete, error, cancel | 3h         |
| B2.3 | ⬜ MCP status dashboard endpoint       | REST endpoint para MCP server health       | 2h         |
| B2.4 | ⬜ Testes para MCP events              | Mock MCP status changes                    | 1h         |

### Fase B3 — Tool Events Avançados (~6h) 🟡

| #    | Subfase                         | Descrição                     | Estimativa |
| ---- | ------------------------------- | ----------------------------- | ---------- |
| B3.1 | ⬜ `tool.progress` handler       | Progress tracking per-tool    | 2h         |
| B3.2 | ⬜ `tool.error` handler dedicado | Error classification per-tool | 2h         |
| B3.3 | ⬜ `tool.output_*` handlers      | Output streaming por tool     | 1h         |
| B3.4 | ⬜ Testes                        |                               | 1h         |

### Fase B4 — Skill, Command, Permission Events (~8h) 🟡

| #    | Subfase                               | Descrição                  | Estimativa |
| ---- | ------------------------------------- | -------------------------- | ---------- |
| B4.1 | ⬜ `skill.*` handlers (3+ events)      | Skill lifecycle tracking   | 2h         |
| B4.2 | ⬜ `command.*` handlers (3+ events)    | Command execution tracking | 2h         |
| B4.3 | ⬜ `permission.*` handlers (3+ events) | Permission audit trail     | 2h         |
| B4.4 | ⬜ Testes                              |                            | 2h         |

---

## FAIXA C — SessionConfig 100% Coverage

**Referência**: [02-GAPS-FUNCIONAIS-SDK.md](./02-GAPS-FUNCIONAIS-SDK.md) Faixa B
**Estimativa**: ~20h
**Risco**: Moderado (mudar config builder)

### Fase C1 — SessionConfigBuilder (~8h) 🔴

| #    | Subfase                        | Descrição                                        | Estimativa |
| ---- | ------------------------------ | ------------------------------------------------ | ---------- |
| C1.1 | ⬜ Criar `SessionConfigBuilder` | Builder pattern tipado (ver 05-doc)              | 4h         |
| C1.2 | ⬜ Migrar `lifecycle.js`        | Substituir `Record<string,unknown>` pelo builder | 2h         |
| C1.3 | ⬜ Migrar `session-setup.js`    | Usar builder em `buildSessionOptions()`          | 1h         |
| C1.4 | ⬜ Testes do builder            | Verificar todos os 21 campos                     | 1h         |

### Fase C2 — Opções Faltantes (~8h) 🟠

| #    | Subfase                                 | Descrição                                    | Estimativa |
| ---- | --------------------------------------- | -------------------------------------------- | ---------- |
| C2.1 | ⬜ `availableTools` / `excludedTools`    | Delegação de filtering estático ao SDK       | 3h         |
| C2.2 | ⬜ `skillDirectories` / `disabledSkills` | Suporte a skills externos                    | 2h         |
| C2.3 | ⬜ `agent` config                        | Custom agent na sessão                       | 1h         |
| C2.4 | ⬜ `onEvent` handler global              | Event callback alternativo ao `session.on()` | 1h         |
| C2.5 | ⬜ `clientName` / `configDir`            | Identificação de client                      | 1h         |

### Fase C3 — CopilotClientOptions (~4h) 🟡

| #    | Subfase                    | Descrição                           | Estimativa |
| ---- | -------------------------- | ----------------------------------- | ---------- |
| C3.1 | ⬜ `logLevel` mapping       | Mapear LOG_LEVEL → SDK logLevel     | 0.5h       |
| C3.2 | ⬜ `env` passthrough        | Filtrar e passar env ao CLI         | 1h         |
| C3.3 | ⬜ `onListModels` para BYOK | Hook para listar modelos customized | 1.5h       |
| C3.4 | ⬜ `githubToken` support    | Org/personal token config           | 1h         |

---

## FAIXA D — Experimental RPC Exposure

**Referência**: [02-GAPS-FUNCIONAIS-SDK.md](./02-GAPS-FUNCIONAIS-SDK.md) Faixa C
**Estimativa**: ~30h
**Risco**: Moderado (feature-flagged)

### Fase D1 — Skills Management Tools (~6h) 🟡

| #    | Subfase                          | Descrição                        | Estimativa |
| ---- | -------------------------------- | -------------------------------- | ---------- |
| D1.1 | ⬜ Tool `sdk_skills_list`         | Lista skills disponíveis via RPC | 1h         |
| D1.2 | ⬜ Tool `sdk_skills_enable`       | Habilitar skill por nome         | 1h         |
| D1.3 | ⬜ Tool `sdk_skills_disable`      | Desabilitar skill por nome       | 1h         |
| D1.4 | ⬜ Tool `sdk_skills_status`       | Status de um skill               | 1h         |
| D1.5 | ⬜ REST endpoints `/api/skills/*` | Expor via HTTP                   | 1h         |
| D1.6 | ⬜ Testes (feature flag on/off)   |                                  | 1h         |

### Fase D2 — MCP Management Tools (~6h) 🟡

| #    | Subfase                             | Descrição            | Estimativa |
| ---- | ----------------------------------- | -------------------- | ---------- |
| D2.1 | ⬜ Tool `sdk_mcp_list`               | Lista MCP servers    | 1h         |
| D2.2 | ⬜ Tool `sdk_mcp_enable` / `disable` | Toggle MCP server    | 2h         |
| D2.3 | ⬜ Tool `sdk_mcp_status`             | Status de MCP server | 1h         |
| D2.4 | ⬜ REST endpoints `/api/mcp/*`       | Expor via HTTP       | 1h         |
| D2.5 | ⬜ Testes                            |                      | 1h         |

### Fase D3 — Agent Management Tools (~6h) 🟡

| #    | Subfase                                 | Descrição        | Estimativa |
| ---- | --------------------------------------- | ---------------- | ---------- |
| D3.1 | ⬜ Tool `sdk_agents_list`                | Lista agents     | 1h         |
| D3.2 | ⬜ Tool `sdk_agents_select` / `deselect` | Seleção de agent | 2h         |
| D3.3 | ⬜ Tool `sdk_agents_status`              | Status do agent  | 1h         |
| D3.4 | ⬜ REST endpoint                         |                  | 1h         |
| D3.5 | ⬜ Testes                                |                  | 1h         |

### Fase D4 — Extensions & Plugins (~6h) 🟢

| #    | Subfase                                    | Descrição        | Estimativa |
| ---- | ------------------------------------------ | ---------------- | ---------- |
| D4.1 | ⬜ Tool `sdk_extensions_list`               | Lista extensions | 1h         |
| D4.2 | ⬜ Tool `sdk_extensions_enable` / `disable` | Toggle extension | 2h         |
| D4.3 | ⬜ Tool `sdk_plugins_list`                  | Lista plugins    | 1h         |
| D4.4 | ⬜ REST endpoints                           |                  | 1h         |
| D4.5 | ⬜ Testes                                   |                  | 1h         |

### Fase D5 — Fleet Management (~6h) 🟢

| #    | Subfase                       | Descrição               | Estimativa |
| ---- | ----------------------------- | ----------------------- | ---------- |
| D5.1 | ⬜ Tool `sdk_fleet_start`      | Start fleet via RPC     | 2h         |
| D5.2 | ⬜ Fleet lifecycle integration | Conectar com agent-loop | 2h         |
| D5.3 | ⬜ REST endpoint + testes      |                         | 2h         |

---

## FAIXA E — Hooks Optimization

**Referência**: [02-GAPS-FUNCIONAIS-SDK.md](./02-GAPS-FUNCIONAIS-SDK.md) Faixa E
**Estimativa**: ~16h
**Risco**: Moderado (refactor)

### Fase E1 — Thin Adapter Migration (~8h) 🟠

| #    | Subfase                                | Descrição                                                              | Estimativa |
| ---- | -------------------------------------- | ---------------------------------------------------------------------- | ---------- |
| E1.1 | ⬜ Separar filtering estático           | Mover whitelist/blacklist estáticas → `availableTools`/`excludedTools` | 3h         |
| E1.2 | ⬜ Simplificar `buildPreToolUseHandler` | Manter apenas lógica dinâmica (ask, runtime deny)                      | 3h         |
| E1.3 | ⬜ Testes de paridade                   | Verificar que behavior é idêntico before/after                         | 2h         |

### Fase E2 — Hook Composition Improvement (~4h) 🟡

| #    | Subfase                         | Descrição                                  | Estimativa |
| ---- | ------------------------------- | ------------------------------------------ | ---------- |
| E2.1 | ⬜ Melhorar `composer.js`        | Composição mais declarativa                | 2h         |
| E2.2 | ⬜ Adicionar hook `onSessionEnd` | Hook para cleanup (SDK suporta via events) | 2h         |

### Fase E3 — Audit & Compliance (~4h) 🟡

| #    | Subfase                   | Descrição                             | Estimativa |
| ---- | ------------------------- | ------------------------------------- | ---------- |
| E3.1 | ⬜ Audit trail completo    | Logging de todas as decisões de hooks | 2h         |
| E3.2 | ⬜ Dashboard de compliance | Endpoint para visualizar decisions    | 2h         |

---

## FAIXA F — Observabilidade SDK

**Referência**: [06-TSSERVER-SDK-INTERNALIZACAO.md](./06-TSSERVER-SDK-INTERNALIZACAO.md)
**Estimativa**: ~16h
**Risco**: Baixo (aditivo)

### Fase F1 — Telemetry Integration (~8h) 🟠

| #    | Subfase                           | Descrição                           | Estimativa |
| ---- | --------------------------------- | ----------------------------------- | ---------- |
| F1.1 | ⬜ Configurar `telemetry` OTel     | Passar OTel endpoint ao CLI process | 3h         |
| F1.2 | ⬜ Implementar `onGetTraceContext` | Propagação de W3C trace context     | 3h         |
| F1.3 | ⬜ Correlação de traces            | Dashboard unificado SDK + sistema   | 2h         |

### Fase F2 — Client-Level Monitoring (~8h) 🟠

| #    | Subfase                                | Descrição                        | Estimativa |
| ---- | -------------------------------------- | -------------------------------- | ---------- |
| F2.1 | ⬜ Wire `getStatus()` periódico         | Health check do CLI server       | 2h         |
| F2.2 | ⬜ Wire `getAuthStatus()`               | Monitorar estado de autenticação | 2h         |
| F2.3 | ⬜ Wire `getQuotaInfo()`                | Monitorar quotas e rate limits   | 2h         |
| F2.4 | ⬜ Dashboard endpoint `/api/sdk/health` | Endpoint consolidado de saúde    | 2h         |

---

## FAIXA G — Architectural Refactoring

**Referência**: [05-ARQUITETURA-IDEAL.md](./05-ARQUITETURA-IDEAL.md)
**Estimativa**: ~46h
**Risco**: Alto (substitutivo)

### Fase G1 — God Module Decomposition (~16h) 🟠

| #    | Subfase                        | Descrição                                  | Estimativa |
| ---- | ------------------------------ | ------------------------------------------ | ---------- |
| G1.1 | ⬜ Extrair `agent-loop.js`      | Loop principal isolado (~150L)             | 4h         |
| G1.2 | ⬜ Extrair `session-manager.js` | Multi-session SDK-based (~200L)            | 4h         |
| G1.3 | ⬜ Extrair `turn-executor.js`   | Turn execution isolado (~150L)             | 4h         |
| G1.4 | ⬜ Extrair `dialog-engine.js`   | Dialog loop isolado (~100L)                | 2h         |
| G1.5 | ⬜ Testes de integração         | Validar que decomposição preserva behavior | 2h         |

### Fase G2 — Hub ↔ SDK Lifecycle Integration (~8h) 🟡

**Nota**: O conversation-hub NÃO é um registry duplicado. É uma camada de persistência SQLite para
o ambiente LLM-A ↔ LLM-B ↔ Usuário. A integração necessária é wiring de lifecycle events, não
substituição.

| #    | Subfase                           | Descrição                                  | Estimativa |
| ---- | --------------------------------- | ------------------------------------------ | ---------- |
| G2.1 | ⬜ Criar `hub-lifecycle-bridge.js` | Wire lifecycle events do client para o hub | 3h         |
| G2.2 | ⬜ Implementar handlers no hub     | `onSdkSessionCreated/Deleted/Updated`      | 3h         |
| G2.3 | ⬜ Testes de integração            | Verificar sync bidirecional                | 2h         |

### Fase G3 — Event Router Centralizado (~12h) 🟡

| #    | Subfase                        | Descrição                                          | Estimativa |
| ---- | ------------------------------ | -------------------------------------------------- | ---------- |
| G3.1 | ⬜ Criar `events/router.js`     | Dispatcher central por categoria                   | 4h         |
| G3.2 | ⬜ Migrar handlers existentes   | Mover de `event-handlers/` para `events/handlers/` | 4h         |
| G3.3 | ⬜ Adicionar handlers faltantes | Da Faixa B que ainda não foram criados             | 2h         |
| G3.4 | ⬜ Testes do router             | Dispatch + fallback + error handling               | 2h         |

### Fase G4 — Import Cleanup (~10h) 🟢

| #    | Subfase                      | Descrição                           | Estimativa |
| ---- | ---------------------------- | ----------------------------------- | ---------- |
| G4.1 | ⬜ Eliminar circular imports  | Detectar e quebrar ciclos           | 4h         |
| G4.2 | ⬜ Uniformizar barrel exports | Cada submódulo com `index.js` limpo | 3h         |
| G4.3 | ⬜ Alias mapping              | Verificar `#copilot/*` aliases      | 1h         |
| G4.4 | ⬜ Testes de import           | Verificar que tudo resolve          | 2h         |

---

## FAIXA H — TSServer Integration

**Referência**: [06-TSSERVER-SDK-INTERNALIZACAO.md](./06-TSSERVER-SDK-INTERNALIZACAO.md)
**Estimativa**: ~16h
**Risco**: Moderado (novo canal de comunicação)

### Fase H1 — Tools de TSServer para Copilot (~8h) 🟡

| #    | Subfase                  | Descrição                     | Estimativa |
| ---- | ------------------------ | ----------------------------- | ---------- |
| H1.1 | ⬜ Tool `get_type_info`   | Type info via tsserver-daemon | 2h         |
| H1.2 | ⬜ Tool `get_diagnostics` | Diagnostics de arquivo        | 2h         |
| H1.3 | ⬜ Tool `get_completions` | Completion candidates         | 2h         |
| H1.4 | ⬜ Testes                 |                               | 2h         |

### Fase H2 — Context Injection via SystemMessage (~8h) 🟡

| #    | Subfase                        | Descrição                              | Estimativa |
| ---- | ------------------------------ | -------------------------------------- | ---------- |
| H2.1 | ⬜ Builder de seção TSServer    | SystemMessage section com type context | 3h         |
| H2.2 | ⬜ Auto-inject on session start | Hook para injetar automaticamente      | 3h         |
| H2.3 | ⬜ Testes                       |                                        | 2h         |

---

## Cronograma Consolivado

### Sprint 1 — Foundation (Semana 1-2, ~52h)

| Faixa | Fase                       | Prioridade | Horas |
| ----- | -------------------------- | ---------- | ----- |
| A     | A1 — Bug Fixes             | 🔴 P0       | 6h    |
| A     | A2 — Misalignments         | 🟠 P1       | 6h    |
| A     | A3 — Dead Code Wire        | 🟠 P1       | 6h    |
| I     | I1 — System Prompt Modular | 🔴 P0       | 6h    |
| I     | I2 — Integração e Captura  | 🟠 P1       | 5h    |
| I     | I3 — Testes System Prompt  | 🟠 P1       | 3h    |
| C     | C1 — SessionConfigBuilder  | 🔴 P0       | 8h    |
| C     | C3 — ClientOptions básicas | 🟡 P2       | 4h    |
| F     | F1 — Telemetry (parcial)   | 🟠 P1       | 8h    |

### Sprint 2 — Events & Config (Semana 3-4, ~36h)

| Faixa | Fase                       | Prioridade | Horas |
| ----- | -------------------------- | ---------- | ----- |
| B     | B1 — Session Events        | 🟠 P1       | 10h   |
| B     | B2 — MCP Events            | 🟠 P1       | 8h    |
| C     | C2 — SessionConfig options | 🟠 P1       | 8h    |
| F     | F2 — Client Monitoring     | 🟠 P1       | 8h    |
| E     | E1 — Thin Adapter (início) | 🟠 P1       | 2h    |

### Sprint 3 — Experimental RPC (Semana 5-6, ~36h)

| Faixa | Fase                          | Prioridade | Horas |
| ----- | ----------------------------- | ---------- | ----- |
| D     | D1 — Skills Tools             | 🟡 P2       | 6h    |
| D     | D2 — MCP Tools                | 🟡 P2       | 6h    |
| D     | D3 — Agent Tools              | 🟡 P2       | 6h    |
| B     | B3 — Tool Events              | 🟡 P2       | 6h    |
| B     | B4 — Skill/Command Events     | 🟡 P2       | 8h    |
| E     | E1 — Thin Adapter (conclusão) | 🟠 P1       | 6h    |

### Sprint 4 — Architecture (Semana 7-8, ~40h)

| Faixa | Fase                           | Prioridade | Horas |
| ----- | ------------------------------ | ---------- | ----- |
| G     | G1 — God Module Decomposition  | 🟠 P1       | 16h   |
| G     | G2 — Hub Lifecycle Integration | 🟡 P2       | 8h    |
| G     | G3 — Event Router (parcial)    | 🟡 P2       | 12h   |

### Sprint 5 — Polish & Integration (Semana 9-10, ~48h)

| Faixa | Fase                          | Prioridade | Horas |
| ----- | ----------------------------- | ---------- | ----- |
| D     | D4 — Extensions/Plugins       | 🟢 P3       | 6h    |
| D     | D5 — Fleet                    | 🟢 P3       | 6h    |
| E     | E2 — Hook Composition         | 🟡 P2       | 4h    |
| E     | E3 — Audit Compliance         | 🟡 P2       | 4h    |
| G     | G3 — Event Router (conclusão) | 🟡 P2       | 2h    |
| G     | G4 — Import Cleanup           | 🟢 P3       | 10h   |
| H     | H1 — TSServer Tools           | 🟡 P2       | 8h    |
| H     | H2 — Context Injection        | 🟡 P2       | 8h    |

---

## Matriz de Dependências

```
A1 (bugs) ──────────┐
                     ├──► I1-I3 (system prompt modular) ──► C1 (builder)
A2 (misalignments) ─┘         │                                  │
                               │                         C2 (opções) ──► E1 (thin adapter)
                               ▼                                  │
A3 (dead code) ──────────► B1-B4 (events) ──► G3 (event router)  │
                               │                                  ▼
                               ▼                         G2 (hub lifecycle)
C3 (client options) ──► F1 (telemetry) ──► F2 (monitoring)
                               │
                               ▼
D1-D5 (experimental) ─────────┼──► G1 (decompose always-alive)
                               │         │
                               ▼         ▼
                          G2 (hub lifecycle) ──► G4 (cleanup)
                               │
                               ▼
                          H1-H2 (tsserver integration)
```

**Regra de ouro**: Faixa A (bugs) é pré-requisito para tudo. Faixa I (system prompt modular)
depende de A1-A2 e é pré-requisito para C1 (builder). Faixa C1 (builder) é pré-requisito para C2,
E1. Faixa G1 (decomposição) é pré-requisito para G2, G3.

---

## Métricas de Aceitação

| Métrica                          | Baseline | Target                 |
| -------------------------------- | -------- | ---------------------- |
| Cobertura SDK APIs estáveis      | ~90%     | 100%                   |
| Cobertura SDK APIs experimentais | ~0%      | 100% (feature-flagged) |
| System Prompt seções cobertas    | 7/10     | 10/10 (modular)        |
| Events com handler dedicado      | 33/55    | 55/55                  |
| SessionConfig options cobertas   | 14/21    | 21/21                  |
| ClientOptions cobertas           | 3/15     | 15/15                  |
| Dead code lines (sdk/)           | ~420     | 0                      |
| God module (>300L)               | 1        | 0                      |
| `Record<string,unknown>` casts   | 5+       | 0                      |
| Cobertura testes unitários       | ~60%     | 85%                    |
| REST endpoints para experimental | 0        | 19+                    |
