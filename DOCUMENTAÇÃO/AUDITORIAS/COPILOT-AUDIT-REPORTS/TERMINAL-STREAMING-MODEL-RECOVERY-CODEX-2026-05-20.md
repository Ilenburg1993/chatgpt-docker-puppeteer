# Terminal LLM-B: streaming, modelo, sessão e recuperação

Data: 2026-05-20  
Escopo: `src/copilot`, com foco em `src/copilot/terminal` e integrações diretas com runtime, SDK, SSE, ferramentas, `ask_user`, elicitation, transcript e observabilidade.

Este documento substitui a versão incremental anterior por uma trilha mais sóbria: o objetivo é registrar o estado real, separar achados validados de hipóteses externas, definir a situação ideal e manter um roadmap executável por faixas, fases e subfases.

## Critério De Autoridade

A auditoria externa recebida é útil como lista de hipóteses, mas não é autoridade. A autoridade é o código atual, os testes, o comportamento live do `terminal:llm-b` e o pacote local instalado.

Verificações realizadas nesta revisão:

- SDK local: `@github/copilot-sdk@0.3.0`.
- O SDK expõe eventos `assistant.streaming_delta`, `assistant.message_delta`, `assistant.reasoning_delta`, `user_input.*`, `elicitation.*`, `tool_execution.*`, `session.usage_info` e `assistant.usage`.
- O README do SDK 0.3.0 documenta `assistant.message_delta`, `onUserInputRequest`, `onElicitationRequest` e `includeSubAgentStreamingEvents`.
- A documentação oficial de BYOK do GitHub Copilot SDK confirma o contrato `provider` por sessão, `model` explícito, `ProviderConfig`, `wireApi`, Ollama local via OpenAI-compatible e `onListModels` customizado: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/bring-your-own-key>.
- Não há `session.keepAlive` nem `session.updateMetadata` no pacote instalado. Qualquer roadmap que use esses nomes deve ser tratado como adaptação futura, não como API disponível.
- `session.usage`, `assistant.usage` e `session.usage_info` não equivalem automaticamente a Premium Request consumido. A UX deve distinguir "uso do turno", "tokens/contexto/custo reportado" e "premium request confirmada".

## Situação Atual

O terminal já evoluiu bastante desde os primeiros bugs de tela preta e deltas ausentes.

Componentes já existentes e relevantes:

- `broadcastSse()` é o ponto único de fanout público de eventos do terminal.
- Existe arquivo durável JSONL de eventos SSE em `src/copilot/terminal/state/sse-event-archive.js`.
- O comando `/events` consulta a trilha durável por `event`, `traceId`, `turnId`, `source`, `toolCallId`, `requestId` e `hubSessionId`, com formatos humano, `--json` e `--raw`.
- O runner `scripts/copilot/run-terminal-llm-b-live-test.mjs` já coleta terminal PTY, SSE HTTP, `/events`, `/events --raw` e artefatos JSON para regressão live.
- O terminal já materializa ferramentas, I/O real, intents, mensagens públicas, deltas finais e eventos de turno em timeline.
- O arquivo de replay SSE tem `eventId` monotônico, replay básico e integração com `/metrics`.
- A UX já possui comandos de diagnóstico: `/activity`, `/live`, `/health`, `/events`, `/tools`, `/errors`, `/audit`, `/usage`, `/thinking`, `/intent`.
- O fluxo `ask_user` está integrado via handler do SDK e não deve ser tratado como consumo de Premium Request por definição operacional.

Ainda assim, há problemas relevantes.

## Mapa De Emissores Concorrentes

Esta é a raiz das duplicações observadas no terminal.

Fluxo real validado:

1. O SDK local emite eventos de sessão: `assistant.message_delta`, `assistant.streaming_delta`, `assistant.message`, `user_input.requested`, `tool_execution.*`, `session.usage_info` e correlatos.
2. `src/copilot/event-handlers/streaming.js` adapta `assistant.message_delta`:
   - se o dialog loop está ativo, emite `dialog.delta`;
   - se o agente está fora de um turno explícito e não está processando, emite `task.delta`;
   - se está processando por outro caminho, pode não emitir para evitar eco.
3. `src/copilot/agent/messaging/agent-messaging.js` também observa a sessão SDK enquanto aguarda idle e preserva o último `assistant.message` para resolver tasks.
4. `src/copilot/terminal/events/sdk-session-events.js` observa eventos SDK brutos para apresentar `assistant.message`, `user_input.requested`, permissions, elicitation e usage.
5. `src/copilot/terminal/events/agent-runtime-events.js` observa eventos do runtime/agente, incluindo `question.pending`, `dialog.*`, background, PR/usage e recuperação.
6. `src/copilot/terminal/events/task-stream-events.js` observa `task.delta` para materializar transcript quando não há turno explícito vivo.
7. `broadcastSse()` fanouta qualquer evento público para PTY/HTTP/SSE/JSONL/Socket.io.

Contrato canônico decidido nesta revisão:

- Texto público do turno explícito: `dialog.delta` é a fonte visual canônica; `task.delta` é somente fallback para fluxos sem dialog loop.
- Mensagem final: `assistant.message` é fonte de arquivo/evento, mas não fonte visual se o turno já foi materializado por delta ou reply direto equivalente.
- Pergunta ao usuário: `user_input.requested` é a fonte visual canônica; `question.pending` é estado/replay.
- Tools: `tool.lifecycle` deve ser o evento público canônico; eventos SDK/local antigos só podem existir como adaptadores com `source` explícito.
- SSE/JSONL: `broadcastSse()` é o ponto único de fanout público e arquivo durável. Qualquer evento público fora dele é bug arquitetural.
- Compatibilidade/fallback só é aceitável com dono, condição de ativação, métrica e plano de remoção. Fallback silencioso é dívida arquitetural.

## Achados Validados

### A1. `wireRuntime()` não era aguardado no boot

O arquivo `src/copilot/terminal/runtime-root.js` executava `ctx.wireRuntime()` sem `await` em `runTerminalRuntimeConfigPhase()`. Se a fiação do runtime for assíncrona, fases seguintes podem iniciar antes do runtime estar pronto.

Status: corrigido nesta revisão.  
Impacto: reduz corrida entre boot, listeners, SSE, terminal prompt e estado SDK.

### A2. Reflection loop tolerava mal falhas síncronas

`boot-reflection-loop.js` capturava apenas rejeição assíncrona de `sendTurnFn(...).catch(...)`. Falhas síncronas em `readTerminalRuntimeStateFn()` ou `sendTurnFn()` podiam escapar do timer periódico.

Status: corrigido nesta revisão.  
Impacto: evita quebra silenciosa ou ruído de unhandled exception em Node 24+.

### A3. SIGHUP precisava de política explícita

`boot-listeners.js` registrava handler de `SIGHUP` sem explicitar que o sinal tem semântica operacional confiável no POSIX, mas não no Windows.

Status: corrigido nesta revisão com helper `shouldRegisterTerminalSighupHandler()`.  
Impacto: boot menos ambíguo, mais portável e testável.

### A4. `session.usage` era apresentado com ambiguidade

A UX usa mensagens como "uso do turno contabilizado" e "custo", mas operadores tendem a ler isso como "Premium Request consumida". Isso é conceitualmente perigoso.

Status: parcialmente tratado antes; wording principal corrigido nesta revisão.  
Regra canônica: o terminal só pode afirmar PR consumida quando houver métrica/fonte que confirme PR. Caso contrário, deve dizer "uso SDK/tokens/custo reportado".

### A5. Modelo configurado, modelo efetivo e modelo cobrado ainda precisam de linha única

O terminal pode mostrar `auto`, preferência local, modelo efetivo observado e override manual. Quando o SDK roteia para outro modelo, a UX precisa explicar sem parecer bug.

Status: parcialmente tratado.  
Falta: contrato único de exibição e persistência: `configuredModel`, `preferredModel`, `effectiveModel`, `billingModel`, `routingReason`.

### A6. Deltas parciais precisam de teste live canônico mais forte

O terminal já expõe eventos de delta e arquivo durável, mas ainda precisamos de uma prova live padronizada que compare:

- delta parcial visto no PTY;
- delta público arquivado em JSONL;
- delta recebido por SSE HTTP;
- mensagem final renderizada;
- transcript final persistido;
- ausência de duplicação indevida.

Status: parcialmente implementado com `/events --raw`; falta cenário live mais exigente.

### A7. Tool timeline ainda deve convergir com eventos SDK 0.3.0

O SDK 0.3.0 expõe eventos de tool mais ricos que a UX deve traduzir de modo canônico. A mensagem "tool unknown" continua sendo sintoma de normalização incompleta.

Status: parcialmente corrigido nesta revisão: nomes genéricos do SDK agora cedem a fallback/payload real na camada canônica de apresentação.  
Critério: toda tool deve ter `name`, `phase`, `callId`, `source`, `startedAt`, `finishedAt`, duração, status, I/O associado e erro normalizado quando houver.

### A8. `ask_user`, user prompt e elicitation precisam de suíte ponta a ponta

O SDK tem `onUserInputRequest` e `onElicitationRequest`. O terminal deve registrar:

- pedido ao usuário;
- schema/campos quando for elicitation;
- resposta do usuário;
- correlação com turno;
- continuidade do transcript;
- ausência de eco duplicado;
- timeout/cancelamento/declínio.

Status: parcialmente implementado; falta teste live canônico e arquivo de evidência.

### A9. Boot degraded ainda é ruidoso demais

O auto-brief inicial pode dizer que tools estão indisponíveis antes de o registry terminar de subir. Isso é tecnicamente explicável, mas confunde o operador.

Status: aberto.  
Critério: boot deve separar `boot:partial`, `ready:canonical`, `degraded:real`, e nunca apresentar estado transitório como diagnóstico final.

### A10. Documento anterior era útil, mas acumulativo demais

O roadmap anterior misturava histórico, itens já feitos, hipóteses rejeitadas e próximos passos. Isso reduzia valor operacional.

Status: corrigido por esta reconstrução.

### A11. Teste live 2026-05-20 confirmou duplicação por fontes concorrentes

Artefatos: `artifacts/terminal-live/ask-user-duplication-codex-2026-05-20/`.

O cenário PTY acionou `report_intent`, `read_file_content`, deltas `DELTA-CANONICAL-1..8`, `ask_user`, resposta humana `SIM`, `/activity`, `/tools diag`, `/events`, `/errors`, `/health` e `/export`.

Achados confirmados:

- `ask_user` aparecia duas vezes: `question.pending` local imprimia `[QUESTION] LLM-B perguntou...` e, milissegundos depois, `user_input.requested` do SDK imprimia `[ASK] ...`.
- A resposta final após `ask_user` aparecia duas vezes: deltas `terminal-turn-display/delta` já materializavam o texto, mas `sdk/assistant.message` abria um segundo bloco visual idêntico.
- O fluxo de delta tinha duas fontes: `dialog.delta` e `task.delta`. A origem é a fiação simultânea do stream SDK pelo handler de streaming do dialog loop e pelo caminho de task interno em `agent/messaging/agent-messaging.js`.

Status: corrigido e reexecutado nesta revisão.
Regra nova: `user_input.requested` é a apresentação canônica de `ask_user`; `question.pending` fica como sinal de estado/replay. `dialog.delta` é a fonte canônica quando presente; `task.delta` é fallback. `assistant.message` continua arquivado em SSE, mas não reabre bloco visual quando o turno/delta já materializou conteúdo equivalente.

Artefatos pós-correção: `artifacts/terminal-live/ask-user-duplication-codex-2026-05-20-rerun/`.

Resultado pós-correção:

- `ask_user` apareceu uma vez no PTY: `sdk=yes question.pending=no`.
- A resposta final não apareceu simultaneamente como bloco vivo e bloco `assistant.message`.
- A timeline de deltas deixou de registrar `task.delta` como fonte paralela suprimida após `dialog.delta`.
- O runner passou a tratar essas três propriedades como critérios explícitos: `ask-user-single-source`, `no-final-delta-duplication` e `no-parallel-task-delta-after-dialog`.

### A12. `agent:emitter:error [object Object]` precisava normalização

O teste live registrou um erro recuperável de modelo durante retry, mas o error tracker apresentou `[object Object]`. Isso não é aceitável como diagnóstico operacional.

Status: corrigido na normalização central e coberto por teste unitário.
Critério: qualquer erro de hook/session/model deve ser normalizado com `name`, `message`, `code`, `event`, `source`, `recoverable`, `traceId` e causa resumida.

### A13. Auditoria externa 2 validou riscos reais em `terminal/dialog`

Arquivo lido integralmente: `src/DOCUMENTAÇÃO/COPILOT/AUDIT_EXTERNA_2.md`.

Validação crítica:

- Aceito: `dialog-runtime.js` cacheava promise de import rejeitada, impedindo retry sem restart.
- Aceito: `turn-display.js` dependia do footer normal para liberar render lock; erro no SDK após início de streaming poderia deixar lock preso.
- Aceito: deltas do modelo eram escritos com `writeTerminalRaw()` sem sanitização completa de ANSI/OSC.
- Aceito: `sse.js` usava `JSON.stringify()` direto e truncava apenas `content`, não payloads aninhados, `chunk`, BigInt ou ciclos.
- Aceito: `engine-persistence.js` não contabilizava falha de `writeTurn()` e descartava notificação pendente silenciosamente quando a fila enchia.
- Aceito: `turn-reconciliation.js` calculava sufixo a partir do texto normalizado e podia perder Markdown/quebras de linha.
- Rejeitado como prioridade atual: trocar a suíte consolidada para `node:test`; Vitest segue canônico para `src/copilot`.
- Rejeitado como API local atual: `session.keepAlive` e `session.updateMetadata`; não existem no pacote `@github/copilot-sdk@0.3.0` instalado.
- Reclassificado: `Symbol.dispose`, permission model do Node e `SessionFsProvider` são diretrizes seletivas, não mudanças globais imediatas.

Status: incorporado ao roadmap canônico, com P0 aplicado nesta revisão para os itens aceitos acima.

### A14. Diálogo P0 endurecido contra falhas de runtime longo

Status: implementado nesta revisão.

Mudanças aplicadas:

- `dialog-runtime.js` reseta `_engineModulePromise` e `_engineModule` se o import lazy falhar, permitindo retry real.
- `getDialogRuntimeLoadState()` expõe `loaded`, `importInFlight` e `turnQueueDepth:null` quando a fila ainda não é conhecida.
- `turn-display.js` ganhou sanitização terminal-safe para CSI/OSC/DCS/APC/controles antes de renderizar chunks.
- `releaseDisplayState()` libera lock e flush pendente mesmo em erro; `engine.js` chama no `finally`.
- `sse.js` normaliza payloads recursivamente, converte BigInt, corta strings gigantes, substitui ciclos e isola falhas de archive/fanout.
- `writeSseEvent()` passa a tratar backpressure básico: `client.write() === false` remove cliente lento.
- `engine-persistence.js` contabiliza falhas de write, loga descartes por fila cheia e não deixa fallback de leitura derrubar enqueue.
- `turn-reconciliation.js` preserva sufixo bruto original quando stream parcial é completado pela mensagem final.

### A15. `report_intent` tinha três rotas visuais equivalentes

O live test e os logs longos mostraram a mesma intenção aparecendo por `sdk/assistant.intent`, `tool/report_intent` e `tool/report_intent_local`. A causa não era uma única chamada duplicada, mas três adaptadores legítimos promovendo o mesmo payload sem chave semântica comum.

Status: corrigido nesta revisão.

Decisão canônica:

- A identidade visual de uma intenção é o texto normalizado e o risco, não `source`, `toolCallId` ou alias da tool.
- `source` e `toolCallId` continuam sendo envelope de auditoria, mas não podem multiplicar a UX.
- Quando a mesma intenção chega por rotas equivalentes dentro da janela TTL, apenas a primeira materialização visual entra na timeline/transcript.

### A16. O live runner interferia na continuação pós-`ask_user`

O artefato `artifacts/terminal-live/2026-05-20T18-24-53-129Z/` mostrou `user_input.completed`, `assistant.turn_end` e `assistant.turn_start` para `turn:2`, mas o runner disparava `/usage`, `/activity`, `/events`, `/export` e `/quit` logo após "Resposta enviada para pergunta pendente". Isso criava falso negativo para a continuação pós-`ask_user` e podia competir com a própria materialização do turno.

Status: corrigido parcialmente nesta revisão.

Mudanças:

- O prompt canônico agora exige uma fala pública pós-`ask_user` com marcador `POST-ASK-CANONICAL-FINAL`.
- O runner espera a continuação pós-ask ou uma janela explícita antes dos comandos diagnósticos.
- O runner reconhece erro terminal de sessão/modelo e encerra diagnóstico cedo em vez de aguardar timeout opaco.

Status atualizado em 2026-05-21: corrigido e validado.

Validação:

