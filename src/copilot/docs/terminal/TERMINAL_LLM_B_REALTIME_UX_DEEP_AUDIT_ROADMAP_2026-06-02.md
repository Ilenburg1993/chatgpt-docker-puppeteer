# Terminal LLM-B Realtime UX Deep Audit Roadmap - 2026-06-02

## 00. Status deste documento

- Documento criado em 2026-06-02.
- Escopo primario: `src/copilot/terminal`.
- Escopo associado: `src/copilot/mcp`, `src/copilot/model-gateway`, scripts de teste live e estado
  local do terminal.
- Objetivo: orientar a consolidacao do terminal LLM-B como superficie realtime confiavel.
- Estado atual: trilha funcional passou, mas a superficie visual ainda esta ruim em PTY real e nas
  screenshots do operador.
- Prioridade imediata: fazer uma revolucao de UX sem quebrar transcript/export/SSE ja estabilizados.
- Prioridade secundaria: eliminar status duplicado, IDs crus, labels tecnicos e pergunta humana
  tratada como tool comum.
- Prioridade terciaria: compactar banner, menu, auto-brief, health/activity/tools e artefatos de
  diagnostico com layout responsivo.

## 01. Principios

- O terminal deve ser uma superficie de operacao, nao apenas um log.
- A linha de input deve permanecer estavel enquanto LLM-B, SDK e tools emitem eventos.
- Status vivo e input humano devem ser regioes distintas.
- Eventos transitorios podem aparecer na linha viva, mas fatos relevantes precisam entrar em
  transcript/export.
- O transcript exportado deve ser suficiente para auditar uma conversa sem depender do stdout bruto.
- `ask_user` e resposta humana sao eventos de autoria humana/operacional, nao mensagens da LLM-B.
- A resposta humana a `ask_user` deve aparecer uma unica vez com autoria humana.
- O eco da resposta humana por `assistant.message` deve continuar suprimido.
- A mensagem publica da LLM-B apos `ask_user` deve entrar no transcript/export.
- O SSE archive deve continuar sendo a fonte bruta publica para eventos.
- A timeline frontend deve ser a fonte canonica para comandos como `/export`, `/history`, `/context`
  e diagnosticos.
- Nao criar caminhos paralelos de historico quando o feed de transcript existente resolve o
  problema.
- Nao reimplementar comportamento vanilla do SDK; observar, traduzir e preservar.
- Dedupe deve operar por assinatura sem apagar autoria distinta.
- Persistencia no hub deve ser lazy e segura, sem bloquear UX.
- Quando hub e feed vivo divergem, o usuario precisa ver a divergencia e o export nao deve perder
  eventos recentes.
- Teste live deve validar comportamento de usuario real, nao apenas ausencia de crash.
- A UX padrao deve esconder IDs internos longos; eles continuam disponiveis em `/events`,
  `/tools diag`, `/activity` detalhado e export.
- Pergunta humana nao e tool comum na narrativa visual; e um estado de bloqueio humano com card
  proprio, prompt proprio e answer path proprio.
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

- A diretiva de sessao SDK nova agora e agendada pelo runner antes de cenarios full-turn, evitando
  retomada de sessao antiga e respostas contaminadas por contexto anterior.
- `--reuse-sdk-session` foi mantido como opt-in para auditorias que queiram reproduzir comportamento
  de resume.
- Nao conformidade textual do modelo com a serie DELTA-CANONICAL deixou de ser bloqueio de
  infraestrutura.
- O prompt canonico foi reforcado para exigir as oito linhas publicas antes de `ask_user`.
- O resumo de `sdkSessionBootSelection` no artefato foi reduzido para nao gravar o estado persistido
  inteiro.
- `tool.lifecycle` agora alimenta um estado diagnostico bounded para `/tools diag`, sem substituir o
  registry operacional session-scoped.
- `/tools diag` agora mostra lifecycle ativo/recente com `toolCallId`, `requestId`, trace, status,
  progresso e duracao em formato compacto.
- `/export` agora aplica redaction explicita em conteudo de turno e campos textuais de
  envelope/streaming antes de gravar Markdown.
- O runner live agora exige `tool.lifecycle` estruturado para `report_intent` e `read_file_content`;
  texto simulado em stdout nao satisfaz mais a prova de tool real.
- O runner live agora compara eventos canonicos de SSE/archive contra envelopes do export por
  `source + trace/turn` para ask_user, resposta humana e final pos-ask.
- `/events` agora mostra hint compacto de `transcript` e
  `export=envelope:<source> trace=<trace> turn=<turn>` para eventos canonicos de transcript.
- `/usage now` agora destaca telemetria de continuacao `ask_user` separada da fala inicial e aponta
  para correlacao por `/events` + `/export`.
- `/health` agora mostra o modo efetivo de inline status (`reserved`, `overlay` ou `off`) e a origem
  da policy.

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

- O runner `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` agora aceita
  `--live-scenario=<canonical|freeform|invalid-choice|long-tool-heartbeat|recoverable-tool-error|file-write-roundtrip>`.
- `canonical` preserva o baseline anterior: pergunta `ASK-CANONICAL`, resposta `SIM`, final
  `POST-ASK-CANONICAL-FINAL`.
- `freeform` gera prompt de `ask_user` sem choices obrigatorias e valida resposta humana livre no
  SSE/export.
- `invalid-choice` gera prompt choice-only, envia primeiro `TALVEZ`, exige feedback local de escolha
  invalida e envia `SIM` em seguida.
- `long-tool-heartbeat` exige `exec_command` controlado com marker `LONG-TOOL-HEARTBEAT-DONE`,
  lifecycle real e progresso antes de `ask_user`.
- `recoverable-tool-error` exige falha controlada de `exec_command`, detectada em `postToolUse` por
  JSON `success:false`/`exitCode=7`, seguida de recuperacao por `read_file_content`, `ask_user` e
  final.
- `file-write-roundtrip` exige `create_file`, `move_file` e `delete_file` reais em scratch
  controlado, com marker `TERMINAL-PERMISSION-ROUNDTRIP`, lifecycle estruturado e ausencia de prompt
  de permissao.
- O tipo persistido em SQLite continua `canonical_full_turn` para o baseline e usa
  `canonical_full_turn_<cenario>` para variantes.
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
  - markers de output de cenario agora precisam aparecer em resultado real de tool ou lifecycle, nao
    apenas no prompt inicial;
  - falha recuperavel esperada nao satisfaz criterio por texto em portugues/ingles; precisa de dado
    estruturado de lifecycle ou `postToolUse`.

## 02.05 Evidencia live dos cenarios alternativos

- Resposta freeform:
  - comando:
    `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=data/copilot-terminal/live-runs/terminal-ux-freeform-20260602-0421`
  - status: PASS.
  - criterios: 41/41 obrigatorios.
  - SSE: 194 eventos, 192 com id/source, 132 com traceId, zero erros.
  - SQLite: `terminal-live:2026-06-02T07-22-08-553Z:canonical_full_turn_freeform`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-freeform-20260602-0421/summary.md`.
- Choice invalida:
  - comando:
    `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=invalid-choice --out-dir=data/copilot-terminal/live-runs/terminal-ux-invalid-choice-20260602-0423`
  - status: PASS.
  - criterios: 42/42 obrigatorios.
  - SSE: 178 eventos, 176 com id/source, 120 com traceId, zero erros.
  - Validou rejeicao local de `TALVEZ`, preservacao da pergunta e resposta valida posterior `SIM`.
  - SQLite: `terminal-live:2026-06-02T07-22-59-121Z:canonical_full_turn_invalid-choice`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-invalid-choice-20260602-0423/summary.md`.
- Tool longa com heartbeat:
  - comando:
    `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=long-tool-heartbeat --out-dir=data/copilot-terminal/live-runs/terminal-ux-long-tool-20260602-0427`
  - status: PASS.
  - criterios: 43/43 obrigatorios.
  - SSE: 311 eventos, 309 com id/source, 243 com traceId, zero erros.
  - Validou `exec_command` real com lifecycle completo e marker `LONG-TOOL-HEARTBEAT-DONE`.
  - SQLite: `terminal-live:2026-06-02T07-26-45-818Z:canonical_full_turn_long-tool-heartbeat`.
  - artefato: `data/copilot-terminal/live-runs/terminal-ux-long-tool-20260602-0427/summary.md`.
- Erro de tool recuperavel:
  - comando final:
    `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=recoverable-tool-error --out-dir=data/copilot-terminal/live-runs/terminal-ux-recoverable-tool-error-20260602-0439`
  - status: PASS.
  - criterios: 43/43 obrigatorios.
  - SSE: 231 eventos, 229 com id/source, 157 com traceId, zero erros.
  - Validou `exec_command` real com `postToolUse` contendo `success:false`, `exitCode=7` e stderr
    `RECOVERABLE-TOOL-ERROR`.
  - Validou recuperacao por `read_file_content`, deltas canonicos, `ask_user`, resposta humana e
    final pos-ask.
  - SQLite: `terminal-live:2026-06-02T07-35-13-548Z:canonical_full_turn_recoverable-tool-error`.
  - artefato:
    `data/copilot-terminal/live-runs/terminal-ux-recoverable-tool-error-20260602-0439/summary.md`.
  - nota de auditoria: um run anterior com arquivo ausente
    (`terminal-ux-recoverable-tool-error-20260602-0428`) tinha criterio falso positivo por texto;
    isso foi corrigido para exigir dado estruturado.

## 02.06 Evidencia live de permissao maxima sem janela SDK

- Objetivo:
  - garantir que o modo default `approve_all` entregue maxima autonomia ao ChatGPT/LLM-B sem
    prompts/janelas redundantes de permissao para tools locais;
  - preservar `selective` como modo explicito para policy granular;
  - manter auditoria por lifecycle, hooks e `/tools diag` mesmo quando o SDK nao pede permissao
    interativa.
- Correcao aplicada:
  - `src/copilot/tools/bootstrap.js` agora aplica `skipPermission=true` nas tools entregues a sessao
    SDK quando `AGENT_PERMISSION_MODE` e `approve_all` ou `audit_only`;
  - a policy e aplicada no array de sessao, depois do registry e antes de `wrapWithStats`;
  - `selective` preserva o contrato original de cada tool;
  - o bootstrap le `AGENT_PERMISSION_MODE` diretamente para evitar ciclo ESM com `#copilot/config`;
  - um primeiro live expôs bug TDZ por sombreamento do import `sessionTools`; a variavel local foi
    renomeada para `sdkSessionTools`.
- Runner:
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` adicionou criterio
    hard `no-sdk-permission-prompt-in-approve-all`;
  - o criterio falha se o transcript/archive contiver `permission.requested`, `Permissao solicitada`
    ou texto equivalente;
  - o criterio e ativado nos cenarios que usam tool permissionada, como `long-tool-heartbeat` e
    `recoverable-tool-error`.
- Tentativa BYOK diagnosticada:
  - comando:
    `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=long-tool-heartbeat --out-dir=data/copilot-terminal/live-runs/terminal-ux-long-tool-no-permission-20260602-0447`
  - status: BLOCKED por `assistant-empty-turn` em `kilo-auto/free`;
  - nao houve `permission.requested`, mas o modelo nao executou tools; portanto o run foi descartado
    como prova de permissao.
- Prova SDK/Copilot:
  - comando:
    `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=long-tool-heartbeat --out-dir=data/copilot-terminal/live-runs/terminal-ux-long-tool-no-permission-sdk-20260602-0450`
  - status: PASS.
  - criterios: 44/44 obrigatorios.
  - SSE: 346 eventos, 342 com id/source, 264 com traceId, zero erros.
  - Validou `exec_command` real com lifecycle `start`, `external_completed` e `postToolUse` success.
  - Validou marker `LONG-TOOL-HEARTBEAT-DONE` dentro do resultado real de tool.
  - Validou `/tools diag`: `exec_command calls=1 blocked=0 errors=0`.
  - Validou `no-sdk-permission-prompt-in-approve-all`: nenhuma ocorrencia de `permission.requested`
    ou janela equivalente.
  - SQLite: `terminal-live:2026-06-02T07-47-31-174Z:canonical_full_turn_long-tool-heartbeat`.
  - artefato:
    `data/copilot-terminal/live-runs/terminal-ux-long-tool-no-permission-sdk-20260602-0450/summary.md`.
- Prova SDK/Copilot de escrita/movimentacao/delecao:
  - comando:
    `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=file-write-roundtrip --out-dir=data/copilot-terminal/live-runs/terminal-ux-file-write-no-permission-sdk-20260602-0454`
  - status: PASS.
  - SSE: 365 eventos, 361 com id/source, 261 com traceId, zero erros.
  - Validou `create_file`, `move_file` e `delete_file` reais com lifecycle `start`,
    `external_completed` e `postToolUse` success.
  - Validou marker `TERMINAL-PERMISSION-ROUNDTRIP` dentro do resultado real de tool.
  - Validou `no-sdk-permission-prompt-in-approve-all`: nenhuma ocorrencia de `permission.requested`,
    `Permissao solicitada` ou texto equivalente.
  - Validou `/tools diag`: `create_file calls=1 blocked=0 errors=0`,
    `move_file calls=1 blocked=0 errors=0`, `delete_file calls=1 blocked=0 errors=0`.
  - Validou scratch limpo apos o roundtrip: nenhum `TERMINAL-PERMISSION-ROUNDTRIP-*` residual em
    `data/copilot-terminal/live-scratch`.
  - SQLite: `terminal-live:2026-06-02T07-54-18-007Z:canonical_full_turn_file-write-roundtrip`.
  - artefato:
    `data/copilot-terminal/live-runs/terminal-ux-file-write-no-permission-sdk-20260602-0454/summary.md`.

## 02.07 Evidencia live de semantica MOVE no terminal

- Problema observado:
  - `move_file` executava corretamente, mas era renderizado como
    `[INSPECT] move_file · executando tool generica`;
  - o I/O bruto ja mostrava `[MOVE]`, criando divergencia entre lifecycle SDK, turn trace e
    atividade de I/O.
- Correcao aplicada:
  - `src/copilot/core/tool-target-introspection.js` agora reconhece `source` e `destination` como
    alvos de arquivo;
  - `src/copilot/terminal/events/tool-activity-presenter.js` reconhece `copy` e `move`, inclusive
    por `evt.operation`;
  - `src/copilot/terminal/events/io-activity-events.js` preserva `copy` e `move` na projecao do turn
    trace;
  - `src/copilot/terminal/state/turn-trace-state.js` aceita `copy` e `move` como operacoes
    canonicas.
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` passou a exigir
    `[TOOL] [MOVE] move_file` e proibir `[TOOL] [INSPECT] move_file` no cenario
    `file-write-roundtrip`.
- Prova SDK/Copilot:
  - comando:
    `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=file-write-roundtrip --out-dir=data/copilot-terminal/live-runs/terminal-ux-file-write-move-presenter-sdk-20260602-0515`
  - status: PASS.
  - SSE: 353 eventos, 349 com id/source, 251 com traceId, zero erros.
  - Validou `move_file` renderizado como `[TOOL] [MOVE] move_file · movendo arquivo`.
  - Validou resumo de turno com `[TOOLS] MOVE move_file` e `[FILES] MOVE ...`.
  - Validou ausencia de `[INSPECT] move_file` no transcript plain.
  - Validou `no-sdk-permission-prompt-in-approve-all` e scratch limpo apos roundtrip.
  - SQLite: `terminal-live:2026-06-02T08-13-58-566Z:canonical_full_turn_file-write-roundtrip`.
  - artefato:
    `data/copilot-terminal/live-runs/terminal-ux-file-write-move-presenter-sdk-20260602-0515/summary.md`.

## 02.08 Saneamento de auto-brief parcial de boot

- Problema observado:
  - o `auto-brief:boot` roda antes de o registry/dialog estar pronto;
  - nessa janela parcial, a mensagem `file-tools canonicas locais nao estao totalmente disponiveis`
    podia aparecer como alerta, embora o `auto-brief:ready` logo em seguida confirmasse `tools=105`,
    `fs=sim` e `exec=sim`;
  - isso induzia operador humano e LLM a suspeitar de ausencia de tools locais quando havia apenas
    boot parcial.
- Correcao aplicada:
  - `src/copilot/terminal/repl/auto-brief.js` filtra apenas o warning transitorio de file-tools
    ausentes durante `phase=boot` ainda nao pronto;
  - o proprio `estado=parcial` continua visivel e explica que um brief pos-bootstrap sera emitido;
  - warnings reais, como arquivos de instrucoes ausentes, continuam aparecendo mesmo no boot
    parcial.
- Validacao:
  - `tests/unit/copilot/terminal/test_auto_brief.spec.js` cobre a supressao do warning transitorio;
  - o mesmo teste confirma que warning de instrucoes ausentes permanece visivel.

## 02.09 Clareza em `session.tools_updated`

- Problema observado:
  - no live SDK/Copilot, o terminal podia imprimir
    `Tools dinamicas SDK atualizadas: 0 SDK · registry local: 105 (/tools)`;
  - a mensagem era tecnicamente correta, mas misturava duas superficies diferentes e podia sugerir
    ausencia de tools, apesar de o registry local estar ativo.
- Correcao aplicada:
  - `src/copilot/terminal/events/sdk-session-events.js` separa `tool(s) SDK dinamicas` de
    `tool(s) locais ativas em /tools`;
  - quando o SDK nao materializa contagem, a mensagem diz explicitamente
    `SDK sinalizou atualizacao sem contagem materializada`;
  - o SSE `session.tools_updated` agora expoe `localToolsActive` junto de `sdkCount` e `localCount`.
- Validacao:
  - `tests/unit/copilot/test_terminal_sdk_session_events.spec.js` cobre contagem SDK materializada,
    contagem ausente e lista SDK materializada vazia.

## 02.10 Diagnostico explicito de prompts SDK por permission mode

- Problema observado:
  - `/status` e `/permission mode` exibiam `approve_all`, `audit_only` ou `selective`, mas nao
    traduziam o efeito operacional para prompts/janelas SDK;
  - depois da policy `skipPermission=true` em `approve_all`/`audit_only`, o operador precisava
    inferir que janelas SDK estavam desativadas por padrao.
- Correcao aplicada:
  - `src/copilot/terminal/state/sdk-interactions.js` exporta
    `terminalPermissionModeSkipsSdkPrompts`;
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
  - ha mistura de `[INTENT]`, `[TOOL]`, `[IO]`, `[TURN]`, `[TOOLS]`, `[FILES]` sem hierarchy
    suficiente;
  - nomes internos como `report_intent`, `hooks_get_pending_tasks` e `get_session_state` competem
    com texto humano;
  - linhas de tool e linhas de resumo nao alinham visualmente;
  - a pergunta humana vira mais uma entrada no log, nao um estado bloqueante.
- Screenshot C, banner/menu:
  - menu inicial excede o primeiro viewport;
  - quase todos os comandos sao despejados de uma vez;
  - linhas longas quebram no meio;
  - o box inicial aparece duplicado em relacao ao banner grande;
  - auto-brief em key/value ocupa muitas linhas com pouco ganho imediato;
  - termos como `auto-brief:boot`, `sdkWorkspace`, `parser=0`, `cache=hit=0%` sao bons para debug,
    ruins como tela inicial padrao.
- Screenshot D, modo standalone:
  - o box `Terminal Permanente LLM-B` tem colunas desalinhadas;
  - a mensagem de MCP indisponivel e correta, mas parece alerta central mesmo quando tools locais
    estao ativas;
  - `você[kilo-auto/free/high]` compete com blocos de status;
  - apos o primeiro turno, detalhes tecnicos do SDK aparecem cedo demais.
- Conclusao visual:
  - o problema nao e apenas cor ou icone;
  - o problema e uma arquitetura de renderizacao sem camadas visuais rigidas;
  - a UX precisa separar status vivo, narracao duravel, tool cards, prompt, pergunta humana e
    diagnostico bruto;
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
  - a linha viva waiting-human quebra em quatro linhas e a resposta `SIM` fica na mesma regiao
    visual;
  - apos a resposta, `turnId=1` aparece em status vivo como informacao tecnica de baixo valor;
  - `/activity` ainda mostra IDs longos em modo comum.
- Diferenca entre funcionalidade e UX:
  - o teste passa porque a semantica esta correta;
  - a experiencia humana continua ruim porque o output bruto revela muitos detalhes de
    infraestrutura;
  - a proxima fase deve manter os criterios funcionais e adicionar criterios esteticos/ergonomicos.

## 02.13 Mapa causal da UX ruim

- Causa 1: `dialog/output.js` tenta reservar linhas acima do prompt, mas qualquer bloco permanente
  limpa e re-reserva a area.
- Causa 2: `dialog/engine.js` imprime narracao duravel `LLM-B ainda trabalhando` alem do status vivo
  transitorio.
- Causa 3: `repl/live-status-line.js` tambem imprime `⟲ LLM-B` em intervalo proprio.
- Causa 4: `formatLiveWaitingStatus()` e a linha viva permanente usam estilos diferentes para o
  mesmo estado.
- Causa 5: `agent-runtime-events.js` imprime heartbeat de tool com `toolCallId` bruto.
- Causa 6: `tool-activity-presenter.js` usa `requestId` e `toolCallId` como fallback de target.
- Causa 7: `tool-activity-presenter.js` mostra alias tecnico como texto normal.
- Causa 8: `request_user_input` recebe label semantico de espera humana, mas continua com operation
  `run`.
- Causa 9: `tool-lifecycle-runtime.js` renderiza operation `run` como `[RUN]`, entao pergunta humana
  parece tool executavel.
- Causa 10: `intent-renderer.js` ainda mostra `call=` no modo visual comum.
- Causa 11: `commands/menu.js` e banner inicial privilegiam completude sobre escaneabilidade.
- Causa 12: `auto-brief.js` renderiza dados tecnicos em primeira tela sem agrupamento visual.
- Causa 13: `commands/activity.js`, `/tools diag` e `/events` nao diferenciam suficientemente modo
  operador e modo debug.
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
  - `/activity`, `/tools diag`, `/events`, `/health` podem mostrar IDs, mas com `compactId` e label
    claro;
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
  - nenhum `chatcmpl-tool-*`, `toolu_*`, UUID ou requestId completo deve aparecer na narrativa
    default de tool.
- Requisito UX-02:
  - `report_intent` nao deve aparecer como `report_intent_local (alias: report_intent)` na linha
    visual comum.
- Requisito UX-03:
  - `request_user_input` nao deve aparecer como `[TOOL] [RUN]`.
- Requisito UX-04:
  - `request_user_input` nao deve receber heartbeat duravel `ainda executando`.
- Requisito UX-05:
  - quando ha pergunta humana pendente, o timeout de turno deve mostrar `aguardando operador`, nao
    `mensagem nao produziu resposta`.
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
  - `chatcmpl-tool-*` e `toolu_*` deixaram de aparecer nas linhas default de `[TOOL]`, `[DONE]`,
    `[TOOLS]`, `[ASK]` e `[INTENT]`;
  - a narracao duravel `LLM-B ainda trabalhando` deixou de competir com a linha viva;
  - o status de watchdog nao renderizou uma segunda linha viva quando a linha permanente estava
    habilitada.
- Gaps visuais residuais confirmados:
  - `/health` ainda mostra nomes tecnicos em `TOOL STATS`, como `report_intent_local` e
    `read_file_content`;
  - o banner REPL compacto e o box standalone ainda aparecem como duas superficies de boot;
  - a linha viva de ASK ainda pode ocupar tres linhas fisicas em largura estreita;
  - a resposta `SIM` ainda pode aparecer muito perto da area reservada da linha viva em PTY;
  - `/events --raw` e SSE bruto continuam corretamente tecnicos, mas comandos de diagnostico
    precisam de headers mais claros.

## 02.18 Segunda rodada UX: diagnosticos humanos e resposta menos tecnica

- Escopo implementado apos o commit `feat(terminal): improve llm-b realtime ux`:
  - presenter passou a exportar helpers canonicos para nome humano, ID diagnostico compacto e
    deteccao de ID interno;
  - `/health` passou a renderizar `TOOL STATS` com nomes humanos, sem
    `read_file_content`/`report_intent_local` no modo default;
  - `/tools` default passou a renderizar nomes humanos;
  - `/tools diag` manteve nomes tecnicos sob label explicito `tool técnico`;
  - lifecycle recente de `/tools diag` passou a usar nome humano como titulo e nome tecnico no
    detalhe;
  - confirmacao de resposta humana deixou de imprimir `(default)` no fluxo normal;
  - `/answer --runtime alt ...` continua mostrando `runtime=alt`, pois ali o detalhe e acao
    explicita do operador.
- Testes focados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`
  - Resultado: 4 arquivos, 58 testes, PASS.
- Gaps ainda em aberto:
  - live PTY confirmou a melhoria no terminal real em
    `terminal-ux-revolution-pass4-sdk-20260602-0630`;
  - `/events --raw` continua bruto por contrato, mas precisa de header mais didatico;
  - `/activity` ainda pode mostrar IDs compactos sem explicar suficientemente que sao diagnosticos;
  - o card duravel da pergunta humana ainda deve ser refinado para escolhas alinhadas e resposta
    visualmente separada.

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
  - `/tools diag` mostrou nomes humanos como titulo e nomes tecnicos apenas em linhas
    `tool técnico: ...`;
  - `/health` mostrou `Ler arquivo` e `Intent capturado` no top-5, sem
    `read_file_content`/`report_intent_local` no modo default.
- Observacao:
  - o modelo respondeu em multiplos turnos internos e adicionou texto publico extra antes dos
    marcadores, mas o contrato testado continuou consistente: tool lifecycle real, deltas, ask_user,
    resposta humana, pos-ask, export e SSE.
  - a linha viva em turnos longos ainda ocupa tres linhas fisicas em PTY estreito; isso permanece
    como item de polimento da Faixa P/O.

## 02.20 Terceira rodada UX: linha viva compacta para `sem delta`

- Problema observado em `terminal-ux-revolution-pass4-sdk-20260602-0630`:
  - em turnos longos, a linha viva imprimia
    `thinking/LLM-B trabalhando · auto · high · 20s sem delta visível · ...`;
  - esse texto competia com o prompt e quebrava em tres linhas fisicas no PTY do VS Code;
  - a informacao util era apenas: estado thinking, tempo sem delta, modelo/esforco e loop.
- Ajuste arquitetural:
  - `formatTerminalLiveStatusLine()` ganhou compactacao semantica para detalhes `sem delta`;
  - o status passa a renderizar `thinking · 20s sem delta · auto/high · loop`;
  - `processing:` redundante foi omitido do tail default quando o estado operacional ja e implicito;
  - label e detalhe comuns passaram a ter budgets menores e consistentes.
- Contratos:
  - teste unitario novo em `tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - criterio live novo `ux-compact-no-delta-live-status`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` passou.
- Status:
  - [x] Unit test focado passou.
  - [x] Runner live recebeu criterio de regressao.
  - [x] Live PTY posterior provou o criterio em terminal real.

## 02.21 Terceira rodada UX: `/events` com modo resumido humano

- Problema:
  - `/events` em modo default parecia quase tao bruto quanto `--raw`;
  - IDs de hub/call/request e nomes tecnicos de tool aumentavam a carga visual;
  - o operador nao recebia uma pista clara de quando usar `--raw`, `--json` ou `sources`.
- Ajuste:
  - header default virou `Eventos SSE — visão resumida`;
  - linha auxiliar explica `/events --raw`, `/events --json` e `/events sources`;
  - `hubSessionId`, `toolCallId` e `requestId` sao compactados no modo texto;
  - payload com `toolName` passa pelo glossario visual (`read_file_content` -> `Ler arquivo`);
  - `--raw` e `--json` permanecem puros para automacao e auditoria.
- Testes:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js`
  - Resultado: 2 arquivos, 15 testes, PASS.
