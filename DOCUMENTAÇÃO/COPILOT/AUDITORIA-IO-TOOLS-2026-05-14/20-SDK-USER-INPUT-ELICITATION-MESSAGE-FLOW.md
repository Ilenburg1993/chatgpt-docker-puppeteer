# Auditoria SDK User Input, Elicitation e Message Flow

Data: 2026-05-19  
Escopo: `src/copilot` integrado ao `@github/copilot-sdk`, com foco em prompt do usuário, streaming
de mensagens, `ask_user`, `session.ui.*`, tools e terminal `terminal:llm-b`.

## Situação Atual

O SDK expõe um fluxo relativamente claro: `CopilotSession.send(options)`,
`sendAndWait(options, timeout?)`, eventos de sessão para deltas/mensagens, handlers de
`UserInputRequest` e API `SessionUiApi` para `elicitation`, `confirm`, `select` e `input`.

No nosso código, o caminho principal já passa por `agent-messaging`, `session-runtime`, eventos SDK
e estado terminal. A UX do terminal também já registra permissões, elicitation, structured user
input e activity. Porém havia lacunas importantes:

- `MessageOptions` era encaminhado ao SDK sem validação local canônica.
- A documentação JSDoc local ainda descrevia assinatura antiga de `sendAndWait`.
- Erros de payload inválido podiam chegar tarde, com feedback menos acionável para a LLM-B.
- `/elicitation respond` aceitava apenas JSON, mesmo em schemas triviais com um único campo.
- `session.ui.elicitation` tinha validação de schema, mas o terminal ainda era pouco ergonômico para
  respostas simples.

## Situação Ideal

O fluxo canônico deve ser único:

1. O prompt do usuário é normalizado na borda de apresentação.
2. `MessageOptions` é validado antes de entrar no SDK.
3. `send()` e `sendAndWait()` compartilham o mesmo contrato.
4. Eventos do SDK alimentam transcript, linha viva, activity e histórico sem caminhos paralelos.
5. `UserInputHandler` e `SessionUiApi` usam schemas validados, com feedback claro para erro de
   parâmetro.
6. O terminal mostra pending/completed de ask-user, elicitation, permissions e tools sem mascarar
   falhas profundas.
7. Respostas estruturadas aceitam JSON completo, mas também atalhos seguros quando o schema é
   inequivocamente simples.

## Roadmap

### Faixa 1 — Contrato De Entrada SDK

- Consolidar `normalizeMessageOptions()` como borda única para `prompt`, `attachments`, `mode` e
  `requestHeaders`.
- Rejeitar campos desconhecidos com mensagem explícita.
- Validar attachment por tipo (`file`, `directory`, `selection`, `blob`) com caminhos de erro
  precisos.
- Emitir métricas com `promptLength`, `attachmentsCount`, `mode` e `requestHeadersCount`.

### Faixa 2 — User Input E Elicitation

- Manter `UserInputRequest` como fluxo conversacional de ask-user.
- Manter `SessionUiApi.elicitation` como fluxo estruturado por schema.
- Enriquecer o terminal com atalhos de resposta apenas quando o schema tiver exatamente um campo.
- Garantir que `accept`, `decline` e `cancel` sejam normalizados antes de resolver pendências.

### Faixa 3 — Transcript E Streaming

- Tratar `assistant.message.delta` como fonte de linha viva.
- Tratar mensagem final como snapshot persistente do turno.
- Garantir que mensagens não desapareçam por renderização incremental.
- Preservar tool calls, thinking e user prompts como eventos consultáveis.

### Faixa 4 — Governança E Testes Live

- Validar com unit tests de SDK contract e terminal commands.
- Rodar `typecheck:strict:src.copilot`, `test:copilot:unit` e `lint:copilot`.
- Testar live com `npm run terminal:llm-b`, incluindo ask-user, elicitation, `/now`, `/activity` e
  exibição de tools.

## Mudanças Desta Rodada

- Adicionado contrato canônico `src/copilot/sdk/session/message-options.js`.
- `sendSession()` e `sendSessionAndWait()` agora validam e normalizam `MessageOptions`.
- Barrel `#copilot/sdk` e `#copilot/sdk/session` exporta os helpers de message options.
- `/elicitation respond` aceita resposta curta para schema de campo único e mantém JSON obrigatório
  para schemas ambíguos.
- Documentação local de `MessageOptions` foi atualizada para a assinatura real do SDK.
- Após leitura completa de `node_modules/@github/copilot-sdk/dist/session.d.ts`, `setSessionModel()`
  passou a aceitar `modelCapabilities` junto com `reasoningEffort`, alinhado a
  `CopilotSession.setModel(model, options?)`.
