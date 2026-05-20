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

Fase C2. Deduplicação

- C2.1 Remover dedupe textual cego que pode perder repetição legítima. Status: feito no contrato unitário de `wireStreamingEvents`.
- C2.2 Deduplicar por identidade de evento (`eventId`, `traceId`, `turnId`, `callId`). Status: parcialmente feito para `assistant.message_delta` por objeto/eventId.
- C2.3 Criar métrica de supressão por motivo. Status: pendente.
- C2.4 Testar repetição legítima de texto. Status: pendente.

Fase C3. Arquivo JSONL

- C3.1 Arquivar todo `broadcastSse()`. Status: feito.
- C3.2 Expor `/events`. Status: feito.
- C3.3 Expor `/events --raw`. Status: feito.
- C3.4 Adicionar diff de payload PTY/SSE/archive no live runner. Status: pendente.
- C3.5 Implementar rotação por tamanho/idade com índice. Status: pendente.

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

- G2.1 Prompt que force delta parcial visível. Status: pendente.
- G2.2 Prompt que force tool simples e tool com I/O. Status: pendente.
- G2.3 Prompt que force `ask_user` ao final. Status: pendente.
- G2.4 Prompt que force elicitation quando capability existir. Status: pendente.
- G2.5 Comparar PTY, SSE, JSONL, transcript e SQLite. Status: pendente.

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

## Execução Iniciada Nesta Revisão

Implementado:

- `runTerminalRuntimeConfigPhase()` agora aguarda `ctx.wireRuntime()`.
- Tipos JSDoc de `wireRuntime` aceitam `Promise<void>`.
- Reflection loop captura exceções síncronas e rejeições assíncronas com `toError()`.
- SIGHUP ganhou política explícita via `shouldRegisterTerminalSighupHandler()`.
- Mensagens de usage agora diferenciam "Premium Request classificada" de "Telemetria LLM sem Premium Request".
- A apresentação canônica de tools ignora nomes genéricos (`unknown`, `tool`, `external_tool`) quando há fallback real.
- O handler de `assistant.message_delta` agora tem contrato explícito: preserva chunks repetidos legítimos e deduplica por identidade de evento.
- Testes unitários adicionados para runtime root, reflection sync failure e SIGHUP policy.

Próxima rodada recomendada:

1. Normalizar wording de usage para remover ambiguidade com Premium Request.
2. Criar contrato único de modelo configurado/preferido/efetivo/cobrado.
3. Expandir live runner para cenário com delta parcial, tool, `ask_user` e comparação PTY/SSE/JSONL/transcript.
4. Atacar `tool unknown` por normalização central, não por casos especiais de renderer.
5. Adicionar eventos de boot `runtime.wired` e falha de fase.
