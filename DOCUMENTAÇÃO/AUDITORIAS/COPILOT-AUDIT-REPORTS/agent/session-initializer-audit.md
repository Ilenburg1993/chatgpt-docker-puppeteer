# Auditoria Individual — `agent/session-initializer.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-16).

---

## 1. Identificação

| Campo       | Valor                                      |
| ----------- | ------------------------------------------ |
| **Arquivo** | `src/copilot/agent/session-initializer.js` |
| **Módulo**  | `agent/`                                   |
| **LOC**     | 287                                        |
| **Fase**    | F05-16                                     |

---

## 2. Propósito e Responsabilidade

Inicializador de sessão persistente. Lê/retoma sessionId em disco, injeta contexto do hook system
(session-briefing.md + session.json) no systemMessage da sessão SDK, valida com Zod, configura
infinite sessions, tools, permissões, custom agents, e escreve estado resultante no state-io.

---

## 3. API Pública (Exports)

| Export                                                     | Tipo       | Descrição curta                              |
| ---------------------------------------------------------- | ---------- | -------------------------------------------- |
| `initOrResumeSession`                                      | function   | Cria ou retoma sessão SDK com persistência   |
| `buildHookSystemContext`                                   | function   | Lê briefing + session.json → markdown string |
| `buildHookSystemContextSafe`                               | function   | buildHookSystemContext com truncamento 8KB   |
| `setBackgroundCompactionThreshold`                         | function   | Configura threshold de compaction em runtime |
| `readState`, `writeState`, `writeStateAsync`, `clearState` | re-exports | Compat de state-io.js                        |

---

## 4. Dependências (Imports)

| Import                           | Via barrel? | Módulo origem  |
| -------------------------------- | ----------- | -------------- |
| `#copilot/config/session-config` | ✅ alias    | config/        |
| `#copilot/config/system-prompt`  | ✅ alias    | config/        |
| `#copilot/config/tools/state`    | ✅ alias    | config/tools/  |
| `#copilot/lib/session`           | ✅ alias    | lib/           |
| `#copilot/observability/logger`  | ❌ bypass   | observability/ |
| `../config/custom-agents.js`     | ❌ bypass   | config/ (rel)  |
| `../lib/utils.js`                | ❌ bypass   | lib/ (rel)     |
| `./state-io.js`                  | ❌ direto   | agent/ (intra) |
| `./tool-audit-logger.js`         | ❌ direto   | agent/ (intra) |
| `node:fs/promises`               | — stdlib    |                |
| `node:path`                      | — stdlib    |                |
| `zod`                            | — external  |                |

- **Barrel bypasses**: 4 (logger, custom-agents, utils, config/tools/state via alias diferente)
- **SDK direto**: Não (session/client via typedefs)
- **Violação de camada**: Layer 5 importa Layer 2/4 — correto

---

## 5. Estado Interno

| Variável                         | Tipo   | Mutable? | Risco                     |
| -------------------------------- | ------ | -------- | ------------------------- |
| `_backgroundCompactionThreshold` | number | Sim      | Singleton por processo ✅ |
| `HOOK_CONTEXT_MAX_BYTES`         | number | Não      | Env-configurable, seguro  |
| `BRIEFING_FILE`                  | string | Não      | Path constante            |
| `SESSION_JSON_FILE`              | string | Não      | Path constante            |

---

## 6. Achados (Questões Formais)

### SEC-AGENT-004 — `buildHookSystemContext` injeta conteúdo de session-briefing.md no system prompt

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/session-initializer.js`#L105-L120
- **Descrição**: O conteúdo do session-briefing.md é injetado como systemMessage no prompt. O
  arquivo é controlado pelo hook system local (gerado por session-start.sh), mas se um atacante
  conseguir escrever nesse arquivo, pode injetar instruções no system prompt. Mitigações existentes:
  - SEC02: limite de 16KB na leitura
  - SEC-02: truncamento a 8KB via `buildHookSystemContextSafe`
  - SEC-N07: close_key sanitizada com regex alfanumérico
  - SEC-VULN-03: valores de session.json validados e sanitizados
  - G2-SEC-03: close_key em bloco fenced markdown
- **Nota**: As mitigações são robustas. Risco residual classificado como baixo.

### ARCH-AGENT-008 — `initOrResumeSession` tem 80+ LOC na função principal

- **Severidade**: P5
- **Arquivo**: `src/copilot/agent/session-initializer.js`#L207-L287
- **Descrição**: A função `initOrResumeSession` constrói opts, chama resumeOrCreate, atualiza
  state-io, e loga — todas operações legítimas, mas a função poderia ser decomposta em
  `_buildSessionOpts` e `_persistSessionResult` para melhor testabilidade.
- **Proposta**: Extrair sub-funções.

### GAP-AGENT-010 — `loadToolsConfig()` chamado no tempo de módulo (module-level side-effect)

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/session-initializer.js`#L69
- **Descrição**: `loadToolsConfig()` é invocado como top-level statement quando o módulo é
  importado. Se a configuração de tools falhar (arquivo corrompido), a importação do módulo falha,
  impedindo até mesmo a leitura de estado. Deveria ser lazy ou dentro de `initOrResumeSession`.
- **Impacto**: Se `tools-config.json` estiver corrompido, impossibilita bootstrap do agente.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                       |
| ------------------- | ------------ | --------------------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc extensivo; opts dinâmico sem typedef          |
| Error handling      | 8            | Zod validation ✅; truncamento ✅                   |
| Segurança           | 8            | Múltiplas mitigações SEC-\*; prompt inject mitigado |
| Performance         | 7            | async I/O ✅; module-level loadToolsConfig ❌       |
| Testabilidade       | 6            | Module-level side effects; 80+ LOC function         |
| Manutenibilidade    | 7            | 287 LOC; bem documentado mas denso                  |
| **Média ponderada** | **7.5**      | **(8×2 + 8×2 + 8+7+6+7) / 8 ≈ 7.5**                 |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (session lifecycle)
- **Padrão**: Factory + DI — constrói opts e delega para lib/session
- **Conformidade AS-IS→TO-BE**:
  - ✅ Zod validation (F5.1 ARCH-01)
  - ✅ Sanitização de prompt injection (SEC-VULN-03, SEC-N07)
  - ❌ 4 barrel bypasses
  - ❌ Module-level side effect (loadToolsConfig)
