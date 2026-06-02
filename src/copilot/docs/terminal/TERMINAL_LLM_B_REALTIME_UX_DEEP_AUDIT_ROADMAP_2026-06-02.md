# Terminal LLM-B Realtime UX Deep Audit Roadmap - 2026-06-02

## 00. Status deste documento

- Documento criado em 2026-06-02.
- Escopo primario: `src/copilot/terminal`.
- Escopo associado: `src/copilot/mcp`, `src/copilot/model-gateway`, scripts de teste live e estado local do terminal.
- Objetivo: orientar a consolidacao do terminal LLM-B como superficie realtime confiavel.
- Estado atual: trilha funcional passou, mas a superficie visual ainda esta ruim em PTY real e nas screenshots do operador.
- Prioridade imediata: fazer uma revolucao de UX sem quebrar transcript/export/SSE ja estabilizados.
- Prioridade secundaria: eliminar status duplicado, IDs crus, labels tecnicos e pergunta humana tratada como tool comum.
- Prioridade terciaria: compactar banner, menu, auto-brief, health/activity/tools e artefatos de diagnostico com layout responsivo.

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
- A UX padrao deve esconder IDs internos longos; eles continuam disponiveis em `/events`, `/tools diag`, `/activity` detalhado e export.
- Pergunta humana nao e tool comum na narrativa visual; e um estado de bloqueio humano com card proprio, prompt proprio e answer path proprio.
- Linha viva e watchdog nao podem competir na mesma regiao visual.
- O modo full pode ser rico, mas nao deve despejar menus gigantes no primeiro viewport.
- Toda linha duravel deve caber em largura razoavel ou ser quebrada de forma intencional.

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
- `tool.lifecycle` agora alimenta um estado diagnostico bounded para `/tools diag`, sem substituir o registry operacional session-scoped.
- `/tools diag` agora mostra lifecycle ativo/recente com `toolCallId`, `requestId`, trace, status, progresso e duracao em formato compacto.
- `/export` agora aplica redaction explicita em conteudo de turno e campos textuais de envelope/streaming antes de gravar Markdown.
- O runner live agora exige `tool.lifecycle` estruturado para `report_intent` e `read_file_content`; texto simulado em stdout nao satisfaz mais a prova de tool real.
- O runner live agora compara eventos canonicos de SSE/archive contra envelopes do export por `source + trace/turn` para ask_user, resposta humana e final pos-ask.
- `/events` agora mostra hint compacto de `transcript` e `export=envelope:<source> trace=<trace> turn=<turn>` para eventos canonicos de transcript.
- `/usage now` agora destaca telemetria de continuacao `ask_user` separada da fala inicial e aponta para correlacao por `/events` + `/export`.
- `/health` agora mostra o modo efetivo de inline status (`reserved`, `overlay` ou `off`) e a origem da policy.

## 02.03 Evidencia apos criterios estruturados

- Comando:
  - `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --out-dir=data/copilot-terminal/live-runs/terminal-ux-audit-20260602-040434`
- Status:
  - PASS.
  - 41/41 criterios obrigatorios passaram.
  - `sdkSessionBootSelection=forced-new`.
  - 232 eventos SSE, 230 com id/source e 174 com traceId.
  - Zero erros no terminal.
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-040434/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-040434/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-040434/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-040434/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-audit-20260602-040434/conversation-export.md`
- Pontos validados:
  - `tool-start-done` passou por lifecycle estruturado de `read_file_content`.
  - `report-intent-lifecycle` passou por lifecycle estruturado de `report_intent`.
  - `sse-canonical-transcript-events` identificou delta, ask_user, resposta humana e final pos-ask.
  - `export-sse-correlation` casou ask, resposta humana e pos-ask por `source + trace/turn`.
  - `/usage now` exibiu continuacao `ask_user` sem Premium Request.
  - `/health` exibiu `inline status reserved source=default`.

## 02.04 Runner de cenarios alternativos

- O runner `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` agora aceita `--live-scenario=<canonical|freeform|invalid-choice|long-tool-heartbeat|recoverable-tool-error|file-write-roundtrip>`.
- `canonical` preserva o baseline anterior: pergunta `ASK-CANONICAL`, resposta `SIM`, final `POST-ASK-CANONICAL-FINAL`.
- `freeform` gera prompt de `ask_user` sem choices obrigatorias e valida resposta humana livre no SSE/export.
- `invalid-choice` gera prompt choice-only, envia primeiro `TALVEZ`, exige feedback local de escolha invalida e envia `SIM` em seguida.
- `long-tool-heartbeat` exige `exec_command` controlado com marker `LONG-TOOL-HEARTBEAT-DONE`, lifecycle real e progresso antes de `ask_user`.
- `recoverable-tool-error` exige falha controlada de `exec_command`, detectada em `postToolUse` por JSON `success:false`/`exitCode=7`, seguida de recuperacao por `read_file_content`, `ask_user` e final.
- `file-write-roundtrip` exige `create_file`, `move_file` e `delete_file` reais em scratch controlado, com marker `TERMINAL-PERMISSION-ROUNDTRIP`, lifecycle estruturado e ausencia de prompt de permissao.
- O tipo persistido em SQLite continua `canonical_full_turn` para o baseline e usa `canonical_full_turn_<cenario>` para variantes.
- Validacao seca executada:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=canonical --out-dir=artifacts/terminal-live-dry/canonical`
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=freeform --out-dir=artifacts/terminal-live-dry/freeform`
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=invalid-choice --out-dir=artifacts/terminal-live-dry/invalid-choice`
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=long-tool-heartbeat --out-dir=artifacts/terminal-live-dry/long-tool-heartbeat`
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=recoverable-tool-error --out-dir=artifacts/terminal-live-dry/recoverable-tool-error`
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=file-write-roundtrip --out-dir=artifacts/terminal-live-dry/file-write-roundtrip`
  - `npx vitest run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
- Observacao:
  - estes dry-runs validam prompt, contrato e parsing do runner;
  - markers de output de cenario agora precisam aparecer em resultado real de tool ou lifecycle, nao apenas no prompt inicial;
  - falha recuperavel esperada nao satisfaz criterio por texto em portugues/ingles; precisa de dado estruturado de lifecycle ou `postToolUse`.

