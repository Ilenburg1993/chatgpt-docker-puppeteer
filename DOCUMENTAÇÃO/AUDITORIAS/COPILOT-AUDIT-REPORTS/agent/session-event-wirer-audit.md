# Auditoria Individual — `agent/session-event-wirer.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-14).

---

## 1. Identificação

| Campo       | Valor                                      |
| ----------- | ------------------------------------------ |
| **Arquivo** | `src/copilot/agent/session-event-wirer.js` |
| **Módulo**  | `agent/`                                   |
| **LOC**     | 438                                        |
| **Fase**    | F05-14                                     |

---

## 2. Propósito e Responsabilidade

Registra todos os listeners de eventos SDK de uma sessão Copilot, retornando funções de unsubscribe.
Organizado em sub-funções: compaction, streaming, token budget, mode/tool, system.notification,
usage (billing), e catch-all. Usa `KNOWN_SDK_EVENTS` Set para suprimir warning em eventos
reconhecidos.

---

## 3. API Pública (Exports)

| Export              | Tipo     | Descrição curta                               |
| ------------------- | -------- | --------------------------------------------- |
| `wireSessionEvents` | function | Registra todos os listeners SDK de uma sessão |

**Typedefs exportados**: `SessionWirerCallbacks`, `SdkEvent`, `CopilotSession` (via @typedef)

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `./state-io.js`                 | ❌ direto   | agent/ (intra) |

- **Barrel bypasses**: 1 (logger)
- **SDK direto**: Não (session via tipo importado)

---

## 5. Estado Interno

| Variável             | Tipo              | Mutable? | Risco                                  |
| -------------------- | ----------------- | -------- | -------------------------------------- |
| `KNOWN_SDK_EVENTS`   | ReadonlySet       | Não      | ok (const)                             |
| `_firstUsageChecked` | boolean (closure) | Sim      | Scoped por wireSessionEvents call — ok |

---

## 6. Achados (Questões Formais)

### ARCH-AGENT-007 — `KNOWN_SDK_EVENTS` não é sincronizada com event-collector.js

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/session-event-wirer.js`#L24-L93
- **Descrição**: O Set `KNOWN_SDK_EVENTS` contém ~80 event names hardcoded, incluindo eventos
  gerenciados pelo event-collector.js e task-executor.js. Se o event-collector adicionar um novo
  handler, `KNOWN_SDK_EVENTS` também precisa ser atualizado manualmente — ou o catch-all vai logar
  WARN falso para eventos que já estão sendo tratados.
- **Proposta de correção**: Importar a lista de eventos gerenciados pelo event-collector.js em vez
  de duplicar. Ou mover `KNOWN_SDK_EVENTS` para um módulo compartilhado.
- **Impacto se não corrigido**: False positive warnings no catch-all quando novos eventos são
  adicionados ao event-collector sem atualizar este Set.

### PERF-AGENT-003 — `writeStateAsync` em cada `assistant.usage` event

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/session-event-wirer.js`#L422-L429
- **Descrição**: Cada evento `assistant.usage` (alta frequência em sessões ativas) aciona
  `writeStateAsync()` para persistir billing info. Embora async e com `.catch()`, muitas chamadas
  concorrentes podem criar contention no arquivo de estado.
- **Proposta**: Debounce ou batch writes — persistir no máximo 1x/5s.
- **Impacto se não corrigido**: Pouco perceptível; `writeStateAsync` já é atômica.

### GAP-AGENT-009 — `_wireStreamingEvents` filtra com `isProcessing() || dialogLoopActive()` — inverte a lógica desejada?

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/session-event-wirer.js`#L209-L212
- **Descrição**: O handler de `assistant.message_delta` retorna sem emit se `isProcessing()` OU
  `dialogLoopActive()`. O comentário diz "filtra durante 'processing' e 'waiting_for_input' com
  dialog loop ativo". A lógica parece correta (não emitir deltas quando o agente está processando ou
  o dialog loop está ativo — pois nesses casos o task-executor gerencia os deltas). Mas o nome
  `isProcessing` é ambíguo: é `true` durante todo o processing do task, que é exatamente quando
  deltas deveriam ser emitidos. O `task-executor` já subscreve `assistant.streaming_delta` para esse
  caso, então a filtragem aqui é para evitar duplicação.
- **Comentário**: Não é bug, mas a lógica é sutil e um comentário mais explícito ajudaria.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                 |
| ------------------- | ------------ | --------------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc completo; SdkEvent genérico demais      |
| Error handling      | 8            | .catch() em writes; catch-all defensivo       |
| Segurança           | 9            | Sem superfície; no data exposure              |
| Performance         | 7            | writeStateAsync em cada usage event           |
| Testabilidade       | 7            | DI via callbacks, mas precisa mock de session |
| Manutenibilidade    | 6            | 438 LOC; KNOWN_SDK_EVENTS duplicado           |
| **Média ponderada** | **7.6**      | **(8×2 + 9×2 + 8+7+7+6) / 8 ≈ 7.6**           |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (event wiring)
- **Padrão**: Adapter Pattern — traduz SDK events → Agent events
- **Conformidade AS-IS→TO-BE**:
  - ✅ Boa separação — wirer puro com DI callbacks
  - ✅ Unsubscribe pattern correto
  - ❌ KNOWN_SDK_EVENTS duplicado com event-collector
  - ❌ 1 barrel bypass (logger)