- Status:
  - [x] `/events` default resumido/humano.
  - [x] `--raw` preservado como JSONL puro.
  - [x] `--json` preservado para automacao.
  - [x] Live PTY posterior verificou legibilidade no terminal real.

## 02.22 Evidencia live PTY da terceira rodada UX

- Comando executado:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=canonical --out-dir=data/copilot-terminal/live-runs/terminal-ux-revolution-pass5-sdk-20260602-0637`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass5-sdk-20260602-0637/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass5-sdk-20260602-0637/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass5-sdk-20260602-0637/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass5-sdk-20260602-0637/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass5-sdk-20260602-0637/conversation-export.md`
- Resultado:
  - status PASS;
  - 260 eventos SSE;
  - 0 erros;
  - `ux-compact-no-delta-live-status` passou;
  - `/events` default exibiu `Eventos SSE — visão resumida`;
  - `/events` default mostrou `hub`, `call` e `req` compactos;
  - `/events --raw` preservou JSONL bruto para automacao;
  - todos os criterios funcionais e esteticos adicionados desde M-P/S continuaram verdes.
- Residual observado:
  - alguns estados `turn/...` ainda podem ocupar tres linhas em casos de detalhe longo;
  - ASK ainda ocupa tres linhas no prompt estreito quando pergunta + opcoes + modelo entram juntos;
  - isso deve ir para a proxima rodada de layout de status/prompt, nao para a camada de eventos.

## 02.23 Quarta rodada UX: ASK compacto e boot sem segundo box

- Problema:
  - o status vivo de ASK ainda trazia pergunta, opcoes, modelo, esforco e loop na mesma linha
    logica;
  - no PTY estreito, isso quebrava em tres linhas;
  - o boot exibia o banner REPL compacto e depois outro box standalone, criando duplicacao visual.
- Ajustes:
  - status vivo de ASK passou a renderizar `ASK · pergunta · opções=... · loop`;
  - modelo/esforco foi removido desse estado porque a prioridade visual e a resposta humana;
  - pergunta pendente ganhou budget menor;
  - banner standalone virou bloco compacto de tres linhas, sem borda/box;
  - mensagem de MCP remoto ausente foi rebaixada para
    `Registry local ativo. Diagnóstico: /tools · /health.`
- Testes:
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js`
  - Resultado: 2 arquivos, 10 testes, PASS.
- Status:
  - [x] ASK sem modelo/esforco no status vivo.
  - [x] Box standalone antigo removido.
  - [x] Live PTY posterior verificou o primeiro viewport real.

## 02.24 Evidencia live PTY da quarta rodada UX

- Primeira tentativa:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass6-sdk-20260602-0643/summary.md`
  - status BLOCKED;
  - o bloqueio ocorreu porque o modelo executou tools e produziu deltas, mas nao chamou `ask_user`
    antes do timeout;
  - esse resultado nao foi tratado como regressao da camada visual, pois a superficie de boot
    compacta ja apareceu corretamente e o contrato funcional do cenario dependia de uma decisao do
    modelo.
- Segunda tentativa:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass7-sdk-20260602-0650/summary.md`
  - status PASS;
  - 318 eventos SSE;
  - 0 erros;
  - 24 marcadores `DELTA-CANONICAL`;
  - export Markdown com transcript, envelope, ask_user, resposta humana e final pos-ask.
- Criterios UX novos que passaram no PTY real:
  - `ux-no-standalone-boot-box`;
  - `ux-compact-turn-live-status`;
  - `ux-compact-ask-live-status`.
- Criterios UX preservados:
  - `ux-compact-boot-banner`;
  - `ux-human-tool-names`;
  - `ux-no-raw-tool-ids-in-default-tool-lines`;
  - `ux-no-durable-waiting-spam`;
  - `ux-single-live-status-source`;
  - `ux-compact-no-delta-live-status`;
  - `ux-health-human-tool-stats`;
  - `ux-human-answer-confirmation`.
- Decisao:
  - o primeiro viewport real deixou de exibir o catalogo gigante e deixou de exibir o segundo box
    `Terminal Permanente LLM-B`;
  - a linha viva de turno deixou de repetir detalhes longos de intencao;
  - a linha viva de pergunta humana deixou de mostrar modelo/esforco e passou a priorizar pergunta,
    opcoes e loop;
  - a UX default do terminal agora possui uma camada operacional humana muito mais limpa, com IDs
    crus reservados a diagnostico.
- Residual:
  - `/events` default ainda podia quebrar conteudo de mensagem em multiplas linhas quando o evento
    contem newlines internos;
  - `/activity` ainda merecia revisao para separar melhor transcript humano e envelope diagnostico;
  - o prompt `⏳ [auto/high]` ainda pode parecer um artefato tecnico em telas estreitas e deve ser
    avaliado na proxima rodada.

## 02.25 Quinta rodada UX: diagnostico default sem dump tecnico

- Problemas observados apos o pass7:
  - `/events` default podia imprimir conteudo de `assistant.message` com quebras internas,
    destruindo o contrato visual de uma linha por evento;
  - `/activity` ainda mostrava `traceId`, `requestId` e engine de I/O no modo default;
  - isso confundia a superficie humana com a superficie de auditoria.
- Ajustes:
  - resumo textual de `/events` agora normaliza whitespace antes de compactar;
  - `--raw` e `--json` continuam preservados para automacao e auditoria bruta;
  - `/activity` ganhou parsing de `detail`/`--detail`/`debug`;
  - modo default de `/activity` omite trace, requestId e engine de I/O;
  - modo detail preserva trace compacto, requestId compacto e engine;
  - caminhos e perguntas exibidos em `/activity` passam por compactacao humana de whitespace.
- Testes:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`
  - Resultado: 2 arquivos, 12 testes, PASS.
- Decisao:
  - comandos operacionais default devem responder "o que aconteceu" antes de "qual foi o
    identificador interno";
  - identificadores continuam disponiveis, mas sob pedido explicito de detalhe;
  - essa regra passa a orientar `/activity`, `/events`, `/tools`, `/health`, `/usage` e proximos
    comandos de diagnostico.

## 02.26 Sexta rodada UX: prompt de espera humano

- Problema:
  - o prompt de espera aparecia como `⏳ [auto/high]` ou `⏳[TURN:...] [modelo/esforco]`;
  - esse formato parecia uma tag interna, nao uma superficie humana;
  - em telas estreitas, ele ficava visualmente colado ao input e reforcava a sensacao de poluicao.
- Ajuste:
  - `buildWaitingPrompt()` agora usa `LLM-B pensando` como texto primario;
  - modo normal preserva fase/label compactos quando a policy permite;
  - modo minimal/compact mostra apenas `LLM-B pensando [modelo/esforco]`;
  - tags de fila/ASK/shadow continuam disponiveis quando relevantes;
  - runner live ganhou criterio `ux-no-raw-hourglass-waiting-prompt`.
- Testes:
  - `npx vitest run tests/unit/copilot/terminal/test_build_user_prompt.spec.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`
  - Resultado: 2 arquivos, 20 testes, PASS.
- Decisao:
  - o prompt pode ser tecnico o bastante para orientar modelo/esforco, mas sua primeira leitura deve
    ser humana;
  - icones soltos e colchetes sem contexto nao devem ser a superficie default de espera.

## 02.27 Evidencia live PTY do prompt humano e diagnosticos limpos

- Comando executado:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=canonical --out-dir=data/copilot-terminal/live-runs/terminal-ux-revolution-pass8-sdk-20260602-0701`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass8-sdk-20260602-0701/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass8-sdk-20260602-0701/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass8-sdk-20260602-0701/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass8-sdk-20260602-0701/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-revolution-pass8-sdk-20260602-0701/conversation-export.md`
- Resultado:
  - status PASS;
  - 270 eventos SSE;
  - 0 erros;
  - ask_user, resposta humana, final pos-ask, export e SSE continuaram verdes;
  - criterio `ux-no-raw-hourglass-waiting-prompt` passou;
  - criterios esteticos anteriores continuaram verdes.
- Observacoes visuais confirmadas:
  - prompt de espera apareceu como `LLM-B pensando [auto/high]`;
  - `/activity` default mostrou `IDs/trace completos ficam em /activity detail`;
  - `/activity` default ocultou trace e engine de I/O na secao de I/O recente;
  - `/events` default manteve uma linha por evento e IDs compactos.
- Residuos identificados pelo live:
  - `/usage now` ainda mostrava runtime/sdk/hub completos no default;
  - `/health` ainda mostrava runtime/sdk/hub completos no default;
  - linhas duraveis `[IO]` e timeline historica ainda podem expor `io-engine.*` sem modo detail;
  - `/tools diag` esta correto como diagnostico, mas nomes de I/O agregados ainda podem ser
    humanizados.

## 02.28 Setima rodada UX: IDs compactos em usage/health default

- Problema:
  - `/usage now` e `/health` eram comandos usados em live e exibiam UUIDs completos no modo default;
  - isso contrariava a regra ja aplicada a `/activity`, `/tools` e `/events`: default humano,
    detalhe sob pedido.
- Ajustes:
  - `/usage now` compacta runtime/sdk/hub por padrao;
  - `/usage now detail` preserva IDs completos;
  - `/health` compacta runtime/sdk/hub por padrao;
  - `/health detail` preserva IDs completos;
  - o texto de ajuda de `/usage` agora informa `[detail]`.
- Testes:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js`
  - Resultado: 2 arquivos, 12 testes, PASS.
- Decisao:
  - IDs de sessao pertencem ao nivel diagnostico;
  - comandos default podem mostrar IDs compactos quando ajudam a correlacionar, mas nao devem
    despejar UUIDs inteiros.

## 02.29 Oitava rodada UX: I/O humano por padrao

- Problema:
  - linhas duraveis `[IO]`, `[DONE]`, `/tools` e timeline podiam mostrar
    `io-engine.fs.readFile.text`;
  - esse valor e evidencia tecnica do motor de I/O, nao informacao primaria para o operador;
  - quando ele aparece junto de arquivo, bytes e duracao, piora alinhamento e leitura.
- Ajustes:
  - stdout default de I/O remove engine e conserva alvo, status, bytes e duracao;
  - `activity.detail` de I/O tambem remove engine;
  - `[DONE]` com I/O correlacionado remove engine do label de duracao;
  - entry/SSE continuam preservando `ioEngine`;
  - presenter de tools humaniza agregados `io.read.*`, `io.write.*`, `io.move.*`, `io.delete.*`,
    `io.scan/search/stat/fetch.*`.
- Testes:
  - `npx vitest run tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`
  - Resultado: 3 arquivos, 12 testes, PASS.
- Decisao:
  - engine de I/O e atributo diagnostico;
  - default deve exibir acao humana, alvo, bytes e duracao;
  - raw/SSE/lifecycle continuam contendo a evidencia tecnica para auditoria.

## 02.30 Evidencia live PTY freeform apos polimento de I/O

- Comando executado:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --transport=pty --live-scenario=freeform --out-dir=data/copilot-terminal/live-runs/terminal-ux-freeform-post-polish-20260602-0712`
- Artefatos:
  - `data/copilot-terminal/live-runs/terminal-ux-freeform-post-polish-20260602-0712/summary.md`
  - `data/copilot-terminal/live-runs/terminal-ux-freeform-post-polish-20260602-0712/terminal.raw.log`
  - `data/copilot-terminal/live-runs/terminal-ux-freeform-post-polish-20260602-0712/terminal.plain.log`
  - `data/copilot-terminal/live-runs/terminal-ux-freeform-post-polish-20260602-0712/terminal.sse.jsonl`
  - `data/copilot-terminal/live-runs/terminal-ux-freeform-post-polish-20260602-0712/conversation-export.md`
- Resultado:
  - status PASS;
  - 296 eventos SSE;
  - 0 erros;
  - ask_user freeform, resposta humana livre, final pos-ask, export e SSE continuaram verdes;
  - criterios esteticos M-S continuaram verdes.
- Evidencia visual nova:
  - `/usage now` mostrou runtime/sdk/hub compactos com hint para `detail`;
  - `[IO] [READ] package.json` mostrou status, bytes e duracao sem `io-engine.*`;
  - `[DONE] Ler arquivo` mostrou `io 1 op · 2ms · 83.2 KB` sem engine;
  - `/activity` mostrou I/O recente sem engine;
  - `/tools diag` mostrou `Leitura local` como titulo e manteve
    `tool técnico: io.read.io-engine.fs.readFile.text` no detalhe;
  - `/health` mostrou `Leitura local` em `TOOL STATS`.
- Decisao:
  - a politica "humano primeiro, diagnostico sob demanda" esta validada tambem no cenario de
    resposta livre;
  - `request_user_input`/`ask_user` freeform nao precisa de janela externa nem de surface duplicada
    para funcionar no terminal.

## 02.31 Evidencia live PTY de request_user_input local sintetico

- Comando executado:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-ux-no-ids-20260602-0748`
- Artefatos:
  - `artifacts/terminal-live/structured-input-ux-no-ids-20260602-0748/summary.md`
  - `artifacts/terminal-live/structured-input-ux-no-ids-20260602-0748/summary.json`
  - `artifacts/terminal-live/structured-input-ux-no-ids-20260602-0748/structured-input-cycle.raw.log`
  - `artifacts/terminal-live/structured-input-ux-no-ids-20260602-0748/structured-input-cycle.plain.log`
- Revalidacao de rotulos humanos:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-ux-human-labels-20260602-0753`
  - artefatos:
    - `artifacts/terminal-live/structured-input-ux-human-labels-20260602-0753/summary.md`
    - `artifacts/terminal-live/structured-input-ux-human-labels-20260602-0753/summary.json`
    - `artifacts/terminal-live/structured-input-ux-human-labels-20260602-0753/structured-input-cycle.raw.log`
    - `artifacts/terminal-live/structured-input-ux-human-labels-20260602-0753/structured-input-cycle.plain.log`
  - status PASS;
  - duracao 8098ms;
  - `/sdk waits` default mostrou `pergunta=0 · input=1` antes da resposta;
  - `/sdk waits` default mostrou `pergunta=0 · input=0` depois da resposta;
  - `request_user_input=...` e request IDs permanecem disponiveis apenas em `/sdk waits detail`.
- Resultado:
  - status PASS;
  - duracao 8536ms;
  - `Input humano estruturado` criado por `/sdk simulate request-user-input`, com origem tecnica
    `request_user_input`;
  - prompt humano mostrou `[INPUT]`;
  - linha viva permanente mostrou `LLM-B INPUT` com pergunta e escolhas, em vez de tool crua;
  - `/sdk waits` mostrou pendencia estruturada antes da resposta;
  - modo default ocultou `request-user-input-*` e deixou `/sdk waits detail` como drill-down;
  - resposta comum `SIM` foi roteada para a pendencia estruturada;
  - `/sdk waits` mostrou pendencia estruturada zerada depois da resposta;
  - nao houve `request_user_input ainda executando` nem `LLM-B ainda trabalhando`;
  - encerramento limpo por `/quit`.
- Bugs descobertos e corrigidos durante a live:
  - `shouldRenderTerminalLiveStatusLine()` formatava `INPUT`, mas nao renderizava quando o modelo
    estava ocioso; agora pendencia estruturada tambem ativa a linha viva.
  - o listener imediato do REPL consumia comandos slash como resposta invalida quando havia
    `request_user_input` pendente; agora slash commands continuam no dispatcher e texto livre
    continua indo para a resposta humana.
  - o runner live nao dava tempo para a linha viva renderizar e aguardava prompt final inexistente
    em telas diagnosticas; agora `--structured-input-cycle` suporta pausa antes de comando e
    fallback de avancar apos tela diagnostica.
- Decisao:
  - `request_user_input` local/sintetico passa pelo registro SDK canonico via gateway, nao por lista
    paralela;
  - a UX padrao trata `request_user_input` como bloqueio humano estruturado, nao como tool comum;
  - comandos diagnosticos continuam acessiveis durante a espera humana;
  - a resposta humana simples continua sendo o caminho ergonomico principal.

## 02.32 Polimento de nomenclatura humana em help, intent, status, diagnose e usage

- Problema observado apos as primeiras lives:
  - a UX ja ocultava IDs em tool lifecycle e waits, mas ainda mantinha termos de implementacao em
    comandos comuns;
  - `/help` mencionava `report_intent/assistant.intent`;
  - `/menu` descrevia intents como `assistant.intent/report_intent`;
  - `/intent` mostrava `tool=...`, `call=...` e ID derivado como linha principal;
  - `/status` e `/diagnose` expunham `ask_user` e `shadow`;
  - `/usage now` expunha `classe=ask_user_continuation` no modo default;
  - `/sdk simulate request-user-input` mostrava `request_user_input diagnóstico`.
- Decisao:
  - superficie default deve explicar efeito operacional, nao envelope de protocolo;
  - envelope tecnico permanece acessivel em `detail`, `raw`, `/events`, `/tools diag` e testes de
    protocolo;
  - nomes humanos passam a ser a forma padrao: `pergunta humana`, `pergunta restaurada`,
    `input estruturado`, `intencao explicita`, `diagnostico de input estruturado`.
- Mudancas aplicadas:
  - `/help` passou a falar em perguntas/formularios/permissoes e intencoes explicitas;
  - `/menu` removeu `assistant.intent/report_intent` da descricao default;
  - `/intent` default mostra horario, fonte humana e risco humano; `/intent detail` mostra origem,
    tool, call e id;
  - `intent-renderer.js` removeu `tool=`/`call=` da impressao ao vivo e do transcript local default;
  - `/status` e `/diagnose` trocaram `ask_user` por `pergunta humana` e `shadow` por
    `pergunta restaurada`;
  - `/sdk waits` trocou frase de `request_user_input pendente` por `input estruturado pendente`;
  - `/usage now` trocou `classe=ask_user_continuation` por `tipo=continuação da pergunta humana`;
    `detail` preserva classe/motivo tecnicos;
  - mensagens de mailbox/zero-PR passaram a falar em `próxima pergunta humana`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js tests/unit/copilot/terminal/test_commands_intent.spec.js tests/unit/copilot/terminal/test_intent_renderer.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`
  - status PASS;
  - 8 arquivos, 110 testes.
- Evidencia live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-ux-human-copy-20260602-0804`
  - artefatos:
    - `artifacts/terminal-live/structured-input-ux-human-copy-20260602-0804/summary.md`
    - `artifacts/terminal-live/structured-input-ux-human-copy-20260602-0804/summary.json`
    - `artifacts/terminal-live/structured-input-ux-human-copy-20260602-0804/structured-input-cycle.raw.log`
    - `artifacts/terminal-live/structured-input-ux-human-copy-20260602-0804/structured-input-cycle.plain.log`
  - status PASS;
  - duracao 8336ms;
  - a tela mostrou `diagnóstico de input estruturado`, `pergunta=0 · input=1`,
    `input estruturado pendente` e nenhum request ID default.
- Gap residual deliberado:
  - `/events`, `/tools diag`, `/intent detail`, export tecnico e runner live ainda podem mostrar
    nomes tecnicos, porque sao surfaces de diagnostico/protocolo.

## 02.33 Primeira tela calma: banner, ambiente e auto-brief

- Problema observado nas screenshots e lives:
  - a primeira tela competia com o prompt e parecia uma colagem de logs;
  - o banner default listava muitos comandos e misturava atalhos, HTTP e diagnostico;
  - `boot-banner.js` imprimia `STANDALONE`, `Registry local ativo` e `Sessão SDK: auto-resume` como
    narrativa tecnica secundaria;
  - `auto-brief.js` default repetia prefixos `[brief:boot]`/`[brief:ready]`, poluindo a tela antes
    mesmo do operador agir.
- Situacao ideal desta camada:
  - primeira tela deve ter poucos atalhos, explicar a rota de input humano e apontar para
    diagnostico sob demanda;
  - ambiente deve ser uma ficha curta alinhada, nao uma segunda caixa;
  - auto-brief default deve parecer cockpit operacional, nao log/debug;
  - modo full/debug continua opt-in via `COPILOT_TERMINAL_BOOT_MENU=full` e
    `COPILOT_TERMINAL_AUTO_BRIEF=full`.
- Mudancas aplicadas:
  - `repl-banner.js` default foi reduzido para `/status`, `/now`, `/menu`, `/activity 10`, `/help`;
  - a linha de input passou a dizer `texto livre -> fila zero-PR`, `/turn <msg>` e `@arquivo`;
  - HTTP e diagnostico foram separados em uma linha curta;
  - `terminal-phases/boot-banner.js` trocou `STANDALONE` por `Ambiente local`, `Acesso` e `Sessão`
    com labels alinhados;
  - `auto-brief.js` default trocou `[brief:phase]` por `Sessão`, `BYOK`, `Fluxo`, `Boot` e `Atenção`
    alinhados;
  - `COPILOT_TERMINAL_AUTO_BRIEF=full` preserva a saida tecnica anterior com `[auto-brief:phase]`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_auto_brief.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js`
  - status PASS;
  - 3 arquivos, 7 testes.
- Evidencia live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/terminal-boot-calm-structured-input-20260602-0808`
  - artefatos:
    - `artifacts/terminal-live/terminal-boot-calm-structured-input-20260602-0808/summary.md`
    - `artifacts/terminal-live/terminal-boot-calm-structured-input-20260602-0808/summary.json`
    - `artifacts/terminal-live/terminal-boot-calm-structured-input-20260602-0808/structured-input-cycle.raw.log`
    - `artifacts/terminal-live/terminal-boot-calm-structured-input-20260602-0808/structured-input-cycle.plain.log`
  - status PASS;
  - duracao 8065ms;
  - a primeira tela mostrou banner compacto, auto-brief alinhado e bloco de ambiente sem
    `STANDALONE`.
- Evidencia live final apos humanizar lifecycle:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/terminal-boot-human-lifecycle-criteria-20260602-0813`
  - artefatos:
    - `artifacts/terminal-live/terminal-boot-human-lifecycle-criteria-20260602-0813/summary.md`
    - `artifacts/terminal-live/terminal-boot-human-lifecycle-criteria-20260602-0813/summary.json`
    - `artifacts/terminal-live/terminal-boot-human-lifecycle-criteria-20260602-0813/structured-input-cycle.raw.log`
    - `artifacts/terminal-live/terminal-boot-human-lifecycle-criteria-20260602-0813/structured-input-cycle.plain.log`
  - status PASS;
  - duracao 8111ms;
  - criterio novo `structured-input-calm-boot-copy` passou;
  - a tela default evitou `AlwaysAliveAgent`, `STANDALONE`, `Registry local ativo` e prefixos
    `[brief:boot]`/`[brief:ready]`.
- Gap residual:
  - avaliar se o bloco `Ambiente` deve fundir com auto-brief ready para reduzir ainda mais a altura
    inicial.

## 02.34 Command palette compacto

- Problema observado:
  - `/menu` ainda usava uma caixa grande e três linhas por item;
  - a densidade parecia uma lista de logs, nao uma palette;
  - descricoes ainda continham `pending question`, `dialog loop` e `troubleshooting`.
- Mudancas aplicadas:
  - `/menu` agora renderiza uma tabela compacta de uma linha por ação;
  - indices passaram para `[01]`, `[02]`, ... para alinhamento estavel;
  - label, comando e descricao sao aparados por coluna;
  - o marcador de acao passou de `HOT` para `AGIR`, sem criar linha extra;
  - o titulo passou de `Command Palette` para `Painel de ações`;
  - descricoes foram humanizadas para `pergunta pendente`, `conversa`, `ferramentas` e
    `diagnostico`;
  - termos de engenharia como `Health`, `binding`, `prompt freshness`, `billing`, `pending question`
    e `troubleshooting` foram removidos da superficie padrao do menu;
  - footer mostra atalhos `/menu 1`, `/menu status` e `/menu help`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_menu.spec.js`
  - status PASS;
  - 1 arquivo, 5 testes.
- Validadores adicionais:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
  - status PASS.
- Evidencia live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --menu-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/menu-compact-cycle-20260602-0817`
  - artefatos:
    - `artifacts/terminal-live/menu-compact-cycle-20260602-0817/summary.md`
    - `artifacts/terminal-live/menu-compact-cycle-20260602-0817/summary.json`
    - `artifacts/terminal-live/menu-compact-cycle-20260602-0817/menu-cycle.raw.log`
    - `artifacts/terminal-live/menu-compact-cycle-20260602-0817/menu-cycle.plain.log`
  - status PASS;
  - duracao 5677ms;
  - criterios `menu-cycle-compact-table`, `menu-cycle-human-copy`, `menu-cycle-quick-actions` e
    `menu-cycle-clean-close` passaram.
- Evidencia live PT-BR executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --menu-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/menu-compact-ptbr-cycle-20260602-0827`
  - artefatos:
    - `artifacts/terminal-live/menu-compact-ptbr-cycle-20260602-0827/summary.md`
    - `artifacts/terminal-live/menu-compact-ptbr-cycle-20260602-0827/summary.json`
    - `artifacts/terminal-live/menu-compact-ptbr-cycle-20260602-0827/menu-cycle.raw.log`
    - `artifacts/terminal-live/menu-compact-ptbr-cycle-20260602-0827/menu-cycle.plain.log`
  - status PASS;
  - duracao 5130ms;
  - criterio `menu-cycle-human-copy` agora mede a secao do `/menu` em vez de reprovar por rotulos
    tecnicos de boot que pertencem a outro alvo de UX.

## 02.35 Superficies padrao compactas

- Problema observado:
  - `/help` abria uma caixa enorme com todos os comandos e misturava termos como `binding`,
    `runtime`, `health`, `billing` e `CommandDefinition`;
  - `/status` despejava diagnostico completo por padrao, incluindo ids, prompt digest, contrato de
    tools, billing e detalhes internos;
  - `/now` usava pares tecnico-operacionais como `runtime=`, `live=`, `ASK:none`, `PM:approve_all`;
  - `/sdk waits` ainda era renderizado como `SDK Waits` e misturava `elicitation`, `permission`,
    `ask_user` e `request_user_input` no modo padrao;
  - esses quatro comandos apareciam nas capturas como uma superficie visual pesada e pouco alinhada
    com o operador humano.
