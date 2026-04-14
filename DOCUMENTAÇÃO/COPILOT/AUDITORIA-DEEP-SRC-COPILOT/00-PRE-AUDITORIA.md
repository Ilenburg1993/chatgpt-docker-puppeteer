# PRÉ-AUDITORIA PROFUNDA — `src/copilot/`

> **Data**: 2026-06-11 | **HEAD**: `55a4b071`
> **Escopo**: 389 arquivos JS, 65 diretórios, ~59.400 LOC
> **Pós**: Ondas 4.0–6.0 concluídas (migração arquitetural completa)

---

## 1. ESCOPO E METODOLOGIA

### 1.1 Objetivo

Auditoria exaustiva e profunda de `src/copilot/` em busca de:

- **Bugs** — race conditions, erros lógicos, resource leaks, error handling deficiente
- **Gaps** — funcionalidade incompleta, módulos sem cobertura, contratos não implementados
- **Oportunidades de upgrade** — refatorações, consolidações, performance, segurança, tipagem
- **Dívida técnica** — código deprecated não removido, abstrações duplicadas, dead code
- **Violações arquiteturais** — circular deps, coupling indesejado, layering violations

### 1.2 Ferramentas de Análise

| Ferramenta                     | Propósito                                     |
| ------------------------------ | --------------------------------------------- |
| `tsc --noEmit` (node + strict) | Typecheck com zero errors                     |
| `eslint`                       | Lint com regras do projeto                    |
| `grep` patterns                | @deprecated, TODO, FIXME, HACK, magic numbers |
| Contagem de LOC                | Identificar God Objects                       |
| Import graph                   | Detectar circular deps e coupling             |
| Test coverage mapping          | Identificar módulos sem testes                |
| Security patterns              | eval, secrets, path traversal, injection      |

### 1.3 Classificação

| Severidade | Sigla | Descrição                                           |
| ---------- | ----- | --------------------------------------------------- |
| Crítico    | C     | Bug em produção, falha de segurança, perda de dados |
| Alto       | A     | Bug latente, race condition, resource leak          |
| Médio      | M     | Code smell, dívida técnica, gap funcional           |
| Baixo      | B     | Cosmético, melhoria de organização, documentação    |
| Info       | I     | Observação, oportunidade futura                     |

---

## 2. INVENTÁRIO QUANTITATIVO

### 2.1 Módulos por LOC

| #   | Módulo              | LOC   | Arquivos | Subdiretórios                                                    |
| --- | ------------------- | ----- | -------- | ---------------------------------------------------------------- |
| 1   | `agent/`            | 8.242 | 43       | 7 (dialog, facades, infra, lifecycle, messaging, session, state) |
| 2   | `sdk/`              | 7.835 | 38       | 6 (agent, models, rpc, session, telemetry, tools)                |
| 3   | `terminal/`         | 7.068 | 36       | 3 (commands, dialog, handlers)                                   |
| 4   | `tools/`            | 6.324 | 24       | 4 (file, git, shell, todo)                                       |
| 5   | `observability/`    | 5.701 | 24       | 3 (bus-actions, collectors, observers)                           |
| 6   | `hooks/`            | 3.754 | 15       | 1 (presets)                                                      |
| 7   | `server/`           | 3.622 | 28       | 4 (middleware, routes, socket, sse)                              |
| 8   | `core/`             | 2.750 | 17       | 1 (security)                                                     |
| 9   | `conversation-hub/` | 2.198 | 10       | 0                                                                |
| 10  | `bridges/`          | 2.161 | 11       | 1 (gh)                                                           |
| 11  | `events/`           | 2.122 | 14       | 2 (middleware, schemas)                                          |
| 12  | `api/`              | 2.099 | 17       | 3 (bridge, express, sse) — maioria @deprecated                   |
| 13  | `channel/`          | 1.444 | 7        | 0                                                                |
| 14  | `config/`           | 1.319 | 7        | 0                                                                |
| 15  | `audit/`            | 910   | 7        | 0                                                                |
| 16  | `services/`         | 571   | 5        | 0                                                                |
| 17  | `db/`               | 437   | 3        | 0                                                                |
| 18  | `infra/`            | 287   | 5        | 0                                                                |
| 19  | `plugins/`          | 280   | 3        | 0                                                                |
| 20  | `types/`            | 193   | 2        | 0                                                                |
| 21  | `logs/`             | 0     | 0        | 0 — diretório vazio                                              |

**Total**: ~59.400 LOC em 389 arquivos.

### 2.2 Métricas de Qualidade (Baseline)

