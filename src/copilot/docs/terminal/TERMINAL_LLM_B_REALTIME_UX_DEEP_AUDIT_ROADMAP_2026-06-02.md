# Terminal LLM-B Realtime UX Deep Audit Roadmap - 2026-06-02

## 00. Status deste documento

- Documento criado em 2026-06-02.
- Escopo primario: `src/copilot/terminal`.
- Escopo associado: `src/copilot/mcp`, `src/copilot/model-gateway`, scripts de teste live e estado local do terminal.
- Objetivo: orientar a consolidacao do terminal LLM-B como superficie realtime confiavel.
- Estado atual: teste live real canonico passou apos correcoes de transcript, export, timeline divergente, prompt e runner.
- Prioridade imediata: preservar a nova trilha verde em validadores strict/lint/testes focados.
- Prioridade secundaria: expandir cenarios live para freeform, choice invalida, tool longa, erro recuperavel e diagnosticos operacionais.
- Prioridade terciaria: revisar comandos `/activity`, `/history`, `/context`, `/events`, `/usage now` e `/health` para expor os metadados novos com consistencia.

## 01. Principios

- O terminal deve ser uma superficie de operacao, nao apenas um log.
- A linha de input deve permanecer estavel enquanto LLM-B, SDK e tools emitem eventos.
- Status vivo e input humano devem ser regioes distintas.
- Eventos transitorios podem aparecer na linha viva, mas fatos relevantes precisam entrar em transcript/export.
- O transcript exportado deve ser suficiente para auditar uma conversa sem depender do stdout bruto.
- `ask_user` e resposta humana sao eventos de autoria humana/operacional, nao mensagens da LLM-B.
- A resposta humana a `ask_user` deve aparecer uma unica vez com autoria humana.
- O eco da resposta humana por `assistant.message` deve continuar suprimido.
- A mensagem publica da LLM-B apos `ask_user` deve entrar no transcript/export.
- O SSE archive deve continuar sendo a fonte bruta publica para eventos.
- A timeline frontend deve ser a fonte canonica para comandos como `/export`, `/history`, `/context` e diagnosticos.
- Nao criar caminhos paralelos de historico quando o feed de transcript existente resolve o problema.
- Nao reimplementar comportamento vanilla do SDK; observar, traduzir e preservar.
- Dedupe deve operar por assinatura sem apagar autoria distinta.
- Persistencia no hub deve ser lazy e segura, sem bloquear UX.
- Quando hub e feed vivo divergem, o usuario precisa ver a divergencia e o export nao deve perder eventos recentes.
- Teste live deve validar comportamento de usuario real, nao apenas ausencia de crash.

## 02. Evidencia objetiva coletada

- Comando executado:
  - `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --out-dir=data/copilot-terminal/live-runs/terminal-ux-audit-20260602-025851`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-025851/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-025851/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-025851/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-025851/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-025851/conversation-export.md`
- Resultado funcional:
  - Status PASS.
  - 287 eventos SSE.
  - 0 erros no tracker do terminal.
  - Deltas canonicos observados.
  - Tools reais executadas.
  - `ask_user` real executado.
  - Resposta humana `SIM` registrada.
  - Mensagem pos-ask emitida pela LLM-B.
  - `/quit` encerrou limpo.
- Evidencia de gap:
  - `conversation-export.md` exportou 2 mensagens.
  - Export faltou `ask_user`.
  - Export faltou resposta humana `SIM`.
  - Export faltou `POST-ASK-CANONICAL-FINAL`.
  - Header do export: `timeline=hub/diverged · sync=blocked`.
  - SSE continha os eventos ausentes no export.
  - Terminal plain log conteve 16 ocorrencias de prompt.
  - Houve prompt duplicado em sequencia apos o pos-ask.
  - `writeInlineStatus` esta desabilitado por default.

## 02.01 Evidencia apos correcoes

- Comando executado:
  - `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --out-dir=data/copilot-terminal/live-runs/terminal-ux-audit-20260602-033250`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-033250/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-033250/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-033250/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-033250/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-033250/conversation-export.md`
