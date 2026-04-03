# Auditoria Individual — `agent/dialog-watchdog.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                                  |
| ------------------- | -------------------------------------- |
| **Arquivo**         | `src/copilot/agent/dialog-watchdog.js` |
| **Módulo**          | `agent/`                               |
| **LOC**             | 114                                    |
| **Fase**            | F05-07                                 |
| **Data de leitura** | 2026-07-05                             |

---

## 2. Propósito e Responsabilidade

Monitor de inatividade do dialog loop. Detecta quando o loop fica inativo por mais tempo que o
limiar configurado (`stallThresholdMs`) e dispara callback `onStall`. Timer via `setInterval` com
Guard contra duplo-start. Inclui `@example` no JSDoc.

---

## 3. API Pública (Exports)

| Export                  | Tipo     | Descrição curta                               |
| ----------------------- | -------- | --------------------------------------------- |
| `DialogWatchdog`        | class    | Monitor de inatividade com start/ping/stop    |
| `DialogWatchdogOptions` | @typedef | Opções: intervalMs, stallThresholdMs, onStall |

**Total de exports**: 2 (1 class + 1 typedef) **Exports consumidos**: `dialog-loop-manager.js`
**Exports possivelmente dead**: nenhum

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |

- **Barrel bypasses**: 1 (logger)
- **SDK direto**: Não
- **Violação de camada**: Não

---

## 5. Estado Interno

| Variável            | Tipo           | Mutable? | TTL/Cleanup?      |
| ------------------- | -------------- | -------- | ----------------- |
| `#intervalMs`       | number         | Não      | N/A               |
| `#stallThresholdMs` | number         | Não      | N/A               |
| `#onStall`          | Function       | Não      | N/A               |
| `#timer`            | Interval\|null | Sim      | ✅ stop()         |
| `#lastActivity`     | number         | Sim      | ✅ reset via ping |

---

## 6. Análise de Contratos

### 6.1 JSDoc completeness

✅ Completo — @typedef, @param, @returns, @example (exemplar para o repo).

### 6.2 Validação de entrada

- Constructor: ❌ Não valida se `intervalMs <= 0` ou `stallThresholdMs <= 0` ou `onStall` não é
  função. Baixo risco pois chamado apenas pelo DLM com valores já validados.

---

## 7. Error Handling

- Guard de duplo-start com log WARN + return — ✅
- `stop()` idempotente — ✅
- `#onStall` callback não é wrappado em try/catch — se o callback lançar, setInterval morre
  silenciosamente (unhandled dentro do callback).

---

## 8. Segurança

Sem superfície de ataque.

---

## 9. Concorrência

Nenhum risco — single-threaded timer, mutação apenas via ping/start/stop.

---

## 10. Achados (Questões Formais)

### BUG-AGENT-005 — `#onStall` callback sem try/catch no setInterval handler

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/dialog-watchdog.js`#L80-L84
- **Descrição**: Se `#onStall(stalledMs)` lançar uma exceção, o `setInterval` handler falha
  silenciosamente (sem unhandledRejection pois não é async). O timer continua ativo mas o stall
  detector fica inconsistente — o log WARN antes do `#onStall` já foi emitido, mas a ação do stall
  não foi executada.
- **Proposta de correção**: Wrap em try/catch:
  `try { this.#onStall(stalledMs); } catch(e) { log('ERROR', ...); }`.
- **Impacto se não corrigido**: Muito baixo — o callback no DLM apenas faz `emit('stalled', ...)`,
  que não lança. Mas defensivamente é melhor proteger.

### STYLE-AGENT-002 — `setInterval` sem `.unref()` pode manter processo vivo

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/dialog-watchdog.js`#L78
- **Descrição**: O `setInterval` em `start()` não chama `.unref()`. Se o agente tentar fazer
  shutdown graceful e o watchdog não for parado explicitamente, o timer impede que o process exit
  naturalmente.
- **Proposta de correção**: `this.#timer.unref()` após criação.
- **Impacto se não corrigido**: Processo pode ficar pendurado por até `intervalMs` (5 min) após
  shutdown em edge cases sem `stop()` explícito.

---

## 11. Upgrades Propostos

Nenhum — módulo minimalista e adequado ao propósito.

---

## 12. Cobertura de Testes

| Critério              | Status                                           |
| --------------------- | ------------------------------------------------ |
| Existe spec dedicado? | ❌ (coberto indiretamente via dialog loop tests) |
| Cenários cobertos     | Stall detection, ping reset (implícito)          |
| Cenários NÃO cobertos | Guard duplo-start, onStall throwing              |

---

## 13. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                              |
| ------------------- | ------------ | ------------------------------------------ |
| Contratos (tipos)   | 9            | JSDoc exemplar com @example                |
| Error handling      | 7            | Guard duplo-start ✅; onStall sem catch ❌ |
| Segurança           | 10           | Sem superfície                             |
| Performance         | 9            | Timer simples, overhead zero               |
| Testabilidade       | 9            | Fácil de testar isoladamente               |
| Manutenibilidade    | 9            | 114 LOC, single-purpose, claro             |
| **Média ponderada** | **8.9**      | **(9×2 + 10×2 + 7+9+9+9) / 8 ≈ 8.9**       |

---

## 14. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (utilitário do dialog loop)
- **Padrão**: Timer-based health monitor — padrão clássico
- **Conformidade AS-IS→TO-BE**:
  - ✅ Bem isolado, DI via constructor
  - ❌ 1 barrel bypass (logger)
  - ❌ Sem .unref() (STYLE-AGENT-002)
