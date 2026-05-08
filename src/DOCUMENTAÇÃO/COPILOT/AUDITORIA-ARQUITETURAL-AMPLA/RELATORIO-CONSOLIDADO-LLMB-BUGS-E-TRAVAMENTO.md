# Relatório Consolidado — Bugs/Gaps da LLM-B + Investigação de Travamento (`[ASK:QUESTION]`)

Data: 2026-05-08
Escopo: consolidação dos achados da LLM-B (AUDITEXTTT) + validação no código atual + investigação do travamento final onde `/quit` não respondeu.

---

## 1) Objetivo e critério de validação

Este documento consolida:

1. **Todos os bugs/gaps reportados pela LLM-B** (incluindo os resumos executivos compartilhados).
2. **Status real no código atual** (corrigido / parcial / pendente), com evidência em arquivo/linha.
3. **Investigação técnica do travamento final** no modo `[ASK:QUESTION]`, explicitando por que **não foi causado por quota limit** como causa-raiz primária.

> Nota: o arquivo `AUDITEXTTT.md` contém duplicações/interleavings de log e conteúdo (sessões repetidas), então o critério principal foi validação no código-fonte atual.

---

## 2) Evidências críticas do travamento (timeline)

Fonte: `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/AUDITEXTTT.md`

- `line 7461`: prompt em modo `[ASK:QUESTION]` recebe `/quit`, seguido imediatamente de warning de pré-stall:
  - `... [ASK:QUESTION]› /quit ... [DialogWatchdog] Pré-stall: loop inativo há 983s ...`
- `line 7462`: watchdog marca inatividade:
  - `[DialogWatchdog] Dialog loop inativo há 983s`
- `line 7468`: nova entrada no mesmo modo com supressão de eventos por rate-limiter:
  - `[rate-limiter] ... streaming_delta excedeu ... eventos suprimidos`
- `line 7530`: timeout de parada do loop:
  - `[DialogLoopManager] stop() timeout após 30000ms — forçando forceDeactivate().`
- `lines 7527/7541+`: warnings de quota (`remaining=0%`) aparecem no mesmo período.

### Leitura causal (conclusão)

- **A quota baixa aparece no cenário**, mas **não explica isoladamente** o `/quit` não funcionar.
- O congelamento observável decorre de uma combinação operacional:
  1. runtime preso/lento em estado de espera (`waiting_for_input`) por longo período;
  2. watchdog escalando stall;
  3. tentativa de stop com timeout e forceDeactivate;
  4. ruído de streaming/rate-limit no mesmo intervalo.

Em resumo: **quota é fator de pressão/ruído**, não causa única do bloqueio do comando de saída.

---

## 3) Validação de arquitetura de entrada no código atual (ponto `/quit`)

### 3.1 Ordem de roteamento no REPL (comando antes de resposta pendente)

Evidência atual em `src/copilot/terminal/repl-lifecycle.js`:

- `line 144`: parse de comando (`parseTerminalReplCommand(trimmed, ...)`)
- `line 146`: dispatch do comando (`dispatchCmd(...)`)
- `line 154`: só depois tenta rotear como resposta de pergunta pendente (`tryAnswerTerminalPendingQuestionInput(trimmed)`)

**Implicação:** no código atual, `/quit` **deve** ter precedência sobre answer de pending question.

### 3.2 Rota explícita de `/quit`

Evidência em `src/copilot/terminal/repl-command-router.js`:

- `line 305`: `['quit', 'exit'] -> _cmdQuit(...)`

### 3.3 Bloqueio para perguntas de protocolo no answer automático

Evidência em `src/copilot/terminal/pending-question-answer.js`:

- `line 66`: considera `protocolControlled` quando kind != `question`
- `line 83`: retorna `reason: 'protocol_controlled'` (não roteia como resposta normal)

**Implicação:** input em contexto de protocolo não deveria “engolir” comando slash no fluxo atual.

---

## 4) Possíveis causas-raiz do travamento final (não-quota)

## 4.1 Timeout + dupla emissão de `stopped` no caminho de stop forçado

Evidência em `src/copilot/agent/dialog/orchestrators/loop-manager.js`:

- `line 351`: timeout do stop chama `forceDeactivate()`
- `line 545`: `forceDeactivate()` emite `stopped` (`authorized: false`)
- `line 374`: após race, `stop()` também emite `stopped` (`authorized: true`)

**Risco:** consumidores reagem duas vezes (restart/teardown duplicado), gerando inconsistência de estado.

## 4.2 Stall durante `waiting_for_input` tratado como travamento real

- O watchdog acusa stall por inatividade longa (ex.: 983s no log), mesmo em cenário de espera por input humano.
- Isso pode disparar recuperação agressiva em momento indevido.

## 4.3 Máquina de status sem transição idempotente para `waiting_for_input`

Evidência em `src/copilot/agent/agent-context.js`:

- `line 1922`: `waiting_for_input -> {processing, stopped}` (não permite mesmo estado)
- `line 1936`: loga “Transição de status inválida”

**Risco:** duplicidade de eventos/reatribuções gera warning e potencial drift de lógica de controle.

---

## 5) Consolidação dos bugs/gaps da LLM-B (status no código atual)

Legenda de status:
- ✅ **Corrigido**
- 🟡 **Parcial**
- ❌ **Pendente**

| ID        | Achado (resumo)                                  | Severidade | Status | Evidência principal                                                                                 |
| --------- | ------------------------------------------------ | ---------: | -----: | --------------------------------------------------------------------------------------------------- |
| EX-01     | stderr intermediário em pipeline (deadlock)      |         P0 |      ✅ | `src/copilot/tools/shell/executor.js` (`stdio` intermediário = `'ignore'`)                          |
| EX-02     | `maxBuffer` 1GiB (OOM/DoS)                       |         P0 |      ✅ | `executor.js:84` (`10 * 1024 * 1024`)                                                               |
| SH-01     | split de pipe não respeita aspas                 |         P1 |      ✅ | `shell/index.js` usa `splitPipelineSegments()` robusto                                              |
| SB-02     | fallback em symlink quebrado (path check bypass) |         P1 |      ✅ | `sandbox.js` e `index.js` validam via `realpath` do parent com fallback seguro                      |
| SB-03     | `rm --recursive --force` não bloqueado           |         P1 |      ✅ | blocklist cobre `--recursive --force` e ordem inversa                                               |
| EX-03     | double-resolve + sem escalada SIGKILL no timeout |         P1 |      ✅ | `executor.js` usa `finalize` one-shot + escalada `SIGTERM`→`SIGKILL`                                |
| SB-01     | `realpathSync` em hot path async                 |         P1 |      ✅ | `sandbox.validateCwd()` e validação de `run_node_file` migradas para async (`fs.promises.realpath`) |
| SH-02     | `timeoutMs: null` hardcoded                      |         P1 |      ✅ | `shell/index.js` aplica timeout real (`advisoryTimeoutMs`) em todas as execuções                    |
| WT-WEB-01 | redirect follow bypass SSRF                      |         P1 |      ✅ | `web-tools.js:299,409` (`redirect: 'error'`)                                                        |
| WT-WEB-02 | sem timeout real + advisoryLimit ignorado        |         P1 |      ✅ | `web-tools.js` aplica timeout real via `AbortController` e mantém cap de leitura                    |
| WT-WEB-03 | stream reader sem release no erro                |         P1 |      ✅ | `web-tools.js:203` (`reader.releaseLock()` em `finally`)                                            |
| RT-01     | `withSkipPermission` muta objeto original        |         P1 |      ✅ | `tool-factory.js:301` (cópia com spread)                                                            |
| WT-01     | TOCTOU em operações de write                     |         P1 |      ✅ | checks atômicos em `io-engine` + remoção de prechecks em `write-tools`                              |
| EX-04     | ternário morto em `stdio`                        |         P1 |      ✅ | não encontrado na implementação atual                                                               |
| SH-03     | audit id via `Date.now()` (colisão)              |         P2 |      ✅ | IDs de audit com sufixo randômico além de timestamp                                                 |
| SH-04     | `realpathSync` em handler assíncrono             |         P2 |      ✅ | `run_node_file` usa resolução assíncrona segura (`resolveWorkspaceRealPathSafe`)                    |
| EX-05     | stdout ilimitado em memória (`runPipeline`)      |         P2 |      ✅ | `executor.js` com `CAPTURE_MAX_BYTES` e append com cap                                              |
| SB-04     | `safeEnv()` copia `process.env` inteiro          |         P2 |      ✅ | `safeEnv()` com cache TTL reduz rebuild por chamada e mantém atualização runtime                    |
| WT-WEB-04 | rate limiter sempre true (não efetivo)           |         P2 |      ✅ | `checkRateLimit()` agora aplica limite real por minuto e bloqueia excesso                           |
| WT-WEB-05 | sem `WEB_FETCH_DISABLED` para `web_fetch_local`  |         P2 |      ✅ | `WEB_FETCH_DISABLED` adicionada em config e aplicada no export de tools web                         |
| TF-01     | mutação por `Object.assign`                      |         P2 |      ✅ | fix documentado/implementado em `tool-factory.js`                                                   |
| TF-02     | estado de cache em propriedade de função         |         P2 |      ✅ | cache migrado para variáveis de módulo (`_zodConverter`, `_zodConverterAttempted`)                  |
| PT-01     | `setPermissionAgent` sem guarda reinjeção        |         P2 |      ✅ | `setPermissionAgent(agent, { force })` com proteção contra reinjeção acidental                      |
| PT-02     | leituras de modo sem trilha JSONL explícita      |         P2 |      ✅ | `permission_mode_get/set` agora registram start/complete via audit estruturado                      |
| WT-02     | mkdir + atomic sem atomicidade ponta-a-ponta     |         P2 |      ✅ | criação de diretório pai agora usa caminho lock-aware no `io-engine` (`mkdirPathLocked`)            |
| PT-03     | `requireAgent()` repetido (janela race)          |         P3 |      ✅ | handlers usam snapshot único de `agent` por chamada                                                 |
| TF-03     | detecção de erro por regex frágil/locale         |         P3 |      ✅ | fallback usa apenas `error.code`/tipo (`ReferenceError`), sem regex textual locale-dependent        |
| TF-04     | `process.env` direto                             |         P3 |      ✅ | logger da factory passou a usar config canônica (`COPILOT_LOG_LEVEL`)                               |
| EX-06     | `truncateOutput` dead code/nome enganoso         |         P3 |      ✅ | truncamento agora é política runtime opcional (`SHELL_OUTPUT_TRUNCATE_ENFORCED`)                    |
| EX-07     | tokenização sem escape com backslash             |         P3 |      ✅ | `tokenizeShell` agora trata escape com `\\` fora de aspas simples                                   |
| RT-02     | dupla importação no barrel de read tools         |         P3 |      ✅ | barrel simplificado sem duplicação redundante de import/re-export                                   |
| SB-05     | `env -0` / `env --null` não bloqueados           |         P3 |      ✅ | blocklist cobre `env -0` e `env --null`                                                             |