- `session.log()` ganhou wrapper canônico `logSessionTimeline()`, usado por agent/server, com
  validação local e métricas.
- `ask_user` foi registrado no `ToolCallRegistry` como ferramenta humana semântica para evitar
  conclusão genérica `tool#...` no terminal.
- O turn trace ganhou dimensão própria de input humano (`userInputs`/`userInputCount`), separada de
  `tools` e `files`. Assim `/activity` mostra `ask_user` no resumo do turno sem fingir que ele é I/O
  de arquivo ou tool operacional comum.
- `sessionEnd` bem-sucedido agora devolve a atividade atual para `Pronto` quando o terminal não está
  ocupado, evitando UX enganosa do tipo `Hook SDK concluído` como se ainda fosse trabalho ativo.
- `session.info/model_retry` agora aparece como estado recuperável explícito
  (`Retry de modelo em andamento`), com severidade `warn` e histórico, em vez de info genérica que
  parecia progresso normal.
- `errorOccurred` com erro vazio do SDK deixa de registrar `{}` e passa a emitir mensagem acionável:
  `Erro do SDK sem mensagem estruturada.`

## Validação Live 2026-05-19

Rodada executada via `npm run terminal:llm-b`:

- Boot retomou sessão SDK existente com `COPILOT_MODEL=auto`; o SDK escolheu modelo efetivo
  dinamicamente.
- Mensagem da LLM-B apareceu no terminal com transcript persistente.
- `report_intent_local` apareceu com nome, alias e duração.
- `ask_user` abriu prompt humano com opções `dev | prod`, aceitou resposta normal (`prod`) e
  entregou resposta final da LLM-B.
- `/activity 12` confirmou timeline de `ask_user` e tool activity; a lacuna identificada foi a
  ausência de input humano no resumo do turno, corrigida nesta rodada.
- Uma segunda rodada live encontrou erro transitório de `model_call` após resposta do `ask_user`; o
  SDK emitiu `model_retry` recuperável por mais de 1 minuto. A sessão foi encerrada com `/quit` e a
  UX de retry foi endurecida nesta rodada para deixar esse estado visível e consultável sem impor
  timeout rígido.

## Critérios De Aceite

- Payload inválido falha antes do SDK com mensagem local clara.
- Payload válido chega ao SDK normalizado.
- Elicitation simples pode ser respondida por atalho sem sacrificar validação por schema.
- Elicitation complexa continua exigindo JSON object.
- O terminal permanece como observador da arquitetura, não como camada que oculta erro de backend.
- `/activity` deve diferenciar tool operacional, I/O real e input humano no mesmo turno.

## Rodada UX Terminal 2026-05-19

### Diagnóstico Confirmado

- O teste live com `terminal:llm-b` confirmou que a resposta da LLM-B e `ask_user` já chegam ao
  terminal, mas revelou três inconsistências arquiteturais:
  - `model=auto` era exibido como mismatch contra o modelo efetivamente escolhido pelo SDK.
  - O health recomendava `recreate_session` mesmo com sessão retomada e turno concluído.
  - Deltas de turno ativo podiam ser narrados como `task/Executando tarefa interna`, competindo com
    a linha viva da resposta.
- A timeline persistida e a timeline viva podiam ficar `hub:diverged` com `sync=not_needed`,
  escondendo que o sistema não tinha base segura para sincronizar automaticamente.
- Eventos `hook:error_occurred` eram alertados, mas não necessariamente registrados no
  `ErrorTracker`, reduzindo o valor de `/errors` em diagnósticos de processo vivo.

### Situação Ideal Refinada

- `auto` é seletor de modelo, não modelo concreto: a UX deve mostrar o modelo efetivo/cobrado sem
  marcar divergência falsa.
- Health, `/now` e status devem usar o sessionId canônico vivo ou persistido pela façade de runtime,
  evitando falso `session.inactive`.
- `task.delta` só deve assumir a linha viva quando não há turno ativo cuidando do transcript;
  durante um turno, esses deltas alimentam acumuladores e observability sem poluir o status atual.
- Timeline divergente deve ser explícita e bloqueada para sync automático até haver política segura
  de reconciliação.
- Todo evento de erro de bus/hook deve alimentar alerta e tracker consultável.

### Implementado Nesta Rodada

- Criada semântica canônica `resolveModelSelectionMismatch()` em `#copilot/sdk/models`,
  compartilhada por usage handler, projeções do terminal, prompt, comandos de config e rota de troca
  de modelo.
- `readRuntimeControlState()` agora resolve `sessionId` via `readAgentRuntimeSessionId()` quando o
  snapshot público não traz sessionId, corrigindo a origem do falso `recreate_session`.