## 02.05 Evidencia live dos cenarios alternativos

- Resposta freeform:
  - comando: `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=data/copilot-terminal/live-runs/terminal-ux-freeform-20260602-0421`
  - status: PASS.
  - criterios: 41/41 obrigatorios.
  - SSE: 194 eventos, 192 com id/source, 132 com traceId, zero erros.
  - SQLite: `terminal-live:2026-06-02T07-22-08-553Z:canonical_full_turn_freeform`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-freeform-20260602-0421/summary.md`.
- Choice invalida:
  - comando: `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=invalid-choice --out-dir=data/copilot-terminal/live-runs/terminal-ux-invalid-choice-20260602-0423`
  - status: PASS.
  - criterios: 42/42 obrigatorios.
  - SSE: 178 eventos, 176 com id/source, 120 com traceId, zero erros.
  - Validou rejeicao local de `TALVEZ`, preservacao da pergunta e resposta valida posterior `SIM`.
  - SQLite: `terminal-live:2026-06-02T07-22-59-121Z:canonical_full_turn_invalid-choice`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-invalid-choice-20260602-0423/summary.md`.
- Tool longa com heartbeat:
  - comando: `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=long-tool-heartbeat --out-dir=data/copilot-terminal/live-runs/terminal-ux-long-tool-20260602-0427`
  - status: PASS.
  - criterios: 43/43 obrigatorios.
  - SSE: 311 eventos, 309 com id/source, 243 com traceId, zero erros.
  - Validou `exec_command` real com lifecycle completo e marker `LONG-TOOL-HEARTBEAT-DONE`.
  - SQLite: `terminal-live:2026-06-02T07-26-45-818Z:canonical_full_turn_long-tool-heartbeat`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-long-tool-20260602-0427/summary.md`.
- Erro de tool recuperavel:
  - comando final: `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=recoverable-tool-error --out-dir=data/copilot-terminal/live-runs/terminal-ux-recoverable-tool-error-20260602-0439`
  - status: PASS.
  - criterios: 43/43 obrigatorios.
  - SSE: 231 eventos, 229 com id/source, 157 com traceId, zero erros.
  - Validou `exec_command` real com `postToolUse` contendo `success:false`, `exitCode=7` e stderr `RECOVERABLE-TOOL-ERROR`.
  - Validou recuperacao por `read_file_content`, deltas canonicos, `ask_user`, resposta humana e final pos-ask.
  - SQLite: `terminal-live:2026-06-02T07-35-13-548Z:canonical_full_turn_recoverable-tool-error`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-recoverable-tool-error-20260602-0439/summary.md`.
  - nota de auditoria: um run anterior com arquivo ausente (`terminal-ux-recoverable-tool-error-20260602-0428`) tinha criterio falso positivo por texto; isso foi corrigido para exigir dado estruturado.

## 02.06 Evidencia live de permissao maxima sem janela SDK

- Objetivo:
  - garantir que o modo default `approve_all` entregue maxima autonomia ao ChatGPT/LLM-B sem prompts/janelas redundantes de permissao para tools locais;
  - preservar `selective` como modo explicito para policy granular;
  - manter auditoria por lifecycle, hooks e `/tools diag` mesmo quando o SDK nao pede permissao interativa.
- Correcao aplicada:
  - `src/copilot/tools/bootstrap.js` agora aplica `skipPermission=true` nas tools entregues a sessao SDK quando `AGENT_PERMISSION_MODE` e `approve_all` ou `audit_only`;
  - a policy e aplicada no array de sessao, depois do registry e antes de `wrapWithStats`;
  - `selective` preserva o contrato original de cada tool;
  - o bootstrap le `AGENT_PERMISSION_MODE` diretamente para evitar ciclo ESM com `#copilot/config`;
  - um primeiro live expôs bug TDZ por sombreamento do import `sessionTools`; a variavel local foi renomeada para `sdkSessionTools`.
- Runner:
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` adicionou criterio hard `no-sdk-permission-prompt-in-approve-all`;
  - o criterio falha se o transcript/archive contiver `permission.requested`, `Permissao solicitada` ou texto equivalente;
  - o criterio e ativado nos cenarios que usam tool permissionada, como `long-tool-heartbeat` e `recoverable-tool-error`.
- Tentativa BYOK diagnosticada:
  - comando: `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=long-tool-heartbeat --out-dir=data/copilot-terminal/live-runs/terminal-ux-long-tool-no-permission-20260602-0447`
  - status: BLOCKED por `assistant-empty-turn` em `kilo-auto/free`;
  - nao houve `permission.requested`, mas o modelo nao executou tools; portanto o run foi descartado como prova de permissao.
- Prova SDK/Copilot:
  - comando: `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=long-tool-heartbeat --out-dir=data/copilot-terminal/live-runs/terminal-ux-long-tool-no-permission-sdk-20260602-0450`
  - status: PASS.
  - criterios: 44/44 obrigatorios.
  - SSE: 346 eventos, 342 com id/source, 264 com traceId, zero erros.
  - Validou `exec_command` real com lifecycle `start`, `external_completed` e `postToolUse` success.
  - Validou marker `LONG-TOOL-HEARTBEAT-DONE` dentro do resultado real de tool.
  - Validou `/tools diag`: `exec_command calls=1 blocked=0 errors=0`.
  - Validou `no-sdk-permission-prompt-in-approve-all`: nenhuma ocorrencia de `permission.requested` ou janela equivalente.
  - SQLite: `terminal-live:2026-06-02T07-47-31-174Z:canonical_full_turn_long-tool-heartbeat`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-long-tool-no-permission-sdk-20260602-0450/summary.md`.
