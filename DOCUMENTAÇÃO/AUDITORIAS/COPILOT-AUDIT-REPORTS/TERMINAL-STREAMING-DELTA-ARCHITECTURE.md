# Terminal LLM-B: arquitetura canonica de deltas publicos

Data: 2026-05-20

## Diagnostico

A documentacao oficial do Copilot SDK 0.3.x define `assistant.message_delta` como evento efemero de texto publico, emitido em tempo real quando `streaming: true` esta ativo. O payload canonico e `data.deltaContent`; a mensagem completa vem depois em `assistant.message`. O SDK tambem separa `assistant.reasoning_delta`, que e thinking e nao deve ser despejado como transcript publico.

No terminal, o fluxo ja chegava ate a camada local:

1. SDK emite `assistant.message_delta`.
2. `event-handlers/streaming.js` roteia para `dialog.delta` quando o dialog loop esta ativo, ou para `task.delta` fora dele.
3. `channel/client-dialog.js` entrega `dialog.delta`/`task.delta` ao callback do turno explicito.
4. `terminal/dialog/turn-display.js` materializa stdout/SSE/historico.

O bug principal estava no ultimo passo: `turn-display.js` guardava chunks publicos ate acumular 48 caracteres ou pontuacao. Isso fazia respostas curtas, lentas, ou tokenizadas parecerem invisiveis ate o final do turno. Havia tambem uma supressao por conteudo repetido em janela de 75ms, que podia descartar repeticoes legitimas geradas pelo modelo.

## Situacao ideal

O terminal deve ter uma unica semantica para texto da LLM-B:

- `assistant.message_delta` e texto publico incremental e deve aparecer assim que houver conteudo visivel.
- `assistant.message` e a mensagem final persistida; ela serve para integridade e fallback, nao para duplicar o que ja foi streamado corretamente.
- `assistant.reasoning_delta` e thinking; deve ir para o historico consultavel por `/thinking`, sem despejo bruto no transcript publico.
- Deltas fora de um turno explicito tambem devem aparecer ao vivo, usando o mesmo renderer publico, e depois nao devem ser duplicados por transcript final.
- A deduplicacao deve acontecer por identidade real de evento/wiring, nao por igualdade textual de chunks. Repeticoes textuais sao conteudo valido.

## Mudancas aplicadas

- `terminal/dialog/turn-display.js` agora descarrega cada chunk publico assim que o streaming visual foi iniciado.
- A supressao local por chunk repetido foi removida do display e do bridge de dialog.
- `terminal/events/public-assistant-stream.js` centraliza a renderizacao de deltas publicos fora de turno explicito.
- `task-stream-events.js` usa esse renderer para `task.delta` quando o terminal nao esta em turno ativo.
- `task-transcript-accumulator.js` marca streams ja renderizados ao vivo para evitar duplicacao no fechamento.

## Contrato operacional

Fonte canonica:

`assistant.message_delta` -> `dialog.delta` ou `task.delta` -> renderer publico -> stdout/SSE/historico de turno.

Fonte de fallback:

`assistant.message` e `dialog.reply` materializam texto apenas quando nao houve stream publico suficiente ou quando ha divergencia detectada.

Fonte restrita:

`assistant.reasoning_delta` -> thinking history -> `/thinking`.
