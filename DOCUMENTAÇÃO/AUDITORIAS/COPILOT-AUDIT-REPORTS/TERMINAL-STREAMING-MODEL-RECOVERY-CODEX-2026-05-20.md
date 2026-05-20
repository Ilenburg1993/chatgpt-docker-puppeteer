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

Falta: repetir uma rodada live estável sem falha externa de CAPI para confirmar o marcador pós-ask ponta a ponta.

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
- Diagnósticos são evidência, não maquiagem: se o backend falha, a UX mostra a falha e o fluxo backend é corrigido.

## Roadmap

### Faixa A. Boot, Lifecycle E Recursos

Fase A1. Fiação do runtime

- A1.1 Aguardar `wireRuntime()` no boot. Status: feito.
- A1.2 Cobrir `wireRuntime()` assíncrono por teste unitário. Status: feito.
- A1.3 Emitir evento `terminal.runtime.wired` com duração e resultado. Status: pendente.
- A1.4 Registrar falha de `wireRuntime()` no error tracker com `phase=runtime-config`. Status: pendente.

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
- B3.2 Criar classificador `sdkUsage`, `tokenUsage`, `billingUsage`, `premiumRequest`. Status: pendente.
- B3.3 Mostrar "PR desconhecida" quando não houver prova. Status: pendente.
- B3.4 Provar que `ask_user` não é PR no relatório live. Status: pendente.

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
- I1.2 Classificar cada emissor como fonte canônica, adaptador, fallback ou legado. Status: iniciado nesta revisão.
- I1.3 Bloquear novos eventos públicos fora de `broadcastSse()` por teste arquitetural. Status: pendente.
- I1.4 Expor `/events sources` ou `/health` com contagem por fonte/adaptador. Status: pendente.

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
- `terminal-agent-wiring.js` descreve `reconnect_restart` como preservação sem replay, com `promptReplayBlocked=true` no SSE.
- `task-stream-events.js` mostra `task.error` com `requeueBlocked=true` como "prompt preservado sem reenvio automático".
- Testes unitários adicionados para runtime root, reflection sync failure e SIGHUP policy.
- Testes unitários adicionados para reconciliação de `assistant.message` materializado, supressão visual de `question.pending` e preferência `dialog.delta`.
- Testes unitários adicionados para normalização de objetos de erro sem `message`.
- Testes unitários adicionados para lazy import resiliente, sanitização terminal, release de display state, safe SSE payload e sufixo final formatado.
- Teste unitário adicionado para deduplicação visual de intents equivalentes.
- Testes unitários adicionados para bloqueio de reenvio automático de task `dialog_boot` após reconexão e para UX/SSE de prompt preservado.

Próxima rodada recomendada:

1. Criar teste arquitetural que impeça evento público fora de `broadcastSse()` e classifique emitters canônicos/adapters/fallbacks.
2. Fechar a recuperação `session.error`/`reconnect_restart`, distinguindo retry real de reenvio ambíguo de prompt.
3. Normalizar wording de usage para remover qualquer ambiguidade residual com Premium Request.
4. Criar contrato único de modelo configurado/preferido/efetivo/cobrado.
5. Atacar `tool unknown` por normalização central, não por casos especiais de renderer.
6. Adicionar eventos de boot `runtime.wired` e falha de fase.
7. Expandir o cenário live para elicitation quando a capability estiver disponível.
