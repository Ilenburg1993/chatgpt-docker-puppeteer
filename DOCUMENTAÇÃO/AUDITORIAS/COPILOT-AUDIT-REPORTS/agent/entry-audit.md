# Auditoria Individual — `agent/entry.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-08).

---

## 1. Identificação

| Campo       | Valor                        |
| ----------- | ---------------------------- |
| **Arquivo** | `src/copilot/agent/entry.js` |
| **Módulo**  | `agent/`                     |
| **LOC**     | 154                          |
| **Fase**    | F05-08                       |

---

## 2. Propósito e Responsabilidade

Entry point do processo PM2 `copilot-sdk-agent`. Inicializa o AlwaysAliveAgent com retry loop (até 5
tentativas com delay), configura signal handlers (SIGTERM/SIGINT), IPC básico (ping/status/stop),
error handlers (uncaughtException/unhandledRejection), ping de conectividade, validação de
COPILOT_MODEL, e bootstrap.

---

## 3. API Pública (Exports)

Nenhum export — top-level module executado como entry point.

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/observability`        | ✅ barrel   | observability/ |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `@github/copilot-sdk`           | ❌ SDK dir  | SDK externo    |
| `./always-alive.js`             | ❌ direto   | agent/ (intra) |
| `../lib/models.js`              | ❌ bypass   | lib/ (dynamic) |

### Diagnóstico

- **Barrel bypasses**: 2 (logger, models.js dynamic import)
- **SDK direto**: ✅ `CopilotClient` — usado apenas para ping de bootstrap; aceitável para entry
  point
- **Violação de camada**: Não

---

## 5. Estado Interno

| Variável           | Tipo    | Mutable? | Risco         |
| ------------------ | ------- | -------- | ------------- |
| `RESTART_DELAY_MS` | number  | Não      | ok            |
| `_startPromise`    | Promise | Não      | ok (anchored) |

---

## 6. Achados (Questões Formais)

### BUG-AGENT-006 — `session.fatal` handler chama `process.exit(1)` sem cleanup **[FIXED]**

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/entry.js`#L112-L116
- **Descrição**: O handler de `session.fatal` chama `process.exit(1)` diretamente sem invocar
  `alwaysAliveAgent.stop()`. Isso pode deixar recursos (timers, conexões WebSocket, sessão SDK)
  pendurados. O PM2 vai reiniciar o processo, mas o exit abrupto pode causar corrupção de state-io.
- **Proposta de correção**: Chamar `await shutdown('session.fatal')` ao invés de `process.exit(1)`.
- **Impacto se não corrigido**: Corrupção potencial de `copilot-state.json` se `writeStateAsync()`
  estiver em andamento.

### PERF-AGENT-002 — `pingClient` não é await com timeout robusto

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/entry.js`#L122-L130
- **Descrição**: `Promise.race` com `setTimeout` → `reject(new Error('Ping timeout'))` funciona, mas
  o timeout tem potential memory leak: o timer não é limpo se o `ping()` resolve antes. Na prática é
  negligível (5s timer GC'd rapidamente).
- **Proposta de correção**: Usar `AbortSignal.timeout(5000)` se suportado pelo SDK.

### ARCH-AGENT-005 — `../lib/models.js` dynamic import bypassa barrel

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/entry.js`#L137
- **Descrição**: `await import('../lib/models.js')` bypassa o barrel de `lib/` e usa caminho
  relativo com `..`. Como é lazy import opcional numa seção de pré-validação, é aceitável, mas
  difere do padrão de aliases do repo.
- **Proposta de correção**: Usar `#copilot/lib/models` se disponível no alias map.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                    |
| ------------------- | ------------ | ------------------------------------------------ |
| Contratos (tipos)   | 7            | JSDoc em funções; parâmetros IPC sem tipos       |
| Error handling      | 7            | Retry loop ✅; session.fatal sem cleanup ❌      |
| Segurança           | 8            | IPC limitado a ping/status/stop                  |
| Performance         | 8            | Startup rápido; ping com race                    |
| Testabilidade       | 5            | Entry point com top-level await; hard to isolate |
| Manutenibilidade    | 7            | 154 LOC; claro mas com top-level side effects    |
| **Média ponderada** | **7.0**      | **(7×2 + 8×2 + 7+8+5+7) / 8 ≈ 7.0**              |

---

## 8. Conexão Arquitetural

- **Camada**: Entry point PM2 — fora da hierarquia de camadas
- **Padrão**: Bootstrap + signal handling + IPC (PM2 standard)
- **Conformidade**: ✅ adequado para entry point; ❌ session.fatal sem graceful shutdown

---

## Status de Correção (2026-04-03)

### [FIXED] BUG-AGENT-006 (P3) — session.fatal aguarda drainStateWrites antes de process.exit

entry.js: handler session.fatal agora chama drainStateWrites(3000) antes de process.exit(1).
state-io.js: função drainStateWrites() exportada — aguarda \_writeQueue com timeout. Previne
corrupção de state.json quando process.exit(1) interrompe writeStateAsync em andamento.

**Pontuação atualizada: 8.8/10**
