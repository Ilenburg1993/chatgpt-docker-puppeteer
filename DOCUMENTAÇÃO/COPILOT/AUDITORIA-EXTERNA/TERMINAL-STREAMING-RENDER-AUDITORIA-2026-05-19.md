# Auditoria do circuito de resposta live da LLM-B - 2026-05-19

## Escopo

Esta auditoria cobre o caminho canonico `npm run terminal:llm-b`: prompt do usuario no terminal,
envio ao SDK, eventos de streaming/finalizacao, bridge interno, renderizacao live e persistencia do
transcript. O foco inicial e garantir que mensagens da LLM-B aparecam no terminal com deltas
visiveis e sem corrupcao.

## Evidencia live

Foi executado um turno longo via `terminal:llm-b`, em sessao retomada, com streaming ligado e modelo
resolvido pelo SDK como `gpt-5.3-codex/high`.

Achados:

- O terminal encaminhou o prompt como turno real: `[intervene->turn] Modelo ocioso`.
- Houve TTFT alto, cerca de `24.6s`, e narrativas de espera antes do primeiro delta.
- O SDK emitiu `assistant.message_start`, que nosso catalogo ainda tratava como desconhecido.
- A resposta live apareceu, mas com chunks duplicados em pares, por exemplo `PARPARTETE  11`.
- O `/history` mostrou a resposta final limpa, sem duplicacao: `PARTE 1`, paragrafo, `PARTE 3`.

Conclusao de diagnostico: o conteudo final da LLM-B e a persistencia estao corretos; o bug primario
esta no circuito live de eventos/renderizacao, com risco adicional de assinaturas duplicadas de
eventos SDK.

## Fatos do README do SDK

O arquivo `node_modules/@github/copilot-sdk/README.md` foi lido integralmente. Pontos relevantes:

- `session.send({ prompt })` enfileira uma mensagem; a conclusao pode ser acompanhada por eventos ou
  por `sendAndWait`.
- `assistant.message_delta` so existe com `streaming: true` e carrega `deltaContent` incremental
  para append.
- `assistant.message` sempre representa a mensagem final do assistente.
- `assistant.streaming_delta` e progresso cumulativo de bytes, nao texto para renderizar como
  resposta.
- `assistant.reasoning_delta` e separado do texto final.
- O SDK tambem pode solicitar entrada via `onUserInputRequest`/`ask_user`.

## Circuito atual observado

1. `terminal/dialog/engine.js` cria callbacks `onDelta` e `onReasoning`.
2. `channel/client-dialog.js` registra `onDelta` em `task.delta` e `dialog.delta`.
3. `event-handlers/streaming.js` converte `assistant.message_delta` em:
   - `dialog.delta`, quando o dialog loop esta ativo.
   - `task.delta`, quando nao ha dialog ativo nem processamento.
4. `terminal/dialog/turn-display.js` escreve cada chunk recebido diretamente no terminal apos
   bufferizacao curta.
5. No fim do turno, `engine.js` deixa de renderizar o transcript final se o volume de streaming
   visivel parece suficiente.

## Gaps

- `wireAgentSessionRuntime` substituia a lista de unsubscribers sem descarregar os listeners antigos
  da sessao. Em boot/reanexo/restart, isso permite listeners duplicados no mesmo SDK session.
- `wireStreamingEvents` nao deduplicava o proprio evento SDK; se a sessao estivesse wireada duas
  vezes, o mesmo `assistant.message_delta` podia virar dois `dialog.delta`.
- `dialogTurnDetailed` aceitava deltas pelos dois canais sem identidade de fonte nem supressao
  local.
- `turn-display` nao mantinha um acumulado canonico do texto streamado, apenas contadores e buffer
  pendente.
- `engine` comparava apenas volume visivel. Um stream corrompido por duplicacao podia ser
  considerado "suficiente" e impedir a renderizacao limpa final.
- `assistant.message_start` nao fazia parte do catalogo conhecido, gerando alerta falso de SDK
  desconhecido.

## Situacao ideal

- Wiring de eventos de sessao deve ser substituivel e idempotente: antes de registrar novo conjunto
  de listeners, listeners antigos precisam ser descarregados.
- A camada `event-handlers` deve ser tolerante a duplicacao do mesmo evento SDK, usando identidade
  do objeto e, quando disponivel, id do evento.
- O dialog live deve aceitar fallback legado de `task.delta`, mas preferir `dialog.delta` durante
  turno ativo e suprimir duplicatas imediatas entre canais.
- O renderer deve manter o texto streamado canonico, com dedupe leve de chunks identicos adjacentes.
- Ao finalizar, o terminal deve comparar texto streamado e `assistant.message` final. Se divergirem,
  o transcript final limpo deve ser renderizado, mesmo que o stream tenha tido muitos caracteres.
- Eventos novos do SDK observados em runtime devem ser catalogados rapidamente, com aviso apenas
  para eventos realmente desconhecidos.

## Roadmap de implementacao

### Fase 1 - Estabilizacao do stream live

- Descarregar session listeners antigos antes de novo wiring.
- Deduplicar `assistant.message_delta` na origem.
- Deduplicar deltas imediatos no bridge de dialog.
- Registrar `assistant.message_start` como evento conhecido.

### Fase 2 - Integridade visual do terminal

- Acrescentar `streamingContent` ao estado do display.
- Comparar stream acumulado com reply final.
- Renderizar transcript final limpo quando houver divergencia ou baixa cobertura.

### Fase 3 - Validacao

- Cobrir unitariamente dedupe de eventos SDK.
- Cobrir dedupe local do `dialogTurnDetailed`.
- Cobrir fallback de transcript final quando o stream live diverge.
- Rodar novamente `terminal:llm-b` e confirmar deltas sem duplicacao.

## Validacao apos implementacao

Validadores locais:

- `npm run test:copilot:unit -- ...` executou a suite Copilot completa: `2866/2866` testes passaram.
- `npm run typecheck:strict:src.copilot` passou.
- `npm run lint:copilot -- ...` passou nos arquivos alterados.

Validacao live via `npm run terminal:llm-b`:

- Primeiro live pos-correcao confirmou que a resposta passou a aparecer no terminal sem duplicacao
  de chunks (`LINHA 1`, `LINHA 2`, `LINHA 3` limpas).
- Esse mesmo live expôs um problema independente: `tools: Tool names must be unique`, associado a
  descoberta automatica de configuracao SDK/MCP.
- A descoberta automatica (`enableConfigDiscovery`) foi desligada por default, alinhando o terminal
  ao default oficial do SDK e mantendo ativacao explicita por
  `COPILOT_ENABLE_CONFIG_DISCOVERY=true`.
- Segundo live confirmou boot/turno sem `Tool names must be unique`, sem `model.call_failure`
  desconhecido, e com resposta visivel no terminal:
  - `OK 1`
  - `OK 2`
  - `OK 3`

Observacao residual: o TTFT ainda depende do modelo escolhido pelo SDK em `auto` e pode incluir
reasoning antes do primeiro delta. Isso e latencia/model routing, nao perda de renderizacao.
