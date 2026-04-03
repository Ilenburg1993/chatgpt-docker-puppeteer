# Auditoria Individual — `agent/dialog-turn-executor.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                                       |
| ------------------- | ------------------------------------------- |
| **Arquivo**         | `src/copilot/agent/dialog-turn-executor.js` |
| **Módulo**          | `agent/`                                    |
| **LOC**             | 324                                         |
| **Fase**            | F05-06                                      |
| **Data de leitura** | 2026-07-05                                  |

---

## 2. Propósito e Responsabilidade

Funções puras de execução de turno extraídas do DialogLoopManager. Contém a lógica de
resolução/rejeição de cada turno: emitTurnStart, buildTurnResolutionListeners, dispatchTurnToHost,
waitForRestartAndReply, executeTurnImpl. Cada função opera sobre um emitter e callbacks sem acesso a
campos privados do DLM.

---

## 3. API Pública (Exports)

| Export                         | Tipo     | Descrição curta                                       |
| ------------------------------ | -------- | ----------------------------------------------------- |
| `emitTurnStart`                | function | Emite turn_start, incrementa counter, persiste estado |
| `buildTurnResolutionListeners` | function | Constrói handlers reply/stopped com timeout           |
| `dispatchTurnToHost`           | function | Despacha msg ao host via answerPendingQuestion        |
| `waitForRestartAndReply`       | function | Aguarda restart (ready) e reenvia mensagem            |
| `executeTurnImpl`              | function | Orquestra os 4 anteriores numa Promise                |
| `TurnEmitter`                  | @typedef | Interface mínima de EventEmitter                      |

**Total de exports**: 6 (5 functions + 1 typedef) **Exports consumidos**: `dialog-loop-manager.js`
(executeTurnImpl diretamente) **Exports possivelmente dead**: `emitTurnStart`,
`buildTurnResolutionListeners`, `dispatchTurnToHost`, `waitForRestartAndReply` — public para testes,
mas não consumidas diretamente fora do módulo

---

## 4. Dependências (Imports)

### 4.1 Imports internos

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/core/errors`          | ❌ (alias)  | core/          |
| `#copilot/observability`        | ✅ barrel   | observability/ |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `#copilot/observability/otel`   | ❌ bypass   | observability/ |
| `./state-io.js`                 | ❌ direto   | agent/ (intra) |

### 4.2 Imports externos

Nenhum.

### 4.3 Diagnóstico

- **Barrel bypasses**: 2 (logger, otel)
- **Barrel usage**: 1 (defaultMetrics via barrel ✅)
- **SDK direto**: Não
- **Violação de camada**: Não

---

## 5. Estado Interno

Nenhum estado de módulo. Todas as funções recebem estado via parâmetros (sendCountRef,
pendingListenerRef).

---

## 6. Análise de Contratos

### 6.1 JSDoc completeness

| Critério                     | Status |
| ---------------------------- | ------ |
| Todos os exports têm JSDoc?  | ✅     |
| @param com tipo explícito?   | ✅     |
| @returns com tipo explícito? | ✅     |
| @throws documentado?         | ❌     |
| Typedefs completos?          | ✅     |

### 6.2 Validação de entrada

- `executeTurnImpl`: ✅ Valida `!host` e `signal?.aborted` antes de prosseguir.
- `waitForRestartAndReply`: ✅ Valida `!host`.
- `buildTurnResolutionListeners`: ❌ Assume opts completo.
- `dispatchTurnToHost`: ❌ Assume host.getPendingQuestion/answerPendingQuestion existem.

---

## 7. Error Handling

| Função                         | try/catch?                     | finally? | Cleanup?                       |
| ------------------------------ | ------------------------------ | -------- | ------------------------------ |
| `emitTurnStart`                | ❌ (catch via writeStateAsync) | ❌       | N/A                            |
| `buildTurnResolutionListeners` | ❌                             | ❌       | ✅ clearTimeout em handlers    |
| `dispatchTurnToHost`           | ❌                             | ❌       | ✅ clearTimeout em subhandlers |
| `waitForRestartAndReply`       | ❌                             | ❌       | ✅ clearTimeout, emitter.off   |
| `executeTurnImpl`              | ❌                             | ❌       | ✅ via sub-handlers            |

**Padrão**: Callback-style com clearTimeout/emitter.off em todos os branches — correto mas complexo.

---

## 8. Segurança

Sem superfície direta. Mensagens são strings passadas ao host SDK.

---

## 9. Concorrência e Race Conditions

| Cenário                                    | Risco | Mitigação                        |
| ------------------------------------------ | ----- | -------------------------------- |
| `dispatchTurnToHost` check-then-act race   | Médio | ⚠️ Ver achado RACE-AGENT-003     |
| `waitForRestartAndReply` timeout vs events | Baixo | ✅ clearTimeout + emitter.off    |
| AbortSignal + reply simultâneo             | Baixo | ✅ signal listener com once:true |

---

## 10. Performance