- Resultado:
  - Status PASS.
  - Exit code 0.
  - 234 eventos SSE.
  - 232 eventos com id.
  - 232 eventos com source/eventSource.
  - 176 eventos com traceId.
  - 0 erros no tracker.
  - `sdkSessionBootSelection=forced-new`.
  - Export ok com 3474 chars.
  - Export contem transcript, streaming diagnostics, envelope, ask_user, resposta humana e pos-ask.
  - Deltas canonicos 1-8 visiveis em bloco live.
  - Tools reais `report_intent` e `read_file_content` renderizadas com start/done.
  - `ask_user` foi renderizado por SDK, sem `question.pending`.
  - Resposta humana `SIM` nao foi atribuida a LLM-B.
  - Pos-ask final foi preservado como `assistant.message`.
  - Nao houve duplicacao `prompt prompt` na mesma linha visual.
  - Live scenario run foi gravado no SQLite.

## 02.02 Decisoes apos live

- A diretiva de sessao SDK nova agora e agendada pelo runner antes de cenarios full-turn, evitando retomada de sessao antiga e respostas contaminadas por contexto anterior.
- `--reuse-sdk-session` foi mantido como opt-in para auditorias que queiram reproduzir comportamento de resume.
- Nao conformidade textual do modelo com a serie DELTA-CANONICAL deixou de ser bloqueio de infraestrutura.
- O prompt canonico foi reforcado para exigir as oito linhas publicas antes de `ask_user`.
- O resumo de `sdkSessionBootSelection` no artefato foi reduzido para nao gravar o estado persistido inteiro.

## 03. Achados principais

### 03.01 Typecheck strict

- `npm run typecheck:strict:src.copilot` foi executado antes da auditoria live.
- O strict falhou inicialmente em arquivos de MCP, Cloudflare, OAuth e runtime selector.
- Correcoes estruturais foram aplicadas em arquivos fora do terminal.
- O strict passou apos os patches.
- Esses patches ainda precisam permanecer preservados e validados apos os proximos upgrades.

### 03.02 Teste live real

- O teste live real demonstrou que o caminho SDK -> terminal -> SSE -> comandos funciona.
- O caminho de event archive e `/events` esta forte.
- O caminho de `/activity` preserva informacao humana recente.
- O caminho de `/export` agora preserva os eventos semanticamente relevantes do caso canonico.
- O runner agora exige ask_user, resposta humana e pos-ask no Markdown.
- O runner tambem registra se a sessao SDK foi forcada como nova antes do cenario full-turn.
- O teste live `033250` confirmou PASS em todos os criterios obrigatorios.

### 03.03 Transcript e timeline

- `readTerminalTimelineProjection()` combina:
  - history bridge;
  - transcript local;
  - hub persistido.
- `cmdExport()` le somente essa timeline.
- `recordTerminalUserInputRequested()` registra estado SDK e agora adiciona turno operacional ao transcript.
- `recordTerminalUserInputCompleted()` registra resposta, echo guard e agora adiciona turno humano ao transcript.
- `recordTerminalTurnUserInputActivity()` alimenta diagnostico de turno, mas nao alimenta export.
- `renderTerminalAssistantTranscript()` adiciona mensagens da LLM-B ao transcript.
- A mensagem pos-ask emitida por `assistant.message` agora entra no export mesmo quando o hub esta divergente.
- O algoritmo atual marca divergencia quando nao encontra overlap entre hub e live feed.
- Em divergencia, a timeline preserva persistedTurns, bloqueia sync e inclui tail vivo nao persistido.
- Isso e seguro para persistencia e suficiente para export/UX auditavel.

### 03.04 Linha viva

- `src/copilot/terminal/repl/live-status-line.js` calcula linha viva corretamente.
- `writeInlineStatus()` so escreve quando `COPILOT_TERMINAL_INLINE_STATUS=overlay`.
- Default atual e transcript-first, overlay opt-in.
- Na pratica, a linha viva nao aparece como regiao estavel por default.
- Varias chamadas a `printlnBlock()` e `refreshPromptIfIdle()` redesenham o prompt.
- O prompt pode aparecer duplicado quando eventos chegam em sequencia rapida.
- A politica precisa distinguir:
  - transcript permanente;
  - status vivo transitorio;
  - prompt/input.

### 03.05 ask_user

- `sdk-session-events.js` trata `user_input.requested`.
- O evento e registrado em estado SDK.
- O evento e registrado em turn trace.
- O evento e emitido por SSE.
- O evento imprime `[ASK]` no stdout.
- O evento agora vira turno operacional de transcript quando representa pergunta humana real.
- `pending-question-answer.js` roteia resposta comum para pending question.
- Echo guard evita que a resposta humana vire fala da LLM-B.
- A resposta humana agora e promovida para o transcript com role `user`.
- A pergunta `ask_user` agora e promovida para transcript com role operacional clara.
- O export agora representa pergunta/resposta como parte da conversa auditavel.