- Prova SDK/Copilot de escrita/movimentacao/delecao:
  - comando: `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=file-write-roundtrip --out-dir=data/copilot-terminal/live-runs/terminal-ux-file-write-no-permission-sdk-20260602-0454`
  - status: PASS.
  - SSE: 365 eventos, 361 com id/source, 261 com traceId, zero erros.
  - Validou `create_file`, `move_file` e `delete_file` reais com lifecycle `start`, `external_completed` e `postToolUse` success.
  - Validou marker `TERMINAL-PERMISSION-ROUNDTRIP` dentro do resultado real de tool.
  - Validou `no-sdk-permission-prompt-in-approve-all`: nenhuma ocorrencia de `permission.requested`, `Permissao solicitada` ou texto equivalente.
  - Validou `/tools diag`: `create_file calls=1 blocked=0 errors=0`, `move_file calls=1 blocked=0 errors=0`, `delete_file calls=1 blocked=0 errors=0`.
  - Validou scratch limpo apos o roundtrip: nenhum `TERMINAL-PERMISSION-ROUNDTRIP-*` residual em `data/copilot-terminal/live-scratch`.
  - SQLite: `terminal-live:2026-06-02T07-54-18-007Z:canonical_full_turn_file-write-roundtrip`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-file-write-no-permission-sdk-20260602-0454/summary.md`.

## 02.07 Evidencia live de semantica MOVE no terminal

- Problema observado:
  - `move_file` executava corretamente, mas era renderizado como `[INSPECT] move_file · executando tool generica`;
  - o I/O bruto ja mostrava `[MOVE]`, criando divergencia entre lifecycle SDK, turn trace e atividade de I/O.
- Correcao aplicada:
  - `src/copilot/core/tool-target-introspection.js` agora reconhece `source` e `destination` como alvos de arquivo;
  - `src/copilot/terminal/events/tool-activity-presenter.js` reconhece `copy` e `move`, inclusive por `evt.operation`;
  - `src/copilot/terminal/events/io-activity-events.js` preserva `copy` e `move` na projecao do turn trace;
  - `src/copilot/terminal/state/turn-trace-state.js` aceita `copy` e `move` como operacoes canonicas.
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` passou a exigir `[TOOL] [MOVE] move_file` e proibir `[TOOL] [INSPECT] move_file` no cenario `file-write-roundtrip`.
- Prova SDK/Copilot:
  - comando: `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=file-write-roundtrip --out-dir=data/copilot-terminal/live-runs/terminal-ux-file-write-move-presenter-sdk-20260602-0515`
  - status: PASS.
  - SSE: 353 eventos, 349 com id/source, 251 com traceId, zero erros.
  - Validou `move_file` renderizado como `[TOOL] [MOVE] move_file · movendo arquivo`.
  - Validou resumo de turno com `[TOOLS] MOVE move_file` e `[FILES] MOVE ...`.
  - Validou ausencia de `[INSPECT] move_file` no transcript plain.
  - Validou `no-sdk-permission-prompt-in-approve-all` e scratch limpo apos roundtrip.
  - SQLite: `terminal-live:2026-06-02T08-13-58-566Z:canonical_full_turn_file-write-roundtrip`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-file-write-move-presenter-sdk-20260602-0515/summary.md`.

## 02.08 Saneamento de auto-brief parcial de boot

- Problema observado:
  - o `auto-brief:boot` roda antes de o registry/dialog estar pronto;
  - nessa janela parcial, a mensagem `file-tools canonicas locais nao estao totalmente disponiveis` podia aparecer como alerta, embora o `auto-brief:ready` logo em seguida confirmasse `tools=105`, `fs=sim` e `exec=sim`;
  - isso induzia operador humano e LLM a suspeitar de ausencia de tools locais quando havia apenas boot parcial.
- Correcao aplicada:
  - `src/copilot/terminal/repl/auto-brief.js` filtra apenas o warning transitorio de file-tools ausentes durante `phase=boot` ainda nao pronto;
  - o proprio `estado=parcial` continua visivel e explica que um brief pos-bootstrap sera emitido;
  - warnings reais, como arquivos de instrucoes ausentes, continuam aparecendo mesmo no boot parcial.
- Validacao:
  - `tests/unit/copilot/terminal/test_auto_brief.spec.js` cobre a supressao do warning transitorio;
  - o mesmo teste confirma que warning de instrucoes ausentes permanece visivel.

## 02.09 Clareza em `session.tools_updated`

- Problema observado:
  - no live SDK/Copilot, o terminal podia imprimir `Tools dinamicas SDK atualizadas: 0 SDK · registry local: 105 (/tools)`;
  - a mensagem era tecnicamente correta, mas misturava duas superficies diferentes e podia sugerir ausencia de tools, apesar de o registry local estar ativo.
- Correcao aplicada:
  - `src/copilot/terminal/events/sdk-session-events.js` separa `tool(s) SDK dinamicas` de `tool(s) locais ativas em /tools`;
  - quando o SDK nao materializa contagem, a mensagem diz explicitamente `SDK sinalizou atualizacao sem contagem materializada`;
  - o SSE `session.tools_updated` agora expoe `localToolsActive` junto de `sdkCount` e `localCount`.
- Validacao:
  - `tests/unit/copilot/test_terminal_sdk_session_events.spec.js` cobre contagem SDK materializada, contagem ausente e lista SDK materializada vazia.

## 02.10 Diagnostico explicito de prompts SDK por permission mode

- Problema observado:
  - `/status` e `/permission mode` exibiam `approve_all`, `audit_only` ou `selective`, mas nao traduziam o efeito operacional para prompts/janelas SDK;
  - depois da policy `skipPermission=true` em `approve_all`/`audit_only`, o operador precisava inferir que janelas SDK estavam desativadas por padrao.
- Correcao aplicada:
  - `src/copilot/terminal/state/sdk-interactions.js` exporta `terminalPermissionModeSkipsSdkPrompts`;
  - `/permission mode` mostra `sdk prompts=skip` quando o modo efetivo pula prompts SDK;
  - `/status` mostra `permission mode approve_all · sdk prompts=skip`;
  - `/health` mostra `permission approve_all · sdk prompts=skip`;
  - `selective` continua descrito como modo que pode solicitar autorizacao conforme policy.
  - o runner live exige `health-permission-policy-visible` em cenarios permissionados.
- Validacao:
  - `tests/unit/copilot/terminal/test_sdk_interactions.spec.js` cobre o helper;
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js` cobre `/permission mode`;
  - `tests/unit/copilot/terminal/test_commands_session.spec.js` cobre `/status`.
  - `tests/unit/copilot/terminal/test_commands_diagnose.spec.js` cobre `/health`.

