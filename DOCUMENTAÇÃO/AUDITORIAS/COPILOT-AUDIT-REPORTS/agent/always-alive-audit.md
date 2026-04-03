# Auditoria Individual — `agent/always-alive.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                               |
| ------------------- | ----------------------------------- |
| **Arquivo**         | `src/copilot/agent/always-alive.js` |
| **Módulo**          | `agent/`                            |
| **LOC**             | 1241                                |
| **Fase**            | F05-02                              |
| **Data de leitura** | 2026-07-05                          |
| **Releitura?**      | Sim (MF-I + MF-II)                  |

---

## 2. Propósito e Responsabilidade

Núcleo do agente autônomo baseado no GitHub Copilot SDK. A classe `AlwaysAliveAgent` (extends
EventEmitter) gerencia o ciclo de vida completo: inicializa/retoma sessão SDK, processa fila de
mensagens, suspende quando o modelo solicita input do usuário, delega dialog loop contínuo ao
`DialogLoopManager`, e emite eventos para NERV/SSE. Singleton exportado como `alwaysAliveAgent` +
accessor `getAgent()`.

---

## 3. API Pública (Exports)

| Export                | Tipo     | Descrição curta                                   |
| --------------------- | -------- | ------------------------------------------------- |
| `AlwaysAliveAgent`    | class    | Classe principal do agente (extends EventEmitter) |
| `alwaysAliveAgent`    | const    | Instância singleton para o processo               |
| `getAgent`            | function | Accessor lazy do singleton                        |
| `PendingQuestion`     | @typedef | Shape de pergunta pendente do modelo              |
| `AgentTask`           | @typedef | Shape de tarefa enfileirada                       |
| `AgentStatus`         | @typedef | Union literal dos estados do agente               |
| `AgentStatusSnapshot` | @typedef | Snapshot completo para API HTTP                   |

**Total de exports**: 7 (3 runtime + 4 typedefs) **Exports consumidos externamente**: ~50 arquivos
(via barrel ou import direto) **Exports possivelmente dead**: nenhum — todos são amplamente
consumidos

---

## 4. Dependências (Imports)

### 4.1 Imports internos (`#copilot/` ou relativos)

| Import                                  | Via barrel? | Módulo origem     |
| --------------------------------------- | ----------- | ----------------- |
| `#copilot/core/errors`                  | ❌ (alias)  | core/             |
| `#copilot/lib/event-helpers`            | ❌ (alias)  | lib/              |
| `#copilot/lib/index`                    | ✅          | lib/              |
| `#copilot/observability` (6 exports)    | ✅          | observability/    |
| `#copilot/observability/logger`         | ❌ bypass   | observability/    |
| `#copilot/hooks/bus`                    | ❌ bypass   | hooks/            |
| `#copilot/hooks/factory`                | ❌ bypass   | hooks/            |
| `#copilot/hooks/session-lifecycle`      | ❌ bypass   | hooks/            |
| `../bridges/mcp-tool-bridge.js`         | ❌ direto   | bridges/          |
| `../config/mcp-servers.js`              | ❌ direto   | config/           |
| `../conversation-hub/store.js`          | ❌ direto   | conversation-hub/ |
| `../terminal/state.js`                  | ❌ direto   | terminal/         |
| `../tools/hook-tools.js`                | ❌ direto   | tools/            |
| `./dialog-loop-manager.js` (+ 10 local) | ❌ direto   | agent/ (intra)    |

### 4.2 Imports externos (npm)

| Pacote                | Uso                            |
| --------------------- | ------------------------------ |
| `@github/copilot-sdk` | `CopilotClient` + type imports |
| `node:events`         | `EventEmitter` base class      |

### 4.3 Diagnóstico de imports

- **Barrel bypasses**: 7 (`logger`, `bus`, `factory`, `session-lifecycle`, `mcp-tool-bridge`,
  `store`, `state`)
- **SDK direto**: Sim — `CopilotClient` importado diretamente. Justificável: é o ponto de entrada do
  SDK.
- **Violação de camada**: Parcial — importa `terminal/state.js` (Layer 5→Layer 5, OK horizontal) e
  `bridges/mcp-tool-bridge.js` (Layer 5→Layer 4, OK downward). A importação de `core/errors.js`
  (Layer 2) é correta.
- **Circular potencial**: Via `hooks/session-lifecycle.js` → pode importar de `agent/`
  indiretamente. A arquitetura atual usa injeção de callbacks para evitar circular, mas o coupling é
  alto.