### 03.06 Tools

- Tools reais aparecem no terminal.
- `read_file_content` start/done foi renderizado.
- `ask_user` aparece como tool no fluxo SDK.
- `/tools diag` funciona, mas ainda e visualmente denso e pouco orientado a auditoria.
- Tool lifecycle ja tem registry session-scoped.
- Tool lifecycle deve manter requestId, toolCallId, source, duration e resultado resumido.
- O roadmap deve preservar a regra: texto/Markdown/JSON simulando tool nao conta como tool.

### 03.07 SSE

- SSE archive esta rico e duravel.
- `user_input.requested`, `question.answered`, `user_input.completed` e `assistant.message` existem no archive.
- IDs publicos sao monotonicos.
- Trace overlap entre stdout e SSE foi observado.
- O archive e bom para diagnostico bruto, mas nao substitui transcript/export.
- A timeline deve consumir fatos vivos relevantes do estado local, nao exigir que operador leia JSONL.

### 03.08 Hub e divergencia

- Hub persistido contem os dois turnos iniciais.
- Feed vivo contem eventos adicionais.
- Overlap falhou e status virou `diverged`.
- Em `diverged`, `maybeScheduleTimelineSync()` bloqueia persistencia.
- Essa decisao permanece correta para nao corromper hub.
- `readTerminalTimelineProjection()` agora retorna `timelineSource='mixed'` com `liveBridgeTailCount`.
- Persistencia continua bloqueada enquanto a projecao visual inclui live turns anotados.
- `syncBlockedReason` agora explicita o motivo de bloqueio de sync para projection, export e comandos operacionais.

## 04. Situacao ideal

### 04.01 UX operacional

- O operador ve uma linha de input sempre disponivel.
- O operador ve uma linha viva compacta acima do input.
- A linha viva muda sem destruir texto digitado.
- Eventos permanentes aparecem como blocos limpos acima da linha viva.
- Prompts nao duplicam apos eventos rapidos.
- Mensagens longas da LLM-B aparecem por streaming e final reconciliado.
- Tools aparecem com start/progress/done.
- `ask_user` aparece como pergunta formal e como tool real.
- Respostas humanas aparecem como autoria humana, uma vez.
- Pos-ask aparece como mensagem da LLM-B, uma vez.

### 04.02 Transcript/export

- Export inclui:
  - prompt inicial;
  - resposta da LLM-B;
  - pergunta ask_user;
  - resposta humana;
  - continuacao pos-ask da LLM-B;
  - metadados de origem;
  - traceId/turnId/eventId quando disponiveis;
  - diagnostico de reconciliacao;
  - status de sync.
- Export nao depende de stdout.
- Export nao precisa persistir no hub para representar fatos vivos.
- Export nao deve misturar resposta humana como LLM-B.
- Export deve marcar turnos operacionais quando a role for `system`.
- Export deve diferenciar `system` de LLM-B no label.

### 04.03 Arquitetura de estado

- `sdk-interactions` continua sendo estado especializado de interacoes SDK.
- `turn-trace` continua sendo diagnostico por turno.
- `transcript-state` passa a receber eventos humanos relevantes.
- `timeline projection` continua a ser ponto unico para export/context/history.
- `SSE archive` continua a ser fonte bruta de eventos.
- `hub` continua persistencia de conversa, com sync lazy controlado.
- Nenhum novo banco local deve ser criado para resolver ask_user/export.

### 04.04 Testabilidade

- Unit tests devem cobrir materializacao de ask_user no transcript.
- Unit tests devem cobrir timeline divergente com live tail preservado.
- Unit tests devem cobrir export com role `system` e `user`.
- Live test deve falhar se:
  - export nao contem `ASK-CANONICAL`;
  - export nao contem `SIM` como resposta humana;
  - export nao contem `POST-ASK-CANONICAL-FINAL`;
  - prompt duplicado excede limite aceitavel;
  - linha viva nao recebe status quando TTY suporta.

## 05. Arquivos auditados

