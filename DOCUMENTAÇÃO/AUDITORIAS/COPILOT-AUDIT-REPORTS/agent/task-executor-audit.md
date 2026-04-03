# Auditoria Individual — `agent/task-executor.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-19).

---

## 1. Identificação

| Campo       | Valor                                |
| ----------- | ------------------------------------ |
| **Arquivo** | `src/copilot/agent/task-executor.js` |
| **Módulo**  | `agent/`                             |
| **LOC**     | 190                                  |
| **Fase**    | F05-19                               |

---

## 2. Propósito e Responsabilidade

Execução assíncrona de uma tarefa individual. Subscreve a streaming de tokens, aguarda resposta
completa via `session.sendAndWait`, trata erros com reconexão transparente, limita retries, e emite
telemetria OTEL por tarefa e por tool call. Desacoplado do agente pai via callbacks.

---

## 3. API Pública (Exports)

| Export                  | Tipo     | Descrição curta                          |
| ----------------------- | -------- | ---------------------------------------- |
| `executeTask`           | function | Executa 1 tarefa da fila com retry/recon |
| `TaskExecutorCallbacks` | @typedef | Interface de callbacks do host           |
| `QueuedTask`            | @typedef | Shape da tarefa com resolve/reject       |

---

## 4. Dependências (Imports)

| Import                     | Via barrel? | Módulo origem  |
| -------------------------- | ----------- | -------------- |
| `../observability/otel.js` | ❌ bypass   | observability/ |

- **Barrel bypasses**: 1 (otel.js direto)
- **SDK direto**: Não (session via parâmetro)
- **Violação de camada**: Layer 5 importa Layer 3 — correto

---

## 5. Estado Interno

| Variável                  | Tipo              | Mutable? | TTL/Cleanup?       |
| ------------------------- | ----------------- | -------- | ------------------ |
| `_toolSpans`              | Map<string, Span> | Sim      | ✅ finally clear() |
| `MAX_TASK_RETRIES`        | number            | Não      | Env-configurable   |
| `DEFAULT_TASK_TIMEOUT_MS` | number            | Não      | Env-configurable   |

---

## 6. Achados (Questões Formais)

### BUG-AGENT-009 — `requeueTask` não reseta `task.attempts` — retry loop bounded mas silencioso

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/task-executor.js`#L155-L161
- **Descrição**: Quando a tarefa é reenfileirada após reconexão, `task.attempts` é incrementado mas
  nunca resetado. Isso é o comportamento correto (bounded retry). Porém, se o agente reconecta com
  sucesso e a tarefa falha por outro motivo na tentativa seguinte, o counter já elevado pode causar
  rejeição prematura sem comunicar que a falha não é idêntica à anterior.
- **Proposta**: Logar `task.attempts` no `task.error` event para visibilidade.

### GAP-AGENT-012 — `sendAndWait` timeout default de 60s pode ser curto para tarefas complexas

- **Severidade**: P5
- **Arquivo**: `src/copilot/agent/task-executor.js`#L139
- **Descrição**: `task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS` (60s). Tarefas que envolvem tool calls
  encadeados (ex.: busca + edit + test) podem levar vários minutos. O caller pode configurar
  `timeoutMs` na tarefa, mas o default é relativamente baixo.
- **Nota**: Configurável via env `AGENT_TASK_TIMEOUT_MS` — mitigação adequada.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                            |
| ------------------- | ------------ | ---------------------------------------- |
| Contratos (tipos)   | 9            | JSDoc completo, typedefs claros          |
| Error handling      | 9            | AbortError handling ✅; retry bounded ✅ |
| Segurança           | 9            | Sem superfície; payload via SDK          |
| Performance         | 9            | Cleanup in finally ✅; OTEL spans ✅     |
| Testabilidade       | 9            | Função pura com DI callbacks             |
| Manutenibilidade    | 9            | 190 LOC, single-purpose, bem documentado |
| **Média ponderada** | **9.1**      | **(9×2 + 9×2 + 9+9+9+9) / 8 ≈ 9.1**      |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (task execution)
- **Padrão**: DI via callbacks — zero acesso a campos privados do agente
- **Conformidade AS-IS→TO-BE**:
  - ✅ Desacoplamento total via TaskExecutorCallbacks
  - ✅ OTEL spans por task e tool (CO-01/CO-02)
  - ✅ AbortError handling (G1-BUG-03)
  - ✅ Cleanup in finally (SDK-06)
  - ❌ 1 barrel bypass (otel.js)