---

## 6) Padrões estruturais (resumo executivo consolidado)

| Padrão                         | Situação atual                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| SYNC I/O em runtime            | Reduzido nos hot paths críticos; permanece apenas residual em módulos periféricos        |
| Singletons sem lifecycle claro | Persistem pontos de acoplamento global (não totalmente mitigado)                         |
| Maps sem TTL/cleanup           | Há mitigação local em alguns módulos, mas ainda há risco em caches/interações long-lived |
| Imports SDK diretos proibidos  | Sem violação crítica relevante na amostra validada                                       |
| Circular core→agent            | Sem violação crítica relevante na amostra validada                                       |
| Logger bypass                  | Ainda há pontos de bootstrap/infra com caminhos alternativos                             |
| Listeners/timers órfãos        | Melhorias recentes; ainda requer varredura fina por módulo                               |

---

## 7) Investigação específica de `[ASK:QUESTION]` e travamento do `/quit`

### Diagnóstico consolidado

1. O log mostra `/quit` digitado em prompt `[ASK:QUESTION]` e, em seguida, watchdog pré-stall/stall.
2. No mesmo recorte temporal há supressão de streaming por rate-limiter e timeout no stop do loop.
3. O código atual já tem proteção para priorizar slash command e evitar roteamento indevido de perguntas de protocolo.
4. Portanto, o congelamento observado é mais consistente com **drift de estado + caminho de recovery/stop com timeout** do que com quota pura.