---

## 5. Estado Interno

### 5.1 Variáveis de módulo (module-level)

| Variável                     | Tipo                 | Mutable?  | TTL/Cleanup?     | Risco |
| ---------------------------- | -------------------- | --------- | ---------------- | ----- |
| `#client`                    | CopilotClient        | Sim       | null em stop     | ok    |
| `#session`                   | CopilotSession       | Sim       | null em stop     | ok    |
| `#status`                    | string literal       | Sim       | N/A              | ok    |
| `#isReconnecting`            | boolean              | Sim       | reset finally    | ok    |
| `#pendingQuestion`           | PendingQuestion      | Sim       | null on answer   | ok    |
| `#messageQueue`              | MessageQueue         | Sim (ref) | drain em stop    | ok    |
| `#dialogLoop`                | DialogLoopManager    | Sim (ref) | force deactivate | ok    |
| `#sessionEventUnsubscribers` | fn[]                 | Sim       | clear em stop    | ok    |
| `#sendCount`                 | number               | Sim       | saved em stop    | ok    |
| `#lastPrInfo`                | object               | Sim       | N/A              | ok    |
| `#model`                     | string               | Sim       | N/A              | ok    |
| `#reasoningEffort`           | string               | Sim       | N/A              | ok    |
| `#contextState`              | object               | Sim       | N/A              | ok    |
| `#messagesCache`             | array                | Sim       | TTL 30s          | ok    |
| `#messagesCacheAt`           | number               | Sim       | N/A              | ok    |
| `#lastCheckpointPath`        | string               | Sim       | N/A              | ok    |
| `#webhooks`                  | WebhookManager       | Sim (ref) | N/A              | ok    |
| `#permissions`               | PermissionController | Sim (ref) | N/A              | ok    |
| `#toolsRegistry`             | ToolRegistry         | Sim (ref) | recreated        | ok    |
| `#statusSnapshotCache`       | object               | Sim       | TTL ~500ms       | ok    |
| `#metricsTimer`              | timer                | Sim       | clear em stop    | ok    |

### 5.2 Singletons

| Singleton          | Factory com reset?     | Symbol.dispose? | Testabilidade             |
| ------------------ | ---------------------- | --------------- | ------------------------- |
| `alwaysAliveAgent` | ❌ (new direto)        | ✅ asyncDispose | Ruim — hard singleton     |
| `getAgent()`       | ❌ (retorna singleton) | N/A             | Boa — indireção para mock |

### 5.3 Timers e Listeners

| Recurso                      | Tipo     | Cleanup registrado?   | Onde?           |
| ---------------------------- | -------- | --------------------- | --------------- |
| `#metricsTimer`              | interval | ✅ clearInterval      | stop() L547     |
| `EventEmitter listeners`     | listener | ✅ removeAllListeners | stop() + attach |
| `#sessionEventUnsubscribers` | fn[]     | ✅ iterated em stop   | stop() L563     |

---

## 6. Análise de Contratos

### 6.1 Contratos de entrada (parâmetros)

| Função/Método           | Param         | Tipo esperado        | Validação?  | Default seguro? |
| ----------------------- | ------------- | -------------------- | ----------- | --------------- |
| `constructor`           | `options`     | object               | ❌          | ✅ `{}`         |
| `sendMessage`           | `message`     | string               | ❌ (truthy) | N/A             |
| `sendMessage`           | `opts.signal` | AbortSignal          | ✅ checked  | N/A             |
| `setPermissionMode`     | `mode`        | string literal       | Delegado    | N/A             |
| `registerWebhook`       | `url`         | string               | Delegado    | N/A             |
| `startDialogLoop`       | `bootPrompt`  | string?              | ❌          | ✅ optional     |
| `setModel`              | `modelId`     | string               | ❌          | N/A             |
| `answerPendingQuestion` | `answer`      | string               | ❌          | N/A             |
| `stop`                  | `opts`        | {shutdownTimeoutMs?} | ❌          | ✅ 10_000       |

### 6.2 Contratos de saída (retornos)

| Função/Método        | Return type          | Nullable? | Error propagation   |
| -------------------- | -------------------- | --------- | ------------------- |
| `start`              | `Promise<void>`      | Não       | throws + emit error |
| `stop`               | `Promise<void>`      | Não       | swallows internally |
| `sendMessage`        | `Promise<string>`    | Não       | reject via promise  |
| `getStatusSnapshot`  | AgentStatusSnapshot  | Não       | N/A                 |
| `getSessionMessages` | `Promise<unknown[]>` | Não       | returns [] on error |