| Preocupação                     | Severidade | Detalhes                           |
| ------------------------------- | ---------- | ---------------------------------- |
| `writeStateAsync` em cada turn  | P4         | Async, não bloqueia; custo I/O ~ms |
| `startSpan` em cada turn        | P4         | Obervability OK; custo desprezível |
| `message.slice(0, 120)` em emit | P5         | Truncation para telemetria         |

---

## 11. Achados (Questões Formais)

### RACE-AGENT-003 — TOCTOU em `dispatchTurnToHost` entre `getPendingQuestion()` e `answerPendingQuestion()`

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/dialog-turn-executor.js`#L157-L181
- **Descrição**: Em `dispatchTurnToHost`, a lógica verifica `host.getPendingQuestion()` e, se
  presente, chama `host.answerPendingQuestion(message)`. Se for null, registra listener em
  `question.pending`. No final (L179-181), verifica novamente `host.getPendingQuestion()` como
  mitigation. Porém entre o registro do listener e esta segunda verificação, se a pergunta chegar
  entre as linhas L170 e L178, o handler `onPending` pode ser chamado duas vezes (uma pelo evento
  - uma pela verificação explícita em L181).
- **Cenário de manifestação**: Muito raro — gap de microticks entre `emitter.once` e check.
- **Proposta de correção**: Usar flag guard `let dispatched = false;` dentro de `onPending` para
  short-circuit na segunda chamada.
- **Impacto se não corrigido**: `answerPendingQuestion(message)` chamado 2x no mesmo turno — duplica
  a resposta (que o SDK pode ignorar ou não).

### COMPL-AGENT-001 — Complexidade ciclomática alta em `dispatchTurnToHost`

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/dialog-turn-executor.js`#L133-L185
- **Descrição**: `dispatchTurnToHost` tem lógica aninhada com 3 níveis de event handlers
  (`onPending` → `onReply`/`onStop`), duplicação de timeout handling, e re-implementação dos mesmos
  handlers que `buildTurnResolutionListeners` já constrói.
- **Proposta de correção**: Reutilizar `buildTurnResolutionListeners` dentro de `onPending` ao invés
  de reconstruir handlers.
- **Impacto se não corrigido**: Dificuldade de manutenção; divergência se lógica de handlers mudar.

### BUG-AGENT-004 — `executeTurnImpl` abort listener nunca é removido

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/dialog-turn-executor.js`#L290-L299
- **Descrição**: O `signal.addEventListener('abort', ...)` com `{once: true}` é registrado mas nunca
  removido se o turno completa via reply/stopped. `{once: true}` garante que o handler roda no
  máximo 1 vez, mas o handler object permanece no signal's listener list enquanto o signal existir.
  Se muitos turnos reutilizam o mesmo AbortController, os handlers (com closures referenciando
  resolve/reject) acumulam.
- **Cenário de manifestação**: Acúmulo gradual de closed-over handlers se mesmo AbortSignal é
  passado para centenas de turnos.
- **Proposta de correção**: Armazenar referência ao handler e removê-lo em `finally` da Promise.
- **Impacto se não corrigido**: Memory leak lento em cenários de longa duração.

---

## 12. Upgrades Propostos

### UPG-AGENT-008 — Consolidar handler duplication entre `buildTurnResolutionListeners` e `dispatchTurnToHost`

- **Prioridade**: P3
- **Motivação**: Ambas funções criam pares de handlers `onReply`/`onStop` com lógica quase idêntica,
  diferindo apenas no contexto de timeout. Consolidar reduz 50+ LOC e garante comportamento
  consistente.
- **Complexidade estimada**: Média — requer refatoração cuidadosa da Promise resolution.

---

## 13. Cobertura de Testes

| Critério              | Status                                               |
| --------------------- | ---------------------------------------------------- |
| Existe spec dedicado? | ❌ (coberto indiretamente via dialog loop tests)     |
| Cenários cobertos     | sendTurn→reply, sendTurn→timeout, backpressure       |
| Cenários NÃO cobertos | TOCTOU double dispatch (RACE-003), AbortSignal accum |

---

## 14. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                           |
| ------------------- | ------------ | ------------------------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc completo; @throws ausente                         |
| Error handling      | 7            | Cleanup adequado; complexidade nos handlers             |
| Segurança           | 9            | Sem superfície direta                                   |
| Performance         | 9            | Span + writeState async; custo mínimo                   |
| Testabilidade       | 6            | Funções puras mas sem spec dedicado; handlers aninhados |
| Manutenibilidade    | 5            | 324 LOC com handler duplication e TOCTOU                |
| **Média ponderada** | **7.3**      | **(8×2 + 9×2 + 7+9+6+5) / 8 ≈ 7.3**                     |

---

## 15. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (execução de turno do agente)
- **Padrão**: Decomposição funcional: 5 funções "puras" (stateless) extraídas do DLM
- **Conformidade AS-IS→TO-BE**:
  - ✅ Boa separação — funções operam sobre emitter/host sem private access
  - ✅ startSpan para observability
  - ❌ 2 barrel bypasses (logger, otel)
  - ❌ Handler duplication entre buildTurnResolutionListeners e dispatchTurnToHost