- Artefato: `artifacts/terminal-live/2026-05-21T10-22-43-042Z/summary.md`.
- Resultado: PASS.
- O runner observou deltas parciais, bloco final, tools, `ask_user`, resposta humana, continuação pós-`ask_user`, `/usage now`, `/activity`, `/tools diag`, `/events`, `/events --raw`, `/errors`, `/health`, `/export`, SSE HTTP e JSONL durável.
- O falso negativo anterior vinha do próprio harness: ele procurava o marcador pós-ask no log inteiro, onde o texto já existia no prompt. A checagem agora observa apenas o trecho posterior à resposta humana.

### A17. Erro recuperável de modelo escalou para `reconnect_restart` com nova ambiguidade

Artefato: `artifacts/terminal-live/canonical-flow-codex-post-ask-continuation-2026-05-20/`.

A rodada live posterior falhou antes de `ask_user`: o SDK reportou várias vezes `errorOccurred` com `errorContext=model_call`, `recoverable=true`, mas o payload de erro chegou como `{}`. Após retries, a sessão terminou com `CAPIError: Connection error`, o dialog loop emitiu `reconnect_restart`, e o terminal bloqueou restart automático.

Achados:

- A normalização central já evita `[object Object]`, mas a informação útil do SDK ainda pode chegar vazia no hook e só aparecer no erro final.
- Após `session.error`, houve nova sequência `userPromptSubmitted`/`sessionStart` com o mesmo prompt inicial, o que precisa ser auditado para garantir que recuperação não reenvie prompt sem intenção explícita do operador.
- O live runner antigo deixava o processo até timeout; agora reconhece falha de sessão e captura `/activity`, `/events --raw` e `/errors`.

Status: parcialmente corrigido após o commit `cdab72e0`.

Correção estrutural iniciada:

- Tasks do agente agora possuem `origin`.
- `sendMessageDialogBoot()` marca tasks como `dialog_boot`.
- Após uma reconexão bem-sucedida causada por erro de sessão/modelo, uma task `dialog_boot` não é reenfileirada automaticamente.
- Em vez de reenviar o mesmo prompt, o executor rejeita a task com erro explícito e emite `task.error` com `requeueBlocked=true`.
- O terminal agora transforma `reconnect_restart` em mensagem operacional explícita: reconexão concluída, prompt preservado e replay automático bloqueado.
- `task.error` com `requeueBlocked=true` deixa de parecer uma falha genérica e passa a informar que o prompt ficou preservado sem reenvio automático.

Isso evita o pior comportamento: reenvio silencioso do prompt do operador após uma queda/reconexão no meio do turno.

Critério ideal:

- `recoverable=true` deve aparecer como retry em andamento, com contador, request id e próximo passo.
- `session.error` final deve encerrar claramente o turno, preservar prompt e não reenviar automaticamente sem política explícita.
- `reconnect_restart` deve indicar se houve retry zero-PR, restart bloqueado, ou necessidade de `/dialog-resume`.

### A18. Porta fixa 3009 derrubava o boot quando sobrava inject server anterior

Evidência live:

- O runner canônico falhou antes da LLM-B com `listen EADDRINUSE: address already in use 127.0.0.1:3009`.
- Isso é coerente com a própria UX de saída: `readline fechado. Inject server continua ativo`.
- O problema não era streaming, mas boot frágil: uma instância anterior deixava a porta ocupada e a nova sessão morria antes de expor `/events`, `/activity` ou diagnóstico útil.

Correção implementada:

- `startCopilotServer()` agora retorna a porta efetiva do `http.Server`, inclusive quando a porta solicitada é `0`.
- A fase `boot-http` tenta realocar para a próxima porta livre quando recebe `EADDRINUSE`, salvo `LLM_B_TERMINAL_PORT_STRICT=true`.
- O REPL, banner, auto-brief e comandos usam a porta efetiva do servidor, não a constante lida no import.
- O live runner escolhe porta livre antes de iniciar o terminal e propaga a mesma porta para o coletor SSE.

Validação live:

- `node scripts/copilot/run-terminal-llm-b-live-test.mjs --no-pr --timeout-ms=70000 --post-answer-delay-ms=1000`.
- Artefato: `artifacts/terminal-live/2026-05-20T18-55-53-045Z/summary.md`.
- Resultado: PASS; terminal subiu em `3010` com `3009` ocupada, `/events` funcionou e nenhum turno explícito foi aberto.

### A19. `task.delta` público ainda podia duplicar o `assistant.message` final

Evidência:

- A sessão live mostrou blocos em que um delta público aparecia primeiro e, em seguida, a mesma mensagem final era emitida por `sdk/assistant.message`.
- A rota de `dialog.delta` do turno explícito já tinha reconciliação de sufixo, mas a rota pública fora de turno (`task.delta` quando `getBusy() === false`) apenas renderizava e finalizava footer.
- Ao finalizar esse stream público, o estado global não registrava materialização concluída com o texto bruto já exibido. Assim, uma mensagem final maior que o prefixo podia abrir outro bloco inteiro.

Correção implementada:

- `turn-materialization-state.js` passou a reconhecer `public-assistant-stream` como fonte de materialização.
- O estado recente agora guarda também `reply` e `deltaText` brutos, não apenas texto normalizado.
- Foi criada a decisão canônica `getTerminalAssistantMessageMaterializationDecision()`, com três saídas: `suppress`, `render_suffix` e `render_full`.
- `public-assistant-stream.finalizePublicAssistantStream()` agora conclui a materialização pública e reivindica o transcript já exibido.
- `sdk-session-events.onAssistantMessage()` deixou de fazer apenas boolean dedupe: agora renderiza somente o sufixo faltante quando o delta público já exibiu o prefixo.

Critério ideal:

- Delta público parcial deve continuar visível imediatamente.
- Mensagem final equivalente deve ser suprimida.
- Mensagem final que apenas completa o delta deve renderizar só o complemento.
- Mensagem final divergente deve renderizar completa, com diagnóstico de mismatch.

### A20. Live completo bloqueado por rate limit precisa virar diagnóstico de causa raiz

Evidência:

- Rodada live `artifacts/terminal-live/2026-05-20T19-05-51-881Z/summary.md` subiu o terminal, conectou SSE e enviou o cenário canônico.
- Antes de qualquer tool, delta ou `ask_user`, o SDK retornou: `You've hit your rate limit... reset in 1 hour 51 minutes`.
- O runner antigo marcou dezenas de critérios como falha (`partial-deltas`, `ask-user-visible`, `export-*`, etc.), embora a causa primária fosse indisponibilidade externa do SDK.

Correção implementada:

- O live runner agora detecta blocker `sdk-rate-limit`.
- Quando há blocker, o summary passa a ter status `BLOCKED`, registra request/reset quando disponíveis, e troca a cascata de falsos negativos por critérios mínimos: terminal pronto, REPL, SSE conectado e causa raiz.
- O runner também encerra cedo ao ver `Erro de sessão [rate_limit]`, capturando `/activity`, `/events --raw` e `/errors` em vez de aguardar timeout longo.
- Isso não valida o fluxo de delta/tool/ask_user; apenas impede que indisponibilidade externa seja confundida com regressão de UX.

Critério ideal:

- Falhas externas recuperáveis ou temporárias devem ser classificadas como `BLOCKED`, não como `FAIL` de todos os critérios downstream.
- Quando o SDK voltar a responder, o mesmo runner deve executar o cenário completo sem exigir mudanças manuais.

### A21. `/usage now` confundia snapshot histórico com consumo atual

Evidência:

- Em live `--no-pr` e no boot bloqueado por rate limit, `/usage now` imprimia `Última Premium Request classificada` mesmo antes de qualquer turno funcional do probe atual.
- O dado vinha de `lastPrInfo`, isto é, último snapshot registrado no runtime, não uma confirmação de consumo no boot atual.

Correção implementada:

- A mensagem passou a ser `Última telemetria PR classificada` e inclui nota explícita: `histórica; não implica consumo neste boot/probe`.
- `/metrics` passou a usar `telemetria PR ... (histórica)` em vez de `último PR`, evitando sugerir consumo atual durante boot/probe.
- Quando não há snapshot, o texto agora fala em `sem snapshot histórico classificado`.
- A telemetria `llm.usage` com `premiumRequest=true` passou a dizer `Premium Request nesta telemetria`, separando evento atual de registro histórico.

Critério ideal:

- O operador deve conseguir distinguir histórico persistido, telemetria do turno atual e Premium Request efetivamente classificada.
- Nenhum comando deve sugerir consumo atual sem evidência causal do turno/probe corrente.

### A22. `dialog.loop.changed` podia aparecer duplicado como evento público equivalente

Evidência:

- O boot/resume pode emitir `dialog.loop.changed active=true` por caminhos legítimos próximos: start normal do controller, idempotência `ready_already_waiting` e restauração de sessão.
- A duplicação não indica necessariamente bug no agente, mas no terminal ela aparece como duas mudanças públicas de estado idênticas.

Correção implementada:

- `terminal-agent-wiring.js` ganhou dedupe de borda para `dialog.loop.changed` equivalente dentro de janela curta.
- Mudanças reais de estado (`true -> false`, `false -> true`) continuam passando.
- Reemissões idempotentes são registradas como atividade interna suprimida, sem fanout SSE/UX duplicado.

Critério ideal:

- O lifecycle pode ser idempotente internamente, mas o terminal deve expor apenas transições de estado úteis ao operador.

### A23. Rate limit e retries recuperáveis ainda geravam ruído em `/errors`

Evidência desta rodada:

- Live completo: `artifacts/terminal-live/codex-continue-2026-05-20-full/summary.md`.
- Resultado: `BLOCKED` por `sdk-rate-limit`, com terminal pronto e SSE conectado, antes de qualquer delta/tool/`ask_user`.
- Durante o bloqueio, `/errors` listava várias entradas equivalentes: `agent:emitter:error` para retries recuperáveis de `model_call`, `sdk:session.error` para rate limit, `event-bus` para `agent:task:error`, `agent:task:error` com o mesmo rate limit e `swallowed:agent.backpressure.mutex`.
- Isso mascarava a causa raiz: um bloqueio externo do SDK, não cinco falhas independentes do terminal.

Correção implementada nesta rodada:

- `agent.error` recuperável de `model_call` continua auditável no stream público, mas não entra mais em `/errors` como erro operacional vermelho.
- `error-alerter` deixou de criar entrada sintética `event-bus` para `agent:task:error`, pois o erro causal pertence ao handler da task ou a `session.error`.
- `task.error` de rate limit deixou de duplicar `session.error` no `ErrorTracker`; a métrica da task continua sendo contabilizada.
- `task-stream-events` deixou de narrar `Tarefa interna falhou · 0 chunks` quando o evento causal já é um rate limit canônico de sessão.
- `toError()` passou a preservar `errorMessage` e `detail` de objetos SDK antes de cair em JSON bruto.

Validação:

- Sonda sem PR pós-correção: `artifacts/terminal-live/codex-continue-2026-05-20-no-pr-rerun/summary.md`.
- Resultado: `PASS`, sem turno explícito, sem tools, sem erros, com `/usage now`, `/activity`, `/metrics`, `/events`, `/events --raw` e `/errors`.
- O cenário funcional completo segue bloqueado por rate limit externo até reset do SDK; isso não valida delta/tool/ask_user nesta rodada.

### A24. Fiação do runtime precisava de evento próprio no fluxo público

Evidência:

- O roadmap já apontava `terminal.runtime.wired` e falha de fase como pendentes.
- `runTerminalRuntimeConfigPhase()` aguardava `wireRuntime()`, mas a conclusão da fase ficava implícita em atividade/log. Em caso de falha, o operador dependia de erro genérico do boot.

Correção implementada nesta rodada:

- `runtime-root.js` passou a emitir `terminal.runtime.wired` com `phase=runtime-config`, duração, `preflightOk` e timestamp.
- Falhas de `wireRuntime()` agora emitem `terminal.runtime.wire_failed` com erro normalizado, registram atividade terminal de erro e relançam a falha para o lifecycle.
- A política `/events sources` foi atualizada para classificar esses eventos dentro de `terminal.lifecycle`.
- Testes unitários cobrem sucesso e falha da fiação do runtime.

Critério ideal:

- Toda fase crítica de boot deve ter start/success/failure auditável por `/events`, e não apenas por log lateral.

### A25. BYOK existia como builder, mas não como fluxo operacional completo

Investigação:

- `src/copilot/sdk/session/provider.js` já possuía builders `openaiProvider`, `azureProvider` e `anthropicProvider`.
- `SessionConfigBuilder` e `ResumeSessionConfigBuilder` já aceitavam `provider`.
- Rotas SDK aceitavam `provider` no body.
- Faltava o caminho canônico do terminal: env seguro -> provider validado -> sessão persistente -> lista de modelos -> UX -> documentação -> testes.

Decisão canônica:

- BYOK usa exclusivamente o campo `provider` nativo do SDK. Não há loop paralelo de LLM no terminal.
- `COPILOT_BYOK_ENABLED=true` é a chave de ativação operacional. Ter uma API key no ambiente não deve ativar BYOK por acidente.
- `COPILOT_BYOK_MODEL` é obrigatório quando BYOK está ativo; `model=auto` não é válido para provider customizado. Quando `COPILOT_BYOK_PROFILE` está ativo, o modelo pode vir do perfil.
- `.env.local` é o arquivo único do operador para perfis, metadata e segredos BYOK. Templates versionados só mostram contrato e exemplos sem segredo.
- Segredos nunca entram em boot config, `/config`, `/byok`, JSONL, docs ou commits. A UX só mostra presença de `apiKey`, `bearerToken` ou headers.
- Providers fora do trio nativo do SDK (`openai`, `azure`, `anthropic`) entram por endpoint OpenAI-compatible: Kilo Gateway, Ollama local/cloud, LiteLLM, vLLM, Foundry Local, routers e proxies internos.

Status: implementação operacional consolidada em fluxo único, com perfis e Kilo Gateway, validada por testes determinísticos nesta revisão.

Entregas:

- Leitura segura de `COPILOT_BYOK_*`, `OPENAI_*`, `AZURE_OPENAI_*`, `ANTHROPIC_*`, `OLLAMA_*` e `KILO_*`.
- Perfis declarativos via `COPILOT_BYOK_PROFILES_JSON` e seleção por `COPILOT_BYOK_PROFILE`.
- Presets `kilo-code`, `kilo-gateway` e `kilo` resolvem Kilo Gateway como OpenAI-compatible com Bearer token.
- Redaction canônica de provider.
- `onListModels` customizado quando BYOK está ativo, com descoberta automática de modelos e fallback estático.
- Sessões do agente recebem `provider`, modelo explícito e `modelCapabilities`.
- `/byok` mostra status, modelos descobertos, perfis, recarga de `.env.local` e troca efêmera de SDK/perfil/modelo/provider sem expor segredos.
- Templates e schema receberam knobs BYOK.

Falta:

- Elicitation real em BYOK, quando houver cenário confiável sem custo/risco operacional excessivo.
- Suíte determinística fake de sessão SDK BYOK end-to-end sem rede.
- Persistência opcional da escolha de perfil via comando seguro, caso o operador queira gravar alteração no `.env.local` em vez de apenas no processo atual.
- Ampliar smoke real remoto para mais providers OpenAI-compatible quando houver credenciais disponíveis.

Validação local:

- `typecheck:strict:src.copilot`: PASS.
- `lint:copilot`: PASS.
- `test:copilot:unit`: 2920 testes PASS.
- Smoke sem rede confirmou preset `ollama-local`, normalização `/v1`, modelo explícito e ausência de segredo.
- Testes unitários confirmaram preset Kilo Gateway, perfil ativo, resumo sem segredo e comandos `/byok profiles`, `/byok use`, `/byok model`.
- Testes unitários confirmaram descoberta remota OpenAI-compatible, cache, timeout/fallback e renderização de modelos descobertos em `/byok models`.
- Smoke real Kilo/Ollama Cloud passou em `artifacts/terminal-live/2026-05-21T12-12-19-528Z/summary.md`, com 9 segredos locais verificados contra output do terminal.
- Busca por fragmentos das chaves de teste fornecidas não encontrou vazamento em arquivos versionáveis fora de artefatos ignoráveis.

Observação de segurança:

- As chaves reais fornecidas para teste foram gravadas somente em `.env.local`, que é gitignored e é o arquivo único operacional definido para segredos/perfis BYOK. Elas não devem ser promovidas para `.env`, documentação, logs versionáveis ou commits.

### A26. Live completo 2026-05-21 validou o circuito canônico após BYOK

Artefato: `artifacts/terminal-live/2026-05-21T10-22-43-042Z/summary.md`.

Resultado: PASS.

Critérios relevantes:

- PTY interativo pronto.
- Deltas parciais visíveis: 30 marcadores `DELTA-CANONICAL`.
- Bloco final de delta visível sem duplicação.
- `read_file_content` renderizou start/done.
- `ask_user` apareceu uma única vez, pela fonte canônica `user_input.requested`.
- Resposta humana foi registrada e não virou eco da LLM-B.
- Continuação pós-`ask_user` apareceu por `assistant.message`.
- Telemetria `llm.usage` foi mostrada separada de Premium Request.
- `/events` e `/events --raw` consultaram o arquivo durável SSE.
- SSE HTTP e JSONL tiveram ids monotônicos e envelope `source/trace`.
- `/errors` permaneceu limpo.