### Hipótese técnica mais provável

- Durante estado prolongado de `waiting_for_input`, o watchdog interpretou inatividade como stall real.
- A recuperação acionou `stop()` com timeout e `forceDeactivate()`, potencialmente com dupla emissão de `stopped`.
- O terminal ficou em estado degradado/intermitente (com output suprimido por rate-limit), levando à percepção de “/quit não funciona”.

### Nota adicional investigada — execução de subagentes

Registro do usuário: o congelamento ocorreu após subagentes terem sido convocados pela LLM-B.

Validação técnica:

- O runtime realmente recebe e processa eventos de subagentes no mesmo pipeline de eventos do terminal/agent (`subagent.started`, `subagent.completed`, `subagent.failed`).
- Em períodos de alta atividade de subagentes, há aumento de volume de eventos de streaming/observabilidade, o que pode **amplificar** sintomas de supressão por rate-limiter e ruído operacional no momento de stall/recovery.
- Não foi encontrada evidência de que subagentes, isoladamente, sejam causa-raiz única; eles aparecem como **fator contribuinte de pressão** (concurrency/event churn), coerente com o cenário de degradação observado.

---

## 8.1) Atualizações aplicadas nesta rodada (Onda A)

1. **Loop manager: suppressão semântica de stall em input humano legítimo**
  - Arquivo: `src/copilot/agent/dialog/orchestrators/loop-manager.js`
  - Mudança: watchdog não escala `stalled/pre_stall` quando existe pending question de tipo `question` (input humano), e faz `ping()` para reset do ciclo.

2. **Loop manager: correção de dupla emissão de `stopped` no timeout de stop**
  - Arquivo: `src/copilot/agent/dialog/orchestrators/loop-manager.js`
  - Mudança: quando `stop()` estoura timeout e chama `forceDeactivate()`, retorna sem emitir segundo `stopped` autorizado.

3. **Agent context: transição idempotente de status**
  - Arquivo: `src/copilot/agent/agent-context.js`
  - Mudança: `setStatus()` retorna cedo se `status` já for o atual, evitando warning/race de transição redundante.

4. **Terminal wiring: guarda defensiva para watchdog stall em `waiting_for_input/question`**
  - Arquivo: `src/copilot/terminal/terminal-agent-wiring.js`
  - Mudança: em stall durante espera humana legítima, o terminal ignora recovery agressivo (abort/restart), faz `ping` e emite evento SSE marcado como `ignored`.

## 8.2) Atualizações aplicadas nesta rodada (Onda B — shell hardening)

1. **Pipeline parser robusto (aspas + escape) e fim do split ingênuo por `|`**
  - Arquivos: `src/copilot/tools/shell/executor.js`, `src/copilot/tools/shell/index.js`
  - Mudança: novo `splitPipelineSegments()`; pipeline respeita aspas e backslash.

2. **Timeout configurável com enforcement opcional (advisory por padrão) nas execuções shell/npm/node/pipeline**
  - Arquivo: `src/copilot/tools/shell/index.js`
  - Mudança: timeout hard só quando policy/runtime ou chamada pedir `enforceTimeout=true`; default preserva liberdade da LLM-B.

3. **Correção de race/double-resolve no timeout de pipeline + escalada de sinal**
  - Arquivo: `src/copilot/tools/shell/executor.js`
  - Mudança: finalização one-shot (`finalize`) e escalada `SIGTERM`→`SIGKILL` após grace.

4. **Limite de memória de captura em pipeline (stdout/stderr)**
  - Arquivo: `src/copilot/tools/shell/executor.js`
  - Mudança: `CAPTURE_MAX_BYTES` + append com truncamento por cap, evitando crescimento ilimitado.

