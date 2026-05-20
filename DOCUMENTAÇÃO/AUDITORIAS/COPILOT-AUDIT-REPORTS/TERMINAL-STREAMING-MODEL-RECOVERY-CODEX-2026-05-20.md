# Terminal LLM-B: streaming, modelo e recuperacao de erro - auditoria Codex

Data: 2026-05-20
Escopo: `src/copilot`, com foco em `terminal:llm-b`, fluxo SDK, dialog loop, deltas publicos, tools, usage e recuperacao de modelo.

## Sumario executivo

O relatorio da LLM-B (`TERMINAL-STREAMING-DELTA-AUDITORIA-COMPLETA.md`) acerta ao apontar que o terminal ainda precisa de um contrato unico para deltas, transcript final, SSE e diagnostico. Ele tambem acerta ao exigir envelopes causais para que o sistema deixe de depender de heuristicas temporais.

Mas ha uma correcao importante: a conclusao de que a janela `CROSS_CHANNEL_DELTA_SUPPRESSION_WINDOW_MS=75` deve ser simplesmente removida esta incompleta. Teste live anterior mostrou duplicacao real quando `task.delta` e `dialog.delta` entregam o mesmo chunk do SDK. A situacao ideal nao e "sem dedupe"; e dedupe por identidade causal (`eventId`, `causationId`, `streamId`, `chunkSeq`, `source`). Ate essa identidade existir em todos os canais, a janela curta cross-channel deve permanecer como guard operacional, com documentacao honesta.

O log fornecido pelo usuario revela um segundo eixo critico, nao tratado com profundidade suficiente no relatorio da LLM-B: apos `/model gpt-5.4`, o SDK emite `session.model_change`, mas os turnos seguintes entram em `hook:error_occurred` recuperavel com `errorContext=model_call`. A UX mostrava apenas alertas genericos de erro e retries, sem aplicar fallback live para `auto`, sem explicar causa provavel e sem impedir ruido no ErrorTracker. Isso gera a percepcao correta de que "nada aparece", embora o problema raiz seja backend/model routing preso em erro recuperavel.

Revisao adicional desta rodada: `assistant.usage` no SDK 0.3.0 e telemetria de chamada LLM (tokens, custo, quota, modelo, `initiator`, `parentToolCallId`), nao prova isolada de Premium Request consumido. O fluxo antigo convertia todo `assistant.usage` em `pr.consumed`; isso era incorreto especialmente apos `ask_user`, que existe justamente para manter o dialog loop vivo sem abrir novo turno pago. O contrato canonico agora e: `assistant.usage -> llm.usage` sempre; `pr.consumed` apenas quando a usage for classificada como `premium_request` por uma causa user-initiated explicita.

## Evidencias observadas

- `terminal:llm-b` inicia com `COPILOT_MODEL=auto`, mas o modelo efetivo observado e `gpt-5.3-codex`.
- `/model list` lista `gpt-5.4` como disponivel.
- `/model gpt-5.4` muda o modelo configurado e o SDK emite `Modelo SDK: auto -> gpt-5.4`.
- No turno seguinte, o log do agente mostra repetidos `SDK errorOccurred [model_call]: Erro do SDK sem mensagem estruturada. (recuperavel: true)`.
- O EventBus materializava `hook:error_occurred` sem `errorMessage`, entao o `error-alerter` imprimia `ALERTA: hook:error_occurred` opaco.
- O hook retornava `retry`, mas nao mudava o modelo vivo para `auto`; em erro de roteamento/modelo explicito, o retry repetia o mesmo alvo.
- O fallback existente era acionado apenas para `rate_limit`/`quota` e, ainda assim, focado em proximo boot do dialog loop.
- O terminal nao escutava o evento interno `error` do agente no mesmo nivel de UX em que escuta tools, usage, background e fallback.
- O teste live confirmou que `session.error` de rate limit podia aparecer duplicado porque `sdk-responses.js` e `session-lifecycle.js` emitiam o mesmo evento. O dono canonico deve ser `session-lifecycle.js`.

## Validacao do relatorio da LLM-B

### Validado

- Deltas publicos devem aparecer assim que o SDK emitir `assistant.message_delta`.
- `assistant.message` deve servir como integridade/fallback, sem duplicar texto ja streamado.
- Thinking deve ficar separado de transcript publico e acessivel via `/thinking`.
- SSE e terminal local precisam compartilhar contrato de eventos.
- O roadmap deve incluir envelopes causais, replay, backpressure e testes de duplicacao/perda.
- A documentacao anterior estava imprecisa ao dizer que toda supressao por chunk repetido tinha sido removida.

### Corrigido

- A deduplicacao cross-channel de 75ms nao e apenas drift. Ela cobre uma falha real de causalidade: o mesmo delta pode chegar por dois canais locais. Remover isso agora reabre duplicacao visivel.
- A causa do "terminal sem resposta" no log de `/model gpt-5.4` nao e somente renderer/delta. E tambem erro recuperavel de `model_call` sem recuperacao live para `auto`.
- O ErrorTracker nao deve tratar todo `hook:error_occurred` recuperavel de `model_call` como erro terminal de sessao. Ele deve ser evento operacional com acao clara.

## Situacao atual

### Streaming

- `assistant.message_delta` e roteado por `event-handlers/streaming.js`.
- Quando o dialog loop esta ativo, o delta vira `dialog.delta`.
- Fora de loop ativo, ele vira `task.delta`, desde que o agente nao esteja em `processing`.
- `turn-display.js` ja renderiza chunks publicos sem aguardar 48 caracteres.
- `public-assistant-stream.js` permite exibir deltas fora de turno explicito.
- `task-transcript-accumulator.js` evita duplicar transcript no fechamento quando o stream ja foi renderizado.

### Streaming apos a rodada de correcao

- `dialog.delta` e `task.delta` carregam envelope causal com `streamId`, `chunkSeq`, `source`, `eventId` quando existir, `causationId` e `ts`.
- `client-dialog.js` deduplica primeiro por identidade causal; a janela temporal cross-channel permanece apenas como fallback degradado para eventos sem identidade.
- SSE `delta` recebe metadados causais suficientes para consumidores externos reconstruirem ordem e origem do stream.
- `terminal/dialog/turn-reconciliation.js` substitui a comparacao bruta por decisao explicita: `none`, `suffix` ou `full`.
- `task.delta` sem `taskId` usa `streamId` como chave quando disponivel, e uma chave interna legivel quando nao ha identidade; `__anonymous__` fica tratado como legado de exibicao, nao como chave operacional nova.

### Lacunas restantes de streaming

- Replay SSE, persistencia de historico e export ainda precisam carregar a mesma causalidade completa do delta em todos os artefatos de consulta posterior.
- A janela temporal degradada em `client-dialog.js` ainda deve ser metrificada para sabermos quando ela deixou de ser necessaria.
- O terminal ainda deve diferenciar explicitamente no `/activity` "SDK nao emitiu delta publico" de "delta emitido mas streaming visual desligado".
- Testes live precisam cobrir uma resposta longa com deltas reais do SDK, pois respostas curtas podem chegar apenas como mensagem final.

### Modelo e fallback

- O default de boot e `auto`, com preferencia local por `gpt-5.4/high` apenas advisory.
- O operador pode selecionar modelo explicito com `/model <id>`.
- O SDK pode aceitar `session.model_change` e ainda assim falhar no `model_call` seguinte.
- Antes desta rodada, erro recuperavel de `model_call` nao acionava fallback live para `auto`.
- Antes desta rodada, o terminal nao explicava esse erro como evento operacional de modelo.

### UX e observabilidade