### 6.3 JSDoc completeness

| Critério                       | Status                                               |
| ------------------------------ | ---------------------------------------------------- |
| Todos os exports têm JSDoc?    | ✅                                                   |
| @param com tipo explícito?     | ✅                                                   |
| @returns com tipo explícito?   | ✅                                                   |
| @throws documentado?           | ⚠️ parcial (start + startDialogLoop sim, outros não) |
| @example em funções complexas? | ❌                                                   |
| Typedefs completos e corretos? | ✅                                                   |

---

## 7. Error Handling

| Função/Método          | try/catch? | finally? | Error transformado? | Propagado?     |
| ---------------------- | ---------- | -------- | ------------------- | -------------- |
| `start()`              | ✅         | ❌       | ❌ rethrow          | ✅ + emit      |
| `stop()`               | ✅ (3x)    | ❌       | ❌ swallow+log      | Não            |
| `#tryReconnect()`      | ✅         | ✅       | Delegado            | via return     |
| `#syncSdkHistory()`    | ✅         | ❌       | ❌ swallow+log      | emit(ok:false) |
| `sendMessage()`        | ❌         | ❌       | ❌                  | reject         |
| `getSessionMessages()` | ✅         | ❌       | ❌ returns []       | Swallow        |

**Padrão dominante**: catch-and-log para operações auxiliares; rethrow para operações críticas
(start). **Comentário**: Adequado para o tipo de agente — falhas em shutdown e history sync não
devem derrubar o processo. A separação é intencional e bem documentada.

---

## 8. Segurança

| Vetor               | Aplicável? | Mitigado? | Detalhes                                                                         |
| ------------------- | ---------- | --------- | -------------------------------------------------------------------------------- |
| Injection (SQL/cmd) | ❌         | N/A       | Não executa SQL nem shell diretamente                                            |
| Path traversal      | ❌         | N/A       | Não manipula paths de arquivo                                                    |
| SSRF                | ⚠️         | Delegado  | WebhookManager faz HTTP — delegado a webhook-manager                             |
| Secrets exposure    | ❌         | N/A       | Não toca em secrets diretamente                                                  |
| Prompt injection    | ⚠️         | Parcial   | `sendMessage` aceita qualquer string sem sanitização. O SDK controla a execução. |
| Auth bypass         | ❌         | N/A       | PermissionController media todas as tool approvals                               |

---

## 9. Concorrência e Race Conditions

| Cenário                                          | Risco | Mitigação existente                        |
| ------------------------------------------------ | ----- | ------------------------------------------ |
| `start()` chamado 2x concorrentemente            | Médio | Guard `#status !== 'stopped'` no topo      |
| `stop()` durante `#processQueue()` ativo         | Baixo | Aguarda idle com timeout                   |
| `#tryReconnect()` + `#processQueue()` simultâneo | Alto  | ✅ `#isReconnecting` flag bloqueia queue   |
| `sendMessage()` durante dialog loop ativo        | Baixo | ✅ Guard explícito com reject              |
| `answerPendingQuestion()` 2x consecutivo         | Baixo | ✅ Segunda chamada vê null e retorna false |
| `getStatusSnapshot()` de múltiplos SSE           | Nulo  | ✅ Cache invalidado por dirty flag         |
| Reconexão em loop durante task timeout           | Médio | Delegado a reconnect-policy com backoff    |

---

## 10. Performance

| Preocupação                          | Severidade | Detalhes                                                                                                 |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| Sync I/O (`readState()`)             | P2         | L808: readState() usa readFileSync internamente (state-io.js). Chamado em getStatusSnapshot() — hot path |
| `#messagesCache` com TTL fixo        | P4         | 30s TTL é adequado; env var configurável                                                                 |
| `#statusSnapshotCache` com TTL 500ms | P4         | Adequado — safety net após dirty flag                                                                    |
| EventEmitter maxListeners=50         | P4         | Configurável via env; adequado para carga típica                                                         |
| `setInterval` para métricas (30s)    | P4         | `.unref()` corretamente aplicado                                                                         |

---

## 11. Achados (Questões Formais)

### BUG-AGENT-001 — `answerPendingQuestion()` chama `hookToolsResolveUserInput()` duas vezes