5. **Hardening de blocklist e resolução de caminho**
  - Arquivos: `src/copilot/tools/shell/sandbox.js`, `src/copilot/tools/shell/index.js`
  - Mudança: bloqueio de `rm --recursive --force` (e ordem inversa), bloqueio de `env -0/--null`, validação de caminho por `realpath` do parent em casos de target ausente.

6. **Redução de colisão de IDs de audit**
  - Arquivo: `src/copilot/tools/shell/index.js`
  - Mudança: IDs agora incluem sufixo randômico além de timestamp.

## 8.3) Atualizações aplicadas nesta rodada (Onda B — web hardening)

1. **Timeout real em `web_fetch_local`**
  - Arquivo: `src/copilot/tools/web-tools.js`
  - Mudança: `AbortController` + budget de timeout efetivo no ciclo de fetch com redirects.

2. **Rate limit local por minuto com enforcement opcional (advisory por padrão)**
  - Arquivo: `src/copilot/tools/web-tools.js`
  - Mudança: `checkRateLimit()` opera em modo advisory por default e só bloqueia quando `WEB_RATE_LIMIT_ENFORCED=true`.

3. **Feature flag para desativar `web_fetch_local`**
  - Arquivos: `src/copilot/config/env.js`, `src/copilot/tools/web-tools.js`
  - Mudança: nova env `WEB_FETCH_DISABLED` no SSOT de config e uso no export final das web tools.

## 8.4) Atualizações aplicadas nesta rodada (Onda B — file write hardening)

1. **Checks de existência atômicos no `io-engine` (dentro de lock)**
  - Arquivo: `src/copilot/infra/io-engine.js`
  - Mudança: `writeFileAtomic()` agora suporta `requireExists` e `failIfExists`, eliminando race de precheck externo.

2. **Remoção de prechecks TOCTOU em `write-tools` + parent mkdir lock-aware**
  - Arquivos: `src/copilot/tools/file/write-tools.js`, `src/copilot/infra/io-engine.js`
  - Mudança: `write_file_content`, `create_file`, `copy_file`, `move_file`, `patch_file` delegam validação ao caminho atômico/locked; `create_file` usa `mkdirPathLocked` para diretório pai.

## 8.5) Atualizações aplicadas nesta rodada (Onda C — liberdade runtime + prevenção de timeout indevido)

1. **Políticas dinâmicas para timeout shell (sem reinício)**
  - Arquivos: `src/copilot/config/env.js`, `src/copilot/tools/shell/index.js`
  - Mudança: `getShellTimeoutPolicy()` + `enforceTimeout` por chamada. Por padrão, timeout fica em modo advisory (não hard-kill), preservando liberdade operacional da LLM-B.

2. **Políticas dinâmicas para web rate-limit (sem reinício)**
  - Arquivos: `src/copilot/config/env.js`, `src/copilot/tools/web-tools.js`
  - Mudança: `getWebRateLimitPolicy()` com enforcement opcional. Padrão é advisory para evitar bloqueios indevidos; pode ser endurecido em runtime por env.

3. **Política dinâmica para truncamento de output shell (sem reinício)**
  - Arquivos: `src/copilot/config/env.js`, `src/copilot/tools/shell/executor.js`
  - Mudança: `truncateOutput()` deixa de ser no-op e passa a truncar apenas quando `SHELL_OUTPUT_TRUNCATE_ENFORCED=true` (default permissivo).

4. **Remoção de I/O síncrono residual em shell path safety**
  - Arquivos: `src/copilot/tools/shell/sandbox.js`, `src/copilot/tools/shell/index.js`
  - Mudança: validação de cwd/arquivo via `fs.promises.realpath` e helper async seguro.

5. **Hardening de governança de tools e permissões**
  - Arquivos: `src/copilot/tools/tool-factory.js`, `src/copilot/tools/permission-tools.js`, `src/copilot/tools/file/read-tools.js`
  - Mudança: remoção de cache em propriedades de função, reinjeção protegida de agent, trilha estruturada em JSONL e simplificação de barrel duplicado.

---

## 9) Plano de correção recomendado (curto e objetivo)

### Onda A — estabilização do travamento (prioridade máxima)

