# Auditoria Individual — `agent/dialog-loop-manager.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                                      |
| ------------------- | ------------------------------------------ |
| **Arquivo**         | `src/copilot/agent/dialog-loop-manager.js` |
| **Módulo**          | `agent/`                                   |
| **LOC**             | 484                                        |
| **Fase**            | F05-03                                     |
| **Data de leitura** | 2026-07-05                                 |
| **Releitura?**      | Sim (MF-I + MF-II)                         |

---

## 2. Propósito e Responsabilidade

Gerencia o ciclo de vida completo do dialog loop — modo de diálogo contínuo com a LLM. Encapsula:
mutex de serialização de turnos (Promise chain), backpressure via fila limitada, watchdog de
inatividade (DialogWatchdog), protocolo READY/REPLY/STOPPED (DialogProtocol), pause/resume zero-PR,
e fallback automático de modelo. EventEmitter que propaga eventos para o AlwaysAliveAgent host.

---

## 3. API Pública (Exports)

| Export                     | Tipo     | Descrição curta                           |
| -------------------------- | -------- | ----------------------------------------- |
| `DialogLoopManager`        | class    | Gerenciador do dialog loop (EventEmitter) |
| `DialogLoopManagerOptions` | @typedef | Opções de construção com env defaults     |
| `AgentHost`                | @typedef | Interface esperada do agente host         |

**Total de exports**: 3 (1 class + 2 typedefs) **Exports consumidos externamente**:
`DialogLoopManager` por `always-alive.js`; `AgentHost` por `dialog-loop-wirer.js` **Exports
possivelmente dead**: nenhum

---

## 4. Dependências (Imports)

### 4.1 Imports internos

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/core/errors`          | ❌ (alias)  | core/          |
| `#copilot/lib/event-helpers`    | ❌ (alias)  | lib/           |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `./dialog-protocol.js`          | ❌ direto   | agent/ (intra) |
| `./dialog-turn-executor.js`     | ❌ direto   | agent/ (intra) |
| `./dialog-watchdog.js`          | ❌ direto   | agent/ (intra) |
| `./state-io.js`                 | ❌ direto   | agent/ (intra) |

### 4.2 Imports externos

| Pacote        | Uso                     |
| ------------- | ----------------------- |
| `node:events` | EventEmitter base class |

### 4.3 Diagnóstico de imports

- **Barrel bypasses**: 1 (`observability/logger`)
- **SDK direto**: Não
- **Violação de camada**: Não — Layer 5 interno
- **Circular potencial**: Não (dependências são todas intra-agent/ ou inferiores)

---

## 5. Estado Interno

### 5.1 Variáveis de módulo

| Variável                | Tipo            | Mutable? | TTL/Cleanup?        | Risco         |
| ----------------------- | --------------- | -------- | ------------------- | ------------- |
| `#active`               | boolean         | Sim      | reset em stop/force | ok            |
| `#turnMutex`            | Promise<void>   | Sim      | reset quando vazia  | ok            |
| `#turnQueueDepth`       | number          | Sim      | decremented finally | ok            |
| `#turnMutexGen`         | number          | Sim      | monotonic           | ok            |
| `#stopping`             | boolean         | Sim      | reset em stop       | ⚠️ ver achado |
| `#watchdog`             | DialogWatchdog  | Sim      | stop() em cleanup   | ok            |
| `#pendingModelFallback` | boolean         | Sim      | reset no start      | ok            |
| `#fallbackModel`        | string\|null    | Sim      | N/A                 | ok            |
| `#host`                 | AgentHost\|null | Sim      | set via attach()    | ok            |
| `#sendCountRef`         | {sendCount}     | Sim      | N/A                 | ok            |

### 5.2 Singletons

Nenhum — sempre instanciado pelo host.

### 5.3 Timers e Listeners

| Recurso                     | Tipo     | Cleanup registrado?  | Onde?                    |
| --------------------------- | -------- | -------------------- | ------------------------ |
| `DialogWatchdog` (internal) | timer    | ✅ stop() em cleanup | stop()/forceDeactivate() |
| `EventEmitter` listeners    | listener | ✅ via host          | always-alive stop()      |
| `shutdownTimer` em stop()   | timeout  | ✅ clearTimeout      | stop() L348              |

---

## 6. Análise de Contratos

### 6.1 Contratos de entrada

| Função/Método         | Param        | Tipo esperado      | Validação? | Default seguro? |
| --------------------- | ------------ | ------------------ | ---------- | --------------- |
| `constructor`         | `options`    | DLMOptions         | ❌         | ✅ env/defaults |
| `attach`              | `host`       | AgentHost          | ❌         | N/A             |
| `start`               | `bootPrompt` | string?            | ❌         | ✅ auto-build   |
| `sendTurn`            | `message`    | string             | ❌         | N/A             |
| `sendTurn`            | `signal`     | AbortSignal?       | ✅ checked | N/A             |
| `stop`                | `opts`       | object             | ❌         | ✅ defaults     |
| `pause`               | `sessionId`  | string\|null       | ❌         | N/A             |
| `handleProtocolInput` | `input`      | {question: string} | ❌         | N/A             |