- `src/copilot/terminal/README.md`
- `src/copilot/terminal/dialog/README.md`
- `src/copilot/terminal/events/agent-runtime-events.README.md`
- `src/copilot/terminal/repl/live-status-line.js`
- `src/copilot/terminal/repl/repl.js`
- `src/copilot/terminal/repl/repl-listeners.js`
- `src/copilot/terminal/repl/repl-input-routing.js`
- `src/copilot/terminal/dialog/turn-display.js`
- `src/copilot/terminal/dialog/output.js`
- `src/copilot/terminal/events/event-adapters.js`
- `src/copilot/terminal/events/sdk-session-events.js`
- `src/copilot/terminal/events/agent-runtime-events.js`
- `src/copilot/terminal/events/tool-lifecycle-runtime.js`
- `src/copilot/terminal/wiring/terminal-agent-wiring.js`
- `src/copilot/terminal/dialog/engine.js`
- `src/copilot/terminal/commands/export.js`
- `src/copilot/terminal/dialog/turn-reconciliation.js`
- `src/copilot/terminal/state/activity-state.js`
- `src/copilot/terminal/state/pending-question-answer.js`
- `src/copilot/terminal/state/transcript-state.js`
- `src/copilot/terminal/state/sdk-interactions.js`
- `src/copilot/terminal/state/turn-trace-state.js`
- `src/copilot/terminal/state/turn-materialization-state.js`
- `src/copilot/terminal/frontend/projections/timeline.js`
- `tests/unit/copilot/terminal/test_live_status_line.spec.js`
- `tests/unit/copilot/terminal/test_commands_export.spec.js`
- `tests/unit/copilot/terminal/test_sdk_interactions.spec.js`
- `tests/unit/copilot/terminal/test_pending_question_answer.spec.js`
- `tests/unit/copilot/terminal/test_turn_trace_state.spec.js`

## 06. Roadmap booleano

### Faixa A - Baseline e evidencia

- [x] Executar typecheck strict antes da fase terminal.
- [x] Corrigir strict em arquivos impactados.
- [x] Executar teste live real com LLM-B.
- [x] Confirmar uso de tool real `report_intent`.
- [x] Confirmar uso de tool real `read_file_content`.
- [x] Confirmar uso de tool real `ask_user`.
- [x] Confirmar resposta humana roteada.
- [x] Confirmar pos-ask emitido.
- [x] Coletar artifacts de stdout, SSE e export.
- [x] Identificar lacuna de export.
- [x] Identificar lacuna de linha viva.
- [x] Criar este documento como guia da rodada.

### Faixa B - Transcript de ask_user

- [x] Criar helper unico para materializar evento humano no transcript.
- [x] Materializar `user_input.requested` como turno operacional.
- [x] Materializar `user_input.completed` como turno humano.
- [x] Evitar duplicacao entre `question.answered` e `user_input.completed`.
- [x] Preservar `requestId`, `toolCallId`, `traceId`, `turnId` em metadata.
- [x] Preservar choices e allowFreeform em metadata.
- [x] Nao renderizar request protocolar nao-question como pergunta humana.
- [x] Garantir que answer vazia nao crie turno inutil.
- [x] Garantir que resposta humana nao seja autoria LLM-B.
- [x] Adicionar testes unitarios de transcript ask_user.

### Faixa C - Timeline divergente com tail vivo

- [x] Alterar projecao para nao esconder live turns quando hub diverge.
- [x] Manter persistencia bloqueada em divergencia ate reconciliacao segura.
- [x] Expor status visual de divergencia sem perda de dados vivos.
- [x] Definir metadata `syncBlockedReason`.
- [x] Adicionar `liveBridgeTailCount` em divergencia.
- [x] Garantir ordenacao por timestamp ao combinar hub e live.
- [x] Evitar dedupe que apague turnos de roles diferentes.
- [x] Preservar `origin='terminal'` para turnos vivos.
- [x] Adicionar teste unitario de hub divergente + terminal tail.
- [x] Atualizar `/context` e `/history` se dependerem de semantica antiga.

### Faixa D - Export auditavel

- [x] Ajustar label de role `system` no export.
- [x] Ajustar label de role operacional ask_user.
- [x] Incluir metadata compacta de `requestId` quando existir.
- [x] Incluir metadata compacta de `toolCallId` quando existir.
- [x] Incluir aviso quando timeline estiver divergente mas com tail vivo.
- [x] Adicionar teste export contendo pergunta, resposta e pos-ask.
- [ ] Garantir que export nao escreva segredos de tool args sensiveis.
- [x] Garantir que markdown nao quebre com respostas multiline.

### Faixa E - Linha viva e prompt estavel