- Situacao ideal definida:
  - comandos padrao devem responder a pergunta humana "o que eu preciso saber agora?";
  - diagnostico tecnico deve continuar disponivel, mas atras de `full`, `detail` ou comandos
    explicitamente diagnosticos;
  - comandos de espera humana devem parecer uma fila de decisao humana, nao um dump de tools;
  - o terminal deve evitar rótulos crus quando existe tradução operacional clara.
- Mudancas aplicadas:
  - `/help` passou a exibir `Ajuda rápida — Terminal LLM-B` por padrao;
  - `/help full`, `/help all`, `/help detail` e `/help detalhe` preservam o catalogo completo
    antigo;
  - o roteador REPL passou a encaminhar argumentos para `/help`;
  - `/status` passou a exibir painel compacto por padrao com `Conversa`, `Saúde`, `Entrada`,
    `Modelo`, `Acesso`, `Catálogo`, `Atividade`, `Próximo` e `Detalhe`;
  - `/status full`, `/status detail`, `/status detalhe` e `/status --detail` preservam o diagnostico
    completo anterior;
  - `/status` evita expor `Próximo none`; sem acao obrigatoria, sugere `/menu`;
  - `/now` passou a renderizar `[agora]` com linguagem humana por padrao;
  - `/now full` preserva a linha tecnica antiga com `runtime=`, `live=`, `ASK`, `PM`, `timeline` e
    `sse`;
  - `/now` deixou de emitir `próximo=none`;
  - `/sdk waits` passou de `SDK Waits` para `Esperas humanas`;
  - `/sdk waits` default usa `formulários`, `permissões`, `perguntas` e `inputs`;
  - `/sdk waits detail` continua expondo `ask_user` e `request_user_input` para diagnostico.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_help.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js`
  - status PASS;
  - 4 arquivos, 87 testes.
- Validadores de sintaxe executados:
  - `node --check src/copilot/terminal/commands/help.js`
  - `node --check src/copilot/terminal/commands/session.js`
  - `node --check src/copilot/terminal/commands/sdk.js`
  - `node --check src/copilot/terminal/repl/repl-command-router.js`
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
  - status PASS.
- Evidencia live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-human-boot-criteria-20260602-0850`
  - artefatos:
    - `artifacts/terminal-live/default-ux-cycle-human-boot-criteria-20260602-0850/summary.md`
    - `artifacts/terminal-live/default-ux-cycle-human-boot-criteria-20260602-0850/summary.json`
    - `artifacts/terminal-live/default-ux-cycle-human-boot-criteria-20260602-0850/default-ux-cycle.raw.log`
    - `artifacts/terminal-live/default-ux-cycle-human-boot-criteria-20260602-0850/default-ux-cycle.plain.log`
  - status PASS;
  - duracao 7617ms;
  - criterios `ux-cycle-help-compact`, `ux-cycle-boot-human-copy`, `ux-cycle-status-compact`,
    `ux-cycle-now-human`, `ux-cycle-waits-human` e `ux-cycle-clean-close` passaram.
  - a tela final mostra `Próximo /menu` em vez de `Próximo none` e omite `próximo=none` em `/now`.

## 02.36 Boot humano e linha viva sem cauda crua

- Problema observado:
  - a primeira linha viva mostrava `Subindo servidor copilot` e `stopped:noloop`;
  - o segundo pulso mostrava `Inicializando runtime do agente` e `starting:noloop`;
  - o banner de modo local mostrava `Tools locais ativas`;
  - o auto-brief inicial mostrava `0 tools` e `aguardando registry/dialog`.
- Mudancas aplicadas:
  - a fase HTTP passou a registrar `Preparando terminal`;
  - o lifecycle do agente passou a detalhar `Inicializando ambiente da conversa`;
  - `compactRuntimeStatus()` passou a humanizar `stopped:noloop` como `conversa parada` e
    `starting:noloop` como `iniciando`;
  - o banner de ambiente passou a usar `ferramentas locais ativas`;
  - a linha `Tools` do boot passou para `Ações`;
  - o auto-brief passou a usar `ferramentas`, `ferramentas subindo` e
    `preparando ferramentas/conversa`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_boot_banner.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js tests/unit/copilot/terminal/test_auto_brief.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js`
  - status PASS;
  - 4 arquivos, 19 testes.
- Validadores de sintaxe executados:
  - `node --check src/copilot/terminal/terminal-phases/boot-banner.js`
  - `node --check src/copilot/terminal/terminal-phases/boot-http.js`
  - `node --check src/copilot/terminal/dialog/engine.js`
  - `node --check src/copilot/terminal/repl/auto-brief.js`
  - `node --check src/copilot/terminal/repl/live-status-line.js`
  - status PASS.
- Evidencia live:
  - incluida no ciclo `default-ux-cycle-human-boot-criteria-20260602-0850`;
  - o criterio `ux-cycle-boot-human-copy` bloqueia regressao de `Subindo servidor copilot`,
    `runtime do agente`, `stopped:noloop`, `starting:noloop`, `Tools locais` e `0 tools`.
- Gap residual:
  - o status compacto ainda pode ganhar badges visuais melhores para `Saúde`, `Entrada` e `Acesso`;
  - algumas linhas ainda mantem `fs`, `exec`, `BYOK`, `SSE` e nomes de comandos porque sao atalhos
    operacionais importantes;
  - avaliar se `/health` e `/tools` tambem devem ganhar modo compacto padrao.

## 02.37 `/live` compacto por padrao

- Problema observado:
  - `/live` ainda abria `Terminal Live Flow` por padrao;
  - a tela mostrava `runtime`, `sdk/session`, `streaming=`, `sse`, `timeline`, `cache/scope` e
    `trace`;
  - isso era util para diagnostico, mas pesado demais como superficie cotidiana.
- Mudancas aplicadas:
  - `/live` agora renderiza `Fluxo da conversa` por padrao;
  - a tela compacta mostra `Estado`, `Conversa`, `Sinais`, `Atividade`, `Turno`, `Conexões` e
    `Detalhe`;
  - sinais de streaming sao traduzidos como `resposta ao vivo`, `raciocínio visível`,
    `ferramentas visíveis` e `uso visível`;
  - `idle` cru foi substituido por `ocioso`;
  - `/live full`, `/live detail`, `/live detalhe` e `/live --detail` preservam a grade tecnica
    antiga.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`
  - status PASS;
  - 1 arquivo, 43 testes.
- Validadores de sintaxe executados:
  - `node --check src/copilot/terminal/commands/session.js`
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
  - status PASS.
- Evidencia live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-activity-no-stream-counters-20260602-0908`
  - artefatos:
    - `artifacts/terminal-live/default-ux-cycle-activity-no-stream-counters-20260602-0908/summary.md`
    - `artifacts/terminal-live/default-ux-cycle-activity-no-stream-counters-20260602-0908/summary.json`
    - `artifacts/terminal-live/default-ux-cycle-activity-no-stream-counters-20260602-0908/default-ux-cycle.raw.log`
    - `artifacts/terminal-live/default-ux-cycle-activity-no-stream-counters-20260602-0908/default-ux-cycle.plain.log`
  - status PASS;
  - criterio novo `ux-cycle-live-compact` passou;
  - o criterio bloqueia `Terminal Live Flow`, `cache/scope`, `streaming=`, `sdk/session`, `runtime`
    e `idle` cru na superficie padrao.

## 02.38 `/activity` sem contadores tecnicos no padrao

- Problema observado:
  - `/activity` ainda exibia `fase`, `label`, `source`, `tools`, `trace` e o bloco
    `Streaming público`;
  - mesmo sem atividade relevante, o operador via contadores `deltas`, `cumulativo`, `final`,
    `fallback temporal`;
  - essa informacao pertence ao diagnostico, nao à superficie cotidiana.
- Mudancas aplicadas:
  - `fase` virou `estado`;
  - `label` virou `evento`;
  - `source` virou `origem` apenas em `/activity detail`;
  - `tools` virou `ferramentas`;
  - `ASK` e `INTENT` viraram `pergunta` e `intenção`;
  - fases como `idle`, `tool`, `turn` e `thinking` agora renderizam `pronto`, `ferramenta`, `turno`
    e `pensando`;
  - a frase de detalhe passou de `IDs/trace completos...` para
    `Detalhes técnicos ficam em /activity detail`;
  - `Streaming público` e seus contadores agora aparecem somente quando há `detail`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`
  - status PASS;
  - 2 arquivos, 47 testes.
- Validadores de sintaxe executados:
  - `node --check src/copilot/terminal/commands/activity.js`
  - `node --check src/copilot/terminal/commands/session.js`
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
  - status PASS.
- Evidencia live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-activity-no-stream-counters-20260602-0908`
  - status PASS;
  - criterio `ux-cycle-activity-human` passou;
  - o criterio bloqueia `source`, `tools`, `trace`, `Streaming público`, `deltas` e `cumulativo` na
    superficie padrao.

## 02.39 `/health` como painel operacional compacto

- Problema observado:
  - `/health` ainda renderizava o mesmo painel profundo de `/diagnose`;
  - a primeira tela continha `runtime id`, `sdk prompts=`, `streaming=`, `inline status`,
    `Lifecycle mx` e outras chaves internas;
  - isso resolvia auditoria, mas nao resolvia a necessidade cotidiana do operador: saber se pode
    continuar, o que esta bloqueando e onde abrir detalhe.
- Situacao ideal:
  - `/health` deve ser leitura de 5 a 10 linhas, com rótulos humanos, alinhados e sem IDs longos;
  - `/health full` e `/diagnose` devem preservar o painel completo;
  - `/diag` e `/diagnose` continuam sendo entradas tecnicas deliberadas, nao superficies padrao.
- Mudancas aplicadas:
  - `cmdDiagnose` ganhou modo compacto default;
  - `full`, `detail`, `debug`, `diag`, `diagnose`, `all`, `raw` preservam o painel profundo;
  - o roteador separou `/health` de `/diagnose` e `/diag`;
  - `/diagnose` e `/diag` sem argumentos passam a chamar o modo `full`;
  - `/health` mostra `Conversa`, `Modelo`, `Acesso`, `Gateway`, `Entrada`, `Ferramentas`,
    `Atividade`, `Infra`, `Próximo` e `Detalhe`;
  - estados crus como `processing`, `idle` e `waiting_for_input` passam a ser `trabalhando`,
    `ocioso` e `aguardando você`;
  - `inspect_boot_report` passa a ser `verificar relatório de inicialização`.
- Garantias:
  - IDs de sessão continuam compactados ou ocultos por padrão;
  - credenciais BYOK continuam não renderizadas;
  - o painel profundo continua disponível para investigação.

## 02.40 `/tools` como placar humano de ferramentas

- Problema observado:
  - `/tools` ainda imprimia `tool(s)`, `calls=`, `blocked=`, `errors=` e `avg=`;
  - esses rótulos eram corretos para telemetria, mas ruins para a tela cotidiana;
  - quando não havia dados, a mensagem ainda dizia `Nenhuma tool observada`.
- Situacao ideal:
  - `/tools` default deve dizer quais grupos de ação a LLM-B já usou;
  - o operador deve ver uso, bloqueios, falhas e latência sem ler nomes de campos;
  - `/tools diag`, `/tools all` e `/tools raw` continuam canônicos para auditoria.
- Mudancas aplicadas:
  - estado vazio virou `Nenhuma ferramenta observada ainda`;
  - o cabeçalho default virou `Ferramentas observadas`;
  - linhas default usam `uso`, `sem bloqueios`, `sem falhas` e latência simples;
  - `calls=`, `blocked=`, `errors=` e `avg=` ficaram restritos aos modos técnicos;
  - o rodapé aponta para `/tools diag` e `/tools raw`.
- Prova live planejada:
  - o ciclo `--ux-cycle` agora abre `/health` e `/tools`;
  - novos critérios `ux-cycle-health-compact` e `ux-cycle-tools-human` bloqueiam vazamento de
    rótulos crus.

## 02.41 `/status` e `/now` sem mini key-values no padrão

- Problema observado no PTY:
  - depois da compactação de `/health` e `/tools`, `/status` ainda mostrava `healthy`;
  - `/now` ainda renderizava `entrada=standby`, `sse=0/0`, `catálogo=` e `atividade=`;
  - isso mantinha a estética de log técnico na superfície de orientação rápida.
- Mudanças aplicadas:
  - `/status` default traduz `healthy` para `ok`;
  - pluralização de catálogo ficou humana: `1 provedor`, `3 modelos`;
  - `/now` default removeu `entrada=`, `catálogo=`, `atividade=`, `próximo=` e `sse=`;
  - `/now full` continua preservando o snapshot técnico com `runtime=`, `sse=`, `gateway=...` e
    demais campos.
- Evidência live executada:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-health-tools-now-20260602-0855`
  - status PASS;
  - critérios novos/preservados que passaram:
    - `ux-cycle-health-compact`;
    - `ux-cycle-tools-human`;
    - `ux-cycle-now-human` com bloqueio reforçado contra `entrada=`, `catálogo=`, `atividade=`,
      `próximo=` e `sse=`.
- Artefatos:
  - `artifacts/terminal-live/default-ux-cycle-health-tools-now-20260602-0855/summary.md`;
  - `artifacts/terminal-live/default-ux-cycle-health-tools-now-20260602-0855/summary.json`;
  - `artifacts/terminal-live/default-ux-cycle-health-tools-now-20260602-0855/default-ux-cycle.raw.log`;
  - `artifacts/terminal-live/default-ux-cycle-health-tools-now-20260602-0855/default-ux-cycle.plain.log`.

## 02.42 Heartbeats longos sem IDs e sem termos crus

- Problema observado:
  - os screenshots mostravam linhas repetidas de espera como
    `LLM-B ainda trabalhando · modelo/esforço · Ns sem saída incremental`;
  - o heartbeat de ferramenta longa ainda podia imprimir `ainda executando · Ns · toolCallId`;
  - esses textos são úteis como sinal de vida, mas ruins como UX durável quando trazem IDs ou
    taxonomia interna.
- Mudanças aplicadas:
  - heartbeat de tool longa virou `Ferramenta em andamento`;
  - `exec_command`, `bash` e `shell` passaram a renderizar `Executar comando`;
  - a linha visual de tool longa agora usa `ainda trabalhando · Ns sem novo progresso`;
  - `toolCallId` deixou de aparecer na linha visual;
  - a narração durável do dialog loop virou `LLM-B pensando · Ns sem resposta visível`;
  - `modelo/esforço` e `sem saída incremental` saíram da narração durável padrão.
- Garantias:
  - IDs continuam preservados nos diagnósticos e eventos;
  - `/tools diag` e `/events` continuam sendo os locais corretos para correlacionar `toolCallId`;
  - os testes de eventos agora bloqueiam `tool-long-compact`, `bash-long` e `read_file_content` no
    stdout humano.

## 02.43 Lifecycle de ferramentas sem badge `[TOOL]`

- Problema observado:
  - o renderer canônico de lifecycle ainda imprimia `[TOOL] [READ]`, `[TOOL] [INSPECT]` e similares;
  - isso deixava a UI com cara de log técnico e repetia o tipo genérico antes da ação real;
  - eventos externos ainda podiam aparecer como `external tool`.
- Mudanças aplicadas:
  - o badge genérico `[TOOL]` foi removido da linha visual de início;
  - operações foram traduzidas para badges curtos:
    - `LER`, `CRIAR`, `EDITAR`, `COPIAR`, `MOVER`, `EXCLUIR`, `LISTAR`, `EXEC`, `VER`, `PERGUNTA`,
      `INTENÇÃO`, `AÇÃO`;
  - conclusão de tool passou de `DONE/FAIL` para `OK/FALHA`;
  - `Executando tool` virou `Ferramenta em uso`;
  - `External tool solicitada/concluída/falhou` virou
    `Integração externa solicitada/concluída/falhou`;
  - fallback visual `external tool:` virou `integração externa:`;
  - `browser_action` passou a renderizar `Ação no navegador`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js`;
  - status PASS;
  - 3 arquivos, 49 testes.

## 02.44 Live real de tool longa e achados de segunda ordem

- Live executado:
  - comando:
    - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=long-tool-heartbeat --timeout-ms=240000 --transport=pty --out-dir=artifacts/terminal-live/long-tool-heartbeat-human-lifecycle-20260602-0905`
  - o turno usou tools reais:
    - `report_intent`;
    - `read_file_content`;
    - `exec_command`;
    - `ask_user`;
  - o operador viu `[INTENÇÃO]`, `[LER]`, `[EXEC]` e `✅ [OK]`, sem `[TOOL]`.
- Status do live:
  - funcionalmente executou o cenário;
  - export, SSE, ask_user e resposta humana passaram;
  - falhou em critérios de runner defasados e em UX residual:
    - `tool-start-done` ainda exigia `done` direto em vez de aceitar `postToolUse` como sucesso
      estruturado;
    - `ux-compact-boot-banner` procurava `[brief:ready]`, que foi substituído pela primeira tela
      calma;
    - `ux-human-tool-names` ainda esperava `[TOOL] [READ]` e `✅ [DONE]`.
- Correções aplicadas no runner:
  - `tool-start-done` aceita `postToolUse` de `read_file_content` como prova de sucesso estruturado;
  - o critério de boot passa a procurar `LLM-B pronta`;
  - `ux-human-tool-names` passa a esperar `[INTENÇÃO]`, `[LER]` e `✅ [OK]`;
  - cenários com `exec_command` passam a esperar `Executar comando`;
  - o roundtrip de arquivo passa a esperar `[MOVER] Mover arquivo` e bloquear `[VER] Mover arquivo`.

## 02.45 Resumo de turno e atualização de ferramentas em PT-BR

- Problema observado no live:
  - após tools reais, o terminal ainda imprimia:
    - `[TURN] 2 tool(s)`;
    - `[TOOLS] INTENT ... READ ...`;
    - `[FILES] READ ...`;
    - `Tools dinâmicas SDK atualizadas`;
  - essas linhas eram uma das fontes visuais mais parecidas com os screenshots iniciais.
- Mudanças aplicadas:
  - `[TURN]` virou `[TURNO]`;
  - `[TOOLS]`/`[OPS]` virou `[AÇÕES]`;
  - `[FILES]` virou `[ARQUIVOS]`;
  - `tool(s)` virou `ação/ações`;
  - operações no resumo passaram a usar `PERGUNTA`, `INTENÇÃO`, `LER`, `CRIAR`, `EDITAR`, `COPIAR`,
    `MOVER`, `EXCLUIR`, `LISTAR`, `EXEC`, `VER` e `AÇÃO`;
  - `Tools dinâmicas SDK atualizadas` virou `Ferramentas dinâmicas do SDK atualizadas`;
  - `registry local sem tools` virou `sem ferramentas locais ativas`.
- Testes escopados executados:
  - `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`;
  - status PASS;
  - 3 arquivos, 59 testes.

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
- O teste live `terminal-ux-revolution-pass3-sdk-20260602-0621` confirmou PASS nos criterios
  esteticos novos e preservou os criterios funcionais existentes.

### 03.03 Transcript e timeline

- `readTerminalTimelineProjection()` combina:
  - history bridge;
  - transcript local;
  - hub persistido.
- `cmdExport()` le somente essa timeline.
- `recordTerminalUserInputRequested()` registra estado SDK e agora adiciona turno operacional ao
  transcript.
- `recordTerminalUserInputCompleted()` registra resposta, echo guard e agora adiciona turno humano
  ao transcript.
- `recordTerminalTurnUserInputActivity()` alimenta diagnostico de turno, mas nao alimenta export.
- `renderTerminalAssistantTranscript()` adiciona mensagens da LLM-B ao transcript.
- A mensagem pos-ask emitida por `assistant.message` agora entra no export mesmo quando o hub esta
  divergente.
- O algoritmo atual marca divergencia quando nao encontra overlap entre hub e live feed.
- Em divergencia, a timeline preserva persistedTurns, bloqueia sync e inclui tail vivo nao
  persistido.
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
- `user_input.requested`, `question.answered`, `user_input.completed` e `assistant.message` existem
  no archive.
- IDs publicos sao monotonicos.
- Trace overlap entre stdout e SSE foi observado.
- O archive e bom para diagnostico bruto, mas nao substitui transcript/export.
- A timeline deve consumir fatos vivos relevantes do estado local, nao exigir que operador leia
  JSONL.

### 03.08 Hub e divergencia

- Hub persistido contem os dois turnos iniciais.
- Feed vivo contem eventos adicionais.
- Overlap falhou e status virou `diverged`.
- Em `diverged`, `maybeScheduleTimelineSync()` bloqueia persistencia.
- Essa decisao permanece correta para nao corromper hub.
- `readTerminalTimelineProjection()` agora retorna `timelineSource='mixed'` com
  `liveBridgeTailCount`.
- Persistencia continua bloqueada enquanto a projecao visual inclui live turns anotados.
- `syncBlockedReason` agora explicita o motivo de bloqueio de sync para projection, export e
  comandos operacionais.

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
- [x] Remover falso alerta de file-tools ausentes no `auto-brief:boot` parcial mantendo warnings
      reais.
- [x] Separar contagem de tools SDK dinamicas da contagem de registry local em
      `session.tools_updated`.
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
- [x] Parametrizar runner para cenarios `canonical`, `freeform`, `invalid-choice`,
      `long-tool-heartbeat` e `recoverable-tool-error`.
- [x] Parametrizar runner para cenario `file-write-roundtrip` cobrindo create/move/delete.
- [x] Adicionar dry-run/teste de contrato para prompts dos cenarios alternativos.
- [x] Rodar live test com caso canonico atual.
- [x] Rodar live test com resposta freeform.
- [x] Rodar live test com choice invalida.
- [x] Rodar live test com tool longa e heartbeat.
- [x] Rodar live test com erro de tool recuperavel.
- [x] Adicionar criterio hard para ausencia de prompt de permissao em cenarios permissionados.
- [x] Rodar live SDK/Copilot com `COPILOT_BYOK_ENABLED=false` para isolar permissao de instabilidade
      BYOK.
- [x] Rodar live SDK/Copilot com `file-write-roundtrip` para provar create/move/delete sem prompt.
- [x] Corrigir presenter para `move_file` deixar de aparecer como `[INSPECT]` generico.
- [x] Adicionar criterio hard no runner live para regressao `[INSPECT] move_file`.
- [x] Rodar live SDK/Copilot provando `move_file` como `[MOVE]`, com `source`/`destination`
      visiveis.

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
- [x] Registrar evidencia PTY da rodada `terminal-ux-revolution-pass5-sdk-20260602-0637`.

### Faixa M - Glossario visual e nomes humanos

- [x] Criar camada canonica de apresentacao visual de tools sem alterar nomes tecnicos em
      SSE/export.
- [x] Mapear `report_intent`/`report_intent_local` para `Intent capturado`.
- [x] Mapear `request_user_input`/`ask_user` para `Pergunta ao operador`.
- [x] Mapear introspeccoes comuns para nomes humanos curtos.
- [x] Preservar alias tecnico apenas em debug/detalhe.
- [x] Criar testes unitarios para nomes humanos e alias oculto por default.
- [x] Humanizar `/help`, `/menu`, `/status`, `/diagnose`, `/usage now` e `/intent` default.
- [x] Criar modo `/intent detail` para envelope tecnico sem poluir a vista normal.

### Faixa N - Sanitizacao de IDs na UX default

- [x] Remover `requestId`/`toolCallId` como fallback de target default no presenter.
- [x] Mostrar IDs completos apenas em `/events`, export bruto, `/intent detail` e diagnosticos
      explicitos.
- [x] Mostrar IDs compactos apenas quando o comando for diagnostico.
- [x] Garantir que `report_intent` use intent como target quando disponivel.
- [x] Garantir que tools sem target humano nao inventem target com ID tecnico.
- [x] Adicionar teste contra `chatcmpl-tool-*`/`toolu_*` em linhas default.
- [x] Adicionar teste de `intent-renderer.js` contra `toolu_*`, `tool=` e `call=` na impressao ao
      vivo default.

### Faixa O - ASK como superficie propria