- Tools, usage e assistant.message ja possuem renderizacao rica.
- Background interno foi parcialmente filtrado, mas eventos de erro recuperavel ainda vazavam como ruido bruto.
- `hook:error_occurred` era emitido no EventBus sem mensagem normalizada.
- `error-alerter` elevava erro recuperavel de modelo a `ERROR`, repetindo linhas quase identicas.
- Antes desta rodada, `event-handlers/usage.js` tratava qualquer `assistant.usage` como `pr.consumed`. Isso misturava telemetria LLM com billing/PR e fazia continuacoes de `ask_user` parecerem novo consumo.

## Situacao ideal

1. O terminal deve expor tudo que a LLM-B escreve publicamente, em tempo real, sem duplicacao.
2. Thinking nao deve poluir transcript; deve ser armazenado e consultavel por `/thinking`.
3. Todo delta publico deve carregar envelope causal: `streamId`, `chunkSeq`, `source`, `eventId`, `causationId`, `turnId`, `taskId`.
4. Dedupe deve ser por identidade causal, nao por igualdade textual.
5. Enquanto a identidade causal nao for completa, dedupe temporal cross-channel deve ser restrito, observavel e documentado.
6. `assistant.message` final deve reconciliar o stream parcial: completar lacunas, registrar divergencias e evitar duplicacao.
7. Erro recuperavel de `model_call` em modelo explicito deve aplicar fallback live para `auto`, emitir evento de modelo e permitir retry em rota saudavel.
8. Erro recuperavel de modelo deve aparecer no terminal como aviso operacional, nao como alarme opaco.
9. ErrorTracker deve priorizar falhas reais; recoverable model-call deve ir para timeline/audit, nao poluir `/errors` como fatalidade.
10. `/model` deve informar que modelo explicito e tentativa operacional; `auto` continua sendo fallback canonico.
11. `/quit` durante erro de modelo deve encerrar limpo, sem continuar despejando alerta opaco.
12. Documentos de arquitetura devem distinguir claramente display dedupe, bridge dedupe, SSE replay e transcript reconciliation.
13. `assistant.usage` deve ser sempre auditavel como `llm.usage`, mas nunca deve implicar `pr.consumed` sem classificacao causal.
14. `ask_user` deve ser tratado como continuacao de input humano dentro do mesmo dialog loop; usage gerado apos sua resposta deve aparecer como `ask_user_continuation`, nao como novo PR.
15. Testes live da LLM-B devem ser canônicos, versionados e opt-in: o roteiro precisa cobrir deltas parciais, final, tools, ask_user, usage, errors, health e transcript, com artefatos persistidos.

## Roadmap

### Faixa A - Recuperacao de modelo e erro recuperavel

- A1. Enriquecer `hook:error_occurred` com `errorMessage`, `errorContext`, `recoverable`.
- A2. Classificar `model_call` recuperavel como evento operacional de modelo.
- A3. Aplicar fallback live para `auto` quando modelo explicito falhar em `model_call`.
- A4. Emitir `pr.fallback_model` tambem para fallback live, com `trigger` e `reason`.
- A5. Reduzir ruido do `error-alerter` para recoverable model-call.
- A6. Evitar que recoverable model-call polua ErrorTracker como erro fatal.
- A7. Mostrar aviso claro no terminal: falha recuperavel, fallback `auto`, proximo retry.
- A8. Validar `/model gpt-5.4` -> falha -> fallback `auto` sem travamento.

### Faixa B - Envelope causal de streaming

- B1. Criar tipo interno `AssistantDeltaEnvelope`.
- B2. Enriquecer `event-handlers/streaming.js` com `source='sdk.assistant.message_delta'`.
- B3. Propagar `eventId`/`deltaId` quando o SDK fornecer.
- B4. Criar `streamId` por mensagem/turno quando o SDK nao fornecer identidade.
- B5. Incrementar `chunkSeq` por sessao/stream.
- B6. Propagar envelope por `dialog.delta` e `task.delta`.
- B7. Atualizar `client-dialog.js` para dedupe por causalidade. **Implementado.**
- B8. Manter fallback temporal somente como modo degradado mensurado. **Parcialmente implementado; falta metrica dedicada.**
- B9. Emitir SSE `delta` com envelope completo. **Implementado para os campos ja disponiveis.**
- B10. Adicionar testes de repeticao legitima: `sim, sim` nao pode virar `sim`.
- B11. Adicionar testes de duplicacao cross-channel: mesmo eventId nao pode duplicar stdout.

### Faixa C - Transcript e reconcile final

- C1. Consolidar estado unico de turn materialization.
- C2. Registrar deltas parciais com envelope.
- C3. Comparar texto parcial renderizado com `assistant.message` final. **Implementado em `turn-reconciliation.js`.**
- C4. Se final for superset limpo, renderizar apenas sufixo ausente. **Implementado.**
- C5. Se houver divergencia, registrar warning e preferir final em historico persistido. **Implementado para UX; persistencia enriquecida ainda pendente.**
- C6. Persistir metadados de mismatch para `/activity` e `/audit`.
- C7. Evitar footers finais com TTFT incorreto quando delta chegou antes da primeira mensagem final.

### Faixa D - UX operacional

- D1. Separar visualmente mensagens publicas da LLM-B, tools, warnings de modelo, usage e background.
- D2. Garantir que erro recuperavel durante render lock nao destrua bloco de resposta.
- D3. Colocar recoverable model-call em timeline com acao sugerida.
- D4. Mostrar fallback live como evento de modelo, nao como consumo de PR.
- D5. Reduzir mensagens de persistencia interna por padrao.
- D6. Melhorar `/activity` para exibir ultimo erro recuperavel de modelo e ultimo fallback.
- D7. Melhorar `/model` para deixar explicito: configurado, efetivo, cobrado, e fallback aplicado.

### Faixa E - SSE e replay

- E1. Unificar payloads `delta`, `assistant.message`, `dialog.reply`.
- E2. Garantir event IDs monotonicamente rastreaveis no replay buffer.
- E3. Adicionar replay por `Last-Event-ID` para deltas criticos.
- E4. Medir backpressure e quedas.
- E5. Nunca descartar deltas publicos sem registrar metrica.

### Faixa F - Testes live e regressao

- F1. Testar `oi` com resposta curta.
- F2. Testar resposta longa com deltas parciais.
- F3. Testar repeticoes legitimas.
- F4. Testar `/model gpt-5.4` em ambiente onde o SDK falha e confirmar fallback `auto`.
- F5. Testar `/quit` durante turno com erro recuperavel.
- F6. Testar tools, report_intent, usage, permissions e ask_user no mesmo turno.
- F7. Rodar `typecheck:strict:src.copilot`, `lint:copilot`, `test:copilot:unit`.

## Implementacao iniciada nesta rodada