| Métrica                              | Valor          | Alvo                    |
| ------------------------------------ | -------------- | ----------------------- |
| `@ts-check` em todos os .js          | 389/389 (100%) | ✅                       |
| `tsc -p tsconfig.node.json` errors   | 0              | ✅                       |
| `tsc -p tsconfig.strict.json` errors | 0              | ✅                       |
| ESLint errors em src/copilot         | 0              | ✅                       |
| Arquivos @deprecated                 | 24             | Reduzir para <10        |
| TODO/FIXME/HACK markers              | ~20            | Resolver ou documentar  |
| `@type {any}` usage                  | 359            | Reduzir para <100       |
| Exports sem JSDoc                    | ~169           | Reduzir para <30        |
| Testes unitários copilot             | 221            | Expandir por módulo     |
| Magic numbers (timers)               | 51             | Extrair para constantes |
| `process.exit()` em código de lib    | 8              | Reduzir para 0 em libs  |
| Empty catch blocks                   | 8              | Eliminar                |
| `.catch(() => {})` silenciosos       | 10+            | Auditar cada um         |

---

## 3. ACHADOS PRELIMINARES — VISÃO POR EIXO

### 3.1 ARQUITETURA E ACOPLAMENTO

| #    | Achado                                                                                                                     | Sev. | Módulo           |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------- |
| A-01 | `server/routes/` depende de 9 arquivos em `terminal/handlers/` — coupling direto server→terminal                           | M    | server, terminal |
| A-02 | `core/di-tokens.js` re-exporta tokens de 9 outros módulos — barrel God File                                                | M    | core             |
| A-03 | `core/index.js` re-exporta de `events/` (L32, L77) — violação de layering (core não deveria depender de events)            | A    | core, events     |
| A-04 | `api/express/` tem 9 arquivos ativos (~1.861 LOC) que NÃO são @deprecated stubs — migração incompleta                      | M    | api              |
| A-05 | `logs/` diretório vazio — sem código, sem index.js                                                                         | B    | logs             |
| A-06 | `server/middleware/rate-limiter-state.js` importa de `terminal/rate-limiter-state.js` — coupling residual                  | M    | server, terminal |
| A-07 | 325 arquivos referenciam `EventBus` — pode indicar acoplamento excessivo                                                   | I    | *                |
| A-08 | 4 diferentes mecanismos de event emission: bridgeEmitter (10 files), EventBus (325), createEventBus (4), createEmitter (8) | M    | *                |

### 3.2 BUGS E RACE CONDITIONS POTENCIAIS

| #    | Achado                                                                                               | Sev. | Módulo     |
| ---- | ---------------------------------------------------------------------------------------------------- | ---- | ---------- |
| B-01 | 8 blocos `catch {}` vazios — exceções silenciadas completamente                                      | A    | vários     |
| B-02 | 10+ `.catch(() => {})` ou `.catch(() => undefined)` — rejeições de promises ignoradas                | A    | agent, sdk |
| B-03 | 27 blocos `catch(e)` sem `@type {any}` — TypeScript implicit any em strict mode                      | M    | vários     |
| B-04 | `snapshot.js` (deprecated, 139): `listSnapshotsAsync().catch(() => {})` — se falhar, nenhum feedback | A    | agent      |
| B-05 | `state-io.js` (deprecated, 98): `readStateAsync().catch(() => {})` — state read failure silenciada   | C    | agent      |
| B-06 | `tools/tool-factory.js` usa `readFileSync` dentro de handler async — I/O blocking em handler         | A    | tools      |
| B-07 | `sdk/tools/core.js` usa `readFileSync` dentro de handler async — idem                                | A    | sdk        |
| B-08 | 51 magic numbers de timeout/interval espalhados — risco de inconsistência em mudanças                | M    | vários     |

### 3.3 SEGURANÇA

| #    | Achado                                                                                                     | Sev. | Módulo |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---- | ------ |
| S-01 | `req.query['tag']` e `req.query['search']` em `memory.js` passados sem sanitização ao handler              | M    | server |
| S-02 | `req.params` em agent.js, memory.js, sessions.js passados como string sem validação de formato             | M    | server |
| S-03 | POST /inject sem schema validation Zod (Onda 6.0 aplicou só a webhooks e sessions)                         | M    | server |
| S-04 | Webhook URLs validadas por `validateUrlString` mas sem SSRF protection explícita (allowlist de hosts)      | M    | server |
| S-05 | `hub-ns.js` (436 LOC): JWT secret fallback silencioso — auth desabilitado sem aviso visível                | A    | server |
| S-06 | Tool file operations em `tools/file/shared.js` fazem path traversal check mas via `realpath` — TOCTOU risk | M    | tools  |
| S-07 | Shell executor `tools/shell/` tem sandbox patterns mas regex-based blocklist pode ser bypassada            | M    | tools  |