- [x] Adicionar operation visual `ask` ao presenter/runtime.
- [x] Renderizar `request_user_input` como `[ASK]`, nao `[RUN]`.
- [x] Renderizar `ask_user` e `request_user_input` sob a mesma semantica visual.
- [x] Suprimir heartbeat duravel de pergunta humana pendente.
- [x] Manter pergunta humana em card duravel unico.
  - O dedupe local de perguntas pendentes passou de janela curta de 2s para janela durável de sessão
    de 30min, evitando reimpressões espaçadas enquanto a linha viva/prompt continuam indicando
    pendência.
  - Teste: `npx vitest run tests/unit/copilot/terminal/test_pending_question_replay.spec.js`.
  - Live PTY:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-durable-card-pass-20260602-1820`.
  - Resultado: PASS; prompt `[PERG]`, linha viva `LLM-B PERGUNTA`, `/sdk waits` humano, resposta
    roteada e pendência limpa sem spam durável.
- [x] Garantir que resposta humana nao fique colada na linha viva.
- [x] Tratar timeout durante espera humana como `aguardando operador`, nao erro de modelo.
  - Decisão: eventos SDK de espera humana (`user_input.requested`, `elicitation.pending`,
    `permission.requested`) pausam o timeout de inatividade do turno; os respectivos `completed`
    retomam o relógio.
  - Isso preserva timeout real para silêncio do modelo depois que a resposta humana é entregue, mas
    impede que ausência do operador seja classificada como falha do provider/modelo.
  - Teste: `npx vitest run tests/unit/copilot/test_turn_executor.spec.js`.
- [x] Adicionar teste unitario de `request_user_input` sem `[TOOL] [RUN]`.
- [x] Revalidar live scenario freeform de `ask_user` apos polimento visual.
- [x] Adicionar live scenario especifico para `request_user_input` local sintetico, alem de
      `ask_user` SDK.

### Faixa P - Linha viva unificada

- [x] Escolher uma unica fonte de linha viva por estado.
- [x] Reduzir `LIVE_DETAIL_CATASTROPHIC_CHARS` para budget visual real.
- [x] Compactar `waiting-human` em ate duas linhas fisicas no default.
- [x] Compactar `thinking/sem delta` em uma linha sem repetir `LLM-B trabalhando`.
- [x] Remover `turnId=` da linha viva default.
- [x] Substituir prompt de espera `⏳ [modelo/esforco]` por texto humano.
- [x] Evitar narracao duravel repetitiva `LLM-B ainda trabalhando` em modo normal.
- [x] Manter watchdog visivel sem competir com `⟲ LLM-B`.
- [x] Criar testes de formatacao com largura estreita.
- [x] Criar criterio live para ausencia de status duplicado.

### Faixa Q - Boot, menu e auto-brief

- [x] Substituir menu inicial gigante por resumo compacto.
- [x] Manter `/help` como superficie de comandos completos.
- [x] Compactar auto-brief default em grupos humanos.
- [x] Remover prefixos `[brief:boot]` e `[brief:ready]` do auto-brief default.
- [x] Alinhar labels `Sessão`, `BYOK`, `Fluxo`, `Boot` e `Atenção`.
- [x] Trocar `STANDALONE` por `Ambiente local` no bloco de boot.
- [x] Separar `Acesso`, `Sessão` e `Tools` em linhas curtas no bloco de boot.
- [x] Mover detalhes `parser/cache/index/scopes` para `/activity`, `/health` ou modo debug.
- [x] Ajustar box standalone para largura responsiva.
- [x] Rebaixar alerta MCP indisponivel quando tools locais estao ativas.
- [x] Adicionar teste snapshot/regex do boot compacto.
- [x] Adicionar live criterion de primeiro viewport sem overflow obvio.
- [x] Rodar live PTY `terminal-boot-calm-structured-input-20260602-0808`.
- [x] Humanizar lifecycle `AlwaysAliveAgent`, `Conectando ao agente` e `Reanexando sessão SDK`.
- [x] Adicionar criterio live `structured-input-calm-boot-copy`.
- [ ] Avaliar fusao do bloco `Ambiente` com auto-brief ready para reduzir altura inicial.
- [x] Compactar `/menu` em uma linha por ação.
- [x] Humanizar descrições do `/menu` (`pending question`, `dialog loop`, `troubleshooting`).
- [x] Criar live PTY dedicado para `/menu`.
- [x] Adicionar flag `--menu-cycle` ao runner live.

### Faixa R - Comandos de diagnostico com dois niveis

- [x] Revisar `/activity` para modo default sem IDs longos.
- [x] Revisar `/tools diag` para IDs compactos e drill-down claro.
- [x] Revisar `/events` para continuar bruto, mas com header explicito de debug.
- [x] Revisar `/health` para reduzir ruido visual default.
- [x] Compactar runtime/sdk/hub em `/usage now` default.
- [x] Compactar runtime/sdk/hub em `/health` default.
- [x] Remover `io-engine.*` da narrativa default de I/O.
- [x] Humanizar agregados `io.*` no `/tools` default.
- [x] Adicionar `detail`/`--detail` ao `/activity`.
- [x] Adicionar `detail` ao `/usage now` e `/health`.
- [ ] Adicionar flags ou subcomandos `detail`, `raw` ou `debug` nas demais superficies onde fizer
      sentido.
- [x] Testar que dados tecnicos continuam acessiveis.

### Faixa S - Lives esteticos com LLM-B

- [x] Atualizar runner para detectar IDs crus em narrativa default.
- [x] Atualizar runner para detectar status vivo duplicado.
- [x] Atualizar runner para detectar `request_user_input` como `[RUN]`.
- [x] Atualizar runner para detectar menu inicial excessivamente longo.
- [x] Atualizar runner para detectar segundo box standalone antigo.
- [x] Atualizar runner para detectar ASK vivo verboso.
- [x] Atualizar runner para detectar turno vivo com detalhe longo repetido.
- [x] Atualizar runner para detectar prompt de espera bruto `⏳ [modelo/esforco]`.
- [x] Rodar live SDK/Copilot apos Faixas M-P.
- [ ] Rodar live BYOK quando a superficie estiver estabilizada.
- [x] Rodar live SDK/Copilot freeform apos polimento de I/O e diagnosticos.
- [x] Rodar live com `request_user_input` local sintetico.
- [x] Registrar artefatos e decisao no roadmap.

## 06.01 Gaps residuais apos PASS live

- [x] Definir metadata `syncBlockedReason` para timeline divergente.
- [x] Revisar `/context` e `/history` com a semantica de `timeline=mixed/diverged`.
- [x] Garantir redaction de args sensiveis em export quando tool metadata entrar no Markdown.
- [x] Revisar `tool-lifecycle-runtime` para status vivo sem excesso de writes.
- [x] Melhorar resumo de `/tools diag`.
- [x] Exibir `toolCallId` e `requestId` de forma compacta em tools operacionais, nao apenas no
      envelope do export.
- [x] Separar start/progress/done visualmente em tool diagnostics.
- [x] Garantir que texto simulando tool nunca satisfaça criterio de tool real.
- [x] Adicionar correlacao mais clara entre stdout e SSE para pos-ask.
- [x] Atualizar live runner para comparar export contra SSE em termos de eventos correlacionados,
      nao apenas texto.
- [x] Revisar `turn-materialization-state` para cenarios pos-ask alternativos.
- [x] Adicionar teste para turnos separados por ask_user.
- [x] Revisar `/activity` para mostrar transcript humano recente com envelope compacto.
- [x] Revisar `/events` para linkar evento bruto ao transcript/export.
- [x] Revisar `/usage now` para contexto pos-ask e BYOK sem Premium Request.
- [x] Revisar `/health` para indicar inline status mode.
- [x] Parametrizar runner para resposta freeform, choice invalida, tool longa e erro recuperavel sem
      alterar o baseline canonico.
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

- Risco: adicionar ask_user ao transcript pode duplicar pergunta se `question.pending` tambem
  renderizar.
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
- Mudancas em `src/copilot/mcp` feitas para strict devem ser mantidas, mas nao sao foco primario
  desta fase.
- Qualquer nova alteracao em `src/copilot/model-gateway` deve estar ligada ao runner live ou ao
  strict.
- O teste live real usa custo/latencia reais; executar com criterio depois de patches
  significativos.
- Validadores de teste amplo devem ser menos frequentes que testes unitarios focados.
- O strict geral de `src/copilot` deve continuar sendo gate antes de commit.

## 11. Rodada visual pos-live PASS

### 11.01 Evidencia

- [x] Live `long-tool-heartbeat` passou em
      `artifacts/terminal-live/long-tool-heartbeat-human-lifecycle-20260602-0910`.
- [x] Live `long-tool-heartbeat` passou novamente com criterios endurecidos em
      `artifacts/terminal-live/long-tool-heartbeat-human-status-20260602-0920`.
- [x] Live `long-tool-heartbeat` passou com criterio `[EXEC]` obrigatorio em
      `artifacts/terminal-live/long-tool-heartbeat-exec-badge-20260602-0925`.
- [x] O runner validou tool longa real, ask_user real, resposta humana, SSE, export, health compact
      e names humanos de tool.
- [x] A live revelou residuos esteticos que nao quebravam funcionalmente: `tool/Ferramenta em uso`,
      `exec_command` na linha viva, `[INTENT]`, `classe=`/`motivo=` na linha de usage e `/activity`
      com `run · completed · sdk`.
- [x] Esses residuos foram promovidos a contrato de UX em testes unitarios e criterios live.
- [x] A segunda live revelou `exec_command` classificado como `[VER]` quando `cwd` virava alvo;
      corrigido para `[EXEC]`.
- [x] A segunda live revelou `modelo=`/`status=success` em usage/activity padrao; corrigido para
      frase humana.

### 11.02 Contratos novos

- [x] Linha viva deve usar fase humana: `pensando`, `turno`, `ferramenta`, `respondendo`,
      `aguardando operador`.
- [x] Linha viva nao deve exibir `tool/`, `turn/`, `thinking/` ou nome tecnico como `exec_command`.
- [x] Tool longa deve aparecer como `Executar comando`, com duracao e sem id interno.
- [x] Intent deve aparecer como `[INTENÇÃO]`, com `origem ferramenta de intenção`, sem `[INTENT]`,
      `fonte=` ou `report_intent` na superficie padrao.
- [x] Usage BYOK deve aparecer como `Uso BYOK sem Premium Request`, com modelo, custo e tokens,
      deixando `classe` e `motivo` para comandos detalhados.
- [x] `/activity` padrao deve traduzir operacoes e status: `execução`, `leitura`, `concluída`,
      `respondida`, sem `run · completed · sdk`.
- [x] `/activity detail` continua sendo a rota para source, request id, engine e trace completo.

### 11.03 Implementado nesta subrodada

- [x] `live-status-line.js` recebeu labels humanos de fase e humanizacao de tool via
      `getTerminalHumanToolName`.
- [x] `activity.js` recebeu labels humanos para operacao, status, fonte e bytes.
- [x] `intent-renderer.js` e `/intent` passaram para `[INTENÇÃO]` e texto sem `fonte=`.
- [x] `agent-runtime-events.js` separou detail tecnico de detail operador para `llm.usage`.
- [x] `usage.js` removeu pares `modelo=`/`provider=`/`custo=` da vista padrao de `/usage now`.
- [x] `tool-activity-presenter.js` priorizou comandos reais antes de tratar `cwd` como alvo
      inspecionado.
- [x] `activity.js` traduziu status de turn trace, labels de timeline e details de usage para texto
      humano.
- [x] `model-gateway-terminal-llm-b-live-test.mjs` passou a detectar `tool/`, `turn/`, `thinking/`,
      `exec_command` em status vivo e `[INTENT]` antigo.
- [x] `model-gateway-terminal-llm-b-live-test.mjs` passou a exigir `[EXEC] Executar comando` nos
      cenarios de command tool.
- [x] Testes focados passaram: live status, activity, intent, usage e agent runtime events.

### 11.04 Proximas lacunas de UX

- [x] Revisar `/events` padrao para nao parecer despejo JSON quando o operador pede apenas contexto
      recente.
- [x] Revisar `/events` para traduzir status resumido (`status=success`) sem prejudicar
      `/events --raw`.
- [x] Revisar `/live` e `/live full` para separar modo humano, modo diagnostico e modo raw.
- [ ] Revisar `/session`, `/now` e `/status` buscando restos de `source=`, `modelo=`, `classe=`,
      `motivo=` fora de modo detail.
- [ ] Revisar banner e auto-brief para reduzir linhas densas quando o terminal ja esta pronto.
- [ ] Fazer nova live `long-tool-heartbeat` apos criterios endurecidos.
- [ ] Fazer live `recoverable-tool-error` apos consolidar `/activity` humano.
- [ ] Fazer live com `file-write-roundtrip` para confirmar badges `CRIAR`, `MOVER`, `EXCLUIR` e
      ausencia de permissao/ids crus.

### 11.05 `/events` humano

- [x] Modo texto de `/events` passou a mostrar rotulos humanos de evento: `Mensagem da LLM-B`,
      `Pergunta ao operador`, `Resposta do operador`, `Ferramenta`, `Atividade`.
- [x] Modo texto de `/events` passou a traduzir `status=success` para `estado concluido`.
- [x] Modo texto de `/events` passou a ocultar call/request ids por padrao e a exibi-los apenas
      quando o operador filtra por `tool`, `request` ou `hub`.
- [x] Modo texto de `/events` passou a trocar `transcript=`/`export=` por
      `transcript ...`/`export envelope...`.
- [x] `/events --raw` e `/events --json` continuam preservando o envelope bruto para auditoria e
      automacao.
- [x] `test_commands_events.spec.js` cobre o novo contrato humano e preserva raw/json.

### 11.06 `/live full` detalhado, mas humano

- [x] `/live` compacto preserva a tela cotidiana `Fluxo da conversa`, sem `runtime`, `streaming=`,
      `cache/scope` ou `phase:label`.
- [x] `/live full` passou de `Terminal Live Flow` para `Fluxo detalhado da conversa`.
- [x] O modo detalhado continua exibindo runtime, sessão SDK, sinais, conexões, timeline, cache,
      escopo, atividade e trace.
- [x] O modo detalhado deixou de renderizar `streaming=on`, `thinking=off`, `tools=on`, `loop=on`,
      `paused=yes`, `clients=`, `critical=`, `read=123B` e `phase:label`.
- [x] Atividade atual e histórico recente usam rótulos humanos: `pronto`, `turno`, `pensando`,
      `respondendo`, `ferramenta`, `pergunta` e `erro`.
- [x] `Pending messages alteradas` virou `Contexto da conversa atualizado` na camada visual.
- [x] I/O recente passou a usar `concluída/falhou`, operações traduzidas e bytes humanos como
      `1.2 KB lidos`.
- [x] Ferramentas no turno observado usam o apresentador canônico de tool, evitando
      `tool exec_command · run · completed · sdk`.
- [x] Teste escopado `test_commands_session.spec.js` cobre o novo título e bloqueia
      `streaming=`/`phase:` no detalhado.
- [ ] Consolidar helper compartilhado para labels humanos quando `/session`, `/now`, `/status`,
      `/activity` e `/live` tiverem repetição suficiente.
- [ ] Avaliar se `/live raw` deve existir como rota explícita separada, em vez de sobrecarregar
      `full`.

### 11.07 Auto-brief detalhado sem despejo `key=value`

- [x] O auto-brief default já estava compacto, mas o modo `COPILOT_TERMINAL_AUTO_BRIEF=full` ainda
      renderizava `[auto-brief:boot] runtime=... display=... streaming=...`.
- [x] O modo detalhado agora abre com `Briefing detalhado (boot|ready|manual)`.
- [x] Runtime, sinais, BYOK, ferramentas, rota, timeline, I/O, estado e atenção são linhas alinhadas
      por `briefLine`.
- [x] `thinking=on`/`streaming=on` viraram `raciocínio ativo`/`resposta ativo`.
- [x] `byok=ready`, `provider=`, `model=`, `auth=none` viraram frase humana de BYOK.
- [x] `tools=`, `fs=`, `exec=`, `sdkWorkspace=` e `contrato=` viraram `Ferram.`, `arquivos`,
      `terminal`, `workspace SDK` e `contrato`.
- [x] `estado=parcial` virou `Estado parcial`.
- [x] Teste escopado `test_auto_brief.spec.js` bloqueia `runtime=` e `streaming=` no modo detalhado.
- [ ] Avaliar no live se o auto-brief ainda aparece redundante quando o banner inicial e a linha
      viva já cobrem a mesma informação.

### 11.08 Linha viva com sanitizador defensivo final

- [x] `writeInlineStatus` agora normaliza o texto antes de calcular quebras e pintar no TTY.
- [x] Essa normalização é uma última barreira; produtores modernos continuam responsáveis por emitir
      texto humano na origem.
- [x] `LLM-B tool/Executando tool` vira `LLM-B ferramenta · Ferramenta em uso`.
- [x] Prefixos antigos `tool/`, `turn/`, `thinking/` e `streaming/` viram `ferramenta`, `turno`,
      `pensando` e `respondendo`.
- [x] Heartbeat antigo `request_user_input ainda executando` vira
      `Pergunta ao operador aguardando resposta`.
- [x] IDs `chatcmpl-tool-*`, `toolu_*` e `call_*` viram `id interno`.
- [x] Nomes técnicos comuns `exec_command`, `read_file_content` e `report_intent` viram
      `Executar comando`, `Ler arquivo` e `Intent capturado`.
- [x] Teste `test_dialog_output_inline_status.spec.js` deixou de aceitar `tool/Executando tool` como
      saída visual.
- [ ] Fazer live PTY longa para confirmar que a proteção não introduz wrapping ruim em terminais
      estreitos.

### 11.09 `/sdk waits` e `/sdk status` sem resumo interno no padrão

- [x] `/sdk waits` default deixou de renderizar `formulários=`, `permissões=`, `perguntas=` e
      `inputs=`.
- [x] O resumo padrão agora usa frase operacional:
      `1 formulário · 1 permissão · 1 pergunta · 1 input estruturado`.
- [x] `/sdk waits detail` preserva `elicitation=`, `permission=`, `ask_user=` e
      `request_user_input=` para diagnóstico.
- [x] Perguntas pendentes trocaram `choices=` por `opções`.
- [x] `/sdk status` default usa o mesmo resumo humano de esperas, sem `pergunta=0`.
- [x] Teste `test_commands_sdk.spec.js` cobre o padrão humano e preserva detalhe técnico.
- [x] Revisar `/sdk status` para trocar `runtime`, `session`, `model`, `reasoning=` e o bloco de
      quota por um painel compacto humano.
- [x] `/sdk status` agora usa `SDK do Terminal`, `Runtime`, `Sessão`, `Modelo`, `Esperas` e `Quota`.
- [x] A quota compacta troca `restante=`, `reset=` e `escopo=` por
      `91.0% restante · reset ... · escopo ...`.
- [x] Teste bloqueia `reasoning=` e `restante=` na tela compacta.
- [ ] Avaliar se precisamos de `/sdk status detail` explícito ou se `/sdk doctor`, `/sdk quota` e
      `/events --raw` já cobrem a necessidade técnica.

### 11.10 Linha viva de perguntas sem `opções=`

- [x] A linha viva `ASK` e `INPUT` deixou de renderizar `opções=azul|verde`.
- [x] O novo formato é `opções azul|verde`, reduzindo aparência de key-value em interação humana.
- [x] Evento visual de `ask_user SDK solicitado` deixou de gravar `choices=` no detalhe de
      atividade.
- [x] Teste `test_live_status_line.spec.js` bloqueia `opções=` em `ASK` e `INPUT`.
- [x] Teste de registry SDK continua passando após a troca.

### 11.11 Mailbox zero-PR sem `fila=`/`latest=` no padrão

- [x] `/mailbox status` deixou de renderizar `fila=`, `descartadas=` e `runtime=`.
- [x] A linha principal agora diz `N na fila · M descartada(s) · runtime <id>`.
- [x] A intervenção mais recente deixou de renderizar `latest=<id> (source/mode) merges=`.
- [x] O consumo manual deixou de exibir o ID interno da intervenção.
- [x] Confirmações de `/steer`, `/interrupt`, `/queue` e intervenção immediate trocaram `fila=` por
      `N na fila`.
- [x] Aplicação automática via `ask_user` trocou `source/mode`, `merges=` e `fila restante=` por
      frase humana.
- [x] Linha viva trocou `fila=` por `fila N`.
- [x] `node --check src/copilot/terminal/repl/repl-command-router.js` passou.
- [x] Teste `test_live_status_line.spec.js` e registry SDK passaram após a troca.
- [ ] Adicionar teste unitário dedicado para `/mailbox status` se a rota ganhar parser isolável.

### 11.12 `/events` default sem metadados `key=value` no cabeçalho

- [x] O cabeçalho de `/events` default deixou de renderizar `arquivo=`, `eventos=`, `fila=` e
      `filtro=`.
- [x] Filtros explícitos passaram de `tool=call_123`, `request=req-123`, `hub=hub-1` para
      `tool call_123`, `request req-123`, `hub hub-1`.
- [x] Erro do archive passou de `erro=<texto>` para `erro <texto>`.
- [x] `/events --raw` e `/events --json` seguem preservando dados brutos para automação.
- [x] Teste `test_commands_events.spec.js` cobre o novo rodapé humano.

### 11.13 Live PTY curta pós-polimento e ajuste de `/activity`

- [x] Live PTY curta executada com `--ux-cycle`.
- [x] Artefatos:
  - `artifacts/terminal-live/default-ux-cycle-polished-copy-20260602-0950/summary.md`;
  - `artifacts/terminal-live/default-ux-cycle-polished-copy-20260602-0950/default-ux-cycle.plain.log`;
  - `artifacts/terminal-live/default-ux-cycle-polished-copy-20260602-0950/default-ux-cycle.raw.log`.
- [x] Status PASS.
- [x] Critérios passados: ready, help compacto, boot humano, status compacto, now humano, health
      compacto, tools humano, live compacto, activity humano, waits humano e close limpo.
- [x] Achado visual residual: `/activity` timeline ainda podia mostrar `display=full`.
- [x] `compactOperatorDetail` passou a traduzir `display=`, `reasoning=`, `source=` e `choices=`.
- [x] Teste `test_commands_activity.spec.js` cobre `display=full` virando `tela full`.

### 11.14 Live real `long-tool-heartbeat` pós-polimento

- [x] Live real executado:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=long-tool-heartbeat --timeout-ms=240000 --transport=pty --out-dir=artifacts/terminal-live/long-tool-heartbeat-polished-copy-20260602-0955`.
- [x] Artefatos:
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-20260602-0955/summary.md`;
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-20260602-0955/terminal.plain.log`;
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-20260602-0955/terminal.sse.jsonl`;
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-20260602-0955/conversation-export.md`.
- [x] Resultado: FAIL apenas em `sse-archive-query-visible`.
- [x] Causa da falha: runner ainda exigia `arquivo=` depois da humanização de `/events`.
- [x] Runner atualizado para aceitar `arquivo` humano e `arquivo=` legado.
- [x] Achados visuais corrigidos após o live:
  - `Pending messages alteradas` na linha viva virou `Contexto atualizado`;
  - `LLM-B trabalhando` na linha viva virou `Aguardando resposta`;
  - `[ASK] ... opções=1` virou `1 opção(ões)`;
  - `/activity` em interação humana trocou `opções=SIM` por `opções SIM`;
  - prompt de espera humana trocou `opções=` por `opções `;
  - telemetria inline trocou `llm=`, `custo=` e `ctx=` por `LLM`, `custo` e `contexto`;
  - `/usage now` trocou `Binding: runtime=`/`Modo: sdk=` por `Vínculo: runtime`/`Modo: SDK`.
- [x] Testes focados passaram para live status, usage, SDK waits/activity e registry SDK.
- [x] Live real repetido depois dos patches:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=long-tool-heartbeat --timeout-ms=240000 --transport=pty --out-dir=artifacts/terminal-live/long-tool-heartbeat-polished-copy-pass-20260602-1000`.
- [x] Artefatos do PASS:
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-pass-20260602-1000/summary.md`;
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-pass-20260602-1000/terminal.plain.log`;
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-pass-20260602-1000/terminal.sse.jsonl`;
  - `artifacts/terminal-live/long-tool-heartbeat-polished-copy-pass-20260602-1000/conversation-export.md`.
- [x] Resultado: PASS completo, incluindo `/events` durable archive, ask_user, resposta humana,
      SSE/export, no-duplication, no-terminal-errors e close limpo.
- [x] Confirmação visual no terminal real:
  - `/usage now` mostra `Vínculo: runtime ... · SDK ... · hub ...` e `Modo: SDK ... · plano ...`;
  - linha viva mostra `Contexto atualizado` e `Aguardando resposta`;
  - telemetria inline mostra `LLM ... · custo ... · contexto ...`;
  - `ASK` mostra `1 opção(ões)`;
  - `/activity` mostra `opções SIM`;
  - `/events` mostra `arquivo ... · N evento(s) · fila 0 · filtro nenhum`.

### 11.15 `/session sdk`, waits e snapshots com vocabulário humano

- [x] Auditoria pós-commit identificou que `/session sdk`, `/session sdk waits`,
      `/session sdk events`, `/answer --runtime`, snapshots e `/status full` ainda renderizavam
      `profile=`, `provider=`, `model=`, `session fs:`, `metadata local: model=`, `choices=`,
      `perguntas=`, `permission=`, `elicitation=`, `start=` e `modified=`.
- [x] `renderTerminalPreparedByokSelection` e `renderTerminalSdkProviderBinding` foram corrigidos na
      origem para `perfil`, `preset`, `provedor` e `modelo`, evitando duplicação de formatação BYOK.
- [x] Decisão de boot SDK passou de `request=<mode>` para `pedido <modo>` com `criada/retomada`.
- [x] Inventário de sessão SDK passou a mostrar:
  - `arquivos` em vez de `session fs`;
  - `metadados locais: modelo ... · provedor ... · limite ...`;
  - `início ... · alterada ...`;
  - `filtro ... · deslocamento ... · limite ...`.
- [x] `/session sdk waits` passou a mostrar `perguntas`, `formulários`, `permissões`, `pedido`,
      `mensagem`, `resposta` e `N opção(ões)` sem `key=value`.
- [x] `/session sdk events` passou a mostrar `Ciclo de vida SDK` e `Comando SDK executado`, com
      `tipo`, `sessão`, `comando` e `local` em texto humano.
- [x] `/answer --runtime alt` passou a confirmar `runtime alt`, não `runtime=alt`.
- [x] Snapshots passaram a usar `modelo`, `Sessão`, `Envios`, `Conversa`, `Pergunta pendente` e
      `Pergunta restaurada`.
- [x] `/status full` passou a humanizar esperas SDK, display, perfil do modelo, billing divergente e
      agentes customizados.
- [x] Teste focado `test_commands_session.spec.js` passou com 43 testes.
- [ ] Rodar uma live curta de UX para observar `/session sdk`, `/session sdk waits`, `/status full`
      e `/answer` em PTY real.

### 11.16 `/events sources` sem cabeçalho mecânico

- [x] Auditoria pós-11.15 identificou que o mapa de fontes canônicas ainda exibia `janela=`,
      `archive=`, `recentes=`, `owner` e `emitter`.
- [x] Cabeçalho passou para `janela últimos ... eventos · arquivo ...`.
- [x] Rótulos passaram de `owner`/`emitter` para `dono`/`emissor`.
- [x] Contagem passou de `recentes=N` para `recentes N`.
- [x] Hint de evento passou de `/events event=<id> 50` para `/events <id> 50`.
- [x] Parser passou a aceitar `/events source <id>`, `/events trace <id>`, `/events tool <id>`,
      `/events request <id>`, `/events req <id>`, `/events hub <id>` e `/events event <id>` sem
      quebrar compatibilidade com `source=<id>`.

### 11.17 `/model` e `/model stats` como painel cotidiano

- [x] Auditoria identificou que `/model` e `/model stats` ainda renderizavam `cost=`, `speed=`,
      `ctx=`, `reasoning=yes`, `vision=yes`, `preset=`, `provider=`, `model=`, `calls=`,
      `avg_latency=` e `success=`.
- [x] `/model` sem argumentos passou a mostrar `custo`, `velocidade`, `contexto`,
      `capacidades: raciocínio ... · visão ...`.
- [x] Estado BYOK dentro de `/model` passou a mostrar
      `BYOK pronto/incompleto · preset ... · provedor ... · modelo ...`.
- [x] `/model stats` passou a mostrar `chamadas`, `latência média`, `sucesso` e `tokens`.
- [x] Mensagem de BYOK ativo passou a mostrar `preset` e `provedor` sem key-value.
- [x] Mensagem pós-troca de modelo passou a mostrar
      `Capacidades: raciocínio ... · visão ... · contexto ...`.
- [x] `/reasoning` trocou `Reasoning effort`, `Reasoning trocado` e `Raciocínio extendido` por
      `Nível de raciocínio`, `Raciocínio alterado` e `Raciocínio estendido`.

### 11.17.1 `/help` deve ensinar a sintaxe que a UX realmente aceita

- [x] Ajuda de `/events` deixou de sugerir apenas `trace=<id>`/`tool=<id>` e passou a expor
      `trace <id>`/`tool <id>` com filtro humano por `delta`.