- Criada politica canonica `decideModelCallAutoFallback`.
- Hook do SDK agora aplica fallback live para `auto` em `model_call` recuperavel quando o modelo atual e explicito.
- EventBus de hooks passa a carregar `errorMessage` normalizada.
- Error alerter reduz severidade/ruido de `model_call` recuperavel e nao polui ErrorTracker.
- Terminal passa a ouvir `error` do agente e renderizar aviso operacional de modelo.
- `session.error` deixa de ser emitido por `sdk-responses.js`; `session-lifecycle.js` fica como fluxo unico para esse evento.
- Documento de arquitetura de delta foi corrigido para distinguir dedupe removido no display e dedupe cross-channel ainda necessario no bridge.
- `assistant.message_delta` agora gera envelopes locais com `streamId`, `chunkSeq`, `eventId` quando disponivel, `source` e `ts`.
- `dialog.delta`/`task.delta` propagam esses envelopes; consumidores antigos continuam recebendo apenas `chunk`.
- O SSE `delta` passa a incluir metadados causais quando disponiveis, preparando a remocao futura da janela temporal cross-channel.
- `assistant.usage` deixou de ser sinonimo de `pr.consumed`: foi criado classificador canonico que emite `llm.usage` para toda telemetria LLM e so emite `pr.consumed` quando ha `user.message` pendente classificado como `premium_request`.
- Continuacoes de `ask_user`, usage com `initiator`, usage com `parentToolCallId` e usage sem `user.message` ficam como `llm.usage` sem novo PR, com `classification`, `premiumRequest:false` e `premiumRequestReason`.
- O terminal passou a narrar `llm.usage` sem novo PR como evento separado de `pr.consumed`, inclusive com classe/motivo/tokens quando disponiveis.
- `lastPrInfo` e a persistencia "Persist latest PR consumption snapshot" agora so sao atualizados por `premium_request`; telemetria LLM nao-premium nao sobrescreve snapshot de PR.
- Criado runner opt-in `npm run terminal:llm-b:live-test`, que sobe `terminal:llm-b`, envia um roteiro canonico, responde `ask_user`, coleta stdout bruto/plain e grava relatorio JSON/MD com criterios objetivos.
- Runner live usa PTY por padrao (`script`) para validar a UX real do VS Code task terminal; modo headless fica apenas como diagnostico.
- Respostas humanas de `ask_user` agora registram um guardiao local de eco e sao suprimidas em `assistant.message`, `dialog.delta` e `task.delta` quando o SDK ecoa exatamente o valor respondido.

## Validacao live

- `terminal:llm-b` iniciou em `auto/high` e retomou sessao SDK sem boot prompt.
- Turno curto em `auto` respondeu corretamente com modelo efetivo `gpt-5.3-codex/high`.
- A tentativa live com `/model gpt-5.4` confirmou bloqueio real de rate limit semanal do SDK: reset informado para 2026-05-24 21:00. Esse caso nao deve ser mascarado como bug de renderer; deve ser mostrado como estado de modelo/quota e conduzido para `auto`.
- A duplicacao visual de `session.error` observada no teste live foi classificada como fluxo paralelo e corrigida deixando `session-lifecycle.js` como dono unico.

## Revisao Codex atualizada - 2026-05-20

Esta revisao cruza o log live fornecido pelo usuario, o relatorio da LLM-B e o codigo atual em `src/copilot`. A conclusao central permanece: o terminal nao pode ser o lugar onde se esconde bug de SDK, runtime, session ou dialog loop. Ele deve ser a materializacao final de um fluxo unico, causal e auditavel.

### Implementado e confirmado em codigo

- Deltas publicos agora chegam ao terminal pelo caminho canonico `assistant.message_delta -> dialog.delta/task.delta -> onDelta -> turn materialization -> render`.
- O `onDelta` aceita envelope causal sem quebrar consumidores antigos.
- O bridge local deduplica primeiro por identidade causal (`eventId`, `causationId`, `streamId`, `chunkSeq`) e usa janela temporal apenas quando nao ha identidade suficiente.
- Chunks cumulativos vindos de canais diferentes sao normalizados por sufixo antes da renderizacao, impedindo duplicacoes como `okok-live-live`.
- `turn-reconciliation.js` decide explicitamente entre nao renderizar final, renderizar apenas sufixo ou renderizar final completo em caso de mismatch.
- `assistant.message` final deixou de ser um segundo caminho bruto de renderizacao e virou fonte de integridade/fallback.
- O estado de materializacao do turno guarda causalidade dos deltas ja observados.
- `task.delta` sem `taskId` deixou de depender de nova chave operacional `__anonymous__`; usa `streamId` quando existe e chave interna legivel quando nao existe.
- `report_intent` e mensagens publicas da LLM-B sao mantidos na timeline/terminal como eventos persistentes, nao flashes efemeros.
- `session.error` passou a ter dono unico; `sdk-responses.js` nao duplica o fluxo de `session-lifecycle.js`.
- Erro recuperavel de `model_call` em modelo explicito aciona fallback live para `auto`.
- `hook:error_occurred` carrega mensagem e contexto normalizados.
- `error-alerter` reduz ruido de erro recuperavel de modelo e evita transformar isso em erro fatal opaco.
- O terminal escuta fallback de modelo e mostra evento operacional com causa e transicao.
- O recovery automatico pos-resume tenta reanexar a sessao com `resumeSessionAttach:true`, sem boot prompt.
- O fallback automatico do boot recovery para `startDialogLoop()` com PR agora e bloqueado por padrao.
- O fallback pago de boot recovery so e permitido se `LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK=true`.
- Quando esse fallback e bloqueado, o terminal registra `dialog.boot_recovery` com `skippedPrFallback:true`, detalhe de erro e narrativa clara.
- A assinatura do gateway de dialogo agora documenta envelopes de delta no tipo JSDoc.
- `report_intent`/`report_intent_local` agora tambem entram na telemetria canonica de `/tools diag` quando completam pelo lifecycle do terminal.

### O que falta implementar

- Persistir no historico de conversa os metadados de mismatch final/parcial, nao apenas na UX/timeline.
- Expor no `/activity` contadores dedicados para `delta causal`, `delta temporal fallback`, `delta cumulative normalized`, `delta suppressed` e `final suffix`.
- Propagar causalidade completa tambem em replay SSE, historico persistido e export Markdown; `assistant.message` e `dialog.reply` ja carregam envelope live.
- Medir quantas vezes a janela temporal degradada em `client-dialog.js` ainda e usada; a meta e tornar essa dependencia rara e, depois, removivel.
- Criar comando/diagnostico de streaming que diga claramente: SDK nao emitiu delta, delta emitido mas display desligado, delta emitido e renderizado, ou delta emitido e reconciliado no final.
- Expor no `/usage now` e `/status` a distincao entre `boot/resume zero-PR`, `turn billed`, `explicit /turn`, `direct chat bridge` e `recovery PR fallback`.
- Expor no `/usage now` tambem o ultimo `llm.usage` classificado, separado do ultimo `pr.consumed`, para acabar com a ambiguidade entre token telemetry e Premium Request. **Implementado.**
- Unificar payloads SSE de `delta`, `assistant.message`, `dialog.reply`, `user_input.*`, `tool.*` e `pr.consumed` com um envelope comum de `traceId/turnId/eventId/source`. **Parcialmente implementado: o stream SSE global agora recebe um `eventId` canonico unico por broadcast e o propaga ao pool `/events` sem regravar o replay; `delta`, diagnosticos, `assistant.message`, `dialog.reply`, `user_input.*`, `tool.lifecycle`, `llm.usage`, `pr.consumed`, `pr.fallback_model`, `session.error`, `session.info`, `session.warning`, `assistant.intent`, eventos SDK vanilla, eventos de background/shell/compaction, watchdog/dialog lifecycle, reasoning, busy e boot signals ja carregam `source/timestamp` e `traceId/turnId` quando ha materializacao/trace ativa. Ainda falta provar isso em live real cruzando stdout/SSE/activity por `traceId`.**
- Revisar o fluxo de `requestHeaders` em `runTerminalDialogTurnDetailed`: hoje ele pode parar dialog loop e usar direct chat, portanto deve ser exibido como caminho que pode consumir PR.
- Criar teste unitario para boot recovery com env `LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK=true`, garantindo que o fallback pago e deliberado e observavel.
- Criar teste live automatizavel que obrigue resposta longa o suficiente para observar varios deltas, uma tool, usage e `ask_user`.
- Evoluir o runner live para fase de elicitation estruturada com resposta automatica segura, mantendo isso opt-in e separado do turno LLM principal.
- Criar fixture de SDK fake para simular `assistant.message_delta` cumulativo, incremental, duplicado por canais diferentes e final divergente.
- Fechar lacunas de replay/backpressure no SSE: nenhum delta publico deve ser descartado sem metrica.
- Melhorar `/model` para mostrar historico curto: configurado, efetivo, cobrado, ultimo fallback e causa.
- Melhorar `/health` para apontar quando ha risco de PR no caminho selecionado.