### 6.2 Contratos de saída

| Função/Método | Return type       | Nullable? | Error propagation                   |
| ------------- | ----------------- | --------- | ----------------------------------- |
| `start`       | `Promise<void>`   | Não       | throws (SessionError)               |
| `sendTurn`    | `Promise<string>` | Não       | reject (SessionError, DOMException) |
| `stop`        | `Promise<void>`   | Não       | N/A (swallows)                      |
| `pause`       | `Promise<void>`   | Não       | N/A (swallows)                      |
| `resume`      | `Promise<void>`   | Não       | fire-and-forget start()             |

### 6.3 JSDoc completeness

| Critério                       | Status     |
| ------------------------------ | ---------- |
| Todos os exports têm JSDoc?    | ✅         |
| @param com tipo explícito?     | ✅         |
| @returns com tipo explícito?   | ✅         |
| @throws documentado?           | ✅ (start) |
| @example em funções complexas? | ❌         |
| Typedefs completos e corretos? | ✅         |

---

## 7. Error Handling

| Função/Método | try/catch?            | finally?   | Error transformado? | Propagado?   |
| ------------- | --------------------- | ---------- | ------------------- | ------------ |
| `start()`     | ❌ (catch via .catch) | ❌         | ❌                  | emit stopped |
| `sendTurn()`  | ❌                    | ✅ finally | ❌                  | reject       |
| `stop()`      | ❌                    | ❌         | N/A                 | swallow      |
| `resume()`    | ❌                    | ❌         | N/A                 | delegates    |

**Padrão dominante**: Promise-based com emit de eventos em catch; erros não-recuperáveis rejeitam
diretamente. **Comentário**: Adequado para o padrão de manager assíncrono. O bootPromise.catch para
turn_timeout é defensivo e correto.

---

## 8. Segurança

| Vetor               | Aplicável? | Mitigado? | Detalhes                                                                                                                                      |
| ------------------- | ---------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection (SQL/cmd) | ❌         | N/A       |                                                                                                                                               |
| Path traversal      | ❌         | N/A       |                                                                                                                                               |
| SSRF                | ❌         | N/A       |                                                                                                                                               |
| Secrets exposure    | ❌         | N/A       |                                                                                                                                               |
| Prompt injection    | ⚠️         | Parcial   | `bootPrompt` aceita string arbitrária; `sendTurn` aceita qualquer message. Mitigado pelo fato de que o dialog protocol usa hardcoded strings. |
| Auth bypass         | ❌         | N/A       |                                                                                                                                               |

---

## 9. Concorrência e Race Conditions

| Cenário                             | Risco | Mitigação existente                                                      |
| ----------------------------------- | ----- | ------------------------------------------------------------------------ |
| `sendTurn()` concorrente            | Nulo  | ✅ Promise-chain mutex serializa turnos                                  |
| `stop()` durante `sendTurn()` ativo | Baixo | ✅ shutdownTimer + forceDeactivate fallback                              |
| `start()` concorrente (2x)          | Médio | ✅ Guard `#active` no topo                                               |
| `resume()` com start() em andamento | Baixo | ⚠️ `#active = false` antes do `start()` — breve janela de inconsistência |
| `sendTurn()` + `forceDeactivate()`  | Baixo | ✅ finally decrementa; guard `#active`                                   |

---

## 10. Performance

| Preocupação                           | Severidade | Detalhes                        |
| ------------------------------------- | ---------- | ------------------------------- |
| `readState()` sync em `paused` getter | P3         | L197 — chamado infrequentemente |
| Promise chain como mutex              | P4         | Elegante e eficiente; lock-free |
| Watchdog interval (5 min default)     | P4         | Adequado; .unref() via watchdog |

---

## 11. Achados (Questões Formais)

### BUG-AGENT-002 — `stop()` reseta `#stopping` e `#active` incondicionalmente mesmo com turno em andamento

- **Severidade**: P2
- **Arquivo**: `src/copilot/agent/dialog-loop-manager.js`#L339-L352
- **Descrição**: Em `stop()`, após setar `#stopping = true`, o shutdownTimer é criado para forçar
  deactivate após timeout. Porém, imediatamente depois (L349-350), `#active = false` e
  `#stopping = false` são setados SEM aguardar o turno em andamento terminar. O `shutdownTimer`
  dispara `forceDeactivate()` verificando `this.#active`, que já foi setado false — logo o timer é
  no-op.
- **Cenário de manifestação**: Se um turno está em andamento via `#executeTurn()` no momento do
  `stop()`, o turno continua executando em background após o stop "completar". O mutex vai resolver
  com a resposta, mas o DLM já está "stopped".
- **Proposta de correção**: Aguardar `this.#turnMutex` (com timeout) antes de setar
  `#active = false`:
  ```js
  await Promise.race([this.#turnMutex, new Promise((r) => setTimeout(r, shutdownTimeoutMs))]);
  ```