Leitura arquitetural:

- O circuito atual está muito mais próximo do fluxo único: SDK events -> normalização/materialização -> `broadcastSse()` -> PTY/SSE/JSONL/export.
- Ainda há trabalho em elicitation e BYOK real smoke, mas a regressão crítica de duplicação de delta/ask_user foi coberta por teste live funcional.

### A27. BYOK precisava deixar de ser env plano e virar perfis operacionais

Investigação:

- Um único provider por env plano resolve o caso simples, mas é frágil para operação real: trocar SDK -> BYOK -> outro provider -> outro modelo exigia editar várias variáveis e reiniciar sem diagnóstico.
- A demanda atual inclui Kilo Code/Gateway, Ollama Cloud, LLM local e futuras rotas OpenAI-compatible. Isso exige perfis nomeados, metadata operacional e comandos explícitos.
- O pacote local do SDK continua recebendo apenas um `provider` por sessão; portanto, perfis são uma camada de resolução de configuração, não um segundo runtime.

Decisão canônica:

- `.env.local` é o arquivo único do operador.
- `COPILOT_BYOK_PROFILES_JSON` descreve todos os perfis BYOK.
- `COPILOT_BYOK_PROFILE` escolhe o perfil ativo.
- `/byok reload` recarrega `.env.local`; `/byok profiles` lista perfis redigidos; `/byok use <perfil|sdk>` alterna o processo atual; `/byok model <id>` troca modelo no provider ativo; `/byok provider <preset> [model] [baseUrl]` cobre investigação efêmera.
- `/byok models [refresh]` consulta automaticamente o catálogo do provider quando disponível; se falhar, cai para catálogo estático com aviso redigido.
- Kilo Gateway entra como OpenAI-compatible em `https://api.kilo.ai/api/gateway`, autenticado por Bearer token via `KILO_API_KEY` ou `KILO_CODE_API_KEY`.

Status: implementado nesta rodada.

Riscos remanescentes:

- Trocas por comando ainda são efêmeras; persistir em `.env.local` deve ser opt-in, atômico e redigido.
- Smoke real com chaves deve arquivar apenas metadados redigidos e nunca payloads completos.
- Precisamos confirmar, em live longo, se o SDK reporta `usage`/modelo efetivo de providers BYOK de maneira consistente com o provider selecionado.

### A28. Catálogo de modelos BYOK precisava ser automático, cacheado e não bloqueante

Investigação:

- O SDK 0.3.0 aceita `onListModels` assíncrono, então o catálogo BYOK não precisa ficar restrito a `COPILOT_BYOK_MODELS`.
- Providers OpenAI-compatible expõem, em geral, `GET /models` ou `GET /v1/models`, incluindo Kilo Gateway e Ollama OpenAI-compatible.
- Catálogo remoto não pode ser requisito duro de boot: provider pode estar offline, chave pode estar ausente, rede pode falhar, e ainda assim o terminal deve manter fallback estático acionável.

Decisão canônica:

- `discoverConfiguredByokModelsFromEnv()` é a porta assíncrona de descoberta.
- `readConfiguredByokModelsFromEnv()` permanece fallback estático determinístico.
- `buildConfiguredByokModelListHandler()` usa descoberta remota com fallback e retorna `Promise<ModelInfo[]>`, como permitido pelo SDK.
- `COPILOT_BYOK_MODELS_ENDPOINT` permite endpoint explícito.
- `COPILOT_BYOK_MODEL_DISCOVERY_ENABLED`, `COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS` e `COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS` controlam ativação, timeout e cache.
- `/byok models refresh` força nova consulta, sem imprimir headers ou tokens.

Status: implementado nesta rodada.

Validação:

- Typecheck strict PASS.
- Unit Copilot PASS com 2925 testes na rodada de descoberta; 2927 testes após a correção de prefixo truncado em `dialog.turn_end`.
- Smoke seguro com chave em `.env.local` confirmou descoberta Kilo real via provider, sem imprimir segredo no terminal ou no resumo.

### A29. `dialog.turn_end` podia renderizar prefixo truncado já coberto por `assistant.message`

Evidência:

- Live completo: `artifacts/terminal-live/2026-05-21T11-14-22-468Z/summary.md`.
- Resultado geral do runner: PASS.
- O mesmo artefato mostrou uma anomalia visual residual no PTY: `assistant.message` renderizou a resposta longa completa e, logo depois, `dialog.turn_end` abriu um bloco `Continuação da LLM-B` contendo apenas o prefixo truncado da mesma resposta.
- O JSONL público confirma a causa: `assistant.message` trouxe o conteúdo completo em `eventId=181`, enquanto `dialog.turn_end` trouxe `reply` truncado em `eventId=191`.

Diagnóstico:

- O runner não classificou como duplicação porque seus critérios olhavam os marcadores finais e não a relação "prefixo truncado já coberto por transcript recente".
- A reconciliação de materialização já suprimia conteúdo idêntico e alguns casos de delta, mas não cobria `entry.normalizedReply.includes(truncatedReply)`.
- O renderer persistente mantinha apenas hashes exatos, então não conseguia reconhecer que um prefixo longo já estava coberto por uma mensagem completa recém-renderizada.

Status: corrigido nesta revisão.

Regra nova:

- `dialog.turn_end` continua sendo evento público de auditoria/SSE.
- Ele só pode abrir bloco visual se ainda não houver materialização ou transcript recente cobrindo o texto.
- Prefixos truncados longos de uma mensagem já renderizada são reconciliados como "sem novo bloco visual".

Validação:

- Testes unitários adicionados em `test_turn_materialization_state.spec.js` e `test_assistant_transcript_renderer.spec.js`.
- O live runner agora possui o critério `no-truncated-turn-end-duplication`, cruzando eventos SSE/JSONL de `assistant.message` e `dialog.turn_end`.
- Rodada focada `npm run test:copilot:unit -- tests/unit/copilot/terminal/test_turn_materialization_state.spec.js tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js` passou com 2927 testes totais.

### A30. Live completo pode esgotar o orçamento antes da continuação pós-`ask_user`

Evidência:

- Live completo pós-A29: `artifacts/terminal-live/2026-05-21T11-26-10-340Z/summary.md`.
- O terminal subiu, SSE conectou, `report_intent` e `read_file_content` rodaram, `ask_user` apareceu uma única vez e a resposta humana `SIM` foi registrada.
- O modelo ficou mais de 190s sem saída pública incremental antes do `ask_user` e o runner atingiu o timeout antes da continuação `POST-ASK-CANONICAL-FINAL` e antes dos comandos diagnósticos `/events`, `/errors`, `/health` e `/export`.

Diagnóstico:

- Não houve evidência de duplicação, erro interno do terminal ou falha de `ask_user`.
- O summary anterior classificava em cascata como falha de delta/export/SSE archive, embora a causa primária fosse "cenário incompleto por timeout".

Status: mitigado no runner nesta revisão.

Regra nova:

- Quando o timeout do próprio runner dispara antes do fechamento do cenário, o resultado passa a ser blocker `live-timeout`, com detalhe sobre `ask`, `postAsk` e diagnósticos.
- Isso não transforma cenário incompleto em PASS; apenas evita misturar latência/timeout do SDK/modelo com regressão falsa de UX downstream.

### A31. BYOK real validou fluxo completo e expôs o último falso positivo do harness

Evidência:

- Smoke sem PR real: `artifacts/terminal-live/2026-05-21T12-02-58-405Z/summary.md`.
- Live real completo após correção de `dialog.turn_end`: `artifacts/terminal-live/2026-05-21T12-12-19-528Z/summary.md`.
- Live adicional após ativar `.env.local` local para `kilo`: `artifacts/terminal-live/2026-05-21T12-26-08-467Z/summary.md`.
- Tentativa com modelo pago/creditado: `artifacts/terminal-live/2026-05-21T12-03-39-776Z/summary.md`.

Achados:

- `.env.local` é o arquivo único operacional e gitignored para segredos/perfis BYOK; as chaves reais ficam ali, nunca em docs, commits ou artefatos versionáveis.
- Kilo Gateway/Kilo Code respondeu descoberta real de modelos via `https://api.kilo.ai/api/gateway/models`, com catálogo remoto de 346 modelos.
- Ollama Cloud foi exercitado como perfil alternativo no mesmo processo, com alternância de provider/modelo antes do turno funcional.
- O turno completo em `kilo-auto/free` passou com deltas parciais, bloco final, `report_intent`, `read_file_content`, `ask_user`, resposta humana `SIM`, continuação pós-ask, `/events`, `/events --raw`, `/health`, `/export`, SSE HTTP e JSONL durável.
- A telemetria do turno BYOK indicou `premiumRequest=false` e `classification=ask_user_continuation` na continuação pós-ask.
- O runner verificou ausência de vazamento de 9 valores secretos locais no output do terminal.
- O modelo `kilo-auto/balanced` retornou `402 Add credits to continue`; isso foi classificado como blocker externo `byok-provider-credits`, não como falha do terminal.
- O live anterior `artifacts/terminal-live/2026-05-21T12-09-42-449Z/summary.md` já mostrava `dialog.turn_end` com `reply=""` e `replySuppressed=true`, mas o runner ainda acusava duplicação porque a regex atravessava blocos do terminal.

Correções implementadas nesta revisão:

- `dialog.turn_end` agora preserva lifecycle em SSE/JSONL, mas remove `reply` quando o texto já foi materializado por `assistant.message` ou `dialog.delta`. O payload passa a trazer `replySuppressed=true`, `replySuppressionReason=already_materialized`, `originalReplyChars` e `transcriptCanonicalSource`.
- O live runner passou a analisar blocos reais do terminal para `🧠 LLM-B` e `[LLM-B] Mensagem`, eliminando falso positivo por janela textual que atravessava separadores.
- `/byok models` passou a limitar a listagem humana por padrão, mantendo `/byok models all` e `/byok models <n>` para inspeção ampla.
- O perfil local Kilo foi ajustado para `kilo-auto/free` como default de smoke real, preservando `kilo-auto/balanced` e outros modelos para alternância explícita.

Status: corrigido e validado.

Critério resultante:

- `dialog.turn_end` é evento de ciclo, não fonte concorrente de transcript.
- O runner só acusa duplicação quando o mesmo marcador aparece em dois blocos reais distintos, não quando uma regex cruza de um bloco para o próximo.
- BYOK real está comprovado no fluxo canônico do terminal; ainda falta elicitation real em BYOK.

### A32. BYOK precisava entrar no mapa de fontes públicas sem criar outro fanout

Achado:

- O BYOK já estava integrado ao SDK, aos comandos, à projeção de configuração, ao live runner e ao fluxo real de `ask_user`/deltas/tools, mas `/events sources` ainda não explicitava BYOK como superfície governada.
- Sem essa entrada, o operador via o BYOK em `/byok`, `/status` e `/health`, mas não no mapa de autoridade que explica quais fontes públicas podem emitir conteúdo, telemetria e estado.

Correção:

- Adicionada a política `byok.provider.config` em `TERMINAL_PUBLIC_STREAM_SOURCE_POLICIES`.
- A política deixa explícito que BYOK aceita `COPILOT_BYOK_*`, comandos `/byok`, descoberta de catálogo e projeções de provider, mas suprime segredo bruto, loops LLM paralelos e confirmação enganosa de troca de provider antes de restart/reattach.
- A correção não adiciona outro broadcast nem outro renderer. BYOK continua usando o fluxo único do SDK; `/events sources` apenas documenta e audita a autoridade existente.

Status: implementado nesta revisão.

### A33. `.env.local` precisava carregar antes das leituras estáticas do terminal

Achado:

- A permanência operacional de BYOK em `.env.local` só é confiável se o entrypoint carregar o arquivo antes de `readCopilotBootConfig()`, auto-brief, projeções e runtime wiring.
- O comando `/byok reload` resolvia o processo já em execução, mas não garantia que o próximo boot canônico partisse do arquivo local.

Correção:

- Criado `terminal/bootstrap-dotenv-loader.js`, testável, com `dotenv.config({ path: '.env.local', override: false, quiet: true })`.
- Criado `terminal/bootstrap-dotenv.js` como side-effect import precoce no topo de `terminal/bootstrap.js`.
- `override=false` preserva env explícito da task, shell ou harness; `.env.local` entra como default operacional do operador.
- `module-map.js` passou a registrar os novos módulos de boot.
- Probe sem PR confirmou auto-brief de boot e ready com BYOK `ready` vindo diretamente do `.env.local`: `artifacts/terminal-live/2026-05-21T12-30-28-011Z/summary.md`.

Status: implementado nesta revisão.

### A34. Permanência BYOK não podia depender de edição manual do operador

Achado:

- `/byok use`, `/byok model` e `/byok provider` eram intencionalmente efêmeros, bons para investigação dentro do processo atual, mas não davam um caminho seguro para gravar a escolha em `.env.local`.
- Isso deixava uma diferença confusa entre o boot do harness, comandos de runtime e o próximo boot real do operador.

Correção:

- Criado `/byok persist <sdk|profile <nome>|model <id>|provider <preset> [model] [baseUrl]>`.
- O comando grava apenas seletores não secretos, preserva segredos já existentes, usa escrita por arquivo temporário + rename e mantém permissão `0600`.
- `persist profile` ativa `COPILOT_BYOK_ENABLED=true` e `COPILOT_BYOK_PROFILE=<nome>`, removendo overrides conflitantes de modelo/provider.
- `persist sdk` desativa BYOK e remove seletores conflitantes para o próximo boot voltar ao SDK Copilot.
- Após gravar `.env.local` local com `COPILOT_BYOK_ENABLED=true` e `COPILOT_BYOK_PROFILE=kilo`, um novo live real PASS confirmou boot, deltas, tools, `ask_user`, resposta humana, continuação pós-ask, SSE/JSONL/export e ausência de duplicação.

Status: implementado nesta revisão.

### A35. Prompt vivo confundia telemetria histórica com identidade ativa do modelo

Achado:

- Após o boot persistente em BYOK, o auto-brief e `/metrics` já indicavam `kilo-auto/free`, mas o prompt ainda podia aparecer como `você[claude-haiku-4.5/high]›`.
- A causa era estrutural: `buildUserPrompt()` e `readTerminalDialogStreamMeta()` priorizavam `lastPrInfo.effectiveModel/model`, que é telemetria histórica de consumo/roteamento, antes de `state.model`, que é a configuração ativa do runtime.
- Isso não quebrava o roteamento BYOK, mas quebrava a UX: o operador parecia estar em outro modelo/provider, e a linha viva podia mascarar a diferença entre estado atual e auditoria de billing.

Correção:

- O prompt e a linha de espera passam a usar `state.model` como identidade canônica viva.
- `lastPrInfo` continua disponível para `/usage`, `/metrics`, `/status` e alertas de billing/roteamento, mas só gera tag `[MODEL-CHECK:cfg→observado]` no prompt quando a telemetria pertence ao mesmo modelo configurado atual.
- Telemetria antiga de outro modelo não contamina mais a identidade do prompt.
- Unit tests cobrem mismatch observado do modelo atual e ignoram mismatch histórico de outro modelo.
- Probe live sem PR confirmou o prompt correto `você[kilo-auto…/high]›` com BYOK persistido em `.env.local`: `artifacts/terminal-live/2026-05-21T12-34-44-644Z/summary.md`.

Status: implementado nesta revisão.

### A36. Usage BYOK ainda podia ser classificado como Premium Request

Achado:

- Após a correção do prompt ativo em BYOK, o live real completo passou, mas expôs uma ambiguidade residual de billing: a primeira telemetria `assistant.usage` de um turno BYOK acionado pelo usuário ainda podia aparecer como `[PR]` e ser classificada como `premium_request`.
- A causa era o classificador central de usage: qualquer `assistant.usage` imediatamente posterior a `user.message`, com `initiator=user`, era tratado como Premium Request, independentemente do provider ativo.
- Isso conflita com a regra operacional deste roadmap: BYOK usa provider customizado do operador e não deve ser narrado como consumo de Premium Request Copilot. `assistant.usage` em BYOK é telemetria LLM do provider, não prova de PR.

Correção:

- Sessões inicializadas com BYOK agora recebem projeção segura de provider em runtime: `__copilotByokEnabled`, provider redigido, perfil, preset e tipo.
- `normalizeAssistantUsageEvent()` propaga apenas metadados seguros (`byokProvider`, `byokProfile`, `byokPreset`, `byokProviderType`) para a telemetria.
- `createAssistantUsageClassifier()` ganhou a classificação `byok_user_message`, que consome o marcador pendente de mensagem humana sem emitir `pr.consumed` e sem atualizar `lastPrInfo`.
- O terminal passa a renderizar a telemetria como `[LLM] ... classe=byok_user_message`, mantendo `premiumRequest=false`.

Validação:

- Unit test cobre `user.message` seguido de `assistant.usage` em sessão BYOK e garante ausência de `pr.consumed`.
- Live real completo pós-correção: `artifacts/terminal-live/2026-05-21T12-40-35-670Z/summary.md`.
- Evidência do live: deltas parciais, bloco final, tools, `ask_user`, resposta humana, continuação pós-ask, alternância Kilo/Ollama Cloud, SSE/JSONL/export e ausência de duplicação seguiram PASS; a primeira usage BYOK apareceu como `classification=byok_user_message`, `premiumRequest=false`.
- O live runner agora tem critérios explícitos `byok-real-usage-not-pr` e `byok-real-usage-classified`.
- Live real com a nova guarda do harness: `artifacts/terminal-live/2026-05-21T12-45-53-564Z/summary.md`, PASS.

Status: implementado nesta revisão.

### A37. `/byok models refresh` ainda era verboso demais para o terminal

Achado:

- O live real com Kilo mostrou catálogo remoto de 346 modelos. Mesmo com suporte a `all` e limite explícito, o padrão humano ainda imprimia uma página grande demais para o terminal.
- Isso não é falha funcional de BYOK, mas é falha de cockpit: a UX passa a esconder contexto útil em um bloco enorme de modelos e aumenta ruído nos testes live.

Correção:

- A listagem padrão de `/byok models` e `/byok models refresh` agora mostra 24 modelos.
- O operador continua com liberdade ampla: `/byok models all` mostra tudo e `/byok models <n>` escolhe o tamanho da página.
- Unit test cobre a página padrão e ampliação explícita.
- Probe BYOK real sem turno confirmou `exibindo 24/346`: `artifacts/terminal-live/2026-05-21T12-50-11-039Z/summary.md`.

Status: implementado nesta revisão.

### A38. BYOK universal precisava deixar de ser catalogo bruto

Achado:

- A rodada de providers gratuitos mostrou que BYOK nao pode ser apenas "baseUrl + key + model": OpenRouter, Groq, Gemini, Mistral, Hugging Face, Cloudflare Workers AI, NVIDIA NIM, Cerebras, Chutes e Z.AI possuem contratos OpenAI-compatible parecidos, mas catalogos, metadata e semantica de custo diferentes.
- O arquivo `DOCUMENTAÇÃO/Provedores de LLMs com acesso gratuito.md` foi lido integralmente e usado como inventario inicial, mas a fonte de autoridade operacional continua sendo a documentacao oficial do provider e o comportamento live do endpoint.
- Sem enriquecimento de catalogo, `/byok models` força o operador a pesquisar fora do terminal quais modelos sao free, vision, reasoning, long-context, pagos, roteadores, previews ou limitados.
- O default anterior do OpenRouter (`openrouter/free`) era menos solido do que escolher um modelo `:free` real retornado pelo catalogo. O perfil foi movido para um modelo free descoberto no endpoint oficial.

Correção:

- `sdk/session/provider.js` ganhou presets declarativos para `openrouter`, `groq`, `gemini`, `mistral`, `huggingface`, `cloudflare-workers-ai`, `nvidia-nim`, `cerebras`, `chutes` e `zai`, alem dos presets ja existentes `ollama-*` e `kilo-*`.
- `BYOK_ENV_KEYS` e `BYOK_SECRET_ENV_KEYS` agora cobrem aliases reais usados pelo operador, sempre com redaction.
- `.env.local` foi atualizado como cofre unico local e gitignored; `.env.local.example` recebeu a topologia completa sem segredos.
- A descoberta remota passou a preservar metadata por modelo: `context_length`, modalidades de entrada/saida, parametros suportados, pricing, provider/owner e heuristica de free-tier.
- `/byok models` agora ranqueia por `free -> capability -> context`, mostra tags `free|metered|cost?`, `reasoning`, `vision`, `ctx`, `price` e `provider`, mantendo paginacao.
- A inferencia de capabilities deixou de aplicar capacidades do provider inteiro quando o catalogo remoto traz hints por modelo. Isso evita marcar todos os modelos OpenRouter como vision/reasoning so porque o provider como um todo oferece modelos com essas capacidades.

Validação:

- Probe real de catalogo, sem imprimir segredos, retornou:
  - OpenRouter: `358` modelos, `28` free via catalogo oficial.
  - Groq: `16` modelos via `https://api.groq.com/openai/v1/models`.
  - Gemini: `53` modelos via endpoint OpenAI-compatible/Google.
  - Mistral: `64` modelos.
  - Hugging Face router: `129` modelos via `https://router.huggingface.co/v1/models`.
  - NVIDIA NIM: `117` modelos via `https://integrate.api.nvidia.com/v1/models`.
  - Cerebras: `4` modelos.
  - Chutes: `13` modelos via `https://llm.chutes.ai/v1/models`.
  - Z.AI: `7` modelos.
  - Cloudflare Workers AI: endpoint OpenAI-compatible operacional para chat, mas `/models` retornou `405`; o fallback estatico foi acionado corretamente.
- Unit tests cobrem presets universais, redaction, metadata rica de modelos estaticos/remotos e ranking do `/byok models`.
- `npx vitest run tests/unit/copilot/sdk/test_sdk_provider.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js` passou.
- `npm run typecheck:strict:src.copilot` passou.

Status: implementado nesta revisão. Ainda falta live funcional com turno completo em mais de um provider novo.

### A39. BYOK precisava de recomendação e alerta de orçamento antes do turno

Achado:

- O probe real sem PR com Groq e OpenRouter passou, mas o turno funcional longo com Groq falhou antes de streaming por limite do provider: a sessão retomada carregava contexto grande e o endpoint retornou erro de requisição acima do orçamento da conta/modelo.
- Isso não é duplicação de delta nem falha do renderer. É falha de admissão operacional: o operador conseguia selecionar um modelo cujo catálogo era válido, mas sem aviso de que o orçamento `maxRequestTokens`/`TPM` era pequeno demais para a sessão atual.
- Em BYOK universal, "modelo disponível" não significa "modelo adequado para este turno". Providers free variam entre catálogos enormes com limites generosos e contas com orçamento por minuto muito baixo.

Correção:

- Foram adicionados metadados canônicos de limites BYOK (`maxRequestTokens`, `tokensPerMinute`, `requestsPerMinute`, `dailyRequests`) em `.env*`, schema, resumo seguro, tags de modelos e profiles locais.
- `/byok status` e `/byok models` agora mostram `maxReq`, `TPM`, `RPM` e `RPD` quando presentes.
- `/byok recommend` foi criado sobre o mesmo catálogo canônico de `/byok models`, sem nova fonte paralela. Ele aceita filtros `free`, `reasoning`, `vision`, `safe`, `ctx>N`, `maxReq>N`, `refresh` e limite numérico.
- A recomendação classifica orçamento baixo como alerta explícito: providers com limite abaixo de um piso operacional para turno real aparecem como adequados a probes/sessão fresca/contexto mínimo, não a sessão longa.
- `/byok reload`, `/byok use`, `/byok provider` e `/byok persist` limpam seletores efêmeros conflitantes, incluindo limites antigos. Isso removeu o bug em que trocar de provider preservava modelo/limite de outro perfil.
- O `terminal/dialog/engine.js` agora executa admission control antes de `setBusy()`, materialização de turno e chamada ao SDK. Quando a estimativa local de contexto + prompt + reserva de resposta excede `maxRequestTokens`/`tokensPerMinute`, o turno é bloqueado localmente, emite `terminal.byok.admission_blocked` e orienta `/compact`, `/byok recommend reasoning safe`, troca de perfil/modelo ou `COPILOT_BYOK_ADMISSION_MODE=warn` para override explícito.
- O bloqueio é estreito: limite baixo e margem estreita continuam como aviso. A política padrão `block` só impede a chamada quando o próprio limite declarado já torna provável a recusa antes do streaming; `warn` e `off` preservam liberdade operacional quando o operador quer assumir o risco.
- `/byok recommend` passou a ler o contexto vivo do runtime e aplicar a mesma estimativa pré-turno aos candidatos. Com `safe`, modelos cujo limite declarado já não comporta o contexto atual são removidos da recomendação antes de o operador trocar de modelo.

Validação:

- Probe real sem PR em `artifacts/terminal-live/byok-real-groq-openrouter-nopr-limits2-2026-05-21/summary.md` passou com Groq ativo, catálogo remoto, limites visíveis e alternância para OpenRouter, sem abrir turno e sem vazar segredos.
- Probe real sem PR em `artifacts/terminal-live/byok-real-groq-openrouter-nopr-recommend-2026-05-21/summary.md` passou incluindo `/byok recommend`, recomendação OpenRouter com modelos free/raciocínio e retorno ao perfil Groq, sem abrir turno e sem vazar segredos.
- O live funcional com Groq registrou falha externa por orçamento (`TPM`/requisição acima do permitido), validando a necessidade de admission control antes de turnos longos.
- Unit tests cobrem `/byok recommend`, filtro `safe`, aviso de orçamento baixo, bloqueio antes do SDK quando a estimativa excede limite e override `COPILOT_BYOK_ADMISSION_MODE=warn`.
- Unit tests também cobrem recomendação sensível ao contexto vivo: um modelo `maxReq=64000` é filtrado quando o contexto atual estimado é `64024`, enquanto modelo `maxReq=128000` permanece recomendado.
- Probe BYOK real sem PR em `artifacts/terminal-live/2026-05-21T16-53-34-579Z/summary.md` passou após a mudança de admission control, exercitando Gemini -> Mistral, provider cockpit, catálogo filtrado, recomendação, ausência de tools/turno explícito, ausência de erros e verificação de 24 segredos locais sem vazamento.

Status: implementado para limites declarados e contexto vivo disponível. Ainda falta enriquecer a estimativa com tokenização por modelo/provider e rodar turno funcional real em mais providers de contexto amplo.

### A40. O operador ainda não tinha cockpit explícito de providers e filtros no catálogo

Achado:

- A implementação universal de BYOK já carregava presets e perfis, mas a UX ainda obrigava o operador a inferir providers disponíveis a partir de `/byok profiles` e `/byok models`.
- Isso ficava especialmente ruim com muitos providers: o operador precisava descobrir manualmente quais perfis estavam prontos, qual comando usar para alternar, e como filtrar modelos por provider, gratuidade, custo desconhecido, reasoning, vision e limites.
- O live com Gemini e Mistral evidenciou um caso importante: alguns catálogos reais retornam modelos operacionais, mas não informam gratuidade/preço de forma confiável. Nesses casos, filtrar por `free` deve retornar vazio com clareza, enquanto a recomendação operacional deve continuar útil usando `reasoning`, `safe`, `ctx>` e `maxReq>` sem presumir gratuidade.

Correção:

- Criado `/byok providers`, um cockpit redigido que lista todos os perfis configurados, perfil ativo, preset, provider, modelo, tipo de autenticação, metadata disponível e comandos diretos de operação.
- `/byok models` passou a aceitar os mesmos filtros centrais de recomendação: `free`, `metered`, `cost?`, `provider:<nome>`, `reasoning`, `vision`, `safe`, `ctx>N`, `maxReq>N`, além de `refresh`, `all` e limite numérico.
- `/byok recommend` passou a aceitar filtro `provider:<nome>` e filtros de custo `metered`/`cost?`, usando o mesmo pipeline de ranking e budget.
- O harness live BYOK passou a validar `/byok providers`, catálogo filtrado e recomendação operacional. Para providers que retornam `cost?`, o harness testa `free` em `/byok models` e usa recomendação sem `free` para não transformar ausência de metadata em falha falsa.
- O `.env.local` local foi atualizado como cofre gitignored para expor todos os perfis BYOK configurados pelo operador sem duplicar nem imprimir segredos.

Validação:

- Unit tests cobrem `/byok providers`, filtros de `/byok models` por provider/gratuidade/capacidade/limite e filtros de `/byok recommend` por provider/modelos medidos.
- `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/sdk/test_sdk_provider.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js` passou.
- `npm run typecheck:strict:src.copilot` passou.
- Probe real sem PR Gemini -> Mistral passou em `artifacts/terminal-live/byok-real-gemini-mistral-nopr-2026-05-21-r2/summary.md`.
- Probe real sem PR NVIDIA NIM -> Cerebras passou em `artifacts/terminal-live/byok-real-nvidia-cerebras-nopr-2026-05-21/summary.md`.
- Probe real sem PR Hugging Face -> Chutes passou em `artifacts/terminal-live/byok-real-huggingface-chutes-nopr-2026-05-21/summary.md`.
- Probe real sem PR Gemini -> Mistral pós-admission control passou em `artifacts/terminal-live/2026-05-21T16-53-34-579Z/summary.md`, confirmando que o cockpit segue íntegro após a nova política pré-turno.

Status: implementado nesta revisão. Ainda falta turno funcional real em mais providers, com admission control antes do turno para evitar custo/limite inesperado.

### A41. BYOK multi-provider precisava de contrato de erro, raciocínio SDK e descoberta agregada

Achado:

- OpenRouter retornou erro antes do turno funcional quando o modelo literal continha `:free` e o runtime ainda anexava `defaultReasoningEffort`/`reasoningEffort` ao modelo. Para providers que usam `:` no id, o id deve atravessar literalmente; `reasoning` continua sendo capacidade semântica do modelo, mas `reasoningEffort` do SDK precisa ser omitido.
- Sessões SDK retomadas podiam carregar reasoning/modelo antigo incompatível com o perfil BYOK atual, contaminando a nova chamada mesmo após correção de provider.
- Quando um provider BYOK falhava, a UX ainda usava linguagem de recuperação Copilot (`auto é a única recuperação permitida`), sugerindo fallback para GitHub Copilot. Isso é incorreto: BYOK não deve cair para Copilot auto em erro de provider customizado.
- O cockpit já listava providers e modelos do perfil ativo, mas o operador ainda não tinha uma visão agregada simples de todos os providers/perfis sem alternar manualmente.

Correção:

- `sdk/session/provider.js` passou a separar `byok.supportsReasoning` de `capabilities.supports.reasoningEffort`, marcando `sdkReasoning=off` para ids literais com `:`.
- `sdk/session/runtime.js` ganhou normalização defensiva em `setSessionModel()` para remover `reasoningEffort` quando o modelo BYOK não suporta a opção do SDK.
- `agent/session/initializers/initializer.js` invalida retomada de sessão quando o perfil/modelo BYOK ativo diverge do snapshot persistido ou quando o snapshot contém reasoning incompatível com o modelo atual.
- `agent/ports/model-error-recovery.js`, `agent/ports/hook-port.js` e `hooks/session-hooks.js` bloqueiam fallback Copilot auto quando BYOK está ativo e emitem metadados seguros de provider/perfil/modelo.
- `terminal/events/agent-runtime-events.js` passou a explicar erro BYOK como falha de provider customizado, orientando `/byok use` ou `/byok model`, sem narrar Premium Request nem fallback Copilot.
- `/byok models all-providers` e `/byok recommend all-providers` agora percorrem todos os perfis configurados, preservam o provider ativo, aplicam os mesmos filtros (`free`, `metered`, `cost?`, `provider:<nome>`, `reasoning`, `vision`, `safe`, `ctx>`, `maxReq>`) e mostram `profile=` em cada modelo.

Validação:

- `npm run typecheck:strict:src.copilot` passou.
- `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/agent/test_hook_port.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/sdk/test_sdk_provider.spec.js tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js tests/unit/copilot/test_initializer_session_fs.spec.js tests/unit/copilot/test_session_setup.spec.js` passou com 175 testes.
- Live Kilo real passou em `artifacts/terminal-live/2026-05-21T17-25-49-956Z/summary.md`, cobrindo deltas parciais, bloco final, tools, `ask_user`, resposta humana, continuação pós-ask, usage BYOK sem Premium Request, `/events`, SSE/JSONL/export e ausência de duplicação.
- Comando operacional real confirmou `/byok models all-providers free reasoning safe 12`: 13 perfis varridos, `remote=11 · static-fallback=2`, 30 candidatos filtrados e avisos redigidos para Ollama local/Cloudflare.
- Comando operacional real confirmou `/byok recommend all-providers free reasoning safe 12`: 1.150 modelos agregados antes do filtro de recomendação, candidatos com provider/profile explícitos e sem vazamento de segredos.
- Comando operacional real confirmou `/byok models all-providers grouped free reasoning safe 12`: 23 grupos para 30 variantes, com `variants=<profile>/<provider>` preservando alternativas de roteamento por provider.
- OpenRouter avançou além do erro antigo de `free:defaultReasoningEffort`, mas um modelo retornou `400 Provider returned error`; isso fica como falha/provider-model a investigar com seleção recomendada diferente.
- Gemini listou catálogo e alternou provider/modelo, mas o chat real retornou `403` no endpoint OpenAI-compatible; isso fica como diagnóstico de chave/endpoint Google AI Studio vs Google Cloud, não como bug confirmado de terminal.

Status: implementado para raciocínio SDK, retomada de sessão, narrativa de erro, descoberta agregada e agrupamento visual de variantes. Ainda falta rodar turno funcional OpenRouter com modelo recomendado alternativo e fechar diagnóstico Gemini 403.

