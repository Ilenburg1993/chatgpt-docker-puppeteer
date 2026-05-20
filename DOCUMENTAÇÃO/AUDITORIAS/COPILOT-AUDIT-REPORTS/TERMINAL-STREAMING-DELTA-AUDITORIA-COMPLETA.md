# Auditoria completa — Terminal Streaming Delta (src/copilot)

Data: 2026-03-20  
Escopo primario: `src/copilot/terminal`, `src/copilot/event-handlers/streaming.js`, `src/copilot/channel/client-dialog.js`, SSE server routes.  
Documento de partida: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/TERMINAL-STREAMING-DELTA-ARCHITECTURE.md`.

## 1) Sumario executivo

O pipeline de streaming do terminal esta funcional e mais robusto do que fases anteriores (delta publico incremental, separacao de reasoning, replay SSE e fallback por `assistant.message`), mas ainda existe **divergencia entre contrato documental e comportamento real**, alem de acoplamentos implicitos entre `busy-state`, dedupe cross-channel e persistencia de transcript.

Estado geral:

- **Confiabilidade operacional**: boa, com alguns riscos medium.
- **Integridade semantica do texto streamado**: boa no caminho principal; com riscos em bordas.
- **Convergencia arquitetural (SSOT unico)**: parcial.
- **Observabilidade e SLOs de streaming**: intermediaria; faltam contracts e pain points testados ponta-a-ponta.

## 2) Analise da situacao atual (AS-IS)

### 2.1 Fluxo real em codigo

1. SDK emite `assistant.message_delta` / `assistant.reasoning_delta`.
2. `src/copilot/event-handlers/streaming.js` roteia:
   - `dialog.delta` se `dialogLoopActive()`;
   - `task.delta` se fora do loop e `!isProcessing()`;
   - `task.reasoning` para reasoning.
3. `src/copilot/channel/client-dialog.js` registra listeners temporarios de `task.delta` e `dialog.delta` e alimenta `onDelta`.
4. `src/copilot/terminal/dialog/turn-display.js` renderiza stream publico (stdout + SSE `delta`) e reasoning separado (SSE `reasoning` + history `/thinking`).
5. Fora de turno explicito, `src/copilot/terminal/events/task-stream-events.js` + `public-assistant-stream.js` cuidam do live/public stream e fechamento.
6. `sdk-session-events.js` materializa `assistant.message` como fallback/transcript fora de turno.

### 2.2 Pontos fortes confirmados

- Dedupe por identidade de evento no handler SDK (`WeakSet` + `eventId`) em `event-handlers/streaming.js`.
- `turn-display` preserva repeticoes legitimas de chunk no display live (testado).
- Reasoning separado do transcript publico (`turn-display.js`, `task-stream-events.js`).
- Suppressao de mensagens internas de background `Persist ...` no runtime-events (testado).
- SSE com replay buffer e filtros em rotas server (`server/routes/sse.js`, `server/routes/copilot-api/stream.js`).

## 3) Situacao ideal (TO-BE)

Arquitetura alvo:

- Um contrato unico e versionado para streaming (`assistant.message_delta`, `assistant.message`, `assistant.reasoning_delta`, `task.delta`, `dialog.delta`) com invariantes explicitas.
- Dedupe apenas por identidade causal de evento (nunca por igualdade textual opportunistica).
- Transcript integrity orientada por estado explicito (live-rendered, persisted, fallback-rendered), sem acoplamento implicito a `busy`.
- SSE com semantica uniforme de replay/event-id entre terminal e server, com metricas de perda, lag, replay-depth e drop-rate.
- Conjunto de testes de regressao para todos os caminhos de borda (turno ativo, turno ocioso, stall, reconnect, duplicate wiring, fallback, aborted turn, mailbox interactions).

## 4) Parte I — Issues (bugs, gaps, riscos)

| ID | Severidade | Categoria | Evidencia | Impacto |
|---|---|---|---|---|
| BUG-STR-001 | high | contract drift | Doc afirma remocao da supressao no bridge (`TERMINAL-STREAMING-DELTA-ARCHITECTURE.md`) mas `client-dialog.js` ainda tem `CROSS_CHANNEL_DELTA_SUPPRESSION_WINDOW_MS=75` e filtro por chunk/source/tempo (`src/copilot/channel/client-dialog.js:28,156-161`) | Arquitetura documentada diverge do comportamento real; risco de decisao errada em manutencao e incidentes |
| BUG-STR-002 | high | semantic loss | Teste oficial valida supressao imediata entre `task.delta` e `dialog.delta` (`tests/unit/copilot/test_client_dialog.spec.js:269-283`) | Repeticoes legitimas cross-channel em janela curta podem ser descartadas |
| GAP-STR-003 | medium | hidden coupling | `task-transcript-accumulator` suprime flush se `seenWhileBusy` (`src/copilot/terminal/events/task-transcript-accumulator.js:73,107`) e `task-stream-events` marca busy-state (`src/copilot/terminal/events/task-stream-events.js:132-148`) | Integridade do transcript depende de acoplamento indireto com estado de busy e renderizacao live |
| GAP-STR-004 | medium | test coverage | Nao ha teste dedicado para `assistant.turn_end` + `flushAll` em task transcript | Borda de encerramento de turno pode regredir sem sinal imediato |
| GAP-STR-005 | medium | observability contract | `turn-display.js` publica SSE `delta` sem metadados de causalidade (turnId/chunkSeq/source) (`src/copilot/terminal/dialog/turn-display.js:318`) | Dificulta debug de duplicidade e correlacao com fallback final |
| GAP-STR-006 | medium | replay semantics | Duas superficies SSE coexistem (raw terminal `terminal/dialog/sse.js` e pools `server/routes/sse.js`) com responsabilidades sobrepostas | Aumenta complexidade de troubleshooting e risco de inconsistencias sutis de replay |
| GAP-STR-007 | low | documentation governance | Documento-base descreve estado ideal como se ja estivesse fechado, sem status de pendencias residuais | Leitura operacional pode induzir falsa sensacao de convergencia completa |
| GAP-STR-008 | medium | safety/integrity | `onAssistantMessage` ignora mensagens com `agentId` (`sdk-session-events.js:311-314`) | Fluxos multi-agente podem ocultar texto relevante para operadores |
| GAP-STR-009 | medium | lifecycle edge | Fechamento de stream publico depende de `task.completed/error` e `assistant.turn_end` (`task-stream-events.js:216-259`) | Abort/stall fora desses eventos pode deixar stream sem fechamento semantico no tempo esperado |
| GAP-STR-010 | low | narrative hygiene | Supressao de ruido interno por regex (`agent-runtime-events.js:65-68`) e nao por taxonomia formal de evento | Fragilidade a variacoes textuais de descricao |
| GAP-STR-011 | medium | SLO gap | Nao existe SLO formal versionado para TTFT/jitter/drop-rate no dominio terminal streaming | Operacao fica reativa, sem thresholds canonicamente governados |
| GAP-STR-012 | low | replay capacity | Buffer task SSE em `/stream/tasks` usa 64 eventos (`server/routes/copilot-api/stream.js:112-114`) | Reconexoes apos burst podem perder historico curto sem alerta claro |
| GAP-STR-013 | low | error transparency | `writeSseEvent` engole erro de write e apenas remove client (`terminal/dialog/sse.js:88-92`) | Sem telemetria rica de causa-raiz de desconexao |
| GAP-STR-014 | medium | contract tests | Nao ha teste que compare explicitamente documento de arquitetura vs comportamento implementado | Drift documental volta a ocorrer com facilidade |

## 5) Parte II — Upgrades recomendados

| ID | Prioridade | Upgrade | Proposta |
|---|---|---|---|
| UPG-STR-001 | P0 | Alinhar doc e runtime | Corrigir imediatamente doc ou remover supressao cross-channel de `client-dialog.js`; manter apenas dedupe por identidade de evento |
| UPG-STR-002 | P0 | Delta envelope canonico | Incluir `turnId`, `streamId`, `chunkSeq`, `source`, `eventId` no payload SSE `delta` |
| UPG-STR-003 | P0 | Contrato versionado | Criar `streaming-contract-v1` com invariantes obrigatorias e matriz de ownership |
| UPG-STR-004 | P1 | Remover acoplamento com busy | Trocar `seenWhileBusy` por estado causal explicito (`renderedByExplicitTurn`, `renderedByPublicStream`) |
| UPG-STR-005 | P1 | Fechamento robusto de stream | Adicionar fechamento por timeout/abort/stall com reason codes |
| UPG-STR-006 | P1 | Testes de regressao cruzada | Suite para `task.delta + dialog.delta + assistant.message` em cenarios de corrida |
| UPG-STR-007 | P1 | SLO formal | Definir SLOs: TTFT p95, delta jitter p95, replay miss rate, transcript mismatch rate |
| UPG-STR-008 | P1 | Telemetria de dedupe | Contadores: `dedupe_identity_hits`, `dedupe_text_hits` (ate extincao), `dedupe_false_positive_suspected` |
| UPG-STR-009 | P1 | Diagnostico ativo | Endpoint/command de inspeccao de streams vivos e estado de replay buffers |
| UPG-STR-010 | P2 | Taxonomia de eventos internos | Substituir regex textual de supressao por flag estruturada (`internal=true`) |
| UPG-STR-011 | P2 | Unificacao SSE terminal/server | Clarificar owner unico de replay-id e empacotamento de evento por canal |
| UPG-STR-012 | P2 | Guardrails de payload | Budget por evento + metrica de truncamento por tipo |
| UPG-STR-013 | P2 | Hardening multi-agente | Revisar politica de descarte em `onAssistantMessage` quando `agentId` presente |
| UPG-STR-014 | P2 | Diff detector doc-codigo | Check automatizado de invariantes de arquitetura em CI |
| UPG-STR-015 | P2 | Chaos streaming | Testes de reconexao, reorder, duplicated delivery, delayed turn_end |
| UPG-STR-016 | P3 | Playback local | Ferramenta de replay de eventos capturados para reproduzir bugs de streaming |
| UPG-STR-017 | P3 | Dashboard de streaming health | Painel com TTFT, throughput, mismatches, fallback-rate, replay depth |
| UPG-STR-018 | P3 | Scorecard de convergencia | Indicadores por owner (terminal/dialog/events/server) com metas por faixa |

## 6) Roadmap amplo (132 itens) — faixas, fases e subfases

### Faixa A — Contrato e governanca (R001-R012)

- Fase A1 (R001-R004): SSOT do contrato
  - R001 Definir `streaming-contract-v1` em contrato canonicamente versionado
  - R002 Declarar invariantes de causalidade (`eventId`, `turnId`, `streamId`)
  - R003 Declarar semantica oficial de fallback (`assistant.message`)
  - R004 Declarar semantica oficial de reasoning (`assistant.reasoning_delta`)
- Fase A2 (R005-R008): ownership e boundaries
  - R005 Mapear owner por evento (`streaming.js`, `client-dialog`, `turn-display`, `task-stream`)
  - R006 Congelar responsabilidades de dedupe por camada
  - R007 Definir policy de compatibilidade retroativa
  - R008 Publicar matriz de impacto por consumer (terminal/server/api/dashboard)
- Fase A3 (R009-R012): governance continua
  - R009 Criar gate CI de drift doc-codigo
  - R010 Adicionar changelog de contrato por breaking/non-breaking
  - R011 Definir rotina de auditoria mensal de streaming
  - R012 Adicionar scorecard de convergencia arquitetural

### Faixa B — Ingestao SDK e dedupe por identidade (R013-R024)

- Fase B1 (R013-R016): ingestao
  - R013 Normalizar envelope de `assistant.message_delta`
  - R014 Normalizar envelope de `assistant.reasoning_delta`
  - R015 Propagar `eventId` nativo quando presente
  - R016 Gerar `eventId` local deterministico quando ausente
- Fase B2 (R017-R020): dedupe
  - R017 Remover dedupe textual temporal do bridge
  - R018 Conservar apenas dedupe por identidade causal
  - R019 Instrumentar contador de dedupe por causa
  - R020 Criar alerta para dedupe acima de limiar
- Fase B3 (R021-R024): resiliencia
  - R021 Tratar duplicate wiring com assinatura de wiringId
  - R022 Garantir reset de cache de dedupe por message_start
  - R023 Cobrir reconnect/resume sem perda de identidade
  - R024 Publicar diagnostico de dedupe em runtime status

### Faixa C — Renderizacao de turno explicito/publico (R025-R036)

- Fase C1 (R025-R028): turn-display
  - R025 Incluir `turnId/chunkSeq` no SSE `delta`
  - R026 Marcar inicio/fim de bloco publico com ids estaveis
  - R027 Garantir flush imediato de chunks curtos em todos os modos
  - R028 Endurecer lock/unlock de render em casos de erro
- Fase C2 (R029-R032): public-assistant-stream
  - R029 Reusar callback por stream para reduzir churn
  - R030 Explicitar `streamKey` canonical para task/global
  - R031 Garantir footer com reason code no fechamento
  - R032 Adicionar fallback de fechamento por timeout
- Fase C3 (R033-R036): consistencia visual
  - R033 Unificar formatacao de prefixos no terminal
  - R034 Preservar quebras de linha com contrato unico
  - R035 Evitar intercalacao de narracao nao-crtica durante stream
  - R036 Expor modo debug visual para delta boundaries

### Faixa D — Integridade de transcript (R037-R048)

- Fase D1 (R037-R040): modelagem de estado
  - R037 Trocar flag `seenWhileBusy` por estado causal explicito
  - R038 Registrar `renderedByExplicitTurn`
  - R039 Registrar `renderedByPublicStream`
  - R040 Registrar `renderedByFallback`
- Fase D2 (R041-R044): flush logic
  - R041 Reescrever regra de flush sem acoplamento em busy
  - R042 Tratar `assistant.turn_end` como reconciliacao deterministica
  - R043 Fechar transcripts pendentes em abort/stall
  - R044 Adicionar reason taxonomy no `detail`
- Fase D3 (R045-R048): auditoria de mismatch
  - R045 Persistir mismatch hash stream vs final
  - R046 Expor mismatch-rate por sessao
  - R047 Gerar evento operacional para mismatch critico
  - R048 Adicionar comando de inspeccao de ultimo mismatch

### Faixa E — SSE, replay e fanout (R049-R060)

- Fase E1 (R049-R052): unificacao de semantica
  - R049 Consolidar ownership de event-id entre terminal/server
  - R050 Definir contrato unico de replay por canal
  - R051 Padronizar payload envelope (`runtimeId`, `hubSessionId`, `eventId`)
  - R052 Documentar politicas de truncamento por campo
- Fase E2 (R053-R056): backpressure
  - R053 Medir queue depth efetiva por pool
  - R054 Medir send failures por cliente/canal
  - R055 Aplicar politicas de shed controladas para clientes lentos
  - R056 Emitir eventos de drop com causa estruturada
- Fase E3 (R057-R060): reconexao
  - R057 Cobrir `Last-Event-ID` em testes de rotas SSE
  - R058 Simular reconnect em burst de deltas
  - R059 Validar replay parcial em `/stream/tasks`
  - R060 Publicar runbook de replay-depth tuning

### Faixa F — Observabilidade e SLO (R061-R072)

- Fase F1 (R061-R064): metricas de fluxo
  - R061 TTFT p50/p95 por modelo
  - R062 Throughput de chunks por segundo
  - R063 Jitter de inter-arrival de deltas
  - R064 Tempo total de resposta por canal
- Fase F2 (R065-R068): metricas de qualidade
  - R065 Transcript mismatch rate
  - R066 Fallback rate (`stream_delta` vs `assistant_message` vs `direct_reply`)
  - R067 Replay miss rate
  - R068 Duplicate event rate por causa
- Fase F3 (R069-R072): operacao
  - R069 Dashboard health stream
  - R070 Alertas de SLO breach
  - R071 Correlacao por traceId/turnId
  - R072 Exportacao de diagnostico para incident review

### Faixa G — Testes (R073-R096)

- Fase G1 (R073-R078): unitarios core
  - R073 Testar dedupe somente por identidade
  - R074 Testar preservacao de repeticao legitima cross-channel
  - R075 Testar flush em `assistant.turn_end`
  - R076 Testar flush em `task.error`
  - R077 Testar fechamento por abort/stall
  - R078 Testar envelope completo de `delta`
- Fase G2 (R079-R084): integracao terminal
  - R079 Turno ativo com `dialog.delta` + `assistant.message`
  - R080 Turno ocioso com `task.delta` live
  - R081 Reconexao SSE com replay parcial
  - R082 Reconexao SSE com buffer overflow
  - R083 Corrida `task.completed` antes/depois de `turn_end`
  - R084 Corrida `busy` toggle durante delta stream
- Fase G3 (R085-R090): integracao server/api
  - R085 `/events` com filtros wildcard
  - R086 `/events/critical` apenas eventos criticos
  - R087 `/api/copilot/stream` por runtimeId
  - R088 `/api/copilot/stream/tasks` em burst
  - R089 Replay por `Last-Event-ID` com gaps
  - R090 Fanout terminal->server sem duplicidade
- Fase G4 (R091-R096): chaos/regressao
  - R091 Duplicate wiring intencional
  - R092 Payloads nao serializaveis no replay
  - R093 Queda de conexao durante stream longo
  - R094 Latencia artificial alta no writer
  - R095 Falha de socket paralela ao SSE
  - R096 Turno sem `assistant.message` final

### Faixa H — Seguranca e governanca de conteudo (R097-R108)

- Fase H1 (R097-R100): fronteiras de conteudo
  - R097 Revisar exposicao de reasoning em SSE publico
  - R098 Garantir redacao consistente de campos sensiveis
  - R099 Policy de truncamento por tipo de evento
  - R100 Policy de retention para replay buffers
- Fase H2 (R101-R104): isolamento multi-runtime
  - R101 Assegurar segregacao por runtimeId em todas as rotas
  - R102 Assegurar segregacao por hubSessionId quando aplicavel
  - R103 Testar cross-talk entre runtimes simultaneos
  - R104 Auditar fallbacks globais de broadcast
- Fase H3 (R105-R108): hardening
  - R105 Telemetria de truncamento com cardinalidade controlada
  - R106 Controles para flood de deltas
  - R107 Limite explicito de payload de evento
  - R108 Runbook de resposta a leak de stream

### Faixa I — Resiliencia de runtime (R109-R120)

- Fase I1 (R109-R112): lifecycle
  - R109 Reconciliacao explicita entre `dialog.stopped` e streams pendentes
  - R110 Fechamento deterministico em watchdog recovery
  - R111 Fechamento deterministico em restart de modelo
  - R112 Estado de stream em compaction/session rewind
- Fase I2 (R113-R116): diagnostico
  - R113 Comando `/stream-status` com counters e filas
  - R114 Snapshot de ultimos N eventos por stream
  - R115 Captura de trilha causal por turnId
  - R116 Indicador de drift doc-runtime no status
- Fase I3 (R117-R120): performance
  - R117 Benchmark de custo por chunk
  - R118 Benchmark com 1, 10, 100 clientes SSE
  - R119 Benchmark com replay ativado/desativado
  - R120 Benchmark de lock contention em render

### Faixa J — Rollout e documentacao operacional (R121-R132)

- Fase J1 (R121-R124): rollout tecnico
  - R121 Feature flag para novo contrato de delta
  - R122 Canary interno com comparacao de mismatch-rate
  - R123 Kill switch de dedupe legacy
  - R124 Plano de rollback sem perda de observabilidade
- Fase J2 (R125-R128): governanca
  - R125 Atualizar arquitetura oficial do terminal streaming
  - R126 Atualizar mapa de owners por arquivo
  - R127 Atualizar runbooks de incidentes de stream
  - R128 Atualizar scorecard mensal com metas
- Fase J3 (R129-R132): operacao continua
  - R129 Ritual quinzenal de triagem de regressao
  - R130 Auditoria trimestral de contratos SSE
  - R131 Auditoria trimestral de dedupe correctness
  - R132 Auditoria trimestral de replay resilience

## 7) Priorizacao recomendada (ordem de execucao)

1. **P0 imediato**: BUG-STR-001, BUG-STR-002, UPG-STR-001, UPG-STR-002, UPG-STR-003.  
2. **P1 curto ciclo**: GAP-STR-003/004/005/009/011 + UPG-STR-004..009.  
3. **P2/P3**: consolidacao SSE/fanout, hardening multi-runtime, observabilidade de maturidade e governanca continua.

## 8) Conclusao

O sistema evoluiu corretamente na direcao de streaming incremental publico, mas ainda nao esta em convergencia canonica completa porque persiste uma deduplicacao temporal no bridge que conflita com o contrato declarado, e porque a integridade de transcript ainda depende de acoplamentos implicitos entre estado de busy e fechamento de fluxo. O roadmap acima (132 itens) fecha esse gap de forma governada por owners, contrato explicito, observabilidade e testes de regressao/chaos.