### O que deve ser descartado

- Descartar a ideia de remover toda deduplicacao textual imediatamente. Isso reabre duplicacao cross-channel enquanto o SDK/runtime ainda nao fornecem causalidade perfeita em todos os eventos.
- Descartar fallback automatico pago durante boot recovery. Recovery automatico deve preservar zero-PR; consumo pago exige comando explicito ou env declarativa.
- Descartar UX que imprime `hook:error_occurred` cru. O operador precisa de causa, contexto, retry/fallback e acao sugerida.
- Descartar chaves operacionais novas como `__anonymous__` para eventos sem identidade. Quando nao houver identidade real, usar chave interna claramente marcada e nao apresentada como ator.
- Descartar fluxos paralelos para `session.error`, transcript final, usage e tools. Cada evento deve ter dono canonico.
- Descartar a regra antiga `assistant.usage -> pr.consumed`. O fluxo correto e `assistant.usage -> llm.usage`, com `pr.consumed` derivado apenas por classificador causal.
- Descartar testes live de uma unica mensagem curta como criterio suficiente; respostas curtas frequentemente chegam sem delta parcial visivel.
- Descartar "bypass" de premium request como objetivo. O objetivo correto e impedir consumo acidental e tornar todo consumo observavel, nao contornar cobranca do provedor.

### Novos achados

- `boot-dialog-recovery.js` tinha fallback automatico para `ctx.startDialogLoop()` quando a reanexacao zero-PR falhava. Esse caminho podia parecer consumo de PR no boot, pois abria boot de dialog loop sem comando explicito do operador.
- A mensagem "Persist latest PR consumption snapshot" nao significa novo consumo por si. Ela e persistencia interna do ultimo snapshot de PR ja classificado. A distincao canonica agora e: `llm.usage` e telemetria de chamada LLM; `pr.consumed` e apenas usage classificado como `premium_request`.
- O log de `/model gpt-5.4` mostra duas coisas diferentes misturadas na percepcao do operador: configuracao do modelo mudou, mas o modelo efetivo/cobrado pode continuar roteado para outro alvo ou falhar em `model_call`. A UX deve sempre separar configurado, efetivo e cobrado.
- O caminho direct chat com `requestHeaders` ainda e potencialmente consumidor de PR e deve ser tratado como excecao operacional, nao como caminho normal do terminal.
- O teste live mais util nao e reiniciar muitas vezes o terminal. E iniciar uma vez, inspecionar `/status`, `/usage now`, `/activity`, executar um unico turno rico e fechar com `/quit`.
- O teste live Codex desta revisao confirmou que `report_intent` aparecia no transcript/timeline, mas nao entrava no agregado de `/tools diag`; isso foi corrigido contabilizando tools diagnosticas no lifecycle do terminal.
- O teste live Codex confirmou que responder `ask_user` com `SIM` pode fazer o SDK ecoar `SIM` por `assistant.message`/`assistant.message_delta`. Isso nao deve aparecer como fala da LLM-B: a fonte canonica e `user_input.completed`/`question.answered`. Foi criado guardiao local de eco humano para transcript e streaming.
- O SDK documenta `assistant.usage` como metricas de chamada LLM, com `initiator` e `parentToolCallId` para indicar origem. Portanto, usage sem `user.message` nao deve ser contado como PR por inferencia. Esse foi o bug semantico principal desta rodada.

### Roadmap refinado

#### Faixa G - Governanca zero-PR e consumo observavel

- G1. Bloquear por padrao fallback pago de boot recovery. **Implementado.**
- G2. Emitir `dialog.boot_recovery` quando fallback pago for bloqueado. **Implementado.**
- G3. Mostrar esse evento no terminal, timeline e SSE. **Implementado.**
- G4. Documentar `LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK` como opt-in operacional.
- G5. Adicionar `/usage now` com origem do ultimo consumo: boot, turn, direct-chat, recovery fallback ou unknown.
- G6. Marcar direct chat bridge como caminho PR-risk em `/activity`.
- G7. Diferenciar snapshot de PR de consumo real em todos os textos do terminal. **Implementado no terminal e em `/usage now`; falta ampliar para todos os exports/relatorios.**
- G8. Adicionar teste de regressao para nenhum boot recovery pago sem env.
- G9. Classificar `assistant.usage` por causa (`premium_request`, `ask_user_continuation`, `tool_originated`, `non_user_initiated`, `unattributed_llm_usage`). **Implementado.**
- G10. Impedir que `ask_user` gere `pr.consumed`. **Implementado com teste unitario.**
- G11. Impedir que usage com `initiator`/`parentToolCallId` gere `pr.consumed`. **Implementado com teste unitario.**
- G12. Adicionar `llm.usage` ao EventBus/terminal/SSE como canal canonico de telemetria nao ambigua. **Implementado.**
- G13. Expor ultimo `llm.usage` e classificacao no estado runtime/frontend, sem sobrescrever `lastPrInfo`. **Implementado no AgentContext, runtime overview, terminal gateway e `/usage now`.**

#### Faixa H - Streaming live end-to-end

- H1. Registrar metrica `delta.causal.accepted`. **Implementado em `stream-diagnostics-state.js` e alimentado por `client-dialog.js`.**
- H2. Registrar metrica de fallback temporal cross-channel. **Implementado como `deltaTemporalFallbackSuppressed`; o nome anterior `accepted` foi descartado porque o fallback temporal existe para supressao defensiva, nao para aceite.**
- H3. Registrar metrica `delta.cumulative_suffix.normalized`. **Implementado como `deltaCumulativeNormalized` + eventos recentes com `reason=cumulative_snapshot`.**
- H4. Registrar metrica `delta.duplicate.suppressed`. **Implementado para duplicata causal, fallback temporal, prefixo cumulativo e sufixo repetido.**
- H5. Expor as metricas em `/activity` e `/metrics`. **Implementado com secao `Streaming publico`, contadores e ultimas decisoes.**
- H6. Criar teste live guiado com resposta longa, tool, final message e ask_user.
- H7. Adicionar replay SSE de deltas por `Last-Event-ID`. **Parcialmente implementado: `broadcastSse()` grava o replay global uma unica vez, raw clients e `/events` compartilham o mesmo ID, e o pool Express nao duplica o buffer. O runner live agora coleta `/events`; falta assert live com turno real observando deltas no canal externo.**
- H8. Propagar `turnId` e `traceId` em todo delta. **Implementado para o renderer do dialog engine: `delta` SSE e diagnosticos de streaming recebem a correlacao da materializacao ativa.**
- H9. Persistir final reconciliation no historico/export.

#### Faixa K - Runner canonico de teste live LLM-B

