# Terminal LLM-B: streaming, modelo e recuperacao de erro - auditoria Codex

Data: 2026-05-20
Escopo: `src/copilot`, com foco em `terminal:llm-b`, fluxo SDK, dialog loop, deltas publicos, tools, usage e recuperacao de modelo.

## Sumario executivo

O relatorio da LLM-B (`TERMINAL-STREAMING-DELTA-AUDITORIA-COMPLETA.md`) acerta ao apontar que o terminal ainda precisa de um contrato unico para deltas, transcript final, SSE e diagnostico. Ele tambem acerta ao exigir envelopes causais para que o sistema deixe de depender de heuristicas temporais.

Mas ha uma correcao importante: a conclusao de que a janela `CROSS_CHANNEL_DELTA_SUPPRESSION_WINDOW_MS=75` deve ser simplesmente removida esta incompleta. Teste live anterior mostrou duplicacao real quando `task.delta` e `dialog.delta` entregam o mesmo chunk do SDK. A situacao ideal nao e "sem dedupe"; e dedupe por identidade causal (`eventId`, `causationId`, `streamId`, `chunkSeq`, `source`). Ate essa identidade existir em todos os canais, a janela curta cross-channel deve permanecer como guard operacional, com documentacao honesta.

O log fornecido pelo usuario revela um segundo eixo critico, nao tratado com profundidade suficiente no relatorio da LLM-B: apos `/model gpt-5.4`, o SDK emite `session.model_change`, mas os turnos seguintes entram em `hook:error_occurred` recuperavel com `errorContext=model_call`. A UX mostrava apenas alertas genericos de erro e retries, sem aplicar fallback live para `auto`, sem explicar causa provavel e sem impedir ruido no ErrorTracker. Isso gera a percepcao correta de que "nada aparece", embora o problema raiz seja backend/model routing preso em erro recuperavel.

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

- `assistant.message`, `dialog.reply`, replay SSE e persistencia de historico ainda precisam carregar a mesma causalidade completa do delta.
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
- Propagar causalidade completa tambem em `assistant.message`, `dialog.reply`, replay SSE e export Markdown.
- Medir quantas vezes a janela temporal degradada em `client-dialog.js` ainda e usada; a meta e tornar essa dependencia rara e, depois, removivel.
- Criar comando/diagnostico de streaming que diga claramente: SDK nao emitiu delta, delta emitido mas display desligado, delta emitido e renderizado, ou delta emitido e reconciliado no final.
- Expor no `/usage now` e `/status` a distincao entre `boot/resume zero-PR`, `turn billed`, `explicit /turn`, `direct chat bridge` e `recovery PR fallback`.
- Unificar payloads SSE de `delta`, `assistant.message`, `dialog.reply`, `user_input.*`, `tool.*` e `pr.consumed` com um envelope comum de `traceId/turnId/eventId/source`.
- Revisar o fluxo de `requestHeaders` em `runTerminalDialogTurnDetailed`: hoje ele pode parar dialog loop e usar direct chat, portanto deve ser exibido como caminho que pode consumir PR.
- Criar teste unitario para boot recovery com env `LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK=true`, garantindo que o fallback pago e deliberado e observavel.
- Criar teste live automatizavel que obrigue resposta longa o suficiente para observar varios deltas, uma tool, usage e `ask_user`.
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
- Descartar testes live de uma unica mensagem curta como criterio suficiente; respostas curtas frequentemente chegam sem delta parcial visivel.
- Descartar "bypass" de premium request como objetivo. O objetivo correto e impedir consumo acidental e tornar todo consumo observavel, nao contornar cobranca do provedor.

### Novos achados