## 02.11 Auditoria visual profunda das screenshots do operador

- Contexto:
  - as screenshots do operador mostram o terminal dentro do painel integrado do VS Code;
  - a largura util parece ficar entre 80 e 100 colunas;
  - a UX atual tenta imprimir uma superficie de operacao grande demais para esse viewport;
  - a UX tambem mistura output duravel com status que deveria ser transitorio.
- Screenshot A, loop com timeout:
  - linhas repetidas `LLM-B ainda trabalhando`;
  - linhas repetidas `request_user_input ainda executando`;
  - ID bruto `chatcmpl-tool-...` exposto em linha normal;
  - o operador nao ve uma pergunta em destaque;
  - o terminal termina com timeout por ausencia de resposta;
  - a ausencia de resposta parece falha do modelo, mas o estado real e espera humana pendente.
- Screenshot B, boot e primeira tool:
  - `request_user_input` aparece como `[TOOL] [RUN]`;
  - `report_intent_local (alias: report_intent)` aparece como nome visual primario;
  - ha mistura de `[INTENT]`, `[TOOL]`, `[IO]`, `[TURN]`, `[TOOLS]`, `[FILES]` sem hierarchy suficiente;
  - nomes internos como `report_intent`, `hooks_get_pending_tasks` e `get_session_state` competem com texto humano;
  - linhas de tool e linhas de resumo nao alinham visualmente;
  - a pergunta humana vira mais uma entrada no log, nao um estado bloqueante.
- Screenshot C, banner/menu:
  - menu inicial excede o primeiro viewport;
  - quase todos os comandos sao despejados de uma vez;
  - linhas longas quebram no meio;
  - o box inicial aparece duplicado em relacao ao banner grande;
  - auto-brief em key/value ocupa muitas linhas com pouco ganho imediato;
  - termos como `auto-brief:boot`, `sdkWorkspace`, `parser=0`, `cache=hit=0%` sao bons para debug, ruins como tela inicial padrao.
- Screenshot D, modo standalone:
  - o box `Terminal Permanente LLM-B` tem colunas desalinhadas;
  - a mensagem de MCP indisponivel e correta, mas parece alerta central mesmo quando tools locais estao ativas;
  - `você[kilo-auto/free/high]` compete com blocos de status;
  - apos o primeiro turno, detalhes tecnicos do SDK aparecem cedo demais.
- Conclusao visual:
  - o problema nao e apenas cor ou icone;
  - o problema e uma arquitetura de renderizacao sem camadas visuais rigidas;
  - a UX precisa separar status vivo, narracao duravel, tool cards, prompt, pergunta humana e diagnostico bruto;
  - o modo default deve ser bonito, compacto e operacional;
  - o modo debug deve continuar profundo, mas sob comando explicito.

## 02.12 Evidencia live PTY da rodada de UX visual

- Comando executado:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=canonical --out-dir=data/copilot-terminal/live-runs/terminal-ux-revolution-baseline-sdk-20260602-0557`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-baseline-sdk-20260602-0557/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-baseline-sdk-20260602-0557/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-baseline-sdk-20260602-0557/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-baseline-sdk-20260602-0557/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-baseline-sdk-20260602-0557/conversation-export.md`
- Resultado funcional:
  - status PASS;
  - 281 eventos SSE;
  - 0 erros;
  - export com ask_user, resposta humana e final pos-ask;
  - inline status renderizado;
  - permissao SDK em `approve_all` confirmada por `/health`.
- Problemas visuais confirmados no `terminal.plain.log`:
  - `⟲ LLM-B boot/Subindo servidor copilot` aparece colado ao prompt inicial;
  - menu inicial despeja dezenas de comandos no primeiro viewport;
  - auto-brief `boot` e `ready` aparece como linhas densas de key/value;
  - existem duas linhas vivas concorrentes: `⏳ aguardando auto` e `⟲ LLM-B ...`;
  - `report_intent_local (alias: report_intent)` aparece como display normal;
  - `toolu_bdrk_...` aparece como target de `report_intent`;
  - o resumo `[TOOLS]` tambem mostra o ID longo;
  - o prompt `você[auto/high]›` fica visualmente colado ao `[ASK]`;
  - a linha viva waiting-human quebra em quatro linhas e a resposta `SIM` fica na mesma regiao visual;
  - apos a resposta, `turnId=1` aparece em status vivo como informacao tecnica de baixo valor;
  - `/activity` ainda mostra IDs longos em modo comum.
- Diferenca entre funcionalidade e UX:
  - o teste passa porque a semantica esta correta;
  - a experiencia humana continua ruim porque o output bruto revela muitos detalhes de infraestrutura;
  - a proxima fase deve manter os criterios funcionais e adicionar criterios esteticos/ergonomicos.

## 02.13 Mapa causal da UX ruim

- Causa 1: `dialog/output.js` tenta reservar linhas acima do prompt, mas qualquer bloco permanente limpa e re-reserva a area.
- Causa 2: `dialog/engine.js` imprime narracao duravel `LLM-B ainda trabalhando` alem do status vivo transitorio.
- Causa 3: `repl/live-status-line.js` tambem imprime `⟲ LLM-B` em intervalo proprio.
- Causa 4: `formatLiveWaitingStatus()` e a linha viva permanente usam estilos diferentes para o mesmo estado.
- Causa 5: `agent-runtime-events.js` imprime heartbeat de tool com `toolCallId` bruto.
- Causa 6: `tool-activity-presenter.js` usa `requestId` e `toolCallId` como fallback de target.
- Causa 7: `tool-activity-presenter.js` mostra alias tecnico como texto normal.
- Causa 8: `request_user_input` recebe label semantico de espera humana, mas continua com operation `run`.
- Causa 9: `tool-lifecycle-runtime.js` renderiza operation `run` como `[RUN]`, entao pergunta humana parece tool executavel.
- Causa 10: `intent-renderer.js` ainda mostra `call=` no modo visual comum.
- Causa 11: `commands/menu.js` e banner inicial privilegiam completude sobre escaneabilidade.
- Causa 12: `auto-brief.js` renderiza dados tecnicos em primeira tela sem agrupamento visual.
- Causa 13: `commands/activity.js`, `/tools diag` e `/events` nao diferenciam suficientemente modo operador e modo debug.
- Causa 14: nomes de tools e nomes de eventos nao passam por um glossario visual canonico.
- Causa 15: a linha viva permite detalhes longos demais (`LIVE_DETAIL_CATASTROPHIC_CHARS = 2000`).