- K1. Criar runner opt-in para `terminal:llm-b`, fora do CI padrão, com captura raw/plain. **Implementado em `scripts/copilot/run-terminal-llm-b-live-test.mjs`.**
- K2. Expor script npm dedicado. **Implementado: `npm run terminal:llm-b:live-test`.**
- K3. Suportar `--dry-run` para validar roteiro sem SDK/PR. **Implementado.**
- K4. Validar ready, deltas, tool start/done, ask_user visivel, resposta humana registrada, `llm.usage`, ausencia de erros e `/quit` limpo. **Implementado no runner.**
- K5. Persistir artefatos `terminal.raw.log`, `terminal.plain.log`, `summary.json`, `summary.md`. **Implementado.**
- K6. Adicionar fase opcional de elicitation estruturada (`/elicitation request-json` + resposta) sem bloquear readline.
- K7. Adicionar assert de final reconciliation mais preciso: stream parcial, final message e sufixo/mismatch, sem contar o bloco de integridade como duplicação falsa. **Parcialmente implementado: runner valida bloco final e nao trata prompt+parcial+final como duplicacao falsa.**
- K8. Adicionar assert de `pr.consumed` causal: um turno humano pode gerar PR, `ask_user` nao pode. **Parcialmente implementado: runner valida `llm.usage` separado e ausencia de eco de resposta; falta assert causal explicito sobre evento `pr.consumed`.**
- K9. Adicionar modo `--no-pr` que apenas inspeciona `/usage now`, `/activity`, `/metrics`, `/errors` e sai, para sanity check de boot/resume sem consumo. **Implementado no runner; o modo nao envia turno nem invoca tools.**
- K10. Adicionar integração com `/export` para comparar transcript persistido contra stdout plain.
- K11. Adicionar coleta SSE paralela de `GET :3009/events` para comparar terminal local e canal externo. **Implementado no runner: gera `terminal.sse.log`, `terminal.sse.jsonl`, criterios `sse-*` e resumo SSE no `summary.md`. Falta usar esses artefatos em um turno real com deltas.**
- K12. Adicionar relatório de gaps automatico no MD do runner quando algum critério falhar. **Parcialmente implementado: o runner grava criterios detalhados no `summary.md` e agora inclui contadores de `source`, `traceId` e overlap stdout/SSE; falta transformar falhas em recomendações acionáveis.**

#### Faixa I - Modelo, erro e recuperacao

- I1. Manter `auto` como fallback canonico unico. **Implementado.**
- I2. Remover qualquer fallback legado para modelos especificos diferentes de `auto`.
- I3. Mostrar reset/quota quando o SDK fornecer dado estruturado.
- I4. Mostrar fallback live no prompt/status ate o proximo usage confirmar modelo efetivo.
- I5. Garantir `/quit` limpo durante retries de modelo.
- I6. Evitar que watchdog reinicie loop se ha erro recuperavel de modelo em tratamento.

#### Faixa J - Ask user e fechamento de turno

- J1. Testar `ask_user` real no terminal live com resposta do operador.
- J2. Garantir que pergunta, choices, freeform e resposta fiquem em transcript/timeline.
- J3. Garantir que mailbox zero-PR aplicado em `ask_user` seja mostrado e persistido.
- J4. Unificar `user_input.requested/completed` com envelope de turno.
- J5. Expor perguntas pendentes em `/activity`, `/now` e `/health`.
- J6. Distinguir visualmente resposta humana encaminhada para `ask_user` de mensagem publica nova quando o SDK ecoar/confirmar o valor. **Implementado por guardiao local de eco humano em `assistant.message`, `dialog.delta` e `task.delta`.**
- J7. Garantir que usage apos resposta de `ask_user` seja explicado como fechamento do fluxo SDK, nao como boot ou recovery. **Implementado no classificador/terminal; live confirmou ausencia de novo `pr.consumed`, mas a ordem real do SDK ainda pode classificar a usage de fechamento como `non_user_initiated` quando `user_input.completed` chega tarde.**
- J8. Incluir `report_intent`/tools nativas de diagnostico no agregado de `/tools diag` ou documentar uma categoria separada de "diagnostico/intent". **Implementado para `report_intent`/`report_intent_local`.**

## Plano de validacao live recomendado

Para reduzir consumo desnecessario, cada rodada live deve iniciar o terminal uma unica vez em `auto/high` e executar:

1. `/status`, `/usage now`, `/activity 12`, `/tools diag`.
2. Um turno rico, de preferencia:

```text
Faca um teste integrado curto do terminal. Primeiro chame report_intent com o intent "teste live deltas tools ask_user". Depois leia as primeiras linhas de package.json usando read_file_content. Em seguida escreva uma resposta publica longa, em varias frases numeradas de DELTA-LIVE-1 ate DELTA-LIVE-8, para que o terminal consiga mostrar deltas parciais. Por fim chame ask_user perguntando "ASK-LIVE: responda SIM para fechar o teste". Nao use outras tools.
```

3. Responder `SIM` quando `ask_user` aparecer.
4. Rodar `/activity 30`, `/usage now`, `/tools diag`, `/errors 10`, `/health`.
5. Encerrar com `/quit`.

Alternativa canônica automatizada:

```bash
npm run terminal:llm-b:live-test -- --dry-run
npm run terminal:llm-b:live-test
```

O primeiro comando apenas grava o prompt canônico sem acionar SDK. O segundo executa o roteiro real e pode consumir uma Premium Request pelo turno humano explícito; por isso permanece fora do CI padrão.

O criterio de sucesso nao e "nao houve uso". Um turno real pode gerar `assistant.usage`. O criterio correto e: boot/resume nao gera consumo acidental, deltas parciais aparecem quando emitidos, final nao duplica stream, tools aparecem com nome/tempo/I-O, `ask_user` aparece e permanece consultavel, toda chamada LLM aparece como `llm.usage` classificado, e apenas consumo causalmente premium aparece como `pr.consumed` com modelo configurado/efetivo/cobrado.

## Validacao live Codex desta revisao

Comando: `npm run terminal:llm-b`, `COPILOT_MODEL=auto`, `TERMINAL_DISPLAY_PRESET=full`.

Resultados observados:

- Boot retomou sessao SDK existente sem boot prompt: `Reanexando sessão SDK sem boot prompt`.
- Antes do turno, `/activity 12` mostrou apenas eventos `boot` e `idle`; nao houve `pr.consumed` novo no boot.
- `/usage now` antes do turno mostrou apenas o ultimo turno anterior (`gpt-5.4-mini`, custo `0.3300`), confirmando que o snapshot exibido nao e sinonimo de novo consumo.
- O turno rico chamou `report_intent` e `read_file_content`.
- `read_file_content` mostrou tool start, I/O real e done com arquivo, bytes, engine e duracao: `package.json`, `63.7 KB`, `io-engine.fs.readFile.text`.
- Deltas parciais apareceram ao vivo em bloco longo `DELTA-LIVE-1` ate `DELTA-LIVE-8`; o stream completou a linha 6 e seguiu ate a 8 sem duplicacao do final.
- `assistant.message` final apareceu com o mesmo conteudo publico e nao duplicou o texto renderizado previamente.
- `ask_user` apareceu como pergunta persistente: `ASK-LIVE: responda SIM para fechar o teste`.
- A resposta humana `SIM` foi registrada em `/activity` como `question · answered`, com requestId e resposta.
- `/errors 10` retornou zero erros.
- `/health` retornou agente healthy, dialog loop ativo, `ask_user` nenhum pendente, tool stats de read/I-O.

Gaps observados no live:

- `report_intent` aparecia na timeline e no resumo de turno, mas nao aparecia em `/tools diag`; a superficie de stats foi ajustada apos o live para cobrir `report_intent`/`report_intent_local`.
- A resposta humana `SIM` ao `ask_user` apareceu inicialmente tambem como mensagem curta da LLM-B; isso foi corrigido depois com guardiao de eco humano para transcript e streaming.
- O modelo configurado ficou `auto`, mas o efetivo/cobrado mudou de `gpt-5.4-mini` para `gpt-5.3-codex` durante o turno. Isso e comportamento aceitavel do `auto`, mas `/status` e `/usage` devem continuar destacando configurado/efetivo/cobrado.