- [x] Definir politica default para inline status.
- [x] Implementar modo reservado seguro por default em TTY.
- [x] Manter opt-out por env para ambientes problemáticos.
- [x] Reduzir redesenhos de prompt em eventos consecutivos.
- [x] Adicionar coalescing temporal pequeno para prompt redraw.
- [x] Evitar duplicacao `prompt prompt` apos blocos permanentes.
- [x] Garantir que input digitado nao seja perdido.
- [ ] Garantir que `printlnBlock` nao repinte prompt quando render lock estiver ativo.
- [x] Adicionar teste unitario de prompt redraw coalesced.
- [x] Atualizar live runner para medir prompt churn.

### Faixa F - Tools e atividade

- [ ] Revisar `tool-lifecycle-runtime` para status vivo sem excesso de writes.
- [ ] Melhorar resumo de `/tools diag`.
- [ ] Exibir `toolCallId` e `requestId` de forma compacta.
- [ ] Separar start/progress/done visualmente.
- [x] Evitar que ask_user como tool duplique pergunta em transcript.
- [ ] Garantir que tool real sempre vença texto simulado.
- [ ] Adicionar teste de tool activity com ask_user.

### Faixa G - SSE e archive

- [x] Manter evento bruto no archive sem filtrar fatos relevantes.
- [x] Validar que `user_input.requested` sempre tem source.
- [x] Validar que `user_input.completed` sempre tem source.
- [x] Validar que `question.answered` nao duplica transcript.
- [ ] Adicionar correlacao mais clara entre stdout e SSE para pos-ask.
- [ ] Atualizar live runner para comparar export contra SSE.

### Faixa H - Reconciliacao e materializacao

- [ ] Revisar `turn-materialization-state` para turnos pos-ask.
- [x] Garantir que `assistant.message` pos-ask nao seja suprimido por engano.
- [x] Garantir que `dialog.turn_end` truncado nao duplica assistant.message.
- [x] Preservar diagnostico de materializacao em metadata.
- [ ] Adicionar teste para turnos separados por ask_user.

### Faixa I - Comandos operacionais

- [ ] Revisar `/activity` para mostrar transcript humano recente.
- [ ] Revisar `/history` para representar ask_user.
- [ ] Revisar `/context` para contar turnos humanos corretamente.
- [ ] Revisar `/events` para linkar evento bruto ao transcript.
- [ ] Revisar `/usage now` para contexto pos-ask.
- [ ] Revisar `/health` para indicar inline status mode.

### Faixa J - Teste live LLM-B

- [x] Atualizar runner para exigir ask_user no export.
- [x] Atualizar runner para exigir resposta humana no export.
- [x] Atualizar runner para exigir pos-ask no export.
- [x] Atualizar runner para contar prompt churn.
- [x] Atualizar runner para detectar `prompt prompt`.
- [x] Atualizar runner para forcar sessao SDK nova nos cenarios full-turn.
- [x] Atualizar runner para nao classificar nao conformidade DELTA como bloqueio de infraestrutura.
- [ ] Atualizar runner para detectar linha viva no TTY quando habilitada.
- [x] Rodar live test com caso canonico atual.
- [ ] Rodar live test com resposta freeform.
- [ ] Rodar live test com choice invalida.
- [ ] Rodar live test com tool longa e heartbeat.
- [ ] Rodar live test com erro de tool recuperavel.

### Faixa K - Validadores

- [x] Strict de `src/copilot` passou antes da fase terminal.
- [x] Rodar testes unitarios focados de terminal apos patches.
- [x] Rodar strict apos patches do terminal.
- [x] Rodar lint escopado quando o conjunto estabilizar.
- [x] Rodar teste live real apos patches.
- [x] Registrar artifacts novos no documento ou em relatorio de rodada.

### Faixa L - Documentacao continua

- [x] Atualizar este MD apos cada bloco grande de implementacao.
- [x] Registrar decisoes arquiteturais que afetem timeline.
- [x] Registrar comandos canonicos para reproduzir live.
- [ ] Registrar gaps residuais antes de commit.
- [x] Registrar validadores executados.

## 06.01 Gaps residuais apos PASS live