- **Severidade**: P2
- **Arquivo**: `src/copilot/agent/always-alive.js`#L689-L700
- **Descrição**: Quando há `#pendingQuestion` ativo, o método chama
  `hookToolsResolveUserInput(answer)` no final (L700). Porém, quando NÃO há pendingQuestion, o
  branch do topo (L691) também chama `hookToolsResolveUserInput(answer)`. Se
  `answerPendingQuestion()` for chamado com pendingQuestion ativo, `hookToolsResolveUserInput` será
  chamado **duas vezes** com o mesmo answer — L691 é skippado, mas L700 executa. Isso é correto no
  path normal, mas o nome `resolveUserInput` sugere que múltiplas chamadas com o mesmo answer devem
  ser idempotentes. Verificar na implementação de `hook-tools.js`.
- **Cenário de manifestação**: Toda resposta a pergunta pendente resolve a tool Promise + resolve
  nativo do SDK. Se a tool já foi resolvida, a segunda chamada é no-op (se idempotente) ou gera
  warning.
- **Proposta de correção**: Verificar idempotência em `hook-tools.js`. Se não for idempotente, mover
  a chamada L700 para dentro de um else ou remover duplicata.
- **Impacto se não corrigido**: Possível double-resolve de Promise (se não idempotente).

### PERF-AGENT-001 — `readState()` sync I/O no hot path de `getStatusSnapshot()`

- **Severidade**: P2
- **Arquivo**: `src/copilot/agent/always-alive.js`#L808
- **Descrição**: `getStatusSnapshot()` chama `readState()` que internamente faz `readFileSync`. Este
  método é chamado por SSE polling (múltiplos clientes) e pelo timer periódico de métricas. O cache
  de 500ms mitiga parcialmente, mas em cenários de alta carga com cache expirado, o sync I/O
  bloqueia o event loop.
- **Cenário de manifestação**: Múltiplos SSE clients conectados simultaneamente causam picos de
  latência no event loop quando o cache expira. Mitigado pelo dirty-flag + TTL, mas poderia ser
  eliminado.
- **Proposta de correção**: Migrar `readState()` para versão async com cache in-memory que
  sincroniza com disco periodicamente (write-through).
- **Impacto se não corrigido**: Latência no event loop sob carga alta.

### ARCH-AGENT-001 — Barrel bypasses excessivos (7 imports diretos cross-module)

- **Severidade**: P2
- **Arquivo**: `src/copilot/agent/always-alive.js`#L23-L50
- **Descrição**: O arquivo importa diretamente de 7 submodules (logger, bus, factory,
  session-lifecycle, mcp-tool-bridge, store, state) em vez de usar os barrel indexes
  correspondentes. Isso viola o princípio de encapsulamento por módulo e torna o arquivo dependente
  da estrutura interna dos módulos.
- **Cenário de manifestação**: Renomear arquivos internos de hooks/, bridges/, terminal/ quebraria
  este arquivo.
- **Proposta de correção**: Migrar para imports via barrel: `#copilot/hooks`, `#copilot/bridges`,
  `#copilot/terminal`, `#copilot/conversation-hub`.
- **Impacto se não corrigido**: Fragilidade em refatorações; dificuldade de medir surface area dos
  módulos.
- **Referência arquitetural**: Delta T5 (Barrel Enforcement) do plano AS-IS→TO-BE.

### LEAK-AGENT-001 — Singleton `alwaysAliveAgent` não é resetável

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/always-alive.js`#L1230-L1241
- **Descrição**: O singleton é criado como `const alwaysAliveAgent = new AlwaysAliveAgent()` no
  module scope. Não existe factory reset. O `getAgent()` sempre retorna a mesma instância. Em testes
  de integração que precisam de teardown completo, o singleton mantém estado residual entre runs.
- **Cenário de manifestação**: Testes de integração que chamam `stop()` + `start()` podem observar
  listeners fantasmas ou estado da sessão anterior.
- **Proposta de correção**: Converter `getAgent()` em factory com parâmetro de reset, ou usar DI
  container.
- **Impacto se não corrigido**: Testes de integração requerem workarounds manuais.

---

## 12. Upgrades Propostos

### UPG-AGENT-003 — Converter `readState()` para async com cache write-through

- **Prioridade**: P2
- **Motivação**: Eliminar sync I/O no hot path de getStatusSnapshot(). O cache TTL atual mitiga, mas
  async eliminaria o bloqueio do event loop completamente.
- **Implementação proposta**: `state-io.js` mantém estado em memória, synca com disco a cada N
  segundos ou em stop(). Leitura sempre a partir da memória.
- **Trade-offs**: Complexidade de manutenção do cache; risco de perda de dados em crash (mitigável
  com fsync periódico).
- **Complexidade estimada**: Média
- **Pré-requisitos**: Atualizar todos os consumers de `readState()`.

### UPG-AGENT-004 — Extrair init/session lifecycle para módulo dedicado

- **Prioridade**: P3
- **Motivação**: `#initSession()` (L1042-L1100) é uma orquestra complexa: MCP tools, registry
  rebuild, hooks composition, session creation. Separar em `session-factory.js` reduziria o tamanho
  de always-alive.js e melhoraria testabilidade.