## Validacao live Codex - semantica de `llm.usage` e `pr.consumed`

Comando: `npm run terminal:llm-b`, `COPILOT_MODEL=auto`, `TERMINAL_DISPLAY_PRESET=full`.

Resultados observados:

- `/usage now` passou a exibir `Ultimo PR` separado de `Ultimo uso LLM`.
- O turno integrado mostrou deltas publicos, `report_intent`, `read_file_content`, I/O real e pergunta `ask_user`.
- `llm.usage` apareceu na timeline com classificacao e motivo, sem ser automaticamente transformado em `pr.consumed`.
- O live revelou que o SDK real pode emitir `initiator:user` na primeira usage de um turno humano. O classificador foi ajustado: `initiator:user` com `user.message` pendente e `premium_request`; `ask_user` continua tendo prioridade e permanece `ask_user_continuation`/zero-PR.
- Responder `SIM` ao `ask_user` registrou `question.answered` e nao gerou novo `pr.consumed` no live observado.
- `/errors 10` permaneceu limpo.

Gap restante:

- O SDK pode emitir usage de fechamento com `initiator:agent` antes de `user_input.completed`; nesse caso ela fica corretamente como "sem novo PR", mas nem sempre como `ask_user_continuation`. Falta enriquecer o classificador com sinal local de resposta humana pendente para melhorar a explicacao sem reabrir risco de falso PR.

## Validacao live Codex - runner canonico PTY

Comando: `npm run terminal:llm-b:live-test -- --transport=pty --timeout-ms=240000 --post-answer-delay-ms=6000`.

Artefato PASS: `artifacts/terminal-live/2026-05-20T09-47-12-519Z/summary.md`.

O runner agora sobe `terminal:llm-b` dentro de pseudo-terminal via `script`, em vez de pipes headless, porque a UX real do operador depende de readline/TTY. O modo headless permanece util como diagnostico via HTTP `/inject`, mas nao valida prompt, comandos e linha viva.

Critérios validados:

- ready/REPL interativo;
- deltas parciais e bloco final `DELTA-CANONICAL-1..8`;
- `report_intent` e `read_file_content` com start/done, tempo e I/O real;
- `ask_user` persistente e resposta humana registrada;
- resposta humana `SIM` nao renderizada como transcript nem delta da LLM-B;
- `llm.usage` separado de PR;
- `/errors 10` limpo;
- `/quit` limpo.

Achados novos do runner:

- O primeiro desenho do runner, com `stdin` em pipe, colocou o terminal em modo headless e nao exercitou a UX real. Corrigido com transporte PTY default.
- O criterio de duplicacao nao pode contar prompt + stream parcial + final como tripla duplicacao. Corrigido: duplicacao patologica agora foca marcadores anormais e eco humano.
- O SDK pode ecoar resposta humana de `ask_user` por canais publicos antes ou depois de `user_input.completed`. Corrigido com guardiao local registrado no momento em que o terminal envia a resposta humana.

## Atualizacao Codex - diagnostico canonico de streaming

Data: 2026-05-20.

Implementado nesta revisao:

- Criado `src/copilot/terminal/state/stream-diagnostics-state.js` como estado unico de decisoes de streaming publico.
- `client-dialog.js` agora emite diagnosticos para cada delta aceito, normalizado ou suprimido, incluindo origem, causal key, bytes/chars brutos, chars normalizados e motivo.
- A normalizacao de snapshots cumulativos deixou de ser uma string anonima e passou a produzir razao canonica: `raw`, `cumulative_snapshot`, `cumulative_prefix`, `duplicate_suffix` ou `overlap_normalized`.
- Duplicatas por causalidade e fallback temporal cross-channel agora ficam registradas; antes o operador so via "nada apareceu".
- `engine.js` registra reconciliação final (`already_streamed`, `stream_suffix`, `stream_mismatch`, `no_visible_stream`, `empty_reply`) junto com tamanhos de stream/final/rendered.
- `turn-display.js` registra quando o delta publico existe, mas o display de streaming esta desligado, distinguindo "nao houve delta" de "delta nao foi mostrado por politica de display".
- `/activity` ganhou a secao `Streaming publico`, com contadores e ultimas decisoes.
- `/metrics` ganhou contadores agregados de streaming publico.
- O SSE global deixou de ter múltiplos donos de replay: `terminal/dialog/sse.broadcastSse()` atribui um `eventId` unico, grava `getTerminalReplayBuffer()` uma vez, envia esse ID aos clientes raw legados e publica o mesmo ID no fanout interno. O router `/events` remove o metadado interno antes de expor o payload e entrega o evento sem regravar o replay global.
- O runner live ganhou `--no-pr`, uma rota de sanity check sem turno LLM: `/usage now`, `/activity`, `/metrics`, `/errors`, `/quit`.
- O runner live agora abre uma conexao SSE paralela em `GET :3009/events`, persiste raw/JSONL e valida conexao, ausencia de metadado interno vazado, IDs monotônicos e eventos publicos quando o roteiro real e executado.
- O runner live passou a calcular envelope/correlação do SSE: eventos com `source/eventSource`, eventos com `traceId`, lista de `traceIds` e overlap entre stdout plain e `terminal.sse.jsonl`.
- `delta` SSE passou a carregar `traceId` e `turnId` extraidos da materializacao ativa, e os diagnosticos de stream passaram a guardar a mesma correlacao. `assistant.message` tambem propaga `traceId/turnId` quando ocorre dentro de turno materializado.
- Testes unitarios foram adicionados/atualizados para o bridge de deltas e o novo estado de diagnostico.
- Teste unitario novo garante que dois raw clients + fanout `/events` nao incrementam o replay global mais de uma vez para o mesmo broadcast.
- Live `--no-pr` em PTY passou em `artifacts/terminal-live/no-pr-codex-2026-05-20-r2/summary.md`, validando boot/resume, `/usage now`, `/activity`, `/metrics`, `/errors` e `/quit` sem abrir turno, sem tools e sem erros.

Itens descartados/renomeados:

- `delta.temporal_fallback.accepted` foi descartado como nome canonico. O fallback temporal e uma heuristica de supressao quando falta causalidade, portanto o contador correto e `deltaTemporalFallbackSuppressed`.
- "Usage" nao deve mais ser usado como sinonimo de Premium Request em texto de operador, teste ou roadmap. O vocabulario canonico e `llm.usage` para telemetria de modelo e `pr.consumed` para consumo premium causal.

Pendencias apos esta revisao:

- Persistir diagnosticos de streaming/reconciliacao no historico conversacional e no `/export`, nao apenas no estado live. **Parcialmente implementado: o turno `llm_b` persistido no Hub agora recebe `metadata.terminalStreamingDiagnostics`, a timeline preserva metadata e `/export` imprime resumo quando disponivel. Falta propagar tambem para transcript live nao persistido e para sync lazy de bridge tail.**
- Propagar `traceId`/`turnId` aos diagnosticos e deltas SSE para correlação perfeita entre terminal, timeline, SSE e hub. **Parcialmente implementado para `delta`, diagnosticos de stream, `assistant.message`, `dialog.reply`, `user_input.*`, `tool.lifecycle`, usage/PR, session error/info/warning e eventos de fallback/recovery; falta correlacionar o runner externo automaticamente e varrer eventos residuais.**
- Adicionar assert live especifico para a secao `Streaming publico` no modo com turno real, alem do modo `--no-pr`.
- Coletar SSE paralelamente no runner para comparar stdout local, replay buffer e canal externo. **Implementado para coleta, criterios basicos e correlação stdout/SSE por `traceId`; falta validar isso em um turno real com deltas.**
- Enriquecer o classificador de `llm.usage` com sinal local de resposta humana pendente para explicar melhor fechamentos tardios de `ask_user`. **Implementado: usage emitido enquanto `user_input.requested` ainda esta pendente agora e classificado como `ask_user_continuation` com motivo `pending_user_input_request_continuation`, e o `user_input.completed` tardio nao cria uma segunda continuacao.**