### 3.4 TIPAGEM E QUALIDADE DE CÓDIGO

| #    | Achado                                                                              | Sev. | Módulo           |
| ---- | ----------------------------------------------------------------------------------- | ---- | ---------------- |
| T-01 | 359 usos de `@type {any}` — muitos são em catch blocks, mas outros são lazy typing  | M    | *                |
| T-02 | 169 exports públicos sem JSDoc imediato (line anterior ao export não é `*/`)        | M    | *                |
| T-03 | `config/env.js` tem ~27 exports consecutivos sem JSDoc individual                   | A    | config           |
| T-04 | `sdk/types.js` (646 LOC) — God Type File, poderia ser dividido por domínio          | M    | sdk              |
| T-05 | `agent/always-alive.js` (746 LOC) — God Class, responsabilidades múltiplas          | A    | agent            |
| T-06 | `agent/dialog/loop-manager.js` (596 LOC) — complexidade ciclomática alta            | M    | agent            |
| T-07 | `conversation-hub/store.js` (562 LOC) — God Store com múltiplas responsabilidades   | M    | conversation-hub |
| T-08 | `observability/observers/dialog-task-handlers.js` (426 LOC) — monólito de observers | M    | observability    |

### 3.5 TESTES E COBERTURA

| #    | Achado                                                                            | Sev. | Módulo  |
| ---- | --------------------------------------------------------------------------------- | ---- | ------- |
| X-01 | 0 testes unitários para: core, db, infra, plugins, services, types, server, audit | A    | vários  |
| X-02 | `agent/` tem apenas 2 testes unitários para 43 arquivos (8.242 LOC)               | A    | agent   |
| X-03 | `sdk/` tem 39 testes (melhor cobertura, mas é o módulo de 7.835 LOC)              | M    | sdk     |
| X-04 | `server/routes/` (14 routers) sem nenhum teste unitário dedicado                  | A    | server  |
| X-05 | `hooks/` (3.754 LOC, 15 arquivos) tem apenas 2 testes                             | A    | hooks   |
| X-06 | `events/` (2.122 LOC, 14 arquivos) tem apenas 2 testes                            | A    | events  |
| X-07 | `bridges/` (2.161 LOC) tem apenas 4 testes                                        | M    | bridges |
| X-08 | `channel/` (1.444 LOC) tem apenas 1 teste                                         | A    | channel |

### 3.6 DÍVIDA TÉCNICA E CÓDIGO MORTO

| #    | Achado                                                                                                                                 | Sev. | Módulo     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| D-01 | 24 arquivos @deprecated — 5 em `api/bridge/`, 4 em `api/sse/`, 2 em `api/express/`, 2 em `agent/`, etc.                                | M    | api, agent |
| D-02 | 9 arquivos em `api/express/` NÃO deprecated com ~1.861 LOC de lógica ativa (agent.js, client.js, hooks.js, etc.) — migração incompleta | A    | api        |
| D-03 | `agent.js` (raiz) — wrapper deprecated de 16 LOC, deveria ser removido                                                                 | B    | raiz       |
| D-04 | `bootstrap.js` (raiz) — wrapper de 14 LOC, papel ambíguo vs `main.js`                                                                  | B    | raiz       |
| D-05 | `logs/` diretório vazio sem propósito                                                                                                  | B    | logs       |
| D-06 | `types/events.js` — deprecated, lógica movida para `events/`                                                                           | B    | types      |
| D-07 | `.github/` dentro de src/copilot — hooks/state duplicados do .github raiz                                                              | M    | .github    |
| D-08 | `tools/shell/index.js` exporta `execCommandTool`, `runNodeFileTool`, `runNpmScriptTool` — sem importadores                             | M    | tools      |
| D-09 | `tools/todo/index.js` — @deprecated, deveria ser consolidado                                                                           | B    | tools      |

### 3.7 RESOURCE LEAKS E PERFORMANCE

| #    | Achado                                                                          | Sev. | Módulo           |
| ---- | ------------------------------------------------------------------------------- | ---- | ---------------- |
| R-01 | ~19 `setInterval` calls — maioria com cleanup mas nem todos visíveis            | M    | vários           |
| R-02 | `terminal-agent-wiring.js`: `setInterval` dentro de função sem cleanup evidente | A    | terminal         |
| R-03 | `conversation-hub/store.js`: checkpoint timer pode não ser limpo em error paths | M    | conversation-hub |
| R-04 | 40 imports de logger dispersos — nenhum mecanismo de log rotation nativo        | M    | vários           |
| R-05 | 17 entidades de rate-limiting — possível duplicação entre server e terminal     | M    | server, terminal |
| R-06 | 32 referências a Mutex/lock — sem pool centralizado visível                     | M    | core, infra      |

