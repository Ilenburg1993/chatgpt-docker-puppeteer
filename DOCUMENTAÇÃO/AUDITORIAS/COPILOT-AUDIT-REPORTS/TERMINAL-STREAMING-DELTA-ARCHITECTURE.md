# Terminal LLM-B: arquitetura canonica de deltas publicos

Data: 2026-05-20

## Diagnostico

A documentacao oficial do Copilot SDK 0.3.x define `assistant.message_delta` como evento efemero de texto publico, emitido em tempo real quando `streaming: true` esta ativo. O payload canonico e `data.deltaContent`; a mensagem completa vem depois em `assistant.message`. O SDK tambem separa `assistant.reasoning_delta`, que e thinking e nao deve ser despejado como transcript publico.

No terminal, o fluxo ja chegava ate a camada local:

1. SDK emite `assistant.message_delta`.
2. `event-handlers/streaming.js` roteia para `dialog.delta` quando o dialog loop esta ativo, ou para `task.delta` fora dele.
3. `channel/client-dialog.js` entrega `dialog.delta`/`task.delta` ao callback do turno explicito.
4. `terminal/dialog/turn-display.js` materializa stdout/SSE/historico.

O bug principal estava no ultimo passo: `turn-display.js` guardava chunks publicos ate acumular 48 caracteres ou pontuacao. Isso fazia respostas curtas, lentas, ou tokenizadas parecerem invisiveis ate o final do turno. Havia tambem uma supressao por conteudo repetido no renderer final, que podia descartar repeticoes legitimas geradas pelo modelo.

## Situacao ideal

O terminal deve ter uma unica semantica para texto da LLM-B:

- `assistant.message_delta` e texto publico incremental e deve aparecer assim que houver conteudo visivel.
- `assistant.message` e a mensagem final persistida; ela serve para integridade e fallback, nao para duplicar o que ja foi streamado corretamente.
- `assistant.reasoning_delta` e thinking; deve ir para o historico consultavel por `/thinking`, sem despejo bruto no transcript publico.
- Deltas fora de um turno explicito tambem devem aparecer ao vivo, usando o mesmo renderer publico, e depois nao devem ser duplicados por transcript final.
- A deduplicacao ideal deve acontecer por identidade real de evento/wiring, nao por igualdade textual de chunks. Repeticoes textuais sao conteudo valido.
- Enquanto o SDK/runtime ainda puder entregar o mesmo delta por `task.delta` e `dialog.delta` sem `eventId`/`causationId` comum, o bridge pode manter uma supressao cross-channel curta e explicitamente documentada. Ela e um guard operacional contra duplicacao de canais, nao uma regra semantica de conteudo.

## Mudancas aplicadas

- `terminal/dialog/turn-display.js` agora descarrega cada chunk publico assim que o streaming visual foi iniciado.
- A supressao local por chunk repetido foi removida do display. O bridge de dialog agora prioriza dedupe por identidade causal (`eventId`, `causationId`, `streamId`, `chunkSeq`); a janela curta por texto fica apenas como modo degradado quando nenhum canal traz identidade.
- `terminal/events/public-assistant-stream.js` centraliza a renderizacao de deltas publicos fora de turno explicito.
- `task-stream-events.js` usa esse renderer para `task.delta` quando o terminal nao esta em turno ativo.
- `task-transcript-accumulator.js` marca streams ja renderizados ao vivo para evitar duplicacao no fechamento.
- `terminal/dialog/turn-reconciliation.js` decide a materializacao final: nada quando o stream ja cobre a resposta, apenas sufixo quando a mensagem final completa o parcial, e transcript completo somente quando nao houve delta visivel ou quando ha divergencia real.
- `task.delta` sem `taskId` usa `streamId` quando disponivel e uma chave interna legivel quando nao houver identidade; sentinelas legadas como `__anonymous__` nao devem vazar para a UX.

## Pendencia arquitetural

O upgrade canonico em andamento promove deltas a envelopes causais (`streamId`, `chunkSeq`, `source`, `eventId` quando existir, `causationId`) na borda `assistant.message_delta` -> `dialog.delta`/`task.delta` -> SSE `delta`. A proxima reducao de risco e ampliar essa identidade para `assistant.message`, `dialog.reply`, replay SSE e persistencia de historico, de modo que a janela temporal degradada em `client-dialog.js` possa virar apenas contador diagnostico ou ser removida com seguranca.

## Contrato operacional

Fonte canonica:

`assistant.message_delta` -> `dialog.delta` ou `task.delta` -> renderer publico -> stdout/SSE/historico de turno.

Fonte de reconcile/fallback:

`assistant.message` e `dialog.reply` materializam texto apenas quando nao houve stream publico visivel, quando ha um sufixo ausente a completar, ou quando ha divergencia detectada e registrada.

Fonte restrita:

`assistant.reasoning_delta` -> thinking history -> `/thinking`.