## Atualizacao Codex - correlação canônica de user_input e tools

Data: 2026-05-20.

Implementado nesta revisao:

- Criado `src/copilot/terminal/state/turn-correlation-state.js` como helper unico para `traceId/turnId`, priorizando materializacao ativa de turno e usando turn-trace ativo como fallback.
- `turn-display.js`, `engine.js` e `sdk-session-events.js` deixaram de recalcular `traceId` localmente e passaram a usar a mesma projeção canonica.
- `assistant.message` continua correlacionado, agora pelo helper comum.
- `user_input.requested` e `user_input.completed` passam a sair no SSE com `traceId` e `turnId` quando ocorrem dentro de turno materializado/trace ativo.
- `tool.lifecycle` ganhou campos formais `traceId` e `turnId` no schema e todo broadcast de tools passa por `withTerminalTurnCorrelation`.
- Eventos de tool nativa, external tool, user-requested tool, io_op e completions reconciliadas agora compartilham o mesmo envelope minimo de turno.
- `llm.usage`, `pr.consumed`, `pr.fallback_model` e `dialog.boot_recovery` passaram a usar envelope SSE com `source`, `timestamp`, `traceId` e `turnId`.
- `dialog.reply`, `session.error`, `session.info` e `session.warning` passaram a emitir o mesmo envelope minimo de correlação.
- Testes unitarios cobrem correlação de `user_input.*` e `tool.lifecycle`, alem de manter regressao para IO/tool lifecycle existente.

Pendencias apos esta revisao:

- Persistir `traceId/turnId` dos eventos correlacionados no Hub/export, nao apenas no SSE live.
- Fazer o runner live real cruzar `stdout`, `terminal.sse.jsonl` e `/activity` por `traceId` para provar ausência de duplicação/perda entre canais.
- Auditar os poucos eventos de boot/replay que nao possuem turno ativo e garantir que consumidores externos saibam diferenciar `source` operacional de campos semanticos legados como `source` de mailbox.

## Validacao live Codex - SSE no runner sem PR

Comando: `npm run terminal:llm-b:live-test -- --no-pr --transport=pty --timeout-ms=120000 --out-dir=artifacts/terminal-live/no-pr-sse-codex-2026-05-20`.

Resultado: PASS em `artifacts/terminal-live/no-pr-sse-codex-2026-05-20/summary.md`.

Critérios relevantes:

- Boot/resume entrou em REPL interativo e nao abriu turno LLM.
- `/usage now`, `/activity`, `/metrics` e `/errors` renderizaram corretamente.
- O coletor SSE conectou em `/events` e recebeu `connected`.
- O payload publico SSE nao vazou `__terminalSseEventId`.
- O teste encerrou limpo via `/quit`.

## Validacao live Codex - envelopes sem PR

Comando: `npm run terminal:llm-b:live-test -- --no-pr --transport=pty --timeout-ms=120000 --out-dir=artifacts/terminal-live/no-pr-envelope-codex-2026-05-20`.

Resultado: PASS em `artifacts/terminal-live/no-pr-envelope-codex-2026-05-20/summary.md`.

Critérios relevantes:

- Terminal retomou sessão SDK e entrou em REPL interativo.
- Nenhum turno LLM explícito foi aberto durante o probe.
- `/usage now` mostrou telemetria de PR/contexto sem disparar novo consumo.
- `/activity` e `/metrics` exibiram a seção `Streaming público`.
- `/errors 10` permaneceu limpo.
- Coletor SSE conectou em `/events`, sem erro e sem vazamento de metadado interno.
- Encerramento limpo via `/quit`.

## Validacao live Codex - envelopes source sem PR

Comando: `npm run terminal:llm-b:live-test -- --no-pr --transport=pty --timeout-ms=120000 --out-dir=artifacts/terminal-live/no-pr-envelope-source-codex-2026-05-20`.

Resultado: PASS em `artifacts/terminal-live/no-pr-envelope-source-codex-2026-05-20/summary.md`.

Critérios relevantes:

- Boot/resume entrou no REPL interativo e não abriu turno LLM.
- `/usage now`, `/activity`, `/metrics` e `/errors 10` renderizaram sem erros.
- O coletor SSE conectou em `/events`, sem vazar `__terminalSseEventId`.
- O novo relatório do runner incluiu contadores de `source`, `traceId` e overlap stdout/SSE.
- Como o modo `--no-pr` não abriu turno, nenhum evento público com `traceId` era esperado; a validação de correlação completa permanece pendente para o roteiro live com turno real.

## Atualizacao Codex - classificacao tardia de ask_user

Data: 2026-05-20.

Implementado:

- `assistant.usage` que chega enquanto ha `user_input.requested` pendente agora e classificado como `ask_user_continuation`, mesmo se o SDK ainda nao emitiu `user_input.completed`.
- O classificador marca o requestId usado por essa usage; quando `user_input.completed` chega depois, ele nao incrementa uma segunda continuacao.
- O evento continua `llm.usage`, sem `pr.consumed`, preservando a regra de que `ask_user` nao abre Premium Request novo.
- Teste unitario cobre a ordem real observada no live: `user_input.requested -> assistant.usage(initiator:agent) -> user_input.completed -> assistant.usage(initiator:agent)`.

## Atualizacao Codex - envelopes SSE residuais

Data: 2026-05-20.

Implementado:

- Criado helper local de envelope para eventos vanilla do SDK em `sdk-session-events.js`, preservando a mesma regra de correlação por materialização ativa/turn trace.
- `assistant.turn_start/end`, `assistant.message`, `elicitation.*`, `permission.*`, `user_input.*`, `session.*`, `mcp.*`, `hook.*`, `sampling.*`, `commands.changed`, `capabilities.changed`, `auto_mode_switch.*`, `exit_plan_mode.*` e `assistant.reasoning_complete` passaram a carregar `source`, `timestamp` e `traceId/turnId` quando há turno ativo.
- Eventos normalizados do agent (`agent.error`, compaction, background, shell) agora usam o mesmo envelope de `source/timestamp/traceId/turnId`.
- O passthrough SSE estreito de eventos sem adapter dedicado deixou de repassar payload cru e passa a marcar `source=agent/passthrough/<evento>`.
- O wiring do terminal padronizou watchdog, dialog recovery/stalled/stopped/ready, streaming progress, session usage e compaction cache com envelope de terminal.
- `busy`, `reasoning`, `reasoning.complete`, `assistant.intent`, `terminal.started`, `skills.reloaded` e `activity.changed` passaram a carregar origem operacional explicita; nos eventos de mailbox que já tinham `source` semântico, foi adicionado `eventSource` para não corromper a origem da intervenção.
- Testes unitários de SDK session, agent runtime, passthrough e turn display foram atualizados para validar `source/timestamp/traceId` nos contratos principais.

Pendencias apos esta revisao:

- O contrato live ainda precisa provar a correlação em um turno real longo com delta parcial, final, tool, ask_user e SSE externo no mesmo `traceId`.
- A persistência Hub/export ainda deve guardar envelopes evento-a-evento, não apenas o resumo de streaming do turno.
- O runner live deve diferenciar automaticamente campos semânticos (`source` de mailbox/intenção) de origem operacional (`eventSource`) para evitar falsos positivos em auditoria.

Implementado adicionalmente nesta revisao:

- `summary.md` do runner agora mostra `Events with source`, `Events with traceId` e `TraceIds`.
- `evaluateSseCriteria()` valida `sse-source-envelope`, `sse-critical-events-sourced`, `sse-trace-envelope` e `sse-stdout-trace-overlap` no modo com turno real.
- O modo `--no-pr` continua sem exigir `traceId`, mas ainda valida que eventos SSE de objeto possuam origem operacional.

## Atualizacao Codex - persistencia/export de envelopes do transcript

Data: 2026-05-20.

Implementado nesta revisao:

- O transcript local do terminal (`transcript-state`) agora preserva `metadata` estruturada por mensagem, em vez de guardar apenas `role/content/source/timestamp`.
- Mensagens publicas vindas de `assistant.message` fora de turno ativo passam a carregar no transcript o envelope SSE normalizado (`assistantMessageEnvelope`) com `source/timestamp/traceId/turnId/eventId` quando disponivel.
- Complementos/finais renderizados pelo dialog engine passam a anexar ao transcript local o mesmo `terminalStreamingDiagnostics` persistido no Hub, eliminando a janela em que o texto aparecia ao vivo mas ainda nao tinha trilha auditavel antes do sync/persistencia.
- A projection de timeline deixou de descartar metadata de entradas `origin=terminal`; essa metadata agora aparece em `/history`, `/export` e sync lazy quando o Hub ainda nao era a fonte primaria.
- O sync lazy de bridge/transcript para Hub preserva `originalMetadata` e promove `terminalStreamingDiagnostics` para o turno persistido quando existir, evitando perda de diagnostico em mensagens fora do caminho principal de `persistTurnToHub`.
- O comando `/export` agora imprime resumo de envelope (`source`, `trace`, `turn`, `event`) e continua imprimindo resumo de streaming/reconciliacao quando `terminalStreamingDiagnostics` estiver presente.
- Testes unitarios cobrem export com envelope/streaming e timeline/sync de transcript local com metadata preservada.

Pendencias apos esta revisao:

- Persistir envelopes evento-a-evento completos do turno, nao apenas o resumo por mensagem/turno. Isso deve incluir deltas, tools, `user_input.*`, `permission.*`, `elicitation.*` e usage em uma estrutura consultavel.
- Fazer o runner live real executar `/export` ao final do roteiro e comparar o Markdown exportado com `terminal.plain.log` e `terminal.sse.jsonl`.
- Adicionar compactacao/limite inteligente para metadata de transcript quando o SDK gerar payloads grandes, mantendo hashes/referencias para o archive JSONL em vez de truncar silenciosamente.

## Atualizacao Codex - runner live com export auditavel

Data: 2026-05-20.

Implementado nesta revisao:

- O runner canônico `terminal:llm-b:live-test` agora executa `/export artifacts/.../conversation-export.md` no roteiro real, depois de `/usage now`, `/activity`, `/tools diag`, `/errors` e `/health`.
- O artefato `summary.md` ganhou referência ao Markdown exportado e status de inspeção do export.
- O `summary.json` agora inclui um bloco `export` com `ok`, caminho, presença de transcript, presença de diagnóstico de streaming e presença de envelope.
- Novos critérios do runner real: `export-created`, `export-transcript`, `export-streaming-diagnostics` e `export-envelope`.
- O modo `--no-pr` permanece sem `/export`, pois não abre turno nem deve produzir conversa nova.

Pendencias apos esta revisao:

- Rodar o roteiro live real com SDK após essa mudança para confirmar, no mesmo artefato, delta parcial, final, tool, ask_user, SSE externo e export Markdown.
- Comparar automaticamente trechos do Markdown exportado com `terminal.plain.log` e `terminal.sse.jsonl`, não apenas verificar presença de marcadores.
- Transformar falhas do runner em recomendações acionáveis no próprio `summary.md`.

## Atualizacao Codex - archive duravel evento-a-evento SSE

Data: 2026-05-20.

Implementado nesta revisao:

- Criado `src/copilot/terminal/state/sse-event-archive.js`, archive JSONL canonico para eventos publicos do terminal.
- A gravacao ocorre no ponto unico `broadcastSse()`, depois da atribuicao do `eventId` canonico e antes dos fanouts raw/socket/EventFanout. Isso evita instrumentacao paralela por tipo de evento.
- Cada linha JSONL inclui `schemaVersion`, `ts`, `timestamp`, `event`, `eventId`, `source`, `eventSource`, `traceId`, `turnId`, `hubSessionId` e `payload`.
- O archive usa fila assíncrona em batches, preservando a UX do terminal e expondo `queueDepth`, `flushScheduled`, `flushInFlight`, `failedEvents`, `droppedEvents`, `lastEventId`, `path` e `error`.
- O `/metrics` agora mostra uma seção `Archive SSE`, tornando visivel se a trilha duravel esta ativa, enfileirada, em falha ou saudavel.
- Testes unitarios validam que `broadcastSse()` continua usando um unico replay eventId e agora registra o mesmo evento no archive.

Pendencias apos esta revisao:

- Ampliar o comando `/events` para filtros de `toolCallId`, `requestId` e `hubSessionId`, mantendo os filtros ja criados por
  limite, `event`, `traceId`, `turnId` e `source`.
- Incluir o caminho/estado do archive SSE nos exports de diagnóstico.
- Aplicar compactação inteligente para payloads muito grandes: manter payload publico quando seguro, mas gravar hash/referência de blob quando necessário, sem perder causalidade.

## Atualizacao Codex - consulta operacional do archive SSE

Data: 2026-05-20.

Implementado nesta revisao:

- Criado comando `/events [n] [event=<nome>] [trace=<id>] [turn=<id>] [source=<origem>]` para consultar o tail do
  archive JSONL publico sem abrir turno SDK.
- A leitura do archive drena a fila pendente antes de consultar o arquivo, tolera linhas JSONL truncadas/corrompidas e
  limita a janela de leitura para manter a UX responsiva.
- O flush do archive deixou de retornar cedo quando havia gravação em voo: agora ele aguarda o append ativo e drena todos
  os batches pendentes antes de liberar a consulta ou o shutdown.
- A ajuda e o banner do terminal passaram a listar `/events`, separando claramente o endpoint HTTP `GET /events` do
  comando REPL que consulta a trilha duravel local.
- O shutdown central do terminal agora registra `terminal.sseEventArchive` como finalizador de auditoria, drenando a fila
  SSE em `/quit`, SIGTERM/SIGINT e shutdown por falha de boot.
- O runner live passou a executar `/events` tanto no roteiro real quanto no `--no-pr`, validando que a trilha duravel esta
  consultavel sem consumo adicional de turno.
- O runner live passa a isolar `TERMINAL_SSE_EVENT_ARCHIVE_DIR` dentro do diretório de artefatos, evitando mistura entre
  testes, sessões manuais e probes automatizados.
- A infra do archive aceita `TERMINAL_SSE_EVENT_ARCHIVE_DIR`, permitindo testes unitarios com diretório temporário sem
  poluir `data/copilot-terminal/sse-events`.
- Testes unitarios cobrem o comando `/events` e o novo handler de shutdown.

Pendencias apos esta revisao:

- Acrescentar filtros de `/events` por `toolCallId`, `requestId` e `hubSessionId`.
- Fazer `/events` aceitar `--json`/`--raw` para inspeção automatizada e comparação direta com `terminal.sse.jsonl`.
- Fazer o runner comparar o tail de `/events` com o coletor HTTP `GET /events`, detectando divergencia entre archive local
  e stream externo no mesmo `eventId`.
- Adicionar compactacao/hash de payload grande antes da persistencia JSONL.