### A42. Falha de provider BYOK ainda podia prender o turno e o harness

Achado:

- O live negativo com Cerebras mostrou que a política de erro já bloqueava fallback Copilot auto, mas a UX ainda deixava o turno como `active` em `/activity`. Para o operador, isso parecia trabalho em andamento mesmo depois de a causa raiz já estar conhecida.
- O mesmo cenário expôs um bug no live runner: a condição que detectava `erro de provider BYOK` estava fora do guarda `!postCommandsSent` por precedência de operadores. O resultado era uma avalanche de `/activity 40` até o fechamento do terminal, seguida antes por `EPIPE` em algumas execuções.
- O live Kilo positivo expôs outro falso negativo do harness: os comandos diagnósticos eram disparados assim que o marcador pós-`ask_user` aparecia no stream, antes de o turno estabilizar. Isso inseria `/usage now` no meio do bloco da LLM-B e podia quebrar o critério `final-delta-block` sem bug real no renderer.

Correção:

- `agent-runtime-events.js` agora encerra a materialização textual e o turn trace como `failed` quando chega erro recuperável de `model_call` em BYOK. O erro permanece como atividade atual, mas `/activity` passa a mostrar o último turno concluído com `status failed`, em vez de turno eterno `active`.
- `turn-trace-state.js` ganhou status explícito `failed`, preservando a diferença entre falha operacional e interrupção.
- O live runner passou a:
  - reaplicar o modelo solicitado após alternância temporária de provider;
  - classificar `erro de provider BYOK`/`Operation cancelled by user` como blocker `byok-provider-model-call-aborted`;
  - proteger escrita em stdin contra `EPIPE`;
  - enviar diagnóstico de erro apenas uma vez;
  - esperar `Resposta concluída`/`Turno concluído` antes de disparar diagnósticos pós-`ask_user`.

Validação:

- Unit tests: `COPILOT_BYOK_ENABLED=false COPILOT_BYOK_PROFILE= COPILOT_BYOK_PROFILES_JSON= npx vitest run tests/unit/copilot/agent/test_hook_port.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_hooks_module.spec.js` passou com 138 testes.
- Typecheck: `npm run typecheck:strict:src.copilot` passou.
- Live Kilo real completo passou em `artifacts/terminal-live/byok-kilo-canonical-after-runner-fix-2026-05-21/summary.md`: deltas parciais, bloco final, tools, `ask_user`, resposta humana, pós-ask, `/usage`, `/activity`, `/tools`, `/events`, `/errors`, `/health`, export, SSE HTTP/JSONL e ausência de duplicação.
- Live Cerebras real ficou corretamente `BLOCKED` por provider em `artifacts/terminal-live/byok-cerebras-failure-after-turn-fail-2026-05-21/summary.md`: catálogo/cockpit/recomendação OK, segredo não vazou, sem Premium Request, sem fallback Copilot, e `/activity` mostrou `Último turno concluído` com `status failed`.

Status: implementado nesta revisão para UX de falha BYOK e robustez do harness. Cerebras continua bloqueado por comportamento do provider/modelo real, não por duplicação de terminal.

### A43. Catálogo BYOK não podia ser confundido com saúde operacional de chat

Achado:

- O cockpit já conseguia listar centenas de modelos vindos de catálogos remotos, mas "modelo listado" e "modelo funcional para chat agora" são fatos diferentes.
- Quando um provider/modelo falhava em `model_call`, o catálogo remoto continuava apresentando o modelo como disponível, e `/byok recommend safe` ainda podia recomendá-lo em uma sessão posterior do mesmo processo.
- Para o operador, isso criava um gap de UX importante: o terminal dizia que o provider existia e listava modelos, mas não dava uma resposta simples para "este par provider/modelo acabou de funcionar ou falhar em um turno real?".

Correção:

- Foi criada a camada `terminal/state/byok-provider-health.js`, alimentada somente por eventos reais do runtime, não por outro caminho paralelo de descoberta.
- `agent.error` recuperável de contexto `model_call` em BYOK marca `(profile, provider, model)` como `chat=failed`, preservando mensagem e contexto redigidos.
- `llm.usage` em BYOK sem Premium Request marca o mesmo par como `chat=ok`, confirmando que um turno real chegou à telemetria de uso do provider.
- `/byok providers`, `/byok models` e `/byok recommend` passaram a mostrar `chat=?`, `chat=ok(...)` ou `chat=failed(...)`.
- O filtro `safe` passou a excluir pares com falha operacional recente mesmo quando o catálogo remoto ainda lista o modelo.
- O live runner agora executa `/byok providers` e `/byok recommend reasoning safe 8` depois de turno BYOK real ou depois de erro de provider, e valida que a saúde operacional aparece para o operador.

Validação:

- `npm run typecheck:strict:src.copilot` passou.
- `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js` passou com 50 testes.
- Live BYOK real com Kilo passou em `artifacts/terminal-live/byok-kilo-health-cockpit-pass-2026-05-21/summary.md`: deltas parciais, bloco final, tools, `ask_user`, resposta humana, continuação pós-ask, usage BYOK sem Premium Request, `/events`, SSE/JSONL/export, ausência de duplicação, `/byok providers` com `chat=ok` e `/byok recommend safe` preservando essa evidência.
- O harness foi endurecido para não contar menções prospectivas ao marcador pós-ask como bloco final renderizado; somente a frase final exata `POST-ASK-CANONICAL-FINAL: usuário confirmou SIM` conta como final.

Status: implementado para saúde operacional em memória do processo atual. Próximo passo: persistir essa saúde de forma redigida entre sessões para que falhas recorrentes de provider/modelo continuem visíveis após restart.

## Hipóteses Externas Rejeitadas Ou Reclassificadas

### H1. "boot-hub assume sucesso"

Rejeitada como descrição atual. `boot-hub.js` já possui `try/catch`, registra warning e continua sem persistência se o hub falhar.

### H2. "fila de turnos não tem limite"

Rejeitada como descrição atual. `dialog/engine.js` já possui `MAX_TURN_QUEUE_SIZE` e controle de profundidade.

### H3. "`session.keepAlive` e `session.updateMetadata` existem no SDK 0.3.0"

Rejeitada para o pacote local. Não aparecem em `node_modules/@github/copilot-sdk@0.3.0`. A intenção de sessão viva/metadados é válida, mas deve ser implementada com APIs reais disponíveis ou adaptador próprio.

### H4. "Trocar a suíte para Node Test Runner"

Não adotada agora. O projeto já tem suíte consolidada em Vitest, com aliases, mocks e scripts de cache. O test runner oficial do Node 24 é interessante para componentes isolados, mas trocar a suíte principal não é prioridade.

### H5. "Usar Node permission model no terminal por padrão"

Não adotada agora. O permission model do Node ainda deve ser tratado como modo endurecido opcional. Ativar por padrão pode quebrar workflows de LLM-B que exigem FS amplo e ferramentas locais.

### H6. "Usar Symbol.dispose/WeakRef em todo lugar"

Reclassificada como diretriz seletiva. `Symbol.dispose` já aparece no runtime do agente. Aplicar em massa sem necessidade tende a criar complexidade. O critério é: usar quando houver recurso com ciclo de vida claro e teste de disposal.

### H7. "Intl.Segmenter resolve contagem de tokens"

Rejeitada como solução de tokenização. `Intl.Segmenter` segmenta texto humano; não substitui tokenizer de modelo. Pode ajudar em largura/UX, não em orçamento real de contexto.

## Situação Ideal

O terminal ideal é um cockpit confiável, não apenas uma tela de logs.

Propriedades obrigatórias:

- Tudo que a LLM-B escreve publicamente aparece no terminal e fica consultável depois.
- Thinking/reasoning não é despejado por padrão, mas é capturado e acessível por `/thinking`.
- Deltas parciais aparecem progressivamente sem duplicação, sem truncamento invisível e sem apagar mensagens.
- Mensagem final reconcilia com os deltas e deixa evidência quando houver divergência.
- Tools aparecem com nome correto, status, duração, I/O real, permissões, erro e correlação com turno.
- `ask_user` e elicitation aparecem como interação estruturada: pedido, resposta, conclusão, cancelamento e timeout.
- O prompt do operador nunca fica escondido atrás de linha viva.
- O watchdog não reinicia o loop durante atividade saudável.
- Estados de sessão são claros: dialog loop, SDK session, hub session, turn, agent, runtime, transport.
- Modelo é apresentado com distinção entre configurado, preferido, efetivo e cobrado.
- Usage não é confundido com Premium Request.
- Boot é transacional: cada fase tem start, success, failure, rollback e evento arquivado.
- Arquitetura tem um fluxo único: SDK events -> normalização -> state/materialization -> fanout SSE -> arquivo durável -> terminal/HTTP/commands.
- BYOK e multi-provider usam o mesmo fluxo de sessão, eventos, tools, `ask_user`, elicitation e transcript do Copilot SDK; trocar provider não cria outro renderer, outro loop ou outro arquivo de histórico.
- Diagnósticos são evidência, não maquiagem: se o backend falha, a UX mostra a falha e o fluxo backend é corrigido.

## Roadmap

### Faixa A. Boot, Lifecycle E Recursos

Fase A1. Fiação do runtime

- A1.1 Aguardar `wireRuntime()` no boot. Status: feito.
- A1.2 Cobrir `wireRuntime()` assíncrono por teste unitário. Status: feito.
- A1.3 Emitir evento `terminal.runtime.wired` com duração e resultado. Status: feito nesta rodada.
- A1.4 Registrar falha de `wireRuntime()` com `phase=runtime-config`. Status: parcialmente feito via atividade + `terminal.runtime.wire_failed`; falta integrar ao `ErrorTracker`.

Fase A2. Reflection loop

- A2.1 Capturar falhas síncronas e assíncronas. Status: feito.
- A2.2 Testar falha síncrona de `sendTurnFn`. Status: feito.
- A2.3 Adicionar `AbortSignal` para reflection em shutdown/restart. Status: pendente.
- A2.4 Garantir que reflection não conte como intervenção humana nem PR. Status: pendente.

Fase A3. Signals e shutdown

- A3.1 Tornar SIGHUP POSIX explícito. Status: feito.
- A3.2 Cobrir política SIGHUP por teste. Status: feito.
- A3.3 Arquivar eventos de signal/shutdown com `reason`, `source`, `pendingFlush`. Status: pendente.
- A3.4 Consolidar rollback das fases em tabela única de recursos. Status: pendente.

Fase A4. Pinned files e watchers

- A4.1 Reavaliar `PinnedFilesLoader.start()` em falha parcial. Status: pendente.
- A4.2 Garantir cleanup de watcher e bridge em start parcial. Status: pendente.
- A4.3 Avaliar `AbortController` em watchers compatíveis com Node 24. Status: pendente.
- A4.4 Expor `/health` de pinned context com tamanho, watchers e erros. Status: pendente.

### Faixa B. SDK 0.3.0, Sessão, Modelo E Usage

Fase B1. Contrato SDK real

- B1.1 Documentar APIs reais do pacote instalado. Status: iniciado.
- B1.2 Criar adaptador de capabilities com `requestUserInput`, `requestElicitation`, streaming e subagent streaming. Status: pendente.
- B1.3 Rejeitar nomes de API inexistentes no roadmap operacional. Status: feito neste documento.
- B1.4 Adicionar teste de contrato contra `types.d.ts`/event names usados pelo terminal. Status: pendente.

Fase B2. Modelo

- B2.1 Padronizar `configuredModel`, `preferredModel`, `effectiveModel`, `billingModel`. Status: pendente.
- B2.2 Corrigir prompt quando `/model gpt-5.4` é roteado para outro modelo. Status: pendente.
- B2.3 Mostrar troca confirmada somente após evento/usage compatível. Status: parcialmente feito.
- B2.4 Evitar watchdog/restart como "confirmação" de modelo. Status: parcialmente feito.

Fase B3. Usage versus Premium Request

- B3.1 Renomear mensagens ambíguas de "uso contabilizado". Status: feito para UX principal do terminal.
- B3.2 Criar classificador `sdkUsage`, `tokenUsage`, `billingUsage`, `premiumRequest`. Status: ampliado; o classificador distingue snapshot histórico, telemetria LLM, PR atual, continuação de `ask_user` e mensagem humana BYOK.
- B3.3 Mostrar "PR desconhecida" quando não houver prova. Status: parcialmente feito; snapshots históricos agora são rotulados como históricos.
- B3.4 Provar que `ask_user` não é PR no relatório live. Status: feito nos lives BYOK reais, incluindo `artifacts/terminal-live/2026-05-21T12-40-35-670Z/summary.md`.
- B3.5 Provar que `assistant.usage` de mensagem humana BYOK não vira PR Copilot. Status: feito nesta revisão, com unit test e live real.

### Faixa C. Streaming, Transcript E Arquivo Durável

Fase C1. Deltas públicos

- C1.1 Garantir que `assistant.message_delta` e `assistant.streaming_delta` entrem no fluxo único. Status: parcialmente feito.
- C1.2 Comparar delta PTY x SSE HTTP x JSONL. Status: parcialmente feito.
- C1.3 Exibir delta parcial com flush controlado e sem apagar linha viva. Status: pendente de prova live.
- C1.4 Reconciliar delta final com transcript e marcar divergência. Status: pendente.
- C1.5 Tornar `dialog.delta` fonte canônica quando presente e `task.delta` apenas fallback. Status: feito nesta revisão.
- C1.6 Reexecutar teste live e exigir ausência de supressões causadas por `task.delta` pós-`dialog.delta`. Status: feito nesta revisão.

Fase C2. Deduplicação

- C2.1 Remover dedupe textual cego que pode perder repetição legítima. Status: feito no contrato unitário de `wireStreamingEvents`.
- C2.2 Deduplicar por identidade de evento (`eventId`, `traceId`, `turnId`, `callId`). Status: parcialmente feito para `assistant.message_delta` por objeto/eventId.
- C2.3 Criar métrica de supressão por motivo. Status: pendente.
- C2.4 Testar repetição legítima de texto. Status: pendente.
- C2.5 Reconciliar `sdk/assistant.message` tardio com turno/delta já materializado. Status: feito nesta revisão.
- C2.6 Arquivar `assistant.message` tardio em SSE sem alterar a UX quando for equivalente. Status: feito nesta revisão.
- C2.7 Testar equivalência de conteúdo normalizada por `turnId`. Status: feito nesta revisão.
- C2.8 Deduplicar `assistant.intent`/`report_intent`/`report_intent_local` por identidade semântica. Status: feito nesta revisão.

Fase C3. Arquivo JSONL

- C3.1 Arquivar todo `broadcastSse()`. Status: feito.
- C3.2 Expor `/events`. Status: feito.
- C3.3 Expor `/events --raw`. Status: feito.
- C3.4 Adicionar diff de payload PTY/SSE/archive no live runner. Status: pendente.
- C3.5 Implementar rotação por tamanho/idade com índice. Status: pendente.
- C3.6 Safe stringify/normalização de payload no ponto único `broadcastSse()`. Status: feito nesta revisão.
- C3.7 Tratar backpressure básico de raw SSE desconectando cliente lento. Status: feito nesta revisão.
- C3.8 Medir `sse.dropped`, `sse.truncated` e `sse.stringifyError`. Status: pendente.

### Faixa D. Tools, I/O E Permissões

Fase D1. Tool cards

- D1.1 Normalizar `toolName` sem "unknown" quando houver dado disponível. Status: parcialmente feito.
- D1.2 Mostrar início, progresso, conclusão e erro com o mesmo `callId`. Status: parcialmente feito.
- D1.3 Agregar I/O real por tool. Status: parcialmente feito.
- D1.4 Persistir resumo de tool no JSONL com campos estáveis. Status: pendente.

Fase D2. Permissões

- D2.1 Reduzir spam de `permission.requested` quando auto-aprovado/observado. Status: pendente.
- D2.2 Mostrar decisão final e não apenas pedido. Status: pendente.
- D2.3 Correlacionar permissão com tool e arquivo. Status: pendente.
- D2.4 Incluir permissões em `/activity`, `/events` e `/tools diag`. Status: pendente.

### Faixa E. Ask User, Elicitation E Prompt Do Operador

Fase E1. Ask user

- E1.1 Registrar `user_input.requested` no terminal. Status: parcialmente feito.
- E1.2 Registrar resposta do operador com correlação e redaction quando necessário. Status: pendente.
- E1.3 Garantir que pergunta e resposta fiquem no transcript consultável. Status: pendente.
- E1.4 Testar pergunta, resposta, cancelamento e timeout. Status: pendente.
- E1.5 Remover dupla apresentação `question.pending` + `user_input.requested`. Status: feito nesta revisão.
- E1.6 Manter `question.pending` apenas para estado interno e replay de pergunta pendente em boot. Status: feito nesta revisão.
- E1.7 Reexecutar live com `ask_user` e exigir apenas uma pergunta persistente no PTY. Status: feito nesta revisão.
- E1.8 Exigir continuação pós-`ask_user` com marcador canônico e espera ativa antes de diagnósticos. Status: iniciado nesta revisão; pendente de rodada estável.