## 02.14 Situacao ideal visual proposta

- Camada A: prompt.
  - sempre estavel;
  - sempre em uma linha limpa quando houver largura;
  - tags curtas e padronizadas;
  - `[ASK]` so aparece quando ha pergunta pendente;
  - input digitado pelo operador nunca divide linha com status.
- Camada B: status vivo.
  - exatamente um mecanismo ativo por vez;
  - maximo de duas linhas fisicas no default;
  - sem IDs internos longos;
  - sem repetir como log permanente;
  - com progresso temporal compacto: `12s`, `1m04s`, `2h03m`.
- Camada C: tool cards.
  - cada tool tem um nome humano curto;
  - cada tool tem uma acao humana: `READ`, `WRITE`, `MOVE`, `ASK`, `INTENT`, `CHECK`, `RUN`;
  - IDs e requestIds ficam ocultos por default;
  - aliases aparecem apenas em debug;
  - target e caminho aparecem com truncamento inteligente.
- Camada D: pergunta humana.
  - card proprio `ASK`;
  - uma renderizacao duravel, nao repetida;
  - escolhas alinhadas;
  - dica clara: `responda digitando uma opcao ou texto`;
  - timeout de modelo nao deve disparar enquanto o estado real e espera humana.
- Camada E: transcript.
  - fala da LLM-B continua legivel e separada;
  - reasoning continua recolhido por default;
  - uso/custo aparece em linha curta;
  - blocos longos sao truncados com comando de drill-down.
- Camada F: boot.
  - primeira tela deve mostrar no maximo:
    - titulo compacto;
    - estado do agente;
    - modelo/provider;
    - permissao;
    - tools locais;
    - comandos essenciais;
    - proximo passo;
  - menu completo fica em `/help`.
- Camada G: diagnostico.
  - `/activity`, `/tools diag`, `/events`, `/health` podem mostrar IDs, mas com `compactId` e label claro;
  - modo full/debug pode ser ativado, nao deve ser despejado sempre.

## 02.15 Glossario visual canonico inicial

- `report_intent` e `report_intent_local`:
  - nome tecnico preservado em SSE/export;
  - nome visual default: `Intent capturado`;
  - badge default: `[INTENT]`;
  - target default: texto do intent, nunca `toolCallId`;
  - alias tecnico apenas em detalhe.
- `request_user_input`:
  - nome tecnico preservado em SSE/export;
  - nome visual default: `Pergunta ao operador`;
  - badge default: `[ASK]`;
  - operation visual: `ask`;
  - target default: pergunta;
  - heartbeat duravel: suprimido.
- `ask_user`:
  - nome visual default: `Pergunta ao operador`;
  - badge default: `[ASK]`;
  - nao deve ser tratado como tool comum no transcript.
- `read_file_content`:
  - nome visual default: `Ler arquivo`;
  - badge default: `[READ]`;
  - target default: caminho e range.
- `get_session_state`:
  - nome visual default: `Estado da sessao`;
  - badge default: `[CHECK]`.
- `hooks_get_pending_tasks`:
  - nome visual default: `Pendencias de hooks`;
  - badge default: `[CHECK]`.
- `create_file`:
  - nome visual default: `Criar arquivo`;
  - badge default: `[WRITE]`.
- `move_file`:
  - nome visual default: `Mover arquivo`;
  - badge default: `[MOVE]`.
- `delete_file`:
  - nome visual default: `Excluir arquivo`;
  - badge default: `[DELETE]`.

## 02.16 Requisitos ergonomicos novos

- Requisito UX-01:
  - nenhum `chatcmpl-tool-*`, `toolu_*`, UUID ou requestId completo deve aparecer na narrativa default de tool.
- Requisito UX-02:
  - `report_intent` nao deve aparecer como `report_intent_local (alias: report_intent)` na linha visual comum.
- Requisito UX-03:
  - `request_user_input` nao deve aparecer como `[TOOL] [RUN]`.
- Requisito UX-04:
  - `request_user_input` nao deve receber heartbeat duravel `ainda executando`.
- Requisito UX-05:
  - quando ha pergunta humana pendente, o timeout de turno deve mostrar `aguardando operador`, nao `mensagem nao produziu resposta`.
- Requisito UX-06:
  - linha viva deve truncar detalhes agressivamente antes de quebrar quatro linhas.
- Requisito UX-07:
  - boot default deve caber no primeiro viewport de 80x24 com comandos essenciais.
- Requisito UX-08:
  - menu completo deve ir para `/help`, nao para boot default.
- Requisito UX-09:
  - auto-brief default deve ser agrupado em 3 a 5 linhas, com modo detalhado sob comando.
- Requisito UX-10:
  - live runner deve ter checks esteticos simples, alem dos checks semanticos.

## 02.17 Evidencia live PTY apos revolucao visual M-P

- Comando executado:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=canonical --out-dir=data/copilot-terminal/live-runs/terminal-ux-revolution-pass3-sdk-20260602-0621`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass3-sdk-20260602-0621/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass3-sdk-20260602-0621/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass3-sdk-20260602-0621/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass3-sdk-20260602-0621/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass3-sdk-20260602-0621/conversation-export.md`
- Resultado funcional:
  - status PASS;
  - 293 eventos SSE;
  - 0 erros;
  - export com ask_user, resposta humana e final pos-ask;
  - permissao SDK em `approve_all` confirmada por `/health`;
  - criterios de streaming, tool lifecycle, ask_user, SSE archive e export continuaram verdes.