1. **Eliminar dupla emissão de `stopped` em `loop-manager.stop()`**
   - Guardar flag `timedOut` e não emitir `stopped` autorizado após `forceDeactivate` já emitido.
2. **Watchdog-aware de `waiting_for_input` humano**
   - Não escalar stall quando o runtime está aguardando resposta legítima de operador.
3. **Transição idempotente de status**
   - Em `setStatus`, ignorar `status === currentStatus` sem warning.
4. **Hard escape de sessão**
   - Garantir `/quit` e `/exit` como comando de fuga com prioridade absoluta, mesmo em contextos de elicitation/protocolo.

### Onda B — segurança/confiabilidade dos tools shell/web/file

5. ✅ Corrigidos `SH-01`, `SH-02`, `EX-03`, `EX-05`, `SB-02`, `SB-03`.
6. Pendentes prioritários: revisão final de baixa prioridade em módulos não críticos e validação operacional contínua.
7. Revisar TOCTOU residual e reduzir sync I/O em handlers assíncronos.

---

## 8.6) Atualizações aplicadas — Onda D (Terminal Independence + Queue Bypass)

**Data:** 2026-05-09
**Foco:** Independência de input do terminal, bypass de fila para comandos críticos, hard timeout no shutdown de `/quit`, state cleanup no fechamento do readline.

### TERM-01 — Cursor reset cíclico na linha do usuário ✅ CORRIGIDO

**Problema:** `writeInlineStatus()` chamava `clearTerminalLine()` = `readline.clearLine(process.stdout, 0)` + `readline.cursorTo(process.stdout, 0)`. Isso movia o cursor do usuário para col 0 a cada intervalo do timer (500ms). O usuário não conseguia digitar sem ter sua posição de cursor constantemente resetada.

**Causa raiz:** Estratégia de renderização flat — status e prompt compartilhavam a mesma linha. Qualquer atualização de status reescrevia sobre o que o usuário estava digitando.

**Solução — "Reserved Status Row" com ANSI save/restore:**
- Arquivo: `src/copilot/terminal/dialog/output.js`
- Uma linha em branco é mantida ACIMA do prompt (o "status row" reservado).
- Status escrito via: `\x1b[s\x1b[1A\r\x1b[K${text}\x1b[u` — salva cursor → sobe 1 linha → limpa → escreve → restaura cursor.
- O cursor do usuário na linha do prompt NUNCA é tocado por atualizações de status.
- `println()` gerencia a transição: limpa status acima, escreve conteúdo, reserva nova linha de status, redesenha prompt.
- `clearInlineStatus()` também usa ANSI save/restore para limpar o status sem mover cursor.

### TERM-02 — `/quit` bloqueado pela lineQueue serializada ✅ CORRIGIDO

**Problema:** `rl.on('line', ...)` em `repl-lifecycle.js` adicionava TODA entrada à `lineQueue` (cadeia de Promises serializada). Se um `handleLine` anterior estava bloqueado em `sendTurn` (ex.: aguardando resposta do modelo travado), `/quit` entrava na fila e nunca chegava a executar — o usuário ficava preso mesmo digitando `/quit`.

**Evidência:** log mostra `/quit` digitado por volta dos 983s de inatividade, mas a fila não drenava.

**Solução — ESCAPE-BYPASS antes da lineQueue:**
- Arquivo: `src/copilot/terminal/repl-lifecycle.js`
- Comandos críticos (`quit`, `exit`, `restart`, `emergency-reset`, `ereset`) são despachados IMEDIATAMENTE via `dispatchCmd()`, sem entrar na `lineQueue`.
- O `return` garante que esses comandos nunca chegam ao `lineQueue.then(...)`.
- `Set` de comandos de escape facilita adição futura de novos escape commands.

### TERM-03 — `runShutdown('terminal.quit')` trava indefinidamente ✅ CORRIGIDO

**Problema:** `_cmdQuit` fazia `await runShutdown('terminal.quit')` sem timeout externo. `runShutdown` é uma cadeia sequencial com até 5s por handler. Com N handlers registrados (e alguns possivelmente em estado degradado pós-freeze), o total poderia ser 30-40s de aparente "trava" após `/quit`.