Fase E2. Elicitation

- E2.1 Mapear schema do SDK para UX de terminal. Status: parcialmente feito.
- E2.2 Suportar `accept`, `decline`, `cancel`. Status: pendente.
- E2.3 Mostrar campos obrigatórios e validação de tipo. Status: pendente.
- E2.4 Arquivar pedido e resposta em `/events`. Status: pendente.

Fase E3. Prompt e linha viva

- E3.1 Garantir espaço suficiente para prompt longo. Status: parcialmente feito.
- E3.2 Separar linha viva, prompt e streaming por renderer coordenado. Status: pendente.
- E3.3 Nunca esconder texto permanente. Status: pendente de teste visual.
- E3.4 Adicionar prova PTY com prompt longo e delta simultâneo. Status: pendente.

### Faixa F. Comandos E UX Operacional

Fase F1. `/help` e comandos dinâmicos

- F1.1 Separar comandos estáticos e capacidades dinâmicas. Status: pendente.
- F1.2 Integrar `module-map.js` em `/help` ou `/module-map`. Status: pendente.
- F1.3 Mostrar SDK capabilities reais. Status: pendente.
- F1.4 Evitar banner inicial grande demais em preset full. Status: pendente.

Fase F2. Histórico, resume, export e search

- F2.1 Paginar `/resume`. Status: pendente.
- F2.2 Paginar `/history` e `/db-history`. Status: pendente.
- F2.3 Exportar intervalos em `/export`. Status: pendente.
- F2.4 Usar streams para export grande. Status: pendente.
- F2.5 Destacar matches em `/search`. Status: pendente.

Fase F3. Comandos destrutivos

- F3.1 Adicionar confirmação ou undo em `/forget`. Status: pendente.
- F3.2 Clarificar `/clear`, `/clear-shadow`, `/compact`. Status: pendente.
- F3.3 Registrar audit trail para operações destrutivas. Status: pendente.

### Faixa G. Testes Live E Regressão

Fase G1. Cenário canônico sem PR

- G1.1 Boot `--no-pr`. Status: feito.
- G1.2 Validar `/events --raw`. Status: feito.
- G1.3 Validar prompt longo sem sobreposição. Status: pendente.
- G1.4 Validar ausência de PR para `ask_user`. Status: pendente.
- G1.5 Validar `/usage now`, `/metrics`, `/activity`, `/events`, `/errors` sem turno explícito e sem erro. Status: feito em `artifacts/terminal-live/codex-continue-2026-05-20-no-pr-rerun/summary.md`.

Fase G2. Cenário canônico com LLM-B

- G2.1 Prompt que force delta parcial visível. Status: feito no cenário live e promovido a critério explícito; ainda falta fechar critérios SSE/export restantes.
- G2.2 Prompt que force tool simples e tool com I/O. Status: feito no cenário live; ainda falta enriquecer correlação de permissões e I/O no JSONL.
- G2.3 Prompt que force `ask_user` ao final. Status: feito e reexecutado pós-correção.
- G2.4 Prompt que force elicitation quando capability existir. Status: pendente.
- G2.5 Comparar PTY, SSE, JSONL, transcript e SQLite. Status: pendente.
- G2.6 Falhar se a mesma pergunta `ask_user` aparecer por mais de uma fonte visual. Status: feito no live runner.
- G2.7 Falhar se a mesma resposta final aparecer como delta materializado e bloco `assistant.message`. Status: feito no live runner.
- G2.8 Falhar se `task.delta` reaparecer enquanto `dialog.delta` já é fonte canônica. Status: feito no live runner e na origem `agent-messaging`.
- G2.9 Falhar se `report_intent` triplicar a timeline por rotas equivalentes. Status: coberto por teste unitário; pendente critério live explícito.
- G2.10 Distinguir falha externa de CAPI de regressão de UX/transcript. Status: iniciado no live runner.
- G2.11 Reexecutar cenário completo após reset do rate limit e anexar evidência delta/tool/ask_user/post-ask. Status: bloqueado por SDK em `artifacts/terminal-live/codex-continue-2026-05-20-full/summary.md`.

Fase G3. Fake SDK determinístico

- G3.1 Criar harness de sessão fake com `assistant.message_delta`. Status: pendente.
- G3.2 Criar harness com tool start/progress/complete. Status: pendente.
- G3.3 Criar harness com `user_input.requested/completed`. Status: pendente.
- G3.4 Criar harness com `elicitation.requested/completed`. Status: pendente.

### Faixa H. Performance E Node 24+

Fase H1. Timers e abort

- H1.1 Usar `AbortSignal` em operações longas do terminal. Status: pendente.
- H1.2 Usar `.unref()` consistentemente em timers auxiliares. Status: parcialmente feito.
- H1.3 Centralizar timers no registry com owner e cleanup. Status: parcialmente feito.

Fase H2. Streams e backpressure

- H2.1 Avaliar batching de deltas sem perda semântica. Status: pendente.
- H2.2 Adicionar métrica de backpressure SSE. Status: pendente.
- H2.3 Evitar buffers invisíveis sem contador. Status: pendente.

Fase H3. FS e watchers

- H3.1 Avaliar `fs.promises.watch` com AbortSignal onde couber. Status: pendente.
- H3.2 Limitar pinned files por bytes com feedback claro. Status: pendente.
- H3.3 Suportar attach binário por MIME quando seguro. Status: pendente.

### Faixa I. Arquitetura Canônica Sem Fluxos Paralelos Opacos

Fase I1. Inventário e classificação de emitters

- I1.1 Mapear todos os listeners do SDK e eventos derivados (`dialog.delta`, `task.delta`, `assistant.message`, `question.pending`). Status: feito nesta revisão.
- I1.2 Classificar cada emissor como fonte canônica, adaptador, fallback ou legado. Status: ampliado nesta revisão; `/events sources` expõe classe, owner, emissor, eventos aceitos, supressões e fallback das superfícies críticas, incluindo BYOK como provider governado.
- I1.3 Bloquear novos eventos públicos fora de `broadcastSse()` por teste arquitetural. Status: feito nesta revisão para fanout durável/SSE: `eventFanout.publish()` e `recordTerminalSseEventArchive()` ficam concentrados em `dialog/sse.js` e no arquivo de archive.
- I1.4 Expor `/events sources` ou `/health` com contagem por fonte/adaptador. Status: feito em `/events sources [n]`, com contagem recente por política a partir do archive SSE.

Fase I2. Política explícita de compat/fallback

- I2.1 Criar tabela de fallbacks permitidos com dono, motivo, condição, métrica e data de revisão. Status: pendente.
- I2.2 Renomear fallbacks saudáveis para "adapters" quando forem parte do fluxo canônico. Status: pendente.
- I2.3 Remover fallbacks silenciosos sem métrica. Status: pendente.
- I2.4 Fazer `task.delta` fallback explícito apenas quando `dialog.delta` não existir para o stream. Status: feito nesta revisão no cliente de diálogo.
- I2.5 Garantir que `agent-messaging` não emita `task.delta` enquanto o dialog loop estiver ativo. Status: feito nesta revisão na origem.
- I2.6 Auditar recuperação `session.error` -> `reconnect_restart` para impedir reenvio automático ambíguo de prompt. Status: parcialmente feito; requeue de `dialog_boot` bloqueado e UX/SSE explicitam prompt preservado sem replay.

Fase I3. Microkernel de eventos públicos

- I3.1 Extrair normalizador canônico de eventos públicos de assistant/user_input/tool antes do renderer. Status: pendente.
- I3.2 Fazer terminal PTY, SSE HTTP, JSONL e export consumirem a mesma materialização. Status: parcialmente feito.
- I3.3 Gerar relatório de divergência quando PTY/SSE/export discordarem. Status: pendente.
- I3.4 Suprimir visualmente `dialog.turn_end` truncado quando `assistant.message` completo já cobriu o transcript. Status: feito nesta revisão.
- I3.5 Expandir o live runner para detectar prefixo/sufixo duplicado entre `assistant.message`, `dialog.turn_end` e blocos persistentes do PTY. Status: feito para `assistant.message`/`dialog.turn_end`; parser estruturado de blocos PTY persistentes ainda pendente.
- I3.6 Classificar timeout do cenário live como blocker de causa raiz, sem cascata falsa em critérios downstream. Status: feito nesta revisão.

### Faixa J. BYOK, Multi-Provider E LLMs Locais

Fase J1. Contrato SDK e documentação oficial

- J1.1 Validar `ProviderConfig` no pacote local `@github/copilot-sdk@0.3.0`. Status: feito.
- J1.2 Validar documentação oficial GitHub para BYOK, `wireApi`, Ollama local e `onListModels`. Status: feito.
- J1.3 Documentar que `session.keepAlive`/`session.updateMetadata` não fazem parte do pacote local. Status: feito.
- J1.4 Registrar limites: provider custom exige `model` explícito e não usa `auto`. Status: feito.

Fase J2. Env governance e segredo

- J2.1 Criar superfície `COPILOT_BYOK_*` canônica. Status: feito nesta revisão.
- J2.2 Garantir que API keys não sejam impressas, arquivadas ou repassadas como env amplo do child CLI. Status: feito nesta revisão.
- J2.3 Atualizar `.env.local.example`, `.env.example`, `.env.expert.example` e `.env.schema.json`. Status: feito nesta revisão.
- J2.4 Atualizar guia de env com política BYOK e redaction. Status: feito nesta revisão.
- J2.5 Adicionar auditoria automatizada para impedir vazamento de `COPILOT_BYOK_API_KEY` em logs/artefatos. Status: live runner verifica segredos locais contra output terminal; CI guard pendente.
- J2.6 Consolidar `.env.local` como arquivo único do operador para perfis, metadata e segredos. Status: feito nesta revisão.
- J2.7 Criar `COPILOT_BYOK_PROFILES_JSON` e `COPILOT_BYOK_PROFILE` para alternância segura entre providers/modelos. Status: feito nesta revisão.
- J2.8 Adicionar preset Kilo Gateway/Kilo Code sem registrar token real. Status: feito nesta revisão.
- J2.9 Carregar `.env.local` no entrypoint `terminal:llm-b` antes das leituras estáticas de configuração, sem sobrescrever env explícito. Status: feito nesta revisão.

Fase J3. Provider e model list

- J3.1 Resolver presets `openai`, `openai-compatible`, `azure`, `anthropic`, `ollama-local`, `ollama-cloud`, `kilo-code`, `kilo-gateway`, `kilo` e `custom`. Status: feito nesta revisão.
- J3.2 Criar `readConfiguredByokState()` com status pronto/erro/aviso. Status: feito nesta revisão.
- J3.3 Criar `redactProviderConfig()`. Status: feito nesta revisão.
- J3.4 Criar `onListModels` por `COPILOT_BYOK_MODEL(S)` com fallback estático. Status: feito nesta revisão.
- J3.5 Permitir catálogo dinâmico via endpoint `/models`/`/v1/models` quando seguro. Status: feito nesta revisão para providers OpenAI-compatible.
- J3.6 Resolver perfis antes da validação final de provider, preservando overrides explícitos do processo. Status: feito nesta revisão.
- J3.7 Listar perfis redigidos para UX/diagnóstico sem expor segredo. Status: feito nesta revisão.
- J3.8 Cachear catálogo remoto com TTL e timeout configuráveis. Status: feito nesta revisão.
- J3.9 Permitir endpoint explícito por env/perfil. Status: feito nesta revisão.
- J3.10 Inferir capabilities reais por modelo remoto quando o provider informar metadados ricos. Status: ampliado; OpenRouter, Chutes e outros catalogos agora preservam contexto, modalidades, pricing/free-tier e parametros suportados.
- J3.11 Ranquear catalogos grandes por valor operacional (`free -> capability -> context`) sem perder acesso ao catalogo completo. Status: feito nesta revisão.
- J3.12 Tratar providers sem `/models` OpenAI-compatible, como Cloudflare Workers AI neste probe, com fallback estatico redigido e aviso claro. Status: feito nesta revisão.

Fase J4. Sessão e lifecycle

- J4.1 Injetar `provider`, `model` e `modelCapabilities` na sessão persistente. Status: feito nesta revisão.
- J4.2 Omitir `reasoningEffort` quando o provider declara não suportar reasoning. Status: feito nesta revisão.
- J4.3 Persistir modelo BYOK efetivo de forma clara em status/model UX. Status: feito para identidade viva do terminal; prompt, waiting prompt, auto-brief e `/metrics` convergem em `state.model`. Ainda resta enriquecer billing/effective de provider em comandos diagnósticos.
- J4.4 Bloquear BYOK incompleto com erro acionável antes de criar sessão. Status: feito nesta revisão.
- J4.5 Suportar troca runtime de provider sem restart completo. Status: pendente; requer política de rotação de sessão e não deve criar loop paralelo.
- J4.6 Diferenciar troca efêmera de processo e persistência em `.env.local`. Status: feito; `/byok use|model|provider` são efêmeros e `/byok persist ...` grava seletores não secretos.
- J4.7 Marcar sessões BYOK com metadados seguros para usage/telemetria sem expor provider ou segredo bruto. Status: feito nesta revisão.

Fase J5. UX e comandos

- J5.1 Criar `/byok status`. Status: feito nesta revisão.
- J5.2 Criar `/byok models`. Status: feito nesta revisão.
- J5.3 Criar `/byok env`. Status: feito nesta revisão.
- J5.4 Integrar BYOK em `/status`, `/health`, `/model` e auto-brief. Status: feito nesta revisão.
- J5.5 Mostrar diferença entre modelo BYOK configurado, modelo SDK efetivo e provider. Status: parcialmente feito; prompt foi corrigido para identidade ativa e comandos mostram histórico, mas ainda falta uma linha diagnóstica única para configurado/preferido/efetivo/cobrado.
- J5.6 Bloquear `/model <id>` enganoso quando BYOK está ativo e orientar alteração por env/restart. Status: feito nesta revisão.
- J5.7 Criar `/byok reload`. Status: feito nesta revisão.
- J5.8 Criar `/byok profiles`. Status: feito nesta revisão.
- J5.9 Criar `/byok use <perfil|sdk>`. Status: feito nesta revisão.
- J5.10 Criar `/byok model <id>`. Status: feito nesta revisão.
- J5.11 Criar `/byok provider <preset> [model] [baseUrl]`. Status: feito nesta revisão.
- J5.12 Criar `/byok persist` atômico/redigido para editar `.env.local` sem expor segredo. Status: feito nesta revisão.
- J5.13 Criar `/byok models refresh` com descoberta forçada. Status: feito nesta revisão.
- J5.14 Mostrar fonte do catálogo (`provider`, `provider-cache`, `static`, `static-fallback`) no terminal. Status: feito nesta revisão; a listagem padrão agora é paginada em 24 itens, com `all`/`<n>` para ampliação.
- J5.15 Integrar BYOK em `/events sources` como fonte pública de provider/config sem fanout paralelo. Status: feito nesta revisão.
- J5.16 Impedir que `lastPrInfo` histórico sobrescreva o modelo ativo no prompt e na linha de espera. Status: feito nesta revisão; live sem PR confirmou `kilo-auto/free` no prompt.
- J5.17 Mostrar usage BYOK como telemetria LLM, não Premium Request. Status: feito nesta revisão; live real confirmou `[LLM] ... classe=byok_user_message`.
- J5.18 Reduzir ruído de `/byok models refresh` em catálogos remotos grandes sem impedir inspeção completa. Status: feito nesta revisão.
- J5.19 Mostrar tags operacionais por modelo (`free|metered|cost?`, reasoning, vision, contexto, pricing, provider). Status: feito nesta revisão.
- J5.20 Criar uma recomendação interativa ainda mais forte (`/byok recommend`, filtros `free`, `vision`, `reasoning`, `ctx>`) a partir do mesmo ranking. Status: ampliado nesta revisão; a recomendação agora considera o contexto vivo quando disponível e remove candidatos incompatíveis com `safe`.
- J5.21 Mostrar limites free/operacionais (`maxReq`, `TPM`, `RPM`, `RPD`) em status, catálogo e recomendação. Status: feito nesta revisão.
- J5.22 Implementar admission control antes de turno BYOK longo, usando limites declarados e estimativa do contexto atual. Status: feito nesta revisão para limites declarados; `/byok recommend` usa o mesmo contexto vivo. Falta calibrar tokenização por modelo/provider.
- J5.23 Criar `/byok providers` como cockpit redigido de providers, perfis prontos e comandos diretos. Status: feito nesta revisão.
- J5.24 Unificar filtros de `/byok models` e `/byok recommend` para provider, free, metered, cost?, reasoning, vision, safe, ctx e maxReq. Status: feito nesta revisão.
- J5.25 Distinguir explicitamente "free confirmado" de "custo desconhecido" na recomendação e nos testes live. Status: feito nesta revisão para o cockpit; falta enriquecer docs/provider metadata quando APIs públicas expuserem limites.
- J5.26 Criar visão agregada multi-provider sem alternar perfil ativo (`/byok models all-providers` e `/byok recommend all-providers`). Status: feito nesta revisão, com `profile=` por modelo e filtros compartilhados.
- J5.27 Separar capacidade semântica de reasoning BYOK de `reasoningEffort` do SDK quando o id literal do provider contém `:`. Status: feito nesta revisão.
- J5.28 Narrar erros BYOK como erros de provider customizado, bloqueando fallback Copilot auto e orientando troca por `/byok use`/`/byok model`. Status: feito nesta revisão.
- J5.29 Agrupar visualmente modelos repetidos entre providers, preservando variantes por `profile`, preço, limites e auth. Status: feito nesta revisão via filtro `grouped`.
- J5.30 Encerrar turno/materialização como `failed` quando o provider BYOK falha antes de qualquer delta público. Status: feito nesta revisão; `/activity` deixa de mostrar turno preso como `active`.

