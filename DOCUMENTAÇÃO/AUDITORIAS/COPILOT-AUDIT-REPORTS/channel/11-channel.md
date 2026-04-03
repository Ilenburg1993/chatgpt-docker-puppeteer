# 11 — channel/ — Módulo Consolidado

**Módulo**: `src/copilot/channel/` **Arquivos**: 3 | **LOC total**: 1175 **Score**: 8.8/10 **Data**:
2026-06

## Visão Geral

Canal oficial de comunicação LLM-A ↔ LLM-B. Protocolo versão `1.3.0`.

Dois modos complementares:

| Modo               | Arquivo     | Mecanismo                              | Recomendado           |
| ------------------ | ----------- | -------------------------------------- | --------------------- |
| **HTTP Injection** | `inject.js` | HTTP para terminal server (porta 3009) | ✅ Sim                |
| **SDK Client**     | `client.js` | `AlwaysAliveAgent` em-processo         | Para conversas longas |

`index.js` é barrel: re-exporta tudo, define `CHANNEL_VERSION`.

## Mapa Funcional

### inject.js (488 LOC)

| Função                                             | Descrição                                                      |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `checkLlmBHealth(opts)`                            | GET /health → `{ ok, ready, busy, hubSessionId, agentStatus }` |
| `injectToLlmB(message, opts)`                      | POST /inject com retry em 409 (backoff linear)                 |
| `waitForLlmBReady(opts)`                           | Polling /health até `ready=true`                               |
| `injectPipeline(steps, opts)`                      | POST /pipeline — sequência ordenada de prompts                 |
| `subscribeLlmB(onEvent, opts)`                     | SSE GET /events — todos os eventos                             |
| `subscribeLlmBCritical(onEvent, opts)`             | SSE GET /events?level=critical — apenas críticos               |
| `_subscribeSse(path, port, onEvent)`               | Helper interno: SSE com reconexão exponencial                  |
| `httpRequest(method, path, body, port, timeoutMs)` | Helper HTTP loopback (127.0.0.1)                               |

### client.js (608 LOC)

| Método/Export                           | Descrição                                          |
| --------------------------------------- | -------------------------------------------------- |
| `setBridgeAgent(agent)`                 | Injeta singleton `AlwaysAliveAgent` (ARCH-03)      |
| `LlmBridgeClient`                       | Classe principal                                   |
| `.chat(message, opts)`                  | Envio com streaming via `task.delta`               |
| `.chatStructured(input, opts)`          | Protocolo StructuredMessage (Sprint A)             |
| `.chatBatch(messages, opts)`            | Multi-envio com semáforo por slot (máx 50 msgsems) |
| `.startDialogMode(bootPrompt, opts)`    | Inicia dialog loop (§15.8)                         |
| `.dialogTurn(message, opts)`            | Um turno no dialog loop                            |
| `.stopDialogMode()`                     | Encerra dialog loop                                |
| `.answer(answer)`                       | Responde `question.pending`                        |
| `.history` / `.turnCount`               | Histórico e contador readonly                      |
| `.getLastNPairs(pairs)`                 | Últimos N pares cursor-based                       |
| `.clearHistory()` / `.seedHistory(...)` | Gestão de estado local                             |
| `llmBridgeClient`                       | Singleton exportado                                |

## Achados por Severidade

### P4 (1)

| ID       | Arquivo   | Título                                                                        |
| -------- | --------- | ----------------------------------------------------------------------------- |
| CH-P4-01 | client.js | `chatBatch` com concurrency > 1: cross-contamination de task.queued listeners |

**CH-P4-01**: Quando `concurrency ≥ 2`, múltiplos `chat()` registram `on('task.queued')` e ao
receber o evento do primeiro task, todos os listeners capturam o mesmo `taskId` — levando à coleta
incorreta de chunks. Mitigado em prática pelo `AlwaysAliveAgent` que serializa a fila. **Sugestão**:
usar `once('task.queued', ...)` com unsubscribe imediato no `finally`.

### P5 (3)

| ID       | Arquivo   | Título                                                 |
| -------- | --------- | ------------------------------------------------------ |
| CH-P5-01 | inject.js | SSE buffer (`buf`) sem limite de tamanho               |
| CH-P5-02 | inject.js | `httpRequest` não suporta HTTPS (apenas loopback)      |
| CH-P5-03 | client.js | `stopDialogMode` hardcoda `reason: 'watchdog_restart'` |

## Score por Arquivo

| Arquivo   | LOC      | Score      | P4    | P5    |
| --------- | -------- | ---------- | ----- | ----- |
| index.js  | 79       | 9.5/10     | 0     | 0     |
| inject.js | 488      | 8.8/10     | 0     | 2     |
| client.js | 608      | 8.7/10     | 1     | 1     |
| **TOTAL** | **1175** | **8.8/10** | **1** | **3** |

## Arquitetura: Padrões Notáveis

### Dependency Injection para quebrar circular dep

`setBridgeAgent(agent)` permite que `client.js` dependa do `AlwaysAliveAgent` sem circular import. O
agent é injetado em runtime pelo `terminal/server.js` durante o boot.

### Retry automático no injection mode

`injectToLlmB` implementa retry linear (até 3 retries, padrão 1.5s × tentativa) em casos de
`LLM_B_BUSY (409)`. A lógica é encapsulada em `_doInjectToLlmB` para separar responsabilidades.

### SSE com reconexão automática

`_subscribeSse` mantém conexão viva com backoff exponencial (1s→2s→4s→...→30s), parseando blocos SSE
por RFC 8895 com múltiplas linhas `data:`.

### Histórico gerenciado com auto-trim

`#history` com `#maxHistorySize=500` (configurável) — entradas antigas removidas com WARN log;
`getLastNPairs` usa cursor-based traversal sem arrays intermediários.

## Referências

| Arquivo                       | Path                                             |
| ----------------------------- | ------------------------------------------------ |
| index.js                      | [index-audit.md](./index-audit.md)               |
| inject.js                     | [inject-audit.md](./inject-audit.md)             |
| client.js                     | [client-audit.md](./client-audit.md)             |
| Módulo anterior (F14 routes/) | [../routes/10-routes.md](../routes/10-routes.md) |

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II — F15 channel/._
