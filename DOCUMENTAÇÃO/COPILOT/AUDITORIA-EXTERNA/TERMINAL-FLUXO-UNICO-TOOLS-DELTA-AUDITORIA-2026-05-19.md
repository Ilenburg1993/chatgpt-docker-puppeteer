# Terminal LLM-B: fluxo unico de transcript, tools e IO

Data: 2026-05-19

## Escopo investigado

O terminal e ponto final de UX, mas nao pode corrigir por cima erros de arquitetura. A investigacao
desta rodada focou:

- eventos de tools vindos do runtime normalizado (`tool.execution_*`);
- eventos vanilla/SDK de tools externas (`external_tool.*`, `tool.user_requested`);
- eventos reais de IO publicados por `diagnostics_channel` em `copilot.io.operation`;
- deltas parciais (`assistant.message_delta` -> `dialog.delta`/`task.delta`);
- materializacao final do turno (`runtime_return`, `transport_mirror`, `empty`);
- transcript persistente fora do turno ativo.

## Situacao atual

Ha um composition root correto em `terminal/events/event-adapters.js`: runtime, SDK e IO recebem o
mesmo `ToolCallRegistry` session-scoped. Isso e bom. O risco nao esta em haver adapters diferentes,
pois as origens sao realmente diferentes; o risco esta em cada adapter ou renderer tomar decisoes
proprias sobre "o que aconteceu".

O fluxo de tools ja estava majoritariamente centralizado em
`terminal/events/tool-lifecycle-runtime.js`, com emissao SSE unica `tool.lifecycle`. O gap era a
correlacao de IO: a linha `[IO]` tinha duracao/bytes/engine, mas a linha `[DONE]` da tool podia
terminar com `n/d`, inclusive quando a tool tinha acabado de ler/escrever arquivo. Isso criava dois
fatos visuais paralelos sobre a mesma operacao.

O fluxo de transcript tem um dono semantico no runtime:
`agent/dialog/seams/turn-output-collector.js`. Ele coleta `assistant.message`, deltas e reply de
protocolo para decidir o texto final de um turno explicito. A camada `channel` ainda mantinha o nome
`dialog.reply_fallback`, que dava a impressao de arquitetura alternativa. O comportamento real e um
espelho de transporte: quando o retorno direto do runtime vem vazio, o evento `dialog.reply` ainda e
uma fonte canonica do mesmo turno, nao outro fluxo.

O acumulador `terminal/events/task-transcript-accumulator.js` continua valido para `task.delta` fora
de turno ativo. Ele nao deve competir com `turn-display`; deve ser tratado como projecao de fala
fora do turno explicito, usando o mesmo renderer persistente `assistant-transcript-renderer.js`.

O evento `session.tools_updated` podia mostrar "0 tools" quando o SDK apenas sinalizava atualizacao
sem lista materializada. Isso era uma falha de UX e diagnostico: o usuario via zero apesar de
`/tools` mostrar registry local preenchido.

## Situacao ideal

O terminal deve ter bordas finas e ledgers unicos:

- `ToolCallRegistry`: ledger de tool calls em voo, completadas recentemente e IO correlacionado.
- `tool.lifecycle`: schema unico para SSE e consumidores externos.
- `TurnOutputCollector`: dono semantico do texto final do turno explicito.
- `assistant-transcript-renderer`: unica porta para materializar fala persistente fora do bloco
  live.
- `/tools` e `session.tools_updated`: sempre diferenciar snapshot local, contagem SDK conhecida e
  sinal SDK sem lista.

Adapters podem existir por origem, mas nao podem tomar decisoes divergentes. O terminal deve narrar
exatamente o mesmo fato que o backend registrou: se uma tool executou IO, a conclusao da tool deve
carregar um resumo desse IO.

## Implementado nesta rodada

- `ToolCallRegistry` passou a ter `io` summary por tool:
  - quantidade de operacoes;
  - duracao total de IO;
  - bytes lidos/escritos;
  - targets;
  - engines;
  - ultima operacao.
- `io-activity-events` continua como adapter de `diagnostics_channel`, mas
  `handleTerminalIoToolLifecycle` agora anexa a operacao real de IO a tool em voo mais provavel via
  registry, em vez de apenas pegar a primeira tool ativa.
- `tool-lifecycle-runtime` usa o resumo de IO na conclusao de native/external tools:
  - exemplo esperado: `(... 1.2s · io 1 op · 7ms · 42 B · io-engine.fs.readFile.text)`;
  - quando o SDK nao fornece duracao, o resumo de IO ainda evita um `n/d` enganoso quando houver
    fato real.
- `dialog.reply_fallback` foi renomeado para `transport_mirror`, deixando claro que e o espelho
  canonico do transporte, nao uma arquitetura paralela.
- `session.tools_updated` agora registra:
  - `sdkCount` quando o SDK materializa count/lista;
  - `localCount` a partir do registry local;
  - mensagem explicita quando o SDK sinaliza atualizacao sem contagem materializada.
- `TurnOutputCollector` agora considera sinais de tool ao decidir se um delta pode virar reply
  final:
  - delta antes de tool nao e mais usado como resposta final se houve tool depois dele;
  - `assistant.message` posterior pode resolver o mesmo turno explicitamente, sem virar mensagem
    "fora do turno";
  - isso cobre o caso live em que o modelo diz "vou ler", usa `read_file_content`, e so depois
    entrega a resposta real.

## Proximas fases

1. Consolidar uma projecao de turno que una:
   - delta parcial exibido;
   - delta acumulado;
   - final reply;
   - origem do reply (`runtime_return`, `transport_mirror`, `empty`);
   - mismatch stream/final.

2. Trocar nomes e mensagens de status que ainda carregam `legacy` quando o conceito real for
   "superficie SDK", "alias de compatibilidade" ou "ponte canonica".

3. Enriquecer `tool.lifecycle.complete` com resumo de IO tambem no payload SSE, nao apenas no
   stdout.

4. Fazer live terminal com:
   - leitura de arquivo;
   - patch de arquivo pequeno;
   - tool externa pobre em metadados;
   - resposta com streaming parcial e final;
   - checagem de `/activity`, `/live`, `/tools` e transcript persistente.

## Validadores executados

- `npm run typecheck:strict:src.copilot`
- `npm run lint:copilot -- --cache`
- `npm run test:copilot:unit -- --cache ...` em modo compacto, com a suite completa executada pelo
  runner: 2893 testes, 966 suites, zero warnings/errors.
- `npm run terminal:llm-b` live:
  - `read_file_content` exibiu
    `[DONE] ... (21ms · io 1 op · 2ms · 58.8 KB · io-engine.fs.readFile.text)`;
  - a resposta final "O nome do pacote e chatgpt-docker-puppeteer." permaneceu no bloco live do
    turno, depois da tool, em vez de aparecer como `assistant.message` solta fora do turno.