- [ ] Auditar demais linhas de ajuda para remover padrões de sintaxe herdados que parecem parâmetros
      internos quando o comando já aceita uma forma humana.

### 11.18 `/thinking` como raciocínio do operador

- [x] Auditoria identificou que `/thinking list/show` ainda renderizava `thinking`, `chars`,
      `fonte=`, `status=` e `chars=`.
- [x] `/thinking list` passou a mostrar `Raciocínio capturado` e `N caracteres`.
- [x] `/thinking show/latest` passou a mostrar `raciocínio`, `fonte ...`, `estado ...`,
      `N caracteres` e `duração ...`.
- [x] Toggle passou a mostrar `Exibição expandida de raciocínio: ativa/inativa`.
- [x] Teste novo `test_commands_thinking.spec.js` bloqueia regressão para `fonte=`, `status=` e
      `chars=`.

### 11.19 `/metrics` sem telemetria com aparência de dump

- [x] Auditoria identificou que `/metrics` ainda renderizava `cfg=`, `provider=`, `modelo=`,
      `pendentes=`, `digest=`, `aceitos=`, `final mismatch=`, `lastId=`, `flush=`, `timeout=`,
      `preflight=`, `dialog=`, `autostart=yes` e `recovery=no`.
- [x] Billing passou a mostrar `configurado ... · cobrado ... · divergente`, com BYOK como
      `provedor ... · modelo ...`.
- [x] Sync Hub passou a mostrar `pendentes`, `agendados`, `gravados`, `falhas`, `retentativas` e
      `cache` sem `key=value`.
- [x] Streaming público passou a mostrar `aceitos`, `normalizados`, `suprimidos`, `divergências`,
      `sem delta` e `vazio`.
- [x] Archive SSE passou a mostrar `último id`, `flush em andamento/agendado/ocioso`, `falhas` e
      `descartados`.
- [x] Inject passou a mostrar `timeout`, `preflight`, `contexto`, `anexos`, `diálogo`,
      `autostart sim/não` e `recuperação sim/não`.
- [x] Teste `test_commands_metrics_usage.spec.js` atualizado para o novo contrato humano de
      `/metrics`, preservando `/usage detail` técnico.

### 11.20 Live curta pós-polimento e `/health` sem falso negativo de ferramentas

- [x] Live curta executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-session-metrics-thinking-20260602-1018`.
- [x] Resultado: PASS completo em help, status, now, health, tools, live, activity, waits e close
      limpo.
- [x] Artefatos:
  - `artifacts/terminal-live/default-ux-cycle-session-metrics-thinking-20260602-1018/summary.md`;
  - `artifacts/terminal-live/default-ux-cycle-session-metrics-thinking-20260602-1018/default-ux-cycle.plain.log`;
  - `artifacts/terminal-live/default-ux-cycle-session-metrics-thinking-20260602-1018/default-ux-cycle.raw.log`.
- [x] Achado visual da live: `/health` dizia `Ferramentas ponte MCP indisponível` mesmo quando o
      terminal anunciava ferramentas locais ativas.
- [x] `readTerminalDiagnoseProjection` passou a expor `toolLoad` mínimo para o renderer compacto.
- [x] `renderCompactMcpLine` passou a mostrar
      `locais ativas · arquivos · terminal/workspace SDK · MCP remoto ausente` quando ferramentas
      locais estão prontas e apenas o MCP remoto falta.
- [x] Teste `test_commands_diagnose.spec.js` bloqueia a regressão para `ponte MCP indisponível`
      nesse caso.
- [x] Live curta repetida após o patch:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-health-local-tools-20260602-1020`.
- [x] Resultado: PASS completo, com `/health` mostrando
      `Ferramentas locais ativas · arquivos · terminal · MCP remoto ausente`.
- [x] Artefatos:
  - `artifacts/terminal-live/default-ux-cycle-health-local-tools-20260602-1020/summary.md`;
  - `artifacts/terminal-live/default-ux-cycle-health-local-tools-20260602-1020/default-ux-cycle.plain.log`;
  - `artifacts/terminal-live/default-ux-cycle-health-local-tools-20260602-1020/default-ux-cycle.raw.log`.

### 11.21 `/tools diag` sem vazamento de IDs crus

- [x] Auditoria identificou que `/tools diag` ainda renderizava `active=`, `tool=`, `call=`, `req=`,
      `calls=`, `blocked=`, `errors=`, `fsCanônico=` e `Tool Contract Verifier`.
- [x] Lifecycle recente passou a mostrar `ativas`, `aguardando operador`, `recentes` e
      `falhas recentes`.
- [x] Linhas de tool em voo/recentes passaram a mostrar `técnico`, `chamada`, `requisição` e `trace`
      como diagnóstico legível, sem `tool=`/`call=`/`req=`.
- [x] Agregados diagnósticos passaram a mostrar `chamadas`, `bloqueios`, `falhas` e `latência`.
- [x] Superfícies de tools passaram a dizer `arquivos locais ativos`, `terminal local ativo`,
      `workspace SDK ausente` e `shell legado não carregado`.
- [x] `Tool Contract Verifier` foi traduzido para `Contrato das ferramentas`, com cobertura em
      português.
- [ ] Fazer live curta com `/tools diag` para verificar alinhamento visual em PTY real após o
      próximo lote de comandos.

### 11.22 Gramática visual, cores e perguntas humanas

- [x] Auditoria visual das screenshots consolidou que LLM-B, operador, thinking, tools, perguntas,
      intents e erros estavam competindo por ciano/verde sem hierarquia clara.
- [x] `ui-theme.js` ganhou papéis explícitos `assistant`, `user` e `system`, separando fala da LLM-B
      e prompt do operador de `success`.
- [x] Tema `elegant` passou de ANSI básico para paleta 256-color: LLM-B em ciano suave, operador em
      verde suave, sistema em lavanda, raciocínio em violeta, tools em azul, perguntas em âmbar,
      warning em laranja e erro em vermelho coral.
- [x] Linha viva trocou `ASK` e `INPUT` por `PERGUNTA`, removendo a aparência de tool interna em
      `request_user_input`.
- [x] Prompt do operador trocou `[ASK:...]`, `[ASK]`, `[REQUEST_USER_INPUT]` e `[INPUT]` por
      `[PERGUNTA:...]` e `[PERGUNTA]`.
- [x] Perguntas renderizadas por eventos SDK passaram a usar badge
      `PERGUNTA`/`PERGUNTA AO OPERADOR`.
- [x] `report_intent`/`report_intent_local` passou a aparecer como `Intenção capturada`, não
      `Intent capturado`.
- [x] `/sdk waits` detail trocou `elicitation=`, `permission=`, `ask_user=` e `request_user_input=`
      por `formulários`, `permissões`, `perguntas SDK` e `perguntas estruturadas`.
- [x] `/sdk waits` e `/sdk simulate request-user-input` passaram a chamar o estado de
      `pergunta estruturada`, não `input estruturado`.
- [x] `/sdk capabilities` removeu `elicitation=true`, `workspace=true`, `confirm=`, `select=`,
      `input=`, `read=`, `write=` e `delete=` da vista do operador.
- [x] `/sdk doctor` removeu `sdk.workspace=`, `local.fs.canonico=`, `tools.list=`,
      `ui.elicitation=`, `ok=`, `errors=` e `coverage(...)`, substituindo por `workspace SDK`,
      `arquivos locais`, `lista tools`, `formulário UI`, `contrato`, `falhas`, `avisos` e
      `cobertura`.
- [x] Auditar `/sdk status`, `/sdk quota`, `/sdk skills` e `/sdk tools` para remover outros dumps de
      capability da vista default.
- [x] `/sdk skills`, `/sdk skills config`, `/sdk skills agents`, `/sdk skills enable/disable` e
      `/sdk tools` passaram a usar `ativas`, `desativadas`, `fontes`, `projeto`, `diretório`,
      `agentes com preload`, `inferíveis`, `preload`, `solicitadas`, `desativadas runtime`,
      `registry local`, `contrato`, `falhas` e `avisos`, sem `enabled=`, `skillDirectories=`,
      `agentsWithPreload=`, `infer=`, `preload=`, `requested=`, `raw=`, `total=`, `fsCanonico=` ou
      `contract: ok=`.
- [x] Live PTY curta executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-visual-grammar-palette-20260602-1320`.
- [x] Resultado: PASS completo em help, status, now, health, tools, live, activity, waits e close
      limpo.
- [x] Achado visual da live: banner/boot ainda usavam ANSI fixo ciano/amarelo, fora do tema central.
- [x] Banner compacto passou a usar `terminalThemeText` e o papel `command`, respeitando
      `elegant/vivid/mono`.
- [x] `/help` compacto passou a usar `terminalThemeText('assistant'|'command'|'muted')`, removendo
      ciano/amarelo fixos da tela mais comum de descoberta.
- [x] Prompt inicial trocou `[NOLOOP]`/`[NL]` por `[STANDBY]`/`[STBY]`, removendo sigla interna da
      primeira tela.
- [x] Linha viva de pergunta pendente deixou de exibir `loop`/`noloop` e passou a mostrar
      `conversa ativa`/`standby`.
- [x] Fallback de status da linha viva deixou de renderizar `status:loop` e passou a usar
      `status · conversa ativa/standby`.
- [x] Papel `command` deixou de ser apenas dim e passou a usar âmbar no tema `elegant`, para
      comandos ficarem escaneáveis sem competir com tools/perguntas.
- [x] Renderer de lifecycle ganhou caminho especial para `operation === 'ask'`: imprime cartão
      simples `[PERGUNTA]`, texto da pergunta e ação `/answer <texto>`, sem nome de tool nem ID.
- [x] Teste de lifecycle garante que `request_user_input` não aparece como tool genérica, não vaza
      `chatcmpl-tool-*` e mostra a ação de resposta.
- [x] Runner `--structured-input-cycle` foi atualizado para o contrato novo `[PERGUNTA]`/`[PERG]`,
      `pergunta estruturada` e ausência de `input=`.
- [x] Live PTY estruturada executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-visual-card-pass-20260602-1331`.
- [x] Resultado: PASS completo, sem ID interno, sem `request_user_input ainda executando`, com
      resposta humana roteada e `/sdk waits` limpando a pendência.
- [x] `/sdk simulate request-user-input` passou a mostrar `Pergunta humana estruturada` e usar tema
      central em título/status/ação.
- [x] `/sdk waits` passou a usar `Esperas humanas` temático, `ação` com acento e comandos coloridos
      por papel `command`.
- [ ] Avaliar se o cartão de pergunta deve ganhar moldura discreta multi-linha; a live atual mostra
      formato limpo, mas ainda sem uma “caixa” visual dedicada.

### 11.23 Headers default integrados ao tema

- [x] Auditoria pós-live identificou que `/status`, `/live`, `/activity` e `/health` ainda usavam
      headers ciano fixos em telas default.
- [x] `/status` compacto passou a usar `terminalThemeText('assistant', 'Status do Terminal LLM-B')`.
- [x] `/live` compacto passou a usar `terminalThemeText('assistant', 'Fluxo da conversa')`.
- [x] `/activity` default passou a usar
      `terminalThemeText('assistant', 'Atividade Atual da LLM-B')`.
- [x] `/health` compacto passou a usar `terminalThemeText('assistant', 'Saúde do Terminal LLM-B')`.
- [x] Testes bloqueiam regressão para `\x1b[36m...` nesses headers default.
- [x] Live UX cycle pós-headers executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-themed-default-surfaces-20260602-1338`.
- [x] Resultado: PASS completo em help, status, now, health, tools, live, activity, waits e close
      limpo.
- [x] Achado da live: `/now` ainda usava `[agora]` em ciano fixo e `/activity` ainda usava
      `Timeline recente` em ciano fixo.
- [x] `/now` default passou a usar badge `[agora]` via `terminalThemeText('assistant'|'muted')`.
- [x] `Timeline recente` passou a usar `terminalThemeText('assistant')`.

### 11.24 Fluxo canônico e timestamps ISO 8601

- [x] Auditar fluxo visual completo do terminal: prompt do operador, LLM-B pensando, tools em
      início/progresso/conclusão, deltas parciais, delta final, intenção capturada, pergunta ao
      operador, resposta humana e pós-pergunta.
- [x] Criar helpers centrais para timestamp humano em ISO 8601 completo com timezone local
      explícito, evitando `HH:mm:ss` solto em superfícies operacionais importantes.
- [x] Definir política de densidade: ISO completo em eventos persistentes/timeline; idade relativa
      em linha viva; horário curto só quando explicitamente compacto.
- [x] `/activity` passou a usar timestamp ISO completo em streaming público, I/O real e timeline
      recente.
- [x] `turn-display.js` passou a usar timestamp ISO completo nos blocos duráveis de thinking e
      streaming da LLM-B.
- [x] `/session`, `/history`, `/db-history`, `/db-sessions`, `/session sdk events`,
      `/session sdk waits`, `/events`, `/intent`, `/errors`, `/audit`, `/resume`, `/memory`,
      `/search`, `/export`, `/plan`, `/context`, `/sdk permission`, `/index` e display LLM-A
      passaram a usar o helper ISO quando exibem datas operacionais.
- [x] Testes escopados bloqueiam regressão para `[HH:mm:ss]` em `/activity` e no display vivo de
      streaming.
- [ ] Padronizar prefixos visuais do fluxo: `você`, `LLM-B`, `pensando`, `tool`, `intenção`,
      `pergunta`, `resposta`, `sistema`.
- [ ] Garantir que deltas parciais e finais não misturem cor/label de sucesso com identidade da
      LLM-B.
- [ ] Auditar `assistant-transcript-renderer.js`, `task-stream-events.js`,
      `tool-lifecycle-runtime.js`, `intent-renderer.js`, `sdk-session-events.js`, `/session`,
      `/activity` e `/events`.
- [ ] Fazer live real com turno contendo thinking, tool, intent e ask_user para observar o fluxo
      completo como o operador humano vê.

### 11.25 Terminal base sem dumps `key=value`

- [x] `/permission cockpit` virou `Permissões SDK`, com `recente`, `requisição`, `mudanças de modo`
      e `atalhos` em vez de `latest`, `requestId=`, `mode log` e `quick`.
- [x] `/elicitation show` virou `Formulário SDK`, com `estado`, `modo`, `origem`, `ação`,
      `resultado` e `conteúdo da resposta`.
- [x] `/permission show` passou a usar `estado`, `tipo`, `requisição`, `aprovação`, `resultado`,
      `criada` e `concluída`, com timestamps ISO centralizados.
- [x] `/status full` trocou `input estruturado` por `pergunta estruturada` e limpou cache/escopo de
      I/O para frase humana.
- [x] `/index status/search/symbol` trocou `files=`, `latest=` e `matches=` por `arquivos`,
      `última indexação` e `resultados`.
- [x] `/scope declare/context/find/refresh/close/list` trocou `files=`, `parsed=`, `matches=` e
      `refreshed=` por `arquivos`, `analisados`, `resultados` e `atualizados`.
- [x] `/fs` trocou `io=`, `engine=` e `matches=` por `I/O`, `motor` e `resultados`.
- [x] Testes escopados protegem `/fs`, `/index`, `/scope`, `/session`, `/sdk`, `/activity`,
      `/events`, `/intent`, `/export` e `turn-display`.
- [x] Live PTY curta executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-iso-humanized-base-surfaces-20260602-1357`.
- [x] Resultado: PASS completo em help, status, now, health, tools, live, activity, waits e close
      limpo.
- [x] Evidência visual: `/activity` no PTY real passou a renderizar `2026-06-02T13:57:43.907-03:00`
      com offset local explícito.
- [x] Reduzir densidade visual de `/now`: a live mostrou `[agora]` repetido em todas as linhas; a
      informação virou painel com cabeçalho único `Agora`.
- [x] Runner `--ux-cycle` atualizado para reconhecer o novo painel `/now`, sem depender de
      `[agora]`.
- [x] Live PTY curta executada após o ajuste:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-now-panel-pass-20260602-1402`.
- [x] Resultado: PASS completo, com `/now` renderizando `Agora`, `Conversa`, `Entrada`, `Modelo`,
      `Catálogo` e `Atividade` sem `key=value`.
- [x] Auditar `/byok` default, que ainda contém blocos diagnósticos extensos com `rows=`, `latest=`,
      `store=`, `postRuntimeProfiles=`, `tracePersisted=`, `source=`, `freshness=` e afins.
- [x] `/byok status` passou a renderizar `Estado`, `Perfil`, `Provider`, `Modelo`, `Autenticação`,
      `Capacidades`, `Limites`, `Gateway`, `Preparada` e `Sessão viva`, removendo `enabled:`,
      `apiKey=`, `bearer=`, `reasoning=`, `source=` e `providers=` da superfície default.
- [x] `/byok gateway operator-ready` passou a usar `perfil`, `checagens`, `sem chamada provider`,
      `política`, `ação`, `banco standby`, `banco live`, `estado` e `resumo`.
- [x] `/byok auto doctor` passou a usar `perfil`, `snapshot ativo`, `política`, `origem policy`,
      `decisão`, `ação`, `rota`, `reset` e `nova tentativa`, sem `profile=`, `activeSnapshot=`,
      `policy source:` ou `reset=`.
- [x] `/byok gateway selection audit effective` passou a usar `modo`, `sem runtime`, `persistido`,
      `perfis`, `health observado`, `pós-runtime perfis`, `comparação mudou`, `policy`,
      `seletor runtime` e `trace persistido`.
- [x] Teste BYOK completo passou com 105 testes após as mudanças de UX.
- [x] `/byok gateway catalog refresh`, `refresh-plan`, `refresh-log`, `diff`, `eligibility runs`,
      `eligibility diff` e `integrity` trocaram `store=`, `selector=`, `selected=`, `events=`,
      `diff added=`, `write=`, `rows=` e `redactedIdentities=` por rótulos humanos.
- [x] `/byok gateway importers`, `providers endpoints`, `provider traits`, `gateway local`,
      `probes matrix`, `probes backoff`, `secrets/env`, `pre-K gate`, `prebuild` e `commands`
      passaram a mostrar filtros, contagens, política local/Ollama e readiness sem cabeçalhos de
      telemetria bruta.
- [x] `/byok gateway search`, `routes`, `overlays`, `accounts`, `limits`, `quota-matrix`,
      `conflicts` e `freshness` passaram a usar `Catálogo`, `filtro`, `rotas`, `overlays`,
      `segredos`, `estado`, `reset`, `próxima ação`, `Tipos de quota` e `fontes` em vez de `store=`,
      `query=`, `provider=`, `status=`, `reset=`, `next=` e afins.
- [x] `/sdk quota` default passou a usar a mesma frase humana do modo compacto, com
      `91.0% restante · reset ... · escopo ...`, e teste bloqueia `restante=`, `reset=` e `escopo=`.
- [x] Testes escopados passaram para BYOK e SDK após o lote: `test_commands_byok.spec.js` e
      `test_commands_sdk.spec.js`.
- [x] `/byok gateway sqlite`, `gateway health sqlite`, `gateway openai`, `catalog explain`,
      `provider explain` e seleção efetiva passaram a usar `JSON`, `SQLite`, `fonte`, `projeções`,
      `rotas`, `overlays`, `paridade`, `modelo provider`, `health runtime`, `probes runtime`,
      `metadados`, `próxima ação` e `comparação`, sem `json=`, `sqlite=`, `source=`,
      `providerModel=`, `runtimeHealth=`, `next=` ou `compare=`.
- [x] `/byok auto status`, `auto proof-plan`, `auto standby`, `auto standby persisted`,
      `auto history`, `auto handoffs`, `auto recovery fixture`, `auto on` e `auto policy` passaram a
      remover `profile=`, `runtimeSelector=`, `liveSetModel=`, `providerCall=nao`, `routes=`,
      `status=`, `model=`, `route=` e `action=` do modo default.
- [x] `/byok gateway eligibility`, `/byok probe`, `/byok providers`, `/byok profiles`,
      `/byok models`, `/byok recommend` e `/byok probe shortlist` passaram a usar tags humanas
      (`contexto`, `max req`, `provider`, `perfil`, `fonte`, `filtros`, `hint gratuito`, `deltas`,
      `tool calls`, `fixture`) em vez de `ctx=`, `maxReq=`, `provider=`, `profile=`, `fonte=`,
      `filtros=`, `freeHint=`, `deltas=`, `toolCalls=` e `fixture=`.
- [x] Teste BYOK completo passou novamente com 105 testes após o segundo sublote.
- [x] Live PTY curta executada após o polish BYOK/SDK:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-byok-polish-cycle-20260602-1440`.
- [x] Resultado: PASS completo em help, status, now, health, tools, live, activity, waits e close
      limpo; evidência em `artifacts/terminal-live/ux-byok-polish-cycle-20260602-1440/summary.md`.
- [x] `/status full` limpou `ok=`, `skipped=`, `failed=`, `timeout=`, `pref=`, `disabled=`,
      `sdk prompts=`, `fsCanônico=`, `execCanônico=`, `sdkWorkspace=`, `legacyShellLoaded=`,
      `errors=`, `warnings=`, `sections=`, `missingSectionFile=` e `persistidos=` em favor de
      rótulos humanos.
- [x] `/now full` deixou de ser uma linha bruta `[now] runtime=... live=... PM:... gateway=...` e
      passou a renderizar painel `Agora - Detalhe` com `Runtime`, `Conversa`, `Entrada`, `Timeline`,
      `SSE`, `Modelo`, `Catálogo`, `Atividade` e `Próximo`.
- [x] `/usage now` e `/usage now detail` trocaram `cfg=`, `cobrado=`, `modelo=`, `tipo=`, `classe=`,
      `motivo=`, `custo=`, `Binding: runtime=`, `sdk=` e `planFile=` por `configurado`, `cobrado`,
      `modelo`, `tipo`, `classe`, `motivo`, `custo`, `Vínculo`, `SDK` e `plano`.
- [x] Testes escopados passaram após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`.
- [x] `/diagnose full` passou a usar `prompts SDK`, `preset`, `provedor`, `modelo`, `auth`,
      `habilitados`, `ativo`, `mais antigo`, `média`, `raciocínio`, `uso`, `intenção` e `origem`,
      removendo `sdk prompts=`, `provider=`, `model=`, `providers=`, `enabled=`, `active=`,
      `oldest=`, `boot=`, `shutdown=`, `thinking=`, `usage=`, `intent=` e `source=` do painel
      visual.
- [x] Teste escopado passou após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.
- [x] `/index build` passou a mostrar `Resultado`, `Limpeza` e `Workspace`, removendo `gitignore=`,
      `prune=`, `scanned=`, `candidates=`, `indexed=`, `unchanged=`, `skipped=`, `pruned=`,
      `failed=`, `workspaceRoot=` e `duration=` da saída humana.
- [x] `/index status` passou a renderizar disponibilidade como `sim`/`não`, sem boolean cru
      `true`/`false`.
- [x] Teste escopado passou após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_index.spec.js`.
- [x] `/scope declare` passou a usar `diretório`, `símbolos`, `recursivo`, `limite` e
      `concorrência`, removendo `dir=`, `parseSymbols=`, `recursive=`, `maxFiles=` e `concurrency=`
      da saída humana.
- [x] Teste escopado passou após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_scope.spec.js`.
- [x] `/sdk prompt` passou a usar `modo`, `live`, `reload`, `auto reload`, `customize`,
      `sources RPC`, `seções`, `anexos`, `fontes`, `defasado` e `ação`, removendo `live=`,
      `autoReload=`, `customize=`, `sourcesRpc=`, `sections=`, `appendFiles=`, `sources=`, `stale=`
      e `action=` do status visual.
- [x] Teste escopado passou após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
- [x] `/permission mode` passou a renderizar `Modo de permissões` e `prompts SDK`, removendo
      `Permission mode` e `sdk prompts=` da superfície humana.
- [x] Teste escopado passou novamente após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
- [x] Tags centrais de saúde BYOK passaram de `chat=ok(...)`, `chat=failed(...)`, `agent=ok(...)`,
      `capabilities=...`, `protocol=...` e `probes=...` para `chat ok (...)`, `chat falhou (...)`,
      `agente ok (...)`, `capacidades ...`, `protocolo ...` e `probes ...`.
- [x] `/byok health` passou a renderizar `persistência`, `arquivo`, `carregado`,
      `alterações pendentes`, `provider`, `modelo`, `perfil`, `contexto`, `limite/falha`, `tipo`,
      `retry após`, `reset`, `último erro agente` e `contexto agente`, removendo `persist=`,
      `dirty=`, `providerId=`, `providerModel=`, `routeProfile=`, `contexto=`, `limite/falha=`,
      `kind=`, `retryAfter=` e `resetAt=`.
- [x] Teste BYOK completo passou após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js` (105 testes).
- [x] `/byok auto confirmations` trocou `at=` por `observado`, preservando o modelo anterior e o
      confirmado.
- [x] `/byok auto recoveries` trocou `scope=`, `failure=`, `route=` e `at=` por `escopo`, `falha`,
      `rota` e `observado`.
- [x] `/byok auto recovery-fixture` trocou `decision: action=`, `effects: applied=`, `recorded=`,
      `route=` e `sqlite=` por `decisão`, `ação`, `efeitos`, `aplicados`, `pulados`, `persistidos`,
      `registrado`, `rota` e `SQLite`.
- [x] `/byok gateway operator-ready` trocou detalhes `selected=`, `action=`, `routes=`,
      `providers=`, `session=` e `current=` por `selecionados`, `ação`, `rotas`, `provedores`,
      `sessão` e `atual`.
- [x] `/byok auto status` trocou `usable=`, `providers=`, `decisions=`, `policySnapshots=`,
      `effects=`, `recoveries=`, `handoffs=`, `confirmations=`, `liveRuns=`, `session=` e `live=`
      por `usáveis`, `provedores`, `decisões`, `policy snapshots`, `efeitos`, `recoveries`,
      `handoffs`, `confirmações`, `live runs`, `sessão` e `live`.
- [x] Teste BYOK completo passou novamente após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js` (105 testes).
- [x] `/byok providers` trocou o cabeçalho `ativo=`, `prontos=` e `presets=` por `ativo`, `prontos`
      e `presets`, com contagem de presets legível.
- [x] `/byok models grouped` e `/byok recommend grouped` trocaram `variants=` por `variantes`, com
      separação visual `|` entre perfis/provedores.
- [x] Teste BYOK completo passou novamente após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js` (105 testes).
- [x] Auto-brief detalhado de boot trocou `hit=`, `l2=`, `files=`, `scopes=` e `off:<reason>` por
      `acerto`, `L2`, `arquivos`, `escopos` e `off · motivo`, melhorando o primeiro viewport do
      terminal.
- [x] Teste escopado passou após esse lote:
      `npx vitest run tests/unit/copilot/terminal/test_auto_brief.spec.js`.