Fase J6. Testes

- J6.1 Cobrir helpers de provider/env/redaction por unit test. Status: feito nesta revisão.
- J6.2 Cobrir `ClientOptionsBuilder` com `onListModels` BYOK e remoção de segredos do child env. Status: feito nesta revisão.
- J6.3 Criar fake SDK BYOK determinístico sem rede. Status: parcialmente feito por unit tests de resolução/comando; falta sessão SDK fake end-to-end.
- J6.4 Rodar live test com `/byok`, delta, tool, `ask_user` e elicitation quando disponível. Status: `/byok`, delta, tool e ask_user PASS em `artifacts/terminal-live/2026-05-21T12-12-19-528Z/summary.md` e `artifacts/terminal-live/2026-05-21T12-26-08-467Z/summary.md`; elicitation pendente.
- J6.5 Rodar smoke real Kilo/Ollama Cloud/OpenAI-compatible sem gravar segredo em artefato. Status: PASS em `artifacts/terminal-live/2026-05-21T12-12-19-528Z/summary.md`.
- J6.6 Adicionar comando live/harness específico para `/byok status`, `/byok models` e `/byok env` sem abrir turno. Status: feito nesta revisão com `--byok-probe`.
- J6.7 Cobrir `/byok profiles`, `/byok use`, `/byok model`, `/byok provider` e `/byok reload`. Status: profiles/use/model/reload cobertos por live real em `artifacts/terminal-live/2026-05-21T12-12-19-528Z/summary.md`; provider direto coberto por fixture em `artifacts/terminal-live/2026-05-21T11-50-03-576Z/summary.md`.
- J6.8 Cobrir descoberta remota, cache e fallback estático em unit tests. Status: feito nesta revisão.
- J6.9 Rodar smoke seguro de descoberta real usando apenas `.env.local`/env, sem colocar segredo no comando. Status: feito; sem chave Kilo local, resultado `skipped`.
- J6.10 Rodar live BYOK sem turno explícito para status/env/profiles/models/use-sdk/events/errors. Status: PASS em `artifacts/terminal-live/2026-05-21T11-33-14-457Z/summary.md`.
- J6.11 Rodar live BYOK com fixture efêmero para entrada em perfil, descoberta automática via `/v1/models`, troca de modelo dentro do perfil, troca para provider direto e retorno ao SDK na mesma sessão. Status: PASS em `artifacts/terminal-live/2026-05-21T11-50-03-576Z/summary.md`.
- J6.12 Garantir que `COPILOT_BYOK_MODEL` possa sobrescrever apenas o modelo de um `COPILOT_BYOK_PROFILE` ativo, preservando provider/credenciais/capabilities do perfil. Status: feito nesta revisão, com unit test e live fixture PASS.
- J6.13 Rodar live BYOK real com Kilo e Ollama Cloud validando prompt ativo, delta parcial, tool, `ask_user`, resposta humana, pós-ask, SSE/JSONL/export, ausência de duplicação e usage sem PR. Status: PASS em `artifacts/terminal-live/2026-05-21T12-40-35-670Z/summary.md` e `artifacts/terminal-live/2026-05-21T12-45-53-564Z/summary.md`.
- J6.14 Fazer o live runner falhar automaticamente se usage de modelo BYOK aparecer como `[PR]` ou se faltar `byok_user_message` em turno real. Status: feito nesta revisão.
- J6.15 Cobrir paginação padrão de `/byok models` por unit test. Status: feito nesta revisão.
- J6.16 Cobrir presets universais OpenRouter/Groq/Gemini/Cerebras/Cloudflare por unit test. Status: feito nesta revisão.
- J6.17 Cobrir metadata rica e ranking free-first por unit test. Status: feito nesta revisão.
- J6.18 Rodar probe real de catalogo multi-provider sem vazar segredos. Status: feito nesta revisão; todos os providers novos testados em descoberta/fallback.
- J6.19 Rodar probe real sem PR com troca Groq -> OpenRouter, limites explícitos e recomendação operacional. Status: PASS em `artifacts/terminal-live/byok-real-groq-openrouter-nopr-recommend-2026-05-21/summary.md`.
- J6.20 Rodar turno funcional em provider novo com contexto compatível com limite free. Status: pendente; Groq falhou por orçamento baixo em sessão longa, e o admission control/recommend agora bloqueiam esse tipo de chamada antes do SDK quando o limite declarado já foi excedido.
- J6.21 Rodar probe real sem PR Gemini -> Mistral cobrindo provider cockpit, catálogo filtrado e recomendação sem assumir gratuidade. Status: PASS em `artifacts/terminal-live/byok-real-gemini-mistral-nopr-2026-05-21-r2/summary.md`.
- J6.22 Rodar probe real sem PR NVIDIA NIM -> Cerebras cobrindo provider cockpit, catálogo filtrado, troca de provider/modelo e ausência de vazamento. Status: PASS em `artifacts/terminal-live/byok-real-nvidia-cerebras-nopr-2026-05-21/summary.md`.
- J6.23 Rodar probe real sem PR Hugging Face -> Chutes cobrindo provider cockpit, catálogo filtrado, troca de provider/modelo e ausência de vazamento. Status: PASS em `artifacts/terminal-live/byok-real-huggingface-chutes-nopr-2026-05-21/summary.md`.
- J6.24 Rodar live Kilo real completo após os hardenings de BYOK/reasoning/fallback, cobrindo delta, tool, `ask_user`, pós-ask, SSE, `/events`, `/tools`, `/usage`, `/health` e export. Status: PASS em `artifacts/terminal-live/2026-05-21T17-25-49-956Z/summary.md`.
- J6.25 Cobrir `/byok models all-providers`, `/byok models all-providers grouped` e `/byok recommend all-providers` por unit test e por comando operacional real sem segredo. Status: feito nesta revisão.
- J6.26 Rodar turno funcional OpenRouter free usando um modelo recomendado alternativo ao que retornou 400. Status: pendente.
- J6.27 Investigar Gemini 403 separando Google AI Studio, Google Cloud e compatibilidade OpenAI endpoint, sem imprimir chave. Status: pendente.
- J6.28 Rodar live Kilo real após correção do harness pós-ask, garantindo que comandos diagnósticos não entrem no meio do stream. Status: PASS em `artifacts/terminal-live/byok-kilo-canonical-after-runner-fix-2026-05-21/summary.md`.
- J6.29 Rodar live Cerebras real para validar caminho negativo de provider: catálogo/cockpit/recomendação OK, erro sem fallback Copilot, turno `failed`, sem secret leak e sem Premium Request. Status: BLOCKED por provider em `artifacts/terminal-live/byok-cerebras-failure-after-turn-fail-2026-05-21/summary.md`, com terminal/harness corretos.
- J6.30 Rodar live BYOK real validando saúde operacional no cockpit e recomendação segura. Status: PASS em `artifacts/terminal-live/byok-kilo-health-cockpit-pass-2026-05-21/summary.md`, com `/byok providers` exibindo `chat=ok` e `/byok recommend reasoning safe` carregando a evidência do turno real.

Fase J7. Providers amplos

- J7.1 OpenAI direto. Status: suportado por contrato; pendente smoke.
- J7.2 Azure OpenAI nativo. Status: suportado por contrato; pendente smoke.
- J7.3 Azure AI Foundry como OpenAI-compatible. Status: suportado por contrato; pendente smoke.
- J7.4 Anthropic direto. Status: suportado por contrato; pendente smoke.
- J7.5 Ollama local. Status: suportado por contrato; pendente smoke.
- J7.6 Ollama Cloud. Status: perfil real exercitado no live BYOK; catálogo remoto disponível. Falta turno funcional dedicado no provider.
- J7.7 LiteLLM/vLLM/routers locais. Status: suportado por contrato OpenAI-compatible; pendente smoke.
- J7.8 Kilo Gateway/Kilo Code. Status: PASS em live real com `kilo-auto/free`; catálogo remoto de 346 modelos; modelo pago `kilo-auto/balanced` bloqueado por créditos do provider.
- J7.9 OpenRouter. Status: preset, key local, catalogo real `358` modelos, `28` free; default movido para modelo `:free` real; alternância real sem PR passou. Falta turno funcional live.
- J7.10 Groq. Status: preset, key local, catalogo real `16` modelos, limites `maxReq`/`TPM` declarados localmente e alternância real sem PR passou. Turno funcional em sessão longa bloqueado por orçamento do provider; requer admission/fresh-session.
- J7.11 Gemini OpenAI-compatible. Status: preset, key local e catalogo real `53` modelos. Falta turno funcional live e validar diferenca entre Google AI Studio e Google Cloud key.
- J7.12 Mistral. Status: preset, key local e catalogo real `64` modelos. Falta turno funcional live.
- J7.13 Hugging Face Router. Status: preset, key local e catalogo real `129` modelos. Falta turno funcional live e filtros por politica `:fastest|:cheapest|:preferred`.
- J7.14 Cloudflare Workers AI. Status: preset e key/account local; OpenAI-compatible chat suportado, mas `/models` retornou `405`, entao fallback estatico esta correto. Falta probe de chat.
- J7.15 NVIDIA NIM. Status: preset, key local e catalogo real `117` modelos. Falta turno funcional live.
- J7.16 Cerebras. Status: preset, key local, catalogo real `4` modelos e live negativo validado: provider falha em `model_call`, terminal bloqueia fallback Copilot, encerra turno como `failed` e orienta troca de modelo/provider. Falta descobrir modelo/configuração funcional.
- J7.17 Chutes. Status: preset, key local e catalogo real `13` modelos com pricing. Falta turno funcional live.
- J7.18 Z.AI. Status: preset, key local e catalogo real `7` modelos. Falta turno funcional live.

## Execução Iniciada Nesta Revisão

Implementado:

- `runTerminalRuntimeConfigPhase()` agora aguarda `ctx.wireRuntime()`.
- Tipos JSDoc de `wireRuntime` aceitam `Promise<void>`.
- Reflection loop captura exceções síncronas e rejeições assíncronas com `toError()`.
- SIGHUP ganhou política explícita via `shouldRegisterTerminalSighupHandler()`.
- Mensagens de usage agora diferenciam "Premium Request classificada" de "Telemetria LLM sem Premium Request".
- A apresentação canônica de tools ignora nomes genéricos (`unknown`, `tool`, `external_tool`) quando há fallback real.
- O handler de `assistant.message_delta` agora tem contrato explícito: preserva chunks repetidos legítimos e deduplica por identidade de evento.
- Teste live completo com LLM-B reproduziu a duplicação de `ask_user`, delta final e fontes paralelas de delta.
- `question.pending` deixou de imprimir pergunta no fluxo normal; `user_input.requested` do SDK é a única apresentação canônica de `ask_user`.
- `assistant.message` tardio agora é reconciliado contra materialização ativa ou recém-concluída do turno antes de renderizar novo bloco visual.
- `dialog.delta` passou a prevalecer como fonte canônica de delta no cliente de diálogo; `task.delta` posterior é ignorado como cópia derivada.
- O live runner agora falha explicitamente em duplicação visual de `ask_user`, duplicação visual do delta final e reentrada paralela de `task.delta` após `dialog.delta`.
- `toError()` agora serializa objetos de erro sem `message`, preserva `stack`/`code` quando existirem e evita o diagnóstico inútil `[object Object]`.
- Auditoria externa 2 foi lida integralmente, validada criticamente e incorporada como achados A13/A14.
- `dialog-runtime.js` agora permite retry após falha de import lazy e expõe estado de carregamento sem falsear queue depth.
- `turn-display.js` sanitiza ANSI/OSC/controles antes de renderizar chunks não confiáveis e expõe `releaseDisplayState()` para liberação segura.
- `engine.js` libera display state no `finally`, inclusive em erro de SDK após início de streaming/reasoning.
- `sse.js` normaliza payloads públicos com BigInt/circular/string gigante e isola falhas de archive/fanout.
- `engine-persistence.js` contabiliza falhas de write e descartes da fila de notificação.
- `turn-reconciliation.js` preserva Markdown/quebras do sufixo original.
- `agent-messaging.js` corta `task.delta` na origem quando o dialog loop está ativo; `task.delta` deixou de ser rota paralela durante turnos explícitos.
- `events/intent-renderer.js` deduplica intents semanticamente equivalentes vindos de `assistant.intent`, `report_intent` e `report_intent_local`.
- `commands/export.js` recupera envelope de origem também de `terminalStreamingDiagnostics`, garantindo `source/trace` em export Markdown.
- `terminal-agent-wiring.js` promove `dialog.turn_end` a evento explícito, não passthrough residual, para que finais sem `assistant.message` tenham rota canônica.
- O live runner agora exige marcador pós-`ask_user`, aguarda continuação antes de comandos diagnósticos e trata `session.error` como falha terminal capturável.
- Rodada live `2026-05-20T18-24-53-129Z` confirmou que o runner antigo interferia no pós-ask ao diagnosticar logo após resposta humana.
- Rodada live `canonical-flow-codex-post-ask-continuation-2026-05-20` expôs falha externa/SDK `CAPIError: Connection error` antes do ask_user e gerou novo gap A17.
- `agent-messaging.js` agora distingue tasks `user_queue` e `dialog_boot`; requeue pós-reconexão de `dialog_boot` é bloqueado para evitar prompt duplicado.
- BYOK foi investigado contra documentação oficial do GitHub, documentação oficial do Kilo Gateway e pacote local `@github/copilot-sdk@0.3.0`.
- `sdk/session/provider.js` agora resolve presets BYOK, perfis declarativos, Kilo Gateway, valida env, redige segredos, cria resumo seguro e fornece `onListModels` assíncrono com descoberta remota/cache/fallback.
- `ClientOptionsBuilder` registra `onListModels` BYOK e remove segredos BYOK do env repassado ao child CLI.
- As sessões da LLM-B recebem `provider`, modelo explícito e `modelCapabilities` pelo fluxo canônico de sessão SDK.
- `/byok` foi adicionado ao terminal com status, modelos descobertos, perfis, reload de `.env.local`, troca SDK/perfil/modelo/provider e contrato de env sem expor credenciais.
- Templates `.env*`, schema e guia de env foram atualizados com contrato BYOK, perfis e Kilo Gateway.
- BYOK foi ampliado para presets universais OpenRouter, Groq, Gemini, Mistral, Hugging Face Router, Cloudflare Workers AI, NVIDIA NIM, Cerebras, Chutes e Z.AI, todos pelo fluxo nativo `provider` do SDK.
- `.env.local` permanece o arquivo unico do operador para segredos e perfis; `.env.local.example` agora documenta a topologia multi-provider sem segredos.
- `readConfiguredByokModelsFromEnv()` preserva metadata rica vinda de `COPILOT_BYOK_MODELS_JSON`, em vez de reduzir cada objeto a `id`.
- `discoverConfiguredByokModelsFromEnv()` enriquece catalogos remotos com contexto, modalidades, pricing/free-tier, provider e parametros suportados.
- `/byok models` passou a ranquear por `free -> capability -> context` e exibir tags operacionais por modelo.
- Probe real de catalogo multi-provider validou OpenRouter, Groq, Gemini, Mistral, Hugging Face, NVIDIA NIM, Cerebras, Chutes e Z.AI; Cloudflare Workers AI caiu corretamente para fallback estatico porque `/models` retornou `405`.
- A porta de configuração `src/copilot/config/byok.js` evita que agent/terminal importem diretamente internals do SDK, mantendo a arquitetura de aliases/barrels.
- O runner live foi corrigido para detectar o pós-`ask_user` apenas depois da resposta humana, removendo falso negativo gerado pelo próprio prompt.
- `/status`, `/health`, `/model` e auto-brief agora mostram BYOK redigido; `/model <id>` é bloqueado quando BYOK governa o provider customizado via env.
- `terminal-agent-wiring.js` descreve `reconnect_restart` como preservação sem replay, com `promptReplayBlocked=true` no SSE.
- `task-stream-events.js` mostra `task.error` com `requeueBlocked=true` como "prompt preservado sem reenvio automático".
- `/events sources` agora mostra a autoridade canônica das superfícies críticas: delta público, final textual, ask_user e lifecycle de tools.
- `event-adapter-events.js` passou a conter `TERMINAL_PUBLIC_STREAM_SOURCE_POLICIES`, prendendo em código quais fontes são aceitas, suprimidas e fallback.
- `TERMINAL_PUBLIC_STREAM_SOURCE_POLICIES` agora cobre também elicitation, permission, estado do dialog loop, usage telemetry, erro de sessão e lifecycle do terminal, com classe explícita (`content`, `interaction`, `tool`, `state`, `telemetry`, `diagnostic`, `lifecycle`).
- `/events sources` passou a exibir a classe da fonte, deixando claro se a superfície é conteúdo, interação, tool, estado, telemetria, diagnóstico ou lifecycle.
- O teste arquitetural de eventos agora impede bypass do fanout durável: `eventFanout.publish()` não pode surgir fora de `dialog/sse.js`, e escrita no archive não pode aparecer fora do ponto único de fanout e do próprio arquivo de archive.
- `events/event-adapter-events.js` foi reclassificado como `watch` no `module-map.js`, pois a matriz canônica cresceu e passou a ser peça de governança ativa, não arquivo estável pequeno.
- `tool-activity-presenter.js` passou a recuperar a identidade real da tool em `data`, `payload`, `input`, `args` e `arguments` serializado quando o SDK envia nomes genéricos como `unknown`, `tool` ou `external_tool`.
- `tool-lifecycle-runtime.js` agora registra lifecycle nativo com o nome efetivo do presenter, reduzindo a chance de `tool.lifecycle` nascer com identidade genérica quando o payload já traz uma identidade melhor.
- `tool-activity-presenter.js` foi reclassificado como `hotspot` no `module-map.js`; a próxima subonda deve modularizar identity resolution, target summary e rendering text para reduzir tamanho sem quebrar o fluxo único.
- `agent-runtime-events.js` deixou de narrar erro recuperável de `model_call` como `fallback=auto`; agora descreve roteamento/retry delegado ao SDK, explicita que `auto` é a única recuperação permitida quando aplicável e que não há Premium Request confirmada.
- Repetições idênticas de `model_call` recuperável continuam auditáveis via SSE, mas não poluem o histórico/PTY a cada ocorrência dentro da janela de throttle.
- `/events sources [n]` agora consulta o archive SSE e mostra `recentes=N` por política, permitindo identificar rapidamente quando uma superfície pública está materializando eventos demais ou duplicados.
- Boot HTTP deixou de morrer em `EADDRINUSE` e passou a realocar a porta do inject server com UX/comandos refletindo a porta efetiva.
- O live runner canônico agora evita colisão de porta antes do boot e coleta SSE na porta efetiva escolhida.
- `task.delta` público fora de turno agora fecha materialização canônica; `assistant.message` posterior suprime duplicata exata ou renderiza apenas o sufixo faltante.
- O live runner agora classifica rate limit do SDK como blocker de causa raiz, evitando falso diagnóstico em cascata.
- `/usage now` e `/metrics` agora diferenciam snapshot histórico de PR de consumo atual do boot/probe.
- `dialog.loop.changed` equivalente agora é deduplicado na borda terminal/SSE.
- `dialog.turn_end` truncado agora é reconciliado contra materialização/transcript recente: se `assistant.message` completo já cobriu o texto, o evento segue em SSE/auditoria, mas não abre bloco `Continuação da LLM-B`.
- O live runner agora falha explicitamente em `no-truncated-turn-end-duplication` quando `dialog.turn_end` repete prefixo longo de `assistant.message`.
- O live runner ganhou `--byok-probe`, que executa `/byok`, `/byok env`, `/byok profiles`, `/byok models refresh`, `/byok use sdk`, `/events` e `/errors` sem abrir turno LLM.
- O live runner ganhou `--byok-fixture`, que sobe um provider OpenAI-compatible local efêmero com `/v1/models`, injeta um perfil BYOK sem segredo real e valida `/byok use <perfil>`, descoberta automática, `/byok model <id>`, `/byok provider <preset> <model> <baseUrl>`, `/byok use sdk`, `/events` e `/errors` sem abrir turno LLM.
- A resolução BYOK agora trata perfil como baseline e permite override transiente apenas de `COPILOT_BYOK_MODEL`; assim o operador consegue trocar modelo dentro do mesmo provider/perfil sem perder baseUrl, token, capabilities nem metadata.
- `agent.error` recuperável de `model_call` não polui mais `/errors`; ele permanece auditável como evento público/atividade de retry.
- `agent:task:error` deixou de gerar entrada sintética duplicada `event-bus` no `ErrorTracker`.
- `task.error` de rate limit deixou de duplicar `session.error` em `/errors` e deixou de aparecer como "Tarefa interna falhou · 0 chunks" na timeline terminal.
- `toError()` agora preserva `errorMessage` e `detail` de objetos SDK antes de serializar payload bruto.
- `runtime-root.js` agora emite `terminal.runtime.wired` e `terminal.runtime.wire_failed` com fase, duração e diagnóstico normalizado.
- `/events sources` classifica os eventos de fiação do runtime em `terminal.lifecycle`.
- `/events sources` agora imprime comandos de investigação por política (`/events event=... 50` e `/events source=... 50`), reduzindo atrito para rastrear duplicações.
- O prompt vivo e o waiting prompt agora usam o modelo ativo do runtime (`state.model`) como identidade canônica; `lastPrInfo` histórico não sobrescreve mais BYOK/modelo atual.
- Sessões BYOK agora carregam metadados seguros de provider/perfil/preset no runtime para que a telemetria não dependa de inferência frágil.
- `assistant.usage` de mensagem humana em BYOK passou a ser classificado como `byok_user_message`, com `premiumRequest=false` e sem emissão de `pr.consumed`.
- O live runner passou a exigir `byok-real-usage-not-pr` e `byok-real-usage-classified` em execuções BYOK reais com turno funcional.
- O live runner agora reaplica o modelo principal após alternância temporária de provider em BYOK real, detecta blocker de provider BYOK antes do timeout, evita `EPIPE` ao fechar terminal e só dispara diagnósticos pós-`ask_user` depois que o turno estabiliza.
- `agent-runtime-events.js` encerra materialização e turn trace como `failed` quando `model_call` BYOK falha, de modo que `/activity` mostre falha concluída em vez de turno preso como ativo.
- `/byok models` passou a mostrar uma página padrão menor em catálogos grandes, mantendo `/byok models all` e `/byok models <n>` para inspeção ampla.
- Testes unitários adicionados para runtime root, reflection sync failure e SIGHUP policy.
- Testes unitários adicionados para reconciliação de `assistant.message` materializado, supressão visual de `question.pending` e preferência `dialog.delta`.
- Testes unitários adicionados para normalização de objetos de erro sem `message`.
- Testes unitários adicionados para lazy import resiliente, sanitização terminal, release de display state, safe SSE payload e sufixo final formatado.
- Teste unitário adicionado para deduplicação visual de intents equivalentes.
- Testes unitários adicionados para bloqueio de reenvio automático de task `dialog_boot` após reconexão, UX/SSE de prompt preservado e mapa `/events sources`.
- Testes unitários adicionados para realocação de porta no boot HTTP e modo strict sem fallback.
- Testes unitários adicionados para decisão `suppress/render_suffix/render_full` entre delta público e `assistant.message`.
- Live `--no-pr` passou em `artifacts/terminal-live/2026-05-20T18-55-53-045Z/summary.md`.
- Live completo `artifacts/terminal-live/2026-05-20T19-05-51-881Z/summary.md` ficou bloqueado por rate limit antes de delta/tool/ask_user; não valida o cenário funcional.
- Live completo desta rodada ficou `BLOCKED` por rate limit em `artifacts/terminal-live/codex-continue-2026-05-20-full/summary.md`.
- Live `--no-pr` desta rodada passou em `artifacts/terminal-live/codex-continue-2026-05-20-no-pr-rerun/summary.md`.
- Live completo pós-correção passou em `artifacts/terminal-live/2026-05-21T10-22-43-042Z/summary.md`: deltas parciais, final, tool, `ask_user`, resposta humana, continuação pós-ask, `/events`, `/events --raw`, `/tools diag`, `/health`, `/errors` e export.
- Live completo com BYOK/discovery já integrado passou em `artifacts/terminal-live/2026-05-21T11-14-22-468Z/summary.md`: deltas, tool, `ask_user`, resposta humana, `llm.usage`, `/events`, SSE HTTP e export. A inspeção manual desse artefato revelou o gap A29 de `dialog.turn_end` truncado, corrigido logo depois.
- Live completo pós-A29 em `artifacts/terminal-live/2026-05-21T11-26-10-340Z/summary.md` validou boot, SSE, tool e `ask_user`, mas ficou incompleto por timeout antes da continuação pós-ask; o runner agora classifica esse caso como blocker `live-timeout`.
- Live BYOK sem PR passou em `artifacts/terminal-live/2026-05-21T11-33-14-457Z/summary.md`: `/byok`, `/byok env`, `/byok profiles`, `/byok models refresh`, `/byok use sdk`, `/events`, `/events --raw` e `/errors`, sem abrir turno explícito.
- Live BYOK fixture sem PR passou em `artifacts/terminal-live/2026-05-21T11-50-03-576Z/summary.md`: perfil `codex-fixture`, descoberta automática `fonte=provider` via endpoint local `/v1/models`, catálogo `fixture/model-a|fixture/model-b|fixture/model-remote-c`, troca runtime para `fixture/model-b`, troca para provider direto `fixture/model-c`, retorno ao SDK, `/events`, `/events --raw` e `/errors`, sem vazamento do token fictício e sem turno explícito.
- Live BYOK real sem PR passou em `artifacts/terminal-live/2026-05-21T12-02-58-405Z/summary.md`: `.env.local` recarregado, perfil Kilo ativo, catálogo Kilo remoto disponível, perfil alternativo Ollama Cloud exercitado, `/events`, `/events --raw`, `/metrics`, `/errors`, sem turno explícito e sem vazamento de segredos.
- Live BYOK real completo passou em `artifacts/terminal-live/2026-05-21T12-12-19-528Z/summary.md`: Kilo `kilo-auto/free`, troca de modelo dentro do Kilo, alternância para Ollama Cloud, deltas parciais, bloco final, tool, `ask_user`, resposta humana, continuação pós-ask, telemetry sem Premium Request, SSE/JSONL/export e ausência de duplicação.
- Live sem PR pós-correção do prompt passou em `artifacts/terminal-live/2026-05-21T12-34-44-644Z/summary.md`: BYOK persistido entrou no boot, auto-brief ready mostrou `kilo-auto/free`, prompt exibiu `você[kilo-auto…/high]›`, `/usage` manteve telemetria PR histórica separada e `/errors` ficou limpo.
- Live BYOK real pós-correção de usage passou em `artifacts/terminal-live/2026-05-21T12-40-35-670Z/summary.md`: Kilo/Ollama Cloud, deltas, tools, `ask_user`, pós-ask, prompt ativo e arquivo durável seguiram íntegros, e a usage do turno BYOK foi renderizada como `byok_user_message` sem Premium Request.
- Live BYOK real com guarda automática de usage passou em `artifacts/terminal-live/2026-05-21T12-45-53-564Z/summary.md`: além do circuito completo, o summary agora prova explicitamente que o modelo BYOK não apareceu como `[PR]` e que a primeira usage foi `byok_user_message`.
- Live Kilo real pós-correção do harness passou em `artifacts/terminal-live/byok-kilo-canonical-after-runner-fix-2026-05-21/summary.md`: deltas parciais, final, tools, `ask_user`, pós-ask, `/events`, `/events --raw`, `/tools`, `/health`, export e ausência de duplicação.
- Live Cerebras real pós-correção de erro ficou `BLOCKED` em `artifacts/terminal-live/byok-cerebras-failure-after-turn-fail-2026-05-21/summary.md`: o terminal/harness se comportaram corretamente e o bloqueio ficou atribuído ao provider/modelo.
- A saude operacional BYOK agora e alimentada por eventos reais de runtime: `agent.error` de `model_call` marca provider/perfil/modelo como `chat=failed`, enquanto `llm.usage` BYOK sem PR marca sucesso. `/byok providers`, `/byok models` e `/byok recommend` mostram essa evidencia, e `safe` deixa de recomendar modelos com falha real recente mesmo quando o catalogo remoto ainda lista o modelo.
- Testes unitarios cobrem cockpit de providers com `chat=ok`, exclusao de modelo falho em `/byok recommend safe` e exibicao de `chat=failed` em `/byok models` quando o operador decide inspecionar sem `safe`.
- Live BYOK real com health cockpit passou em `artifacts/terminal-live/byok-kilo-health-cockpit-pass-2026-05-21/summary.md`: `/byok providers` pós-turno mostrou `chat=ok`, `/byok recommend reasoning safe` preservou a saúde operacional, e o harness confirmou deltas, final, tools, `ask_user`, pós-ask, SSE/export e ausência de duplicações.
- Teste unitário de `/byok models` cobre limitação padrão de 24 itens e ampliação explícita por número.
- Probe BYOK real sem PR em `artifacts/terminal-live/2026-05-21T12-50-11-039Z/summary.md` confirmou catálogo Kilo remoto paginado (`24/346`), troca de modelo, alternância para Ollama Cloud, SSE/control plane e ausência de vazamento de segredos.
- Live BYOK real com `kilo-auto/balanced` ficou `BLOCKED` por `byok-provider-credits` em `artifacts/terminal-live/2026-05-21T12-03-39-776Z/summary.md`; o runner agora classifica esse caso como falha externa de créditos/modelo, não como bug do terminal.
- Smoke BYOK local sem rede validou `ollama-local`, normalização de `baseUrl` para `/v1`, modelo explícito e resumo sem segredo.
- Testes BYOK desta rodada validaram Kilo Gateway como OpenAI-compatible, perfil ativo por `COPILOT_BYOK_PROFILE`, resumos redigidos e comandos `/byok profiles`, `/byok use` e `/byok model`.
- Teste BYOK adicional validou override transiente de modelo mantendo provider e credenciais do perfil ativo.
- Descoberta automática BYOK foi adicionada para providers OpenAI-compatible: endpoint explícito ou `<baseUrl>/models`, timeout, TTL cache, fonte visível em `/byok models` e fallback estático redigido.
- Smoke seguro de descoberta real foi executado sem colocar chave no comando; como `.env.local`/env não continham chave Kilo, o resultado foi `skipped`.
- `node --check scripts/copilot/run-terminal-llm-b-live-test.mjs`, parse de `.env.schema.json`, busca anti-vazamento dos segredos fornecidos, typecheck strict, lint e unit copilot passaram nesta trilha.
- Testes unitários adicionados para recoverable `model_call` não poluir `/errors`, para `task.error` de rate limit não duplicar `session.error`, e para `agent:task:error` não criar erro sintético `event-bus`.
- Testes unitários adicionados para `terminal.runtime.wired`, `terminal.runtime.wire_failed` e hints de investigação em `/events sources`.
- Testes unitários adicionados para BYOK provider/env/redaction/model list e para `ClientOptionsBuilder` com `onListModels` e remoção de segredos do child env.
- Testes unitários adicionados para suprimir prefixo truncado de `dialog.turn_end` quando transcript completo já foi materializado por `assistant.message`.
- Teste unitário adicionado para `dialog.turn_end` emitir lifecycle sem `reply` quando o transcript já foi materializado.
- O live runner agora analisa blocos estruturados do terminal para detectar duplicação final, evitando falso positivo quando uma regex atravessa de `🧠 LLM-B` para `[LLM-B] Mensagem`.

Próxima rodada recomendada:

1. Rodar turno funcional live com OpenRouter free em modelo recomendado alternativo ao que retornou `400`, validando deltas, final, tools, `ask_user`, usage sem PR, retorno ao SDK e ausência de duplicações.
2. Calibrar estimativa BYOK por provider/modelo com tokenização real quando disponível, mantendo fallback conservador por bytes UTF-8.
3. Persistir no artefato live uma seção explícita de recomendação contextual quando `contextWindow` estiver disponível.
4. Persistir a saúde operacional BYOK redigida entre sessões, usando a trilha JSONL/camada de estado existente, para que `chat=failed`/`chat=ok` sobreviva a restart sem criar novo fanout.
5. Expandir o cenário live para elicitation quando a capability estiver disponível.
6. Fechar a recuperação `session.error`/`reconnect_restart`, distinguindo retry real de reenvio ambíguo de prompt.
7. Criar contrato único de modelo configurado/preferido/efetivo/cobrado, incluindo billing/effective model real em BYOK.
8. Expandir smoke de elicitation real em BYOK e fake SDK end-to-end sem rede.
9. Rodar turno funcional dedicado em Ollama Cloud e, quando disponível, Ollama local/LiteLLM/vLLM.
10. Continuar a normalização de tool identity em completions/progress externos sem requestId, com métricas para qualquer lifecycle ainda genérico.
11. Integrar falha de `wireRuntime()` ao `ErrorTracker` com metadados de fase.
12. Investigar Gemini 403 com probes de autenticação redigidos, distinguindo chave Google AI Studio, chave Google Cloud e endpoint OpenAI-compatible.