- `boot-dialog-recovery.js` tinha fallback automatico para `ctx.startDialogLoop()` quando a reanexacao zero-PR falhava. Esse caminho podia parecer consumo de PR no boot, pois abria boot de dialog loop sem comando explicito do operador.
- A mensagem "Persist latest PR consumption snapshot" nao significa necessariamente novo consumo. Ela e persistencia interna de snapshot. A UX ja evita imprimir isso como atividade da LLM-B, mas o relatorio deve manter a distincao: o sinal de consumo real e `assistant.usage -> pr.consumed`.
- O log de `/model gpt-5.4` mostra duas coisas diferentes misturadas na percepcao do operador: configuracao do modelo mudou, mas o modelo efetivo/cobrado pode continuar roteado para outro alvo ou falhar em `model_call`. A UX deve sempre separar configurado, efetivo e cobrado.
- O caminho direct chat com `requestHeaders` ainda e potencialmente consumidor de PR e deve ser tratado como excecao operacional, nao como caminho normal do terminal.
- O teste live mais util nao e reiniciar muitas vezes o terminal. E iniciar uma vez, inspecionar `/status`, `/usage now`, `/activity`, executar um unico turno rico e fechar com `/quit`.
- O teste live Codex desta revisao confirmou que `report_intent` aparecia no transcript/timeline, mas nao entrava no agregado de `/tools diag`; isso foi corrigido contabilizando tools diagnosticas no lifecycle do terminal.
- O teste live Codex confirmou que responder `ask_user` com `SIM` conclui a pergunta, mas tambem materializa uma mensagem publica curta `SIM` da LLM-B e contabiliza usage. Isso precisa de contrato explicito: pode ser comportamento esperado do SDK ao fechar a ferramenta, mas a UX deve deixar claro que se trata da conclusao do mesmo fluxo de input humano, nao de uma resposta espontanea nova.

### Roadmap refinado

#### Faixa G - Governanca zero-PR e consumo observavel

- G1. Bloquear por padrao fallback pago de boot recovery. **Implementado.**
- G2. Emitir `dialog.boot_recovery` quando fallback pago for bloqueado. **Implementado.**
- G3. Mostrar esse evento no terminal, timeline e SSE. **Implementado.**
- G4. Documentar `LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK` como opt-in operacional.
- G5. Adicionar `/usage now` com origem do ultimo consumo: boot, turn, direct-chat, recovery fallback ou unknown.
- G6. Marcar direct chat bridge como caminho PR-risk em `/activity`.
- G7. Diferenciar snapshot de PR de consumo real em todos os textos do terminal.
- G8. Adicionar teste de regressao para nenhum boot recovery pago sem env.

#### Faixa H - Streaming live end-to-end

- H1. Registrar metrica `delta.causal.accepted`.
- H2. Registrar metrica `delta.temporal_fallback.accepted`.
- H3. Registrar metrica `delta.cumulative_suffix.normalized`.
- H4. Registrar metrica `delta.duplicate.suppressed`.
- H5. Expor as metricas em `/activity` e `/metrics`.
- H6. Criar teste live guiado com resposta longa, tool, final message e ask_user.
- H7. Adicionar replay SSE de deltas por `Last-Event-ID`.
- H8. Propagar `turnId` e `traceId` em todo delta.
- H9. Persistir final reconciliation no historico/export.

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
- J6. Distinguir visualmente resposta humana encaminhada para `ask_user` de mensagem publica nova quando o SDK ecoar/confirmar o valor.
- J7. Garantir que usage apos resposta de `ask_user` seja explicado como fechamento do fluxo SDK, nao como boot ou recovery.
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

O criterio de sucesso nao e "nao houve uso". Um turno real pode gerar `assistant.usage`. O criterio correto e: boot/resume nao gera consumo acidental, deltas parciais aparecem quando emitidos, final nao duplica stream, tools aparecem com nome/tempo/I-O, `ask_user` aparece e permanece consultavel, e qualquer consumo real aparece como `pr.consumed` com modelo configurado/efetivo/cobrado.

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
- A resposta humana `SIM` ao `ask_user` apareceu tambem como mensagem curta da LLM-B com usage. Isso nao quebrou o fluxo, mas a UX precisa explicar melhor a relacao entre resposta humana, fechamento da tool e usage associado.
- O modelo configurado ficou `auto`, mas o efetivo/cobrado mudou de `gpt-5.4-mini` para `gpt-5.3-codex` durante o turno. Isso e comportamento aceitavel do `auto`, mas `/status` e `/usage` devem continuar destacando configurado/efetivo/cobrado.