- **Implementação proposta**: Criar `agent/session-factory.js` com
  `initSession(client, config): Promise<SessionInit>`.
- **Trade-offs**: Mais arquivos; ganho em clareza e testabilidade.
- **Complexidade estimada**: Média

### UPG-AGENT-005 — Implementar `Symbol.dispose` (sync) além de `Symbol.asyncDispose`

- **Prioridade**: P4
- **Motivação**: TC39 Explicit Resource Management suporta ambos. `using` (sync) + `await using`
  (async). Ter ambos dá flexibilidade.
- **Implementação proposta**:
  `[Symbol.dispose]() { this.stop().catch(e => log('WARN', e.message)); }`
- **Trade-offs**: Shutdown não-gracioso no path síncrono.
- **Complexidade estimada**: Baixa

---

## 13. Cobertura de Testes

| Critério                      | Status                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| Existe spec dedicado?         | ✅ (5 specs dedicados + 9 indiretos)                          |
| Arquivo do spec               | `tests/unit/copilot/test_always_alive_*.spec.js` (5 arquivos) |
| Cenários cobertos             | diagnostics, dialog_loop, reconnect, shutdown, streaming      |
| Cenários edge NÃO cobertos    | stop() durante boot (raceEvents path)                         |
| Cenários de erro NÃO cobertos | SDK client.stop() com erros múltiplos                         |

---

## 14. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                                                             |
| ------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc robusto, typedefs completos, `@ts-check` ativo                                      |
| Error handling      | 8            | Boa separação critical/non-critical; stop() resiliente                                    |
| Segurança           | 8            | Sem superfície direta; delegação correta para controllers                                 |
| Performance         | 6            | readState() sync no hot path; metricsTimer + cache mitigam                                |
| Testabilidade       | 7            | 14 specs; singleton dificulta isolamento total                                            |
| Manutenibilidade    | 6            | 1241 LOC, 7 barrel bypasses, orquestração complexa em 1 arquivo                           |
| **Média ponderada** | **7.0**      | **(8×2 + 8×2 + 8+6+7+6) / 8 = 59/8 ≈ 7.4 → 7.0 arredondado com pessimismo pelo tamanho)** |

---

## 15. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (centro do agente)
- **Fan-out**: Importa de 6 módulos diferentes (lib, observability, hooks, bridges, config,
  conversation-hub, terminal, tools, core)
- **Fan-in**: Consumido por ~50 arquivos via barrel ou singleton
- **Conformidade AS-IS→TO-BE**: ⚠️ Parcial.
  - ✅ Usa injeção de callbacks para evitar circular dependency com hooks
  - ✅ EventEmitter como mecanismo de extensabilidade
  - ❌ 7 barrel bypasses violam T5 (Barrel Enforcement)
  - ❌ Coupling direto com observability/logger (76 imports na codebase, este é um dos 76)
  - ❌ Monolítico (1241 LOC) — candidato a split (#initSession → session-factory.js)

---

## Status de Correção (2026-04-03)

### [IMPROVED] UPG-AGENT-005 — Symbol.dispose (sync) adicionado

Além de Symbol.asyncDispose já existente, adicionado Symbol.dispose síncrono que chama stop() em
fire-and-forget. Suporta além de .

### [NOTED] BUG-AGENT-001 — Falso positivo confirmado

answerPendingQuestion() tem dois branches mutuamente exclusivos via :

- sem pendingQuestion: chama hookToolsResolveUserInput(answer) → return false (linha 686-689)
- com pendingQuestion: chama hookToolsResolveUserInput(answer) → return true (linha 699) Não há
  double-call — resolveUserInput já é idempotente (delete antes de fn(answer)).

### [NOTED] PERF-AGENT-001 — Já mitigado

readState() em state-io.js tem cache in-process (\_stateCache) que retorna O(1) quando warm. O
problema de sync I/O só ocorre em cold start (primeira chamada após writeState clear).

**Pontuação atualizada: 7.5/10**