- [x] Roteador REPL trocou `messageId=`, `reason=` e `status=` nas superfícies `/steer` e `/handoff`
      por `mensagem`, `motivo` e `status`.
- [x] Live PTY curta executada após os lotes de UX operacional:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-polished-ops-cycle-20260602-1506`.
- [x] Resultado: PASS completo em help, boot copy, status, now, health, tools, live, activity, waits
      e close limpo; evidência em
      `artifacts/terminal-live/ux-polished-ops-cycle-20260602-1506/summary.md`.
- [x] Achado residual live resolvido: `/health` Gateway compacto passou de `provider:model@provider`
      para `provider · model`, mantendo detalhes técnicos em superfícies de detail.
- [x] Achado residual live resolvido: `/live` default passou de `SSE 0/0` para `SSE sem clientes`,
      mantendo contadores no detail.
- [x] Live PTY curta repetida após os achados residuais:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-polished-ops-cycle-20260602-1510`.
- [x] Resultado: PASS completo; `/health` exibiu `kilo-code · kilo-auto/free` e `/live` exibiu
      `SSE sem clientes`.
- [x] Achado extra da segunda live resolvido: `/now` também passou a compactar o modelo ativo do
      catálogo como `provider · model`, sem `provider:model`.
- [x] Live PTY curta final executada após corrigir `/now`:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-polished-ops-cycle-20260602-1513`.
- [x] Resultado: PASS completo; `/now` exibiu `ativo kilo-code · kilo-auto/free`, `/health` exibiu
      `kilo-code · kilo-auto/free` e `/live` exibiu `SSE sem clientes`.
- [x] `agent-runtime-events.js` passou a renderizar uso/PR, lifecycle SDK, comandos SDK, shell,
      background tasks e erros BYOK com rótulos humanos.
- [x] Detalhes de runtime trocaram `modeloCfg=`, `modeloEfetivo=`, `modeloCobrado=`, `custo=`,
      `classe=`, `motivo=`, `provider=`, `perfil=`, `modelo=`, `status=`, `exit=`, `session=`,
      `local=`, `args=` e `[query]` por `modelo configurado`, `modelo efetivo`, `modelo cobrado`,
      `custo`, `classe`, `motivo`, `provider`, `perfil`, `modelo`, `concluído`, `saída`, `sessão`,
      `comando local`, `argumentos` e `Erro de consulta`.
- [x] `sdk-session-events.js` passou a renderizar ids de interação como `pedido ...`, usando
      compactação e sem `requestId=`/parenteses crus na UX default.
- [x] Sidechannels SDK passaram a trocar `permission.mode_changed`, `audit_only`,
      `choice/protocolo`, `freeform`, `ui.elicitation=true`, `snapshot.ui.elicitation=true`,
      `oauth.login`, `sample-1`, `auto-1` e `exit_plan_mode solicitado` por `Modo de permissão`,
      `auditoria sem prompts`, `escolha estruturada`, `resposta livre`, `elicitation ativada`,
      `snapshot com elicitation`, `Login OAuth MCP`, `pedido ...` e `Saída do plan mode solicitada`.
- [x] `tool-lifecycle-runtime.js` passou a apresentar `tool.user_requested` e integrações externas
      com `pedido ...`, sem request ids crus no texto humano.
- [x] `terminal-agent-wiring.js` trocou `status=` por `estado` no pré-stall watchdog.
- [x] `dialog/engine.js` trocou o erro BYOK de turno de `perfil=`/`provider=`/`modelo=` para
      `perfil`/`provider`/`modelo`, preservando a mensagem operacional de sem Premium Request.
- [x] Aviso de catálogo configurado BYOK fora do catálogo remoto trocou `perfil=`/`provider=` por
      `perfil`/`provider`.
- [x] Testes escopados passaram após o lote:
  - `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js`.
- [x] Live PTY curta executada após o polish de runtime/sidechannels:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=45000 --transport=pty --out-dir=artifacts/terminal-live/ux-runtime-sidechannels-polish-20260602-1532`.
- [x] Resultado: PASS completo; `/now`, `/health`, `/live`, `/activity` e `/sdk waits` permaneceram
      humanos, com timestamps ISO e sem telemetria `key=value` na superfície default.

### 11.26 Seleção automática e troca de modelo como fluxo humano

- [x] Auditoria nova consolidou que `/model`, `session.model_changed` e `/byok auto` ainda
      misturavam intenção do operador, decisão pré-runtime, efeito preparado e confirmação efetiva
      em linguagem técnica.
- [x] `session.model_changed` passou a registrar atividade como
      `de <modelo anterior> para <modelo novo> · raciocínio <nível>`, preservando o evento bruto
      apenas em SSE/export.
- [x] Narração verbose de troca de modelo passou de `Modelo SDK: ...` para `SDK confirmou ...`,
      deixando claro que a confirmação vem do SDK/uso observado, não apenas do pedido local.
- [x] `/model` em modo auto passou a explicar `autoridade GitHub Copilot`,
      `preferência local ... (observável)` e `último efetivo ...`, sem `autoridade=`,
      `preferência local=` ou `último efetivo=`.
- [x] Mensagem de ajuste de raciocínio passou de `Reasoning ajustado` para `Raciocínio ajustado`,
      com texto compatível com operador humano.
- [x] BYOK boundary hint passou a falar `trocar provider/perfil`, `reinicia só a conversa` e
      `trocar o modelo na sessão viva`, sem `rebind`, `dialog loop`, `bound` ou `setModel` na tela
      default.
- [x] `/byok auto status` passou a usar `troca viva`, `sessão viva`, `sem ação`, `bloqueios`,
      `persistência`, `efeitos ... executar/simular` e `próximo`, removendo `live setModel`,
      `live switch`, `nao-acao`, `blockers`, `decision(s)`, `:dry` e `proximo`.
- [x] Fallback auto passou a narrar `origem ... · motivo ...`, sem `from=`/`reason=`.
- [x] `/byok auto on`, `auto policy`, `auto doctor` e `gateway operator-ready` passaram a usar
      `troca viva`, `nova sessão`, `perfis`, `conta`, `registros`, `sessão viva`, `bloqueios`,
      `avisos` e `próximo`.
- [x] `/byok gateway selection audit` passou a chamar o arquivo canônico de `catálogo`, e traces
      passaram a dizer `mais recente`.
- [x] `/byok probe shortlist` passou a encerrar como `aprovados N/N · providers tentados N/N`, sem
      `ok=N/N` ou `providerTentado=`.
- [x] `/byok status` passou a usar `Modelo gateway`, `Fronteira` e `Vínculo vivo`, removendo labels
      visuais `gatewayModel:`, `boundary:` e `live binding:`.
- [x] Mensagens de health passaram de `BYOK operational health` para `Saúde operacional BYOK`,
      inclusive no clear global e escopado.
- [x] Probes e shortlist passaram a falar `conversa viva`, sem `dialog loop` na tela default.
- [x] Tags de modalidades passaram de `in=text+image` para `entrada text+image`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/terminal/test_commands_config_errors.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
    (137 testes).
- [x] Teste BYOK completo passou após a limpeza residual:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js` (105 testes).
- [x] Runner live `--auto-probe` foi corrigido para usar uma lista real de comandos e sequência
      temporizada no PTY, evitando travar em comandos que não redesenham prompt de modo detectável.
- [x] Runner live `--auto-probe` passou a validar a nova linguagem humana de auto/BYOK e reprovar
      `providerCall=nao`, `liveSetModel=`, `runtimeSelector=`, `action=`, `ledgers:`, `from=`,
      `reason=`, `live setModel` e `Modelo SDK:`.
- [x] Live PTY dedicada a seleção/automação de modelo executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --auto-probe --timeout-ms=110000 --transport=pty --out-dir=artifacts/terminal-live/ux-auto-model-selection-cycle-20260602-1554`.
- [x] Resultado: PASS completo;
      `/byok auto policy/status/doctor/explain/history/handoffs/confirmations/proof-plan/standby/recovery-fixture/recoveries`
      renderizaram sem turno LLM, sem chamada provider e sem key-value bruto na superfície default.
- [x] Achado da live corrigido: `/activity` de boot trocou
      `Inicializando dialog loop`/`Conectando ao dialog loop` por
      `Inicializando conversa`/`Conectando conversa`.
- [x] Achado da live corrigido: `/session sdk` trocou `/restart reinicia só dialog loop` por
      `/restart reinicia só a conversa`.
- [x] Achado da live corrigido: `/events` resumido passou a renderizar `dialog.loop.changed`,
      `terminal.runtime.wired`, `terminal.started` e `quota.warning` como `Conversa alterada`,
      `Runtime pronto`, `Terminal iniciado` e `Aviso de quota`.
- [x] Testes escopados passaram após esses achados:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`
    (161 testes).
- [x] Live PTY `--auto-probe` repetida após correção da timeline/event labels:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --auto-probe --timeout-ms=110000 --transport=pty --out-dir=artifacts/terminal-live/ux-auto-model-selection-cycle-20260602-1558`.
- [x] Resultado: PASS completo; `/activity` mostrou `Conectando conversa`, `/events` resumido
      mostrou `Runtime pronto`, `Terminal iniciado`, `Conversa alterada` e `Aviso de quota`. O único
      `dialog loop` restante apareceu apenas no JSON bruto de `/events --raw`.
- [x] Criar/rodar live PTY dedicada a `/model auto`, `/model <id>` e confirmação
      `session.model_changed`, separada do ciclo BYOK auto.
- [x] Runner live ganhou `--model-probe`, que desliga BYOK no ambiente do cenário, não abre turno
      LLM e exercita `/model`, `/model stats`, `/model auto`, `/model gpt-4.1-mini`, `/activity`,
      `/events`, `/events --raw` e `/errors`.
- [x] Live PTY dedicada a model switching executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --model-probe --timeout-ms=90000 --transport=pty --out-dir=artifacts/terminal-live/ux-model-switch-cycle-20260602-1616`.
- [x] Achado da live corrigido: `/events` resumido trocou `session model changed`,
      `session skills loaded` e `session info` por `Modelo alterado`, `Skills carregadas` e
      `Info da sessão`.
- [x] Achado da live corrigido: activity/status line de confirmação SDK trocou `Modelo SDK alterado`
      por `Modelo confirmado`.
- [x] Live PTY `--model-probe` repetida após correção:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --model-probe --timeout-ms=90000 --transport=pty --out-dir=artifacts/terminal-live/ux-model-switch-cycle-20260602-1620`.
- [x] Resultado: PASS completo; `/model auto`, `/model gpt-4.1-mini`, `SDK confirmou ...`,
      `/activity` e `/events` ficaram humanos, com `session.model_changed` preservado apenas no
      SSE/JSON bruto.
- [ ] Avaliar se o operador precisa de um painel único “Modelo solicitado x modelo efetivo” em
      `/now` ou `/status`, para reduzir ambiguidade entre pedido local, seleção BYOK e confirmação
      SDK.
- [x] `/usage now` default reduziu densidade de vínculo: `runtime ... · SDK ... · hub ...` virou
      `runtime, SDK e hub conectados`; IDs ficaram em `/usage now detail`.
- [x] `/usage now` trocou `GitHub Copilot quota/PR side-channel` por `Quota Copilot observada`,
      preservando a distinção de BYOK como não-cobrança BYOK.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js` (8 testes).
- [x] Live PTY `--auto-probe` repetida após limpeza de `/usage now`:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --auto-probe --timeout-ms=110000 --transport=pty --out-dir=artifacts/terminal-live/ux-auto-model-selection-cycle-20260602-1600`.
- [x] Resultado: PASS completo; `/usage now` mostrou
      `Vínculo: runtime, SDK e hub conectados · IDs em /usage now detail`, sem `side-channel` e sem
      IDs compactos no default.
- [x] Achado da live corrigido: evento bruto inicial `Inicializando conversation hub` passou a
      registrar `Inicializando hub da conversa`.
- [x] `/help full`, `/status full`, `/now full`, `/health`, `/diagnose`, `/restart`,
      `/emergency-reset`, `/dialog-pause`, `/dialog-resume`, `requestHeaders`, watchdog e recovery
      passaram a falar `conversa`/`conversa viva`, removendo `dialog loop`/`loop ativo` da
      superfície humana.
- [x] Testes foram reforçados para reprovar `loop inativo`, `loop ativo`, `loop parado`,
      `dialog loop` e `Boot do dialog loop...` nos painéis humanos tocados.
- [x] Live PTY `--auto-probe` repetida após a limpeza de vocabulário:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --auto-probe --timeout-ms=110000 --transport=pty --out-dir=artifacts/terminal-live/ux-auto-model-selection-cycle-20260602-1608`.
- [x] Resultado: PASS completo; `/activity` e `/events` mostraram `Inicializando hub da conversa`,
      `Conectando conversa`, `Conversa alterada`, `Aviso de quota` e `/usage now` humano. Os únicos
      `dialog loop` restantes na live ficaram em JSON bruto/internal background descriptions.
- [x] `/byok auto policy` passou a renderizar nomes humanos de preset (`auto: mesma fronteira`,
      `auto: preparar nova sessão`) antes do identificador técnico copiável, removendo a linha
      visual `auto_same_boundary: ...`.
- [ ] Auditar `/byok persist` e os helpers de health tags restantes para separar default humano de
      detalhe técnico.
- [ ] Separar explicitamente “tela default humana” de “detail/raw diagnóstico” nos comandos BYOK,
      sem perder automação e rastreabilidade.

### 11.27 Pergunta humana sem vazamento de taxonomia SDK

- [x] Auditoria das screenshots confirmou que o pior ruído visual restante vem quando a pergunta
      humana é narrada como tool:
  - `request_user_input ainda executando`;
  - `ask_user SDK solicitado`;
  - `chatcmpl-tool-*`;
  - linhas duráveis de espera competindo com a linha viva;
  - pergunta aparecendo como mais uma operação técnica, não como bloqueio humano.
- [x] Decisão canônica:
  - `ask_user` e `request_user_input` continuam preservados no SSE/archive/export bruto;
  - a superfície default deve falar apenas em `Pergunta ao operador`, `Resposta do operador` e
    `pergunta humana/formulário pendente`;
  - request/call ids ficam reservados para `/events --raw`, `/sdk waits detail`, `/activity detail`,
    export e diagnósticos explícitos;
  - a linha viva deve ser a única região de espera contínua, sem repetir heartbeat durável para
    pergunta humana.
- [x] `sdk-session-events.js` passou a gravar activity de `user_input.requested` como
      `Pergunta ao operador`, não `ask_user SDK solicitado`.
- [x] `sdk-session-events.js` passou a gravar activity de `user_input.completed` como
      `Resposta do operador`, sem request id no detalhe default.
- [x] `agent-runtime-events.js` trocou a reconciliação silenciosa de `question.pending` por
      `Pergunta ao operador reconciliada`.
- [x] `dialog/engine.js` trocou o erro de turno vazio de `sem ask_user/elicitation pendente` para
      `sem pergunta humana ou formulário pendente`.
- [x] O runner live reforçou os critérios para reprovar `request_user_input ainda executando`,
      `LLM-B ainda trabalhando`, `chatcmpl-tool-*` e `ask_user SDK` na superfície default.
- [x] Testes de runtime passaram a bloquear regressão textual para `ask_user SDK solicitado`,
      `ask_user SDK respondido`, `question.pending reconciliado pelo ask_user SDK` e
      `sem ask_user/elicitation pendente`.
- [x] Rodar live PTY `--structured-input-cycle` novamente após este lote e verificar visualmente o
      mesmo terminal que o operador humano vê.
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-human-taxonomy-20260602-1622`.
- [x] Resultado: PASS completo; `Pergunta humana estruturada`, prompt `[PERG]`, `/sdk waits` humano,
      resposta roteada, nenhuma ocorrência default de `request_user_input ainda executando`,
      `LLM-B ainda trabalhando`, `chatcmpl-tool-*` ou `ask_user SDK`.
- [x] Rodar live PTY com turno real contendo `ask_user` SDK após este lote para confirmar que o
      fluxo completo continua humano e sem regressão de export/SSE.
  - Primeira tentativa:
    `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=artifacts/terminal-live/ask-user-human-taxonomy-20260602-1624`.
  - Resultado: BLOCKED por `live-timeout`; a UX ficou correta (`[PERGUNTA]`, prompt `[PERG]`,
    activity `Pergunta ao operador`), mas o harness ainda esperava badge antigo `[ASK]` para injetar
    a resposta.
- [x] Runner live corrigido: `buildAskRenderedRegex()` agora reconhece `PERGUNTA` e mantém
      compatibilidade diagnóstica com `ASK`.
- [x] Repetir live PTY de `ask_user` SDK após correção do harness.
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=artifacts/terminal-live/ask-user-human-taxonomy-20260602-1630`.
  - Resultado funcional: ask_user real, resposta humana livre, continuação pós-ask, SSE/export e
    erros verdes.
  - Resultado UX: FAIL apenas em critério defasado `ux-human-tool-names`, porque o runner ainda
    procurava `Intent capturado` embora a UI já renderizasse `Intenção capturada`.
- [x] Runner live corrigido para aceitar `Intenção capturada` em `ux-human-tool-names` e health tool
      stats.
- [x] Achado visual da live corrigido: `/activity` trocou `resposta=...` por `resposta ...` na seção
      `interações humanas`.
- [x] Repetir live PTY de `ask_user` SDK após o ajuste do critério e de `/activity`.
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=artifacts/terminal-live/ask-user-human-taxonomy-20260602-1632`.
- [x] Resultado: PASS completo; 258/258 eventos públicos com source/eventSource; ask_user real,
      resposta humana, continuação pós-ask, SSE/export, nomes humanos de tools, ausência de IDs
      crus/spam de espera e `/activity` com `resposta ...` sem `resposta=`.
- [x] Após a live, auditar se `/activity`, `/events`, `/sdk waits`, `/status`, `/now` e a linha viva
      usam exatamente a mesma terminologia de pergunta humana.
  - `/activity`: `Pergunta ao operador`, `interações humanas`, `resposta ...`;
  - `/events`: `Pergunta ao operador`, `Resposta do operador`, `Mensagem da LLM-B`;
  - `/sdk waits`: `Esperas humanas`, `pergunta estruturada`, `perguntas`;
  - `/usage now`: `Continuação da pergunta humana`;
  - linha viva: `PERGUNTA`.
- [x] Próxima lacuna estética observada em live: `/health full` ainda usava alguns termos técnicos
      (`runtime id`, `bg tasks`, `keepalive standby(dialog)`, `ação none`) por ser modo detalhado;
      decisão: `full` também é painel humano detalhado, enquanto `detail/raw` preservam taxonomia
      copiável.
- [x] `/health full` trocou `runtime id`, `bg tasks`, `keepalive`, `quota monitor`, `permission`,
      `prompts SDK skip`, `reasoning`, `modo sdk`, `sdk session`, `hub session`, `ação none` por
      `runtime alvo`, `tarefas`, `pulso`, `quota`, `permissão`, `prompts SDK ignorados`,
      `raciocínio`, `modo SDK`, `sessão SDK`, `sessão hub`, `ação nenhuma`.
- [x] Teste escopado passou após o polish de `/health full`:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.
- [x] `/tools diag` trocou `tool(s)`, `tool técnico:`, `tipo:`, `disabled:` e `Uso:` por
      `ferramenta(s)`, `nome técnico:`, `tipo`, `desabilitadas:` e `Comandos:`.
- [x] Teste escopado passou após o polish de `/tools diag`:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.

### 11.28 Superfícies detalhadas sem inglês interno

- [x] Auditoria pós-commit confirmou resíduos visíveis em três famílias:
  - eventos de tarefa em segundo plano (`Background agent concluído/falhou/ocioso`);
  - streaming/raciocínio interno (`task thinking`, `chunks`, `chars`);
  - painéis detalhados (`runtime id`, `bg tasks`, `tools load`, `instr. load`, `sdk↔fs route`,
    `prompts SDK skip`, `resume-session`, `auth none`).
- [x] Decisão canônica:
  - stdout default, `/activity`, `/status full`, `/health full` e `/metrics` são telas humanas,
    ainda que detalhadas;
  - nomes técnicos originais continuam permitidos em projeções internas, SSE/archive bruto, exports
    e modos raw/detail explícitos;
  - IDs e enum values só aparecem quando são necessários para cópia/diagnóstico, e não como rótulos
    principais.
- [x] `agent-runtime-events.js` passou a renderizar
      `Tarefa em segundo plano concluída/falhou/ociosa`, com descrições conhecidas traduzidas:
  - `Relay question.answered answers into hook tools resolver` →
    `Resposta humana entregue ao resolvedor da ferramenta`;
  - `Clear persisted pendingQuestion` → `Pergunta pendente persistida limpa`;
  - `Persist pendingQuestion + pendingQuestionMeta + lastAskUserAt` →
    `Pergunta pendente salva para retomada`.
- [x] `task-stream-events.js` passou a renderizar `raciocínio da tarefa`, `fragmentos` e
      `caracteres`, removendo `task thinking`, `chunks` e `chars` da superfície padrão.
- [x] `turn-display.js` passou a renderizar `Raciocínio capturado` e `raciocínio #...`, sem
      `Thinking capturado`/`thinking #...`.
- [x] `io-activity-events.js` passou a renderizar operações como `[ARQUIVO] [LER]`, `[MOVER]`,
      `Arquivo: leitura concluída`, preservando `io.read` apenas como toolName interno.
- [x] `/status full` trocou:
  - `bg tasks` → `tarefas fundo`;
  - `issues` → `alertas`;
  - `ação sugerida none` → `próximo passo nenhuma ação imediata`;
  - `runtime id/session/profile/runtimes` → `runtime alvo`, `sessão runtime`, `perfil runtime`,
    `mapa runtime`;
  - `tools load`, `instr. load`, `sdk↔fs route`, `custom agents` → `ferramentas`, `instruções`,
    `rota sdk↔fs`, `agentes extras`;
  - `prompts SDK skip/selective` → `prompts SDK ignorados/seletivos`;
  - `auth apiKey/none` → `autenticação chave API/ausente`.
- [x] `/metrics` trocou `runtime id`, `sdk sessão`, `hub sessão`, `plan file` e `resume-session` por
      `runtime alvo`, `sessão SDK`, `sessão hub`, `plano` e `retomar sessão`.
- [x] `/health full` removeu duplicações cruas remanescentes, incluindo `auth none`,
      `inspect_boot_report` e `sdk↔fs route` no bloco completo.
- [x] Testes escopados passaram após esta família de mudanças:
  - `npx vitest run tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_activity_state.spec.js tests/unit/copilot/terminal/test_turn_display.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_activity_state.spec.js tests/unit/copilot/terminal/test_turn_display.spec.js`.
- [x] Live PTY com cenário real executada após esta família:
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=artifacts/terminal-live/ux-humanized-ops-taxonomy-20260602-1646`.
- [x] Resultado da live: PASS completo; stdout principal mostrou `[ARQUIVO] [LER]`,
      `raciocínio da tarefa`, `Raciocínio capturado`, `Tarefa em segundo plano concluída`,
      `/activity` com `Arquivo: leitura concluída`, `/tools diag` humano e `/health full` sem
      `runtime id`/`bg tasks`.
- [x] Achado da live corrigido: `/events` resumido ainda mostrava `assistant reasoning complete`,
      `question answered`, `Tarefa em background concluída`, `Background ocioso` e fonte
      `agente/background`.
- [x] `/events` agora renderiza `Raciocínio concluído`, `Resposta do operador`,
      `Tarefa em segundo plano concluída`, `Tarefa em segundo plano ociosa` e fonte
      `tarefa em segundo plano`; `--raw`/`--json` preservam nomes canônicos.
- [x] `/sdk prompt` e `/permission mode` passaram a renderizar `nenhuma ação imediata`,
      `retomar sessão`, `prompts SDK ignorados/seletivos` e `política`, removendo `none`,
      `resume-session`, `skip/selective` e `policy` do default humano.
- [x] Testes escopados passaram após `/events` e `/sdk`:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Repetir live PTY após correção de `/events` para confirmar visualmente que o resumo default
      também está limpo.
  - `COPILOT_BYOK_ENABLED=false node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=240000 --transport=pty --live-scenario=freeform --out-dir=artifacts/terminal-live/ux-events-humanized-repeat-20260602-1651`.
  - Resultado: PASS completo; `/events` mostrou `Raciocínio concluído`, `Pergunta ao operador`,
    `Resposta do operador`, `Tarefa em segundo plano concluída/ociosa` e fonte
    `tarefa em segundo plano`, sem os rótulos antigos observados na live anterior.
- [x] Próxima lacuna: alguns comandos BYOK ainda carregam enum values em modo default (`apiKey`,
      `deltas ... chars`). Auditar se cada caso deve ser humano default ou detalhe técnico copiável.
- [x] `auto-brief` passou a renderizar autenticação BYOK como `chave API`, `token bearer` ou
      `sem autenticação`, removendo `apiKey`, `auth` e `sem auth` do briefing default/detalhado.
- [x] `/byok status` passou a usar `Provedor` e `Autenticação chave API/token bearer/headers`.
- [x] `/byok probe` passou a renderizar sinal como `fragmentos` e `caracteres`, removendo
      `deltas N/M chars` do output humano.
- [x] `/byok providers`, health e telas de gateway associadas passaram a usar `provedor` e
      `autenticação` em vez de `provider`/`auth`, preservando `provider:<id>` apenas como sintaxe
      copiável.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/terminal/test_auto_brief.spec.js`.
- [x] Próxima lacuna executada: revisar as palavras `Chat`, `Agent`, `Vision`, `health`,
      `eligibility`, `wire`, `refresh` em `/byok gateway*`, decidindo quais são termos técnicos
      aceitáveis e quais devem virar rótulos humanos default.
- [x] `byok.js` ganhou vocabulário central para fontes, protocolos e tokens técnicos de BYOK,
      evitando que cada painel converta `provider-cache:model`, `openai_chat_completions`,
      `runtime_health`, `admission-blocked`, `provider_explicit`, `rate-limit` e equivalentes de
      forma ad hoc.
- [x] `/byok gateway*`, `/byok models route`, `/byok probe`, `/byok health`, `/byok accounts`,
      `/byok limits`, `/byok quota`, `/byok providers`, `/byok importer-audit`, `/byok traits`,
      `/byok probe matrix`, `/byok catalog explain`, `/byok provider explain`, `/byok auto*`,
      `/byok operator-ready`, `/byok standby`, `/byok selection audit` e superfícies associadas
      passaram a usar `provedor`, `saúde`, `execução`, `sonda`, `protocolo`, `elegibilidade`,
      `quota`, `créditos`, `seleção`, `política`, `alternativas`, `admitidos`, `pontuação` e
      `visão`.