- `timeline` ganhou status `blocked` para `diverged-no-overlap`, deixando claro que não houve sync
  porque a reconciliação automática seria insegura.
- `task.delta` visto durante turno ativo deixa de atualizar a linha viva como tarefa interna e não
  promove completion redundante para activity atual.
- `ErrorAlerter` passa a registrar eventos críticos no `ErrorTracker`; objetos vazios no tracker
  recebem mensagem acionável em vez de `[object Object]`.
- O marcador de intent no prompt (`[I]`/`[INTENT]`) passa a representar estado vivo
  (`processing`/`waiting_for_input`), não um intent histórico já concluído em idle.

## Rodada UX Terminal 2026-05-19 — Prompt, Health E Linha Viva

### Diagnóstico Confirmado

- A linha viva reservava linhas assumindo que o prompt/readline ocupava sempre uma linha física. Em
  TTY estreito, ou com modelo/tags longos, o prompt quebrava em múltiplas linhas e a linha viva
  subia para a posição errada.
- O prompt podia consumir largura demais com tags longas (`MODEL:...`, `ASK:QUESTION`, `NOLOOP`),
  deixando pouco espaço para digitação real e facilitando sobreposição visual.
- `/health` era anunciado como endpoint HTTP no banner, mas não existia como comando REPL explícito;
  o comando humano canônico era `/diagnose`.
- O diagnóstico mostrava `keepalive stopped` mesmo quando o health estava saudável porque o
  keepalive estava corretamente suprimido pelo dialog loop ativo, gerando ambiguidade operacional.

### Implementado

- A linha viva agora estima as linhas físicas ocupadas pelo prompt e pelo input atual antes de mover
  o cursor para a área transitória acima do prompt.
- A área de status foi reduzida e limitada por uma guarda mínima de linhas para o prompt/input,
  evitando que status longo tome o rodapé inteiro.
- `buildUserPrompt()` ganhou orçamento de largura: em TTY estreito, o prompt passa automaticamente
  para tags compactas e modelo abreviado, preservando espaço de digitação.
- `/health` virou alias REPL explícito de `/diagnose` e foi adicionado ao banner/help.
- O diagnóstico agora distingue `keepalive running`, `standby(dialog)` e `stopped`, removendo falso
  alerta quando o dialog loop suprime corretamente o keepalive.

### Validação Live

- `terminal:llm-b` retomou sessão SDK sem erro.
- `/health` exibiu diagnóstico completo e passou a mostrar `keepalive standby(dialog)`.
- `/now` seguiu com `recommended=none` e modelo efetivo sem mismatch falso.
- Turno curto `Responda apenas: ok-ux` retornou `ok-ux` no transcript e manteve o prompt compacto
  durante streaming.

## Rodada UX Terminal 2026-05-19 — Redraw Único E Prompt De Espera

### Diagnóstico Confirmado

- Vários subsistemas chamavam `rl.setPrompt()`/`rl.prompt()` diretamente: adapters de eventos,
  lifecycle do REPL, conclusão de turno e blocos de impressão. Em rajadas de eventos, isso podia
  produzir prompt duplicado ou prompt de usuário pintado por cima de uma linha viva ativa.
- `/health` podia mostrar `modo sdk desconhecido` quando a sessão SDK estava vinculada, mas nenhum
  evento explícito de `session.mode_changed` havia sido emitido.
- Hooks SDK bem-sucedidos eram úteis para observability, mas ocupavam transcript/atividade atual em
  modo `full`, competindo com sinais mais importantes como resposta, waiting e thinking.
- `writeInlineStatus()` re-reservava linhas usando sempre o prompt de usuário, mesmo durante
  processamento, dando a impressão de que o terminal aceitava input normal enquanto o turno ainda
  estava ativo.

### Implementado

- `scheduleTerminalPromptRedraw()` tornou-se o gateway canônico para redraw de prompt: coalesce
  múltiplos pedidos por tick e executa a pintura em linha limpa.
- O redraw agendado agora resolve o prompt no momento da pintura; se o runtime ficou `busy` entre o
  pedido e o flush, vence o prompt de espera.
- `reserveInlineStatusRows()` também respeita `busy` e pinta `buildWaitingPrompt()` durante turnos
  ativos.
- Event adapters, lifecycle do REPL e conclusão de turno passaram a usar o gateway comum em vez de
  redraws diretos.
- A projeção de config assume `interactive` quando há SDK session vinculada e o modo explícito ainda
  não chegou.
- Hooks SDK de sucesso continuam indo para activity observada e SSE, mas não imprimem linha
  permanente nem sequestram a atividade focada; falhas seguem visíveis.

### Validação Live