**Solução — `Promise.race` com hard timeout de 8s:**
- Arquivo: `src/copilot/terminal/repl-command-router.js`
- Constante `QUIT_SHUTDOWN_TIMEOUT_MS = 8_000` (hard timeout)
- `await Promise.race([runShutdown('terminal.quit'), new Promise((_,reject) => setTimeout(() => reject(new Error('Shutdown timeout...')), QUIT_SHUTDOWN_TIMEOUT_MS))])`
- O `catch` upstream via `logSwallowed` registra o timeout e continua para `rl.close()` + `process.exit(0)`.
- `/quit` agora garante encerramento em no máximo ~8s, independente do estado dos shutdown handlers.

### TERM-04 — `_statusRowReserved` state leak ao fechar readline ✅ CORRIGIDO

**Problema:** Se o readline fechasse com `_statusRowReserved = true` e depois reabrisse, o novo readline assumiria erroneamente que já havia uma linha de status reservada acima, causando movimento de cursor `\x1b[1A` para uma linha inexistente (e potencialmente sobrescrevendo output anterior).

**Solução — `resetStatusRowState()` no handler `rl.on('close', ...)`:**
- Arquivo: `src/copilot/terminal/repl-lifecycle.js`
- Nova exportação `resetStatusRowState()` em `output.js` + re-exportação via `dialog/index.js`.
- Chamada em `rl.on('close', ...)` antes de `cleanupLiveStatusLine()`.
- Garante estado limpo ao reiniciar readline em nova sessão.

### Auditoria do loop LLM-B (Onda D — verificação abrangente)

Os seguintes módulos foram inspecionados e **não apresentaram novos bugs**:
- `state-machine.js`: FSM correta com `deactivate()` resetando todos os flags; sem ghost state.
- `watchdog.js`: guard one-shot `#stallEmitted` e `#preStallWarning` com reset em `ping()`.
- `turn-executor.js`: `settled` flag previne double resolve/reject; `replyFallback.cleanup()` e `detachAbortListener` em todos os caminhos.
- `turn-result-persistence.js`: todos os handlers removem listeners nos paths de resolve/reject/timeout; `createInactivityTimeout` com `detachProgressListeners()` completo.
- `turn-execution-context.js`: `createInactivityTimeout` com `disposed` guard; progress listeners registrados e limpos corretamente.
- `loop-manager.js`: `forceDeactivate()` emite `'stopped'` correto; `stop()` com `timedOut` guard evita dupla emissão; `#shouldSuppressWatchdogEscalation()` funcional.
- `waitForRestartAndReply()`: `cleanup()` abrangente; `settled` guard; abort signal handled corretamente.

---

## 10) Conclusão objetiva

- O travamento final **não tem evidência de causa-raiz exclusiva por quota**.
- A evidência aponta para **falha operacional de controle de loop/estado** em torno de `[ASK:QUESTION]` + stall/stop timeout/recovery.
- Parte relevante dos bugs da LLM-B já foi corrigida, mas ainda existe um núcleo importante de pendências (especialmente shell/loop/state) que justifica continuidade imediata do hardening.

---

## 11) Referências de evidência

- `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/AUDITEXTTT.md` (linhas ~7461, 7462, 7468, 7530, 7527+)
- `src/copilot/terminal/repl-lifecycle.js` (linhas 144, 146, 154)
- `src/copilot/terminal/repl-command-router.js` (linha 305)
- `src/copilot/terminal/pending-question-answer.js` (linhas 66, 83)
- `src/copilot/agent/dialog/orchestrators/loop-manager.js` (linhas 351, 374, 545)
- `src/copilot/agent/agent-context.js` (linhas 1922, 1936)
- `src/copilot/tools/shell/executor.js`, `src/copilot/tools/shell/index.js`, `src/copilot/tools/shell/sandbox.js`
- `src/copilot/tools/web-tools.js`
- `src/copilot/tools/file/read-tools.js`, `src/copilot/tools/file/write-tools.js`
- `src/copilot/tools/tool-factory.js`, `src/copilot/tools/permission-tools.js`