- Resultado visual novo:
  - `ux-compact-boot-banner` passou;
  - `ux-human-tool-names` passou;
  - `ux-no-raw-tool-ids-in-default-tool-lines` passou;
  - `ux-no-durable-waiting-spam` passou;
  - `ux-single-live-status-source` passou;
  - `no-prompt-double-render` passou;
  - `inline-status-rendered` passou.
- Melhorias observadas no `terminal.plain.log`:
  - `report_intent_local (alias: report_intent)` virou `Intent capturado`;
  - `read_file_content` virou `Ler arquivo`;
  - `request_user_input`/`ask_user` virou superficie `[ASK]`;
  - `chatcmpl-tool-*` e `toolu_*` deixaram de aparecer nas linhas default de `[TOOL]`, `[DONE]`, `[TOOLS]`, `[ASK]` e `[INTENT]`;
  - a narracao duravel `LLM-B ainda trabalhando` deixou de competir com a linha viva;
  - o status de watchdog nao renderizou uma segunda linha viva quando a linha permanente estava habilitada.
- Gaps visuais residuais confirmados:
  - `/health` ainda mostra nomes tecnicos em `TOOL STATS`, como `report_intent_local` e `read_file_content`;
  - o banner REPL compacto e o box standalone ainda aparecem como duas superficies de boot;
  - a linha viva de ASK ainda pode ocupar tres linhas fisicas em largura estreita;
  - a resposta `SIM` ainda pode aparecer muito perto da area reservada da linha viva em PTY;
  - `/events --raw` e SSE bruto continuam corretamente tecnicos, mas comandos de diagnostico precisam de headers mais claros.

## 02.18 Segunda rodada UX: diagnosticos humanos e resposta menos tecnica

- Escopo implementado apos o commit `feat(terminal): improve llm-b realtime ux`:
  - presenter passou a exportar helpers canonicos para nome humano, ID diagnostico compacto e deteccao de ID interno;
  - `/health` passou a renderizar `TOOL STATS` com nomes humanos, sem `read_file_content`/`report_intent_local` no modo default;
  - `/tools` default passou a renderizar nomes humanos;
  - `/tools diag` manteve nomes tecnicos sob label explicito `tool técnico`;
  - lifecycle recente de `/tools diag` passou a usar nome humano como titulo e nome tecnico no detalhe;
  - confirmacao de resposta humana deixou de imprimir `(default)` no fluxo normal;
  - `/answer --runtime alt ...` continua mostrando `runtime=alt`, pois ali o detalhe e acao explicita do operador.