- [x] A tela default deixou de exibir `wire`, `health`, `eligibility`, `selectorKind`,
      `runtime overlays`, `post-runtime`, `policy`, `probe`, `provider`, `capability`, `adapter`,
      `importers`, `hooks`, `traits`, `source layer`, `freshness`, `account_api`, `rate-limit` e
      `admission-blocked` como rótulos primários.
- [x] A sintaxe operacional copiável foi preservada onde importa: subcomandos, flags, nomes de
      modelo, ids de provedor e valores crus continuam disponíveis nas rotas raw/detail, fixtures e
      campos canônicos.
- [x] Teste escopado BYOK passou após a revisão:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js`.
- [x] Validadores regulares passaram após a revisão:
  - `npm run typecheck:strict:src.copilot`;
  - `npm run lint:copilot`.

### 11.29 Paleta, alinhamento e fluxo visual canônico

- [x] Auditoria inicial da paleta ANSI atual por família semântica: comando do operador, resposta da
      LLM-B, raciocínio, pergunta humana, ferramenta, arquivo, erro, aviso, sucesso, espera viva,
      bloco técnico e raw/detail.
- [x] Achado: já existe `ui-theme.js`, mas os módulos mais visíveis ainda inventam seus próprios
      blocos com ANSI literal, emoji e largura fixa.
- [x] Achado: `repl-banner.js` tem dois mundos visuais; o banner compacto é aceitável, enquanto o
      full é uma parede de comandos com ANSI hardcoded, desalinhada em terminais estreitos e com
      baixa hierarquia visual.
- [x] Achado: `turn-display.js` mistura timestamp, emoji, papel, modelo e effort sem componente
      comum; o footer usa cor de duração hardcoded.
- [x] Achado: `live-status-line.js` já resolve parte do spam, mas ainda usa um formato único
      `modelo/effort` que pesa no rodapé e não comunica a fase como badge/papel estável.
- [x] Achado: `agent-runtime-events.js` renderiza pergunta humana como bloco próprio, mas o texto
      `LLM-B perguntou: "..."` ainda parece diálogo técnico; o bloco precisa parecer decisão
      pendente do operador, com pergunta e ações em linhas alinhadas.
- [x] Achado: `tool-lifecycle-runtime.js` já centraliza operação, mas conclusão usa emojis
      `✅`/`❌`, e isso quebra a estética sóbria em VS Code e logs.
- [x] Decisão canônica: criar primitivas pequenas em `ui-theme.js`, reaproveitáveis por barrel, para
      `divider`, `headline`, `row`, `status`, `duration`, `frame` e `join`.
- [x] Decisão canônica: manter ANSI e cor por papel semântico, não por módulo; blocos humanos
      detalhados usam os mesmos papéis que a linha viva.
- [x] Decisão canônica: retirar emojis estruturais da superfície default do terminal LLM-B. Conteúdo
      vindo do modelo pode conter emoji; chrome do terminal não deve depender disso.
- [x] Decisão canônica: pergunta humana é uma caixa de decisão, não uma ferramenta; tool lifecycle
      de pergunta continua suprimido como tool comum.
- [x] Decisão canônica: `raw`, `detail`, SSE, archive e export continuam podendo carregar nomes
      canônicos e ids, mas a tela default usa título humano primeiro.
- [x] Decisão canônica: o banner full opt-in deve virar índice organizado por famílias, não lista
      linear gigantesca.
- [x] Implementar primitivas visuais comuns em `ui-theme.js`.
- [x] Migrar banner compacto/full para as primitivas, com grupos curtos e alinhamento previsível.
- [x] Migrar cabeçalho de raciocínio, cabeçalho de resposta e footer de streaming para as
      primitivas.
- [x] Migrar pergunta pendente restaurada para caixa humana de decisão com linhas `Pergunta`,
      `Opções`, `Ação`.
- [x] Migrar conclusão de tool para status textual `ok`/`falhou`, sem emoji estrutural.
- [x] Refinar linha viva para `LLM-B · fase · detalhe · tempo · modelo`, reduzindo densidade quando
      não há pergunta.
- [x] Segunda leva: `/display`, `/model`, `/reasoning`, `/search`, `/errors`, compactação e
      subagentes passaram a usar a gramática visual comum, removendo emojis/ANSI literais da
      superfície default tocada.
- [x] Terceira leva: `/history`, `/db-history`, `/db-sessions`, `/who`, `/thinking`, `/export`,
      resumo compacto de `/diagnose`, bloco LLM-A do engine, watchdog e mensagem SDK de saída de
      plan mode passaram a usar rótulos humanos e status textual.
- [x] Busca residual por emoji/ANSI estrutural em `src/copilot/terminal` ficou limpa nas superfícies
      default; ocorrência BYOK restante é falso positivo textual por `SELECTION`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_turn_display.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_display.spec.js tests/unit/copilot/terminal/test_commands_config_errors.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.
- [x] Testes escopados ampliados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_export.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_thinking.spec.js tests/unit/copilot/terminal/test_commands_display.spec.js tests/unit/copilot/terminal/test_commands_config_errors.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_turn_display.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_agent_wiring.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js`.
- [x] Criar snapshots ou testes de texto para os blocos centrais: banner, pergunta humana, linha
      viva, tool file e final de turno.
- [x] Typecheck strict e lint passaram:
  - `npm run typecheck:strict:src.copilot`;
  - `npm run lint:copilot`.
- [x] Live PTY LLM-B focada em estética executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/ux-visual-grammar-cycle-20260602-1750`.
- [x] Resultado: PASS; banner compacto, `/status`, `/now`, `/live`, `/activity`, `/sdk waits` e
      linha viva ficaram mais legíveis, sem `request_user_input`, `report_intent` ou ids crus na
      superfície observada.
- [x] Achado da live corrigido: auto-brief/boot migrados para `ui-theme`, removendo ANSI literal e
      marcador visual solto da inicialização.
- [x] Achado da live corrigido: `/health` default passou a alinhar título/separador à gramática
      visual usada por `/status`, `/live` e banners.
- [x] Quarta leva: `/attach`, `/audit`, `/context`, `/usage`, `/tools`, `/metrics`, `/skills`,
      warnings SDK, watchdog, anexos inline e orçamento BYOK passaram para `headline`/`row`/`text`,
      removendo emojis estruturais e ANSI hardcoded da superfície operacional.
- [x] `/tools diag` preserva nomes técnicos apenas como detalhe discreto (`nome técnico:`), com nome
      humano em primeiro plano.
- [x] `/metrics` deixou de ser um template monolítico com blocos coloridos próprios e virou painel
      por seções (`Métricas da sessão`, `Uso`, `Ferramentas`, `Erros`, `Atividade`,
      `Streaming público`, `Archive SSE`, `Inject`).
- [x] Busca residual por emoji/ANSI estrutural em `src/copilot/terminal` ficou limpa para código UX
      real; remanescentes são comentários em `dev-watch` e falsos positivos de constantes BYOK
      (`SELECTION`).
- [x] Testes escopados pós-quarta-leva passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_config_errors.spec.js tests/unit/copilot/terminal/test_commands_display.spec.js tests/unit/copilot/terminal/test_commands_thinking.spec.js tests/unit/copilot/terminal/test_commands_export.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_turn_display.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_agent_wiring.spec.js tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js`.
- [x] Repetir typecheck strict e lint após a quarta leva.
  - `npm run typecheck:strict:src.copilot`;
  - `npm run lint:copilot`.
- [x] Live PTY estética curta repetida após a quarta leva:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/ux-visual-grammar-cycle-20260602-1810`.
  - Resultado: PASS; banner, boot, `/status`, `/now`, `/health`, `/live`, `/activity`, `/sdk waits`
    e linha viva renderizaram com gramática visual comum.
- [x] Achado da live corrigido: `/tools` vazio trocou rótulo `Tools` por `Ferramentas`.
- [x] Teste escopado pós-achado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js`.
- [x] Committar/pushar esta grande leva visual e continuar para a próxima camada de UX.

### 11.30 Boot condensado e transição visual boot -> ready

- [x] Achado visual depois da primeira grande leva: a tela inicial ainda tinha densidade acima do
      ideal porque o banner compacto, o bloco de ambiente e o auto-brief de boot narravam estado
      sobreposto.
- [x] Decisão canônica: boot default deve responder apenas três perguntas:
  - onde estou;
  - quais ações principais existem;
  - qual é o próximo comando útil.
- [x] `terminal-phases/boot-banner.js` condensou o bloco de ambiente para duas linhas úteis:
  - `Ambiente ... <url>`;
  - `Ações /tools /health /session sdk /events`.
- [x] `auto-brief.js` passou a usar forma especial compacta durante `phase=boot`, com `Boot`,
      `Próximo` e `Atenção`, evitando repetir `Sessão`, `BYOK`, `Fluxo` e `Boot parcial` antes do
      registry estar pronto.
- [x] O modo detalhado continua opt-in por `COPILOT_TERMINAL_AUTO_BRIEF=full`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_auto_brief.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js tests/unit/copilot/terminal/test_repl_banner.spec.js`.
- [x] Live PTY curta passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/ux-boot-brief-condensed-20260602-1823`.
- [x] Resultado live: PASS; primeira tela reduziu altura e manteve `/status`, `/now`, `/health`,
      `/tools`, `/live`, `/activity` e `/sdk waits` humanos.
- [ ] Próxima lacuna de alto retorno: limpar mensagens de erro/auto-recuperação do engine que ainda
      imprimem `action=`, `route=`, `source=` e `actor=` na superfície humana default.
- [x] Próxima lacuna de alto retorno: limpar mensagens de erro/auto-recuperação do engine que ainda
      imprimem `action=`, `route=`, `source=` e `actor=` na superfície humana default.
- [x] Próxima lacuna de alto retorno: revisar `/events` para que filtros humanos sejam a forma
      exibida no default, preservando `trace=`, `source=` e `tool=` apenas como
      compatibilidade/detail.

### 11.31 Engine e `/events` sem telemetria crua no default

- [x] Achado: o engine de diálogo ainda podia escrever em stdout linhas de recuperação BYOK como
      `action=`, `route=`, `applied=`, `skipped=`, `effects=` e `handoffs=`.
- [x] Achado: detalhes de atividade de turno ainda usavam `actor=`, `source=`, `deltas=`, `chars=` e
      `assistantMessages=`, que podiam reaparecer em painéis humanos.
- [x] Correção: `engine.js` ganhou conversão humana de ação automática e pluralização local,
      mantendo a decisão operacional igual e trocando a apresentação para `Seleção`, `Detalhe`,
      `ação`, `rota`, `efeitos`, `persistências` e `entregas SDK`.
- [x] Correção: atividades de turno passaram a registrar `autor`, `origem`, `fragmentos`,
      `caracteres`, `visíveis` e `mensagens assistente`.
- [x] Achado: `/events sources` era um mapa técnico útil, mas ruim como tela default: mostrava
      emoji, owner, emissor, aceita, suprime, fallback e IDs de política como título principal.
- [x] Correção: `/events sources` virou painel humano de fontes, com título humano, responsável,
      eventos recentes e comando de investigação.
- [x] Preservação: `/events sources detail` mantém IDs, classe, dono técnico, emissor, aceita,
      suprime e fallback.
- [x] Correção: `/events` default passou para `headline`/`row`/`text`, sem emoji estrutural nem ANSI
      local.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js`.
- [x] `/events` default trocou `trace` por `rastreamento`, `SDK ask_user` por `pergunta humana SDK`
      e `Sistema/ask_user` por `Sistema/pergunta humana`; `trace=` fica apenas em raw/json/export
      técnico.
- [x] `/sdk doctor` passou a usar `headline`/`row`/`text`, removendo ANSI local e o token cru
      `local-fs-primary` da superfície default.
- [x] `/sdk doctor` agora mostra `Rota arquivos locais como rota principal`, `Decisão`, `Domínio`,
      `Contexto`, `Motivo` e `Arquivos` em vocabulário humano.
- [x] Testes escopados passaram após `/sdk doctor` e `/events`:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js`.
- [x] Live PTY curta após esta leva confirmou boot e painéis default no terminal real:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/ux-events-engine-humanized-20260602-1828`.
  - Resultado: PASS.
- [x] Próxima lacuna: revisar `/status full` e `/session` detalhado, que ainda usam blocos herdados
      com ANSI local em modo `full`; decidir o que é humano detalhado e o que deve virar
      `detail/raw`.

### 11.32 `/status full` como painel humano detalhado

- [x] Achado: `/status full` ainda era uma string monolítica com ANSI local, rótulos desalinhados e
      vocabulário misto (`healthy`, `recovery`, `runtime alvo`, `prompt reason`, `fase/source`,
      `timeline sync`).
- [x] Decisão: `full` é tela humana detalhada, não raw técnico; rótulos crus devem ficar em comandos
      `detail/raw`, SSE, JSON ou export técnico.
- [x] `cmdStatus` full passou a renderizar o bloco principal por `terminalThemeHeadline`,
      `terminalThemeRow` e `terminalThemeDivider`.
- [x] A saúde do agente passou a aparecer como `saúde ok/atenção/problema`, sem `healthy`.
- [x] Entrada e detalhe do canal traduzem `ask_user`, `recovery`, `direct dispatch` e `runtime` para
      `pergunta humana`, `recuperação`, `envio direto` e `ambiente`.
- [x] Notas condicionais de pergunta restaurada, ações pendentes, timeline e sync Hub passaram a
      usar `terminalThemeRow`, sem ANSI local.
- [x] Teste de sessão foi atualizado para bloquear os rótulos técnicos antigos e aceitar os novos
      rótulos humanos capitalizados.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] Próxima lacuna: revisar o `/status` compacto restante, que ainda tem ANSI local em algumas
      linhas, e decidir se vale migrar agora ou manter até a próxima rodada de compactação.
- [x] Próxima lacuna: revisar `/session sdk` inventário/controle, que ainda contém mensagens com
      ANSI local em ações de boot.

### 11.33 `/session sdk` com cockpit visual consistente

- [x] Achado: `/session sdk next`, `/session sdk delete`, inventário, eventos, waits e catálogo de
      comandos ainda tinham ANSI local e pontuação antiga (`Próximo boot:`, `Waits SDK`,
      `vínculo BYOK`, `arquivos da sessão:`).
- [x] `cmdSessionSdk` passou a usar `terminalThemeHeadline` e `terminalThemeRow` para:
  - diretivas de próximo boot;
  - proteção contra apagar sessão SDK viva;
  - erros de inventário;
  - estado atual/última/foreground;
  - vínculo BYOK;
  - sessões listadas;
  - filtros, limpeza e probes.
- [x] `/session sdk events`, `/session sdk waits` e `/session sdk commands` também passaram para o
      tema comum.
- [x] A terminologia default virou `Esperas SDK da sessão`, `Eventos SDK da sessão`,
      `Comandos SDK expostos ao Copilot`, `Vínculo BYOK`, `Último boot`, `Metadados` e `Arquivos`.
- [x] IDs de sessão continuam copiáveis, mas aparecem dentro de linhas alinhadas e com rótulo
      humano.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] Próxima lacuna: revisar se `/status` compacto deve migrar totalmente para tema, removendo os
      ANSI locais remanescentes sem perder contraste rápido.

### 11.34 Barrel estreito de tema e polimento BYOK residual

- [x] Achado: a tentativa de importar tema via `state/index.js`/`state/ui` em comandos isolados pode
      puxar estado amplo e quebrar mocks escopados.
- [x] Criado `src/copilot/terminal/state/theme/index.js` como barrel estreito apenas para primitivas
      visuais.
- [x] `/byok gateway catalog refresh plan` removeu uma linha residual com ANSI local e passou a
      renderizar `Importers`, `Executar`, `Adiar` e `Comando` com `terminalThemeRow`.
- [x] Teste escopado BYOK passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js`.
- [x] Live PTY curta após a sequência de polimentos passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=60000 --transport=pty --out-dir=artifacts/terminal-live/ux-session-byok-polish-20260602-1852`.
  - Resultado: PASS.
- [x] Achado da live: `/status`, `/now`, `/health`, `/live` e `/activity` compactos estão funcionais
      e humanos, mas ainda usam algumas cores locais herdadas; a estética já melhorou, porém a
      unificação total da paleta ainda cabe em rodada própria.
- [ ] Próxima lacuna: migrar outros comandos que só precisam de tema para o barrel estreito,
      reduzindo acoplamento acidental em testes e cold start.

### 11.35 `/status` compacto sem ANSI herdado

- [x] Achado: a live ainda mostrava `/status` compacto com cores locais hardcoded, embora a
      informação já estivesse humana.
- [x] Decisão: `/status` compacto deve usar a mesma gramática visual do `/status full`, porque é a
      primeira tela de decisão do operador.
- [x] `cmdStatus` default trocou a string template por `terminalThemeHeadline`,
      `terminalThemeDivider` e `terminalThemeRow`.
- [x] Acesso, saúde, entrada, modelo, catálogo, atividade, próximo passo e detalhes agora são linhas
      temáticas, sem `\x1b[...]` local no bloco.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] `/now` default e `/now full` também migraram para `terminalThemeHeadline`,
      `terminalThemeDivider` e `terminalThemeRow`, substituindo o painel ANSI local por linhas
      humanas alinhadas.
- [x] `/live` default e `/live full` passaram a usar o mesmo tema central, incluindo estado colorido
      por papel sem `\x1b[...]` hardcoded na tela.
- [x] `/live full` deixou de misturar listas soltas para tools, arquivos, I/O real e eventos
      recentes; esses blocos agora aparecem como `Turno observado`, `I/O real recente` e
      `Eventos recentes`.
- [ ] Próxima lacuna: migrar `/health` e `/activity` compactos para o barrel estreito de tema e
      remover suas cores locais herdadas, em lotes pequenos.

### 11.36 `/now` e `/live` no tema central

- [x] Achado: após `/status`, o operador ainda via a mesma sessão com três estilos simultâneos:
      `/now` em painel temático parcial, `/live` com restos de ANSI manual e listas detalhadas não
      alinhadas.
- [x] Decisão: `/now`, `/now full`, `/live` e `/live full` devem compartilhar a gramática dos
      painéis compactos, porque são comandos de monitoramento cotidiano e aparecem juntos no ciclo
      live.
- [x] Implementação: `cmdNow` passou a renderizar `Agora` e `Agora - Detalhe` com linhas `Conversa`,
      `Entrada`, `Modelo`, `Catálogo`, `Atividade`, `Runtime`, `Timeline` e `SSE` via tema central.
- [x] Implementação: `cmdLive` passou a renderizar `Fluxo da conversa` e
      `Fluxo detalhado da conversa` com helpers de papel visual por estado, sem cor ANSI local.
- [x] Implementação: blocos internos de `/live full` foram humanizados para `Ferramenta`, `Arquivo`,
      `Operação` e `Evento`, evitando bullets desalinhados e listas que pareciam logs crus.
- [x] `/activity` default, seus resumos de turno, I/O real e timeline recente passaram para
      `terminalThemeHeadline`, `terminalThemeDivider` e `terminalThemeRow`.
- [x] `/activity detail` preserva origem, IDs e engine, mas também usa linhas temáticas para
      streaming público e decisões recentes.
- [x] `/health` compacto deixou de usar template monolítico com `C.green/C.grey` e agora renderiza
      conversa, modelo, acesso, gateway, entrada, ferramentas, atividade, infra, próximo passo e
      detalhe por `terminalThemeRow`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`
- [ ] Validar via PTY que `/status`, `/now`, `/live`, `/activity` e `/health` ainda cabem bem na
      largura visual do terminal do operador.
- [ ] Próxima lacuna estética: auditar `/help`, `/tools` e `/byok` default, pois ainda ha blocos
      extensos com ANSI local e listas densas.

### 11.37 `/activity` e `/health` sem gramática herdada

- [x] Achado: `/activity` ainda tinha cabeçalho novo, mas miolo antigo com `estado`, `evento`,
      `idade`, bullets e I/O colorido manualmente.
- [x] Achado: `/health` compacto tinha cabeçalho novo, mas linhas internas misturavam `C.green`,
      `C.grey`, `C.magenta` e texto em bloco, dificultando alinhamento e evolução estética.
- [x] Decisão: as telas de observação cotidiana devem compartilhar a mesma malha visual; listas só
      ficam como linhas temáticas, e o modo detail/raw fica responsável por densidade técnica.
- [x] Implementação: `cmdActivity` substituiu templates ANSI por painel temático completo, incluindo
      `Resumo do turno atual`, `Último turno concluído`, `Arquivos tocados`, `Ferramentas`,
      `Interações humanas`, `I/O real recente` e `Timeline recente`.
- [x] Implementação: `cmdDiagnose` compacto substituiu o bloco único por linhas temáticas e helpers
      sem ANSI para BYOK, gateway, MCP, health, ação recomendada e status runtime.
- [x] Resultado esperado: o operador passa a ver `/status`, `/now`, `/health`, `/live` e `/activity`
      como uma família visual única, não como cinco comandos de origens diferentes.
- [x] Live PTY inicial executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=90000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-theme-consolidation-20260603-1343`
  - Resultado automatizado: PASS.
  - Achado manual: a limpeza de sessões SDK despejava dezenas de linhas
    `[SESSION] Sessão SDK removida` e tomava `Atividade`, `/status`, `/now`, `/health`, `/live` e
    `/activity`.
- [x] Correção: `session.deleted` saiu de `SDK_LIFECYCLE_VISIBLE_TYPES`; o evento permanece no
      archive/SSE técnico, mas deixa de atualizar atividade atual, histórico visível e stdout
      humano.
- [x] Correção: `/sdk waits` passou para painel temático com `Estado`, `Resumo`/`Detalhe`, `Ação`,
      `Pergunta`, `Texto` e `Status`, removendo `estado   `, `resumo   ` e ANSI local.
- [x] O harness live ganhou critério `ux-cycle-no-session-cleanup-spam`, bloqueando regressão de
      `Sessão SDK removida`, `[SESSION]` e `session.deleted` na UX default.
- [x] Live PTY pós-correção executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=90000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-no-session-cleanup-spam-20260603-1347`
  - Resultado: PASS, incluindo `ux-cycle-no-session-cleanup-spam`.
  - Inspeção plain log: sem `Sessão SDK removida`, `[SESSION]`, `session.deleted`,
    `request_user_input`, `report_intent`, `chatcmpl-tool`, `estado   ` ou `resumo   `.
- [x] Live PTY estruturada inicial executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-cycle-theme-check-20260603-1349`
  - Resultado funcional: PASS.
  - Achado manual: `/sdk simulate request-user-input` ainda renderizava
    `status/origem/modo/pergunta/ação/detalhe` em formato antigo, e a confirmação da resposta ainda
    usava ANSI local.
- [x] Correção: a tela `Pergunta humana estruturada` passou para `terminalThemeHeadline`,
      `terminalThemeDivider` e `terminalThemeRow`, com `Status`, `Origem`, `Modo`, `Pergunta`,
      `Ação` e `Detalhe`.
- [x] Correção: resposta humana roteada para pergunta pendente e `/answer` passaram a renderizar
      linhas temáticas `Resposta`/`/answer`, sem `[answer]` nem `\x1b[...]` local.
- [x] Harness estruturado atualizado para aceitar e exigir a confirmação temática
      `Resposta     enviada para pergunta pendente`.
- [x] Live PTY estruturada pós-correção executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-cycle-themed-request-pass-20260603-1353`
  - Resultado: PASS.
  - Inspeção plain log: sem `[answer]`, `request_user_input ainda executando`, `chatcmpl-tool`,
    `ask_user SDK` ou ID interno `request-user-input-sim`.
- [x] Correção zero-PR: `/steer`, `/interrupt`, `/queue`, `/mailbox` e `/turn` no roteador do REPL
      passaram a usar `terminalThemeRow`, removendo `[zero-pr]`, `[queue]`, `[mailbox]`, `[turn]`,
      `[steer]`, `[interrupt]` e ANSI local dessa superfície.
- [x] Resultado esperado: quando uma intervenção é aplicada diretamente a uma pergunta pendente,
      enfileirada no mailbox zero-PR ou enviada como turno explícito, a UX passa a usar
      `Intervenção`, `Mailbox`, `Fila`, `Próximo`, `/turn`, `/steer` e `/interrupt` como rótulos
      alinhados.
- [x] Correção `/elicitation`: listagem, capabilities, confirm/select/input, clear, respond,
      request/request-json e `show` passaram a usar `terminalThemeHeadline`, `terminalThemeDivider`
      e `terminalThemeRow`.
- [x] Correção `/permission`: mode, respond, pending, reset-approvals, clear, list, show e cockpit
      passaram a usar linhas temáticas, com `Permissão`, `Permissões`, `Modo`, `Prompts SDK`,
      `Pendentes`, `Atalhos` e `Ação`.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
- [x] Próxima lacuna: revisar `/sdk capabilities`, `/sdk doctor`, `/sdk workspace` e demais painéis
      SDK que ainda têm blocos `\x1b[...]` locais fora de `/permission`/`/elicitation`.

### 11.38 `/sdk` e `/workspace` sem ilhas de debug visual

- [x] Achado: após `/permission` e `/elicitation`, o arquivo `commands/sdk.js` ainda tinha
      superfícies antigas em `/sdk capabilities`, `/sdk headers`, `/sdk models`, `/sdk skills`,
      `/sdk quota`, `/sdk prompt` e `/workspace`.
- [x] Achado: o operador ainda podia ver `SDK Capabilities`, `Request Headers`, `[OK]`, `[ERR]`,
      linhas manuais coloridas e dumps sem rótulo, criando a sensação de outra ferramenta dentro da
      UX.
- [x] Decisão: painéis cotidianos do SDK devem usar nomes humanos em português, linhas alinhadas e
      papéis visuais do tema central; termos crus ficam só em detalhes, retornos brutos ou
      diagnósticos explícitos.
- [x] Implementação: `/sdk capabilities` virou `Capacidades SDK`, com linhas `UI`, `Tools`, `Plano`
      e `Retorno`.
- [x] Implementação: `/sdk` default passou a renderizar `SDK do Terminal`, `Sessão`, `Modelo`,
      `Esperas`, `Quota` e `Uso` via tema central, sem `reasoning=`/`restante=` ou ANSI local.
- [x] Implementação: `/sdk headers` passou a mostrar `Headers do próximo turno`, `Headers`, `Fluxo`
      e pares chave/valor alinhados.
- [x] Implementação: `/sdk models`, `/sdk skills`, `/sdk skills config`, `/sdk skills agents` e
      mutações enable/disable passaram para linhas temáticas e vocabulário humano.
- [x] Implementação: `/sdk quota` e `/sdk prompt` agora renderizam estado, quota, usage RPC, modo,
      binding e fontes de instrução sem cores hardcoded.
- [x] Implementação: `/workspace read/write/sync/mirror/promote/list` passou para linhas
      `Workspace`, `Materialização`, `Mirror SDK`, `Promoção`, `Origem`, `Destino`, `Política`,
      `Trace`, `Retorno` e `Uso`.
