# AGENT-REFACTOR-PLAN-G2 — Auditoria Profunda de `src/copilot/agent` (G2)

**Data:** 2026-06-06 **Scope:** `src/copilot/agent/`, `src/copilot/api/bridge-*.js`,
`src/copilot/routes/agent.js` **Base:** commit `a1c3940d` (G1 completo, 27 itens) **Status
inicial:** 🔴 Planejado

---

## Índice

1. [Sumário executivo](#1-sumário-executivo)
2. [Mapa de achados por arquivo](#2-mapa-de-achados-por-arquivo)
3. [Catálogo de itens G2 (105 itens)](#3-catálogo-de-itens-g2)
4. [Roadmap com fases e subfases](#4-roadmap-com-fases-e-subfases)
5. [Tabela de rastreamento](#5-tabela-de-rastreamento)

---

## 1. Sumário executivo

A auditoria G2 é realizada após a conclusão completa do G1. Os 14 arquivos principais de
`src/copilot/agent/` foram lidos completamente, assim como os 4 bridges (`bridge-control.js`,
`bridge-tasks.js`, `bridge-dialog.js`, `bridge-stream.js`) e `routes/agent.js`.

### Distribuição de achados

| Categoria                                     | Qtd     |
| --------------------------------------------- | ------- |
| BUG (incorreção funcional)                    | 18      |
| SEC (segurança / OWASP)                       | 9       |
| ARCH (arquitetura / design)                   | 22      |
| DX (developer experience / configurabilidade) | 18      |
| TEST (cobertura de testes)                    | 16      |
| PERF (performance / hot path)                 | 8       |
| API (contrato externo / bridge)               | 14      |
| **Total**                                     | **105** |

---

## 2. Mapa de achados por arquivo

| Arquivo                    | Achados                                                 |
| -------------------------- | ------------------------------------------------------- |
| `always-alive.js`          | BUG-01..06, ARCH-01..07, DX-01..04, PERF-01..03, SEC-01 |
| `dialog-loop-manager.js`   | BUG-07..11, ARCH-08..12, DX-05..07                      |
| `task-executor.js`         | BUG-12..13, ARCH-13..14, DX-08                          |
| `reconnect-policy.js`      | BUG-14..15, ARCH-15, DX-09                              |
| `message-queue.js`         | BUG-16..17, ARCH-16..17, PERF-04                        |
| `session-event-wirer.js`   | BUG-18, ARCH-18, PERF-05                                |
| `session-initializer.js`   | SEC-02..03, ARCH-19, DX-10..11                          |
| `webhook-manager.js`       | SEC-04..06, ARCH-20, PERF-06..07                        |
| `tool-audit-logger.js`     | SEC-07..08, ARCH-21, PERF-08                            |
| `permission-controller.js` | ARCH-22, DX-12..13                                      |
| `state-io.js`              | DX-14..15                                               |
| `agent-contract.js`        | API-01..04                                              |
| `bridge-control.js`        | API-05..08, SEC-09                                      |
| `bridge-tasks.js`          | API-09..11                                              |
| `bridge-dialog.js`         | API-12..13                                              |
| `bridge-stream.js`         | API-14                                                  |
| `events.js`                | DX-16..17                                               |
| `tools-bootstrap.js`       | ARCH-22, DX-18                                          |

---

## 3. Catálogo de itens G2

### 3.1 BUG — Incorreções funcionais (18 itens)

#### G2-BUG-01: `reconnect-policy.js` — typo `reconected` → `reconnected`

**Arquivo:** `src/copilot/agent/reconnect-policy.js` **Problema:** Payload do evento `ready` emitido
na reconexão bem-sucedida usa a propriedade errada `reconected: true` em vez de `reconnected: true`.
Consumers que verificam `evt.reconnected` não detectam a reconexão. **Correção:** Renomear campo no
`emit('ready', { ..., reconnected: true })`.

---

#### G2-BUG-02: `message-queue.js` — `enqueue()` não detecta AbortSignal já disparado

**Arquivo:** `src/copilot/agent/message-queue.js` **Problema:** Quando `signal?.aborted === true` ao
chamar `enqueue()`, a tarefa é adicionada à fila mesmo assim e só é removida na sequência pelo
listener `'abort'`. Isso causa `onEnqueue()` desnecessário, possível double-execution se o consumer
não verifica sinal, e ruído em logs. **Correção:** Verificar `signal?.aborted` no início de
`enqueue()` e rejeitar/ignorar imediatamente.

---

#### G2-BUG-03: `dialog-loop-manager.js` — `resume()` Estratégia A ouve evento no emitter errado

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** O método `resume()` com
Estratégia A (async loop boot) aguarda o evento `'question.pending'` em `this` (DialogLoopManager),
mas esse evento é emitido por `AlwaysAliveAgent`. Como o DLM não emite esse evento, a espera de 5 s
sempre expira, causando start desnecessário. **Correção:** Ouvir o evento no `#agent`
(AlwaysAliveAgent) ou usar `waitForEvent(this.#agent, ...)`.

---

#### G2-BUG-04: `dialog-loop-manager.js` — `#sendCount` nunca é incrementado

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** O campo privado
`#sendCount = 0` existe e é parte do payload de `dialog.loop.changed`, mas nenhum código incrementa
esse contador. O valor permanece 0 para sempre, tornando a métrica inútil para depuração e
diagnóstico. **Correção:** Incrementar `this.#sendCount++` em `sendTurn()` após o envio
bem-sucedido.

---

#### G2-BUG-05: `dialog-loop-manager.js` — race condition no check de `signal?.aborted` em `sendTurn()`

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** `sendTurn()` verifica
`signal?.aborted` de forma síncrona, depois registra o listener de abort de forma assíncrona (no
início do bloco `try/async-function`). Há uma janela de tempo entre o check e o registro do listener
onde o sinal pode ser disparado sem ser detectado. **Correção:** Verificar `signal?.aborted`
imediatamente antes de cada operação assíncrona crítica, ou registrar o listener `'abort'` de forma
síncrona antes de qualquer `await`.

---

#### G2-BUG-06: `task-executor.js` — dupla subscrição de `assistant.message_delta`

**Arquivo:** `src/copilot/agent/task-executor.js` **Problema:** O `task-executor.js` assina
`session.on('assistant.message_delta')` para emitir deltas durante execução. Porém,
`session-event-wirer.js` também assina `assistant.message_delta` e emite `task.delta` (filtrado por
`isProcessing()` mas apenas após `G1-BUG-06`). Se `isProcessing()` retornar `false` por qualquer
razão durante uma tarefa, ambos emitem deltas, resultando em eventos duplicados no SSE.
**Correção:** Garantir que `session-event-wirer.js` _nunca_ emita `task.delta` durante execução de
tarefa, e que o filtro não tenha janela de race condition ao mudar o status de `processing`.

---

#### G2-BUG-07: `reconnect-policy.js` — reutiliza `CopilotClient` sem parar antes de `initSession()`

**Arquivo:** `src/copilot/agent/reconnect-policy.js` **Problema:** O método de reconexão chama
`initSession(client)` reutilizando o mesmo `CopilotClient` sem chamar `client.stop()` ou cancelar
listeners anteriores. O SDK pode logar listeners em excesso ou manter estado inconsistente da
conexão anterior. **Correção:** Chamar `client.stop()` (se disponível) antes de
`initSession(client)`.

---

#### G2-BUG-08: `always-alive.js` — heurística de detecção de dialog loop por `timeoutMs === 24h` é frágil

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** O método `sendMessage()` usa
`timeoutMs === 24*60*60*1000` para inferir que a mensagem foi enviada pelo dialog loop. Essa
heurística acidental se quebra se o timeout mágico mudar, ou se um usuário enviar uma mensagem com
exatamente 86400000 ms de timeout. **Correção:** Adicionar parâmetro explícito
`_fromDialogLoop?: boolean` à assinatura interna, ou usar uma propriedade privada
`#dialogLoopTurnActive` setada pelo DLM antes de chamar `sendMessage`.

---

#### G2-BUG-09: `always-alive.js` — `setModel()` usa cast `/** @type {any} */` inseguro

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** `setModel()` executa
`(/** @type {any} */ (this.#session)).setModel(modelId)` sem verificar se o SDK realmente suporta
`setModel`. Se a sessão não tiver esse método, lança TypeError em produção. **Correção:** Verificar
`typeof this.#session.setModel === 'function'` antes de chamar, ou documentar explicitamente como
funcionalidade experimental.

---

#### G2-BUG-10: `always-alive.js` — `answerPendingQuestion()` faz import dinâmico que pode falhar silenciosamente

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** O método usa
`dynamic import('#copilot/tools/hook-tools.js')` dentro de um bloco async. Se o módulo não existir
ou tiver erro de sintaxe, o erro é capturado mas a callback retornada é chamada com `null`, podendo
causar respostas incorretas ao SDK. **Correção:** Usar import estático no topo do arquivo; se for
necessário lazy loading, pelo menos logar o erro como ERROR (em vez de INFO) e propagar
adequadamente.

---

#### G2-BUG-11: `dialog-loop-manager.js` — `forceDeactivate()` não emite `'stopped'`

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** `forceDeactivate()` para o
watchdog e seta `#active = false`, mas **não emite** o evento `'stopped'` no agente, nem dispara
`dialog.loop.changed`. O host (`always-alive.js`) não recebe notificação automática do encerramento
forçado, potencialmente deixando o agente em estado inconsistente. **Correção:** Emitir
`this.emit('stopped')` e chamar `onDialogLoopChange(false)` dentro de `forceDeactivate()`.

---

#### G2-BUG-12: `task-executor.js` — `auditToolStart`/`auditToolComplete` chamados sem verificar disponibilidade

**Arquivo:** `src/copilot/agent/task-executor.js` **Problema:** `auditToolStart` e
`auditToolComplete` são importados de `#copilot/channel`. Se o canal não estiver inicializado
(agente em estado de startup parcial), essas chamadas podem lançar exceções não capturadas.
**Correção:** Verificar disponibilidade antes de chamar, ou garantir que `#copilot/channel` seja
sempre inicializado antes do task executor.

---

#### G2-BUG-13: `session-event-wirer.js` — `token_budget_warning` duplicado para sessões com contexto pesado ao iniciar

**Arquivo:** `src/copilot/agent/session-event-wirer.js` **Problema:** Para sessões retomadas com
contexto > 70%, o handler de `session.usage_info` emite `session.token_budget_warning` com
`reason: 'startup_heavy'` no primeiro evento. Mas se `currentTokens / tokenLimit > 0.8` também, o
segundo bloco `if` imediatamente após emite **outro** `session.token_budget_warning` sem `reason`.
Resultado: 2 eventos desnecessários no mesmo tick para o mesmo threshold. **Correção:** Usar
`else if` no segundo bloco, ou verificar se o primeira condição já foi disparada.

---

#### G2-BUG-14: `webhook-manager.js` — sem timeout por requisição HTTP

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Problema:** A requisição HTTP para cada
webhook não tem timeout. Se um servidor estiver lento ou não responder, cada `Promise` pode ficar
pendente indefinidamente, segurando o `Promise.allSettled` e bloqueando o ciclo de emissão de
eventos por um tempo arbitrário. **Correção:** Adicionar `setTimeout` com destruição do request após
limite configurável (ex: 5 s).

---

#### G2-BUG-15: `webhook-manager.js` — ID de webhook não é criptograficamente seguro

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Problema:** IDs de webhook usam `Date.now()` +
`Math.random().toString(36)`. `Math.random()` é pseudoaleatório e previsível; o ID pode ser inferido
se o atacante conhecer o timestamp aproximado de registro. **Correção:** Usar `crypto.randomUUID()`
ou `crypto.randomBytes(16).toString('hex')`.

---

#### G2-BUG-16: `state-io.js` — `writeState()` síncrono não lança exceção para indicar falha de I/O

**Arquivo:** `src/copilot/agent/state-io.js` **Problema:** `writeState()` usa `writeFileSync` sem
try/catch. Se o disco estiver cheio ou o diretório sem permissão de escrita, lança uma exceção não
capturada que vai explodir a stack do chamador. **Correção:** Envolver em try/catch e logar
`ERROR` + re-lançar com mensagem contextualizada, ou pelo menos documentar que o caller deve tratar
a exceção.

---

#### G2-BUG-17: `always-alive.js` — `#syncSdkHistory()` fire-and-forget sem mecanismo de retry

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** `#syncSdkHistory()` é chamado de
forma fire-and-forget; seu erro é logado como WARN mas não há retry. Se a histórico SDK for crítico
para retomar conversas corretamente, uma falha silenciosa pode corromper o estado sem o operador
saber. **Correção:** Emitir evento `'session.history_synced'` com `{ ok: false, error }` em caso de
falha, além do log, para que consumers SSE monitorem.

---

#### G2-BUG-18: `session-event-wirer.js` — catch-all registrado após `knownEvents` pode processar eventos duplicados

**Arquivo:** `src/copilot/agent/session-event-wirer.js` **Problema:** O SDK emite eventos como
`session.usage_info` que são processados pelo listener específico. O catch-all
`session.on((evt) => ...)` registrado depois também recebe o mesmo evento (pois o SDK entrega a
todos os listeners). O bloco `if (!knownEvents.has(kind))` evita processamento duplicado, mas
`assistant.usage` no catch-all também grava estado! Se o SDK entregar o evento a ambos os listeners,
pode haver dupla escrita em `writeStateAsync`. **Correção:** Consolidar o handler de
`assistant.usage` fora do catch-all, em listener dedicado.

---

### 3.2 SEC — Segurança (9 itens)

#### G2-SEC-01: `webhook-manager.js` — SSRF via registro de URL webhook sem validação

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Problema:** `register(url)` aceita qualquer
URL sem validação. Um atacante com acesso ao endpoint de registro de webhooks pode registrar
`http://169.254.169.254/` (SSRF via metadata AWS/GCP), `http://localhost:6379/` (Redis), ou URLs
internas arbitrárias. **Correção (OWASP A10 — SSRF):** Validar que a URL:

- Use apenas `http:` ou `https:` (não `file:`, `ftp:`, etc.)
- Não aponte para IPs privados RFC 1918 (`10.*`, `172.16-31.*`, `192.168.*`, `127.*`)
- Não aponte para o localhost ou link-local (`169.254.*`, `::1`, `[::ffff:127.*]`) Implementar
  usando Node.js `dns.lookup()` + verificação de range, ou blocklist estática.

---

#### G2-SEC-02: `session-initializer.js` — `BRIEFING_FILE` lido sem limite adicional de tamanho

**Arquivo:** `src/copilot/agent/session-initializer.js` **Problema:** `buildHookSystemContext()` lê
`session-briefing.md` sem limitar o tamanho antes da leitura — apenas após, em
`buildHookSystemContextSafe()`. Se o arquivo crescer muito (log malicioso ou injection via briefing
externo), pode consumir memória excessiva no `readFile` antes do truncate. **Correção:** Verificar o
tamanho do arquivo com `stat()` antes de `readFile()`. Se > 16KB, ler apenas os primeiros 16KB via
`fs.createReadStream` com `.destroy()` após limite.

---

#### G2-SEC-03: `session-initializer.js` — `close_key` validado mas ainda incluído literalmente no system prompt

**Arquivo:** `src/copilot/agent/session-initializer.js` **Problema:** `close_key` é validado com
regex `/^[a-zA-Z0-9_-]{1,64}$/` e sanitizado para evitar injection. Porém, o valor é incluído
literalmente no system prompt com `` `${closeKey}` `` em contexto Markdown. Se o regex for
desativado por acidente em refatorações futuras, o injection se tornará possível. **Correção:** Usar
template que escape a chave em HTML entities ou wrap em bloco de código fenced para garantir que não
seja interpretado como instrução Markdown ativa.

---

#### G2-SEC-04: `tool-audit-logger.js` — HIGH_RISK_TOOLS é um conjunto estático e incompleto

**Arquivo:** `src/copilot/agent/tool-audit-logger.js` **Problema:**
`HIGH_RISK_TOOLS = new Set(['bash', 'edit', 'create', 'git_apply_patch'])`. Ferramentas de alto
risco adicionadas pelo SDK em versões futuras (ex.: `run_in_terminal`, `write_file`, `execute_code`)
não são classificadas como tal, potencialmente não sendo logadas com WARN. **Correção:** Tornar
`HIGH_RISK_TOOLS` configurável via variável de ambiente `COPILOT_HIGH_RISK_TOOLS` (lista separada
por vírgulas), com os valores atuais como fallback.

---

#### G2-SEC-05: `tool-audit-logger.js` — arquivo de audit log em path relativo ao `import.meta.dirname`

**Arquivo:** `src/copilot/agent/tool-audit-logger.js` **Problema:** `TOOL_AUDIT_LOG` é derivado de
`import.meta.dirname` com 3 níveis `../../..`. Se o módulo for movido, o caminho do log muda
silenciosamente. Além disso, o path não é validado. **Correção:** Usar
`process.env.COPILOT_AUDIT_LOG_PATH` com fallback para o path absoluto atual. Documentar o path
esperado.

---

#### G2-SEC-06: `webhook-manager.js` — payload de webhook inclui `event` e `payload` sem sanitização

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Problema:**
`JSON.stringify({ event, payload, timestamp })` inclui o payload completo do evento, que pode conter
dados sensíveis (tokens, IDs de sessão, conteúdo de mensagens, etc.). Webhooks externos podem
exfiltrar esses dados. **Correção:** Implementar lista de campos permitidos no payload, ou permitir
que o registrador defina um filtro (schema de projeção) por webhook.

---

#### G2-SEC-07: `bridge-control.js` — `POST /permissions` sem autenticação

**Arquivo:** `src/copilot/api/bridge-control.js` **Problema:** O endpoint `POST /permissions` altera
o modo de aprovação de ferramentas sem nenhuma verificação de autenticação ou autorização. Qualquer
processo com acesso à porta HTTP pode mudar o modo para `approve_all`, desativando toda auditoria.
**Correção:** Verificar presença do header de auth (`Authorization: Bearer <token>`) ou IP de origem
antes de permitir a alteração. A rota já existe em bridge separado, mas não tem middleware de auth.

---

#### G2-SEC-08: `bridge-stream.js` — SSE não tem limite de tempo de vida por conexão

**Arquivo:** `src/copilot/api/bridge-stream.js` **Problema:** Uma conexão SSE pode ficar aberta
indefinidamente. Sem limite de vida por conexão, um atacante pode abrir milhares de conexões SSE
(sem WebSocket limit), esgotando file descriptors e conexões HTTP. **Correção:** Adicionar
`MAX_SSE_LIFETIME_MS` (ex: 24h) e fechar a conexão com evento `reconnect` para forçar o cliente a
reconectar, além de um rate limit por IP.

---

#### G2-SEC-09: `bridge-control.js` — `GET /health` expõe diagnósticos em dev sem autenticação

**Arquivo:** `src/copilot/api/bridge-control.js` **Problema:** `listenerDiagnostics` é retornado em
`/health` quando `NODE_ENV === 'development'`, mas sem autenticação. Em ambientes dev/staging
expostos, isso vaza informações sobre a estrutura interna do sistema de eventos. **Correção:** Ou
remover `listenerDiagnostics` do health check completamente (mover para endpoint dedicado), ou
adicionar verificação de IP de origem.

---

### 3.3 ARCH — Arquitetura / Design (22 itens)

#### G2-ARCH-01: `dialog-loop-manager.js` — `#executeTurn()` tem complexidade cognitiva excessiva (~140 linhas)

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** O método `#executeTurn()` é o
núcleo do dialog loop e contém lógica de timeout, handling de retry, resume, classificação de
protocolo e emit de eventos — tudo inline. Complexidade ciclomática estimada > 25. **Correção:**
Extrair sub-funções: `#handleReadySignal()`, `#handleReplySignal()`, `#handleStopSignal()`,
`#executeTurnWithTimeout()`.

---

#### G2-ARCH-02: `always-alive.js` — `sendMessage()` mistura lógica de fila + lógica de dialog loop

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** O método `sendMessage()` tem dois
fluxos radicalmente diferentes: (a) enfilar para processamento normal e (b) rotear para o dialog
loop. Esses fluxos coexistem no mesmo método com flag implícita do `timeoutMs`, aumentando
acoplamento. **Correção:** Criar método separado `#sendToDialogLoop(text, opts)` e chamar de
`sendDialogTurn()` em vez de reutilizar `sendMessage()`.

---

#### G2-ARCH-03: `always-alive.js` — `answerPendingQuestion()` usa import dinâmico que deveria ser estático

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** Import dinâmico de `hook-tools.js`
dentro de método de instância cria dependência de runtime, dificulta análise de tipos, e tem
overhead de resolução a cada chamada. **Correção:** Mover para import estático no topo do arquivo.

---

#### G2-ARCH-04: `dialog-loop-manager.js` — `#waitForRestartAndReply()` pode vazar listeners se sinal abortar após cleanup

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** O método registra listeners no
agente para `'dialog.ready'` e `'dialog.error'`. Se o `AbortSignal` disparar após o cleanup interno
(que remove esses listeners) mas antes de o método retornar, o Promise pode ficar pendente com
nenhum listener ativo, causando memory leak sutil. **Correção:** Usar `AbortController` +
`addEventListener('abort', cleanup)` com flag `{ once: true }`.

---

#### G2-ARCH-05: `message-queue.js` — `unshift()` deve chamar `onEnqueue()` ou isso precisa ser documentado

**Arquivo:** `src/copilot/agent/message-queue.js` **Problema:** `unshift()` reinsere uma tarefa na
frente da fila mas não chama `this.#onEnqueue?.()`. O contrato não documenta esse comportamento. O
caller em `always-alive.js` compensa chamando manualmente, mas isso é frágil. **Correção:** Ou ligar
`onEnqueue()` dentro de `unshift()`, ou adicionar JSDoc explícito `@remarks` documentando que o
caller **deve** acionar o processamento manualmente.

---

#### G2-ARCH-06: `webhook-manager.js` — usa `http`/`https` nativos em vez de `fetch`

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Problema:** O código usa `node:http` e
`node:https` com callbacks manualmente. Node.js 18+ tem `fetch` nativo (e Node 24 tem `undici` com
`fetch` de alta performance). O código atual é mais verboso, mais difícil de testar e não suporta
timeout nativo. **Correção:** Migrar para `fetch()` com `AbortSignal.timeout(5000)`.

---

#### G2-ARCH-07: `session-event-wirer.js` — lógica de `token_budget_warning` inline em handler de `usage_info`

**Arquivo:** `src/copilot/agent/session-event-wirer.js` **Problema:** A lógica de verificação de
threshold de tokens (70%, 80%) está inline no handler, com variável local `_firstUsageChecked` que
persiste entre chamadas do mesmo closure. Isso dificulta testes unitários e pode criar comportamento
unexpected se o handler for re-registrado. **Correção:** Extrair para função pura
`checkTokenBudget(currentTokens, tokenLimit, state)` testável isoladamente.

---

#### G2-ARCH-08: `always-alive.js` — `getStatusSnapshot()` tem cache de 500ms hardcoded

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** O snapshot de status tem TTL de cache
= 500ms. Em cenários de alta frequência de polling (ex.: UI atualizando a cada 100ms), o cache pode
retornar estado desatualizado. Em cenários de baixa frequência, o overhead é desnecessário.
**Correção:** Movido para G2-DX (configurabilidade), mas também: avaliar se o snapshot pode ser
construído em O(1) sem cache (já usa `buildStatusSnapshot()` puro).

---

#### G2-ARCH-09: `reconnect-policy.js` — sem cap máximo no delay exponencial

**Arquivo:** `src/copilot/agent/reconnect-policy.js` **Problema:** O delay de reconexão usa backoff
exponencial sem cap: ao passar de muitas tentativas, o delay pode tornar-se muito alto (na prática é
limitado por `maxAttempts`, mas não por tempo). Falta configurabilidade do cap máximo. **Correção:**
Adicionar `maxDelayMs` com default de 60 000ms.

---

#### G2-ARCH-10: `always-alive.js` — `#ensureDialogLoopAttached()` chama `removeAllListeners()` na primeira vez

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** Nas linhas de wiring do DLM,
`removeAllListeners()` é chamado antes de re-adicionar listeners. Se `#ensureDialogLoopAttached()`
for chamado por erro mais de uma vez, os listeners adicionados na primeira chamada são removidos na
segunda, causando perda de eventos. **Correção:** Usar listeners com `{ once: false }` rastreando
handles para remoção específica em vez de `removeAllListeners`.

---

#### G2-ARCH-11: `dialog-loop-manager.js` — `stop()` sem timeout de encerramento

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** `stop({ authorized: true })`
aguarda que o loop se encerre naturalmente, mas não tem timeout. Se o modelo tiver um turno em
andamento que não termine, o `stop()` pode ficar em espera indefinida. **Correção:** Adicionar
timeout de encerramento (ex: 30 s) após o qual o watchdog é forçado via `forceDeactivate()`.

---

#### G2-ARCH-12: `always-alive.js` — `#MESSAGES_CACHE_TTL` é campo estático privado não configurável

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** `static #MESSAGES_CACHE_TTL = 30_000`
é um campo privado que não pode ser acessado externamente. Movido para G2-DX (configurabilidade via
env).

---

#### G2-ARCH-13: `task-executor.js` — `MAX_TASK_RETRIES = 3` hardcoded sem configurabilidade

**Arquivo:** `src/copilot/agent/task-executor.js` **Problema:** Movido para G2-DX.

---

#### G2-ARCH-14: `always-alive.js` — `listenerDiagnostics()` não tem `@internal` nem env guard

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** `listenerDiagnostics()` é um método
público que expõe a topologia interna do sistema de eventos. Sem `@internal` na JSDoc, tooling de
autocompletion e documentadores o incluem na API pública. **Correção:** Adicionar `@internal` ao
JSDoc; bridge-control já tem env guard, mas o método em si precisa de `@internal`.

---

#### G2-ARCH-15: `permission-controller.js` — `setMode()` aplica apenas na próxima sessão, sem aviso

**Arquivo:** `src/copilot/agent/permission-controller.js` **Problema:** O JSDoc descreve "a mudança
é aplicada na próxima reconexão", mas não há nenhum mecanismo que indique ao caller quando a mudança
efetivamente entrou em vigor. **Correção:** Emitir evento `'permission.mode_changed'` com
`{ mode, appliedImmediately: false }`. O `onModeChanged` callback já existe, mas não indica se a
sessão atual será afetada.

---

#### G2-ARCH-16: `agent-contract.js` — interface `IAlwaysAliveAgent` não inclui métodos adicionados no G1

**Arquivo:** `src/copilot/agent/agent-contract.js` **Problema:** A interface não inclui `telemetry`,
`toolsRegistry`, `dialogLoopActive` (como getter), `setModel()`, `getContextWindow()`. Consumers da
API que usam `IAlwaysAliveAgent` como tipo não têm acesso tipado a esses membros. **Correção:**
Sincronizar `IAlwaysAliveAgent` com a implementação concreta de `always-alive.js`.

---

#### G2-ARCH-17: `events.js` — `AGENT_EVENTS` não tem evento `session.history_synced` nem `dialog.turn_timeout`

**Arquivo:** `src/copilot/agent/events.js` **Problema:** `session.history_synced` é emitido em
`always-alive.js` mas não está em `AGENT_EVENTS`. `dialog.turn_timeout` (timeout de turno no DLM)
seria útil mas não existe. O SSE subscreve via `AGENT_EVENTS`, então eventos não nessa lista nunca
chegam ao SSE. **Correção:** Adicionar `session.history_synced` e `dialog.turn_timeout` ao array.

---

#### G2-ARCH-18: `tools-bootstrap.js` — registros de MCP e custom tools não passam por verificação de colisão

**Arquivo:** `src/copilot/agent/tools-bootstrap.js` **Problema:** A verificação de colisão de nomes
de ferramentas é feita para os grupos padrão, mas `mcpTools` e `customTools` são adicionados ao
`allTools` sem verificação. **Correção:** Incluir `mcpTools` e `customTools` na verificação de
colisão.

---

#### G2-ARCH-19: `session-initializer.js` — `_backgroundCompactionThreshold` é variável de módulo mutável

**Arquivo:** `src/copilot/agent/session-initializer.js` **Problema:**
`_backgroundCompactionThreshold` é uma variável de módulo mutable que pode ser alterada por
`setBackgroundCompactionThreshold()`. Em ambiente com múltiplos agents simultâneos (futuro), isso
seria um estado global compartilhado. **Correção:** Pequena melhoria: documentar como "módulo
singleton". Para futuro multi-agent, considerar encapsular em config object passado ao
`initOrResumeSession`.

---

#### G2-ARCH-20: `dialog-loop-manager.js` — timeout de boot (30s) não emite evento no SSE quando expira

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Problema:** Se o dialog loop não iniciar
em 30s (timeout de boot), o erro é propagado mas não há emissão de evento específico no SSE.
Consumers precisariam escutar o evento `error` genérico. **Correção:** Emitir
`'dialog.boot_timeout'` antes de lançar o erro.

---

#### G2-ARCH-21: `bridge-stream.js` — `setMaxListeners(0)` desabilita completamente o tracking de memory leak

**Arquivo:** `src/copilot/api/bridge-stream.js` **Problema:** `agent.setMaxListeners?.(0)` é chamado
para suportar múltiplos clientes SSE, mas isso desabilita completamente o warning de possíveis
memory leaks. **Correção:** Calcular o número máximo de listeners com base em
`MAX_SSE_CLIENTS * AGENT_EVENTS.length` e usar isso como limite.

---

#### G2-ARCH-22: `tools-bootstrap.js` — sem mecanismo de remoção dinâmica de tool ao runtime

**Arquivo:** `src/copilot/agent/tools-bootstrap.js` **Problema:** Ferramentas são registradas uma
vez na inicialização. Não há mecanismo para remover uma ferramenta específica em runtime (ex.:
desabilitar `shellTools` sem reiniciar). **Correção (planejamento):** Documentar limitação;
considerar `unregisterTool(name)` na interface do `ToolsRegistry` como item futuro.

---

### 3.4 DX — Developer Experience / Configurabilidade (18 itens)

#### G2-DX-01: `always-alive.js` — `#MESSAGES_CACHE_TTL = 30_000` não configurável via env

**Arquivo:** `src/copilot/agent/always-alive.js` **Correção:** Ler de
`process.env.COPILOT_MESSAGES_CACHE_TTL_MS`.

---

#### G2-DX-02: `always-alive.js` — cache TTL do `getStatusSnapshot()` = 500ms não configurável

**Arquivo:** `src/copilot/agent/always-alive.js` **Correção:** Ler de
`process.env.COPILOT_STATUS_CACHE_TTL_MS`.

---

#### G2-DX-03: `task-executor.js` — `MAX_TASK_RETRIES = 3` não configurável via env

**Arquivo:** `src/copilot/agent/task-executor.js` **Correção:** Ler de
`process.env.COPILOT_MAX_TASK_RETRIES`.

---

#### G2-DX-04: `always-alive.js` — `listenerDiagnostics()` sem `@internal` expõe API de debug

**Arquivo:** `src/copilot/agent/always-alive.js` **Correção:** Adicionar anotação `@internal` à
JSDoc do método.

---

#### G2-DX-05: `reconnect-policy.js` — sem cap máximo configurável no delay exponencial

**Arquivo:** `src/copilot/agent/reconnect-policy.js` **Correção:** Ler `maxDelayMs` de
`process.env.COPILOT_RECONNECT_MAX_DELAY_MS` (default: 60 000).

---

#### G2-DX-06: `dialog-loop-manager.js` — boot timeout (30s) e stall threshold não configuráveis via env

**Arquivo:** `src/copilot/agent/dialog-loop-manager.js` **Correção:** Ler de
`COPILOT_DIALOG_BOOT_TIMEOUT_MS` e `COPILOT_DIALOG_STALL_THRESHOLD_MS`.

---

#### G2-DX-07: `webhook-manager.js` — request timeout (5s proposto) não configurável via env

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Correção:** Ler de
`process.env.COPILOT_WEBHOOK_TIMEOUT_MS` (default: 5 000).

---

#### G2-DX-08: `task-executor.js` — `task.timeoutMs ?? 60_000` hardcoded

**Arquivo:** `src/copilot/agent/task-executor.js` **Correção:** Ler de
`process.env.COPILOT_TASK_DEFAULT_TIMEOUT_MS` (default: 60 000).

---

#### G2-DX-09: `session-initializer.js` — `HOOK_CONTEXT_MAX_BYTES = 8KB` não configurável via env

**Arquivo:** `src/copilot/agent/session-initializer.js` **Correção:** Ler de
`process.env.COPILOT_HOOK_CONTEXT_MAX_BYTES` (default: 8 192).

---

#### G2-DX-10: `session-initializer.js` — `skillDirectories` hardcoded como `['.github/skills']`

**Arquivo:** `src/copilot/agent/session-initializer.js` **Problema:**
`skillDirectories: ['.github/skills']` é hardcoded e não pode ser alterado sem modificar o código.
Em projeto com múltiplos diretórios de skills, isso é limitante. **Correção:** Ler de
`process.env.COPILOT_SKILL_DIRECTORIES` (lista separada por vírgulas).

---

#### G2-DX-11: `tool-audit-logger.js` — `MAX_LOG_BYTES = 10MB` não configurável via env

**Arquivo:** `src/copilot/agent/tool-audit-logger.js` **Correção:** Ler de
`process.env.COPILOT_AUDIT_LOG_MAX_BYTES` (default: 10 _ 1024 _ 1024).

---

#### G2-DX-12: `permission-controller.js` — modo padrão hardcoded como `'approve_all'`

**Arquivo:** `src/copilot/agent/permission-controller.js` **Correção:** Ler de
`process.env.COPILOT_DEFAULT_PERMISSION_MODE` (default: `'approve_all'`).

---

#### G2-DX-13: `permission-controller.js` — `denyShell` lista de ferramentas hardcoded

**Arquivo:** `src/copilot/agent/permission-controller.js` **Problema:**
`shellTools = ['run_shell_command', 'run_npm_script', 'run_node_script']` é hardcoded. Novas
ferramentas de shell no SDK não são cobertas automaticamente. **Correção:** Adicionar
`process.env.COPILOT_SHELL_TOOLS` como override.

---

#### G2-DX-14: `state-io.js` — `STATE_FILE` path derivado de `import.meta.dirname` sem env override

**Arquivo:** `src/copilot/agent/state-io.js` **Correção:** Ler `STATE_DIR` de
`process.env.COPILOT_STATE_DIR` com fallback para path calculado.

---

#### G2-DX-15: `state-io.js` — sem validação do JSON lido em `readState()`

**Arquivo:** `src/copilot/agent/state-io.js` **Problema:** `readState()` faz `JSON.parse()` sem
validar contra schema. Estado corrompido pode causar erros em cascata na inicialização.
**Correção:** Adicionar validação básica (pelo menos verificar que `sessionId` é string) com
fallback para `null` e log de `ERROR` se inválido.

---

#### G2-DX-16: `events.js` — `AGENT_EVENTS` sem indicação de quais eventos são de alta frequência (hot-path)

**Arquivo:** `src/copilot/agent/events.js` **Problema:** `task.delta`, `task.reasoning`,
`session.usage` podem ser emitidos centenas de vezes por turno. Consumidores podem não saber quais
eventos são de alta frequência, causando bugs de performance ao assinar sem debounce. **Correção:**
Adicionar anotação JSDoc com `@highFrequency` ou comentário inline nesses eventos.

---

#### G2-DX-17: `events.js` — sem evento `agent.metrics` para coleta periódica de métricas

**Arquivo:** `src/copilot/agent/events.js` **Problema:** Não há mecanismo de coleta de métricas
periódicas (ex: emit a cada 60s com uptime, queue size, sendCount). Operadores dependem de polling
do `/health`. **Correção:** Adicionar evento `agent.metrics` + timer de emissão periódica
configurável via env.

---

#### G2-DX-18: `tools-bootstrap.js` — sem log de summary do bootstrap com count por categoria

**Arquivo:** `src/copilot/agent/tools-bootstrap.js` **Problema:** O bootstrap de tools não emite
nenhum log informativo com o total de ferramentas registradas por categoria, dificultando
diagnóstico de configuração incorreta. **Correção:** Logar `INFO` ao final:
`"[tools-bootstrap] X tools registradas: task=N, code=N, ..."`.

---

### 3.5 TEST — Cobertura de testes (16 itens)

#### G2-TEST-01: `dialog-protocol.js` — sem spec cobrindo `buildBootPrompt()` com e sem `firstMessage`

**Arquivo:** `src/copilot/agent/dialog-protocol.js`

---

#### G2-TEST-02: `dialog-watchdog.js` — sem spec para comportamento de `ping()` reset do timer

**Arquivo:** `src/copilot/agent/dialog-watchdog.js`

---

#### G2-TEST-03: `dialog-watchdog.js` — sem spec para `start()` com watchdog já ativo (guard)

**Arquivo:** `src/copilot/agent/dialog-watchdog.js`

---

#### G2-TEST-04: `permission-controller.js` — sem spec para `setMode('selective', { denyShell: true })`

**Arquivo:** `src/copilot/agent/permission-controller.js`

---

#### G2-TEST-05: `permission-controller.js` — sem spec para `setMode()` com modo inválido

**Arquivo:** `src/copilot/agent/permission-controller.js`

---

#### G2-TEST-06: `status-snapshot.js` — sem spec para `starvationAlert: true` quando `oldestWaitMs >= threshold`

**Arquivo:** `src/copilot/agent/status-snapshot.js`

---

#### G2-TEST-07: `status-snapshot.js` — sem spec para `starvationAlert: false` quando fila vazia

**Arquivo:** `src/copilot/agent/status-snapshot.js`

---

#### G2-TEST-08: `webhook-manager.js` — sem spec para `register()` + `unregister()` lifecycle

**Arquivo:** `src/copilot/agent/webhook-manager.js`

---

#### G2-TEST-09: `webhook-manager.js` — sem spec de SSRF (validação de URL proposta em G2-SEC-01)

**Arquivo:** `src/copilot/agent/webhook-manager.js`

---

#### G2-TEST-10: `tool-audit-logger.js` — sem spec para rotação de log ao atingir `MAX_LOG_BYTES`

**Arquivo:** `src/copilot/agent/tool-audit-logger.js`

---

#### G2-TEST-11: `tool-audit-logger.js` — sem spec para `isHighRiskTool()` com ferramentas conhecidas e desconhecidas

**Arquivo:** `src/copilot/agent/tool-audit-logger.js`

---

#### G2-TEST-12: `message-queue.js` — sem spec para `enqueue()` com sinal já abortado

**Arquivo:** `src/copilot/agent/message-queue.js`

---

#### G2-TEST-13: `message-queue.js` — sem spec para `drain()` com múltiplas tarefas enfileiradas

**Arquivo:** `src/copilot/agent/message-queue.js`

---

#### G2-TEST-14: `state-io.js` — sem spec para `writeStateAsync()` com escritas concorrentes (mutex)

**Arquivo:** `src/copilot/agent/state-io.js`

---

#### G2-TEST-15: `reconnect-policy.js` — sem spec para comportamento de backoff exponencial

**Arquivo:** `src/copilot/agent/reconnect-policy.js`

---

#### G2-TEST-16: `session-initializer.js` — sem spec para `buildHookSystemContextSafe()` com conteúdo > 8KB

**Arquivo:** `src/copilot/agent/session-initializer.js`

---

### 3.6 PERF — Performance (8 itens)

#### G2-PERF-01: `always-alive.js` — `getStatusSnapshot()` com cache de 500ms constrói snapshot mesmo em polling rápido

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** Em polling de 100ms, 4 de cada 5
chamadas retornam cache — mas o custo de construir cada snapshot é O(1) por `buildStatusSnapshot()`.
O cache pode ser simplificado usando dirty flag ao invés de TTL. **Correção:** Usar dirty flag:
invalidar o cache em qualquer mutação de estado (`#status`, etc.), eliminar TTL.

---

#### G2-PERF-02: `session-event-wirer.js` — criação de `Set<string> knownEvents` a cada chamada de `wireSessionEvents()`

**Arquivo:** `src/copilot/agent/session-event-wirer.js` **Problema:** O `Set<string>` de
`knownEvents` é criado dentro da função, não no topo do módulo. A cada reconexão, um novo Set é
alocado. É um detalhe, mas pode ser constante de módulo. **Correção:** Mover `knownEvents` para
constante de módulo.

---

#### G2-PERF-03: `tool-audit-logger.js` — `stat()` + condicional `rename()` em toda escrita de log

**Arquivo:** `src/copilot/agent/tool-audit-logger.js` **Problema:** Para cada linha de audit log, há
uma `stat()` async antes do `appendFile`. Em sistemas com muitas ferramentas sendo auditadas
(centenas por sessão), isso duplica as syscalls. **Correção:** Manter uma variável de módulo
`let _logBytes = 0` acumulando o tamanho, evitando `stat()` a cada linha.

---

#### G2-PERF-04: `message-queue.js` — sem índice por `signal` para cancelamento eficiente

**Arquivo:** `src/copilot/agent/message-queue.js` **Problema:** Ao abortar uma tarefa, o listener de
`'abort'` chama `this.#tasks.splice(idx, 1)`. O `splice` é O(n) e a localização por index usa
`findIndex`. Para filas grandes, isso é ineficiente. **Correção:** Usar
`Map<AbortSignal, AgentTask>` auxiliar ou `Set<AgentTask>` para remoção em O(1).

---

#### G2-PERF-05: `bridge-stream.js` — cada conexão SSE cria um `Map` completo de handlers a cada request

**Arquivo:** `src/copilot/api/bridge-stream.js` **Problema:** Para cada cliente SSE que conecta, um
`new Map(AGENT_EVENTS.map(...))` é criado, alocando ~70 closures. Com muitos clientes, isso aumenta
pressão no GC. **Correção:** Usar objeto protótipo compartilhado com os closures vinculando apenas
`res` específico.

---

#### G2-PERF-06: `webhook-manager.js` — `JSON.stringify(payload)` não tem cache

**Arquivo:** `src/copilot/agent/webhook-manager.js` **Problema:** Cada evento serializado é copiado
pelo `JSON.stringify` para cada webhook. Se houver 20 webhooks registrados, o mesmo body é
serializado 20 vezes (ou 1 vez e reutilizado? O código faz 1x — ok, mas para múltiplos webhooks
simultâneos cada `req.end(body)` envia a mesma string — isso _está_ correto; apenas documentar).
**Ação:** Confirmar que `body` é gerado 1x antes do `Promise.allSettled` — está correto. Adicionar
comentário explicativo.

---

#### G2-PERF-07: `always-alive.js` — `#MESSAGES_CACHE_TTL = 30s` pode causar stale cache de histórico em tasks rápidas

**Arquivo:** `src/copilot/agent/always-alive.js` **Problema:** O cache de histórico de mensagens
expira em 30s. Em tarefas rápidas (< 1s), o histórico pode ficar stale. Mas na prática o cache de
mensagens é para `listMessages()`, que é chamado principalmente por telemetria e diagnóstico, não
por fluxo crítico. **Ação:** Documentar o comportamento esperado no campo.

---

#### G2-PERF-08: `session-event-wirer.js` — `writeStateAsync()` chamado a cada `'assistant.usage'` com Promise chain crescente

**Arquivo:** `src/copilot/agent/session-event-wirer.js` **Problema:** A cada PR consumido,
`writeStateAsync()` encadeia uma nova Promise no mutex `_writeQueue`. Em sessões longas com muitos
PRs, o chain pode crescer. Embora o G1-BUG-05 já resolva a race condition, o chain cresce
linearmente. **Correção:** Verificar se o chain recebe GC adequado após cada resolve — ele deve,
pois cada `_writeQueue.then(...)` substitui a referência anterior. Documentar que é seguro.

---

### 3.7 API — Contrato externo / Bridge (14 itens)

#### G2-API-01: `agent-contract.js` — `IAlwaysAliveAgent` não inclui `telemetry` nem `toolsRegistry`

**Arquivo:** `src/copilot/agent/agent-contract.js` **Correção:** Adicionar propriedades `telemetry`
e `toolsRegistry` ao typedef.

---

#### G2-API-02: `agent-contract.js` — `IAlwaysAliveAgent` não inclui `setModel()`

**Arquivo:** `src/copilot/agent/agent-contract.js` **Correção:** Adicionar
`setModel(modelId: string): void`.

---

#### G2-API-03: `agent-contract.js` — `dialogLoopActive` definido como `boolean | undefined`, deveria ser getter obrigatório

**Arquivo:** `src/copilot/agent/agent-contract.js` **Correção:** Tornar obrigatório:
`dialogLoopActive: boolean`.

---

#### G2-API-04: `agent-contract.js` — `listenerDiagnostics()` retorno tipado como `Record<string, number>` mas poderia usar `AgentEventName`

**Arquivo:** `src/copilot/agent/agent-contract.js` **Correção:** Mudar para
`Partial<Record<AgentEventName, number>>`.

---

#### G2-API-05: `bridge-control.js` — `AgentSnap` typedef local não inclui `permissionMode`

**Arquivo:** `src/copilot/api/bridge-control.js` **Problema:** `AgentSnap` typedef tem os campos
originais mas não inclui `permissionMode`, `contextWindow`, `lastCheckpointPath`. Causa type
mismatch ao tipar o resultado de `getStatusSnapshot()`. **Correção:** Sincronizar `AgentSnap` com
`AgentStatusSnapshot` de `always-alive.js`, ou usar `import()` direto.

---

#### G2-API-06: `bridge-tasks.js` — `waitForResponse` usa `Promise.race` sem cancelar a tarefa se timeout vencer

**Arquivo:** `src/copilot/api/bridge-tasks.js` **Problema:** Quando o timeout vence em
`waitForResponse: true`, a tarefa continua rodando em background. O response HTTP retorna erro de
timeout, mas a tarefa pode completar e emitir `task.completed` no SSE, confundindo o cliente que já
recebeu erro. **Correção:** Passar `AbortController` ao `sendMessage()` e chamar
`controller.abort()` quando o timeout vencer.

---

#### G2-API-07: `bridge-tasks.js` — sem campo `taskId` na resposta de enfileiramento assíncrono

**Arquivo:** `src/copilot/api/bridge-tasks.js` **Problema:** O endpoint `POST /send` sem
`waitForResponse` retorna `{ ok: true, message: "Mensagem enfileirada." }` sem nenhum identificador
de tarefa. O cliente não pode rastrear a tarefa específica no SSE. **Correção:** Retornar
`{ ok: true, taskId: "<uuid>", ... }`.

---

#### G2-API-08: `bridge-dialog.js` — `POST /dialog/start` retorna 409 se agente não está `idle`, mas não informa status atual

**Arquivo:** `src/copilot/api/bridge-dialog.js` **Problema:** A resposta de 409 informa
`"Status: '${agent.status}'"` mas não indica se o loop já está ativo ou se é outro estado. Um
cliente automático não consegue distinguir. **Correção:** Adicionar
`dialogLoopActive: agent.dialogLoopActive` ao body do 409.

---

#### G2-API-09: `bridge-dialog.js` — `POST /dialog/turn` não tem rate limiting

**Arquivo:** `src/copilot/api/bridge-dialog.js` **Problema:** Sem rate limiting, um cliente pode
enviar turnos concorrentes ao dialog loop, causando enfileiramento não controlado. **Correção:**
Retornar 429 imediatamente se já há um turno em andamento (verificar flag).

---

#### G2-API-10: `bridge-stream.js` — sem filtro de eventos por query param `?events=task.*,dialog.*`

**Arquivo:** `src/copilot/api/bridge-stream.js` **Problema:** O SSE envia todos os eventos. Em
conexões lentas, eventos de alta frequência como `task.delta` podem saturar o buffer. Clients
interessados em apenas `question.pending` recebem tudo. **Correção:** Suportar
`?events=event1,event2` para filtrar os eventos entregues ao cliente SSE.

---

#### G2-API-11: `routes/agent.js` — `GET /agent/tools` retorna `registry` completo sem paginação

**Arquivo:** `src/copilot/routes/agent.js` **Problema:** Com 100+ ferramentas registradas, o
response de `/agent/tools` pode ser muito grande. **Correção:** Adicionar suporte a `?category=task`
e `?page=1&limit=20`.

---

#### G2-API-12: `routes/agent.js` — `_agentSseClients` é contador global que não reseta em erro

**Arquivo:** `src/copilot/routes/agent.js` **Problema:** Se uma conexão SSE for fechada abruptamente
sem disparar `'close'`, o contador `_agentSseClients` não diminui. Isso pode bloquear novas conexões
permanentemente. **Correção:** Monitorar também evento `'error'` e `'finish'` na response para
decrementar.

---

#### G2-API-13: `bridge-control.js` — `POST /stop` não verifica se há turnos de dialog loop pendentes

**Arquivo:** `src/copilot/api/bridge-control.js` **Problema:** `POST /stop` chama `agent.stop()` sem
verificar se o dialog loop está ativo. Isso pode causar `stop()` concorrente com `sendDialogTurn()`,
com estado inconsistente. **Correção:** Verificar `agent.dialogLoopActive` e parar o dialog loop
primeiro se necessário.

---

#### G2-API-14: `bridge-control.js` — resposta de `GET /health` não inclui `permissionMode`

**Arquivo:** `src/copilot/api/bridge-control.js` **Problema:** O health check inclui muita
informação operacional mas não o modo de permissão atual. Operadores monitorando o sistema não
conseguem identificar modo incorreto via health check. **Correção:** Adicionar
`permissionMode: snap.permissionMode` ao body do health check.

---

## 4. Roadmap com fases e subfases

### Fase G2.1 — Bugs críticos e segurança (prioridade máxima)

**Meta:** corrigir todos os BUGs que afetam corretude funcional e todos os SECs críticos.

#### G2.1.1 — Bugs de emissão de eventos e payload incorreto

- [x] G2-BUG-01 — typo `reconected` → `reconnected` em `reconnect-policy.js`
- [x] G2-BUG-04 — `#sendCount` nunca incrementado em `dialog-loop-manager.js`
- [x] G2-BUG-11 — `forceDeactivate()` não emite `'stopped'` em `dialog-loop-manager.js`
- [x] G2-BUG-13 — token_budget_warning duplicado em `session-event-wirer.js`
- [x] G2-BUG-17 — `#syncSdkHistory()` precisa emitir `session.history_synced` em falha

#### G2.1.2 — Bugs de race condition e signal handling

- [x] G2-BUG-02 — `enqueue()` não detecta signal já abortado em `message-queue.js`
- [x] G2-BUG-05 — race condition signal abort em `sendTurn()` de `dialog-loop-manager.js`

#### G2.1.3 — Bugs de fluxo e acoplamento

- [x] G2-BUG-03 — `resume()` Estratégia A ouve evento no emitter errado
- [x] G2-BUG-06 — dupla subscrição de `assistant.message_delta`
- [x] G2-BUG-08 — heurística `timeoutMs === 24h` substituir por flag explícita
- [x] G2-BUG-09 — `setModel()` cast inseguro
- [x] G2-BUG-10 — `answerPendingQuestion()` import dinâmico → estático

#### G2.1.4 — Bugs de I/O e integridade

- [x] G2-BUG-07 — reconexão sem `client.stop()` em `reconnect-policy.js`
- [x] G2-BUG-12 — auditTools sem guard de disponibilidade em `task-executor.js`
- [x] G2-BUG-14 — webhook sem timeout HTTP
- [x] G2-BUG-16 — `writeState()` síncrono sem try/catch
- [x] G2-BUG-18 — dupla escrita de estado via catch-all em `session-event-wirer.js`

#### G2.1.5 — BUG de segurança não-SEC

- [x] G2-BUG-15 — ID webhook não criptograficamente seguro

---

### Fase G2.2 — Segurança (OWASP / hardening)

**Meta:** corrigir todos os itens SEC.

#### G2.2.1 — SSRF e validação de entrada

- [x] G2-SEC-01 — validação SSRF em `webhook-manager.register()`
- [x] G2-SEC-02 — limite de tamanho antes do `readFile` em `session-initializer.js`
- [x] G2-SEC-06 — filtro de campos sensíveis no payload de webhook

#### G2.2.2 — Hardening de configuração e acesso

- [x] G2-SEC-04 — `HIGH_RISK_TOOLS` configurável via env
- [x] G2-SEC-05 — path do audit log via env
- [x] G2-SEC-07 — autenticação em `POST /permissions`
- [x] G2-SEC-08 — limite de vida da conexão SSE
- [x] G2-SEC-09 — `/health` com listenerDiagnostics sem auth
- [x] G2-SEC-03 — revisão de escape de `close_key` no system prompt

---

### Fase G2.3 — Arquitetura e refatoração

**Meta:** reduzir complexidade ciclomática, eliminar acoplamentos, consolidar contrato de API.

#### G2.3.1 — Extração de sub-funções (complexidade)

- [x] G2-ARCH-01 — extrair sub-funções de `#executeTurn()` em `dialog-loop-manager.js`
- [x] G2-ARCH-07 — extrair `checkTokenBudget()` de `session-event-wirer.js`

#### G2.3.2 — Separação de responsabilidades

- [x] G2-ARCH-02 — separação já implementada: `sendDialogTurn()` delega ao DLM, `sendMessage()`
      rejeita durante dialog loop
- [x] G2-ARCH-03 — mover import dinâmico para import estático (já feito via G2-BUG-10 — linha 42)
- [x] G2-ARCH-06 — migrar `webhook-manager.js` de `http`/`https` para `fetch()` (já feito)

#### G2.3.3 — Contratos e interfaces

- [x] G2-ARCH-16 — sincronizar `IAlwaysAliveAgent` com implementação concreta
- [x] G2-ARCH-17 — adicionar `session.history_synced` e `dialog.turn_timeout` a `AGENT_EVENTS`
- [x] G2-API-01..04 — atualizar typedefs em `agent-contract.js`
- [x] G2-API-05 — sincronizar `AgentSnap` em `bridge-control.js`

#### G2.3.4 — Resiliência e limites

- [x] G2-ARCH-04 — corrigido: cleanup de `onRetryPending` no timeout handler (já inline)
- [x] G2-ARCH-05 — documentado: JSDoc `@remarks` em `unshift()` explicando que `onEnqueue()` não é
      chamado
- [x] G2-ARCH-10 — corrigir `removeAllListeners()` em `#ensureDialogLoopAttached()`
- [x] G2-ARCH-11 — timeout de encerramento em `stop()` de `dialog-loop-manager.js`
- [x] G2-ARCH-09 — cap máximo de delay exponencial em `reconnect-policy.js`
- [x] G2-ARCH-21 — calcular limite de listeners SSE em vez de `setMaxListeners(0)`

#### G2.3.5 — Colisão de tools e bootstrap

- [x] G2-ARCH-18 — incluir `mcpTools`/`customTools` na verificação de colisão
- [x] G2-ARCH-20 — emitir `'dialog.boot_timeout'` antes de lançar erro
- [x] G2-ARCH-14 — adicionar `@internal` a `listenerDiagnostics()`
- [x] G2-ARCH-15 — melhorar feedback de `setMode()` em `permission-controller.js`

---

### Fase G2.4 — DX, configurabilidade e API

**Meta:** tornar todos os parâmetros críticos configuráveis via env; melhorar contrato de API.

#### G2.4.1 — Configurabilidade via variáveis de ambiente

- [x] G2-DX-01 — `COPILOT_MESSAGES_CACHE_TTL_MS`
- [x] G2-DX-02 — `COPILOT_STATUS_CACHE_TTL_MS`
- [x] G2-DX-03 — `COPILOT_MAX_TASK_RETRIES`
- [x] G2-DX-05 — `COPILOT_RECONNECT_MAX_DELAY_MS`
- [x] G2-DX-06 — `COPILOT_DIALOG_BOOT_TIMEOUT_MS`, `COPILOT_DIALOG_STALL_THRESHOLD_MS`
- [x] G2-DX-07 — `COPILOT_WEBHOOK_TIMEOUT_MS`
- [x] G2-DX-08 — `COPILOT_TASK_DEFAULT_TIMEOUT_MS`
- [x] G2-DX-09 — `COPILOT_HOOK_CONTEXT_MAX_BYTES`
- [x] G2-DX-10 — `COPILOT_SKILL_DIRECTORIES`
- [x] G2-DX-11 — `COPILOT_AUDIT_LOG_MAX_BYTES`
- [x] G2-DX-12 — `COPILOT_DEFAULT_PERMISSION_MODE`
- [x] G2-DX-14 — `COPILOT_STATE_DIR`

#### G2.4.2 — Melhorias de DX e API

- [x] G2-DX-04 — `@internal` em `listenerDiagnostics()` (já em G2.3.5)
- [x] G2-DX-13 — `COPILOT_SHELL_TOOLS` override
- [x] G2-DX-15 — validação de JSON em `readState()`
- [x] G2-DX-16 — marcar eventos de alta frequência em `events.js`
- [x] G2-DX-17 — evento `agent.metrics` já presente em AGENT_EVENTS
- [x] G2-DX-18 — summary log no bootstrap de tools
- [x] G2-API-06 — abortar tarefa quando timeout vence em `bridge-tasks.js` (`a29cc9ed`)
- [x] G2-API-07 — retornar `taskId` no enfileiramento assíncrono (`a29cc9ed`)
- [x] G2-API-08 — adicionar `dialogLoopActive` ao corpo 409 de `/dialog/start` (`a29cc9ed`)
- [x] G2-API-09 — rate limiting em `/dialog/turn` (`9f203224`)
- [x] G2-API-10 — filtro de eventos SSE por query param (`9f203224`)
- [x] G2-API-11 — paginação em `/agent/tools` (`9f203224`)
- [x] G2-API-12 — decrementar `_agentSseClients` em evento `'error'`/`'finish'` (`a29cc9ed`)
- [x] G2-API-13 — verificar dialog loop em `POST /stop` (`a29cc9ed`)
- [x] G2-API-14 — adicionar `permissionMode` ao health check (`a29cc9ed`)

---

### Fase G2.5 — Testes

**Meta:** criar specs para todos os G2-TEST itens e aumentar cobertura.

#### G2.5.1 — Specs de componentes isolados

- [x] G2-TEST-01 — spec `dialog-protocol.spec.js`
- [x] G2-TEST-02 e G2-TEST-03 — spec `dialog-watchdog.spec.js`
- [x] G2-TEST-04 e G2-TEST-05 — spec `permission-controller.spec.js`
- [x] G2-TEST-06 e G2-TEST-07 — spec `status-snapshot.spec.js`
- [x] G2-TEST-08 e G2-TEST-09 — spec `webhook-manager.spec.js` (SSRF)
- [x] G2-TEST-10 e G2-TEST-11 — spec `tool-audit-logger.spec.js`

#### G2.5.2 — Specs de infraestrutura de fila e estado

- [x] G2-TEST-12 e G2-TEST-13 — spec `message-queue.spec.js` (sinal abortado, drain) (`0f020810`)
- [x] G2-TEST-14 — spec `state-io.spec.js` (mutex de escritas concorrentes) (`0f020810`)
- [x] G2-TEST-15 — spec `reconnect-policy.spec.js` (backoff exponencial) — já existia
- [x] G2-TEST-16 — spec `session-initializer.spec.js` buildHookSystemContextSafe > 8KB (`0f020810`)

---

## 5. Tabela de rastreamento

> **Última atualização:** 2026-06-09 — commits `0ae748d9` → `56381148` → `53131a4b` → `791f4a88` →
> `5bb75625` → `3f70ee61` → `a29cc9ed` → `9f203224` → `0f020810`

| Fase                                    | Status       | Commit                |
| --------------------------------------- | ------------ | --------------------- |
| G2.1.1 — Bugs de emissão                | ✅ Concluído | `0ae748d9`            |
| G2.1.2 — Race conditions                | ✅ Concluído | `0ae748d9`            |
| G2.1.3 — Bugs de fluxo                  | ✅ Concluído | `0ae748d9`            |
| G2.1.4 — Bugs de I/O                    | ✅ Concluído | `0ae748d9`            |
| G2.1.5 — Bug de segurança               | ✅ Concluído | `0ae748d9`            |
| G2.2.1 — SSRF e validação               | ✅ Concluído | `791f4a88`            |
| G2.2.2 — Hardening                      | ✅ Concluído | `791f4a88`            |
| G2.3.1 — Extração de sub-funções        | ✅ Concluído | `5bb75625`            |
| G2.3.2 — Separação de responsabilidades | ✅ Concluído | verificado/`a8fb9f6f` |
| G2.3.3 — Contratos e interfaces         | ✅ Concluído | `53131a4b`            |
| G2.3.4 — Resiliência                    | ✅ Concluído | `53131a4b`/`5bb75625` |
| G2.3.5 — Colisão de tools               | ✅ Concluído | `791f4a88`/`5bb75625` |
| G2.4.1 — Configurabilidade env          | ✅ Concluído | `53131a4b`/`791f4a88` |
| G2.4.2 — DX e API                       | ✅ Concluído | `a29cc9ed`/`9f203224` |
| G2.5.1 — Specs de componentes           | ✅ Concluído | `5bb75625`            |
| G2.5.2 — Specs de infra                 | ✅ Concluído | `0f020810`            |

### Itens individuais pendentes

Todos os itens ARCH, SEC, BUG, API, DX e TEST foram concluídos. Restam apenas itens de performance
(fase futura).

| Item       | Descrição resumida                              | Fase   |
| ---------- | ----------------------------------------------- | ------ |
| G2-PERF-01 | dirty flag em vez de TTL no status snapshot     | futura |
| G2-PERF-02 | `knownEvents` Set → constante de módulo         | futura |
| G2-PERF-03 | acumular `_logBytes` sem `stat()` por linha     | futura |
| G2-PERF-04 | remoção O(1) em `message-queue.js`              | futura |
| G2-PERF-05 | closures SSE por cliente evitar Map por request | futura |