---

## 4. MÓDULOS SEM INDEX.JS (BARREL)

| Módulo  | Status                    |
| ------- | ------------------------- |
| `logs/` | MISSING — diretório vazio |

Todos os outros 20 módulos possuem `index.js`. ✅

---

## 5. DEPENDÊNCIA CRUZADA — MAPA DE COUPLING

```
                    ┌─────────────────────┐
                    │       core/         │ ← Foundation (deveria ser leaf)
                    │  di-tokens (9 re-exports) │
                    │  index (re-exports events)│ ← VIOLAÇÃO
                    └─────────┬───────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
    │ events/ │         │ config/ │         │  infra/ │
    │ 2122 LOC│         │ 1319 LOC│         │  287 LOC│
    └────┬────┘         └─────────┘         └─────────┘
         │
    ┌────▼────┐   ┌──────────┐   ┌──────────┐
    │  hooks/ │   │ channel/ │   │   db/    │
    │ 3754 LOC│   │ 1444 LOC │   │  437 LOC │
    └────┬────┘   └──────────┘   └──────────┘
         │
    ┌────▼────────────────────────────────────┐
    │              agent/  8242 LOC           │ ← God Module
    │  dialog/ lifecycle/ session/ state/     │
    │  facades/ infra/ messaging/             │
    └────┬───────────────────────────────────┘
         │
    ┌────▼────┐   ┌──────────┐   ┌──────────┐
    │  sdk/   │   │ bridges/ │   │  audit/  │
    │ 7835 LOC│   │ 2161 LOC │   │  910 LOC │
    └────┬────┘   └──────────┘   └──────────┘
         │
    ┌────▼────────────────────────────────────┐
    │     conversation-hub/  2198 LOC        │
    │  hub.js store.js orchestrator.js       │
    └────┬───────────────────────────────────┘
         │
    ┌────▼──────┐   ┌──────────┐   ┌──────────┐
    │ terminal/ │   │ server/  │   │services/ │
    │ 7068 LOC  │──►│ 3622 LOC │◄──│  571 LOC │
    └───────────┘   └──────────┘   └──────────┘
       ▲                │
       │   server→terminal coupling (11 imports)
       └────────────────┘
```

**Conclusão**: O coupling `server/ → terminal/handlers/` é o gap arquitetural mais significativo pós-Onda 6.0.

---

## 6. PLANO DOS DOCUMENTOS A GERAR

| #   | Documento                        | Conteúdo                                                    |
| --- | -------------------------------- | ----------------------------------------------------------- |
| 01  | `01-BUGS-E-RACE-CONDITIONS.md`   | 50+ bugs categorizados por severidade e módulo              |
| 02  | `02-GAPS-FUNCIONAIS.md`          | 50+ gaps em funcionalidade, testes, docs                    |
| 03  | `03-SEGURANCA.md`                | 30+ achados de segurança (OWASP-aligned)                    |
| 04  | `04-DIVIDA-TECNICA.md`           | 50+ itens de dívida técnica com LOC estimado                |
| 05  | `05-OPORTUNIDADES-UPGRADE.md`    | 50+ oportunidades de melhoria (perf, tipagem, consolidação) |
| 06  | `06-COBERTURA-TESTES.md`         | Gap analysis completo por módulo                            |
| 07  | `07-ACOPLAMENTO-ARQUITETURAL.md` | Dependency graph detalhado + violações                      |
| 08  | `08-ROADMAP-FAIXAS-FASES.md`     | Roadmap com faixas, fases e subfases                        |

**Meta**: ~300+ achados individuais no total, priorizados e acionáveis.

---

## 7. PRÓXIMOS PASSOS

1. **Fase 1**: Leitura profunda de cada módulo (agent → sdk → terminal → tools → observability → hooks → server → core → conversation-hub → bridges → events → channel → config → audit → services → db → infra → plugins → types)
2. **Fase 2**: Geração dos documentos 01–07 com achados detalhados
3. **Fase 3**: Síntese no roadmap 08 com faixas temporais e prioridades
4. **Fase 4**: Validação cruzada (cada achado referencia arquivo + linha)

---

*Documento gerado automaticamente pela auditoria profunda de `src/copilot/`.*