- `/health` exibiu `modo sdk interactive`, `keepalive standby(dialog)` e `health healthy`.
- Turnos curtos (`ok-ux-3`, `ok-ux-4`) renderizaram resposta final, thinking capturado e usage sem
  perder transcript.
- Durante processamento, o rodapé passou a mostrar prompt de espera (`⏳ [modelo/reasoning]`) em vez
  de novo `você›`.

### Hardening Pós-Push

- O entrypoint `terminal:llm-b` agora usa console log level `ERROR` por padrão para o logger de
  observability. `WARN` continua persistido em arquivo/ring buffer e consultável por comandos, mas
  deixa de atravessar a área ANSI do terminal como linha crua durante streaming.
- Validação live com turno curto confirmou que warnings de token budget não quebram mais o layout
  interativo; a linha viva permaneceu em prompt de espera e o transcript final foi preservado.

## Rodada UX Terminal 2026-05-19 — Modo Seguro Sem Overlay ANSI

### Diagnóstico Confirmado

- A linha viva overlay dependia de `ANSI save cursor + cursor up + clear line` para reescrever
  linhas acima do prompt. Esse modelo é instável em terminais reais quando há wrap, scrollback,
  prompt multilinha ou eventos em rajada.
- `printExchange()` renderizava respostas linha a linha via `println()`, multiplicando redraws e
  limpezas de linha para um único bloco de resposta.
- A tag de intent no prompt era derivada de histórico recente, não de uma interação pendente real;
  em alguns fluxos ela persistia após o turno e aumentava ruído visual.

### Decisão Arquitetural

- A autoridade visual do terminal passa a ser transcript permanente append-only.
- Overlay ANSI de linha viva fica opt-in via `COPILOT_TERMINAL_INLINE_STATUS=overlay`; por padrão,
  `writeInlineStatus()` não manipula cursor/scrollback.
- Estados ricos continuam disponíveis por transcript, `/activity`, `/live`, `/intent`, `/tools`,
  `/usage` e SSE.

### Implementado

- `writeInlineStatus()` e `clearInlineStatus()` deixaram de executar cursor-up/clear-line por
  padrão.
- `printlnBlock()` deixou de reservar linhas em branco quando overlay não está explicitamente
  habilitado.
- `printExchange()` passou a montar o turno final completo e imprimir com um único `printlnBlock()`.
- Prompt não exibe mais tag de intent histórica; intents permanecem como blocos persistentes e
  consulta via `/intent`.

### Validação Live

- Boot e turnos passaram a renderizar em modo append-first, sem área preta causada por overlay.
- Turno com resposta + `report_intent` + tool genérica exibiu resposta, intents, tool start/done,
  summary de tools, usage e mensagem final.
- Prompt final voltou para `você[modelo/high]›` sem `[I]` persistente.

## Rodada UX Terminal 2026-05-19 — Perda De Resposta Durante Busy

### Diagnóstico Confirmado

- A imagem do terminal mostrou um turno com header, duração e usage, mas sem corpo de resposta. Isso
  só é possível quando `sendTurn()` chega ao renderer final com `reply` vazio.
- O listener de `assistant.message` descartava renderização quando `busy=true`, assumindo que o
  retorno direto do turno sempre carregaria o texto final.
- Em algumas rotas do SDK, especialmente com resposta simples/sem delta incremental, o evento
  `assistant.message` pode ser a única fonte textual confiável enquanto o retorno direto do turno
  vem vazio ou parcial.

### Decisão Arquitetural

- Evento `assistant.message` nunca deve ser descartado. Se chega durante turno ativo, entra em
  buffer transitório canônico.
- O engine de turno explícito deve preferir retorno direto quando não vazio, mas usar o buffer de
  `assistant.message` como fallback textual antes de renderizar qualquer bloco final.
- Se nenhuma fonte textual existir, a UX deve mostrar um placeholder diagnóstico explícito, nunca um
  bloco vazio.

### Implementado

- Criado `terminal/state/assistant-message-buffer-state.js` com `record`, `read`, `takeLatest` e
  `clear`.
- `sdk-session-events` limpa o buffer em `assistant.turn_start` e grava mensagens recebidas durante
  `busy`.
- `dialog/engine` usa o último `assistant.message` bufferizado quando
  `runTerminalDialogTurnDetailed()` retorna vazio.
- `printExchange()` mostra `[sem resposta textual materializada pelo SDK]` quando todas as fontes
  realmente falham.

### Validação Live

- Caso mínimo `oi` exibiu resposta final: `Oi! Estou pronto para a próxima instrução.`
- Turno com `report_intent` exibiu resposta, intents, tool start/done, summary de tools, usage e
  mensagem final.