- **Impacto se não corrigido**: Turno em andamento pode completar após stop(), potencialmente
  emitindo reply para listeners já removidos.

### BUG-AGENT-003 — `resume()` Strategy B não protege contra `start()` throw

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/dialog-loop-manager.js`#L430-L435
- **Descrição**: Na Strategy B do resume(), `await this.start()` pode lançar (NOT_ATTACHED, timeout,
  etc.). Se isso acontecer, o `emit('resumed')` nunca é chamado, e o estado fica em limbo
  (dialogLoopActive=false, dialogPaused=false).
- **Cenário de manifestação**: Se o host não responde ao boot prompt dentro do bootTimeoutMs,
  resume() rejeita e o dialog fica em estado inconsistente.
- **Proposta de correção**: Wrap `await this.start()` em try/catch e emitir
  `emit('resume_failed', {error})`.
- **Impacto se não corrigido**: UI mostra loop como "parando/inativo" sem indicação de falha.

### GAP-AGENT-004 — `scheduleFallback()` não aplica o modelo, apenas agenda

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/dialog-loop-manager.js`#L162-L166
- **Descrição**: `scheduleFallback(model)` seta `#fallbackModel` e `#pendingModelFallback = true`.
  No `start()` (L226-231), o fallback é detectado e o flag resetado, mas **o modelo não é realmente
  trocado** — apenas um evento `model.fallback` é emitido. O `#host.setModel()` não é chamado.
- **Cenário de manifestação**: Quando quota/rate_limit é atingido e o sistema agenda um fallback, o
  modelo NÃO é trocado na próxima inicialização.
- **Proposta de correção**: Chamar `this.#host.setModel?.(this.#fallbackModel)` no bloco if de
  L226-231.
- **Impacto se não corrigido**: Funcionalidade de fallback automático de modelo é inoperante.
- **Referência arquitetural**: Impacta resiliência do agente (visão TO-BE: fallback chain).

---

## 12. Upgrades Propostos

### UPG-AGENT-006 — Externalizar mutex como utility `PromiseQueue`

- **Prioridade**: P3
- **Motivação**: O padrão Promise-chain mutex + gen counter + depth tracking é genérico e poderia
  ser reutilizado em outros contextos. Extrair para `lib/promise-queue.js` reduziria complexidade
  deste arquivo.
- **Implementação proposta**:
  `class PromiseQueue { enqueue(fn): Promise<T>; get depth(): number; drain(): void; }`
- **Trade-offs**: Mais indireção; ganho em reuso e testabilidade isolada.
- **Complexidade estimada**: Baixa

### UPG-AGENT-007 — Tipificar eventos emitidos via TS generic ou typedef map

- **Prioridade**: P4
- **Motivação**: O DLM emite ~10 tipos de eventos (`ready`, `reply`, `stopped`, `changed`, `paused`,
  `resumed`, `stalled`, `turn_timeout`, `model.fallback`). Sem tipagem, consumers podem ouvir
  eventos com payload incorreto.
- **Implementação proposta**: Typedef `DialogLoopEvents` com mapa evento→payload.
- **Trade-offs**: Manutenção do mapa; ganho em type safety nos consumers.
- **Complexidade estimada**: Baixa

---

## 13. Cobertura de Testes

| Critério                      | Status                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| Existe spec dedicado?         | ✅                                                         |
| Arquivo do spec               | `tests/unit/copilot/test_always_alive_dialog_loop.spec.js` |
| Cenários cobertos             | start, sendTurn, stop, backpressure, mutex                 |
| Cenários edge NÃO cobertos    | resume Strategy B failure, scheduleFallback no-op          |
| Cenários de erro NÃO cobertos | stop() com turno ativo (BUG-AGENT-002)                     |

---

## 14. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                                                           |
| ------------------- | ------------ | --------------------------------------------------------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc completo, typedefs claros                                                         |
| Error handling      | 6            | Promise catch patterns OK; stop() não await mutex                                       |
| Segurança           | 9            | Sem superfície direta significativa                                                     |
| Performance         | 8            | Mutex eficiente; readState sync infrequente                                             |
| Testabilidade       | 7            | Specs bons; singleton host dificulta mock isolado                                       |
| Manutenibilidade    | 8            | 484 LOC adequado; boa separação de concerns                                             |
| **Média ponderada** | **7.6**      | **(8×2 + 9×2 + 6+8+7+8) / 8 = 63/8 ≈ 7.9 → 7.6 com penalidade pelo BUG-002 e GAP-004)** |

---

## 15. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (sub-gerenciador do agente)
- **Padrão**: Strategy Pattern — host injeta dependências via `attach()`, separando DLM do agente
  concreto
- **Conformidade AS-IS→TO-BE**: ✅ Boa separação. DLM é um bom exemplo de concern extraction.
  - ✅ Injeção de host via interface (AgentHost typedef)
  - ✅ EventEmitter para comunicação com host
  - ❌ 1 barrel bypass (logger)
  - ❌ scheduleFallback() é dead code funcional (GAP-AGENT-004)