- [x] Implementação: guidance de falha transversal deixou de imprimir `? <comando>` e linhas mudas;
      agora usa `Próximo` e `Recuperação`.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
- [x] Varredura local confirmou ausência de ANSI literal em `src/copilot/terminal/commands/sdk.js`:
  - `rg -n "\\x1b\\[|\\u001b\\[" src/copilot/terminal/commands/sdk.js`.
- [ ] Próxima lacuna: executar validação visual live pós-migração de `/sdk` e `/workspace`,
      garantindo que `/sdk`, `/sdk capabilities`, `/sdk skills`, `/workspace list` e
      `/workspace sync` não recriem paredes de texto.
- [ ] Próxima lacuna: auditar `/tools` e `/help`, pois são comandos de alta exposição e ainda podem
      ter densidade visual excessiva no primeiro viewport.

### 11.39 `/help` e `/tools` como superfícies de orientação, não dumps

- [x] Achado: `/help full` ainda era uma arte ANSI monolítica com borda, cores locais e dezenas de
      linhas duplicadas manualmente.
- [x] Achado: `/tools` já usava parte do tema, mas as linhas principais ainda eram strings com
      `padEnd`, rodapés soltos e labels como `nome técnico:` no diagnóstico.
- [x] Decisão: `/help` deve ser um catálogo estruturado por seções, com dados fáceis de manter;
      `/tools` deve preservar nomes técnicos apenas em `diag/raw`, mantendo o default humano.
- [x] Implementação: `/help` curto passou a renderizar `Ajuda rápida - Terminal LLM-B` com
      `terminalThemeHeadline`, `terminalThemeDivider`, `terminalThemeRow` e grupos `Situação`,
      `Conversa`, `Ações`, `Arquivos`, `Modelo`, `Esperas`, `Diagnóstico`, `Completo` e
      `HTTP local`.
- [x] Implementação: `/help full` foi reescrito como seções estruturadas (`Sessão e observação`,
      `Conversa e controle`, `Sessão SDK persistente`, `Modelo, BYOK e quota`,
      `Contexto, arquivos e índice`, `Interações humanas e SDK`, `Exibição e navegação`,
      `Memória, GitHub e Git`, `HTTP local`).
- [x] Implementação: o fallback de comando desconhecido no roteador passou a usar `Comando` com
      `terminalThemeRow`, sem ANSI local.
- [x] Implementação: `/tools` default e diag passaram a renderizar estatísticas, categorias,
      superfícies, contrato, issues e lifecycle com `terminalThemeRow`, sem alinhamento manual por
      `padEnd`.
- [x] UX preservada: `report_intent_local` continua aparecendo como `Intenção capturada` no default
      e só revela o nome técnico em `/tools diag`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_help.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js`.
- [x] Varredura local confirmou ausência de ANSI literal em `/help`, `/tools` e fallback do
      roteador.
- [x] Live PTY visual ampliada executada cobrindo `/help`, `/help full`, `/tools`, `/tools diag`,
      `/sdk`, `/sdk capabilities`, `/workspace list`, `/live`, `/activity` e `/sdk waits`:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-help-tools-sdk-workspace-20260603-1425`.
  - Resultado automatizado: PASS.
  - Achado manual: `/workspace list` ainda imprimia uma linha duplicada legada com ANSI para
    `/workspace promote`.
- [x] Correção: removida a linha residual de `/workspace promote` em `cmdWorkspace` list/default.
- [x] Harness live reforçado: `ux-cycle-help-full-structured`, `ux-cycle-sdk-human`,
      `ux-cycle-sdk-capabilities-human` e `ux-cycle-workspace-human` agora cobrem as superfícies
      migradas; `ux-cycle-workspace-human` falha se voltar linha solta de `/workspace promote`.
- [x] Live PTY pós-correção executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-help-tools-sdk-workspace-clean-20260603-1427`.
  - Resultado: PASS.
  - Inspeção: `/workspace list` mostra apenas linhas `Uso` temáticas, sem ANSI residual.
- [x] Próxima lacuna: auditar `/events`, `/errors`, `/audit` e `/intent`, pois são superfícies
      diagnósticas onde nomes internos podem ser aceitáveis apenas em modo detail/raw.

### 11.40 Diagnósticos humanos em `/intent`, `/errors` e `/audit`

- [x] Achado: `/intent` já escondia `tool/call` no default, mas ainda usava badge/bullet manual e
      frase solta para estado vazio/clear.
- [x] Achado: `/errors` imprimia cada erro como linha manual com fonte entre colchetes, o que se
      aproximava da estética de log bruto.
- [x] Achado: `/audit` ainda usava `Audit Log`, `Sumário por tipo` e `padEnd` manual.
- [x] Decisão: comandos diagnósticos podem mostrar dados técnicos, mas o default precisa ter labels
      humanos; nomes internos completos ficam em detail/raw quando isso for parte explícita da
      investigação.
- [x] Implementação: `/intent` passou para `Intenções capturadas`, `Intenção`, `Contexto`, `Técnico`
      e `Uso`, preservando `origem bruta`, `ferramenta`, `chamada` e `registro` apenas em
      `/intent detail`.
- [x] Implementação: `/errors` agora renderiza cada erro com
      `terminalThemeRow(type, timestamp + fonte + mensagem)`, sem colchetes soltos.
- [x] Implementação: `/audit` passou de `Audit Log` para `Auditoria`, de `Sumário por tipo` para
      `Resumo por tipo`, e removeu `padEnd` manual.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_intent.spec.js tests/unit/copilot/terminal/test_commands_config_errors.spec.js`.
- [x] Próxima lacuna: revisar `/events` default contra vazamento desnecessário de IDs/filtros
      longos, preservando `--raw`, `--json`, `sources detail` e filtros explícitos como superfícies
      técnicas.

### 11.41 `/events` default alinhado sem perder diagnóstico

- [x] Achado: `/events` default já humanizava nomes de eventos, payload e fontes, mas a linha de
      cada evento ainda era montada manualmente com timestamp, `#id`, origem e detalhe colados.
- [x] Decisão: `/events` é diagnóstico por natureza, então pode manter `#eventId` e ids compactos
      quando filtros explícitos pedem; o default deve, porém, seguir a mesma malha visual das outras
      superfícies.
- [x] Implementação: eventos default agora usam
      `terminalThemeRow(humanEventLabel, timestamp + #id + origem + resumo)`.
- [x] Preservado: `--raw`, `--json`, filtros humanos (`source sdk tool call_123 request req-123`) e
      `sources detail` continuam superfícies técnicas explícitas.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [ ] Próxima lacuna: adicionar `/events` ao ciclo live visual ou criar mini ciclo diagnóstico que
      cubra `/events`, `/errors`, `/audit`, `/intent` sem poluir o ciclo default cotidiano.

### 11.42 Narrativa SDK sem badges técnicos

- [x] Achado: `sdk-session-events.js` já traduzia muitos eventos vanilla, mas ainda imprimia badges
      em colchetes como `TURNO`, `AÇÕES`, `ARQUIVOS`, `PERM`, `PERGUNTA`, `MAILBOX`, `MODELO`,
      `HOOK`, `SAMPLE`, `CMDS`, `CAPS`, `AUTO` e `PLAN`.
- [x] Achado: alguns caminhos ainda tinham ANSI literal em permissão, OAuth MCP, elicitation e
      conclusão de OAuth.
- [x] Decisão: eventos SDK importantes devem aparecer como linhas operacionais humanas (`Turno`,
      `Ações`, `Arquivos`, `Permissão`, `Pergunta`, `Mailbox`, `Modelo`, `Hook`, `Sampling`,
      `Comandos SDK`, `Capabilities`, `Auto mode`, `Plan mode`, `OAuth MCP`), não como tags
      técnicas.
- [x] Implementação: `session.info`, elicitation pending/completed, permission requested/completed,
      permission mode, OAuth MCP required/login/completed, sampling, commands/capabilities, auto
      mode, exit plan mode, hook failure e resumo de turno passaram a usar `terminalThemeRow`.
- [x] Varredura local confirmou ausência de ANSI literal e `terminalThemeBadge` em
      `src/copilot/terminal/events/sdk-session-events.js`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js tests/unit/copilot/terminal/test_intent_renderer.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js`.
- [x] Continuação: `tool-lifecycle-runtime.js` removeu ANSI literal de `Tool aguarda usuário`,
      `integração externa solicitada` e `integração externa concluída`, trocando por linhas
      `Tool`/`Integração`.
- [x] Testes escopados adicionais passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`.
- [ ] Próxima lacuna: executar live com cenário que gere pergunta/permissão/sampling/OAuth quando
      viável, para confirmar a estética de eventos SDK raros no terminal real.

### 11.43 Runtime do agente e renderers sem tags técnicas

- [x] Achado: `agent-runtime-events.js` ainda imprimia badges técnicos em eventos centrais:
      `PERGUNTA`, `LLM-B`, `BYOK`, `ERROR`, `MODEL`, `COMPACTAR`, `OK`, `FALHA`,
      `SUBAGENTE`, `PR`, `LLM`, `DIALOG`, `SESSION` e `COMMAND`.
- [x] Achado: esses rótulos eram exatamente o tipo de ruído observado nas screenshots: linhas
      parecidas com tool trace, desalinhadas semanticamente e misturando estado humano com
      identificadores internos.
- [x] Decisão: eventos operacionais do agente devem usar nomes humanos estáveis e curtos:
      `Pergunta ao operador`, `Sessão`, `Erro BYOK`, `Modelo`, `Contexto`, `Compactação`,
      `Subagente`, `Premium Request`, `Uso do modelo`, `Diálogo`, `Sessão SDK` e
      `Comando SDK`.
- [x] Implementação: `agent-runtime-events.js` passou a renderizar esses eventos com
      `terminalThemeRow`, preservando `recordTerminalActivity`, SSE, traces e health BYOK.
- [x] Implementação: erro recuperável de modelo deixa de imprimir `MODEL`; fallback passa a
      aparecer como `Modelo  fallback aplicado: origem -> destino`.
- [x] Implementação: boot recovery passa a aparecer como `Diálogo  boot recovery ...`, sem badge
      técnico.
- [x] Implementação: lifecycle SDK e comando SDK agora aparecem como `Sessão SDK` e
      `Comando SDK`, sem prefixos `SESSION`/`COMMAND`.
- [x] Achado: `intent-renderer.js` ainda imprimia `INTENÇÃO CAPTURADA`; o default agora mostra
      `Intenção  risco ... · origem ...`.
- [x] Achado: `io-activity-events.js` ainda imprimia `[ARQUIVO] [LER]`/`[MOVER]`; o default agora
      mostra `Arquivo  leitura/movimento · caminho · ok/falhou`.
- [x] Achado: `assistant-transcript-renderer.js` ainda imprimia badge `LLM-B`; o cabeçalho agora
      usa `terminalThemeRow(title, source + detail)`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_intent_renderer.spec.js tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.

### 11.44 Tool lifecycle, menu e GitHub sem badges visíveis no default

- [x] Achado: `tool-lifecycle-runtime.js` ainda mostrava `PERGUNTA`, badges de operação
      (`LER`, `CRIAR`, `MOVER`), status `OK`/`FALHA` e `SYNC`.
- [x] Achado: tools genéricas de baixa fidelidade podiam renderizar `callId=...` ou `tool#...`,
      vazando ID interno na superfície padrão.
- [x] Decisão: lifecycle de tool deve ser narrado como evento operacional, não como log de SDK:
      `Pergunta ao operador`, `Ferramenta`, `Concluído`, `Falhou` e `Sincronização`.
- [x] Implementação: início/progresso/fim de tool foram convertidos para `terminalThemeRow` onde
      havia badge técnico; detalhes semânticos de tool continuam preservados.
- [x] Implementação: quando a tool é genérica e só há ID técnico, o terminal mostra
      `Ferramenta interna` e orienta que detalhes técnicos estão em `/tools diag`, sem expor o ID
      no default.
- [x] Implementação: reconciliação de tool no fim do turno agora mostra
      `Sincronização  <tool> · conclusão inferida no fim do turno`.
- [x] Achado: `/menu` usava badge `AGIR`; agora usa texto humano `Agora` com papel de aviso.
- [x] Achado: `/gh` ainda tinha ANSI literal legado; um normalizador no dispatcher remove ANSI de
      toda saída do comando e traduz `[DRAFT]` para `Rascunho`.
- [x] Teste novo: `tests/unit/copilot/terminal/test_commands_gh.spec.js` cobre a normalização de
      ANSI/draft.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_gh.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_intent_renderer.spec.js`.
- [x] Live PTY `--ux-cycle` executado após o lote:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/default-ux-cycle-terminal-ux-clean-20260603-1511`.
  - Resultado: PASS em 16/16 critérios, incluindo `/help`, `/help full`, `/status`, `/now`,
        `/health`, `/tools`, `/sdk`, `/sdk capabilities`, `/workspace list`, `/live`,
        `/activity` e `/sdk waits`.
  - Logs: `artifacts/terminal-live/default-ux-cycle-terminal-ux-clean-20260603-1511/summary.md`.
- [x] Próxima lacuna: adicionar um ciclo diagnóstico curto para eventos de pergunta, tool, I/O e
      intenção, comparando a renderização real com as screenshots originais.

### 11.45 Linha viva de pergunta sem grito técnico

- [x] Achado live: o ciclo estruturado de `request_user_input` já escondia IDs e renderizava
      `/sdk waits` de forma humana, mas a linha viva ainda mostrava `LLM-B PERGUNTA`.
- [x] Decisão: o prompt compacto pode manter `[PERG]` como estado operacional curto, mas a linha
      viva deve usar frase humana em caixa normal.
- [x] Implementação: `live-status-line.js` agora renderiza pending question e
      `request_user_input` estruturado como `LLM-B Pergunta · ...`.
- [x] Harness live atualizado: critério `structured-input-live-status` agora exige a frase humana
      `Pergunta`, não o badge técnico `PERGUNTA`.
- [x] Teste unitário passou:
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js`.
- [x] Live PTY estruturado passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/structured-input-terminal-ux-question-human-20260603-1520`.
  - Resultado: PASS em 11/11 critérios, sem vazamento de `request_user_input`, IDs internos ou
        spam durável.
- [x] Próxima lacuna: construir ou ampliar um ciclo live para atividade real de tool/I/O/intent,
      preferencialmente sem consumir PR quando possível; quando exigir LLM real, executar apenas
      após o harness passivo e estruturado permanecerem verdes.

### 11.46 `/fs` temático e ciclo diagnóstico sem PR

- [x] Achado: `/fs` ainda usava ANSI literal direto em quase todas as superfícies (`Uso`,
      sucesso, falha, listagem, leitura, busca e I/O), apesar de ser um comando central para
      operações reais de arquivo.
- [x] Decisão: `/fs` deve seguir a mesma gramática visual do restante do terminal:
      `FS local`, `Arquivo`, `Item`, `FS search`, `resultados`, `I/O read/write/search`,
      `Próximo` e `Guia`.
- [x] Implementação: `src/copilot/terminal/commands/fs.js` foi migrado para `terminalThemeRow`,
      removendo ANSI literal sem mudar a execução das file-tools.
- [x] Implementação: os resumos de I/O preservam pistas operacionais úteis (`I/O write`,
      `I/O read`, `I/O search`) sem retornar a key-value cru.
- [x] Teste reforçado: `tests/unit/copilot/terminal/test_commands_fs.spec.js` agora valida ausência
      de ANSI nos caminhos create/read/list/search/failure.
- [x] Harness live ampliado: `model-gateway-terminal-llm-b-live-test.mjs` ganhou
      `--diagnostic-ux-cycle`, que executa `/fs create`, `/fs read`, `/fs search`,
      `/activity`, `/tools` e `/events` sem abrir turno LLM/PR.
- [x] Primeiro live diagnóstico identificou critério de ordem ruim em `FS search`; o critério foi
      corrigido de `I/O search -> resultados` para `resultados -> I/O search`.
- [x] Segundo live diagnóstico passou, mas ler `package.json` produzia log excessivo; o ciclo foi
      ajustado para ler o arquivo scratch pequeno criado no próprio teste.
- [x] Live PTY final passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-fs-io-events-small-20260603-1525`.
  - Resultado: PASS em 7/7 critérios.
  - Logs: `artifacts/terminal-live/diagnostic-ux-fs-io-events-small-20260603-1525/summary.md`.
- [x] Próxima lacuna: revisar `/events` e `/activity detail` para reduzir densidade de
      `rastreamento implicit`, `hub ...` e timestamps longos no default, mantendo tudo acessível
      em detail/raw.

### 11.47 `/events` default sem IDs densos

- [x] Achado live: `/events 12` default ainda mostrava `#eventId`, `rastreamento implicit:...`,
      `hub ...` e `turno ...` em todas as linhas, mesmo sem filtro explícito.
- [x] Decisão: `/events` é diagnóstico, mas o default deve ser escaneável; identificadores longos
      entram quando o operador pede filtros técnicos (`trace`, `turn`, `tool`, `request`, `hub`)
      ou raw/json.
- [x] Implementação: `cmdEvents` agora calcula `showDiagnosticIds` a partir dos filtros técnicos.
      Sem esses filtros, cada linha mostra tempo, origem humana e resumo do payload; com filtros,
      preserva `#id`, rastreamento, turno, hub e IDs compactos.
- [x] Implementação: hints de transcript também deixam de anexar rastreamento/turno no default,
      mantendo `export envelope` humano.
- [x] Teste atualizado:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Live diagnóstico repetido:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-events-id-guard-20260603-1528`.
  - Resultado: PASS; `/events` default passou a mostrar linhas como
        `Ferramenta  timestamp · io · ferramenta Leitura local · estado io op`, sem
        `rastreamento implicit`, `#id` e `hub`.
- [x] Harness reforçado: `diagnostic-ux-events-human` agora falha se o default voltar a mostrar
      IDs de tool crus, `rastreamento implicit`, `#id` ou `hub`.
- [x] Próxima lacuna: revisar `/activity` default/detail para separar melhor timeline humana de
      timeline técnica e reduzir truncamentos confusos em caminhos longos.

### 11.48 `/activity` com tempo humano no default e ISO só no detail

- [x] Achado: `/activity` default ainda imprimia timestamps ISO entre colchetes em I/O real e
      timeline recente. Na prática, isso fazia a tela parecer dump de log, justamente a estética
      ruim vista nas screenshots.
- [x] Decisão: o caminho padrão deve responder "o que aconteceu e há quanto tempo"; o modo
      `detail` responde "qual timestamp exato, engine e identificadores técnicos".
- [x] Implementação: `activity.js` passou a renderizar I/O e timeline como `há 4s`, `há 2m`,
      `há 3h`, `há 1d` no default.
- [x] Implementação: `/activity detail` preserva os timestamps ISO completos, engines de I/O,
      trace IDs e request IDs para auditoria profunda.
- [x] Implementação: a idade da atividade atual passou a usar duração compacta (`10s`, `2m`,
      `1h`) em vez de segundos crus potencialmente longos.
- [x] Implementação estrutural: `time-format.js` agora expõe helpers canônicos
      `formatTerminalRelativeAge` e `formatTerminalElapsedDuration`, evitando lógica local
      duplicada em comandos.
- [x] Implementação: `search` em I/O recente de `/activity` passou a aparecer como `busca`.
- [x] Implementação: `/events` default passou a usar idade relativa e reservou ISO para filtros
      técnicos/raw/json, alinhando o archive SSE com a mesma gramática visual de `/activity`.
- [x] Teste reforçado: `tests/unit/copilot/terminal/test_commands_activity.spec.js` agora garante
      que o default não contém timestamp ISO e que o modo `detail` continua contendo.
- [x] Teste reforçado: `tests/unit/copilot/terminal/test_commands_events.spec.js` agora cobre
      tempo relativo no resumo default sem remover timestamp técnico nos caminhos diagnósticos.
- [x] Harness live reforçado: `--diagnostic-ux-cycle` agora separa as superfícies de `/activity`,
      `/tools` e `/events`, e falha se `/activity` ou `/events` default voltarem a mostrar
      timestamp ISO.
- [x] Validação escopada passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-relative-time-events-20260603-1535`.
  - Resultado: PASS em 7/7; `/activity` e `/events` default ficaram sem ISO, IDs densos e
        badges técnicos.
- [x] Próxima lacuna: revisar `/tools` porque operações distintas ainda podiam colapsar em nomes
      repetidos como `Escrita local` para mkdir/write.
- [x] Implementação: `tool-activity-presenter.js` agora distingue `Pasta local`, `Escrita local`,
      `Leitura local`, `Busca local`, `Cópia local`, `Movimento local`, `Edição local` e
      `Exclusão local` para ferramentas `io.*`.
- [x] Testes reforçados:
  - `tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js` cobre os nomes granulares.
  - `tests/unit/copilot/terminal/test_commands_tools.spec.js` garante que `/tools` default não
        vaze motores `io-engine.*`.
- [x] Live PTY diagnóstico repetido:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-tools-granular-20260603-1537`.
  - Resultado: PASS em 7/7; `/tools` mostrou `Pasta local`, `Leitura local`, `Busca local` e
        `Escrita local`.
- [x] Próxima lacuna: revisar `/live` e `/session` porque ainda havia trechos com `Origem`,
      `phase/source`, timestamps ISO e detalhes técnicos em superfícies default.

### 11.49 `/live full` e painéis de sessão sem constantes internas

- [x] Achado live: `/live full` já era útil, mas ainda mostrava timestamp ISO em I/O/eventos,
      `search` em inglês, UUID cru de sessão SDK, `approve_all`, `empty` e `not_needed`.
- [x] Decisão: mesmo painéis detalhados devem ser operacionais e escaneáveis; IDs e estados crus
      pertencem a `/events --raw`, `/events --json`, `/session sdk` ou diagnósticos explícitos.
- [x] Implementação: `/live full` agora usa `formatTerminalRelativeAge` para I/O real e eventos
      recentes.
- [x] Implementação: `renderLiveOperationLabel` passou a traduzir `search` como `busca`.
- [x] Implementação: `session.js` ganhou normalizadores para permissões, presença de sessão SDK,
      origem/reconciliação da timeline e status de sync.
- [x] Implementação: `/live full` agora mostra `sessão ativa`, `permissões automáticas`,
      `sem histórico`, `sem divergência` e `sincronização dispensada`, em vez de UUID,
      `approve_all`, `empty` e `not_needed`.
- [x] Implementação: `/now full` e `/status full` passaram a reutilizar os mesmos rótulos humanos
      para permissões, timeline, sync e ações recomendadas.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-live-full-labels-20260603-1543`.
  - Resultado observado: `/live full` exibiu `Sessão SDK interativo · sessão ativa · permissões
        automáticas` e `Timeline sem histórico · sem divergência · sincronização dispensada`.
- [x] Harness reforçado e live repetido:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-live-full-id-guard-20260603-1544`.
  - Resultado: PASS em 8/8; o critério `diagnostic-ux-live-full-human` agora falha se
        `/live full` voltar a mostrar ISO bracketado, `search`, `phase:`, `approve_all`,
        `empty`, `not_needed` ou UUID cru.
- [x] Próxima lacuna: revisar `/session sdk events` e `/session sdk waits`, porque ainda havia
      superfícies com timestamps ISO, `#eventId`, fontes cruas e IDs de pedido.

### 11.50 `/session sdk events/waits` como trilha agregada humana

- [x] Achado: `/session sdk events` resumiam archive SSE com linhas `#eventId`, fonte
      `agent/sdk.lifecycle`, tipos como `session.updated` e timestamp ISO como label da linha.
- [x] Achado: `/session sdk waits` expunha `#eventId`, `sdk/user_input.requested`, request IDs
      como `ask-1` e permissões como `fs.write`.
- [x] Decisão: esses comandos são agregadores operacionais; detalhes crus devem ficar em
      `/events --raw`/`--json`.
- [x] Implementação: `summarizeSdkSessionArchiveEntry` removeu `#eventId` e fonte crua da linha
      default, usando eventos humanos e tipos traduzidos como `sessão atualizada`.
- [x] Implementação: `summarizeSdkWaitArchiveEntry` removeu request/session IDs da linha default
      e traduz permissões como `fs.write` para `escrita de arquivo`.
- [x] Implementação: ambos os comandos usam `formatTerminalRelativeAge` e `terminalThemeRow`
      com labels fixos (`Evento`, `Espera`), evitando timestamps ISO como coluna primária.
- [x] Implementação: estados vazios deixaram de sugerir filtros crus (`event=sdk.lifecycle`,
      `event=user_input.requested`) e passaram a apontar para `/events sources` ou `/events --raw`.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/session sdk events 8` e
      `/session sdk waits 8`, com critérios contra event IDs, fontes SDK cruas, permissões cruas,
      ISO e UUIDs.
- [x] Correção no harness: extração das superfícies agora usa a ordem real dos comandos do ciclo,
      evitando capturar `/tools` ou `/events` citados no banner de boot.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-session-sdk-surface-order-20260603-1549`.
  - Resultado: PASS em 10/10 critérios.
- [x] Próxima lacuna: revisar `/history`, `/db-history` e `/db-sessions`, porque ainda havia
      timestamps ISO e linhas de histórico que pareciam export/log, não painel de leitura.

### 11.51 Histórico e DB sem aparência de export/log

- [x] Achado: `/history` imprimia linhas manuais com `[ISO]`, `[live]`, `mixed` e `reconciled`.
- [x] Achado: `/db-history` imprimia `[ISO]` e atores em formato de log.
- [x] Achado: `/db-sessions` imprimia `hub sessions`, timestamp ISO e prefixos de ID de sessão.
- [x] Implementação: `formatTerminalRelativeAge` agora aceita ISO string, além de number/Date.
- [x] Implementação: `renderTerminalActorLabel` trata `assistant` como `LLM-B`, evitando ator cru.
- [x] Implementação: timeline source/authority/reconciliation agora usa rótulos humanos como
      `misto`, `reconciliada`, `divergente`, `sem histórico` e `sem divergência`.
- [x] Implementação: `/history` e `/db-history` passaram para `terminalThemeRow`, com tempo
      relativo e sem badge `[live]`.
- [x] Implementação: `/db-sessions` passou a `Últimas N sessões persistidas`, status `ativa` /
      `concluída`, tempo relativo e sem IDs no default.
- [x] Teste escopado reforçado:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
  - Cobertura adicionada contra ISO em `/history`, `/db-history` e `/db-sessions`.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/history 6`,
      `/db-history 6` e `/db-sessions 6`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-db-sessions-no-ids-20260603-1555`.
  - Resultado: PASS em 13/13 critérios.
- [ ] Próxima lacuna: revisar `/count`, `/who`, `/clear` e comandos pequenos que ainda podem
      usar ANSI literal ou IDs compactos desnecessários.