- [x] Definir metadata `syncBlockedReason` para timeline divergente.
- [x] Revisar `/context` e `/history` com a semantica de `timeline=mixed/diverged`.
- [ ] Garantir redaction de args sensiveis em export quando tool metadata entrar no Markdown.
- [ ] Revisar `tool-lifecycle-runtime` para status vivo sem excesso de writes.
- [ ] Melhorar resumo de `/tools diag`.
- [ ] Exibir `toolCallId` e `requestId` de forma compacta em tools operacionais, nao apenas no envelope do export.
- [ ] Separar start/progress/done visualmente em tool diagnostics.
- [ ] Garantir que texto simulando tool nunca satisfaça criterio de tool real.
- [ ] Adicionar correlacao mais clara entre stdout e SSE para pos-ask.
- [ ] Atualizar live runner para comparar export contra SSE em termos de eventos correlacionados, nao apenas texto.
- [ ] Revisar `turn-materialization-state` para cenarios pos-ask alternativos.
- [ ] Adicionar teste para turnos separados por ask_user.
- [ ] Revisar `/activity` para mostrar transcript humano recente com envelope compacto.
- [ ] Revisar `/events` para linkar evento bruto ao transcript/export.
- [ ] Revisar `/usage now` para contexto pos-ask e BYOK sem Premium Request.
- [ ] Revisar `/health` para indicar inline status mode.
- [ ] Rodar live test com resposta freeform.
- [ ] Rodar live test com choice invalida.
- [ ] Rodar live test com tool longa e heartbeat.
- [ ] Rodar live test com erro de tool recuperavel.
- [ ] Atualizar runner para detectar linha viva no TTY quando habilitada.

## 07. Plano de implementacao imediato

### 07.01 Primeiro bloco

- Implementar materializacao de ask_user no transcript.
- Implementar materializacao de resposta humana no transcript.
- Ajustar dedupe para nao apagar turnos distintos por role/source.
- Ajustar export para role `system`.
- Criar testes unitarios focados.

### 07.02 Segundo bloco

- Ajustar timeline divergente para preservar live tail.
- Manter sync bloqueado quando nao houver overlap seguro.
- Criar teste de timeline com hub divergente e terminal tail.
- Revalidar export.

### 07.03 Terceiro bloco

- Ajustar linha viva default.
- Reduzir prompt churn.
- Criar testes de output/prompt.
- Atualizar live runner com checks novos.

### 07.04 Quarto bloco

- Rodar validadores escopados.
- Rodar strict.
- Rodar live test real.
- Atualizar este documento com resultado.

## 08. Riscos

- Risco: adicionar ask_user ao transcript pode duplicar pergunta se `question.pending` tambem renderizar.
- Mitigacao: dedupe por `requestId` e source.
- Risco: resposta humana pode aparecer duas vezes por `question.answered` e `user_input.completed`.
- Mitigacao: eleger `user_input.completed` como fonte canonica de transcript quando disponivel.
- Risco: timeline divergente com tail vivo pode parecer persistida.
- Mitigacao: export deve marcar `origem=terminal · vivo`.
- Risco: inline status default pode quebrar terminais sem TTY real.
- Mitigacao: manter no-op em `!process.stdout.isTTY` e permitir env opt-out.
- Risco: prompt redraw coalescing pode atrasar feedback.
- Mitigacao: coalescing pequeno e flush imediato em comandos interativos.
- Risco: dedupe relaxado pode duplicar mensagens antigas.
- Mitigacao: assinatura deve incluir role/source quando necessario.
- Risco: testes live ficarem frageis por texto visual.
- Mitigacao: preferir eventos canonicos e marcadores essenciais.

## 09. Criterios de pronto

- `npm run typecheck:strict:src.copilot` passa.
- Testes unitarios focados de terminal passam.
- Live test real passa.
- Export contem pergunta ask_user.
- Export contem resposta humana.
- Export contem pos-ask.
- Export nao atribui resposta humana a LLM-B.
- Linha viva aparece em TTY quando default permitir.
- Input nao e deslocado ou sobrescrito pela linha viva.
- Prompt duplicado pos-ask nao ocorre.
- SSE archive continua completo.
- `/activity` continua mostrando interacao humana recente.
- `/events` continua mostrando eventos brutos.
- Hub sync nao persiste dados divergentes de forma insegura.
- Documento atualizado com resultado da rodada.

## 10. Notas de manutencao

- Este documento e guia da rodada terminal LLM-B realtime.
- Nao substitui os guias de model-gateway.
- Mudancas em `src/copilot/mcp` feitas para strict devem ser mantidas, mas nao sao foco primario desta fase.
- Qualquer nova alteracao em `src/copilot/model-gateway` deve estar ligada ao runner live ou ao strict.
- O teste live real usa custo/latencia reais; executar com criterio depois de patches significativos.
- Validadores de teste amplo devem ser menos frequentes que testes unitarios focados.
- O strict geral de `src/copilot` deve continuar sendo gate antes de commit.