- Testes focados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`
  - Resultado: 4 arquivos, 58 testes, PASS.
- Gaps ainda em aberto:
  - live PTY confirmou a melhoria no terminal real em `terminal-ux-revolution-pass4-sdk-20260602-0630`;
  - `/events --raw` continua bruto por contrato, mas precisa de header mais didatico;
  - `/activity` ainda pode mostrar IDs compactos sem explicar suficientemente que sao diagnosticos;
  - o card duravel da pergunta humana ainda deve ser refinado para escolhas alinhadas e resposta visualmente separada.

## 02.19 Evidencia live PTY da segunda rodada UX

- Comando executado:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=canonical --out-dir=data/copilot-terminal/live-runs/terminal-ux-revolution-pass4-sdk-20260602-0630`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass4-sdk-20260602-0630/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass4-sdk-20260602-0630/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass4-sdk-20260602-0630/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass4-sdk-20260602-0630/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass4-sdk-20260602-0630/conversation-export.md`
- Resultado:
  - status PASS;
  - 318 eventos SSE;
  - 0 erros;
  - criterios funcionais preservados;
  - `ux-health-human-tool-stats` passou;
  - `ux-human-answer-confirmation` passou;
  - `/tools diag` mostrou nomes humanos como titulo e nomes tecnicos apenas em linhas `tool técnico: ...`;
  - `/health` mostrou `Ler arquivo` e `Intent capturado` no top-5, sem `read_file_content`/`report_intent_local` no modo default.
- Observacao:
  - o modelo respondeu em multiplos turnos internos e adicionou texto publico extra antes dos marcadores, mas o contrato testado continuou consistente: tool lifecycle real, deltas, ask_user, resposta humana, pos-ask, export e SSE.
  - a linha viva em turnos longos ainda ocupa tres linhas fisicas em PTY estreito; isso permanece como item de polimento da Faixa P/O.

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
- O teste live `terminal-ux-revolution-pass3-sdk-20260602-0621` confirmou PASS nos criterios esteticos novos e preservou os criterios funcionais existentes.

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
- [x] Garantir que export nao escreva segredos de tool args sensiveis.
- [x] Garantir que markdown nao quebre com respostas multiline.

### Faixa E - Linha viva e prompt estavel

- [x] Definir politica default para inline status.
- [x] Implementar modo reservado seguro por default em TTY.
- [x] Manter opt-out por env para ambientes problemáticos.
- [x] Reduzir redesenhos de prompt em eventos consecutivos.
- [x] Adicionar coalescing temporal pequeno para prompt redraw.
- [x] Evitar duplicacao `prompt prompt` apos blocos permanentes.
- [x] Garantir que input digitado nao seja perdido.
- [x] Garantir que `printlnBlock` nao repinte prompt quando render lock estiver ativo.
- [x] Adicionar teste unitario de prompt redraw coalesced.
- [x] Atualizar live runner para medir prompt churn.

### Faixa F - Tools e atividade

- [x] Revisar `tool-lifecycle-runtime` para status vivo sem excesso de writes.
- [x] Melhorar resumo de `/tools diag`.
- [x] Exibir `toolCallId` e `requestId` de forma compacta.
- [x] Separar start/progress/done visualmente.
- [x] Evitar que ask_user como tool duplique pergunta em transcript.
- [x] Garantir que tool real sempre vença texto simulado.
- [x] Adicionar teste de tool activity com ask_user.
- [x] Adicionar teste direto do estado bounded de `tool.lifecycle`.
- [x] Aplicar `skipPermission=true` nas tools de sessao SDK em `approve_all`/`audit_only`.
- [x] Preservar prompts SDK apenas no modo explicito `selective`.
- [x] Validar por live que `exec_command` roda com `blocked=0` e sem `permission.requested`.

### Faixa G - SSE e archive

- [x] Manter evento bruto no archive sem filtrar fatos relevantes.
- [x] Validar que `user_input.requested` sempre tem source.
- [x] Validar que `user_input.completed` sempre tem source.
- [x] Validar que `question.answered` nao duplica transcript.
- [x] Adicionar correlacao mais clara entre stdout e SSE para pos-ask.
- [x] Atualizar live runner para comparar export contra SSE.

### Faixa H - Reconciliacao e materializacao

- [x] Revisar `turn-materialization-state` para turnos pos-ask.
- [x] Garantir que `assistant.message` pos-ask nao seja suprimido por engano.
- [x] Garantir que `dialog.turn_end` truncado nao duplica assistant.message.
- [x] Preservar diagnostico de materializacao em metadata.
- [x] Adicionar teste para turnos separados por ask_user.

### Faixa I - Comandos operacionais

- [x] Revisar `/activity` para mostrar transcript humano recente.
- [x] Revisar `/history` para representar ask_user.
- [x] Revisar `/context` para contar turnos humanos corretamente.
- [x] Revisar `/events` para linkar evento bruto ao transcript.
- [x] Revisar `/usage now` para contexto pos-ask.
- [x] Revisar `/health` para indicar inline status mode.
- [x] Remover falso alerta de file-tools ausentes no `auto-brief:boot` parcial mantendo warnings reais.
- [x] Separar contagem de tools SDK dinamicas da contagem de registry local em `session.tools_updated`.
- [x] Expor `sdk prompts=skip/selective` em `/permission mode`, `/status` e `/health`.
- [x] Adicionar criterio live para `/health` renderizar `approve_all · sdk prompts=skip`.

### Faixa J - Teste live LLM-B

- [x] Atualizar runner para exigir ask_user no export.
- [x] Atualizar runner para exigir resposta humana no export.
- [x] Atualizar runner para exigir pos-ask no export.
- [x] Atualizar runner para contar prompt churn.
- [x] Atualizar runner para detectar `prompt prompt`.
- [x] Atualizar runner para forcar sessao SDK nova nos cenarios full-turn.
- [x] Atualizar runner para nao classificar nao conformidade DELTA como bloqueio de infraestrutura.
- [x] Atualizar runner para detectar linha viva no TTY quando habilitada.
- [x] Parametrizar runner para cenarios `canonical`, `freeform`, `invalid-choice`, `long-tool-heartbeat` e `recoverable-tool-error`.
- [x] Parametrizar runner para cenario `file-write-roundtrip` cobrindo create/move/delete.
- [x] Adicionar dry-run/teste de contrato para prompts dos cenarios alternativos.
- [x] Rodar live test com caso canonico atual.
- [x] Rodar live test com resposta freeform.
- [x] Rodar live test com choice invalida.
- [x] Rodar live test com tool longa e heartbeat.
- [x] Rodar live test com erro de tool recuperavel.
- [x] Adicionar criterio hard para ausencia de prompt de permissao em cenarios permissionados.
- [x] Rodar live SDK/Copilot com `COPILOT_BYOK_ENABLED=false` para isolar permissao de instabilidade BYOK.
- [x] Rodar live SDK/Copilot com `file-write-roundtrip` para provar create/move/delete sem prompt.
- [x] Corrigir presenter para `move_file` deixar de aparecer como `[INSPECT]` generico.
- [x] Adicionar criterio hard no runner live para regressao `[INSPECT] move_file`.
- [x] Rodar live SDK/Copilot provando `move_file` como `[MOVE]`, com `source`/`destination` visiveis.

### Faixa K - Validadores

- [x] Strict de `src/copilot` passou antes da fase terminal.
- [x] Rodar testes unitarios focados de terminal apos patches.
- [x] Rodar strict apos patches do terminal.
- [x] Rodar lint escopado quando o conjunto estabilizar.
- [x] Rodar teste live real apos patches.
- [x] Registrar artifacts novos no documento ou em relatorio de rodada.
- [x] Rodar teste unitario estrutural para policy de `skipPermission` do bootstrap.
- [x] Rodar suite de bootstrap apos corrigir TDZ de `sessionTools`.

### Faixa L - Documentacao continua

- [x] Atualizar este MD apos cada bloco grande de implementacao.
- [x] Registrar decisoes arquiteturais que afetem timeline.
- [x] Registrar comandos canonicos para reproduzir live.
- [x] Registrar gaps residuais antes de commit.
- [x] Registrar validadores executados.
- [x] Registrar evidencia live de maxima permissao sem janela SDK.
- [x] Registrar auditoria visual das screenshots do operador.
- [x] Registrar evidencia PTY da rodada `terminal-ux-revolution-baseline-sdk-20260602-0557`.
- [x] Registrar evidencia PTY da rodada `terminal-ux-revolution-pass3-sdk-20260602-0621`.
- [x] Registrar evidencia PTY da rodada `terminal-ux-revolution-pass4-sdk-20260602-0630`.

### Faixa M - Glossario visual e nomes humanos

- [x] Criar camada canonica de apresentacao visual de tools sem alterar nomes tecnicos em SSE/export.
- [x] Mapear `report_intent`/`report_intent_local` para `Intent capturado`.
- [x] Mapear `request_user_input`/`ask_user` para `Pergunta ao operador`.
- [x] Mapear introspeccoes comuns para nomes humanos curtos.
- [x] Preservar alias tecnico apenas em debug/detalhe.
- [x] Criar testes unitarios para nomes humanos e alias oculto por default.

### Faixa N - Sanitizacao de IDs na UX default

- [x] Remover `requestId`/`toolCallId` como fallback de target default no presenter.
- [ ] Mostrar IDs completos apenas em `/events`, export bruto e diagnosticos explicitos.
- [ ] Mostrar IDs compactos apenas quando o comando for diagnostico.
- [x] Garantir que `report_intent` use intent como target quando disponivel.
- [x] Garantir que tools sem target humano nao inventem target com ID tecnico.
- [x] Adicionar teste contra `chatcmpl-tool-*`/`toolu_*` em linhas default.

### Faixa O - ASK como superficie propria

- [x] Adicionar operation visual `ask` ao presenter/runtime.
- [x] Renderizar `request_user_input` como `[ASK]`, nao `[RUN]`.
- [x] Renderizar `ask_user` e `request_user_input` sob a mesma semantica visual.
- [x] Suprimir heartbeat duravel de pergunta humana pendente.
- [ ] Manter pergunta humana em card duravel unico.
- [ ] Garantir que resposta humana nao fique colada na linha viva.
- [ ] Tratar timeout durante espera humana como `aguardando operador`, nao erro de modelo.
- [x] Adicionar teste unitario de `request_user_input` sem `[TOOL] [RUN]`.
- [ ] Adicionar live scenario especifico para `request_user_input` local, alem de `ask_user` SDK.

### Faixa P - Linha viva unificada

- [x] Escolher uma unica fonte de linha viva por estado.
- [x] Reduzir `LIVE_DETAIL_CATASTROPHIC_CHARS` para budget visual real.
- [x] Compactar `waiting-human` em ate duas linhas fisicas no default.
- [x] Remover `turnId=` da linha viva default.
- [x] Evitar narracao duravel repetitiva `LLM-B ainda trabalhando` em modo normal.
- [x] Manter watchdog visivel sem competir com `⟲ LLM-B`.
- [x] Criar testes de formatacao com largura estreita.
- [x] Criar criterio live para ausencia de status duplicado.

### Faixa Q - Boot, menu e auto-brief

- [x] Substituir menu inicial gigante por resumo compacto.
- [x] Manter `/help` como superficie de comandos completos.
- [x] Compactar auto-brief default em grupos humanos.
- [x] Mover detalhes `parser/cache/index/scopes` para `/activity`, `/health` ou modo debug.
- [ ] Ajustar box standalone para largura responsiva.
- [x] Rebaixar alerta MCP indisponivel quando tools locais estao ativas.
- [x] Adicionar teste snapshot/regex do boot compacto.
- [x] Adicionar live criterion de primeiro viewport sem overflow obvio.

### Faixa R - Comandos de diagnostico com dois niveis

- [ ] Revisar `/activity` para modo default sem IDs longos.
- [x] Revisar `/tools diag` para IDs compactos e drill-down claro.
- [ ] Revisar `/events` para continuar bruto, mas com header explicito de debug.
- [x] Revisar `/health` para reduzir ruido visual default.
- [ ] Adicionar flags ou subcomandos `detail`, `raw` ou `debug` onde fizer sentido.
- [x] Testar que dados tecnicos continuam acessiveis.

### Faixa S - Lives esteticos com LLM-B

- [x] Atualizar runner para detectar IDs crus em narrativa default.
- [x] Atualizar runner para detectar status vivo duplicado.
- [x] Atualizar runner para detectar `request_user_input` como `[RUN]`.
- [x] Atualizar runner para detectar menu inicial excessivamente longo.
- [x] Rodar live SDK/Copilot apos Faixas M-P.
- [ ] Rodar live BYOK quando a superficie estiver estabilizada.
- [ ] Rodar live com `request_user_input` local real.
- [x] Registrar artefatos e decisao no roadmap.

## 06.01 Gaps residuais apos PASS live

- [x] Definir metadata `syncBlockedReason` para timeline divergente.
- [x] Revisar `/context` e `/history` com a semantica de `timeline=mixed/diverged`.
- [x] Garantir redaction de args sensiveis em export quando tool metadata entrar no Markdown.
- [x] Revisar `tool-lifecycle-runtime` para status vivo sem excesso de writes.
- [x] Melhorar resumo de `/tools diag`.
- [x] Exibir `toolCallId` e `requestId` de forma compacta em tools operacionais, nao apenas no envelope do export.
- [x] Separar start/progress/done visualmente em tool diagnostics.
- [x] Garantir que texto simulando tool nunca satisfaça criterio de tool real.
- [x] Adicionar correlacao mais clara entre stdout e SSE para pos-ask.
- [x] Atualizar live runner para comparar export contra SSE em termos de eventos correlacionados, nao apenas texto.
- [x] Revisar `turn-materialization-state` para cenarios pos-ask alternativos.
- [x] Adicionar teste para turnos separados por ask_user.
- [x] Revisar `/activity` para mostrar transcript humano recente com envelope compacto.
- [x] Revisar `/events` para linkar evento bruto ao transcript/export.
- [x] Revisar `/usage now` para contexto pos-ask e BYOK sem Premium Request.
- [x] Revisar `/health` para indicar inline status mode.
- [x] Parametrizar runner para resposta freeform, choice invalida, tool longa e erro recuperavel sem alterar o baseline canonico.
- [x] Cobrir dry-run dos cenarios alternativos por teste unitario de contrato.
- [x] Rodar live test com resposta freeform.
- [x] Rodar live test com choice invalida.
- [x] Rodar live test com tool longa e heartbeat.
- [x] Rodar live test com erro de tool recuperavel.
- [x] Atualizar runner para detectar linha viva no TTY quando habilitada.

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

### 07.05 Bloco UX visual imediato

- Implementar glossario visual no `tool-activity-presenter`.
- Remover fallback de target por IDs tecnicos na UX default.
- Promover `request_user_input` para operation visual `ask`.
- Ajustar renderer de lifecycle para badge `[ASK]`.
- Suprimir heartbeat duravel de `ask_user`/`request_user_input`.
- Reduzir detalhes da linha viva e limpar status concorrentes mais ruidosos.
- Criar testes unitarios focados antes de lives longos.
- Atualizar runner live com criterios esteticos depois dos patches iniciais.

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
