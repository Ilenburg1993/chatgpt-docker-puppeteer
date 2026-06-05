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
- [x] Próxima lacuna: revisar `/count`, `/who`, `/clear` e comandos pequenos que ainda podem
      usar ANSI literal ou IDs compactos desnecessários.

### 11.52 Comandos pequenos sem vazamento técnico nem ANSI cru

- [x] Achado: `/who` ainda misturava papel humano com detalhes de implementação (`stdin`,
      `POST http://localhost`, `GET /events`, `AlwaysAliveAgent`), criando ruído visual e
      reforçando a sensação de "dump de ferramenta" apontada nas screenshots.
- [x] Achado: `/count` mostrava ANSI literal, IDs compactos de hub/session SDK e labels em
      inglês (`Hub session`, `SDK session`), apesar de ser um comando de status rápido.
- [x] Achado: `/clear` imprimia escape ANSI manual e frase menos consistente com a gramática
      dos demais comandos de sessão.
- [x] Decisão: comandos pequenos devem ser micro-painéis operacionais; endpoints, agentes
      internos, IDs e códigos de cor só devem aparecer em diagnósticos explícitos.
- [x] Implementação: `/who` passou a mostrar `Você`, `LLM-A`, `LLM-B` e `Eventos` com descrições
      de função, usando porta como contexto humano em vez de URL HTTP crua.
- [x] Implementação: `/count` passou a usar `terminalThemeHeadline`, `terminalThemeDivider` e
      `terminalThemeRow`, com contagens por ator, memórias e presença de sessões como
      `hub ativa · SDK ativa`, sem IDs.
- [x] Implementação: `/count` sem sessão agora responde `nenhuma sessão persistida ativa` via
      tema do terminal, sem ANSI literal.
- [x] Implementação: `/clear` agora responde `Histórico  memória local limpa`, também via tema.
- [x] Teste escopado reforçado:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
  - Cobertura adicionada contra `AlwaysAliveAgent`, `POST http`, `Hub session` e `\x1b[` nos
        comandos pequenos.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/who`, `/count` e `/clear`
      após os painéis de histórico/DB.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-small-commands-20260603-1558`.
  - Resultado: PASS; `/who` mostrou atores humanos, `/count` mostrou estatísticas sem IDs e
        `/clear` confirmou memória local limpa sem ANSI cru.
- [x] Próxima lacuna: revisar `/session sdk` fora dos subcomandos `events/waits`, pois o
      inventário de sessões e ações de resume/next ainda pode expor índices, estados e
      metadados técnicos demais sem explicar o que o operador deve fazer.

### 11.53 `/session sdk` default como inventário operacional

- [x] Achado: o painel principal de `/session sdk` ainda imprimia `Foreground`, IDs de sessão,
      flags como `last`, `foreground`, `remote/local`, `probe-residue` e timestamps ISO.
- [x] Achado live: mesmo após remover IDs, o painel ainda vazava motivos técnicos como
      `sdk-resume-fallback-created-new-session` e `operator-next-boot-new-session`.
- [x] Decisão: `/session sdk` default deve ser uma lista acionável com alças `#n`, status em
      português e tempo relativo; IDs crus e diagnósticos de baixo nível pertencem a comandos
      explícitos.
- [x] Implementação: `resolveSdkSessionResumeTarget` passou a aceitar atalhos em português
      (`atual`, `última`, `primeiro-plano`) sem quebrar os atalhos antigos.
- [x] Implementação: o topo do painel passou a mostrar `Atual`, `Última usada` e `Primeiro
      plano` como `sessão #n`, `ausente` ou `sessão não listada nesta página`, em vez de IDs.
- [x] Implementação: o inventário passou a renderizar badges como `atual`, `última usada`,
      `em primeiro plano`, `diagnóstico antigo`, `local` e `remota`.
- [x] Implementação: início/alteração de sessões passaram a usar tempo relativo.
- [x] Implementação: o resumo de sessão saiu da linha `Tempo` e ganhou linha própria `Resumo`,
      reduzindo quebra visual e linhas desalinhadas.
- [x] Implementação: razões de boot/metadados passaram por normalizador humano, traduzindo
      códigos como `provider-boundary`, `operator-next-boot-new-session` e
      `sdk-resume-fallback-created-new-session`.
- [x] Implementação: provedores em metadados passaram a aparecer como `GitHub Copilot`, `BYOK`
      ou `OpenAI`, quando aplicável.
- [x] Implementação: probes antigos agora reconhecem sufixos como `BYOK_PROBE_OK` e aparecem
      como `diagnóstico antigo`.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
  - Cobertura reforçada contra IDs/ISO/flags cruas no default e contra códigos de motivo crus.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/session sdk 6` e adiciona o
      critério `diagnostic-ux-session-sdk-inventory-human`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=120000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-session-sdk-reasons-20260603-1608`.
  - Resultado: PASS em 15/15 critérios; `/session sdk` mostrou alças `#n`, tempo relativo,
        `Última usada`, `Primeiro plano`, motivo de boot traduzido e metadados sem códigos crus.
- [x] Próxima lacuna: auditar `/sdk` e `/scope`, pois buscas no código ainda indicam ANSI
      literal, IDs de sessão em linhas default e nomes técnicos que podem reaparecer na UX.

### 11.54 `/scope` e `/sdk status` no mesmo idioma visual do terminal

- [x] Achado: `/scope` ainda usava ANSI manual em todas as rotas principais (`declare`, `list`,
      `context`, `find`, `refresh`, `close`, uso e erro).
- [x] Achado: `/scope` imprimia `ready`, `warming`, bullets manuais e aparência de log, destoando
      do restante da UX que já usa `terminalThemeRow`.
- [x] Achado: `/sdk status` imprimia ID cru da sessão SDK e reset de quota em ISO no painel
      principal.
- [x] Decisão: `/scope` pode manter o nome do escopo quando ele é a alça operacional escolhida
      pelo operador, mas deve abandonar ANSI cru, key=value legado e estados em inglês.
- [x] Implementação: `/scope declare` passou a exibir `Escopo declarado`, `Escopo`, `Fonte`,
      `Opções` e estatísticas via tema.
- [x] Implementação: `/scope list`, `/scope context`, `/scope find`, `/scope refresh` e
      `/scope close` passaram a usar `terminalThemeHeadline`/`terminalThemeRow`.
- [x] Implementação: tipos de símbolo passaram a ser traduzidos (`função`, `classe`, `método`,
      `constante`, `variável`).
- [x] Implementação: estados `ready`/`warming` passaram a `pronto`/`aquecendo`.
- [x] Implementação: `/sdk status` e `/sdk prompt` passaram a renderizar presença de sessão
      (`sessão ativa`) em vez de ID cru.
- [x] Implementação: resets de quota SDK passaram a usar tempo relativo (`há 3s`, `em 2m`) em
      vez de timestamp ISO no status default.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_scope.spec.js`.
  - Cobertura reforçada contra ANSI, `sdk-1`, ISO de reset e key=value legado.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/sdk status` e o fluxo
      `/scope declare/context/find/close`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=150000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-sdk-quota-relative-20260603-1615`.
  - Resultado: PASS em 17/17 critérios; `/sdk status` ficou sem ID/ISO e `/scope` ficou sem ANSI
        literal ou labels `ready/warming`.
- [x] Próxima lacuna: revisar `/permission`, `/plan`, `/queue`, `/mailbox` e superfícies de
      intervenção humana, porque ainda são as áreas mais propensas a repetir tool names,
      permissões cruas e prompts que parecem "outra tool qualquer".

### 11.55 Permissões sem constantes cruas no painel operacional

- [x] Achado: `/permission mode` ainda mostrava `approve_all`, `audit_only` e `selective`.
- [x] Achado: `/permission list`, `/permission pending`, `/permission show` e `/permission cockpit`
      ainda mostravam tipos como `file_write`, decisões como `approve-once`/`approved` e
      timestamps ISO.
- [x] Decisão: comandos de permissão devem deixar claro ao operador se o sistema está em
      autorização automática, auditoria sem janelas ou modo seletivo; constantes do SDK ficam
      restritas a comandos de ação quando inevitáveis.
- [x] Implementação: normalizadores canônicos de modo, tipo e decisão de permissão foram
      adicionados em `sdk.js`.
- [x] Implementação: `/permission mode` passou a mostrar `automáticas`, `auditoria sem janelas`
      e `seletivas`, aceitando aliases humanos como `automatico`, `auditoria` e `seletivo`.
- [x] Implementação: `/permission list/show/pending/cockpit` passou a traduzir `file_write` para
      `escrita de arquivo`, `shell` para `execução no terminal`, `approve-once` para
      `aprovada uma vez` e equivalentes.
- [x] Implementação: `Criada`, `Concluída` e mudanças de modo passaram a usar tempo relativo.
- [x] Implementação: labels como `Requisição` passaram a `Alça`, reduzindo a aparência de dump de
      request interno.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
  - Cobertura reforçada contra `approve_all`, `file_write`, `approved`, `approve-once` e ISO nos
        painéis default relevantes.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/permission mode` e
      `/permission cockpit`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=160000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-permission-human-20260603-1620`.
  - Resultado: PASS em 18/18 critérios; o painel mostrou `automáticas`, `sem janelas SDK por
        padrão` e nenhum `approve_all`, `file_write`, `requestId` ou timestamp ISO.
- [x] Próxima lacuna: revisar os fluxos de `/queue`, `/mailbox`, `/interrupt` e aplicação
      automática de intervenção humana, reduzindo termos `mailbox zero-PR`, IDs de entry e
      repetição visual quando uma pergunta estruturada aguarda resposta.

### 11.56 Fila de intervenção sem jargão de mailbox

- [x] Achado: `/queue`, `/mailbox`, `/interrupt`, `/steer` bloqueado e drain automático ainda
      imprimiam `mailbox zero-PR`, `runtime default`, `source/modeHint`, `[mailbox→turn]` e ANSI
      manual em alguns caminhos.
- [x] Decisão: a UX deve falar em `fila de intervenção` e `próxima pergunta humana`; mailbox,
      entryId e modeHint são detalhes internos de implementação.
- [x] Implementação: `repl-command-router.js` ganhou renderizadores de origem e modo de
      intervenção.
- [x] Implementação: `/queue` agora confirma `intervenção guardada para a próxima pergunta
      humana`.
- [x] Implementação: `/mailbox status`, `/mailbox consume` e `/mailbox clear` agora renderizam
      `Fila de intervenção`, sem runtime ID no default.
- [x] Implementação: `/steer` bloqueado e `/interrupt` em política de preservação passaram a
      falar em intervenção/substituição guardada, não em mailbox.
- [x] Implementação: `deliverEntryAsTurnIfIdle` deixou de imprimir ANSI e `[mailbox→turn]`,
      usando `terminalThemeRow('Fila de intervenção', ...)`.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` agora executa `/queue`, `/mailbox status` e
      `/mailbox clear`, sem abrir novo turno de modelo.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-intervention-queue-20260603-1625`.
  - Resultado: PASS em 19/19 critérios; a superfície mostrou `Fila de intervenção`, `origem
        terminal`, `fila`, e não mostrou `mailbox zero-PR`, runtime ID, `modeHint`, `entryId` ou
        ANSI.
- [x] Próxima lacuna: revisar textos do banner/help/menu que ainda ensinam `mailbox zero-PR`,
      além de eventos de aplicação automática em `sdk-session-events.js` que ainda citam mailbox.

### 11.57 Banner, help e aplicação automática alinhados à fila de intervenção

- [x] Achado: o banner inicial ainda ensinava `texto livre → fila zero-PR`.
- [x] Achado: `/help` ainda descrevia `/queue`, `/interrupt` e `/mailbox` como operações de
      `mailbox zero-PR`.
- [x] Achado: eventos de aplicação automática em `sdk-session-events.js` ainda registravam
      `Mailbox zero-PR aplicado em ask_user`.
- [x] Implementação: banner curto passou a `texto livre → fila de intervenção`.
- [x] Implementação: `/help` passou a explicar `/queue` como intervenção guardada para a próxima
      pergunta humana e `/mailbox` como fila de intervenção.
- [x] Implementação: eventos de aplicação automática passaram a `Fila de intervenção aplicada em
      pergunta humana`.
- [x] Implementação: comentários e exemplos internos foram alinhados para evitar regressão de
      nomenclatura.
- [x] Harness live reforçado: `diagnostic-ux-no-old-intervention-jargon` falha se o terminal
      voltar a mostrar `mailbox zero-PR`, `texto livre → fila zero-PR` ou `[mailbox`.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-intervention-jargon-20260603-1628`.
  - Resultado: PASS em 20/20 critérios; banner, help e ciclo `/queue`/`/mailbox` não exibiram
        `mailbox zero-PR`, `texto livre → fila zero-PR`, `[mailbox`, IDs de runtime ou ANSI.

## 12. UX v2: terminal como produto operacional elegante

### 12.1 Diagnóstico consolidado da virada UX

- [x] Entrada nova do operador: a prioridade passa a ser uma revolução de UX do terminal, não apenas
      remoção incremental de IDs.
- [x] Requisito novo: superfícies operacionais devem mostrar tanto ISO 8601 completo até segundos
      quanto tempo relativo, com configuração central para futura troca de direção.
- [x] Requisito novo: a linha viva deve permanecer fora do input, sempre pronta, mostrando estados
      nobres da LLM-B: pensando, usando tools, carregando contexto, aguardando operador, emitindo
      deltas, finalizando resposta, trocando modelo e reconfigurando BYOK.
- [x] Requisito novo: `request_user_input`/`ask_user` não são tools comuns na UX; devem aparecer
      como pergunta humana/decisão do operador, com persistência clara e sem repetição.
- [x] Requisito novo: `report_intent` não deve aparecer como nome visual primário; a superfície deve
      falar em `Intenção da LLM-B` ou `Intenção capturada`, com risco e origem humana.
- [x] Requisito novo: seleção/troca automática de modelo e vínculo BYOK devem virar eventos de
      primeira classe no terminal, com explicação clara do configurado, efetivo, cobrado, fallback,
      mismatch e handoff.

### 12.2 Situação atual observada em código e live PTY

- [x] Live PTY de 2026-06-03 mostrou melhora grande nas superfícies de `/fs`, `/activity`,
      `/events`, `/session sdk`, `/permission`, `/scope`, `/queue` e `/mailbox`.
- [x] Gap observado na live: `/session sdk events` ainda exibiu `session deleted · sessão sessão
      ativa`, demonstrando que lifecycle SDK ainda precisava de tradução semântica.
- [x] Gap observado em código: o boot prompt ainda ensinava `Mailbox zero-PR` para a LLM-B, criando
      risco de a própria LLM repetir jargão antigo.
- [x] Gap observado em código: `mailbox-drain`, `repl-lifecycle`, `terminal-agent-wiring` e
      comandos de intervenção ainda continham mensagens ou comentários visíveis com `mailbox`/
      `zero-PR` em caminhos de borda.
- [x] Gap observado em arquitetura: a função de tempo existente separava `formatTerminalIsoTimestamp`
      e `formatTerminalRelativeAge`, mas não havia contrato único para "ISO + relativo" configurável.
- [x] Gap observado em testes live: critérios antigos reprovavam ISO no default; eles precisarão ser
      revisados para exigir ISO até segundos + relativo e continuar proibindo IDs/tool names crus.

### 12.3 Situação ideal UX v2

- [ ] Tempo canônico: todos os eventos e timelines humanos devem usar uma API central como
      `formatTerminalTimeLabel`, com `dual` como default operacional: `YYYY-MM-DDTHH:mm:ss-03:00
      (há 4s)`.
- [ ] Linha viva: deve usar duração compacta por ergonomia (`12s`, `2m03s`) e nunca roubar o input;
      histórico e painéis persistentes devem usar ISO+relativo.
- [ ] Tema: cada papel deve ter cor estável: operador, LLM-B, thinking, tool, pergunta, erro, aviso,
      sucesso, arquivo leitura/escrita/edição/exclusão, modelo/BYOK.
- [ ] Layout: comandos devem usar `terminalThemeHeadline`, `terminalThemeRow`,
      `terminalThemeDivider` e blocos atômicos; ANSI manual só pode existir em adaptadores centrais.
- [x] Perguntas humanas: `ask_user` e `request_user_input` devem ter painel próprio, sem parecer
      tool genérica, com resposta pendente única, escolhas claras e erro de timeout acionável.
- [ ] Intenções: `report_intent`/`assistant.intent` devem renderizar uma única intenção deduplicada,
      com nome humano, risco, origem e sem `toolCallId` no default.
- [ ] Modelos/BYOK: seleção automática, handoff, mismatch, fallback, quota e provider efetivo devem
      aparecer como narrativas breves e auditáveis no terminal.
- [x] Live tests: o harness PTY deve validar visualmente os contratos de tempo, nomes humanos,
      ausência de IDs crus, ausência de spam e preservação do input.

### 12.4 Roadmap operacional UX v2

- [x] Fase 12.4.A: criar contrato central de tempo `formatTerminalTimeLabel`.
- [x] Fase 12.4.A.1: suportar modos `dual`, `iso`, `relative` e `elapsed`.
- [x] Fase 12.4.A.2: suportar ISO com precisão configurável, defaultando para segundos no modo
      humano dual.
- [x] Fase 12.4.A.3: exportar a API pelos barrels do terminal.
- [x] Fase 12.4.B: migrar `/activity` para tempo dual nas timelines persistentes.
- [x] Fase 12.4.C: migrar `/events` para tempo dual no default e ISO até segundos em filtro
      diagnóstico.
- [x] Fase 12.4.D: migrar `/live full`, `/history`, `/db-history`, `/db-sessions`,
      `/session sdk events` e `/session sdk waits` para tempo dual.
- [x] Fase 12.4.E: traduzir lifecycle SDK `session.created/deleted/foreground/background` no
      agregador de eventos de sessão.
- [x] Fase 12.4.F: remover `Mailbox zero-PR` do boot prompt e alinhar a linguagem interna à fila de
      intervenção.
- [x] Fase 12.4.G: atualizar harness live para exigir tempo dual em superfícies default.
- [x] Fase 12.4.H: adicionar testes unitários para a API de tempo e comandos migrados.
- [x] Fase 12.4.I: rodar live PTY focada em tempo dual, lifecycle SDK e intervenção.
- [ ] Fase 12.4.J: auditar `/status`, `/now`, `/health`, `/diagnose`, `/byok`, `/model` e
      `/reasoning` contra o novo contrato visual.
- [x] Fase 12.4.K: projetar painel próprio de pergunta humana para reduzir repetição e timeout sem
      resposta.
- [ ] Fase 12.4.L: projetar faixa de modelo/BYOK na linha viva e nos eventos persistentes.
- [x] Fase 12.4.M: depois da estabilização UX/terminal/BYOK, iniciar investigação formal de libs
      externas (`gum`, `fzf`, `bat`, `glow`, `delta`, `atuin`, `zoxide`, `jq`, `yq`) em documento
      separado antes de qualquer adoção.

### 12.5 Evidência da primeira rodada UX v2

- [x] Implementação: `time-format.js` passou a expor `formatTerminalTimeLabel`, com modos
      `dual`, `iso`, `relative` e `elapsed`.
- [x] Implementação: ISO humano dual usa precisão até segundos por padrão, evitando ruído de
      milissegundos em telas persistentes.
- [x] Implementação: parser de timestamp aceita `Date`, número, ISO string e string numérica,
      corrigindo o bug `tempo inválido` observado em `/db-sessions`.
- [x] Implementação: `/activity`, `/live full`, `/events`, `/history`, `/db-history`,
      `/db-sessions`, `/session sdk events`, `/session sdk waits` e inventário SDK passaram a usar
      ISO+relativo nas linhas de timeline.
- [x] Implementação: lifecycle SDK `session.created/deleted/updated/foreground/background` passou
      a ser traduzido em `/session sdk events` e `/events`.
- [x] Implementação: boot prompt e superfícies de intervenção deixam de ensinar `Mailbox zero-PR`
      como linguagem operacional.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_time_format.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - Resultado: 4 arquivos, 63 testes.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-time-dual-20260603-1717`.
  - Resultado: PASS em 20/20 critérios, exigindo ISO até segundos + tempo relativo e bloqueando
        regressões como `tempo inválido`, `session deleted`, `sessão sessão`, IDs crus e jargão
        antigo de mailbox.

### 12.6 Próxima faixa: pergunta humana como card nobre

- [x] Achado: há pelo menos três produtores visuais de pergunta humana: `sdk-session-events.js`,
      `agent-runtime-events.js` e `tool-lifecycle-runtime.js`.
- [x] Achado: esses produtores usam layouts diferentes (`Pergunta`, `Pergunta ao operador`,
      linhas soltas de ação/atalho), o que aumenta a chance de duplicação visual e sensação de
      tool genérica.
- [x] Decisão: `ask_user` e `request_user_input` devem ter um card compartilhado, com título,
      pergunta, opções, estado e ação, usando o mesmo tema e o mesmo contrato de tempo dual.
- [x] Implementar `human-question-renderer.js` como renderer único de pergunta humana.
- [x] Migrar `sdk-session-events.js` para usar o card quando uma pergunta real for solicitada.
- [x] Migrar `agent-runtime-events.js` para usar o card em replay/restauração.
- [x] Migrar `tool-lifecycle-runtime.js` para usar o mesmo card compacto quando a tool se
      materializar como lifecycle.
- [x] Reforçar testes para garantir ausência de `ask_user SDK`, `request_user_input`, IDs crus e
      cards duplicados no ciclo de pergunta.
- [x] Rodar live PTY específica com `--structured-input-cycle` e, quando pronto, cenários reais de
      `ask_user` com a LLM-B.

### 12.7 Evidência da faixa de pergunta humana

- [x] Implementação: `human-question-renderer.js` passou a ser o renderer compartilhado para
      perguntas humanas, com `Pergunta ao operador`, `[PERGUNTA]`, opções numeradas, ação clara,
      atalhos úteis e tempo dual.
- [x] Implementação: `sdk-session-events.js`, `agent-runtime-events.js`,
      `tool-lifecycle-runtime.js` e `/sdk simulate request-user-input` passaram a usar o mesmo
      card, reduzindo paralelismo visual entre pergunta real, replay, lifecycle e diagnóstico.
- [x] Implementação: o harness live foi atualizado para separar superfície default, diagnóstico e
      raw. IDs crus continuam proibidos na UX default, mas `/events --raw` pode expor JSON e
      `toolCallId` como diagnóstico explícito.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_human_question_renderer.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_state.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js tests/unit/copilot/terminal/test_pending_question_answer.spec.js`.

### 12.18 Investigação formal de libs auxiliares

- [x] Documento canônico complementar criado:
      `src/copilot/docs/terminal/TERMINAL_AUXILIARY_LIBS_INTEGRATION_AUDIT_2026-06-03.md`.
- [x] Fontes oficiais consultadas para `gum`, `fzf`, `bat`, `glow`, `delta`, `atuin`,
      `zoxide`, `jq` e `yq`.
- [x] Decisão arquitetural: adoção começa por detecção/capability registry, não por uso de TUI.
- [x] Decisão arquitetural: nenhuma lib externa será obrigatória ou instalada automaticamente.
- [x] Decisão arquitetural: `fzf`, `bat`, `glow`, `delta`, `jq` e `yq` são aceitos como
      enriquecimentos opcionais; `gum` é aceito com guardas; `atuin` e `zoxide` ficam adiados por
      alterarem estado de shell/histórico/navegação.
- [x] Decisão UX: pickers/pagers externos só podem ocorrer por comando explícito ou preferência,
      nunca durante streaming automático da LLM-B ou pergunta humana pendente.
- [x] Próxima implementação: criar registry read-only de capacidades externas.
- [x] Próxima implementação: criar comando humano/JSON para inspecionar libs disponíveis,
      decisões e fallbacks.
- [x] Implementação: `terminal/capabilities/external-tools.js` detecta `gum`, `fzf`, `bat`,
      `batcat`, `glow`, `delta`, `atuin`, `zoxide`, `jq` e `yq` por `PATH`, com version probe,
      cache e `defaultEnabled=false`.
- [x] Implementação: `/terminal libs` e `/libs` mostram superfície humana compacta, `detail`,
      `json` e `refresh`.
- [x] Implementação: `/help` e `/menu` expõem a nova superfície canônica.
- [x] Testes escopados passaram:
      `npx vitest run tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js tests/unit/copilot/terminal/test_repl_command_router_routes.spec.js`.
- [x] Resultado: 5 arquivos, 17 testes.
- [x] Próxima implementação: adapter read-only de preview, começando por `bat`/`batcat` com
      fallback JS.
- [x] Implementação: `terminal/capabilities/file-preview.js` oferece preview read-only explícito
      com `bat`/`batcat`, fallback JS, timeout, `maxBuffer` e limite de linhas.
- [x] Implementação: `/fs preview <path>` e `/fs read <path> --preview` usam o adapter sem alterar
      `/fs read` default.
- [x] Achado de execução real: `read_file_content` imprimia log técnico cru antes da superfície
      humana de `/fs preview`.
- [x] Correção: `read_file_content` ganhou `quietLog` opcional e `/fs` o utiliza para não duplicar
      I/O que já é apresentado pelo terminal.
- [x] Testes escopados adicionais passaram:
      `npx vitest run tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js`.
- [x] Resultado: 4 arquivos, 17 testes.
- [x] Testes escopados após `quietLog` passaram:
      `npx vitest run tests/unit/copilot/terminal/test_commands_fs.spec.js tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js`.
- [x] Resultado: 3 arquivos, 15 testes.
- [x] Lint escopado passou nos arquivos alterados de terminal/capabilities/commands e testes.
- [x] Typecheck strict de `src/copilot` passou:
      `npm run typecheck:strict:src.copilot`.
- [x] Live PTY diagnóstico passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=190000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-aux-libs-20260603-1950`.
- [x] Resultado live: PASS em 24/24 critérios, incluindo `diagnostic-ux-fs-preview` e
      `diagnostic-ux-terminal-libs`.
- [x] Próxima implementação: detecção fina de arquivo binário antes de preview externo.
- [x] Implementação: `file-preview.js` omite conteúdo com NUL, bytes inválidos ou muitos
      caracteres de controle antes de chamar `bat`/`batcat` ou fallback textual bruto.
- [x] Testes/lint D.5 passaram:
      `node --check src/copilot/terminal/capabilities/file-preview.js && npx eslint src/copilot/terminal/capabilities/file-preview.js tests/unit/copilot/terminal/test_file_preview.spec.js`.
- [x] Testes D.5 passaram:
      `npx vitest run tests/unit/copilot/terminal/test_file_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Resultado: 2 arquivos, 9 testes.
- [x] Próxima implementação: adapter Markdown explícito com `glow`, mantendo fallback texto.
- [x] Implementação: `terminal/capabilities/markdown-preview.js` renderiza Markdown com `glow`
      via stdin, sem pager/TUI automático, e fallback JS com truncamento.
- [x] Implementação: `/fs preview <path> --markdown` e `/fs read <path> --preview --markdown`
      ativam Markdown explicitamente.
- [x] Testes/lint Faixa E passaram:
      `node --check src/copilot/terminal/capabilities/markdown-preview.js && node --check src/copilot/terminal/commands/fs.js && npx eslint src/copilot/terminal/capabilities/markdown-preview.js src/copilot/terminal/commands/fs.js tests/unit/copilot/terminal/test_markdown_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Testes Faixa E passaram:
      `npx vitest run tests/unit/copilot/terminal/test_markdown_preview.spec.js tests/unit/copilot/terminal/test_file_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Resultado: 3 arquivos, 13 testes.
- [x] Typecheck strict de `src/copilot` passou após Faixa E.
- [x] Implementação: `terminal/capabilities/diff-preview.js` renderiza unified diff com `delta`
      via stdin, sem pager, e fallback JS com truncamento.
- [x] Implementação: `/git diff [--staged] [--plain] [file]` e `/gh pr diff <n> [--plain]`
      usam o adapter comum, com cabeçalho humano e renderer explícito.
- [x] Achado live corrigido: os bridges Git de leitura/escrita executavam a partir de `/src`,
      mas o operador usa paths repo-relativos; ambos agora executam na raiz do repositório.
- [x] Testes/lint Faixa F passaram:
      `node --check src/copilot/bridges/git-bridge-read.js && node --check src/copilot/bridges/git-bridge-write.js && node --check src/copilot/terminal/capabilities/diff-preview.js && node --check src/copilot/terminal/commands/git.js && node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Lint escopado Faixa F passou:
      `npx eslint src/copilot/bridges/git-bridge-read.js src/copilot/bridges/git-bridge-write.js src/copilot/terminal/capabilities/diff-preview.js src/copilot/terminal/commands/git.js src/copilot/terminal/commands/gh.js tests/unit/copilot/terminal/test_diff_preview.spec.js tests/unit/copilot/terminal/test_commands_git.spec.js tests/unit/copilot/terminal/test_commands_gh.spec.js`.
- [x] Testes Faixa F passaram:
      `npx vitest run tests/unit/copilot/terminal/test_diff_preview.spec.js tests/unit/copilot/terminal/test_commands_git.spec.js tests/unit/copilot/terminal/test_commands_gh.spec.js`.
- [x] Resultado: 3 arquivos, 8 testes.
- [x] Live PTY Faixa F passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-diff-preview-20260603-2030`.
- [x] Resultado live: PASS em 26/26 critérios, incluindo `diagnostic-ux-git-diff-preview`.
- [x] Implementação: `terminal/capabilities/structured-preview.js` renderiza JSON/YAML com
      `jq`/`yq` opcionais e fallback JS/`js-yaml`.
- [x] Implementação: `/fs preview <path> --json|--yaml [--query filtro] [--plain]` ativa
      preview estruturado explicitamente sem alterar `/fs read` default.
- [x] Segurança: `jq`/`yq` rodam por stdin e array de args; `yq` desativa operações de arquivo/env.
- [x] Testes/lint Faixa H passaram:
      `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs && node --check src/copilot/terminal/capabilities/structured-preview.js && node --check src/copilot/terminal/commands/fs.js`.
- [x] Lint escopado Faixa H passou:
      `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs src/copilot/terminal/capabilities/structured-preview.js src/copilot/terminal/commands/fs.js tests/unit/copilot/terminal/test_structured_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Testes Faixa H passaram:
      `npx vitest run tests/unit/copilot/terminal/test_structured_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Resultado: 2 arquivos, 12 testes.
- [x] Typecheck strict de `src/copilot` passou após Faixa H.
- [x] Live PTY Faixa H passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=240000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-structured-preview-20260603-2040`.
- [x] Resultado live: PASS em 28/28 critérios, incluindo `diagnostic-ux-fs-json-preview` e
      `diagnostic-ux-fs-yaml-preview`.
- [x] Implementação: `terminal/capabilities/picker-plan.js` cria planner seguro para pickers
      externos, separando modo textual, bloqueio por pergunta pendente e autorização interativa
      explícita.
- [x] Implementação: `/menu picker` usa o planner e renderiza uma opção textual segura quando o
      terminal ainda nao possui handoff exclusivo de TTY para `fzf`/`gum`.
- [x] Harness live ampliado: `--diagnostic-ux-cycle` executa `/menu picker` e adiciona o critério
      `diagnostic-ux-menu-picker-guard`, que reprova lançamento indevido de TUI externa no prompt vivo.
- [x] Testes/lint Faixa G.0 passaram:
      `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs && node --check src/copilot/terminal/capabilities/picker-plan.js && node --check src/copilot/terminal/commands/menu.js`.
- [x] Lint escopado Faixa G.0 passou:
      `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs src/copilot/terminal/capabilities/picker-plan.js src/copilot/terminal/commands/menu.js tests/unit/copilot/terminal/test_picker_plan.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js`.
- [x] Testes Faixa G.0 passaram:
      `npx vitest run tests/unit/copilot/terminal/test_picker_plan.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js`.
- [x] Live PTY Faixa G.0 passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-picker-guard-20260603-2050`.
- [x] Resultado live: PASS em 29/29 critérios, incluindo `diagnostic-ux-menu-picker-guard`.
- [x] Implementação: `readTerminalExclusiveTtyReadiness()` e `withTerminalExclusiveTty()`
      centralizam o handoff de TTY no output layer, bloqueando TTY ausente, turno ativo,
      render lock e input humano parcialmente digitado.
- [x] Implementação: o router do REPL passa a prontidão real para `/menu picker`, que agora pode
      explicar bloqueios concretos além da guarda textual genérica.
- [x] Achado live corrigido: `/menu picker` nao deve transformar o render lock do próprio
      dispatcher em bloqueio visível; a leitura de prontidão ignora esse lock externo no router.
- [x] Testes Faixa G.5 base passaram:
      `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js tests/unit/copilot/terminal/test_picker_plan.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js`.
- [x] Resultado: 3 arquivos, 20 testes.
- [x] Lint escopado Faixa G.5 base passou:
      `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/dialog/index.js src/copilot/terminal/repl/repl-command-router.js src/copilot/terminal/commands/menu.js src/copilot/terminal/capabilities/picker-plan.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js tests/unit/copilot/terminal/test_picker_plan.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js`.
- [x] Live PTY Faixa G.5 base passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-exclusive-tty-20260603-2040`.
- [x] Resultado live: PASS em 29/29 critérios, incluindo `diagnostic-ux-menu-picker-guard`.
- [x] Implementação: `picker-runner.js` adiciona executor opt-in para `fzf`/`gum`, sem shell livre,
      com seleção, cancelamento, falha e retorno desconhecido tratados explicitamente.
- [x] Implementação: `/menu picker --interactive` usa `withTerminalExclusiveTty()`; `/menu picker`
      continua sendo guarda textual por padrão para nao sequestrar a linha viva.
- [x] Harness reforçado: `diagnostic-ux-menu-picker-guard` reprova se `/menu picker` voltar a expor
      o falso bloqueio `renderização terminal em andamento`.
- [x] Testes Faixa G.6 passaram:
      `npx vitest run tests/unit/copilot/terminal/test_picker_runner.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js tests/unit/copilot/terminal/test_picker_plan.spec.js`.
- [x] Resultado: 3 arquivos, 15 testes.
- [x] Live PTY Faixa G.6 passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-picker-runner-guard-20260603-2045`.
- [x] Resultado live: PASS em 29/29 critérios com `/menu picker` textual e sem falso bloqueio de
      render lock.
- [x] Achado live: `fzf` TUI completo em harness `script` fica bloqueado aguardando resposta
      `CSI 6n`; isso é limitação do pseudo-terminal automatizado, não do terminal do operador.
- [x] Implementação: `COPILOT_TERMINAL_PICKER_FILTER=Status` permite live automatizada do executor
      `fzf` sem abrir TUI completa, exercendo handoff, seleção e retorno ao prompt.
- [x] Live PTY filtrada do picker passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --picker-interactive-cycle --timeout-ms=90000 --transport=pty --out-dir=artifacts/terminal-live/picker-interactive-filtered-fzf-20260603-2110`.
- [x] Resultado live: PASS em 5/5 critérios; `fzf --filter` selecionou `Status completo`, restaurou
      o prompt e roteou `/status`.
- [ ] Próxima implementação: teste manual/assistido de TUI visual completa em terminal real para
      seleção/cancelamento de `fzf` e, quando instalado, `gum`.
- [x] Live PTY estruturado passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --timeout-ms=150000 --transport=pty --out-dir=artifacts/terminal-live/structured-question-card-20260603-1723`.
  - Resultado: PASS em 11/11 critérios, cobrindo prompt `[PERGUNTA]`, resposta roteada, waits
        limpos e ausência de `request_user_input`/IDs no default.
- [x] Live PTY canônico com LLM-B real passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=210000 --transport=pty --out-dir=artifacts/terminal-live/canonical-human-question-card-20260603-1731`.
  - Resultado: PASS em todos os critérios; a pergunta real foi renderizada por uma única fonte SDK,
        a resposta humana não apareceu como fala da LLM-B, o export preservou autoria humana e o
        SSE manteve correlação de `traceId`.

### 12.8 Próxima faixa: diagnósticos densos e saúde visual

- [x] Achado live: `/health full` ainda usa caixa pesada com borda dupla e ANSI manual; está correto
      funcionalmente, mas destoante do tema minimalista das demais superfícies.
- [x] Achado live: `/tools diag` ainda expõe `Nome técnico`, `chamada chatcmpl-too…` e
      `requisição ...` por padrão dentro de diagnóstico explícito. Isso é aceitável para `diag`,
      mas precisa de hierarquia visual mais clara e opção default menos verborrágica.
- [x] Decisão: a próxima faixa deve preservar diagnósticos ricos, mas dividir claramente `default`,
      `detail` e `raw`, usando alças humanas estáveis no default e IDs apenas quando o operador
      pede detalhe.
- [ ] Fase 12.8.A: auditar `/health`, `/status`, `/now`, `/diagnose`, `/tools diag` e `/model` como
      superfícies de saúde/diagnóstico.
- [x] Fase 12.8.B: substituir caixa antiga de `/health full` por tema compartilhado ou painel
      compatível com `terminalThemeHeadline`, `terminalThemeRow` e `terminalThemeDivider`.
- [ ] Fase 12.8.C: criar glossário visual para `status`, `health`, `quota`, `BYOK`, `runtime alvo`,
      `permissão`, `MCP bridge`, `timers` e `lifecycle`.
- [ ] Fase 12.8.D: separar IDs técnicos em `/health detail`, `/tools raw` e `/events --raw`,
      preservando alças curtas em `/health` e `/tools diag`.
- [x] Fase 12.8.E: ampliar live PTY para validar `/health full` sem caixa antiga, sem desalinhamento
      e com nomes humanos nos blocos principais.

### 12.9 Evidência da saúde visual em `/health full`

- [x] Implementação: `/health full` passou a usar `terminalThemeHeadline`,
      `terminalThemeRow` e `terminalThemeDivider`, com blocos humanos `Agente`, `Atividade`,
      `Infraestrutura`, `Pendências` e `Ferramentas por latência`.
- [x] Implementação: a caixa dupla antiga foi removida da superfície full, mantendo o diagnóstico
      rico e preservando `/health` compacto como entrada operacional padrão.
- [x] Implementação: labels crus como `runtime id`, `sdk prompts=`, `quota monitor`,
      `keepalive`, `bg tasks` e `sdk↔fs route` continuam fora das superfícies humanas validadas.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.
  - Resultado: 1 arquivo, 5 testes.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-health-full-themed-20260603-1741`.
  - Resultado: PASS; o critério `diagnostic-ux-health-full-themed` confirmou ausência da caixa
        decorativa antiga e presença das seções temáticas principais.
- [ ] Lacuna remanescente: `diagnose.js` ainda usa ANSI manual em alguns valores internos antes de
      passá-los para `terminalThemeRow`; a próxima limpeza deve centralizar esses papéis no tema.
- [ ] Lacuna remanescente: `/tools diag` ainda precisa de hierarquia mais humana para IDs e nomes
      técnicos, com alças compactas e linguagem de auditoria em vez de jargão de implementação.

### 12.10 Evidência da hierarquia humana em `/tools diag`

- [x] Implementação: `/tools diag` passou a separar a linha operacional humana da linha `Técnico`,
      da `Classe`, das `Refs` compactas e do `Alvo`, evitando que IDs, nomes SDK e metadados
      apareçam como a narrativa principal.
- [x] Implementação: `Nome técnico`, `tipo file`, `chamada ...`, `requisição ...`,
      `tool(s)` e `Superfícies de tools` deixaram de ser labels do diagnóstico humano.
- [x] Implementação: `Superfícies de tools` virou `Superfícies operacionais`, com linhas
      independentes para `Arquivos locais`, `Terminal local`, `Workspace SDK`, `Shell legado` e
      `Desabilitadas`.
- [x] Implementação: categorias e lifecycle de I/O local passaram a usar `I/O local`, `busca`,
      `leitura`, `escrita` e `criação de pasta`, em vez de `io · search`/`io · mkdir`.
- [x] Implementação: `/health full` traduziu o rodapé de latência de tools de `avg ... (calls)`
      para `média ... (uso/usos)`.
- [x] Harness live: o ciclo diagnóstico agora executa `/tools diag` logo após `/tools` e valida o
      critério `diagnostic-ux-tools-diag-hierarchy`.
- [x] Bug do harness corrigido: o recorte de `/tools diag` agora procura comando real após o prompt
      `› /tools diag`, para não confundir menções como `Detalhes /tools diag`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.
  - Resultado: 2 arquivos, 10 testes.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/tools-diag-hierarchy-20260603-1751`.
  - Resultado: PASS; 22/22 critérios, incluindo `/tools` default humano, `/tools diag` hierárquico,
        `/health full` temático e ausência de labels antigos.
- [x] Lacuna resolvida: `/events` não deve mostrar estados compactos como `estado io op`; a
      superfície default deve distinguir `estado`, `tipo` e `classe`.
- [ ] Lacuna remanescente: o banner inicial e algumas sessões ainda repetem comandos longos em uma
      única linha; isso deve entrar na faixa de compactação de primeiro viewport.

### 12.11 Evidência de eventos I/O humanos

- [x] Implementação: `/events` deixou de tratar `payload.type` como `status`; agora `status`,
      `type` e `classification` viram respectivamente `estado`, `tipo` e `classe`.
- [x] Implementação: fontes `io` e `io/...` aparecem como `I/O local` no default.
- [x] Implementação: `io_op` aparece como `tipo I/O local`, não como `estado io op`.
- [x] Harness live: o critério `diagnostic-ux-events-human` passou a reprovar `estado io op` e
      `io_op` no default.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - Resultado: 1 arquivo, 13 testes.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/events-io-human-20260603-1754`.
  - Resultado: PASS; `/events` mostrou `I/O local · ferramenta ... · tipo I/O local` e manteve
        ausência de IDs crus, `io_op`, timestamps com milissegundos e `chatcmpl-tool`.
- [x] Próxima lacuna tratada em 12.12: primeiro viewport deixou de carregar o bloco de comandos
      gigante e passou a explicar entrada direta sem jargão antigo de intervenção.

### 12.12 Primeiro viewport compacto e comandos operacionais em blocos

- [x] Achado: a live PTY ainda mostrava muitas instruções horizontais no primeiro viewport, com
      `texto livre -> fila de intervenção`, linhas de ambiente vagas e uma ajuda operacional que
      competia visualmente com o prompt.
- [x] Decisão UX: o primeiro viewport default deve responder somente a três perguntas:
      como operar agora, como enviar entrada e onde ver estado do sistema. Catálogo completo fica
      em `/help`, `/tools`, `/session sdk` e diagnósticos explícitos.
- [x] Implementação: `renderReplBanner` trocou a lista longa por três linhas compactas:
      `Operar`, `Entrada` e `Sistema`.
- [x] Implementação: a linha de entrada passou a dizer `texto direto = próxima pergunta`,
      removendo o vocabulário antigo de fila/intervenção do banner.
- [x] Implementação: o boot standalone passou a mostrar `FS/terminal locais ativos`, deixando claro
      que MCP remoto ausente não bloqueia as ferramentas locais.
- [x] Harness live: `diagnostic-ux-no-old-intervention-jargon` agora exige o novo banner compacto e
      reprova `mailbox zero-PR`, `texto livre -> fila zero-PR`, `texto livre -> fila de intervenção`
      e `[mailbox]`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js`.
  - Resultado: 2 arquivos, 4 testes.
- [x] Live PTY diagnóstico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/first-viewport-compact-20260603-1759`.
  - Resultado: PASS; 22 critérios, com o primeiro viewport mostrando `Operar`, `Entrada`,
        `Sistema`, `texto direto = próxima pergunta` e `FS/terminal locais ativos`.
- [x] Achado pós-live: `/session sdk 6` e `/sdk status` ainda eram corretos semanticamente, mas
      continham linhas longas (`Comandos`, `Próximo boot`, `Filtros`, `Uso`) que excediam a leitura
      confortável do terminal.
- [x] Decisão técnica: ajuda operacional com mais de uma ação deve usar bloco multiline com rótulo
      apenas na primeira linha e continuação alinhada, preservando comandos por categoria.
- [x] Implementação: `terminalThemeRows` foi adicionado ao tema central e exportado pelos barrels
      `state`, `state/ui` e `state/theme`.
- [x] Implementação: `/session sdk` passou a renderizar `Comandos`, `Próximo boot`, `Filtros` e
      `Diagnósticos` como blocos compactos.
- [x] Implementação: `/sdk status`, `/sdk skills status` e `/sdk skills config` passaram a quebrar
      suas linhas de `Uso`/`Observação` em comandos escaneáveis.
- [x] Harness live ampliado: os critérios `diagnostic-ux-session-sdk-inventory-human` e
      `diagnostic-ux-sdk-status-human` agora reprovam a forma antiga com pipes/semicolons gigantes.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
  - Resultado: 4 arquivos, 86 testes.
- [x] Live PTY pós-compactação passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/compact-help-blocks-20260603-1805`.
  - Resultado: PASS; `/session sdk 6` e `/sdk status` renderizaram comandos em blocos multiline.
- [x] Achado pós-live: `/health full` ainda vazava constantes visíveis em campos importantes:
      `Status idle`, `Modo SDK interactive` e `Permissões approve_all`.
- [x] Implementação: `/health full` passou a renderizar `ocioso`, `interativo` e `automáticas`,
      mantendo `prompts SDK ignorados` para explicar a autonomia sem expor constante crua.
- [x] Harness live ampliado: `diagnostic-ux-health-full-themed` agora reprova `Status idle`,
      `Modo SDK interactive` e `Permissões approve_all`.
- [x] Testes escopados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
  - Resultado: 5 arquivos, 91 testes.
- [x] Live PTY pós-humanização de `/health full` passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/health-human-compact-blocks-20260603-1808`.
  - Resultado: PASS; `/health full` mostrou `Status ocioso`, `Modo SDK interativo` e
        `Permissões automáticas`.
- [x] Nova lacuna observada na live: `/history` e `/db-history` podiam renderizar várias linhas
      `Você <timestamp>` sem conteúdo quando o ciclo tem comandos internos/entradas vazias. A UX
      deve ocultar turnos vazios ou explicar que são comandos de terminal, sem poluir o histórico.
- [x] Implementação: `/history` e `/db-history` passaram a normalizar conteúdo, filtrar turnos sem
      mensagem visível e mostrar estados explícitos (`sem mensagens visíveis nesta janela` /
      `A janela persistida não tem mensagens visíveis.`) quando a janela só contém vazios.
- [x] Teste escopado passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js`.
  - Resultado: 1 arquivo, 45 testes.
- [x] Harness live ampliado: `diagnostic-ux-history-human` e `diagnostic-ux-db-history-human` agora
      reprovam linhas vazias de `Você`, `LLM-B` ou `Sistema`.
- [x] Live PTY pós-correção de histórico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=170000 --transport=pty --out-dir=artifacts/terminal-live/history-no-empty-rows-20260603-1814`.
  - Resultado: PASS; `/history` mostrou `sem mensagens visíveis nesta janela` e `/db-history`
        mostrou `A janela persistida não tem mensagens visíveis.`, sem linhas fantasma.
- [x] Validadores formais do pacote passaram:
  - `npm run lint:copilot`.
  - `npm run typecheck:strict:src.copilot`.
  - `npx vitest run tests/unit/copilot/terminal/test_repl_banner.spec.js tests/unit/copilot/terminal/test_boot_banner.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js`.
- [x] Próxima lacuna em andamento: auditar comandos com ANSI cru ainda fora do tema central
      (`/gh`, `/skills`, `/memory`, `/plan`, `/alias`, trechos de `/byok`) e decidir ordem de
      migração pelo impacto na live.

### 12.13 Comandos pequenos sem ANSI manual

- [x] Achado: `/plan`, `/skills`, `/memory` e `/alias` ainda imprimiam ANSI manual (`\x1b[...]`),
      checkmarks, `Uso:` solto e modos SDK crus como `interactive -> plan`.
- [x] Decisão UX: comandos pequenos devem seguir o mesmo tema central do restante do terminal,
      usando `terminalThemeRow`, `terminalThemeRows`, `terminalThemeHeadline` e divisores temáticos.
- [x] Implementação: `/plan` passou a mostrar `Plano SDK`, `Modo SDK interativo`, comandos de uso
      em blocos e mudanças como `interativo -> plano`, sem constantes cruas.
- [x] Implementação: `/skills` passou a mostrar usos e subcomandos desconhecidos em linhas
      temáticas, sem `  Uso:` manual.
- [x] Implementação: `/memory` passou a renderizar salvar/listar/remover memórias com tema central,
      sem checkmark ANSI nem blocos coloridos manuais.
- [x] Implementação: `/alias` e `formatAliases` passaram a renderizar aliases sem ANSI manual,
      com set/remove/uso em tema central e setas ASCII estáveis.
- [x] Testes escopados atualizados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_plan.spec.js tests/unit/copilot/terminal/test_commands_memory_resume_search.spec.js tests/unit/copilot/terminal/test_commands_skills.spec.js tests/unit/copilot/terminal/test_commands_alias.spec.js tests/unit/copilot/terminal/test_alias_store.spec.js`.
  - Resultado: 5 arquivos, 36 testes.
- [x] Implementação: `/usage now` passou a renderizar contexto, quota/PR, telemetria LLM, vínculo
      e modo SDK com tema central, sem ANSI manual e sem `interactive` cru.
- [x] Teste escopado de `/usage` passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`.
  - Resultado: 1 arquivo, 8 testes.
- [x] Live focado identificou bug real: `/recall` era anunciado em help/banner e exportado pelo
      barrel de comandos, mas não estava registrado em `repl-command-router.js`; o operador via
      `Comando /recall não existe`.
- [x] Correção: `/recall` entrou no cluster canônico `/remember` → `/recall` → `/forget` do
      roteador, preservando `/memory` como fonte única de renderização.
- [x] Guarda de regressão adicionada:
  - `tests/unit/copilot/terminal/test_repl_command_router_routes.spec.js` garante que o cluster
        anunciado de memória permanece roteado.
- [x] Rodada escopada pós-correção passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_plan.spec.js tests/unit/copilot/terminal/test_commands_memory_resume_search.spec.js tests/unit/copilot/terminal/test_commands_skills.spec.js tests/unit/copilot/terminal/test_commands_alias.spec.js tests/unit/copilot/terminal/test_alias_store.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_repl_command_router_routes.spec.js`.
  - Resultado: 7 arquivos, 45 testes.
- [x] Live PTY focado do cluster `/memory` passou em `npm run terminal:llm-b`:
  - Sequência: `/remember ux: terminal bonito`, `/recall ux`, `/forget mem-12345678`, `/quit`.
  - Resultado: `/recall ux` listou memórias com ISO 8601 completo e não exibiu mais
        `Comando /recall não existe`.

### 12.14 Próxima faixa: GitHub, fallback de sessão e eventos background sem superfície crua

- [x] Auditoria inicial pós-commit:
  - `git status` limpo exceto `.codex/config.toml` local do operador.
  - Busca de vazamentos localizou `/gh`, fallback de `/session` no roteador e eventos
        `agent.background.*` como próximos pontos de alto retorno.
- [x] Achado `/gh`: o comando já remove ANSI herdado via `normalizeGhTerminalOutput`, mas isso
      transforma mensagens próprias em texto plano solto (`Uso: ...`, `Buscando...`, títulos em
      bloco), sem hierarquia visual nem roles estáveis.
- [x] Achado `/session`: `_cmdSessionDispatch` ainda tem fallback com ANSI manual e uma linha de uso
      longa demais, exatamente o tipo de ruído que piora a primeira leitura do operador.
- [x] Achado eventos background: conclusão/falha/ocioso ainda imprimem ANSI literal direto em
      `agent-runtime-events.js`, apesar de subagente, erro, uso e modelo já usarem `terminalThemeRow`.
- [x] Decisão UX:
  - Mensagens próprias do terminal devem usar tema central, headline/row/divider e vocabulário
        humano.
  - Saídas vindas de bridges GitHub podem continuar passando por normalização, mas o envelope do
        comando deve ser temático.
  - Eventos background devem ter labels curtos (`Tarefa`) e status humano (`concluída`, `falhou`,
        `ociosa`) sem ANSI manual.
- [x] Implementar helpers locais de `/gh` para `status`, `uso`, `seção`, `resultado vazio` e
      `erro`, sem quebrar os formatadores externos.
- [x] Migrar fallback de `/session` para `terminalThemeRows`.
- [x] Migrar prints background para `terminalThemeRow`.
- [x] Adicionar testes contra ANSI em `/gh`, fallback de `/session` e prints background quando
      houver harness isolável.
- [x] Validação escopada passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_gh.spec.js tests/unit/copilot/terminal/test_repl_command_router_session_dispatch.spec.js tests/unit/copilot/terminal/test_repl_command_router_routes.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`.
  - Resultado: 4 arquivos, 8 testes.
- [x] Live PTY curta passou em `npm run terminal:llm-b`:
  - Sequência: `/gh`, `/gh issue create`, `/session xpto`, `/quit`.
  - Resultado: `/gh` exibiu painel compacto temático; `/gh issue create` exibiu uso sem `Uso:`;
        `/session xpto` quebrou o uso em linhas alinhadas sem ANSI cru.
- [ ] Próxima lacuna: auditar `/help`, `/tools` default e `/byok` default, porque são superfícies
      de alta exposição e ainda podem carregar densidade técnica em excesso.

### 12.15 Cockpit BYOK default sem rodapé monstruoso

- [x] Auditoria: `/help` e `/tools` default já estavam alinhados ao tema central e preservavam
      detalhe/raw em rotas explícitas; `/byok` default ainda era a maior superfície de alta
      exposição com ANSI manual e linha única de uso excessivamente longa.
- [x] Decisão UX: `/byok` sem argumentos é cockpit operacional, não manual completo. Deve mostrar
      estado, perfil, provedor, modelo, autenticação, capacidades, gateway, vínculo vivo e próximos
      comandos em blocos curtos.
- [x] Implementação: `renderStatus` passou a usar `terminalThemeHeadline`, `terminalThemeDivider`,
      `terminalThemeRow` e `terminalThemeRows`.
- [x] Implementação: `yesNo` deixou de embutir ANSI e passou a retornar texto humano (`sim`/`não`);
      cor fica sob responsabilidade do tema.
- [x] Implementação: o hint de fronteira SDK/BYOK deixou ANSI manual e agora renderiza `Próximo` e
      `Modelo vivo` em linhas temáticas.
- [x] Implementação: rodapé único de centenas de caracteres foi substituído por grupos de comandos:
      operação, gateway, catálogo, seleção, modelos, recomendação, probes, seleção viva e automação.
- [x] Teste escopado reforçado em `test_commands_byok.spec.js`:
  - Garante presença dos grupos de comandos compactos.
  - Garante ausência do título ANSI legado `\x1b[36mBYOK status`.
  - Garante ausência do antigo rodapé `Uso: /byok | /byok reload | /byok auto`.
- [x] Live PTY curto passou em `npm run terminal:llm-b`:
  - Sequência: `/byok`, `/quit`.
  - Resultado: cockpit em linhas alinhadas, sem rodapé longo, com `Comandos` em múltiplas linhas.
- [ ] Próxima lacuna: `/byok providers`, `/byok profiles`, `/byok models`, `/byok recommend` e
      `/byok probe` ainda têm muitos blocos ANSI manuais e merecem faixa BYOK própria por risco.

### 12.16 BYOK configuração: env, persist, reload, providers e profiles

- [x] Auditoria pós-push: `main` sincronizado e worktree limpo exceto `.codex/config.toml` local.
- [x] Achado: `/byok env`, `/byok persist`, `/byok reload`, `/byok providers` e `/byok profiles`
      ainda usavam blocos ANSI manuais e vocabulário herdado, apesar de serem telas de
      configuração frequentes.
- [x] Decisão UX: esses subcomandos são navegação operacional, não prova runtime. Devem ser
      migrados antes de `models/recommend/probe`, que exigem uma faixa maior por risco e volume.
- [x] Implementação: `/byok env` virou painel temático com arquivo, chaves, perfis e uso.
- [x] Implementação: `/byok persist` e `/byok reload` passaram a renderizar sucesso/erro com
      `terminalThemeRow`, sem ANSI manual.
- [x] Implementação: `/byok providers` virou painel com resumo compacto, status por perfil,
      configuração, health e comandos de ação em linhas temáticas.
- [x] Implementação: `/byok profiles` virou painel com perfil ativo/disponível, configuração e uso
      temático.
- [x] Live PTY curto passou:
  - Sequência: `/byok providers`, `/byok profiles`, `/byok env`, `/quit`.
  - Achados do live: resumo de presets ainda longo, coluna curta para `cloudflare-workers-ai` e
        custo `true` bruto em perfis.
- [x] Correções pós-live:
  - Resumo de presets agora mostra preview limitado e contagem omitida.
  - Colunas de perfis/configuração/comandos foram alargadas.
  - `custo perfil gratuito(true)` virou apenas `custo perfil gratuito`.
- [x] Correção de health associada: idade passou de `atras` para `atrás` e `provider.timeout`
      passou a `timeout do provedor` no texto humano.
- [x] Testes escopados atualizados em `test_commands_byok.spec.js` para `profiles` e `providers`.
- [x] Validação escopada final passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js --testNamePattern "mostra .env.local|lista perfis|lista providers|reload|persiste perfil|persiste volta"`.
  - `npm run typecheck:strict:src.copilot`.
- [x] Live PTY repetido de `/byok providers` e `/byok profiles` confirmou alinhamento melhorado
      para `cloudflare-workers-ai`, resumo de presets compacto e custo booleano removido.
- [ ] Próxima faixa BYOK: `models`, `recommend`, `probe` e `probe shortlist`, separando modo
      humano default de detalhe/raw diagnóstico.

### 12.17 BYOK models/recommend/probe: envelope humano sem alterar execução

- [x] Auditoria: `models`, `recommend`, `probe` e `probe shortlist` ainda misturavam cabeçalhos
      ANSI, escopo longo, avisos soltos e rodapés explicativos crus com listas de modelos/probes.
- [x] Decisão técnica: nesta faixa, migrar apenas o envelope humano seguro: cabeçalho, fonte,
      filtros, contexto, avisos, vazio, guia e rodapé. As linhas de modelo/probe permanecem para
      uma próxima faixa porque envolvem ranking, orçamento, health e resultado runtime.
- [x] Implementação: `probe shortlist` passou a usar `BYOK shortlist agent probe`, `Escopo`,
      `Aviso`, `Shortlist`, `Próximo` e `Sessão viva` em linhas temáticas.
- [x] Implementação: `probe chat/agent/streaming/json/vision` passou a renderizar cabeçalho,
      escopo e guia final com tema central.
- [x] Implementação: `models` passou a renderizar cabeçalho, fonte, ordenação, avisos e estado
      vazio com tema central.
- [x] Implementação: `recommend` passou a renderizar cabeçalho, fonte, filtros, contexto, avisos,
      estado vazio, guia de probe agent e troca viva com tema central.
- [x] Validação escopada passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js --testNamePattern "models all-providers|BYOK models|recommend|probe shortlist|roda probe|streaming|json|vision|lista providers|lista perfis|mostra .env.local|usa metadados"`.
  - `npm run typecheck:strict:src.copilot`.
- [x] Live PTY sem runtime passou:
  - Sequência: `/byok models 2`, `/byok recommend 2`, `/quit`.
  - Resultado: envelopes `BYOK models` e `BYOK recommend` ficaram temáticos e legíveis.
  - Achado remanescente: linhas individuais de modelos ainda imprimem ANSI manual, IDs/tags muito
        densos e orçamento colorido diretamente.
- [x] Próxima etapa executada: linhas de modelo/recomendação/probe individual passaram para tema
      central, removendo ANSI manual
      das linhas com `model.id`, tags, orçamento, cor de budget e resultado de probe.
- [x] Implementação: `renderByokModelCatalogRow` e `renderByokRecommendationRow` concentram as
      linhas de catálogo/recomendação com `Modelo`, `Detalhes`, `Orçamento` e `Ação`.
- [x] Implementação: `renderByokProbeResult` passou a renderizar `Resultado`, `Sinal`, `Agente`,
      `Visão`, `Sessão`, `Diagnóstico`, `Ação`, `Aviso`, `Erro` e `Admissão` via tema central.
- [x] Validação escopada passou:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js --testNamePattern "models all-providers|BYOK models|recommend|probe shortlist|roda probe|streaming|json|vision|lista providers|lista perfis|mostra .env.local|usa metadados"`.
  - `npm run typecheck:strict:src.copilot`.
- [x] Live PTY repetido passou:
  - Sequência: `/byok models 2`, `/byok recommend 2`, `/quit`.
  - Resultado: linhas individuais apareceram como `Modelo`, `Detalhes`, `Orçamento` e `Ação`,
        sem ANSI manual visível.

### 12.18 `/health full` sem IDs de sessão em superfície humana

- [x] Auditoria pós-live: `/health full` e `/diagnose full` ainda mostravam IDs compactos de
      sessão runtime, sessão SDK, sessão hub e storage do hub, apesar de a tela ser operacional e
      humana.
- [x] Decisão UX: superfícies humanas (`/health`, `/health full`, `/diagnose full`, `/status`,
      `/now`) devem comunicar presença, saúde e ação recomendada; identificadores completos ou
      compactos ficam reservados para `detail`, `debug`, `raw` e comandos explicitamente técnicos.
- [x] Implementação: `cmdDiagnose` passou a renderizar `Sessão runtime ativa`, `Sessão SDK ativa`
      e `Sessão hub ativo` em modo `full`, preservando IDs completos apenas em `detail/debug`.
- [x] Implementação: `Hub storage` passou a trocar `sessão <id>…` por `sessão ativa` em modo
      humano, mantendo o resumo bruto no modo detalhado.
- [x] Harness live reforçado: `diagnostic-ux-health-full-themed` agora reprova se `/health full`
      voltar a exibir UUIDs, IDs compactos de sessão ou o storage do hub com identificador.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/diagnose.js`.
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint src/copilot/terminal/commands/diagnose.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.
- [x] Live PTY diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-health-no-session-ids-20260603-2124`.
  - Resultado: PASS em 29/29 critérios; `/health full` mostrou `sessão ativa` sem IDs de sessão.
- [x] Continuação de UX: `Runtime alvo`, `Mapa runtime`, `Display`, `Linha viva`, `Timers`,
      `MCP bridge` e `Rota SDK/FS` passaram a usar rótulos humanos no modo `full`:
  - `default` → `principal`;
  - `*default:model/status` → `principal · modelo · estado`;
  - `reserved` → `reservada`;
  - `on/off` → `ativo/inativo`;
  - `conversation-hub.store.checkpoint:<id>` → `checkpoint do hub`;
  - `local-fs-primary` → `arquivos locais primeiro`;
  - `tools` → `ferramentas`.
- [x] Harness live reforçado novamente: `/health full` agora reprova se voltarem
      `Runtime alvo default`, mapa cru de runtime, `reserved`, `streaming on`, `tools on`,
      `Shadow idade`, `Shadow rest.`, `conversation-hub.store` ou `local-fs-primary`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/diagnose.js`.
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint src/copilot/terminal/commands/diagnose.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js`.
- [x] Live PTY diagnóstica repetida passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-health-human-infra-20260603-2136`.
  - Resultado: PASS em 29/29 critérios; `/health full` ficou com infraestrutura humana e sem
        IDs/constantes cruas na superfície principal.
- [x] Próxima lacuna tratada parcialmente: boot/banner inicial e `/live full` deixaram de expor
      `Fluxo local-fs-primary`, `Runtime default` e `Timeline persistent only` na superfície humana.
- [ ] Próxima lacuna: revisar `/session`, `/status full`, `/sdk status` e painéis de sessão porque
      ainda podem expor nomes internos de rota, runtime, binding, offsets ou títulos técnicos.

### 12.19 Auto-brief pronto sem modo interno de rota

- [x] Auditoria pós-live: o painel inicial da sessão pronta ainda mostrava
      `Fluxo local-fs-primary`, logo no first viewport, antes de qualquer comando do operador.
- [x] Decisão UX: o auto-brief deve continuar derivado do contrato canônico
      `guidance.mode`, mas a tela humana deve traduzir esse modo para linguagem operacional:
      `arquivos locais primeiro`, `workspace SDK apenas` ou `degradado`.
- [x] Implementação: `auto-brief.js` ganhou helper de renderização para o modo de rota, usado no
      brief pronto e também no brief detalhado explícito.
- [x] Harness live reforçado: `diagnostic-ux-ready` agora reprova se a primeira tela voltar a
      imprimir `Fluxo local-fs-primary`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/repl/auto-brief.js`.
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint src/copilot/terminal/repl/auto-brief.js tests/unit/copilot/terminal/test_auto_brief.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_auto_brief.spec.js`.
- [x] Live PTY diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-boot-routing-human-20260603-2140`.
  - Resultado: PASS em 29/29 critérios; first viewport exibiu
        `Fluxo     arquivos locais primeiro · próximo /fs list → /activity 5`.
- [x] Próxima lacuna executada: `/live full` foi transformado para rótulos humanos mantendo detalhe
      técnico em comandos explicitamente detalhados quando necessário.

### 12.20 `/live full` sem rótulos internos de runtime e timeline

- [x] Auditoria pós-live: `/live full` já tinha ficado muito mais útil, mas a própria tela
      detalhada ainda expunha constantes internas (`Runtime default`, `Timeline persistent only`,
      `Cache/escopo` e `não pausada`) que quebravam a gramática humana criada para `/health full`
      e para o auto-brief.
- [x] Decisão UX: `full` significa diagnóstico humano completo, não despejo cru. O operador deve
      entender o estado operacional sem conhecer nomes internos de storage, runtime ou cache.
- [x] Decisão técnica: os nomes brutos continuam válidos como contrato interno e podem aparecer em
      modos `detail`, `raw`, logs estruturados ou JSON; as superfícies humanas devem traduzir esses
      nomes no último passo de renderização.
- [x] Implementação: `Runtime default` virou `Runtime principal`, preservando o estado da conversa
      como frase curta: `ocioso · conversa ativa · contínua`.
- [x] Implementação: `persistent_only` virou `histórico persistido` no reconciliador de timeline,
      removendo a mistura ingles/contrato interno no painel humano.
- [x] Implementação: a linha `Cache/escopo` virou `Contexto`, reunindo L1, L2, taxa de acerto,
      índice, escopos ativos e parser com rótulos consistentes (`ativo`, `inativo`, `arquivo(s)`).
- [x] Harness live reforçado: `diagnostic-ux-live-full-human` agora reprova se `/live full` voltar
      a exibir `Runtime default`, `persistent only`, `Cache/escopo` ou `não pausada`.
- [x] Teste unitário reforçado:
  - `cmdLive full preserva fluxo operacional live consolidado` agora exige `Runtime principal` e
        `Contexto`, além de bloquear os rótulos crus removidos.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/session.js`.
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint src/copilot/terminal/commands/session.js tests/unit/copilot/terminal/test_commands_session.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js --testNamePattern "cmdLive"`.
- [x] Live PTY diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-live-full-human-20260603-2145`.
  - Resultado: PASS em 29/29 critérios; `/live full` mostrou `Runtime principal`,
        `Timeline hub · histórico persistido`, `Contexto L1 ativo ...`, sem os rótulos crus.
- [ ] Próxima lacuna: `/session sdk`, `/status full` e `/sdk status` ainda precisam de auditoria
      visual semelhante, especialmente títulos como `default`, rotas `local-fs-primary`, campos
      `offset=` e nomes internos de binding BYOK.

### 12.21 Sessão SDK, status detalhado e quota sem nomes crus

- [x] Auditoria live: `/session sdk 6` melhorou em relação aos primeiros screenshots, mas ainda
      mostrava `Vínculo BYOK BYOK`, duplicando o domínio no rótulo e no valor.
- [x] Auditoria live: `/sdk status` ainda abria com `SDK do Terminal · default`, mostrava
      `escopo copilot_sdk_entitlement` e expunha `premium_interactions` como nome de quota.
- [x] Auditoria de código: `/status full` ainda renderizava `Runtime alvo default`,
      `Mapa runtime *default:model/status`, `Rota SDK/FS local-fs-primary · ready`,
      `L2 off` e `índice ativo:<n>` em uma superfície humana.
- [x] Decisão UX: `default`, `local-fs-primary`, `copilot_sdk_entitlement`,
      `premium_interactions`, separadores técnicos e flags compactas continuam válidos como
      contrato interno, mas devem ser traduzidos nas telas de operador.
- [x] Implementação: `runtime-target.js` ganhou `renderRuntimeTargetLabel`, tornando `default` →
      `principal` uma regra central para comandos do terminal.
- [x] Implementação: `/status full` passou a humanizar runtime alvo, mapa runtime, rota SDK/FS e
      contexto I/O:
  - `*default:gpt-5-mini/idle` → `ativo principal · gpt-5-mini · ocioso`;
  - `local-fs-primary · ready` → `arquivos locais primeiro · FS local canônico disponível...`;
  - `off` → `inativo`;
  - `índice ativo:<n>` → `índice <n> arquivo(s)`.
- [x] Implementação: `/session sdk` trocou o rótulo `Vínculo BYOK` por `Vínculo SDK`, removendo
      a duplicação visual quando o valor começa com `BYOK`.
- [x] Implementação: `/sdk status` agora usa `principal` no título e traduz escopo/quotas:
  - `copilot_sdk_entitlement` → `entitlement do SDK`;
  - `premium_interactions` → `Premium Requests`.
- [x] Harness live reforçado:
  - `diagnostic-ux-session-sdk-inventory-human` exige `Vínculo SDK` e bloqueia
        `Vínculo BYOK BYOK`;
  - `diagnostic-ux-sdk-status-human` exige `SDK do Terminal · principal` e bloqueia `default`,
        `copilot_sdk_entitlement` e `premium_interactions`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/session.js`.
  - `node --check src/copilot/terminal/commands/sdk.js`.
  - `node --check src/copilot/terminal/commands/runtime-target.js`.
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint src/copilot/terminal/commands/session.js src/copilot/terminal/commands/sdk.js src/copilot/terminal/commands/runtime-target.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js --testNamePattern "cmdStatus full|cmdSessionSdk expõe|/sdk status|/sdk quota"`.
- [x] Live PTY diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-sdk-quota-labels-20260603-2230`.
  - Resultado observado: `/session sdk 6` exibiu `Vínculo SDK`; `/sdk status` exibiu
        `SDK do Terminal · principal` e `Premium Requests · ... · escopo entitlement do SDK`.
- [ ] Próxima lacuna: `/health full` ainda mostra `Lifecycle mx boot sdk-preflight`, e os
      previews Markdown via `glow` ainda podem emitir sequências ANSI estranhas em PTY
      (`ESC[;;1m`). Investigar sanitização/fallback antes de expandir mais o uso de libs.

### 12.22 Health lifecycle e preview Markdown sem ANSI malformado

- [x] Auditoria live: `/health full` ainda mostrava `Lifecycle mx boot sdk-preflight`, misturando
      abreviação interna (`mx`) e ID de fase (`sdk-preflight`) em uma tela humana.
- [x] Auditoria live: `/fs preview <arquivo.md> --markdown` com `glow` disponível renderizava o
      conteúdo certo, mas vazava sequências ANSI malformadas no PTY (`ESC[;;1m`), poluindo a tela
      como o operador realmente a vê.
- [x] Decisão UX: comandos `full` continuam podendo ser técnicos, mas seus rótulos devem ser
      legíveis. Métrica de lifecycle vira `Ciclo vida`; IDs de fase viram nomes humanos.
- [x] Decisão técnica: renderer externo é enriquecimento opcional e não é confiável para output
      terminal. O output deve ser sanitizado antes de entrar na superfície humana.
- [x] Implementação: `cmdDiagnose` ganhou renderização de métrica de lifecycle:
  - `Lifecycle mx` → `Ciclo vida`;
  - `sdk-preflight` → `preflight SDK`;
  - demais IDs técnicos passam por normalização de separadores.
- [x] Implementação: `markdown-preview.js` sanitiza output de `glow` removendo ANSI/OSC antes de
      truncar e imprimir.
- [x] Implementação: o sanitizador foi exportado pelo barrel de capabilities para teste
      determinístico sem depender de instalação local do `glow`.
- [x] Harness live reforçado:
  - `/health full` reprova se `Lifecycle mx` ou `sdk-preflight` voltarem;
  - ciclo diagnóstico reprova se o raw do PTY voltar a conter `ESC[;;`, preservando ANSI normal do
        tema.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/diagnose.js`.
  - `node --check src/copilot/terminal/capabilities/markdown-preview.js`.
  - `node --check src/copilot/terminal/capabilities/index.js`.
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint src/copilot/terminal/commands/diagnose.js src/copilot/terminal/capabilities/markdown-preview.js src/copilot/terminal/capabilities/index.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_markdown_preview.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_markdown_preview.spec.js --testNamePattern "full|Markdown|ANSI|glow|fallback"`.
- [x] Live PTY diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-health-glow-clean-20260603-2236`.
  - Resultado observado: Markdown preview via `glow` ficou limpo; `/health full` exibiu
        `Ciclo vida   boot preflight SDK · média ...`.
- [ ] Próxima lacuna: revisar previews com `bat`/`delta` para decidir se ANSI externo deve ser
      preservado, reduzido ou sanitizado por modo; hoje `bat` ainda colore a linha de preview,
      o que é aceitável em TTY, mas deve ter política clara por superfície.

### 12.23 Live canônico de `ask_user`, métricas humanas e pós-pergunta

- [x] Live PTY canônico executado com fluxo real de operador:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=300000 --transport=pty --out-dir=artifacts/terminal-live/live-ask-user-canonical-audit-20260603-2241`.
  - O cenário executou prompt real, `report_intent`, `read_file_content`, deltas públicos,
        pergunta `ask_user`, resposta humana `SIM`, final pós-pergunta, `/usage now`,
        `/activity`, `/tools diag`, `/events`, `/events --raw`, `/errors`, `/health full` e
        `/export`.
- [x] Resultado funcional observado:
  - deltas públicos e final pós-pergunta materializados sem duplicação visual;
  - `ask_user` apareceu como `Pergunta ao operador`, com prompt `[PERG]`, linha viva dedicada e
        resposta humana aceita;
  - não houve spam antigo de `request_user_input ainda executando`, `LLM-B ainda trabalhando`,
        IDs `chatcmpl-tool-*` ou timeout por falta de resposta;
  - `/errors 10` mostrou zero erros;
  - export Markdown e SSE mantiveram envelopes técnicos para auditoria.
- [x] Falha identificada no harness, não no fluxo real: `ux-health-human-tool-stats` ainda
      procurava a seção legada `TOOL STATS`, embora `/health full` já use
      `Ferramentas por latência`.
- [x] Implementação: o extrator do runner live agora reconhece tanto o nome legado quanto
      `Ferramentas por latência`, mantendo o bloqueio contra `read_file_content` e
      `report_intent_local` na superfície default.
- [x] Auditoria visual adicional do live:
  - a linha `Uso do modelo` ainda repetia `modelo kilo-auto/free`;
  - a atividade pós-pergunta ainda podia mostrar o tipo cru `question` em
        `Mensagem da LLM-B recebida`.
- [x] Implementação: a linha impressa de uso remove o prefixo redundante quando o próprio label
      já é `Uso do modelo`, preservando `modelo ...` em timelines e telemetria onde a frase é
      independente.
- [x] Implementação: `assistant.message` fora de turno ativo ganhou rótulos humanos de protocolo:
  - `question` → `Resposta pós-pergunta`;
  - `reply` → `Resposta`;
  - `delta` → `Trecho de resposta`;
  - `reasoning` → `Raciocínio`.
- [x] Testes unitários atualizados:
  - o teste de usage bloqueia `Uso do modelo ... modelo ...`;
  - o teste de `assistant.message` espera `Resposta` no lugar de `reply` na superfície humana.
- [ ] Próxima validação obrigatória: repetir o live canônico após estes ajustes e exigir PASS em
      `ux-health-human-tool-stats`.
- [ ] Próxima lacuna UX: revisar a seção `/events` default para reduzir repetições de
      `Sessão SDK` quando há muitos `session.updated`, talvez por agregação temporal; raw/json
      continuam preservando todos os eventos.
- [ ] Próxima lacuna UX: investigar se `SDK info configuration` e a linha inicial de tools
      desabilitadas devem virar bloco compacto único em boot, especialmente em tela pequena.

### 12.24 Live canônico bloqueado por tool fora do cenário

- [x] Repetição do live canônico após o ajuste de `ux-health-human-tool-stats`:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=300000 --transport=pty --out-dir=artifacts/terminal-live/live-ask-user-canonical-health-stats-fix-20260603-2246`.
- [x] Resultado observado: o terminal iniciou corretamente, executou `report_intent` e
      `read_file_content`, mas a LLM-B invocou `exec_command` fora da allowlist do cenário
      canônico e depois terminou sem saída pública, sem `ask_user`.
- [x] Diagnóstico: o cenário tinha allowlist textual (`report_intent`, `read_file_content`,
      `ask_user`), mas a sessão real ainda expunha `exec_command` ao modelo. A allowlist global
      existente em `sdk/tools/state` governa hooks/policy, mas não é uma remoção dinâmica
      isolada de visibilidade por cenário live.
- [x] Decisão técnica imediata: o runner live deve preservar a causa raiz. `assistant-empty-turn`
      é sintoma final; quando há `tool.lifecycle` de uma tool não permitida pelo cenário, o
      blocker correto passa a ser `unexpected-scenario-tool`.
- [x] Implementação: `detectLiveBlocker` ganhou `findUnexpectedScenarioTool`, usando SSE
      `tool.lifecycle`, aliases já normalizados por `isLifecycleTool`, e ignorando I/O interno
      (`io.*`). O summary futuro deve mostrar `tool=<nome>`, `allowed=<lista>` e `sse=#<id>`.
- [ ] Próxima lacuna arquitetural: decidir se lives de cenário devem:
  - aplicar allowlist temporária de sessão sem tocar no `tools-config.json` canônico do operador;
  - aplicar hook bloqueante que interrompa claramente tool fora de cenário;
  - ou manter todas as tools visíveis e tratar desvio como dado de confiabilidade do modelo.
- [ ] Próxima lacuna UX: quando uma tool fora de cenário é detectada em live/harness, a tela
      humana deveria explicar em português: `Cenário live interrompido: tool fora do contrato`,
      com lista curta de permitidas e comando de retentativa.

### 12.25 Boot verbose compacto para configuração, skills, tools e título

- [x] Auditoria live: o boot em `TERMINAL_DISPLAY_PRESET=full` ainda podia exibir linhas
      visualmente ruidosas:
  - `SDK info configuration · Disabled tools: ...`;
  - `Skills SDK · Skills SDK: ...`;
  - `Ferramentas SDK · Ferramentas dinâmicas do SDK atualizadas: ...`;
  - `Título da sessão: <prompt completo enorme>`.
- [x] Decisão UX: preset `full` pode mostrar eventos de sessão, mas não deve despejar strings
      cruas do SDK na primeira tela. A cópia default deve ser compacta, alinhada e em português;
      SSE/export/raw continuam sendo a trilha técnica completa.
- [x] Implementação:
  - `session.info configuration` agora imprime `Config SDK · tools nativas desativadas · ...`;
  - título de sessão usa `terminalThemeRow('Título', ...)` e compactação de uma linha;
  - skills imprimem `Skills · <enabled>/<count> habilitadas`;
  - tools imprimem `Ferramentas · SDK dinâmicas <n> · locais <n> em /tools`.
- [x] Testes unitários:
  - `test_terminal_sdk_session_events.spec.js` cobre os novos textos de skills/tools;
  - o teste `compacta config e título de sessão na narrativa verbose` bloqueia retorno de
        `SDK info`, `Disabled tools:` e `Título da sessão:`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/sdk-session-events.js`.
  - `npx eslint src/copilot/terminal/events/sdk-session-events.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js`.
  - `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js`.
- [x] Live PTY diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=250000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-boot-compact-session-events-20260603-2253`.
  - Resultado: PASS em 29/29 critérios.
  - Busca no log plain confirmou ausência de `SDK info`, `Disabled tools:`, `Título da sessão:`,
        `Skills SDK:` e `Ferramentas dinâmicas do SDK atualizadas`.
- [ ] Próxima lacuna: `/events` default ainda mostra repetições de `Atividade`/`Ferramenta`
      quando o ciclo tem muitos I/O locais próximos. Avaliar agregação por janela sem afetar
      `/events --raw`.

### 12.26 `/events` default com agregação visual leve

- [x] Auditoria live: em ciclos de diagnóstico com muitos I/O locais, `/events 12` mostrava
      várias linhas repetidas como `Ferramenta · I/O local · ferramenta Leitura local` e
      `Atividade · I/O local · ferramenta Leitura local`, criando ruído sem agregar contexto.
- [x] Decisão UX: `/events` default é uma superfície humana de triagem; pode agrupar eventos
      idênticos por rótulo, origem e resumo. Já `/events --raw`, `/events --json` e consultas
      com `trace`, `turn`, `tool`, `request` ou `hub` continuam linha a linha.
- [x] Implementação: `cmdEvents` cria linhas renderizadas intermediárias e, quando não há filtro
      diagnóstico, agrega linhas equivalentes exibindo `×N` no detalhe temporal.
- [x] Implementação: a agregação usa chave de rótulo humano + origem humana + resumo + hint de
      transcript/export, preservando eventos semanticamente distintos.
- [x] Testes unitários:
  - `agrega eventos default repetidos sem alterar consultas diagnosticas` cobre três eventos
        iguais de I/O local renderizados como uma única linha `×3`.
- [x] Validação passou:
  - `node --check src/copilot/terminal/commands/events.js`.
  - `npx eslint src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npm run typecheck:strict:src.copilot`.
- [ ] Próxima lacuna: avaliar se a agregação deve virar mais inteligente para pares
      `tool.lifecycle` + `terminal.activity` correlacionados, evitando sumir com informação útil.

### 12.27 Prompt vivo de espera sem bracket técnico de modelo

- [x] Auditoria visual: screenshots e PTY mostravam o prompt vivo com formato
      `LLM-B pensando [kilo-auto/free/high]`, que é curto, mas parece metadado cru colado no
      input humano e compete com o espaço de digitação.
- [x] Decisão UX: o prompt vivo de espera é uma superfície humana, não um envelope técnico. O
      modelo e o esforço continuam visíveis, mas como sufixo textual: `modelo ... · raciocínio
      ...`. Tags operacionais como `[PERGUNTA]` continuam existindo porque indicam estado de
      interação e não apenas diagnóstico interno.
- [x] Implementação: `buildWaitingPrompt` substitui `[modelo/effort]` por
      `· modelo <id> · raciocínio <effort>`, com truncamento explícito para preservar largura.
- [x] Implementação: a fase interna do activity no prompt de espera passou por rótulo humano:
      `turn` → `turno`, `streaming` → `respondendo`, `question` → `aguardando operador`,
      `tool` → `ferramenta` etc.
- [x] Testes unitários: `test_build_user_prompt.spec.js` bloqueia regressão para
      `[gpt-5-mini/high]`, exige `modelo gpt-5-mini`, `raciocínio high` e `turno`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/dialog/output.js`.
  - `npx eslint src/copilot/terminal/dialog/output.js tests/unit/copilot/terminal/test_build_user_prompt.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_build_user_prompt.spec.js`.
- [ ] Próxima lacuna: reabrir PTY live em cenário canônico para confirmar que o prompt vivo
      mantém largura confortável durante `ask_user`, tools e deltas longos.

### 12.28 Perguntas pendentes com rótulos humanos, não enums do SDK

- [x] Auditoria: o terminal ainda podia mostrar `question`, `confirm` ou `shadow <kind>` em
      superfícies humanas como prompt detalhado, `/now`, `/status`, `/diagnose` e menu. Esses
      valores são úteis para contrato interno, mas ruins para operador.
- [x] Decisão UX: o tipo técnico permanece em SSE/raw/export quando necessário, mas a UX default
      usa vocabulário estável:
  - `question` → `operador`;
  - `confirm` → `confirmação`;
  - `choice/select` → `escolha`;
  - `ready` → `pronto`;
  - ausente → `geral` ou `sem tipo`, dependendo da frase.
- [x] Implementação: criado `terminal/state/pending-question-labels.js`, exportado pelos barrels
      de `state`, `dialog`, `repl`, `ui` e `projections`.
- [x] Implementação: `buildUserPrompt` e `buildWaitingPrompt` renderizam
      `[PERGUNTA:OPERADOR]` ou `[PERGUNTA]`, nunca `[PERGUNTA:QUESTION]`.
- [x] Implementação: `/status`, `/now`, `/diagnose`, projeção de canal e menu contextual usam o
      helper canônico.
- [x] Testes unitários:
  - prompt bloqueia `[PERGUNTA:QUESTION]`;
  - menu mostra `Tipo: confirmação`;
  - `/now` mostra `pergunta pendente (operador)`.
- [x] Validação passou:
  - `node --check` nos módulos alterados;
  - `npx eslint` nos módulos e testes alterados;
  - `npx vitest run tests/unit/copilot/terminal/test_build_user_prompt.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js`;
  - `npm run typecheck:strict:src.copilot`.
- [ ] Próxima lacuna: revisar `/activity detail` e `/metrics` para mapear fases/tipos técnicos
      em modo default, preservando o valor cru apenas no modo diagnóstico.

### 12.29 Live canônico pós-humanização e correção do detector pós-pergunta

- [x] Live PTY canônico executado após humanização do prompt e dos tipos de pergunta:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=300000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-humanized-question-prompt-20260603-221211`.
- [x] Resultado funcional: fluxo real passou pelo usuário, tools reais, deltas públicos,
      `ask_user`, resposta `SIM`, mensagem pós-pergunta, `/usage`, `/activity`, `/tools diag`,
      `/events`, `/health full` e `/export`.
- [x] Falha do harness identificada: `post-ask-final-visible` falhou embora
      `terminal.plain.log`, SSE e export contivessem `POST-ASK-CANONICAL-FINAL`. O regex antigo
      de bloco reconhecia `Mensagem sdk/assistant.message`, mas não a narrativa atual
      `Resposta pós-pergunta sdk/assistant.message`.
- [x] Implementação: o runner live agora reconhece `Resposta pós-pergunta sdk/assistant.message`
      como bloco visível de assistant.message para o critério `post-ask-final-visible`.
- [x] Validação do detector:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - simulação local sobre `terminal.plain.log` existente retornou `recognized`.
- [x] Rerun PTY canônico passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=300000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-humanized-question-prompt-rerun-20260603-221518`.
  - Resultado: `Status: PASS`; `post-ask-final-visible: assistant.message=yes`;
        zero erros no tracker; export criado; SSE monotônico.
- [x] Observação visual remanescente: a captura plain do PTY ainda pode mostrar prompt e linha
      viva de pergunta intercalados (`você...[PERG]›` seguido de `LLM-B Pergunta ...`). O
      detector `no-prompt-double-render` passa, mas a experiência humana ainda precisa de uma
      política mais elegante para pergunta viva em TTY estreito.
- [ ] Próxima lacuna: revisar a linha viva quando há `ask_user` pendente para garantir que ela
      nunca dispute a linha de input; alternativas: compactar para uma única linha ainda mais
      curta, pausar heartbeat enquanto readline está com prompt `[PERG]`, ou reservar área acima
      com altura estável específica para pergunta humana.
- [ ] Próxima lacuna: decidir se `/events --raw` deve permanecer despejo JSON bruto na tela ou se
      o raw interativo deve sugerir `/export`/arquivo por padrão, mantendo `--json` para pipe.

### 12.30 Linha viva de pergunta pendente mais curta e menos invasiva

- [x] Auditoria live: no rerun canônico, a pergunta em si já aparecia corretamente no card
      `Pergunta ao operador`, mas a linha viva repetia a pergunta inteira (`LLM-B Pergunta ·
      ASK-CANONICAL...`). Em PTY estreito isso podia quebrar em múltiplas linhas e parecer colado
      ao prompt `[PERG]`.
- [x] Decisão UX: durante `ask_user` vivo, o card persistente é a fonte do texto da pergunta. A
      linha viva deve apenas comunicar estado operacional: `aguardando operador · responda no
      prompt [PERG]`, com opções resumidas quando existirem.
- [x] Implementação: `formatTerminalLiveStatusLine` deixou de repetir a pergunta completa para
      `pendingQuestion` e `request_user_input` estruturado. O texto agora é curto, previsível e
      menos propenso a disputar o input.
- [x] Testes unitários:
  - `test_live_status_line.spec.js` exige `aguardando operador`;
  - bloqueia vazamento do texto longo da pergunta na linha viva;
  - preserva opções compactas (`opções azul|verde`, `opções seguir|pausar`).
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/repl/live-status-line.js`;
  - `npx eslint src/copilot/terminal/repl/live-status-line.js tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js`.
- [ ] Próxima validação live: repetir cenário canônico para confirmar que a linha viva de pergunta
      não quebra em 2-3 linhas no PTY e que `ask_user` continua visível/único.

### 12.31 Live bloqueado por ausência de `ask_user` e pulso sem-delta compacto

- [x] Tentativa de validação PTY da linha viva curta:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=300000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-short-ask-live-status-20260603-222007`.
- [x] Resultado: `Status: BLOCKED`; blocker `live-timeout`; a LLM-B executou as tools reais e
      emitiu os 8 deltas, mas não chamou `ask_user` antes do timeout. O summary registrou
      `ask=not-answered · postAsk=missing · diagnostics=not-started`.
- [x] Diagnóstico: essa rodada não valida a linha viva de pergunta pendente, pois a pergunta não
      ocorreu. Ela valida indiretamente que o harness separa bloqueio de cenário de regressão de
      UX (`root-cause-not-ux-duplication`).
- [x] Nova lacuna visual encontrada no mesmo PTY: o pulso `Aguardando resposta · 10s sem resposta
      visível` ainda incluía modelo/esforço e quebrava em várias linhas. O prompt de espera já
      mostra modelo e raciocínio, então a linha viva estava duplicando metadado.
- [x] Implementação: o caminho `noDeltaStatus` de `formatTerminalLiveStatusLine` passou a mostrar
      apenas `LLM-B pensando · <tempo> sem delta · conversa ativa`, sem `modelo ... · raciocínio
      ...`.
- [x] Testes unitários: `test_live_status_line.spec.js` exige ausência de `modelo auto` e
      `raciocínio high` nesse pulso e limite de comprimento menor que 70 caracteres.
- [x] Validação passou:
  - `node --check src/copilot/terminal/repl/live-status-line.js`;
  - `npx eslint src/copilot/terminal/repl/live-status-line.js tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - `npm run typecheck:strict:src.copilot`.
- [ ] Próxima validação live: repetir cenário canônico até uma execução com `ask_user` real para
      confirmar a linha curta `aguardando operador`.
- [ ] Próxima lacuna do harness: adicionar heartbeat/diagnóstico textual próprio quando o cenário
      fica mais de 60s sem eventos relevantes após deltas, para não deixar o operador sem saber se
      o modelo, o SDK ou o runner estão travados.

### 12.32 Investigação oficial de libs auxiliares e contrato de tempo dual

- [x] Auditoria retomada em 2026-06-04 com foco no pedido explícito do operador: investigar
      profundamente `gum`, `fzf`, `bat`, `glow`, `delta`, `atuin`, `zoxide`, `jq` e `yq` antes de
      qualquer nova integração.
- [x] Documento complementar atualizado:
      `src/copilot/docs/terminal/TERMINAL_AUXILIARY_LIBS_INTEGRATION_AUDIT_2026-06-03.md`.
- [x] Decisão consolidada: `fzf`, `gum`, `bat`, `glow`, `delta`, `jq` e `yq` seguem como
      enriquecimentos opcionais e explícitos; `atuin` e `zoxide` continuam adiados por mexerem em
      histórico/cwd pessoal do operador.
- [x] Risco oficial reavaliado: `fzf --preview` executa comando via shell, portanto preview dentro
      de picker fica bloqueado até existir adapter próprio sem shell livre.
- [x] Risco oficial reavaliado: Atuin depende de hooks de shell interativo e tem documentação
      específica sobre IDEs/AI tools; não deve ser backend automático do terminal.
- [x] Risco oficial reavaliado: `yq` tem operadores de arquivo/env; adapter estruturado deve
      continuar usando stdin e flags de segurança.
- [x] `terminal/time-format` ganhou `formatTerminalTimeParts` e `formatTerminalTimestamp`, mantendo
      `formatTerminalTimeLabel` como wrapper compatível.
- [x] Default humano confirmado como `dual`: ISO 8601 local até segundos + tempo relativo.
- [x] Cabeçalhos de LLM-A/LLM-B, raciocínio, `printExchange`, runtime timestamps e comandos humanos
      selecionados migraram de ISO cru/milissegundos para helper dual.
- [x] `/events` default agora resume `session.model_changed` com a troca real:
      `modelo anterior → modelo novo · raciocínio ...`, sem exigir `--raw`.
- [ ] Próxima lacuna: auditar comandos remanescentes que ainda mostram apenas ISO ou apenas relativo
      por decisão local (`/sdk`, `/workspace-index`, `/export`, `/byok`) e classificar se são
      humanos ou raw/export.
- [ ] Próxima validação: testes escopados de `time-format`, turn display, commands alterados e
      typecheck strict de `src/copilot`.
- [ ] Próxima live: repetir cenário canônico até `ask_user` real para validar linha viva curta,
      timestamps dual e ausência de disputa com input.

### 12.33 Live canônico com tempo dual: bloqueio pós-delta e espera silenciosa

- [x] Live PTY executado após `formatTerminalTimeLabel` dual e resumo de model switch:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=300000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-dual-time-model-events-20260604-2244`.
- [x] Resultado: `Status: BLOCKED`; blocker `live-timeout`; a sessão ficou pronta, executou
      `report_intent`, `read_file_content` e os 8 deltas públicos, mas o modelo encerrou sem
      chamar `ask_user`.
- [x] Evidência positiva: cabeçalho de streaming apareceu como
      `[2026-06-03T22:44:13-03:00 (há 0s)]`, confirmando ISO até segundos + relativo no fluxo real.
- [x] Bug UX encontrado: o pulso de espera `10s sem resposta visível` seguia pelo renderer genérico,
      duplicava `modelo kilo-auto/free · raciocínio high` e quebrava em várias linhas.
- [x] Correção aplicada: `formatTerminalLiveStatusLine` agora trata espera silenciosa por
      `sem resposta visível` como linha curta `pensando · 10s sem resposta pública · conversa ativa`,
      sem modelo/esforço duplicado.
- [x] Testes escopados: `test_live_status_line.spec.js` cobre `sem delta visível` e
      `sem resposta visível`.
- [x] Próxima lacuna do harness/live: quando o cenário canônico volta para `Pronto` após deltas
      sem `ask_user`, o runner deve classificar rapidamente como `missing-required-ask-user`
      ou `assistant-ended-before-ask`, em vez de aguardar timeout total.
- [x] Próxima lacuna UX: a tela humana deve receber uma linha curta de diagnóstico do cenário live
      após deltas sem pergunta, por exemplo `Cenário live aguardava ask_user, mas o turno terminou`.
- [x] Continuação: o runner ganhou detector `assistant-ended-before-ask` para o padrão
      `DELTA-CANONICAL-8` materializado + pergunta ausente + retorno ao prompt.
- [x] Continuação: durante a live, esse padrão agenda `/activity 40`, `/events 100 --raw`,
      `/errors 10`, `/export ...` e `/quit`, reduzindo espera inútil antes do summary.
- [x] Continuação UX: o runner imprime uma linha curta
      `[terminal-live] cenário canônico: deltas públicos concluídos, mas ask_user obrigatório não apareceu; coletando diagnósticos.`
      antes de disparar os comandos diagnósticos.
- [x] Validação local: o artefato bloqueado
      `live-canonical-dual-time-model-events-20260604-2244` seria classificado como
      `assistant-ended-before-ask`.
- [x] Live de verificação rápida:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-missing-ask-fast-diagnostic-20260604-2255`.
- [x] Resultado: `Status: FAIL`; o modelo chamou `ask_user`, mas o novo detector disparou
      diagnósticos imediatamente antes da tool aparecer, poluindo o fluxo de pergunta.
- [x] Correção do race: `assistant-ended-before-ask` agora usa janela de graça antes dos
      diagnósticos; se `ask_user` aparecer nesse intervalo, o timer é cancelado.
- [x] Live de confirmação da janela de graça:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-missing-ask-grace-20260604-2300`.
- [x] Resultado: `Status: PASS`; `ask_user` apareceu, resposta humana `SIM` foi registrada, final
      pós-pergunta apareceu como `assistant.message`, SSE/export correlacionaram `ask`, `answer` e
      `postAsk`, e o terminal encerrou sem erros.
- [x] Critério UX validado: a espera `sem resposta pública` ficou compacta e sem duplicação de
      modelo/esforço; `ask_user` ficou como superfície própria e persistente.
- [x] Nova lacuna visual encontrada nessa live: `session.info/model_retry` ainda renderizava a linha
      viva como `LLM-B erro · Retry de modelo em andamento · Response was interrupted ... · modelo
      kilo-auto/free · raciocínio high`, quebrando em várias linhas.
- [x] Correção aplicada: atividades de recuperação/retry de modelo agora usam caminho compacto na
      linha viva: `LLM-B recuperando · retry do modelo · <idade> · conversa ativa`, mantendo o
      detalhe técnico apenas no histórico/SSE/diagnóstico.
- [x] Teste unitário: `test_live_status_line.spec.js` cobre ausência de `Response was interrupted`,
      `server error`, `modelo kilo-auto/free` e `raciocínio high` na linha viva de retry.
- [ ] Próxima live estética: repetir cenário canônico ou `model-switch` forçando um retry/troca para
      confirmar visual real em PTY, sem depender apenas do teste unitário.

### 12.34 Prompt de espera como estado curto, não painel de telemetria

- [x] Auditoria do live PASS mostrou que a tela ainda exibia `LLM-B pensando · modelo ... ·
      raciocínio ...` no prompt temporário, competindo visualmente com a linha viva permanente.
- [x] Decisão UX: o prompt normal pode mostrar `você[modelo/esforço]›` quando o terminal está
      pronto; durante processamento, o prompt de espera deve ser curto e sem metadados duplicados.
- [x] `buildWaitingPrompt()` agora renderiza apenas `LLM-B pensando`, tags essenciais
      (`[PERGUNTA]`, fila, shadow) e, no modo detalhado, fase/label curtos. Modelo/esforço saem
      dessa superfície.
- [x] `formatTerminalLiveStatusLine()` agora compacta `boot` como
      `LLM-B iniciando · <fase> · <idade> · <runtime>`, sem repetir modelo/esforço na linha viva de
      inicialização.
- [x] Testes unitários atualizados:
  - `test_build_user_prompt.spec.js` exige ausência de `modelo gpt-5-mini`, `raciocínio high`,
        `gpt-5-mini` e `high` no prompt de espera.
  - `test_live_status_line.spec.js` exige boot curto sem modelo/esforço e com limite de comprimento.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/dialog/output.js`;
  - `node --check src/copilot/terminal/repl/live-status-line.js`;
  - `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/repl/live-status-line.js tests/unit/copilot/terminal/test_build_user_prompt.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_build_user_prompt.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js`.
- [x] Live estética:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-compact-waiting-prompt-20260604-2305`.
- [x] Resultado: `Status: BLOCKED` por `assistant-ended-before-ask`; o modelo emitiu os deltas
      canônicos e encerrou sem chamar `ask_user`. O bloqueio foi rápido e sem timeout.
- [x] Evidência positiva: o prompt temporário passou a aparecer como `LLM-B pensando`, sem
      `modelo ... · raciocínio ...`.
- [x] Nova lacuna visual encontrada: mesmo com prompt curto, a linha viva em PTY estreito ainda
      quebrava em duas linhas por causa de `conversa ativa/parada` em `boot`, `turn` e retry/espera.
- [x] Correção aplicada: pulsos transitórios de `boot`, `turn`, `retry de modelo` e espera
      silenciosa removem o tail redundante de runtime; o runtime detalhado permanece em
      `/activity`, `/events` e estado pronto.
- [x] Teste unitário reforçado: `test_live_status_line.spec.js` agora exige ausência de `conversa
      ativa/parada` nos pulsos curtos e limites de comprimento mais agressivos.
- [x] Live estética após corte do tail:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-short-transient-status-20260604-2310`.
- [x] Evidência positiva: boot e `Contexto atualizado` passaram para uma linha reservada única em
      PTY; prompt temporário permaneceu `LLM-B pensando` sem modelo/esforço.
- [x] Resultado de cenário: `Status: FAIL`, mas por contrato de transcript (`final-delta-block`,
      `sse-canonical-transcript-events`, `export-sse-correlation`), não por erro de terminal. A
      LLM-B chegou ao `ask_user` e ao pós-ask, mas o bloco público inicial `DELTA-CANONICAL-*` não
      foi materializado como transcript público antes da pergunta.
- [x] Nova lacuna visual encontrada: a finalização de turno ainda aparecia como
      `LLM-B turno · Turno do assistente concluí… · <idade>`, quebrando em duas linhas no PTY
      estreito.
- [x] Correção aplicada: atividades de finalização de turno (`Turno do assistente concluído`,
      `Reply do turno explícito resolvido`) renderizam a linha viva curta
      `LLM-B finalizando · <idade>`.
- [x] Teste unitário: `test_live_status_line.spec.js` cobre a ausência de `Turno do assistente`,
      `concluí` e `conversa ativa` no pulso de finalização.
- [x] Investigação do runner: `partial-deltas` contava `DELTA-CANONICAL-*` no log inteiro, incluindo
      o prompt inicial do cenário; isso tornava o summary confuso quando os deltas não eram
      materializados publicamente.
- [x] Correção do harness: `partial-deltas` agora conta apenas marcadores públicos em bloco visível
      da LLM-B ou `assistant.message`; o detalhe mostra `public ... · total log markers ...`.
- [x] Correção de correlação export/SSE: `exportEnvelopeMatchesEvent` aceita mesmo trace/turn para
      `sdk/assistant.message` materializado no export via `terminal.dialog.engine` ou
      `terminal-turn-display`, preservando o contrato sem exigir duplicação de source visual.
- [x] Validação escopada do runner passou:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live seguinte:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-public-delta-finalizing-20260604-2320`.
- [x] Resultado: `Status: BLOCKED` por `byok-provider-turn-failed`; o provider BYOK falhou antes de
      tools/deltas e o terminal conteve o erro sem fallback para Copilot auto.
- [x] Nova lacuna UX encontrada: a falha BYOK era renderizada como uma linha `Modelo` enorme:
      mensagem do SDK + política de fallback + ação + provider/perfil/modelo.
- [x] Correção aplicada: erro recuperável de `model_call` BYOK agora renderiza painel curto:
      `Provider BYOK`, `Ação`, `Fallback`, `Contexto`. O detalhe completo continua em
      `recordTerminalActivity` e SSE.
- [x] Teste unitário: `test_terminal_agent_runtime_events.spec.js` garante que o painel contém
      `/byok use`, `/byok model` e contexto provider/perfil/modelo, sem a frase longa de retry.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/agent-runtime-events.js`;
  - `npx eslint src/copilot/terminal/events/agent-runtime-events.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`;
  - `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.
- [ ] Próxima live: repetir cenário canônico para confirmar summary mais honesto, `LLM-B
      finalizando · <idade>` e painel BYOK curto quando houver falha de provider.

### 12.35 Paths humanos e continuação pós-pergunta vazia

- [x] Live de verificação após painel BYOK curto:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-byok-error-panel-or-recovery-20260604-2325`.
- [x] Resultado: `Status: BLOCKED` por `assistant-empty-turn`; o provider recuperou da instabilidade
      BYOK, executou tools reais, materializou os 8 deltas públicos, abriu `ask_user`, recebeu
      `SIM`, mas a continuação pós-pergunta terminou com `dialog.turn_end.reply=""`.
- [x] Evidência positiva:
  - linha viva de finalização apareceu curta (`LLM-B finalizando · 0s/1s/2s`);
  - `ask_user` apareceu como card próprio;
  - resposta humana foi registrada como operador, não como LLM-B;
  - SSE/export preservaram deltas, pergunta e resposta humana.
- [x] Lacuna operacional encontrada: após resposta humana, o silêncio do provider parecia apenas
      ausência de output. O terminal não explicava ao operador que a continuação pós-pergunta tinha
      feito chamada de modelo e encerrado sem resposta pública.
- [x] Correção aplicada: `terminal-agent-wiring` agora rastreia `user_input.completed` recente e,
      quando `dialog.turn_end` chega vazio dentro da janela pós-pergunta, emite aviso humano curto:
      `Continuação pós-pergunta sem resposta pública`, registra activity `warn` e publica
      `dialog.empty_after_user_input` no SSE.
- [x] Guardrail: turnos vazios normais de tool-only continuam silenciosos; conteúdo já materializado
      por delta/assistant.message não dispara aviso.
- [x] Lacuna visual encontrada: tools e `/activity` ainda vazavam paths absolutos do workspace,
      como `/workspaces/chatgpt-docker-puppeteer/package.json`, na superfície humana padrão.
- [x] Decisão UX: payload bruto permanece em SSE/export/`--raw`; stdout padrão e comandos humanos
      devem mostrar paths relativos ao workspace sempre que possível.
- [x] Correção aplicada: `tool-activity-presenter` ganhou normalização central
      `formatTerminalToolPathForOperator()` e `compactTerminalOperatorToolText()`.
- [x] Correção aplicada: narrativa de tool, `/activity`, `/tools`, `/events` e `/session` usam
      compactação humana para paths absolutos e detalhes compostos.
- [x] Testes unitários adicionados:
  - presenter transforma `${workspace}/package.json` em `package.json` na superfície humana;
  - `shouldWarnEmptyDialogTurnAfterUserInput()` só sinaliza vazios pós-input humano dentro da janela.
- [ ] Próxima validação escopada: `node --check`, ESLint e unit tests dos módulos tocados.
- [x] Live de confirmação:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-paths-empty-ask-warning-20260604-2330`.
- [x] Resultado: `Status: PASS`; 181 eventos SSE, zero erros, export ok, deltas públicos, tools,
      `ask_user`, resposta humana, final pós-ask e correlação SSE/export passaram.
- [x] Evidência positiva: narrativa principal de tool, `/activity` e `/tools diag` passaram a
      mostrar `package.json`, preservando paths absolutos apenas em `/events --raw`.
- [x] Lacuna residual encontrada na live: o resumo imediato de turno (`Turno` / `Ações` /
      `Arquivos`) ainda renderizava paths absolutos, porque vinha de `sdk-session-events` e não dos
      comandos `/activity`/`/tools`.
- [x] Correção aplicada: `sdk-session-events.renderTurnTraceSummary()` agora usa a mesma compactação
      humana para targets e arquivos.
- [x] Teste unitário reforçado: o contrato de `sdk-session-events` simula trace com path absoluto e
      exige saída contendo `files/plan.md` sem `process.cwd()`.
- [x] Validação escopada passou:
  - `node --check` em `sdk-session-events`, presenter, wiring e comandos humanos tocados;
  - `npx eslint` nos módulos e testes tocados;
  - `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/test_terminal_agent_wiring.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.
- [x] Próxima live de confirmação:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-turn-summary-relative-paths-20260604-2340`.
- [x] Resultado: `Status: PASS`; fluxo canônico completo, 181 eventos SSE, zero erros, export ok.
- [x] Evidência positiva: resumo imediato de turno agora mostra
      `Ações ... LER Ler arquivo · package.json` e `Arquivos LER package.json · LER package.json`.
- [x] Busca no `terminal.plain.log`: ocorrências absolutas restantes aparecem apenas em log de DB,
      `/events --raw`/payload técnico ou caminho do arquivo exportado; a superfície humana padrão
      ficou relativa.
- [ ] Próxima validação escopada adicional, se houver nova edição: repetir `node --check`, ESLint e unit tests incluindo
      `sdk-session-events`.
- [x] Lacuna UX seguinte tratada: a linha viva de pergunta quebrava em PTY estreito como
      `LLM-B aguardando operador · responda no` / `prompt [PERG] · opções SIM · conversa ativa`.
- [x] Decisão UX: o card da pergunta já explica a ação; a linha viva deve ser só um estado curto.
- [x] Correção aplicada: pergunta pendente agora renderiza `LLM-B aguardando você · [PERG] · SIM`;
      input estruturado genérico renderiza `LLM-B aguardando você · formulário · ...`, sem
      `request_user_input`, sem `responda no prompt` e sem `conversa ativa`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/repl/live-status-line.js`;
  - `npx eslint src/copilot/terminal/repl/live-status-line.js tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js`.
- [x] Live de confirmação:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-short-ask-live-line-20260604-2345`.
- [x] Resultado: `Status: PASS`; fluxo canônico completo, 182 eventos SSE, zero erros, export ok.
- [x] Evidência positiva: a linha viva de pergunta apareceu como uma linha única:
      `LLM-B aguardando você · [PERG] · SIM`.
- [x] Observação de log: `terminal.plain.log` concatena `SIM` ao frame ANSI em uma linha (`... SIMSIM`),
      mas no PTY visual a linha reservada foi limpa ao enviar a resposta; não houve nova quebra de
      linha nem disputa durável com o prompt.
- [x] Lacuna UX: `/export` ainda imprimia `Exportado /workspaces/...` no modo humano.
- [x] Decisão UX: o caminho físico continua absoluto internamente para escrita; a linha humana
      mostra path relativo ao workspace quando possível, mantendo paths brutos apenas nos artefatos
      e payloads técnicos.
- [x] Correção aplicada: `cmdExport()` usa `formatTerminalToolPathForOperator()` para a linha
      `Exportado`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/export.js`;
  - `npx eslint src/copilot/terminal/commands/export.js tests/unit/copilot/terminal/test_commands_export.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_export.spec.js`.
- [x] Lacuna UX: `/activity` ainda podia mostrar nomes crus como `workspace.read_file` no fluxo
      padrão, exigindo que o operador decodificasse namespace técnico.
- [x] Correção aplicada: o glossário central de tools agora cobre `workspace.*`, file-tools
      canônicas/legadas e shell local (`read_bash`, `write_bash`, `stop_bash`), mantendo detalhe/raw
      como espaço técnico quando necessário.
- [x] Correção aplicada: o glossário agora privilegia o nome bruto humano específico antes do alias
      canônico genérico, evitando que `read_bash` vire apenas `Executar comando`.
- [x] Contrato reforçado: `/activity detail` continua diagnóstico, mas não volta a imprimir paths
      absolutos do workspace na superfície humana.
- [x] Validação escopada passou:
  - `node --check` em presenter, `/activity` e `/export`;
  - `npx eslint` nos módulos e specs tocados;
  - `npx vitest run test_tool_activity_presenter.spec.js test_commands_activity.spec.js test_commands_export.spec.js`.
- [x] Lacuna UX: comandos de auditoria ainda exibiam labels de backend como `Archive`.
- [x] Correção aplicada: `/events`, `/session sdk events` e `/session sdk waits` usam `Registro`
      na superfície humana; `/session sdk waits` virou `Interações SDK da sessão` para refletir
      perguntas, formulários e permissões, não apenas espera passiva.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/events.js src/copilot/terminal/commands/session.js`;
  - `npx eslint src/copilot/terminal/commands/events.js src/copilot/terminal/commands/session.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] Live de confirmação pós-humanização:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-humanized-audit-surfaces-20260604-2350`.
- [x] Resultado: `Status: PASS`; fluxo canônico completo, 181 eventos SSE, zero erros, export
      relativo, `/events` com `Registro`, `/activity` com `Ler arquivo`/`Intenção capturada`.
- [x] Lacuna visual encontrada na live: o bloco final pós-pergunta ainda mostrava
      `Resposta pós-pergunta sdk/assistant.message · Resposta pós-pergunta`, misturando source cru
      com título humano.
- [x] Correção aplicada: `assistant-transcript-renderer` agora separa source bruto persistido de
      source visual; `sdk/assistant.message` vira `LLM-B via SDK` e deltas viram `streaming da
      LLM-B` na linha humana.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/assistant-transcript-renderer.js`;
  - `npx eslint src/copilot/terminal/events/assistant-transcript-renderer.js tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js`.
- [x] Lacuna visual encontrada na mesma live: `/activity` ainda mostrava enums internos como
      `system`, `task` e `boot` na timeline humana.
- [x] Correção aplicada: fases internas de `/activity` foram humanizadas (`sistema`, `tarefa`,
      `inicialização`, `pergunta`, `streaming`, `compactação`, `subagente`) e o contador
      `Input humano` virou `Operador`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/activity.js`;
  - `npx eslint src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`.
- [x] Lacuna visual encontrada na live: `/events` ainda mostrava payload enums como
      `tipo session.updated` e `classe ask user continuation`.
- [x] Correção aplicada: `humanPayloadKind()` agora traduz lifecycle SDK, continuação pós-ask,
      retry de modelo e falhas BYOK para labels de operador.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/events.js`;
  - `npx eslint src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Lacuna visual: `/usage now` concentrava quota histórica, BYOK ativo, classe técnica e
      correlação pós-ask em linhas longas que quebravam no PTY.
- [x] Correção aplicada: `/usage now` separa `Quota Copilot`, `BYOK ativo`, `Detalhe`,
      `Pergunta humana` e `Correlacionar` em linhas próprias.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/usage.js`;
  - `npx eslint src/copilot/terminal/commands/usage.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`.
- [x] Lacuna visual: `/metrics` ainda usava o título técnico `Archive SSE`.
- [x] Correção aplicada: título humanizado para `Registro SSE`, mantendo contadores, fila e arquivo
      do archive.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/metrics.js`;
  - `npx eslint src/copilot/terminal/commands/metrics.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`.

### 12.36 Contratos live humanizados e erros BYOK visíveis

- [x] Live pós-humanização de source/labels:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-post-live-ux-fixes-20260605-0005`.
- [x] Resultado inicial: `Status: FAIL` apenas no critério `post-ask-final-visible`.
- [x] Diagnóstico: a tela real continha `Resposta pós-pergunta LLM-B via SDK` e o SSE/export
      continham `POST-ASK-CANONICAL-FINAL`, mas o verificador ainda procurava o formato antigo
      `Resposta pós-pergunta sdk/assistant.message`.
- [x] Correção aplicada: o runner live aceita headings antigos e novos, incluindo
      `LLM-B via SDK`, sem regredir compatibilidade com logs históricos.
- [x] Lacuna visual: quando título e detalhe eram iguais, o transcript renderizava
      `Resposta pós-pergunta LLM-B via SDK · Resposta pós-pergunta`.
- [x] Correção aplicada: `renderTerminalAssistantTranscript()` suprime detalhe duplicado quando
      `detail === title`, preservando detalhe útil quando ele acrescenta contexto.
- [x] Lacuna visual: `/activity` usava dois rótulos `Detalhe` no topo; o segundo era só orientação
      técnica para `/activity detail`.
- [x] Correção aplicada: a linha de orientação passou a usar `Técnico`, reduzindo repetição visual.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/assistant-transcript-renderer.js`;
  - `node --check src/copilot/terminal/commands/activity.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint src/copilot/terminal/events/assistant-transcript-renderer.js src/copilot/terminal/commands/activity.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`.
- [x] Live seguinte:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-post-live-ux-fixes-20260605-0010`.
- [x] Resultado: `Status: BLOCKED` por `byok-provider-turn-failed`; o provider BYOK falhou após
      tools reais e antes de deltas/ask_user, com fallback para Copilot auto bloqueado por contrato.
- [x] Lacuna operacional encontrada: o terminal exibiu o painel `Provider BYOK`, mas `/errors 10`
      informou `0 total · 0 no buffer`, criando contradição para o operador.
- [x] Decisão UX: erros recuperáveis genéricos de `model_call` continuam fora de `/errors`, mas
      falhas BYOK visíveis e contidas que encerram turno são diagnóstico operador-facing e devem
      aparecer no ErrorTracker.
- [x] Correção aplicada: `agent-runtime-events` registra em `defaultErrorTracker` falhas
      `terminal.byok_provider`, `terminal.byok_session`, `terminal.agent` e `terminal.session`
      apenas quando chegaram à superfície do operador; o tracker nunca pode quebrar renderização.
- [x] Contrato atualizado: linha viva compacta de tool exige `Ler arquivo`, não
      `workspace.read_file`, mantendo IDs técnicos fora da superfície humana padrão.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/agent-runtime-events.js`;
  - `node --check tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`;
  - `npx eslint src/copilot/terminal/events/agent-runtime-events.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`;
  - `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.
- [x] Correção aplicada no live-runner: quando `BLOCKED` por `byok-provider-turn-failed`, o
      summary agora também verifica `byok-provider-panel-visible` e
      `byok-provider-error-tracked`, para transformar falhas instáveis do provider em evidência
      objetiva de UX/diagnóstico.
- [x] Validação escopada do runner passou:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live de confirmação com provider estável:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-byok-errors-tracked-or-pass-20260605-0015`.
- [x] Resultado: `Status: PASS`; fluxo canônico completo, 178 eventos SSE, zero erros, export ok.
- [x] Evidência positiva: `post-ask-final-visible` passou com `assistant.message=yes`; tela mostrou
      `Resposta pós-pergunta LLM-B via SDK` sem `· Resposta pós-pergunta`.
- [x] Lacuna visual residual da live: `/usage now` ainda mostrava `Telemetria LLM modelo ... ·
      sem Premium Request · tipo ... · custo ...` numa linha longa.
- [x] Correção aplicada: `/usage now` divide telemetria recente em `Telemetria LLM`, `Request`,
      `Tipo` e `Detalhe`, preservando o modo `detail` para classe/motivo técnico.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/usage.js`;
  - `node --check tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`;
  - `npx eslint src/copilot/terminal/commands/usage.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`.
- [x] Live de confirmação com `/usage now` atualizado:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-usage-split-20260605-0020`.
- [x] Resultado: `Status: PASS`; fluxo completo, 228 eventos SSE, zero erros, export ok.
- [x] Evidência positiva: `/usage now` mostrou:
  - `Telemetria LLM modelo kilo-auto/free · custo 0.0000`;
  - `Request sem Premium Request`;
  - `Tipo continuação da pergunta humana`.
- [x] Observação operacional: a LLM-B separou `report_intent` e `read_file_content` em etapas/turnos
      diferentes, mas o runner aceitou corretamente o fluxo canônico porque as tools reais, deltas,
      ask_user, resposta humana e final pós-ask foram materializados.
- [x] Observação visual: o log PTY ainda pode registrar `SIM` grudado ao frame ANSI da linha viva,
      mas o summary manteve `no-prompt-double-render` e `ux-compact-ask-live-status`; manter sob
      observação em lives futuras.
- [x] Lacuna visual residual: eventos inline/timeline de uso repetiam `sem Premium Request` no
      label e no detalhe (`Uso BYOK sem Premium Request — modelo ... · custo ... · sem Premium
      Request · tokens ...`).
- [x] Correção aplicada: `formatLlmUsageOperatorDetail()` agora usa detalhe mais escaneável:
      `modelo ... · tokens entrada→saída · custo ...`; o estado `sem Premium Request` fica no
      label, e a classe/motivo técnica permanece no payload SSE/`detail`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/agent-runtime-events.js`;
  - `node --check tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`;
  - `npx eslint src/copilot/terminal/events/agent-runtime-events.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`;
  - `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.
- [ ] Próxima live, quando o provider falhar novamente: confirmar `byok-provider-error-tracked`
      no summary e `/errors 10` preenchido.
- [x] Auditoria UX de `/events`: labels remanescentes `SDK assistant`, `pergunta humana SDK`,
      `agente/usage`, `classe continuação...` e `export envelope` ainda pareciam backend
      vazando na superfície humana.
- [x] Decisão UX: sources técnicos continuam em `/events --raw`; no modo padrão:
  - `sdk/assistant.*` vira `LLM-B via SDK`;
  - `sdk/user_input.*` vira `pergunta ao operador`;
  - `agent/llm.*` vira `telemetria LLM`;
  - `export envelope` vira `registro export`;
  - `classification` sem `type` explícito usa prefixo `tipo`, não `classe`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/events.js`;
  - `node --check tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `npx eslint src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Live de auditoria iniciada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-human-sources-20260605-0025`.
- [x] Resultado: `Status: BLOCKED` por `blocked-by-assistant-ended-before-ask`; a LLM-B
      executou tools e deltas públicos, mas encerrou antes da ferramenta obrigatória `ask_user`.
- [x] Evidência positiva apesar do bloqueio: a linha viva e `/activity` já exibiram o detalhe
      compacto de uso (`Uso do modelo kilo-auto/free · tokens ... · custo ...` e
      `Uso BYOK sem Premium Request — modelo ... · tokens ... · custo ...`), sem duplicar
      `sem Premium Request` no detalhe.
- [x] Fortificação do harness live: diagnósticos de preflight, erro/protocol miss e ausência de
      `ask_user` agora coletam `/events 60` antes de `/events 100 --raw`, garantindo auditoria da
      superfície humana mesmo quando a live bloqueia antes do fluxo canônico completo.
- [x] Live de confirmação concluída:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-human-sources-20260605-0030`.
- [x] Resultado: `Status: PASS`; fluxo canônico completo com tools reais, deltas, `ask_user`,
      resposta `SIM`, final pós-pergunta, export Markdown, SSE conectado e zero erros.
- [x] Evidência em `/events 60`: `Mensagem da LLM-B · LLM-B via SDK`,
      `Pergunta ao operador · pergunta ao operador`, `Uso LLM · telemetria LLM · tipo
      continuação da pergunta humana`, e `transcript ... · registro export ...`.
- [x] Contrato adicionado ao harness: `sse-archive-human-source-labels` valida que `/events`
      legível contém `LLM-B via SDK`, `pergunta ao operador`, `telemetria LLM` e
      `registro export`, e que não regressa para `SDK assistant`, `pergunta humana SDK`,
      `agente/usage` ou `export envelope` antes do `--raw`.
- [x] Validação escopada do harness passou:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live de contrato concluída:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-human-source-contract-20260605-0035`.
- [x] Resultado: `Status: PASS`; critério `sse-archive-human-source-labels` passou no summary,
      além de `sse-archive-query-visible`, `no-terminal-errors` e `clean-quit`.
- [x] Auditoria UX de lifecycle em `/events`: `Sessão SDK · agente · tipo sessão atualizada`
      era uma linha redundante e centrada no backend; `Hook iniciado/concluído` também soava como
      jargão técnico no modo padrão.
- [x] Correção aplicada: `/events` padrão agora deriva `sdk.lifecycle` pelo `payload.type`
      (`Sessão atualizada`, `Sessão criada`, `Sessão removida` etc.), mostra
      `agent/sdk.lifecycle` como `controle da sessão`, troca hook por `Rotina iniciada/concluída`
      e remove resumo redundante quando ele só repete o label.
- [x] Contrato live ampliado: `sse-archive-human-source-labels` também exige
      `Sessão atualizada`, `controle da sessão`, `Rotina iniciada` e `Rotina concluída`, e bloqueia
      regressões para `Sessão SDK`, `Hook iniciado` e `Hook concluído` antes do `--raw`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/events.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Live de confirmação concluída:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-session-lifecycle-contract-20260605-0040`.
- [x] Resultado: `Status: PASS`; `/events 60` exibiu `Sessão atualizada · controle da sessão`,
      `Rotina iniciada` e `Rotina concluída`; o critério `sse-archive-human-source-labels`
      passou no summary.
- [x] Decisão de escopo: `Sessão SDK` permanece aceitável em `/events --raw` e em telas
      explicitamente diagnósticas como `/health full` até nova auditoria dessas superfícies.
- [x] Auditoria UX de `session.info`: lives antigas mostravam `Info SDK · configuration`,
      `Disabled tools: ...`, `Info SDK · model_retry` e mensagens em inglês na linha viva/activity,
      apesar de a impressão verbose já ter um renderizador mais amigável.
- [x] Correção aplicada: `session.info` agora usa `renderSdkSessionInfoForOperator()` como fonte
      única também para activity/linha viva; `configuration` vira `Configuração · ferramentas
      nativas desativadas`, `model_retry` vira `Retry modelo · resposta interrompida por erro do
      servidor; tentando novamente`, e outros tipos viram `Evento` com detalhe saneado.
- [x] Contrato live adicionado: `ux-no-raw-sdk-info-labels` bloqueia `Info SDK`,
      `configuration`, `Disabled tools`, `model_retry` e o texto inglês de retry antes do `--raw`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/sdk-session-events.js`;
  - `npx eslint src/copilot/terminal/events/sdk-session-events.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_dialog_runtime.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Live canônica confirmou `ux-no-raw-sdk-info-labels`: `artifacts/terminal-live/live-canonical-sdk-info-short-copy-contract-20260605-0050/summary.md`
      ficou `Status: PASS`, com `/events` limpo, `no-terminal-errors`, `clean-quit`, e primeiro
      viewport pós-boot exibindo `Configuração ferramentas nativas desativadas...` sem `Info SDK`,
      `Disabled tools`, `model_retry` ou texto inglês de retry antes do bloco `--raw`.
- [x] Live pós-critério: repetir cenário canônico após `sse-archive-human-source-labels`
      confirmou o contrato no summary, não só na evidência visual.
- [x] Auditoria UX de `/tools diag`: a live canônica ainda mostrava `Técnico`,
      `SDK report_intent` e `Refs call chatcmpl-too... · req ...` dentro da superfície
      diagnóstica intermediária. Isso preservava auditoria, mas quebrava a leitura humana e
      reintroduzia IDs estranhos no fluxo que o operador mais usa para entender tools.
- [x] Decisão UX: `/tools diag` agora é diagnóstico humano de triagem; `/tools all` é drill-down
      técnico; `/tools raw` e `/events --raw` continuam sendo o envelope bruto. Portanto, o modo
      `diag` pode mostrar classe, latência, categorias, contrato e lifecycle recente com nomes
      humanos, mas não deve mostrar `chatcmpl`, `requestId`, `traceId`, `report_intent_local` ou
      nomes SDK como linha primária.
- [x] Correção aplicada: `/tools diag` oculta refs e nomes internos de lifecycle; `/tools all`
      preserva `Nome interno` e `Rastreio`; o espaçamento global de `terminalThemeRow` ganhou
      duas colunas entre label e valor para evitar linhas visualmente coladas como
      `Configuração ferramentas...`.
- [x] Contrato unitário atualizado: `diag` exige diagnóstico humano sem nomes internos/refs, e
      `all` preserva rastreio técnico.
- [x] Contrato live atualizado: `diagnostic-ux-tools-diag-hierarchy` agora bloqueia `Nome interno`,
      `Técnico`, `Refs`, `Rastreio call/req/trace`, `chatcmpl-tool` e labels antigos na superfície
      `/tools diag`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/state/ui-theme.js`;
  - `node --check src/copilot/terminal/commands/tools.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint src/copilot/terminal/state/ui-theme.js src/copilot/terminal/commands/tools.js tests/unit/copilot/terminal/test_commands_tools.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js`.
- [x] Live canônica/diagnóstica passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-tools-diag-human-contract-20260605-0055`.
  - Resultado: `Status: PASS`; `/tools diag` mostrou `diagnóstico humano`, nomes humanos,
        lifecycle recente sem `chatcmpl`, refs ou nomes internos, `/events 60` permaneceu humano,
        `/errors 10` ficou zerado e `/health full` preservou painel temático.
- [x] Achado visual da live: `Classe tool` e categoria `tool` ainda apareciam em inglês no painel
      humano. Correção aplicada: classe/categoria `tool` viram `ferramenta`/`Ferramenta`, e o
      critério live agora bloqueia `Classe tool` e linha de categoria `tool`.
- [x] Validação adicional pós-tradução passou:
  - `node --check src/copilot/terminal/commands/tools.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint src/copilot/terminal/commands/tools.js tests/unit/copilot/terminal/test_commands_tools.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js`.
- [ ] Próxima live: repetir ciclo canônico/diagnóstico para confirmar a tradução final
      `ferramenta` em PTY real e verificar `/tools all` como rota de auditoria profunda.
- [x] Live de confirmação pós-tradução executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-tools-diag-ferramenta-contract-20260605-0100`.
  - Resultado: `Status: BLOCKED` por `blocked-by-assistant-empty-turn`; a LLM-B respondeu a
        pergunta, mas encerrou a continuação sem texto público antes do marcador final canônico.
- [x] Evidência positiva da live bloqueada: `/tools diag` exibiu `Classe ferramenta` e categoria
      `Ferramenta`, sem refs/IDs crus, confirmando a tradução final no PTY real.
- [x] Bug UX descoberto pela live: após `dialog.empty_after_user_input`, o aviso
      `Continuação pós-pergunta vazia` era registrado como atividade atual `phase=turn`; com runtime
      ocioso, a linha viva continuava pulsando por mais de 40s e quebrava em duas linhas físicas,
      ocupando a área do input.
- [x] Correção aplicada: o aviso de continuação vazia agora entra no histórico sem assumir o estado
      atual (`updateCurrent: false`), e a linha viva ganhou guarda explícita para não renderizar
      `Continuação pós-pergunta vazia` quando o runtime está ocioso.
- [x] Validação escopada pós-empty-turn passou:
  - `node --check src/copilot/terminal/wiring/terminal-agent-wiring.js`;
  - `node --check src/copilot/terminal/repl/live-status-line.js`;
  - `node --check src/copilot/terminal/commands/tools.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint src/copilot/terminal/wiring/terminal-agent-wiring.js src/copilot/terminal/repl/live-status-line.js src/copilot/terminal/commands/tools.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js`.
- [ ] Próxima live: repetir o cenário canônico para confirmar que uma continuação vazia não deixa
      linha viva presa e que o prompt permanece limpo.
- [x] Live seguinte capturou falha BYOK real:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-empty-turn-status-clear-contract-20260605-0105`.
  - Resultado: `Status: BLOCKED` por `blocked-by-byok-provider-turn-failed`; `/errors 10`
        registrou `terminal.byok_provider` com ação/contexto, e o terminal retornou a `Pronto`,
        confirmando que o empty-turn anterior não deixou a linha presa.
- [x] Bug UX descoberto nessa live: a linha viva de erro BYOK renderizava uma frase gigante com
      `Erro do SDK sem mensagem estruturada`, `/byok model`, modelo, raciocínio e `conversa ativa`,
      quebrando em quatro linhas físicas. O bloco durável e `/errors` já carregam ação/contexto;
      a linha viva deve ser apenas estado curto.
- [x] Correção aplicada: `phase=error` em provider BYOK agora renderiza
      `LLM-B erro · provider BYOK · <idade>`, sem detalhe longo, modelo, raciocínio ou runtime.
- [x] Contrato live adicionado: `ux-compact-byok-error-live-status` bloqueia vazamento de
      `Erro do SDK`, `/byok model`, modelo/raciocínio e `conversa ativa` na linha viva de erro.
- [x] Validação escopada pós-erro BYOK passou:
  - `node --check src/copilot/terminal/repl/live-status-line.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint src/copilot/terminal/repl/live-status-line.js tests/unit/copilot/terminal/test_live_status_line.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js`.
- [x] Live canônica final do pacote passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-byok-error-compact-status-contract-20260605-0110`.
  - Resultado: `Status: PASS`; fluxo canônico completo com tools reais, deltas, pergunta,
        resposta, final pós-pergunta, export, `/tools diag` com `Classe ferramenta`/`Ferramenta`,
        `/events 60` humano, `/errors 10` zerado e critério
        `ux-compact-byok-error-live-status` verde.
- [ ] Próxima live de falha controlada: reproduzir ou simular erro BYOK para confirmar que
      `/errors 10` mostra `terminal.byok_provider` com ação/contexto, sem duplicar eventos
      recuperáveis internos.
- [x] Auditoria UX de `/events` pós-erro BYOK: a live bloqueada
      `live-canonical-empty-turn-status-clear-contract-20260605-0105` mostrou que a superfície
      default ainda vazava `agent error`, `Info da sessão`, `Operation cancelled by user`,
      `terminal turn empty output`, `model_call`, `recoverable_model_call` e
      `non_user_initiated`. O envelope raw estava correto, mas o modo humano ainda espelhava
      nomes internos.
- [x] Decisão UX: `/events` default é histórico operacional para operador humano; `--raw`/`--json`
      continuam como auditoria técnica. Portanto, erro de provider, cancelamento, turno sem saída
      e classificação de uso devem ter labels e detalhes humanos, com IDs/nomes internos apenas em
      modos diagnósticos explícitos.
- [x] Correção aplicada: `agent.error` vira `Erro BYOK` quando há contexto BYOK; `session.info`
      com `infoType=cancellation` vira `Cancelamento` e traduz `Operation cancelled by user` para
      `operação cancelada pelo operador`; `terminal.turn.empty_output` vira `Turno sem saída`;
      `non_user_initiated`, `model_call`, `recoverable_model_call`, `errorOccurred` e `empty` são
      normalizados antes de aparecerem no resumo.
- [x] A origem `sdk/session.info` agora aparece como `controle da sessão`, evitando o rótulo solto
      `SDK` para cancelamentos e eventos de controle.
- [x] Contrato unitário adicionado em `test_commands_events.spec.js`: bloqueia os rótulos crus
      acima e exige `Erro BYOK`, `falha do provider BYOK`, `Cancelamento`, `Turno sem saída` e
      `tipo iniciado pelo agente`.
- [x] Contrato live adicionado: `sse-archive-human-operational-events` bloqueia esses vazamentos
      no trecho humano antes de `/events --raw` e exige label BYOK humano quando uma falha de
      provider aparece.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/commands/events.js`;
  - `node --check tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `npx eslint src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [ ] Próxima live: repetir cenário canônico com o novo critério
      `sse-archive-human-operational-events` e verificar se `/events 60` permanece legível em PTY
      real.
- [x] Live canônica executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-operational-human-contract-20260605-0120`.
  - Resultado: `Status: PASS`; novo critério `sse-archive-human-operational-events` passou,
        assim como `sse-archive-human-source-labels`, `ux-no-raw-sdk-info-labels`,
        `ux-compact-byok-error-live-status`, `no-terminal-errors`, `clean-quit` e correlação
        export/SSE.
- [x] Achado visual da live: `/activity 40` ainda mostrava `Técnico  Detalhes técnicos ficam em
      /activity detail` no modo padrão. A mensagem era funcional, mas colocava a superfície
      operacional novamente em tom de backend.
- [x] Correção aplicada: `/activity` padrão agora mostra `Drill-down  /activity detail mostra
      origem, trace, engine e streaming`, mantendo a rota técnica clara sem chamar o painel
      principal de técnico.
- [x] Achado visual da live: labels longos em `/events 60`, como `Tarefa em segundo plano
      concluída`, ultrapassavam a coluna fixa e empurravam timestamp/origem para a direita,
      quebrando a grade visual.
- [x] Correção aplicada: `terminalThemeRow()` ganhou `truncateLabel` opt-in; `/events` usa esse
      modo para manter a coluna estável sem afetar outras superfícies que precisam preservar label
      inteiro.
- [x] Contratos adicionados:
  - unitário de tema real em `test_ui_theme.spec.js` para truncamento opt-in e preservação default;
  - harness live `ux-activity-drilldown-label`;
  - harness live `ux-events-stable-long-label-column`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/state/ui-theme.js`;
  - `node --check src/copilot/terminal/commands/activity.js`;
  - `node --check src/copilot/terminal/commands/events.js`;
  - `node --check tests/unit/copilot/terminal/test_commands_activity.spec.js`;
  - `node --check tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `node --check tests/unit/copilot/terminal/test_ui_theme.spec.js`;
  - `npx eslint src/copilot/terminal/state/ui-theme.js src/copilot/terminal/commands/activity.js src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_ui_theme.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_ui_theme.spec.js`.
- [ ] Próxima live: repetir cenário canônico após o patch de `Drill-down`/truncamento para
      confirmar a grade visual em PTY real e fechar os novos critérios do harness.
- [x] Live de confirmação executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-activity-events-grid-contract-20260605-0130`.
  - Resultado: `Status: PASS`; critérios `ux-activity-drilldown-label` e
        `ux-events-stable-long-label-column` passaram no summary.
- [x] Evidência visual: `/activity 40` exibiu `Drill-down  /activity detail mostra origem, trace,
      engine e streaming`; `/events 60` exibiu `Tarefa em segundo pla…` com timestamp alinhado,
      sem empurrar a coluna.
- [ ] Próxima frente UX: revisar `/activity` timeline para reduzir duplicação de eventos de tarefa
      de segundo plano e tornar `Resposta do operador · agente` mais específica quando o evento
      vem de delivery/ack interno, mantendo autoria humana clara no transcript/export.
- [x] Auditoria de acks pós-`ask_user`: a live mostrou duas linhas de tarefa quase idênticas
      (`Resposta humana entregue ao resolvedor da ferramenta` e `Pergunta pendente persistida
      limpa`) no output ao vivo e na timeline de `/activity`. Essas linhas são úteis para raw/SSE,
      mas o operador já recebeu `Resposta enviada para pergunta pendente` e não precisa ver os acks
      internos como eventos principais.
- [x] Correção aplicada na origem: `Relay question.answered answers into hook tools resolver` e
      `Clear persisted pendingQuestion` passaram a ser classificados como background interno, sem
      print, sem update do current e sem histórico padrão; o broadcast SSE permanece com
      `internal=true`.
- [x] Correção aplicada em `/events`: o modo default sem filtros oculta eventos com
      `payload.internal === true`; consultas explícitas e `--raw`/`--json` continuam mostrando o
      envelope completo.
- [x] Correção aplicada na semântica de `/events`: `question.answered` agora aparece como
      `Resposta encaminhada` com origem `ponte da pergunta`, separando o relay auxiliar do evento
      canônico `user_input.completed`, que continua sendo `Resposta do operador`.
- [x] Contratos adicionados:
  - unitário bloqueando evento interno no `/events` default e preservando-o quando há filtro
        explícito;
  - unitário de fonte garantindo que os dois acks de pergunta continuam classificados como internos;
  - live `ux-no-question-ack-task-spam`.
- [x] Validação escopada passou:
  - `node --check src/copilot/terminal/events/agent-runtime-events.js`;
  - `node --check src/copilot/terminal/commands/events.js`;
  - `node --check tests/unit/copilot/terminal/test_commands_events.spec.js`;
  - `node --check tests/unit/copilot/terminal/test_dialog_runtime.spec.js`;
  - `npx eslint src/copilot/terminal/events/agent-runtime-events.js src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`.
- [ ] Próxima live: repetir cenário canônico para confirmar que os acks internos pós-pergunta não
      aparecem no output ao vivo, em `/activity 40` nem em `/events 60`, mas seguem no `--raw`.
- [x] Live de confirmação executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-no-question-ack-spam-contract-20260605-0145`.
  - Resultado: `Status: PASS`; critério `ux-no-question-ack-task-spam` passou no summary.
- [x] Evidência visual: após `SIM`, o output ao vivo mostrou apenas `Resposta enviada para
      pergunta pendente`; `/activity 40` não exibiu os acks auxiliares; `/events 60` exibiu
      `Resposta encaminhada · ponte da pergunta · SIM` e `Resposta do operador · pergunta ao
      operador · SIM`, separando relay de autoria canônica.
- [x] Próxima frente UX: revisar `/events`/`activity` para fontes ainda genéricas como
      `Atividade · agente`, `Atividade · SDK`, `Uso LLM · diálogo` e `Rotina iniciada · SDK`,
      avaliando se devem ser agregadas, renomeadas ou movidas para detail/raw.
- [x] Decisão UX: `/events` default sem filtros é uma tela de triagem operacional. Eventos de
      manutenção frequentes (`terminal.activity`, `activity.changed`, `busy`, `streaming.progress`,
      `delta`, `session.usage`, `hook.start`, `hook.end` e `sdk.lifecycle` de `session.updated`)
      ficam no archive durável, em `/events --raw`, `/events --json` e em consultas explícitas como
      `/events event=sdk.lifecycle`.
- [x] Correção aplicada: `commands/events.js` ganhou `isRoutineDefaultEvent()` e filtra essas
      entradas apenas no modo default sem filtros, preservando a busca explícita por evento, fonte,
      trace, turno, tool, request e hub.
- [x] Contrato unitário: `test_commands_events.spec.js` agora prova que o resumo default oculta
      ruído de atividade/lifecycle/hook/streaming/usage duplicado, mas mantém `Resposta do operador`
      e preserva `Sessão atualizada · controle da sessão` quando o operador consulta
      `event=sdk.lifecycle`.
- [x] Contrato live ajustado: `sse-archive-human-source-labels` deixou de exigir lifecycle/hook no
      bloco humano, e `sse-archive-default-control-noise-hidden` passa a falhar se `/events` default
      voltar a renderizar linhas de manutenção com timestamp.
- [x] Próxima live: repetir cenário canônico para confirmar visualmente que `/events 60` mostra
      transcript, pergunta/resposta, telemetria LLM e export, mas não repete heartbeat,
      `session.updated`, hooks de rotina, streaming progress ou `session.usage` duplicado.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-control-noise-hidden-20260605-0210`.
  - Resultado: `Status: PASS`; novo critério `sse-archive-default-control-noise-hidden` passou.
- [x] Evidência visual: `/events 60` ficou reduzido a `Mensagem da LLM-B`, `Pergunta ao operador`,
      `Resposta encaminhada`, `Resposta do operador`, `Uso LLM` de `telemetria LLM` e mensagem final;
      `session.updated`, `activity.changed`, `terminal.activity`, `hook.start`, `hook.end`,
      `streaming.progress` e `session.usage` seguiram presentes em `/events --raw`.
- [x] Novo achado da live: ainda apareceram `Turno concluído ×2 · diálogo`,
      `Turno concluído ×2 · LLM-B via SDK` e `Turno iniciado · LLM-B via SDK`, que são úteis para
      auditoria/reconciliação, mas redundantes no resumo default quando `assistant.message`,
      pergunta/resposta humana e telemetria já estão visíveis.
- [x] Decisão UX: `dialog.turn_start`, `dialog.turn_end`, `assistant.turn_start` e
      `assistant.turn_end` também pertencem a filtros explícitos e `--raw` no default; eventos de
      erro/timeout/turno vazio permanecem em eventos próprios e humanos.
- [x] Correção aplicada: `isRoutineDefaultEvent()` passou a ocultar turn lifecycle no resumo default,
      preservando consulta explícita (`/events event=assistant.turn_end`) e o envelope bruto.
- [x] Próxima live: repetir cenário canônico para confirmar que `/events 60` default fica somente
      com transcript, ask/answer, relay, uso LLM canônico e mensagem final, sem lifecycle de turno.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-events-turn-lifecycle-hidden-20260605-0225`.
  - Resultado: `Status: PASS`; `/events 60` exibiu somente seis linhas operacionais:
    `Mensagem da LLM-B`, `Pergunta ao operador`, `Resposta encaminhada`,
    `Resposta do operador`, `Uso LLM` e mensagem final da LLM-B.
- [x] Achado visual da live: durante a resposta `SIM`, a linha viva ainda podia repintar
      `LLM-B aguardando você · [PERG] · SIM` enquanto o operador estava digitando, criando sensação
      de disputa com o input mesmo com `no-prompt-double-render` passando.
- [x] Decisão UX: quando `readline.line` contém input humano parcial, a prioridade é absoluta do
      operador; a linha viva não deve pintar nem redesenhar prompt até a linha voltar a ficar vazia.
- [x] Correção aplicada: `dialog/output.js` ganhou `hasTerminalReadlineBufferedInput()` e
      `writeInlineStatus()` agora suprime o repaint transitório quando há texto no buffer do
      readline, limpando apenas a área reservada se já existir.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre que `writeInlineStatus()` não
      escreve, não chama `setPrompt()` e não chama `prompt()` quando o operador já digitou `SIM`.
- [x] Próxima live: repetir cenário canônico para verificar que a linha viva não intercala texto no
      input `[PERG]› SIM` durante a resposta humana.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-input-guard-events-clean-20260605-0240`.
  - Resultado: `Status: PASS`; `terminal.plain.log` mostra `você[kilo-auto…/high][PERG]› SIM`
    sem linha `LLM-B aguardando você` intercalada no momento da digitação.
- [x] Evidência adicional: `/events 60` permaneceu com seis linhas operacionais e o novo critério
      `sse-archive-default-control-noise-hidden` continuou passando.
- [x] Próxima frente UX: auditar `/activity 40`, porque ainda há duplicação visual de arquivo
      (`Arquivo leitura · package.json ×2` seguido de `Arquivo leitura · package.json`) e a timeline
      mistura eventos permanentes (`streaming`, `Uso BYOK`, `Processando mensagem`) em volume alto.
- [x] Decisão UX: `/activity` default deve responder “o que está acontecendo e o que acabou de
      acontecer”, não despejar toda a linha do tempo. A timeline completa pertence a
      `/activity detail`, junto com origem, trace, engine e streaming.
- [x] Correção aplicada: `commands/activity.js` agora colapsa arquivos repetidos por
      operação/caminho, escolhendo contagem máxima quando a projeção já trouxe linha agregada, para
      evitar inflar `×2` para `×3`.
- [x] Correção aplicada: a timeline default virou `Timeline operacional`, filtra ruído de idle,
      streaming e `Uso BYOK sem Premium Request`, limita a 12 linhas e mostra hint para
      `/activity detail` quando houver histórico omitido. O modo detail mostra `Timeline completa`.
- [x] Teste unitário: `test_commands_activity.spec.js` cobre arquivo repetido colapsado em uma linha,
      timeline operacional/default, timeline completa/detail e filtro de uso BYOK rotineiro.
- [x] Próxima live: repetir ciclo canônico/diagnóstico para confirmar visualmente que `/activity 40`
      não duplica `package.json`, não despeja streaming/uso rotineiro na timeline default e mantém
      detail como rota completa.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-activity-operational-timeline-20260605-0255`.
  - Resultado: `BLOCKED` por `blocked-by-assistant-empty-turn`; a LLM-B não emitiu a mensagem final
    pós-`SIM`, mas a live revelou bugs reais de UX.
- [x] Achado: `/activity 40` ainda mostrou `Arquivo leitura · package.json ×2` seguido de outra
      linha `Arquivo leitura · package.json`, porque a projeção recebia o mesmo alvo como caminho
      absoluto e relativo.
- [x] Correção aplicada: `aggregateTurnTraceFiles()` agora usa a forma exibida do caminho como chave
      de agregação, colapsando `/workspaces/.../package.json` e `package.json` na mesma linha.
- [x] Achado: após `SIM`, a linha viva podia renderizar um bloco de quatro linhas com
      `LLM-B aguardando operador · Resposta do operador · escolha estruturada · ...`, pesado demais
      para um estado transitório pós-resposta humana.
- [x] Correção aplicada: `live-status-line.js` agora compacta `phase=question` sem pergunta pendente
      como `LLM-B resposta recebida · aguardando LLM-B · Ns`, sem repetir detalhe, modelo ou
      `conversa ativa`.
- [x] Testes focados passaram:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js`.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-activity-path-live-status-20260605-0310`.
  - Resultado: `Status: PASS`; `/activity 40` mostrou uma única linha `Arquivo leitura ·
    package.json ×2`, sem duplicata absoluto/relativo, e `/events 60` permaneceu com eventos
    operacionais limpos.
- [x] Achado crítico apesar do PASS: o log PTY ainda mostrou
      `você...[PERG]› LLM-B aguardando você · [PERG] · SIMSIM`, ou seja, a linha viva de pergunta
      pendente ainda podia repintar no mesmo trecho visual do input antes da resposta automática.
- [x] Decisão UX revisada: enquanto uma pergunta humana ou input estruturado está pendente, o
      card/prompt são a fonte exclusiva do estado de decisão; a linha viva periódica deve ficar
      silenciosa até a resposta ser enviada. Depois da resposta, ela pode voltar como
      `LLM-B resposta recebida · aguardando LLM-B · Ns`.
- [x] Correção aplicada: `shouldRenderTerminalLiveStatusLine()` agora retorna falso para
      `pendingQuestion` e `request_user_input` pendentes, mantendo `formatTerminalLiveStatusLine()`
      formatável para diagnóstico/teste direto, mas impedindo o repaint periódico que compete com
      o cursor humano.
- [x] Contrato live reforçado: o runner ganhou critério
      `ux-question-live-status-does-not-compete-with-input`, bloqueando `SIMSIM` e status de
      pergunta pendente colado ao prompt.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-question-live-status-suppressed-20260605-0350`.
  - Resultado: `Status: PASS`; o novo critério `ux-question-live-status-does-not-compete-with-input`
    passou, o prompt mostrou `você...[PERG]› SIM` sem `SIMSIM`, e `/events 60` manteve apenas
    transcript, pergunta, resposta, uso LLM e final pós-pergunta.
- [x] Evidência positiva adicional: `/activity 40` mostrou somente `Arquivo leitura · package.json
      ×2` no resumo consolidado, sem duplicata absoluto/relativo.
- [x] Achado visual remanescente: o bloco durável de resumo do turno ainda exibiu `Arquivos LER
      package.json · LER package.json`, porque `renderTurnTraceSummary()` usava os arquivos crus do
      trace e não a chave visual humana.
- [x] Correção aplicada: `sdk-session-events.js` ganhou `selectTerminalTurnTraceSummaryFiles()`,
      deduplicando o resumo visual por operação + caminho humano sem apagar o trace bruto.
- [x] Teste unitário: `test_sdk_session_events_turn_summary.spec.js` cobre que
      `package.json` relativo e `/workspaces/.../package.json` viram uma única linha no resumo.
- [x] Contrato live reforçado: o runner ganhou `ux-turn-file-summary-deduped`, reprovando a linha
      `Arquivos LER package.json · LER package.json` no default antes dos diagnósticos crus.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-turn-file-summary-deduped-20260605-0410`.
  - Resultado: `Status: PASS`; `ux-question-live-status-does-not-compete-with-input` e
    `ux-turn-file-summary-deduped` passaram.
- [x] Evidência visual: o bloco durável do turno mostrou `Turno 2 ações · 1 arquivo` e
      `Arquivos LER package.json`, sem repetição; o prompt de pergunta mostrou `SIM` isolado, sem
      `SIMSIM` e sem `LLM-B aguardando você` colado ao input.
- [x] Próxima frente UX: revisar a timeline operacional de `/activity`, porque ela ainda inclui
      `Processando mensagem` e eventos de inicialização quando há eventos operacionais suficientes;
      avaliar se boot/processamento devem ficar em `/activity detail` por default após a primeira
      resposta.
- [x] Decisão UX: a timeline default deve preferir eventos com valor operacional imediato
      (ferramentas, pergunta humana, conclusão, erro/aviso). Boot e `Processando mensagem` só
      aparecem no default quando ainda não há evento operacional melhor; caso contrário ficam em
      `/activity detail`.
- [x] Correção aplicada: `isRoutineDefaultTimelineEntry()` passou a classificar `boot` e
      `turn/Processando mensagem` como rotina ocultável, com fallback automático para boot quando o
      histórico inteiro é rotina inicial.
- [x] Testes unitários: `test_commands_activity.spec.js` cobre que boot/processamento somem quando
      há `Tarefa em segundo plano concluída`, mas boot continua visível durante inicialização pura.
- [x] Achado adicional: `/activity` podia dizer `Arquivos 2` e, logo abaixo, mostrar apenas
      `Arquivo leitura · package.json ×2`, criando aparente contradição entre contador e lista.
- [x] Correção aplicada: `printTurnTraceSummary()` agora calcula arquivos únicos agregados para o
      default; em `detail`, quando há diferença, mostra `1 arquivo único · 2 registros`, preservando
      a informação bruta sem poluir o resumo humano.
- [x] Contrato live reforçado: o runner ganhou
      `ux-activity-post-turn-timeline-operational`, validando a última seção `/activity 40` e
      reprovando `inicialização`/`Processando mensagem` no default pós-turno.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/live-canonical-activity-timeline-operational-20260605-0425`.
  - Resultado: `Status: PASS`; `ux-activity-post-turn-timeline-operational` passou; `/activity 40`
    pós-turno mostrou timeline com pergunta, conclusão e ferramentas, sem boot/processamento; o
    resumo mostrou `Arquivos 1` e `Arquivo leitura · package.json ×2`.
- [x] Achado visual remanescente: em PTY estreito, a linha viva pós-`SIM` ainda quebrou em duas
      linhas como `LLM-B resposta recebida · aguardando LLM-B ·` / `0s`, apesar de não competir
      mais com o input.
- [x] Decisão UX: após a resposta humana, o histórico/card já explica a autoria; a linha viva deve
      ser apenas o pulso de continuação. Texto canônico: `LLM-B continuando · Ns`.
- [x] Correção aplicada: `live-status-line.js` encurtou `phase=question` pós-resposta para
      `continuando · Ns`, e o runner ganhou `ux-answer-live-status-stays-single-line`.
- [x] Validação focada:
  - `node --check src/copilot/terminal/events/tool-lifecycle-runtime.js src/copilot/terminal/events/io-activity-events.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/state/tool-call-registry.js tests/unit/copilot/terminal/test_io_activity_events.spec.js`.
  - `npx eslint src/copilot/terminal/state/tool-call-registry.js src/copilot/terminal/events/tool-lifecycle-runtime.js src/copilot/terminal/events/io-activity-events.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/events/agent-runtime-events.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_io_activity_events.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`.
- [x] Live executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-question-output-guard-20260605-0516 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-16-03-451Z/summary.md`.
  - Resultado: `Status: PASS`; `ux-answer-live-status-stays-single-line`,
    `ux-activity-post-turn-timeline-operational` e `ux-no-durable-tool-output-inside-question-prompt`
    passaram.
- [x] Evidência visual: `terminal.plain.log` mostrou uma única linha
      `você[kilo-auto…/high][PERG]› SIM`; grep confirmou ausência de `Ferramenta`, `Arquivo`,
      `Concluído`, `Falhou` ou `Turno` na linha do prompt `[PERG]`.
- [x] Achado crítico corrigido: live anterior mostrou que o SDK pode emitir `ask_user` e outra tool
      no mesmo lote `preToolUse`; nessa corrida, `Arquivo leitura` e `Concluído Ler arquivo` podiam
      ser impressos enquanto a pergunta humana estava ativa, poluindo o input.
- [x] Decisão UX: enquanto o terminal aguarda pergunta humana, o card/prompt `[PERG]` é superfície
      exclusiva. Tools e I/O podem continuar no ledger canônico (`/activity`, `/events`, SSE,
      turn trace), mas não devem disputar stdout durável com o input humano.
- [x] Correção estrutural: `ToolCallRegistry` ganhou `suppressLiveNarration()` e
      `shouldSuppressLiveNarration()`, preservando a decisão mesmo quando `hook.start` chega antes
      ou depois de `tool.execution_start`.
- [x] Correção de fluxo SDK: `sdk-session-events.js` detecta `preToolUse` com `ask_user` +
      ferramentas irmãs e marca essas ferramentas como silenciosas no transcript vivo.
- [x] Correção de saída: `tool-lifecycle-runtime.js`, `io-activity-events.js` e o heartbeat de
      `agent-runtime-events.js` respeitam a barreira de pergunta humana; dados continuam sendo
      gravados em activity, lifecycle SSE e turn trace.
- [x] Teste unitário: `test_io_activity_events.spec.js` cobre I/O correlacionado a tool silenciosa e
      I/O emitido durante `waiting_for_input/question`, ambos sem `println` e com SSE preservado.
- [x] Contrato live reforçado: o runner ganhou
      `ux-no-durable-tool-output-inside-question-prompt`, bloqueando tool/file/turn na linha
      `[PERG]›`.
- [x] Contrato live reforçado: o runner ganhou `ux-no-durable-output-inside-default-prompt`,
      protegendo também o prompt ocioso normal `você›` contra linhas duráveis grudadas.
- [x] Achado UX: `/activity 40` default ainda podia repetir categoria e label na timeline, como
      `ferramenta · Ferramenta concluída` ou `pergunta · Pergunta ao operador`, deixando a leitura
      pesada sem acrescentar informação.
- [x] Correção aplicada: `renderTimelineEntryHeading()` remove categoria redundante quando a label
      já carrega a semântica humana (`Ferramenta`, `Integração`, `Arquivo`, `Pergunta`, `Resposta`,
      `Tarefa`, `Turno`).
- [x] Teste unitário: `test_commands_activity.spec.js` cobre que `Tarefa em segundo plano concluída`
      aparece sem prefixo duplicado `tarefa ·`.
- [x] Contrato live reforçado: o runner ganhou `ux-activity-no-redundant-timeline-labels`, reprovando
      `ferramenta · Ferramenta`, `pergunta · Pergunta`, `tarefa · Tarefa` e `turno · Turno` no
      `/activity 40` default pós-turno.
- [x] Validação focada:
  - `node --check src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx eslint src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live de auditoria pós-critério executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-activity-labels-20260605-0522 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-22-09-678Z/summary.md`.
  - Resultado: `Status: FAIL`; a live revelou `você[kilo-auto…/high]›   Falhou ... tool genérica`
    e ausência de materialização/export da pergunta quando o SDK primeiro tentou `ask_user` com
    schema inválido.
- [x] Decisão UX: stdout durável não pode depender apenas de carriage-return/ANSI para sair da
      linha viva; logs plain, VS Code terminal e operador humano precisam ver uma separação física
      clara entre prompt e eventos permanentes.
- [x] Correção aplicada: `printlnBlock()` agora abre uma quebra real antes de blocos duráveis quando
      há readline ativo sem input humano parcial, preservando a limpeza ANSI e impedindo
      `você› Uso do modelo`/`você› Falhou` no mesmo registro visual.
- [x] Decisão UX: falhas de `ask_user` devem aparecer como `Pergunta ao operador` falha, nunca como
      `tool genérica`; sucesso normal de `ask_user` continua sendo responsabilidade exclusiva do
      card/prompt humano para evitar duplicação.
- [x] Correção aplicada: `sdk-session-events.js` passa a registrar no `ToolCallRegistry` nome,
      argumentos e apresentação humana já no `preToolUse`; `tool-lifecycle-runtime.js` só suprime
      `ask_user` bem-sucedido, deixando falhas semanticamente visíveis.
- [x] Testes unitários:
  - `test_tool_activity_presenter.spec.js` cobre `ask_user` como `Pergunta ao operador`.
  - `test_tool_lifecycle_runtime.spec.js` cobre que falha de `ask_user` grava/imprime pergunta
    humana e não `tool genérica`.
- [x] Contrato live reforçado: o runner ganhou `ux-no-generic-tool-failure-copy`, além de
      `ux-no-durable-output-inside-default-prompt` e
      `ux-activity-no-redundant-timeline-labels`.
- [x] Validação focada:
  - `node --check src/copilot/terminal/dialog/output.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/events/tool-lifecycle-runtime.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/events/tool-lifecycle-runtime.js src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live de confirmação executada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-prompt-barrier-20260605-0230 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-29-40-886Z/summary.md`.
  - Resultado: `Status: PASS`; passaram `ux-no-durable-output-inside-default-prompt`,
    `ux-no-generic-tool-failure-copy`, `ux-activity-no-redundant-timeline-labels`,
    `ask-user-single-source`, `export-ask-user`, `export-ask-user-answer`,
    `sse-canonical-transcript-events`, `no-prompt-double-render` e `no-terminal-errors`.
- [x] Achado UX: o boot ainda podia renderizar dois prompts idênticos antes de `LLM-B pronta`, como
      `você[auto/high]›` em uma linha e, logo em seguida, outro `você[auto/high]›` com a linha viva
      de `Iniciando agente`.
- [x] Decisão UX: durante `phase=boot`, blocos duráveis (`printlnBlock`) não devem redesenhar prompt
      automaticamente. A linha viva pode reservar sua área e pintar o prompt uma vez; o prompt final
      pós-boot deve ser agendado explicitamente quando a atividade marca `Pronto`.
- [x] Correção aplicada: `redrawPromptIfInteractive()` agora ignora atividade `boot`; `_tryStartDialogLoop()`
      agenda `buildUserPrompt()` depois de `markTerminalActivityIdle('Sessão retomada...')`.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre que `printlnBlock('Preparando
      agente...')` escreve a linha permanente, mas não chama `setPrompt()`/`prompt()` durante boot.
- [x] Contrato live reforçado: o runner ganhou `ux-no-boot-prompt-double-paint`, bloqueando dois
      prompts idênticos antes de `LLM-B pronta`.
- [x] Validação focada:
  - `node --check src/copilot/terminal/dialog/output.js src/copilot/terminal/dialog/engine.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
  - `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/dialog/engine.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live no-PR de inspeção:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --no-pr --label live-no-pr-boot-prompt-20260605-0235 --timeout-ms 90000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-35-25-772Z/summary.md`.
  - Resultado geral: `Status: FAIL` por timeout/diagnósticos incompletos do próprio ciclo no-PR, mas
    a inspeção do `terminal.plain.log` confirmou que a duplicação de prompt de boot sumiu.
- [x] Live canônica de contrato:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-boot-prompt-dedupe-20260605-0237 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-37-25-546Z/summary.md`.
  - Resultado geral: `Status: FAIL` porque o modelo pulou os oito `DELTA-CANONICAL-*` antes do
    `ask_user`; porém `ux-no-boot-prompt-double-paint`,
    `ux-no-durable-output-inside-default-prompt`, `ux-no-generic-tool-failure-copy`,
    `ux-activity-no-redundant-timeline-labels` e `no-terminal-errors` passaram.
- [x] Achado UX: respostas automáticas muito rápidas podiam ser enviadas antes de o prompt dedicado
      `[PERG]›` aparecer no TTY, fazendo o plain/live registrar `SIM` como linha solta, apesar de
      `user_input.requested` e do card persistente existirem.
- [x] Decisão UX: `ask_user` é exceção ao guard de `busy`; enquanto o runtime está aguardando input
      humano, o prompt deve redesenhar mesmo durante um turno busy, porque a pergunta é parte da
      superfície interativa ativa, não uma nova pergunta concorrente.
- [x] Correção aplicada: `event-adapters.js` lê `readTerminalRuntimeState()` e permite
      `scheduleTerminalPromptRedraw()` durante `waiting_for_input` ou `pendingQuestion` real; o
      runner live só envia a resposta automatizada quando card e prompt `[PERG]›` já estão
      materializados.
- [x] Teste unitário: `test_terminal_event_adapters.spec.js` cobre que o adapter redesenha prompt de
      pergunta humana mesmo com `getBusy() === true`.
- [x] Contrato live reforçado: o runner ganhou `ask-user-input-prompt-visible`, reprovando cenário
      em que a pergunta existe, mas o prompt humano dedicado não aparece antes da resposta.
- [x] Live de confirmação parcial:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-question-prompt-redraw-20260605-0243 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-42-49-136Z/summary.md`.
  - Resultado geral: `Status: BLOCKED` por `assistant-empty-turn` na continuação pós-pergunta, mas
    o `terminal.plain.log` mostrou `você[kilo-auto…/high][PERG]› SIM`, confirmando a correção do
    prompt humano.
- [x] Achado no harness: quando o bloqueio ocorre depois de deltas/tools/pergunta já materializados,
      o resumo antigo trocava a suíte completa por `root-cause-not-ux-duplication`, apagando sinais
      úteis do terminal.
- [x] Correção aplicada: o runner diferencia `assistant-empty-after-user-input`,
      `assistant-empty-after-ask` e `assistant-empty-turn`; bloqueios tardios agora preservam
      `evaluateOutput()` e adicionam o critério `blocked-by-*` em vez de ocultar critérios já
      observáveis.
- [x] Live canônica saudável:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-late-blocker-classification-20260605-0257 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T05-47-40-339Z/summary.md`.
  - Resultado: `Status: PASS`; deltas, tool, `ask_user`, prompt `[PERG]›`, resposta `SIM`, final
    pós-pergunta, export e SSE passaram.
- [x] Achado visual pós-PASS: a inspeção humana do plain log mostrou prompts normais consecutivos
      depois de `Resposta enviada para pergunta pendente`, mas o critério antigo só detectava
      `você› você›` na mesma linha.
- [x] Contrato live reforçado: `no-prompt-double-render` agora também reprova prompts normais em
      linhas consecutivas, como `você[...]›` seguido de outro `você[...]›` antes da linha viva.
- [x] Correção aplicada: o REPL não força `refreshPrompt()` após resposta humana aceita; respostas
      inválidas ainda redesenham o prompt para permitir correção imediata.
- [x] Correção aplicada: `sdk-session-events.js` deixou de chamar `refreshPromptIfIdle()` em
      `user_input.completed`; a conclusão da pergunta agora registra transcript/SSE/activity sem
      disputar repaint com a continuação do modelo.
- [x] Correção estrutural: `dialog/output.js` ganhou
      `parkTerminalPromptForContinuation()`, uma primitiva transitória de TTY para estacionar o
      prompt normal durante a continuação pós-resposta humana. Enquanto o estacionamento está ativo,
      pinturas de prompt usam `buildWaitingPrompt()`; quando a atividade volta a `idle` ou o prazo
      expira, o prompt normal volta automaticamente.
- [x] Barrel preservado: `dialog/index.js` exporta `parkTerminalPromptForContinuation()` e
      `repl-lifecycle.js` consome a função pelo barrel público.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre que, com prompt estacionado,
      `writeInlineStatus()` pinta prompt de espera (`LLM-B pensando`) e não repinta `você›`.
- [x] Validação focada:
  - `node --check src/copilot/terminal/dialog/output.js src/copilot/terminal/dialog/index.js src/copilot/terminal/repl/repl-lifecycle.js src/copilot/terminal/events/sdk-session-events.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js tests/unit/copilot/test_terminal_event_adapters.spec.js`.
  - `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/dialog/index.js src/copilot/terminal/repl/repl-lifecycle.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/events/event-adapters.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js tests/unit/copilot/test_terminal_event_adapters.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Lives de regressão do critério:
  - `artifacts/terminal-live/2026-06-04T05-51-12-545Z/summary.md` e
    `artifacts/terminal-live/2026-06-04T05-52-52-830Z/summary.md` reprovaram
    `no-prompt-double-render`, confirmando que a régua passou a detectar o problema visual real.
  - `artifacts/terminal-live/2026-06-04T05-58-09-623Z/summary.md` bloqueou por
    `assistant-ended-before-ask`; o modelo materializou deltas e encerrou antes de chamar
    `ask_user`, então não exercitou a correção pós-`SIM`.
- [x] Live canônica pós-estacionamento do prompt:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-canonical-post-answer-prompt-parked-after-commit-20260605-0322 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T06-03-15-731Z/summary.md`.
  - Resultado: `Status: PASS`; o terminal materializou `você[kilo-auto…/high][PERG]› SIM`,
    imprimiu `Resposta enviada para pergunta pendente`, estacionou o prompt normal como
    `LLM-B pensando` durante a continuação, materializou `POST-ASK-CANONICAL-FINAL: usuário
    confirmou SIM` e passou `no-prompt-double-render`, `ask-user-input-prompt-visible`,
    `post-ask-final-visible`, `no-terminal-errors`, export e correlação SSE.
- [ ] Próxima frente UX: auditar a sincronização entre comandos injetados pelo harness e prompt
      real, porque o log plain ainda mostra comandos como `/usage now` colados ao prompt em alguns
      trechos; confirmar se é artefato de `script`/ANSI ou desalinhamento visível no terminal humano.
- [x] Auditoria inicial: o primeiro `/usage now` com prompt na mesma linha é esperado em TTY, pois
      representa o comando digitado no prompt humano; porém `/activity 12` e o prompt do cenário
      eram enviados imediatamente depois, antes de o REPL voltar ao prompt.
- [x] Decisão: lives canônicas devem dirigir o terminal como operador humano, aguardando prompt entre
      comandos de pré-diagnóstico. Rajadas rápidas continuam úteis em testes de stress, mas não no
      baseline estético usado para comparar UX real.
- [x] Correção aplicada: o caminho canônico do runner passou a usar
      `startPromptSynchronizedCommandSequence(['/usage now', '/activity 12'], ...)` antes de enviar
      o prompt do cenário, reaproveitando o mecanismo já usado por lives BYOK/no-PR.
- [x] Achado crítico exposto pela live sincronizada: após `/usage now`, o REPL podia não repintar o
      prompt quando o comando terminava dentro da janela curta de dedupe de prompt. O terminal seguia
      aceitando input, mas a superfície humana parecia parada, sem linha pronta.
- [x] Decisão UX: dedupe continua válido para eventos assíncronos, streaming, tools e pergunta
      humana; conclusão de comando explícito (`/...`) é uma fronteira de interação humana e deve
      forçar repaint do prompt mesmo que o texto seja idêntico ao anterior.
- [x] Correção aplicada: `redrawTerminalPrompt()` e `scheduleTerminalPromptRedraw()` ganharam opção
      `{ force: true }`; `repl-lifecycle.js` usa essa opção apenas após `dispatchCmd()` explícito e
      no caminho de comando imediato/steer.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre repaint forçado de prompt
      idêntico após comando explícito rápido, preservando o dedupe default.
- [x] Achado adicional da live sincronizada:
      `artifacts/terminal-live/2026-06-04T06-13-16-980Z/summary.md` falhou apenas
      `ux-no-durable-output-inside-default-prompt`. O log mostrou um prompt idle vazio
      `você[kilo-auto…/high]›` imediatamente antes do card `Pergunta ao operador`, porque o fim do
      turno materializado repintou prompt milissegundos antes do SDK iniciar `ask_user`.
- [x] Decisão UX: após um turno materializado, prompt idle pode esperar uma janela curtíssima para
      permitir chegada de `ask_user`/input estruturado; prompts de comando explícito continuam
      imediatos via `{ force: true }`, e prompt de pergunta humana não deve ser adiado quando a
      pergunta já estiver ativa.
- [x] Correção aplicada: `deferTerminalIdlePromptRedraw()` foi adicionada ao renderer central,
      exportada pelo barrel `dialog/index.js` e chamada no final de turno em `dialog/engine.js` antes
      de `markTerminalActivityIdle()`. A função adia apenas prompt idle não-forçado e reaproveita a
      mesma fila de redraw para não criar uma segunda superfície de prompt.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre que prompt idle pós-turno é
      adiado, enquanto repaint forçado de comando explícito segue imediato.
- [x] Achado adicional: em comandos rápidos, `readline` pode manter `rl.line` preenchido por um tick
      depois de emitir o evento `line`. O scheduler respeitava esse valor mesmo com `{ force: true }`,
      então o prompt pós-comando podia sumir e o harness enviava o próximo comando sem superfície
      visual pronta.
- [x] Correção aplicada: repaint forçado ignora `rl.line` stale apenas dentro do redraw agendado com
      `{ force: true }`. Redraw normal continua protegendo input humano parcial.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre repaint forçado com
      `rl.line='/usage now'`.
- [x] Achado no contrato live: `ux-no-durable-output-inside-default-prompt` tinha falso positivo
      quando o prompt do usuário continha texto longo com palavras como `ferramenta`; o critério foi
      estreitado para labels operacionais alinhados (`›  Ferramenta`, `›  Uso do modelo` etc.).
- [x] Live canônica pós-deferência de prompt:
  - `artifacts/terminal-live/2026-06-04T06-21-55-432Z/summary.md`.
  - Resultado: `Status: PASS`; passaram deltas, tools, pergunta humana, resposta, pós-ask,
    export/SSE, `ux-no-durable-output-inside-default-prompt`, `no-prompt-double-render`,
    `no-terminal-errors` e `clean-quit`.
- [x] Achado visual remanescente: apesar do PASS, o prelude ainda mostrou `/activity 12` sem prompt
      no plain log. O problema fica restrito ao harness/prelude e não quebrou o fluxo humano central
      de deltas, tools e pergunta.
- [x] Tentativa rejeitada: atrasar o repaint pós-comando para o próximo macrotask em
      `repl-lifecycle.js` gerou regressão pior:
      `artifacts/terminal-live/2026-06-04T06-24-16-588Z/summary.md` falhou
      `no-prompt-double-render` com `você› você›` antes do export. A mudança foi revertida.
- [ ] Próxima frente UX: tratar prelude/diagnósticos do harness como fila de comandos com critério
      próprio, sem alterar novamente o repaint canônico do REPL até haver evidência mais clara do
      comportamento humano real.
- [x] Limpeza lexical adicional: `tool-activity-presenter.js` ainda tinha fallback
      `executando tool genérica`. A superfície humana agora usa
      `executando ferramenta não classificada`, preservando detalhe técnico apenas em raw/detail.
- [x] Teste unitário: `test_tool_activity_presenter.spec.js` cobre ferramenta desconhecida sem
      regressão para `tool genérica`.

### 12.43 Diagnóstico full sem taxonomia crua

- [x] Auditoria pós-compactação: `/health full`/`/diagnose full` ainda preservavam rótulos de
      implementação em uma tela humana detalhada: `MCP bridge`, `Hub storage`, `Boot report`,
      `Shutdown`, `Timers` e `preflight SDK`.
- [x] Decisão UX: `full` é painel humano detalhado, não dump bruto. Termos de implementação ficam
      em `detail`, `raw`, `/events --raw`, JSON/export ou em código/testes; a tela humana deve usar
      nomes operacionais consistentes com a gramática do restante do terminal.
- [x] Correção aplicada: `diagnose.js` removeu o mini-sistema ANSI local e passou a usar
      `terminalThemeText()` como fonte única de cores. A seção de infraestrutura agora fala em
      `MCP remoto`, `Histórico`, `Inicialização`, `Encerramento`, `Temporizadores` e
      `Ciclo de vida`.
- [x] Correção aplicada: métricas de ciclo de vida agora traduzem `sdk-preflight` para
      `checagem do SDK`, `boot` para `inicialização`, `shutdown` para `encerramento`, e evitam
      `n/d`, `handlers` e `report` na superfície humana.
- [x] Teste unitário: `test_commands_diagnose.spec.js` bloqueia regressão para os rótulos antigos e
      usa regex para validar colunas alinhadas sem depender de espaçamento fixo.
- [x] Validação escopada: `node --check`, `vitest` de `test_commands_diagnose.spec.js` e `eslint`
      para `diagnose.js`/teste passaram.
- [ ] Próxima frente UX: auditar `/status`, `/usage`, `/activity detail` e comandos de sessão para
      o mesmo contrato: default/full humano, detail/raw técnico, sem misturar IDs e nomes internos
      no fluxo principal do operador.

### 12.44 Activity sem identificadores de tool no fluxo humano

- [x] Auditoria: `/activity` ainda podia mostrar `Executando tool` e `web_fetch` no modo padrão,
      reproduzindo o aspecto cru das screenshots mesmo depois das correções de `report_intent`.
- [x] Decisão UX: detalhes textuais compactos podem conter o nome operacional da ferramenta, mas
      não o identificador técnico quando existir nome humano canônico no presenter central.
- [x] Correção aplicada: `tool-activity-presenter.js` ganhou nomes humanos para ferramentas web
      (`web_fetch`, `web_search`, `fetch_url`), e `activity.js` passou a humanizar identificadores
      conhecidos dentro de labels e detalhes compactos.
- [x] Correção aplicada: `Executando tool`, `Tool em andamento`, `Tool concluída` e `Tool falhou`
      são normalizados para `ferramenta` antes de renderizar a superfície humana.
- [x] Teste unitário: `test_commands_activity.spec.js` exige `Executando ferramenta` e
      `Buscar na web`, bloqueando retorno de `Executando tool` e `web_fetch` no default.
- [x] Validação escopada: `node --check`, `vitest` de `/activity` + presenter e `eslint` dos
      arquivos alterados passaram.
- [ ] Próxima frente UX: revisar `/metrics` e `/usage now` para traduzir `Context window`,
      `Premium Request`, `provider`, `runtime alvo`, `bridge/live`, `Sync Hub`, `Billing`, `Inject`
      e IDs de sessão conforme o mesmo contrato de humano/default versus detail/raw.

### 12.45 Usage e metrics com português operacional

- [x] Auditoria: `/usage now` ainda mostrava `Context window`, `Premium Request`, `provider` e
      `boot/probe`; `/metrics` ainda mostrava `runtime alvo`, `sessão SDK`, `modo sdk`,
      `bridge/live`, `Sync Hub`, `Billing`, `Inject`, `preflight`, `autostart` e IDs completos no
      modo padrão.
- [x] Decisão UX: `/usage now` é prelude humano e deve explicar contexto, cobrança histórica e
      vínculo sem inglês técnico. `/metrics` default é painel operacional; digests e IDs completos
      ficam em `detail`.
- [x] Correção aplicada: `/usage now` passou para `Janela de contexto`, `Pedido premium`,
      `provedor`, `boot/sonda`, `ferramenta/automação` e `sem pedido premium`.
- [x] Correção aplicada: `/metrics` passou para `Runtime alvo`, `Sessão SDK`, `Sessão hub`,
      `Modo SDK`, `Turnos`, `Timeline`, `Sincronização`, `Cobrança`, `Injeção`, `Transporte`,
      `checagem` e `auto-início`, ocultando IDs/digests no default.
- [x] Correção aplicada: `cmdMetrics` ganhou modo `detail` para preservar digest/IDs quando o
      operador quer diagnóstico técnico.
- [x] Teste unitário: `test_commands_metrics_usage.spec.js` bloqueia retorno de `Context window`,
      `Premium Request`, `bridge/live`, `Inject`, IDs completos e digest no default, preservando
      detail para diagnóstico.
- [x] Validação escopada: `node --check`, `vitest` e `eslint` de `/usage`/`/metrics` passaram.
- [ ] Próxima frente UX: auditar comandos com ANSI manual (`byok.js`, `git.js`,
      `workspace-index.js`, caminhos legados de `session.js`) e priorizar os que aparecem nas lives
      ou no fluxo BYOK/terminal.

### 12.46 Linha viva e diagnose sem `Executando tool`

- [x] Auditoria: a linha viva ainda aceitava `ferramenta · Executando tool`, e `/diagnose full`
      herdava `Executando tool`/`web_fetch` da atividade atual.
- [x] Decisão UX: a linha viva é a superfície mais sensível do terminal; qualquer identificador de
      ferramenta conhecido deve ser traduzido antes de chegar nela. Diagnose full deve seguir o
      mesmo contrato.
- [x] Correção aplicada: `live-status-line.js` humaniza identificadores conhecidos em labels e
      detalhes compactos, troca `Executando tool`/`Tool concluída`/`Tool falhou` por
      `ferramenta`, e mantém IDs internos compactados como `id interno`.
- [x] Correção aplicada: `diagnose.js` passou a humanizar labels/detalhes de atividade antes de
      renderizar `Atividade`/`Atual`.
- [x] Teste unitário: `test_live_status_line.spec.js` bloqueia retorno de `Executando tool` e
      `read_file_content`; `test_commands_diagnose.spec.js` bloqueia `Executando tool` e
      `web_fetch`.
- [x] Validação escopada: `node --check`, `vitest` e `eslint` de linha viva/diagnose passaram.
- [ ] Próxima frente UX: revisar os eventos BYOK/runtime que ainda dizem `provider BYOK`,
      `Premium Request` e `provider ...` em linhas de erro/uso, escolhendo uma terminologia
      consistente sem ocultar informação operacional.

### 12.47 BYOK/runtime com terminologia consistente

- [x] Auditoria: eventos runtime/BYOK ainda emitiam `provider BYOK`, `provider openai`,
      `Premium Request`, `sem Premium Request`, `Provider BYOK`, `Fallback` e mensagens de ação com
      `provider/modelo` no fluxo humano.
- [x] Decisão UX: “BYOK” pode permanecer como termo de domínio, mas a interface humana deve usar
      `provedor`, `pedido premium`, `sem pedido premium` e `troque provedor/modelo`; campos
      estruturados continuam disponíveis em SSE/raw/export.
- [x] Correção aplicada: `agent-runtime-events.js` normaliza detalhes recuperáveis BYOK, linhas
      visíveis, labels de atividade e linhas de uso/cobrança para a terminologia nova.
- [x] Correção aplicada: `/events` traduz `byok_provider_failure`, `provider`, `provider BYOK` e
      `Premium Request` também quando chegam dentro de `operatorMeaning` legado.
- [x] Correção aplicada: a linha viva especial de erro BYOK mostra `provedor BYOK`, mantendo a linha
      curta e sem despejar `/byok model`, modelo ou detalhe cru.
- [x] Correção aplicada: `dialog/engine.js` removeu ANSI manual do erro BYOK de turno, trocando a
      linha crua `[byok] ... sem Premium Request` por rows temáticas `BYOK` e `Ação`.
- [x] Correção aplicada: admission control e atividades de falha BYOK passaram a usar `provedor
      BYOK` e `sem pedido premium`.
- [x] Teste unitário: `test_commands_events.spec.js` e `test_live_status_line.spec.js` bloqueiam
      retorno de `provider BYOK`/`provider openai` no output humano.
- [x] Validação escopada: `vitest` de eventos/linha viva/activity e `eslint` dos arquivos alterados
      passaram.
- [ ] Próxima frente UX: auditar `session.js`/`context.js` para `Sync Hub`, `Billing/modelo`,
      `Inject port`, `sessão SDK` e IDs completos no modo padrão, priorizando rotas que aparecem em
      `/status`, `/now`, `/session` e menu.

### 12.48 Status/session/menu sem rótulos de dump

- [x] Auditoria: `/status full` ainda tinha `Inject port`, `Billing/modelo`, `Boot`, `Shutdown`,
      `handlers`, `Prompt digest`, `n/d` e atividade sem normalização; o menu ainda dizia
      `Context window`.
- [x] Decisão UX: `/status full` continua detalhado, mas não deve parecer dump de estrutura interna.
      Labels humanos podem preservar dados operacionais, enquanto termos de implementação ficam em
      rotas explicitamente técnicas.
- [x] Correção aplicada: `session.js` passou a usar `Porta entrada`, `Cobrança/modelo`,
      `Inicialização`, `Encerramento`, `rotinas`, `Prompt vinculado/sem vínculo`,
      `sem leitura`/`sem amostra` e atividade humanizada via presenter de tools.
- [x] Correção aplicada: `Sync Hub` virou `Sincronização` nos painéis de status/timeline; menu
      passou de `Context window` para `Janela de contexto`.
- [x] Teste unitário: `test_commands_session.spec.js` bloqueia `Billing/modelo`, `Prompt digest`,
      `Inject port`, `Shutdown` e `handlers`, usando regex para colunas alinhadas.
- [x] Validação escopada: `node --check`, `vitest` e `eslint` de `session.js`/`menu.js` e testes
      associados passaram.
- [ ] Próxima frente UX: auditar `context.js`, `git.js`, `workspace-index.js` e rotas BYOK longas
      com ANSI manual, priorizando as que aparecem em lives ou no fluxo inicial antes do operador
      enviar prompts.

### 12.49 Linha viva não é prompt de input

- [x] Live canônica pós-humanização:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-terminal-ux-humanized-copy-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T06-54-46-066Z/summary.md`.
  - Resultado geral: `Status: FAIL` apenas em `llm-usage-visible`; o SSE continha três eventos
    `llm.usage` e a tela mostrou `Uso BYOK sem pedido premium`, portanto a falha era critério live
    preso ao texto antigo `Premium Request`.
  - Achado visual real: depois de `você[...] [PERG]› SIM`, o plain log mostrou linhas soltas
    `LLM-B pensando` antes/depois de `Uso do modelo`, indicando que o prompt de input estava sendo
    usado como superfície de status.
- [x] Decisão UX: em TTY com linha viva ativa, busy/thinking/finalizing pertence à região reservada
      acima do prompt. O prompt de input deve continuar humano (`você[...]›` ou `[PERG]›`) e nunca
      virar uma linha independente `LLM-B pensando`. O fallback de prompt de espera permanece válido
      apenas quando a linha viva está desligada ou indisponível.
- [x] Correção aplicada: `dialog/output.js` ganhou a regra central
      `shouldKeepHumanPromptWithInlineStatus()`. `reserveInlineStatusRows()` agora repinta prompt
      humano ao reservar área de status, e `scheduleTerminalPromptRedraw()` só usa
      `buildWaitingPrompt()` durante busy quando não há linha viva TTY ativa.
- [x] Correção aplicada: `parkTerminalPromptForContinuation()` continua existindo para fallback sem
      linha viva, mas não converte mais o prompt em `LLM-B pensando` quando a linha viva reservada
      consegue mostrar o estado acima do input.
- [x] Contrato live atualizado: `llm-usage-visible` aceita a cópia humanizada
      `Uso BYOK sem pedido premium`/`Telemetria LLM sem pedido premium`; novo critério
      `ux-live-status-not-input-prompt` bloqueia linhas standalone `LLM-B pensando`.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` agora cobre os dois modos:
      linha viva ativa preserva prompt humano; linha viva desligada preserva prompt de espera
      estacionado como fallback.
- [x] Validação escopada:
  - `node --check src/copilot/terminal/dialog/output.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
  - `node scripts/model-gateway/run.mjs llmBLiveTest --dry-run --live-scenario=canonical --out-dir=artifacts/terminal-live-dry/canonical-inline-human-prompt-20260604`.
  - `npx eslint src/copilot/terminal/dialog/output.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
- [x] Live canônica pós-linha-viva-humana:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-terminal-ux-inline-human-prompt-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-01-30-974Z/summary.md`.
  - Resultado geral: `Status: FAIL` apenas em `no-prompt-double-render`.
  - Sinais positivos: `llm-usage-visible`, `ux-live-status-not-input-prompt`,
    `ask-user-input-prompt-visible`, export/SSE, `no-terminal-errors` e `clean-quit` passaram.
  - Achado residual: após `Resposta enviada para pergunta pendente.`, o ACK durável repintava prompt
    humano e, logo depois, a linha viva da continuação reservava status e repintava outro prompt
    humano. O problema deixou de ser `LLM-B pensando` no input e virou competição entre dois
    produtores legítimos de prompt.
- [x] Correção aplicada: `println()`/`printlnBlock()` ganharam opção `{ redrawPrompt: false }`.
      O ACK positivo de resposta humana usa essa opção, preservando a linha durável, mas deixando a
      continuação da LLM-B repintar a superfície uma única vez pela linha viva.
- [x] Teste unitário: `test_dialog_output_inline_status.spec.js` cobre bloco durável sem redraw de
      prompt para handoff pós-resposta humana.
- [x] Validação escopada:
  - `node --check src/copilot/terminal/dialog/output.js src/copilot/terminal/repl/repl-lifecycle.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
  - `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/repl/repl-lifecycle.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Tentativa bloqueada adicional:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-terminal-ux-no-prompt-double-after-answer-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-05-13-054Z/summary.md`.
  - Resultado geral: `Status: BLOCKED` por `assistant-ended-before-ask`; o modelo materializou
    deltas e voltou a idle sem chamar `ask_user`. Mesmo sem exercitar o pós-`SIM`, confirmou
    `no-prompt-double-render` e `ux-live-status-not-input-prompt`.
- [x] Tentativa bloqueada com silêncio prolongado:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-terminal-ux-no-prompt-double-after-answer-retry-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-06-25-402Z/summary.md`.
  - Resultado geral: `Status: BLOCKED` por `assistant-ended-before-ask`, mas o runner ficou
    silencioso até o timeout e não coletou export/diagnósticos completos.
  - Achado de harness/UX: o diagnóstico de “deltas concluídos, ask obrigatório ausente” dependia
    de detectar prompt final por regex; em alguns PTYs a linha de prompt não fica no formato exato
    do regex, então o scheduler nunca arma.
- [x] Correção aplicada no runner: `scheduleMissingRequiredAskDiagnostics()` passa a ser acionado
      pelo próprio fim semântico do turno (`DELTA-CANONICAL-8` + retorno/assistant.message), sem
      exigir `hasReturnedToReplPrompt()`. O pacote de diagnóstico ganhou `/tools diag` e
      `/health full`, além de `/activity`, `/events`, `/errors` e `/export`.
- [x] Validação escopada:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Tentativa de cenário `invalid-choice` para exercitar handoff pós-resposta:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=invalid-choice --label live-terminal-ux-invalid-choice-no-prompt-double-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-12-41-882Z/summary.md`.
  - Resultado geral: interrompido após detectar bug do harness; quando a primeira resposta
    intermediária era aceita pelo SDK como freeform e o modelo reabria a pergunta, o runner não
    enviava o segundo passo porque esperava apenas texto local de `invalid_choice`.
- [x] Correção aplicada no runner: cenários multi-step agora guardam o offset de cada resposta
      enviada. Se a mesma pergunta reaparece depois de uma resposta intermediária e o prompt
      `[PERG]›` está visível, o runner envia o próximo passo. O critério
      `ask-user-invalid-choice-feedback` também aceita reabertura da pergunta depois da resposta
      inválida como evidência de recuperação quando a rejeição local não ocorre.
- [x] Validação escopada:
  - `node --check src/copilot/terminal/dialog/output.js src/copilot/terminal/repl/repl-lifecycle.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js`.
  - `npx eslint src/copilot/terminal/dialog/output.js src/copilot/terminal/repl/repl-lifecycle.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Tentativa `invalid-choice` pós-runner multi-step:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=invalid-choice --label live-terminal-ux-invalid-choice-no-prompt-double-retry-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-16-42-720Z/summary.md`.
  - Resultado geral: `Status: BLOCKED` por `assistant-empty-turn`; o provider BYOK cancelou o
    turno antes de materializar `ask_user`/final. O bloqueio impediu validação do handoff
    pós-resposta, mas o terminal exibiu erro BYOK compacto, sem janela de permissão e sem spam de
    espera.
- [ ] Próxima live obrigatória: repetir cenário canônico com PTY para confirmar que
      `ux-live-status-not-input-prompt`, `llm-usage-visible`, `no-prompt-double-render`,
      `ask-user-input-prompt-visible`, export/SSE e `clean-quit` passam juntos.

### 12.50 Eventos runtime não podem escapar da camada humana

- [x] Auditoria live: `artifacts/terminal-live/2026-06-04T07-16-42-720Z/summary.md` bloqueou por
      `assistant-empty-turn`, mas revelou linhas humanas ainda com cheiro de adaptador cru:
      `Provedor BYOK  Erro do SDK sem mensagem estruturada.`, `Evento cancellation · Operation
      cancelled by user`, `Turno terminou sem saída pública...` com ANSI manual e símbolo de erro
      fora do tema, além de `Fallback` com texto de contrato ainda longo.
- [x] Decisão UX: `/events raw`, SSE e export técnico podem preservar payloads originais; a tela
      padrão do operador não pode imprimir inglês de SDK, labels genéricos como `Evento`, nem ANSI
      manual. Todo evento visível deve passar por label humano, detalhe compacto e `terminalThemeRow`.
- [x] Correção: `dialog/engine.js` trocou a mensagem crua de turno vazio por rows temáticas
      `Turno`/`Diagnóstico`, sem símbolo manual, mantendo SSE e `/activity` como drill-down.
- [x] Correção: `sdk-session-events.js` renderiza `infoType=cancellation` como
      `Cancelamento · operação cancelada pelo operador`, e avisos como `Aviso da sessão`, sem
      `Warning SDK`.
- [x] Correção: `agent-runtime-events.js` humaniza o bloco BYOK recuperável na origem:
      label curto, `provedor` em português, ação clara, e fallback como consequência operacional,
      sem repetir `Erro do SDK sem mensagem estruturada` como primeira coisa que o operador vê.
- [x] Testes: casos unitários escopados cobrem cancelamento/session warning/BYOK
      recuperável/turno vazio humano, bloqueando `Operation cancelled by user`, `Warning SDK`,
      ANSI manual e `provider BYOK` no stdout humano.
- [x] Validação escopada:
  - `node --check src/copilot/terminal/dialog/engine.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/events/agent-runtime-events.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`.
  - `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`.
  - `npx eslint src/copilot/terminal/dialog/engine.js src/copilot/terminal/events/sdk-session-events.js src/copilot/terminal/events/agent-runtime-events.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/terminal/test_dialog_runtime.spec.js`.
- [x] Live canônica pós-humanização de eventos runtime:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-terminal-ux-runtime-human-events-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-27-34-180Z/summary.md`.
  - Resultado geral: `Status: PASS`. Passaram `ux-no-raw-sdk-info-labels`,
    `ux-live-status-not-input-prompt`, `no-prompt-double-render`,
    `ask-user-input-prompt-visible`, `llm-usage-visible`, export/SSE e `clean-quit`.
  - Confirmação visual: `Configuração ferramentas nativas desativadas`, pergunta `[PERG]`,
    `Uso BYOK sem pedido premium`, `/events` humano e `/errors` limpo apareceram corretamente.
- [x] Achado visual extra da live: a linha viva de ferramenta ainda podia quebrar em várias linhas
      físicas no PTY estreito porque o fallback genérico anexava detalhe, modelo, raciocínio e
      estado da conversa: `LLM-B ferramenta · ... Ler` seguido por `arquivo ... modelo ...`.
- [x] Correção aplicada: `live-status-line.js` ganhou caminho compacto específico para
      `phase=tool`, renderizando apenas `LLM-B ferramenta · <nome humano> · <duração>`, com
      detalhes completos preservados nas linhas duráveis e em `/activity`.
- [x] Contrato live reforçado: o runner ganhou `ux-tool-live-status-stays-single-line`, bloqueando
      quebra física da linha viva de ferramenta e caudas `modelo`/`raciocínio`/`conversa ativa`.
- [x] Live canônica pós-compactação de ferramenta:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --scenario canonical --label live-terminal-ux-tool-status-single-line-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-31-04-217Z/summary.md`.
  - Resultado geral: `Status: PASS`.
  - Confirmação: `ux-tool-live-status-stays-single-line`, `ux-compact-tool-live-status`,
    `ux-live-status-not-input-prompt`, `no-prompt-double-render`, `ask-user-input-prompt-visible`,
    `llm-usage-visible`, export/SSE e `clean-quit` passaram.
- [x] Live `invalid-choice` pós-humanização e pós-linha-viva compacta:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=invalid-choice --label live-terminal-ux-invalid-choice-feedback-spacing-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-46-09-370Z/summary.md`.
  - Resultado geral: `Status: PASS`.
  - Confirmação: `TALVEZ` foi rejeitado localmente, o prompt `[PERG]` permaneceu pronto,
    `SIM` foi aceito, a resposta pós-pergunta saiu por `assistant.message`, `/activity`,
    `/events`, `/errors`, `/health`, export/SSE e `clean-quit` passaram.
- [x] Correção de harness descoberta antes do PASS:
  - quando a LLM-B concluía os deltas mas não chamava `ask_user`, o timeout encerrava com `/quit`
    antes de coletar `/activity`, `/events`, `/errors`, `/health` e `/export`;
  - o runner agora detecta `assistant-ended-before-ask` também com apoio dos eventos SSE vivos e,
    no timeout, executa diagnósticos/export antes de encerrar ou matar o processo.
- [x] Correção de harness para choice inválido:
  - o feedback real usa layout tabular (`Resposta      não corresponde...`), então o detector de
    `invalid-choice` passou a aceitar espaçamento visual da UI, não apenas logs com espaço único.
- [x] Achado UX: a humanização de detalhes em `/activity` estava traduzindo `ask_user` dentro de
      texto livre da intenção (`terminal live canonical deltas tools Pergunta ao operador usage`).
- [x] Decisão UX: nomes de protocolo em conteúdo livre (`ask_user`, `request_user_input`) devem ser
      preservados; a tradução para `Pergunta ao operador` pertence a labels, headings e eventos
      semânticos, não ao payload textual do operador/modelo.
- [x] Correção aplicada: `activity.js` preserva nomes de protocolo em detalhes livres, mantendo
      humanização de labels e de ferramentas reais.
- [x] Validação focada:
  - `node --check src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx eslint src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [ ] Próxima frente UX: repetir um cenário de falha BYOK/tool recuperável para validar a mesma
      limpeza em caminhos não felizes, especialmente cancelamento, retry e falhas de provedor.

### 12.51 Falhas recuperáveis não podem parecer sucesso

- [x] Live `recoverable-tool-error` pós-humanização:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=recoverable-tool-error --label live-terminal-ux-recoverable-tool-exitcode-failure-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T07-55-04-622Z/summary.md`.
  - Resultado geral: `Status: BLOCKED` por `assistant-empty-after-user-input`; a LLM-B chamou
    `ask_user`, o operador respondeu `SIM`, mas a continuação retornou sem saída pública.
  - Sinais positivos: `exec_command` real retornou `success:false`, `exitCode=7`,
    `RECOVERABLE-TOOL-ERROR`; o runner coletou `/activity`, `/events`, `/tools diag`,
    `/health full`, `/errors` e export mesmo em bloqueio; perguntas, respostas, SSE e export
    permaneceram correlacionados.
  - Achado UX crítico: o terminal imprimia `Concluído ... Executar comando` a partir de
    `external_completed success=true` e logo depois `Falhou ... Executar comando` a partir do
    `postToolUse` estruturado. A timeline ficava contraditória, e `/tools`/`/health` ainda diziam
    `sem falhas` porque a telemetria agregada tratava handler retornado como sucesso mesmo quando
    o payload era `{ success:false }`.
- [x] Decisão arquitetural: para operações de terminal (`operation=run`), `external_completed`
      sem resultado estruturado é sinal provisório, não conclusão visual. A verdade operacional
      vem do `postToolUse` ou do reconciliador de fim de turno.
- [x] Correção aplicada: `handleTerminalExternalToolCompleted()` deixa de imprimir, arquivar em
      `/activity`, fechar registry ou emitir `external_completed` visual para execução local
      provisória. A entrada fica ativa para o `postToolUse` correlacionar corretamente.
- [x] Correção aplicada: `reconcileTerminalPostToolUseResult()` fecha a tool ativa como falha,
      preserva `toolCallId`, imprime uma única linha `Falhou Executar comando ... saída 7` e emite
      `tool.lifecycle complete success=false`.
- [x] Correção aplicada: `printToolComplete()` removeu a duplicação textual `Falhou falhou` /
      `Concluído ok`; o label da coluna já comunica o estado, e o detalhe foca nome humano e ação.
- [x] Correção de base: `observability/tool-stats.js` passou a interpretar retorno estruturado de
      handler (`success:false`, `ok:false`, `resultType=error`, `exitCode!=0`) como falha real,
      mesmo sem exceção. Isso corrige `/tools`, `/health` e métricas agregadas na fonte.
- [x] Contrato live atualizado: `scenario-render-*` aceita o novo render humano
      `Ferramenta`/`Concluído`/`Falhou` com nome legível, além do badge legado; `health-full`
      aceita a cópia humana `Permissões automáticas · prompts SDK ignorados`.
- [x] Testes unitários:
  - `test_tool_lifecycle_runtime.spec.js` cobre reconciliação tardia de `exitCode=7` e bloqueia
    sucesso provisório visual em `external_completed` de `exec_command`.
  - `test_sdk_tool_stats_f32.spec.js` cobre falhas estruturadas retornadas por handlers.
- [x] Validação focada:
  - `node --check src/copilot/observability/tool-stats.js src/copilot/terminal/events/tool-lifecycle-runtime.js tests/unit/copilot/sdk/test_sdk_tool_stats_f32.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/sdk/test_sdk_tool_stats_f32.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx eslint src/copilot/observability/tool-stats.js src/copilot/terminal/events/tool-lifecycle-runtime.js src/copilot/terminal/events/sdk-session-events.js tests/unit/copilot/sdk/test_sdk_tool_stats_f32.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [ ] Próxima live obrigatória: repetir `recoverable-tool-error` para confirmar que a tela real não
      mostra sucesso provisório, que `/tools diag` e `/health full` contam a falha agregada, e para
      separar o problema remanescente de `assistant-empty-after-user-input` de qualquer falha de UX.
- [x] Tentativa live pós-correção de sucesso provisório:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=recoverable-tool-error --label live-terminal-ux-recoverable-tool-no-provisional-success-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-03-39-347Z/summary.md`.
  - Resultado: `Status: BLOCKED` por `assistant-empty-turn`; a LLM-B chamou apenas
    `report_intent`, encerrou o turno sem saída pública e não chegou a `read_file_content`,
    `exec_command`, deltas ou `ask_user`.
  - Diagnóstico: a tentativa não exercitou a correção de `exec_command`; o bloqueio é aderência do
    modelo/turno, não regressão da UX de lifecycle.
- [x] Bug de harness descoberto nessa live: a cópia nova da tela é `Turno sem saída pública`, mas
      o detector de diagnóstico automático ainda esperava apenas `Turno terminou sem saída
      pública`. Por isso o runner aguardou timeout e terminou com `conversation-export.md` n/a.
- [x] Correção aplicada no runner: detectores de turno vazio agora aceitam
      `Turno sem saída pública` e `Turno terminou sem saída pública`; o pacote automático desse
      bloqueio coleta `/activity 40`, `/tools diag`, `/health full`, `/events`, `/errors` e
      `/export`.
- [x] Validação focada:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [ ] Próxima tentativa: executar `recoverable-tool-error` com rota/modelo mais aderente ou criar
      ciclo diagnóstico controlado de lifecycle para provar a superfície visual enquanto o live
      real continua sujeito à aderência do provider.
- [x] Prompt do cenário `recoverable-tool-error` foi reescrito para ordem sequencial explícita:
      não encerrar após `report_intent`, chamar `read_file_content`, depois `exec_command`, continuar
      mesmo com `success=false/exitCode=7`, ler o arquivo novamente, só então emitir deltas e
      perguntar ao operador.
- [x] Live `recoverable-tool-error` com prompt sequencial:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=recoverable-tool-error --label live-terminal-ux-recoverable-tool-sequential-prompt-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-11-04-159Z/summary.md`.
  - Resultado formal: `Status: FAIL` apenas por critérios do harness ainda presos ao formato antigo
    `Concluído ok Ler arquivo`.
  - Resultado material de UX: caminho real validado de ponta a ponta. A LLM-B chamou
    `report_intent`, `read_file_content`, `exec_command` com `exitCode=7`, `read_file_content`
    novamente, emitiu os 8 deltas, chamou `ask_user`, recebeu `SIM` e materializou
    `POST-ASK-RECOVERABLE-FINAL`.
  - Confirmação visual: a tela exibiu somente `Falhou Executar comando · executando comando falhou
    (81ms · saída 7)`; não houve `Concluído Executar comando`, não houve `Falhou falhou`, e o
    prompt humano permaneceu limpo.
  - Confirmação diagnóstica: `/tools diag` mostrou `Executar comando uso 1 · sem bloqueios · 1
    falha(s)`, lifecycle com `falhas recentes 1`, e `/health full` mostrou `Executar comando 0%
    média 105ms (1 uso)`.
  - Export/SSE: export gerado com 4091 chars, ask/answer/postAsk correlacionados, `no-terminal-errors`
    e `clean-quit` passaram.
- [x] Critérios live corrigidos após a live: `renderedReadFileToolOk()` e `ux-human-tool-names`
      aceitam a nova linha `Concluído Ler arquivo ...` sem exigir o marcador textual `ok` removido
      da UX.
- [x] Validação focada:
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [ ] Próxima live curta: repetir `recoverable-tool-error` uma vez com o harness corrigido para
      obter `Status: PASS` formal e congelar esse cenário como regressão canônica.

### 12.52 Continuação controlada quando a LLM-B esquece `ask_user`

- [x] Live `recoverable-tool-error` após correção dos critérios:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=recoverable-tool-error --label live-terminal-ux-recoverable-tool-pass-after-criteria-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-13-38-809Z/summary.md`.
  - Resultado formal: `Status: FAIL` apenas por falso negativo em
    `ux-tool-live-status-stays-single-line`.
  - Diagnóstico: a linha viva real era `LLM-B ferramenta · Ler arquivo · 0s`; o harness tratava
    `\r` de repintura TTY como quebra visual real e confundia a próxima linha durável com wrap.
- [x] Correção aplicada: o critério `ux-tool-live-status-stays-single-line` agora considera quebra
      visual por `\n`, preservando `\r` como repintura de TTY/ANSI. O teste continua bloqueando
      cauda de modelo/runtime (`modelo`, `raciocínio`, `conversa ativa`) na linha viva.
- [x] Live `recoverable-tool-error` com critério corrigido:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=recoverable-tool-error --label live-terminal-ux-recoverable-tool-formal-pass-20260604 --timeout-ms 240000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-17-12-174Z/summary.md`.
  - Resultado: `Status: BLOCKED` por `assistant-ended-before-ask`. A LLM-B executou
    `report_intent`, `read_file_content`, `exec_command` com `exitCode=7`, novo
    `read_file_content`, emitiu os deltas, mas encerrou sem chamar `ask_user`.
  - Sinal positivo de UX: a falha de `exec_command` permaneceu uma única linha humana
    `Falhou Executar comando ... saída 7`; `/tools diag` e `/health full` registraram
    `1 falha(s)` e `0%`.
  - Gap de diagnóstico: `/activity 40` escolheu a leitura posterior como “Último turno concluído”
    e escondia o `exec_command` falho como contexto principal, embora a timeline ainda mostrasse a
    falha.
- [x] Decisão de harness: “deltas canônicos produzidos, mas `ask_user` obrigatório ausente” deve
      primeiro gerar continuação controlada curta, não timeout ou pós-mortem imediato. Se a
      continuação também encerrar sem `ask_user`, o runner coleta diagnóstico e bloqueia.
- [x] Correção aplicada: o runner cria um turno de recuperação com instrução exclusiva para chamar
      a tool real `ask_user`, sem repetir tools/deltas. A segunda avaliação olha apenas o trecho
      posterior à continuação, evitando diagnosticar cedo demais olhando para o primeiro turno.
- [x] Correção aplicada em `/activity`: `readTerminalActivityProjection()` amplia a janela de
      turn traces conforme o limite do operador (`8..24`), e a escolha de “último turno útil”
      prioriza falhas operacionais recentes antes de reads triviais posteriores.
- [x] Teste unitário adicionado: `/activity 40` passa a priorizar `Executar comando · falhou` em
      vez de uma leitura posterior bem-sucedida quando ambos estão nos traces recentes.
- [x] Validação focada:
  - `node --check src/copilot/terminal/frontend/projections/now.js src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx eslint src/copilot/terminal/frontend/projections/now.js src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live `recoverable-tool-error` após recuperação controlada:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=recoverable-tool-error --label live-terminal-ux-recoverable-tool-controlled-recovery-20260604 --timeout-ms 260000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-23-23-791Z/summary.md`.
  - Resultado: `Status: BLOCKED`. A LLM-B executou `report_intent`, `read_file_content`,
    `exec_command` falho e novo `read_file_content`, mas chamou `ask_user` antes dos deltas
    públicos obrigatórios; depois do `SIM`, a continuação pós-pergunta ficou vazia.
  - Confirmação UX: a falha real de comando permaneceu coerente em tela, `/tools diag` e
    `/health full`; o problema remanescente é aderência/ordem do modelo ao contrato do cenário.
  - Achado de diagnóstico: o blocker final `assistant-empty-after-user-input` escondia a causa
    anterior mais útil para o operador, que era `ask_user` cedo demais.
- [x] Correção aplicada no runner: se `user_input.requested` aparece antes de um
      `assistant.message`/delta com os 8 `DELTA-CANONICAL`, o runner não responde `SIM`; ele
      coleta `/activity 40`, `/tools diag`, `/events`, `/errors`, `/health full` e export, e
      classifica a causa como `assistant-asked-before-required-deltas`.
- [x] Correção refinada em `/activity`: falhas vazias sem ferramentas, arquivos ou operador não
      devem ocultar uma falha operacional recente com ferramenta real; o teste unitário cobre esse
      caso com um turno vazio falho antes de um read e de um `exec_command` falho.
- [x] Validação focada adicional:
  - `node --check src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js`.
  - `npx eslint src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [ ] Próxima live obrigatória: repetir `recoverable-tool-error`; aceitar `Status: PASS` direto
      ou `Status: PASS` via continuação controlada, desde que ask/answer/postAsk, SSE/export,
      `/activity`, `/tools diag` e `/health full` permaneçam coerentes.

### 12.53 Turno vazio e eventos precisam orientar, não repetir

- [x] Achado UX no live bloqueado:
  - a tela imprimia uma linha específica de pós-pergunta vazia e, em seguida, uma linha genérica
    muito parecida (`Turno sem saída pública...`), aumentando ruído no momento em que o operador
    precisa de ação clara.
  - `/events` resumia `terminal.turn.empty_output`, mas não mostrava `deltaSlices/deltaChars`,
    porque o renderer procurava `deltaCount`.
- [x] Decisão UX: duas camadas podem continuar emitindo sinais distintos, mas a cópia deve ser
      complementar. A linha específica explica “continuação pós-pergunta”; a linha genérica deve
      ser curta, operacional e acionável.
- [x] Correção aplicada: `recordTerminalExplicitEmptyOutput()` agora imprime:
  - `Turno vazio · sem resposta pública materializada; nenhuma pergunta humana pendente`;
  - `Próximo passo · /activity 40 · /events 60 · /byok health · reenvie ou troque modelo`.
- [x] Correção aplicada: `/events` passa a resumir `deltaSlices/deltaChars` como
      `deltas 0/0 caracteres`, preservando evidência útil para diagnosticar turno vazio.
- [x] Correção de contrato textual: teste de engine atualizado para `Falha de provedor BYOK no
      turno`, alinhado ao vocabulário em português já usado pela UX.
- [x] Validação focada:
  - `node --check src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js src/copilot/terminal/dialog/engine.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npx vitest run tests/unit/copilot/test_terminal_dialog_engine.spec.js --hookTimeout=30000`.
  - `npx eslint src/copilot/terminal/dialog/engine.js src/copilot/terminal/commands/events.js tests/unit/copilot/test_terminal_dialog_engine.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Correção aplicada: `dialog.empty_after_user_input` recebeu resumo próprio em `/events`,
      incluindo `continuação pós-pergunta terminou sem texto público`, resposta humana quando
      disponível e ação sugerida (`/activity 40 · /events 60 · reenviar ou trocar modelo`).
- [x] Decisão UX: `requestId` continua oculto no `/events` padrão; aparece apenas nos modos com
      IDs diagnósticos, preservando legibilidade para o operador humano.
- [x] Teste unitário adicionado: `/events` renderiza `Continuação vazia` com resposta e ação, sem
      expor `requestId` bruto por padrão.
- [x] Validação focada:
  - `node --check src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npx eslint src/copilot/terminal/commands/events.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [ ] Próxima inspeção UX: revisar prompt longo enviado pelo harness/live, porque no PTY ele pode
      aparecer sem o prefixo visual completo em logs plain quando `script` e repaint ANSI se
      cruzam; separar artefato de captura de bug real no renderer.

### 12.54 Timestamps completos por contrato central

- [x] Achado UX: embora várias telas já usassem ISO 8601 local com offset, o formatador central
      `formatTerminalTimeParts()` forçava precisão até segundos. Isso contrariava a decisão de
      auditabilidade com ISO completo nas superfícies de eventos, activity, pergunta e turn display.
- [x] Decisão UX: o default humano do terminal passa a ser `dual` com ISO 8601 completo
      (`YYYY-MM-DDTHH:mm:ss.SSS±HH:mm`) mais idade relativa. Superfícies compactas podem pedir
      explicitamente `isoPrecision: 'seconds'`.
- [x] Correção aplicada: `formatTerminalTimeParts()` usa `milliseconds` como precisão padrão.
- [x] Testes atualizados:
  - `test_time_format.spec.js` cobre dual/iso completo e a opção explícita por segundos.
  - `test_commands_events.spec.js` simula `/events` com ISO completo no modo padrão.
- [x] Validação focada:
  - `node --check src/copilot/terminal/state/time-format.js tests/unit/copilot/terminal/test_time_format.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npx vitest run tests/unit/copilot/terminal/test_time_format.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
  - `npx eslint src/copilot/terminal/state/time-format.js tests/unit/copilot/terminal/test_time_format.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Live PTY executado para inspeção visual do contrato de timestamp completo:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-complete-iso-cycle-20260604 --timeout-ms 90000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-39-49-862Z/summary.md`.
  - Resultado observado: `/activity` e `/events` exibiram `2026-06-04T05:39:56.404-03:00 (há 1s)`
    e `2026-06-04T05:39:54.289-03:00 (há 3s)`, confirmando ISO 8601 completo local
    com milissegundos e idade relativa nas linhas persistentes.
- [x] Achado no harness: o critério `ux-cycle-activity-human` ainda procurava a cópia antiga
      `Detalhes técnicos ficam em /activity detail` e bloqueava a palavra `trace` mesmo quando ela
      aparecia somente na instrução humana `Drill-down /activity detail mostra origem, trace,
      engine e streaming`.
- [x] Correção aplicada no runner live:
  - `ux-cycle-activity-human` agora exige o texto de drill-down vigente e continua bloqueando
    identificadores crus como `traceId`, `source`, `tools`, `deltas` e eventos de limpeza SDK.
  - O ciclo `--ux-cycle` agora aguarda marcadores de superfície por comando (`Ajuda rápida`,
    `Terminal LLM-B - Ajuda completa`, `Status do Terminal LLM-B`, `Eventos SSE`, etc.),
    reduzindo falsos positivos/falsos negativos por repaint de prompt ou telas longas.
  - Novo critério `ux-cycle-command-order` falha se as superfícies default aparecerem fora da
    ordem dos comandos do operador.
- [x] Live PTY repetido após ajuste do harness:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-command-order-guard-20260604 --timeout-ms 120000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-44-53-143Z/summary.md`.
  - Resultado: PASS em 18/18 critérios, incluindo `ux-cycle-command-order`,
    `ux-cycle-activity-human` e `ux-cycle-events-complete-iso`.
- [x] Lacuna UX/BYOK promovida para seção 12.55: a live mostrou `/status` exibindo
      `claude-haiku-4.5` como modelo enquanto prompt, `/health` e `/now` continuavam em
      `kilo-auto/free`.

### 12.55 Contrato único de label de modelo/BYOK no terminal

- [x] Achado live:
  - prompt e boot mostravam `kilo-auto/free`;
  - `/health` e `/sdk` mostravam `kilo-auto/free`;
  - `/status` e `/now` priorizavam `effectiveModel`/`billedModel` do último PR e exibiam
    `claude-haiku-4.5`;
  - após uma primeira correção, `/status`/`/now` passaram a mostrar `auto`, que ainda era
    insuficiente porque `auto` é seletor, não rota operacional final.
- [x] Decisão UX:
  - painéis default devem mostrar a rota/modelo vivo que o operador realmente está usando;
  - `auto` deve ser tratado como seletor e substituído pelo fallback vivo quando ele existe;
  - telemetria histórica de PR/cobrança deve continuar disponível como `observado`/`cobrado`,
    especialmente em `/status full`, `/metrics` e `/usage`, mas não pode substituir a rota viva
    nos painéis default.
- [x] Correção aplicada:
  - `normalizeTerminalModelBillingProjection()` ganhou `observedModel` e agora calcula
    `displayModel` como `configuredModel` apenas quando ele não é `auto`; se `configuredModel`
    for `auto`, prefere o fallback vivo.
  - `status.js`, `metrics.js` e `usage.js` passaram a passar `base.model` antes de
    `base.snap.model`, alinhando projeções com o prompt vivo.
  - `/status` e `/now` usam helper único para renderizar `rota` ou `configurado → observado`
    quando existe divergência real.
  - `/status full`, `/metrics` e `/usage` preservam `observado`/`cobrado` como telemetria
    histórica explícita.
- [x] Testes focados:
  - `test_terminal_runtime_frontend.spec.js` cobre `configuredModel=auto` sem mismatch e o caso
    `fallback=kilo-auto/free`, garantindo que `displayModel` vira `kilo-auto/free` em vez de
    `auto` ou `claude-haiku-4.5`.
- [x] Validação focada:
  - `node --check src/copilot/terminal/frontend/projections/shared.js src/copilot/terminal/frontend/projections/status.js src/copilot/terminal/frontend/projections/metrics.js src/copilot/terminal/frontend/projections/usage.js src/copilot/terminal/commands/session.js src/copilot/terminal/commands/metrics.js src/copilot/terminal/commands/usage.js tests/unit/copilot/test_terminal_runtime_frontend.spec.js`.
  - `npx vitest run tests/unit/copilot/test_terminal_runtime_frontend.spec.js --hookTimeout=30000`.
  - `npx eslint src/copilot/terminal/frontend/projections/shared.js src/copilot/terminal/frontend/projections/status.js src/copilot/terminal/frontend/projections/metrics.js src/copilot/terminal/frontend/projections/usage.js src/copilot/terminal/commands/session.js src/copilot/terminal/commands/metrics.js src/copilot/terminal/commands/usage.js tests/unit/copilot/test_terminal_runtime_frontend.spec.js`.
- [x] Harness live reforçado:
  - novo critério `ux-cycle-model-labels-consistent` exige que `/status`, `/now`, `/health` e
    `/sdk` concordem no modelo/rota vivo e não retornem a `auto` ou `claude-haiku-4.5` como
    label default stale.
- [x] Live PTY de confirmação:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-model-label-contract-20260604 --timeout-ms 120000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-52-31-421Z/summary.md`.
  - Resultado: PASS em 19/19 critérios; `/status`, `/now`, `/health`, `/sdk` e prompt convergiram
    para `kilo-auto/free`.

### 12.56 SDK capabilities e workspace sem JSON bruto no default

- [x] Achado live:
  - `/sdk capabilities` mostrava painel humano, mas terminava com `Retorno { "ui": ... }`,
    poluindo a superfície default com contrato bruto;
  - `/workspace list`, quando o workspace SDK virtual estava vazio, mostrava `Retorno { "files": [] }`,
    em vez de explicar o estado vazio para o operador.
- [x] Decisão UX:
  - superfícies default devem ser legíveis e operacionais;
  - contratos JSON continuam disponíveis por opção explícita (`detail`, `--raw`, `--json`), nunca como
    fallback visual default em telas canônicas;
  - workspace SDK virtual deve lembrar sua fronteira com o FS local quando estiver vazio.
- [x] Correção aplicada:
  - `/sdk capabilities` default remove `Retorno` bruto e mostra `Detalhe /sdk capabilities detail · /sdk doctor · /sdk waits`;
  - `/sdk capabilities detail` preserva o JSON bruto para auditoria;
  - `/workspace list` default mostra `Estado nenhum arquivo no workspace SDK virtual` e `Escopo SDK virtual separado do FS local`;
  - `/workspace list --raw` preserva o retorno bruto.
- [x] Testes focados:
  - `test_commands_sdk.spec.js` cobre `/sdk capabilities` default sem `Retorno`/`"ui"` e detail com `Retorno`;
  - `test_commands_sdk.spec.js` cobre `/workspace list` com arquivos, vazio sem `Retorno` e vazio com `--raw`.
- [x] Validação focada:
  - `node --check src/copilot/terminal/commands/sdk.js tests/unit/copilot/terminal/test_commands_sdk.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
  - `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js --hookTimeout=30000`.
  - `npx eslint src/copilot/terminal/commands/sdk.js tests/unit/copilot/terminal/test_commands_sdk.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Harness live reforçado:
  - `ux-cycle-sdk-capabilities-human` falha se `/sdk capabilities` default voltar a mostrar
    `Retorno`, `{ "ui": ... }`, `[OK]`, `[ERR]` ou heading legado;
  - `ux-cycle-workspace-human` falha se `/workspace list` default voltar a mostrar `Retorno`
    ou `{ "files": ... }`.
- [x] Live PTY de confirmação:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-sdk-workspace-no-raw-json-pass-20260604 --timeout-ms 120000`.
  - Artefato: `artifacts/terminal-live/2026-06-04T08-57-38-850Z/summary.md`.
  - Resultado: PASS em 19/19 critérios; os dois painéis default ficaram sem JSON bruto.

### 12.57 Guia de decisão das libs auxiliares e próxima UX de inspeção

- [x] Retomada após commits/push anteriores:
  - worktree revisado; apenas `.codex/config.toml` permanece modificado fora do escopo desta tarefa;
  - `src/copilot/terminal/capabilities` já contém registry, previews, structured preview, picker plan e picker runner;
  - `/terminal libs`, `/libs`, `/fs preview`, `/git diff`, `/gh pr diff` e `/menu picker` já exercem a arquitetura opcional.
- [x] Investigação oficial refeita em 2026-06-04 antes de novas integrações:
  - `gum`: docs oficiais confirmam comandos interativos (`choose`, `confirm`, `file`, `filter`, `input`, `write`, `pager`) e comandos de formatação; decisão segue `accepted_guarded`;
  - `fzf`: docs/manpage confirmam seleção por stdout e preview por comando shell; decisão segue aceitar seleção e bloquear `fzf --preview` até adapter tokenizado;
  - `bat`: docs oficiais confirmam `--paging=never`, `batcat` como realidade de distro e uso típico de preview; decisão segue preview read-only;
  - `glow`: docs oficiais confirmam CLI/stdin, largura e pager; decisão segue Markdown explícito sem pager automático;
  - `delta`: docs oficiais confirmam diff por stdin/pager Git; decisão segue diff explícito sem substituir diff bruto canônico;
  - `jq`/`yq`: docs oficiais confirmam filtros por stdin e risco de quoting/ops avançadas; decisão segue diagnóstico/preview, não fonte canônica;
  - `atuin`: docs oficiais atuais incluem hooks para agentes e AI própria; decisão segue adiar integração ativa para evitar paralelismo de histórico/permissões;
  - `zoxide`: docs oficiais confirmam shell hooks, ranking pessoal e `zi` com `fzf`; decisão segue adiar para preservar cwd/escopo canônico.
- [x] Novo guia criado:
  - `src/copilot/docs/terminal/TERMINAL_AUXILIARY_LIBS_DECISION_GUIDE_2026-06-04.md`.
- [x] Decisão consolidada:
  - nenhuma lib vira dependência obrigatória;
  - nenhuma lib é instalada ou chamada automaticamente;
  - TUI externa exige ação explícita, TTY exclusivo, ausência de pergunta humana pendente, ausência de input digitado e restauração limpa de prompt;
  - `atuin` e `zoxide` seguem detectáveis, mas adiados;
  - `fzf --preview` segue bloqueado até existir preview tokenizado sem shell livre.
- [x] Transformação aplicada: `/terminal libs detail` passou a renderizar `Política` e `Exemplo n`
      a partir do registry central de capabilities, sem criar segunda fonte no comando.
- [x] Transformação aplicada: `/help full` ganhou seção `Previews e libs auxiliares` com comandos
      canônicos para `bat`/`batcat`, `glow`, `delta`, `jq`, `yq`, picker e a decisão adiada de
      `atuin/zoxide`.
- [x] Validação focada inicial:
  - `node --check src/copilot/terminal/capabilities/external-tools.js && node --check src/copilot/terminal/commands/terminal.js && node --check tests/unit/copilot/terminal/test_commands_terminal.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js --hookTimeout=30000`.
- [x] Validação focada final:
  - `node --check src/copilot/terminal/commands/help.js && node --check tests/unit/copilot/terminal/test_commands_help.spec.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_help.spec.js --hookTimeout=30000`;
  - `npx eslint src/copilot/terminal/commands/help.js tests/unit/copilot/terminal/test_commands_help.spec.js`;
  - `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Live UX curta:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-aux-libs-help-detail-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T15-52-52-818Z/summary.md`;
  - resultado: PASS em 20/20 critérios, incluindo `ux-cycle-terminal-libs-detail`.
- [x] Smoke não interativo de previews implementado:
  - `scripts/model-gateway/commands/model-gateway-terminal-aux-libs-smoke.mjs`;
  - `npm run terminal:aux-libs:smoke`;
  - `npm --silent run terminal:aux-libs:smoke -- --json`;
  - `make terminal-aux-libs-smoke`.
- [x] Achado corrigido pelo smoke: `delta` recebia flag inválida quando o adapter era chamado com
      `color=never`; agora `renderTerminalDiffPreview()` usa fallback JS nesses casos e reserva
      `delta` para saída colorida explícita.
- [x] Smoke executado:
  - `npm run terminal:aux-libs:smoke`;
  - `node scripts/model-gateway/commands/model-gateway-terminal-aux-libs-smoke.mjs --json | jq -r '.ok, (.checks[] | [.id,.status,.renderer,.expected] | @tsv)'`;
  - `npm --silent run terminal:aux-libs:smoke -- --json | jq -r '.ok'`.
- [x] Smoke exposto na UX:
  - `/help full` mostra `npm run terminal:aux-libs:smoke` e o modo JSON pipeável com `npm --silent`;
  - `/terminal libs` e `/terminal libs detail` mostram `Smoke` e `JSON limpo`.
- [x] Make target validado:
  - `make terminal-aux-libs-smoke`.
- [x] Live UX repetida:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-aux-libs-smoke-command-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-00-21-072Z/summary.md`;
  - resultado: PASS em 20/20 critérios.
- [x] Live PTY filtrada do picker repetida após smoke:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --picker-interactive-cycle --timeout-ms 90000 --label terminal-picker-filtered-after-smoke-20260604`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-02-16-650Z/summary.md`;
  - resultado: PASS em 5/5 critérios;
  - escopo real da prova: `fzf --filter`, handoff exclusivo, seleção, roteamento por `/status`
    e restauração de prompt;
  - limite conhecido: não é prova visual completa de TUI fullscreen, porque o harness PTY não
    emula todas as respostas de terminal necessárias para esse modo.
- [x] Reconciliação documental:
  - `TERMINAL_AUXILIARY_LIBS_DECISION_GUIDE_2026-06-04.md` foi alinhado com o progresso real:
    exemplos, políticas, `/help full` rico e smoke local deixaram de aparecer como gaps pendentes.
- [x] Copy operacional fortalecida:
  - `/terminal libs detail` passou a renderizar `Estado` e `Default` por ferramenta;
  - ferramentas aceitas dizem explicitamente se sao acionáveis por comando explícito ou por opt-in
    com TTY exclusivo;
  - ferramentas adiadas como `atuin` e `zoxide` ficam descritas como inventário/planejamento, sem
    chamada automática.
- [x] Bug de poluição visual corrigido:
  - achado: renderizar `/terminal libs detail` por import direto emitia `[db][INFO] SQLite copilot ready`
    antes da tela humana;
  - causa: import via barrel amplo acionava módulos laterais desnecessários para uma tela read-only;
  - correção: `/terminal libs` importa `external-tools.js` diretamente e `diff-preview.js` importa
    `ui-theme.js` diretamente;
  - regressão coberta por processo filho em
    `tests/unit/copilot/terminal/test_terminal_command_import_side_effects.spec.js`.
- [x] Boot humano mais limpo:
  - achado live: a sessão ainda começava com `[db][INFO] [CopilotDB] SQLite copilot ready` antes
    do cabeçalho visual;
  - decisão UX: INFO de infraestrutura fica no logger central/arquivo, não na primeira linha do
    terminal humano;
  - correção: logger default de `src/copilot/db/sqlite.js` agora só imprime WARN/ERROR/FATAL antes
    da injeção de observabilidade;
  - regressão coberta por `tests/unit/copilot/test_copilot_db_default_logger.spec.js`;
  - harness live `--ux-cycle` agora possui o critério `ux-cycle-no-db-console-noise`.
- [x] Live PTY final:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-no-db-criterion-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-13-42-410Z/summary.md`;
  - resultado: PASS em 21/21 critérios, incluindo copy operacional de libs e ausência de ruído DB
    no console humano.
- [x] Wrapping visual padronizado:
  - achado: `/workspace list`, `/activity`, `/events` e uma linha de `/help full` ainda podiam
    ultrapassar 120 colunas em PTY real;
  - correção: `terminalThemeWrappedRow()` centraliza quebra de linhas mantendo coluna de label
    estável;
  - superfícies ajustadas: `/terminal libs detail`, `/workspace list`, `/activity`, `/events` e
    descrições longas de `/help full`;
  - validação focada: `test_ui_theme`, `test_commands_sdk`, `test_commands_activity`,
    `test_commands_terminal`, `test_commands_help` e `test_commands_events`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-wrapped-help-events-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-23-18-007Z/summary.md`;
  - medição: `awk 'NR>3 && length($0)>120' default-ux-cycle.plain.log` não encontrou linhas internas
    acima de 120 colunas.
- [x] Encerramento humano padronizado:
  - achado: `/quit` ainda emitia copy interna (`[terminal] Encerrando sessão...` e
    `[terminal] readline fechado...`), destoando do restante da UX tematizada;
  - correção: encerramento agora usa `terminalThemeRow()` com `Sessão encerrando terminal` e
    `Terminal fechado; HTTP local permanece ativo até o processo encerrar`;
  - harness live consolidado: todos os critérios `clean-close`/`clean-quit` agora usam um predicado
    semântico único para a copy humana e rejeitam a copy legada de `[terminal]`;
  - validação focada:
    `node --check src/copilot/terminal/repl/repl-command-router.js src/copilot/terminal/repl/repl-lifecycle.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - validação focada:
    `npx eslint src/copilot/terminal/repl/repl-command-router.js src/copilot/terminal/repl/repl-lifecycle.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-human-close-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-27-02-421Z/summary.md`;
  - resultado: PASS em 21/21 critérios, incluindo `ux-cycle-clean-close` com copy humana.
- [x] `/sdk` default com comandos nomeados:
  - achado live: o painel `/sdk` ainda renderizava `Uso` como lista multi-linha com continuações
    anônimas (`/sdk skills`, `/sdk quota`, `/sdk headers`) penduradas sem label próprio;
  - decisão UX: painel operacional default deve ser escaneável por categoria, não por bloco de
    ajuda colado;
  - correção: `/sdk` default agora mostra `Modelos`, `Skills`, `Rotina`, `Headers` e `Simular`,
    cada um com linha própria via `terminalThemeWrappedRow()`;
  - regressão coberta em `tests/unit/copilot/terminal/test_commands_sdk.spec.js`;
  - harness live reforçado: `ux-cycle-sdk-human` exige linhas nomeadas e rejeita continuações
    anônimas;
  - validação focada:
    `node --check src/copilot/terminal/commands/sdk.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_commands_sdk.spec.js`;
  - validação focada:
    `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js --hookTimeout=30000`;
  - validação focada:
    `npx eslint src/copilot/terminal/commands/sdk.js tests/unit/copilot/terminal/test_commands_sdk.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-sdk-command-rows-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-33-04-835Z/summary.md`;
  - resultado: PASS em 21/21 critérios, incluindo `/sdk` com linhas nomeadas.
- [x] `/workspace list` default sem continuações anônimas:
  - achado live: `sync/mirror` e `Obs` ainda quebravam em continuações sem label, dificultando a
    leitura do limite entre workspace SDK virtual e FS local;
  - correção: `/workspace list` agora mostra `Listar`, `SDK`, `Sync`, `Mirror`, `Promover`,
    `Contrato` e `Materializar` como linhas nomeadas;
  - decisão UX: comandos de transferência entre SDK virtual e FS local devem explicitar direção e
    auditoria sem símbolos técnicos crus;
  - regressão coberta em `tests/unit/copilot/terminal/test_commands_sdk.spec.js`;
  - harness live reforçado: `ux-cycle-workspace-human` exige linhas nomeadas e rejeita continuações
    anônimas de `--overwrite`/`com auditoria`;
  - validação focada:
    `node --check src/copilot/terminal/commands/sdk.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_commands_sdk.spec.js`;
  - validação focada:
    `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js --hookTimeout=30000`;
  - validação focada:
    `npx eslint src/copilot/terminal/commands/sdk.js tests/unit/copilot/terminal/test_commands_sdk.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-sdk-workspace-command-rows-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-35-19-232Z/summary.md`;
  - resultado: PASS em 21/21 critérios, incluindo workspace com linhas nomeadas.
- [x] Boot canônico sem banner `npm run`:
  - achado live: após a limpeza interna, a única linha acima de 120 colunas no primeiro viewport era
    o banner externo do `npm run terminal:llm-b`, antes de o terminal assumir a tela;
  - decisão UX: o operador deve abrir o terminal pelo caminho canônico silencioso, preservando o
    script `terminal:llm-b` para compatibilidade;
  - correção: harness live usa `npm --silent run terminal:llm-b` em PTY e stdio;
  - correção: `make model-gateway-terminal` usa `npm --silent run terminal:llm-b`;
  - correção: a task VS Code `terminal:llm-b` usa `npm --silent run terminal:llm-b`;
  - critério operacional: banner do gerenciador de scripts não deve ocupar a primeira tela nem virar
    linha durável de UX.
  - validação focada:
    `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - validação focada:
    `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-silent-boot-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-38-33-340Z/summary.md`;
  - medição: `awk 'length($0)>120' default-ux-cycle.plain.log` não encontrou linhas acima de
    120 colunas.
- [x] Pergunta humana estruturada com card vertical e prompt restaurado:
  - achado live: após responder `SIM` em `request_user_input`, o terminal confirmava a resposta,
    mas não redesenhava o prompt; o próximo comando do harness ficava bloqueado até timeout;
  - causa: o caminho imediato de resposta pendente estacionava o prompt como se toda resposta fosse
    `ask_user` de turno real aguardando continuação da LLM;
  - correção: `repl-lifecycle` agora diferencia `request_user_input` estruturado resolvido de
    `ask_user` de turno real; pergunta estruturada devolve o prompt imediatamente, enquanto turno
    real continua podendo manter o handoff para a LLM;
  - achado visual adicional: o headline do card de pergunta humana juntava estado, origem e
    timestamp na mesma linha, chegando a 132 colunas;
  - correção: `human-question-renderer` agora separa `Origem` e `Hora` em linhas próprias,
    preservando ISO 8601 completo e melhorando escaneabilidade;
  - harness live ajustado: `structured-input-human-card` valida card humano durável com origem e
    timestamp ISO, em vez de depender de linha transitória que o plain log não preserva;
  - validação focada:
    `node --check src/copilot/terminal/repl/repl-lifecycle.js src/copilot/terminal/events/human-question-renderer.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_human_question_renderer.spec.js`;
  - validação focada:
    `npx vitest run tests/unit/copilot/terminal/test_human_question_renderer.spec.js --hookTimeout=30000`;
  - validação focada:
    `npx eslint src/copilot/terminal/repl/repl-lifecycle.js src/copilot/terminal/events/human-question-renderer.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_human_question_renderer.spec.js`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --structured-input-cycle --label terminal-structured-input-card-prompt-pass-20260604 --timeout-ms 90000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-49-03-017Z/summary.md`;
  - resultado: PASS em 11/11 critérios, incluindo prompt restaurado, zero pendências após resposta,
    ausência de IDs crus e ausência de spam `request_user_input ainda executando`.
- [x] Diagnóstico rápido quando a LLM-B produz deltas mas omite `ask_user`:
  - achado live real:
    `artifacts/terminal-live/2026-06-04T16-50-21-066Z/summary.md`;
  - status observado: BLOCKED por timeout, embora a LLM-B tenha executado `report_intent`,
    `read_file_content` e escrito oito deltas públicos;
  - causa funcional: o modelo escreveu `DELTA-1`..`DELTA-8` em vez de
    `DELTA-CANONICAL-1`..`DELTA-CANONICAL-8`; o detector de recuperacao aceitava apenas
    `DELTA-CANONICAL-8`, portanto nao percebeu que a proxima acao obrigatoria era `ask_user`;
  - decisao UX/protocolo: "oito deltas publicos vistos" e "rotulo textual exatamente canonico"
    sao evidencias diferentes; a primeira deve dirigir a maquina de estados do runner, enquanto a
    segunda fica como criterio informativo de aderencia do modelo;
  - correcao: o harness agora reconhece `DELTA-8` e `DELTA-CANONICAL-8` para acionar
    recuperacao/diagnostico de `ask_user` ausente;
  - correcao: a continuacao controlada nao mente mais dizendo que as linhas foram necessariamente
    `DELTA-CANONICAL`; ela diz apenas que os oito deltas publicos ja apareceram;
  - correcao: os criterios live agora separam `partial-deltas` de `canonical-delta-labels`; o
    primeiro permanece requisito de fluxo, o segundo vira warning quando a LLM-B usa rotulos
    nao canonicos;
  - objetivo operacional: uma falha de protocolo do modelo deve virar recuperacao ou diagnostico
    em segundos, com `/activity`, `/tools diag`, `/events`, `/errors`, `/health` e `/export`, nao
    uma espera muda ate o timeout.
- [x] `/usage now` com BYOK ativo sem falsa hierarquia de quota:
  - achado live:
    `artifacts/terminal-live/2026-06-04T16-59-30-059Z/terminal.plain.log`;
  - problema visual: logo apos boot BYOK, `/usage now` mostrava primeiro
    `Quota Copilot rota kilo-auto/free · observado claude-haiku-4.5`, o que parecia indicar modelo
    atual divergente, apesar de ser apenas snapshot historico/lateral;
  - decisao UX: o estado atual deve vir primeiro (`BYOK ativo`), e telemetria Copilot/PR anterior
    deve ser rotulada como `Histórico Copilot`;
  - correcao: quando BYOK esta ativo, `/usage now` renderiza `BYOK ativo` antes do historico e usa
    `Histórico Copilot ... anterior/lateral; BYOK atual separado`;
  - preservacao: em caso de mismatch real, a linha historica ainda mostra `configurado`,
    `observado` quando existir e `cobrado`, para nao perder valor diagnostico;
  - teste focado:
    `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js --hookTimeout=30000`;
  - resultado: PASS em 8/8 testes;
  - harness live reforcado: `--ux-cycle` agora inclui `/usage now` e valida que BYOK aparece como
    estado atual antes do historico Copilot;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-usage-byok-history-guardrail-pass-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T17-07-17-596Z/summary.md`;
  - resultado: PASS em 22/22 criterios, sem linhas acima de 132 colunas no plain log filtrado.
- [x] `/sdk` default sem rótulo `Premium Requests` no painel BYOK:
  - achado live: `/sdk` mostrava `Quota Premium Requests · 0.0% restante`, o que podia ser lido
    como bloqueio/cobranca atual, embora seja entitlement SDK lateral ao runtime BYOK;
  - decisao UX: manter a informacao, mas nomear como quota SDK, nao como produto/cobranca atual;
  - correcao: `premium_interactions` agora renderiza `Pedidos premium SDK`; o escopo tecnico bruto
    permanece escondido;
  - teste focado:
    `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js --hookTimeout=30000`;
  - resultado: PASS em 40/40 testes;
  - harness live reforcado: `ux-cycle-sdk-human` agora falha se `/sdk` default voltar a expor
    `Premium Requests` ou `premium_interactions`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-sdk-premium-quota-humanized-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T17-10-45-648Z/summary.md`;
  - resultado: PASS em 22/22 criterios, com `Pedidos premium SDK` e sem linhas acima de 132
    colunas no plain log filtrado.
- [x] Fronteira de modelo BYOK/SDK com vocabulario operacional:
  - achado por auditoria: `session-binding.js` era a unidade certa para impedir trocas cruzando
    provedor/perfil, mas suas frases default ainda vazavam termos internos como `provider BYOK vivo`,
    `binding de nascimento` e `binding da sessao viva`;
  - decisao UX: o operador deve ler quatro conceitos estaveis: `selecao preparada`, `sessao atual`,
    `proximo boot` e `confirmacao`; `binding`, `provider-boundary` e equivalentes ficam somente no
    codigo/diagnostico raw;
  - correcao: `classifyTerminalByokSdkBinding()` agora descreve divergencia de modelo como
    `provedor BYOK da sessao atual coincide; o modelo preparado ainda precisa de confirmacao`;
  - correcao: troca cruzando provedor/perfil agora aparece como
    `selecao preparada cruza provedor ou perfil da sessao atual`;
  - correcao: `/byok model <id>` quando nao pode aplicar no runtime vivo diz
    `Sessao atual usa outro provedor/perfil; modelo preparado para o proximo boot`, sem sugerir
    que houve tentativa perigosa de troca cruzada;
  - achado live adicional: quando `/byok model <id>` era aplicado na sessao viva e o SDK emitia
    `session.model_changed`, `/byok` e `/session sdk` ainda comparavam apenas contra o modelo de
    nascimento persistido da sessao e continuavam dizendo que o modelo preparado precisava de
    confirmacao;
  - correcao: `classifyTerminalByokSdkBinding()` agora recebe o modelo runtime atual; se ele ja
    coincide com a selecao BYOK preparada, o estado vira `modelo BYOK ja confirmado na sessao atual`;
  - correcao: `/byok` e `/session sdk` passam o modelo runtime atual pela projection canonica,
    preservando o dado de nascimento em `Vinculo SDK`, mas nao confundindo isso com o modelo efetivo
    confirmado;
  - regressao coberta em `tests/unit/copilot/terminal/test_byok_session_binding.spec.js` e no
    contrato existente de `/byok model`;
  - harness live reforcado: `--ux-cycle` agora executa `/byok`, `/byok model
    terminal-ux-boundary-fixture`, `/byok` e `/session sdk 6`, rejeitando `binding`,
    `provider-boundary` e vocabulário antigo;
  - validacao focada:
    `npx vitest run tests/unit/copilot/terminal/test_byok_session_binding.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js --hookTimeout=30000`;
  - validacao focada:
    `npx eslint src/copilot/terminal/byok/session-binding.js src/copilot/terminal/commands/byok.js src/copilot/terminal/commands/session.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs tests/unit/copilot/terminal/test_byok_session_binding.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`;
  - live final:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-byok-boundary-confirmed-pass2-20260604 --timeout-ms 180000`;
  - artefato: `artifacts/terminal-live/2026-06-04T17-29-14-103Z/summary.md`;
  - resultado: PASS em 24/24 criterios, incluindo `ux-cycle-byok-boundary-human` e
    `ux-cycle-session-sdk-boundary-human`.
- [ ] Próxima lacuna: validar visualmente TUI completa `fzf`/`gum` quando for aceitável tomar o TTY
      real, mantendo o fluxo filtrado como prova automatizada.

## 2026-06-04 — Consolidação do Glossário Humano das Superfícies Default

- [x] Auditoria de retomada:
  - a UX terminal já tinha várias correções para `report_intent`, `request_user_input`, ids
    `chatcmpl-tool-*` e aliases técnicos;
  - ainda havia duplicação de regras em `dialog/output.js`, `live-status-line.js`,
    `commands/activity.js`, `commands/diagnose.js` e `commands/session.js`;
  - essa duplicação criava risco de regressão estética: uma superfície podia ficar bonita enquanto
    outra voltava a mostrar `Tool concluída`, `request_user_input ainda executando` ou ids crus.
- [x] Decisão arquitetural:
  - `tool-activity-presenter.js` passa a ser também a fonte canônica de humanização textual para
    superfícies default;
  - `/events --raw`, `/tools raw`, exports estruturados e diagnósticos detalhados continuam
    preservando envelopes técnicos;
  - textos livres do operador/modelo podem preservar nomes de protocolo quando isso é conteúdo
    semântico, usando `preserveProtocolNames`.
- [x] Correção aplicada:
  - criado `humanizeTerminalToolSurfaceText()`;
  - migrados `live-status-line.js`, `dialog/output.js`, `/activity`, `/diagnose` e `/session`
    para usar o mesmo filtro humano;
  - ids `chatcmpl-tool-*`, `toolu_*` e `call_*` viram `id interno` nas superfícies default;
  - `request_user_input ainda executando` vira `Pergunta ao operador aguardando resposta` sem
    engolir o restante da linha;
  - `report_intent(_local)`, `read_file_content`, `exec_command` e agregados conhecidos continuam
    passando pelo glossário humano compartilhado.
- [x] Contratos unitários adicionados:
  - presenter canônico bloqueia vazamento de nomes internos e ids;
  - presenter preserva `ask_user`/`request_user_input` quando solicitado para conteúdo livre;
  - linha viva reservada normaliza ids e tools internas antes de tomar a região do prompt;
  - linha viva calculada humaniza detalhes crus antes de renderizar.
- [x] Live PTY de confirmação inicial:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-shared-human-glossary-20260604 --timeout-ms 180000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-00-46-885Z/summary.md`;
  - resultado: `Status: PASS` em 27/27 critérios;
  - achado visual apesar do PASS: eventos informativos `Skills SDK carregadas` e depois
    `Configuração` podiam ser impressos entre prompt e comando injetado, poluindo a região de
    input embora não quebrassem o ciclo formal.
- [x] Correção de eventos SDK informativos:
  - `session.skills_loaded` e `session.tools_updated` deixam de imprimir linhas duráveis em modo
    verbose; quando o operador liga narração de sessão, eles usam linha viva curta;
  - `session.info` de tipo `configuration` deixa de pintar stdout e também não atualiza a atividade
    atual, ficando disponível em SSE/eventos e diagnósticos;
  - eventos relevantes como `model_retry`, título de sessão, warning e permissões continuam
    visíveis porque pedem atenção operacional real.
- [x] Live PTY intermediária:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-inline-informative-sdk-events-20260604 --timeout-ms 180000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-04-58-891Z/summary.md`;
  - resultado: `Status: PASS`; `Skills` deixou de vazar, mas `Configuração` ainda aparecia antes de
    `/quit`, validando a necessidade de tratar `session.info configuration` separadamente.
- [x] Live PTY final:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-silent-configuration-info-20260604 --timeout-ms 180000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-08-33-540Z/summary.md`;
  - resultado: `Status: PASS` em 27/27 critérios;
  - verificação manual do `plain.log`: as únicas ocorrências finais são
    `você[terminal-…/high]› /session sdk 6` e `você[terminal-…/high]› /quit`, sem `Skills`,
    `Configuração`, `chatcmpl-tool`, `request_user_input`, `report_intent` ou `toolu_` na
    superfície default.
- [x] Guardrail automatizado no harness:
  - `--ux-cycle` ganhou o critério `ux-cycle-no-informative-event-inside-prompt`;
  - a regra falha quando `Skills`, `Configuração` ou `Ferramentas` aparecem como linha informativa
    entre prompt e próximo comando do operador;
  - prova local do regex:
    - `artifacts/terminal-live/2026-06-04T18-00-46-885Z/default-ux-cycle.plain.log`: detecta o
      vazamento de `Skills`;
    - `artifacts/terminal-live/2026-06-04T18-04-58-891Z/default-ux-cycle.plain.log`: detecta o
      vazamento de `Configuração` antes de `/quit`;
    - `artifacts/terminal-live/2026-06-04T18-07-09-883Z/default-ux-cycle.plain.log`: detecta a linha
      viva longa de configuração colada ao prompt;
    - `artifacts/terminal-live/2026-06-04T18-08-33-540Z/default-ux-cycle.plain.log`: passa.
  - live positiva com critério ativo:
    - `artifacts/terminal-live/2026-06-04T18-12-49-450Z/summary.md`: `PASS`, 28/28 critérios,
      incluindo `ux-cycle-no-informative-event-inside-prompt`.
- [ ] Próxima frente:
  - revisar `/events` default e `/intent` para garantir que o glossário compartilhado não precise
    de uma segunda camada paralela;
  - só depois retomar a avaliação visual de TUI completa (`gum`, `fzf`, `bat`, `glow`, `delta`).

## 2026-06-04 — Intent e Eventos sem Vocabulário Paralelo

- [x] Auditoria inicial:
  - `/events` já usa `tool-activity-presenter.js` para nomes de ferramenta, paths e IDs compactos;
  - `/intent` e `intent-renderer.js` ainda mantêm helpers próprios para origem/risco;
  - o teste de `/intent detail` ainda aceitava `origem bruta tool/report_intent_local`, `ferramenta
    patch_file` e `chamada call-1`;
  - isso cria uma segunda gramática visual e reabre a porta para `report_intent_local`,
    `chatcmpl-tool-*`, `toolu_*` e nomes técnicos longos em superfícies que deveriam ser humanas.
- [x] Decisão UX:
  - `/intent` default deve ler como painel conversacional: intenção, contexto temporal completo,
    origem humana, risco humano e uso;
  - `/intent detail` pode mostrar envelope técnico, mas com nomes humanos e IDs compactos;
  - nomes brutos de ferramenta/source/call ficam reservados para export estruturado, SSE raw ou
    testes de contrato, não para a superfície visual default;
  - `assistant.intent`, `report_intent` e `report_intent_local` continuam sendo protocolos
    canônicos internamente, mas a UI deve apresentá-los como `SDK` ou `ferramenta de intenção`.
- [ ] Implementação planejada:
  - [x] criar presenter compartilhado para intent;
  - [x] migrar `commands/intent.js` e `events/intent-renderer.js`;
  - [x] atualizar testes para bloquear `report_intent_local`, `toolu_*`, `chatcmpl-tool-*` e `call_*`
    na superfície humana;
  - [x] reforçar harness live para validar `/intent` quando houver intenção real capturada.
- [x] Live canônico de auditoria:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --label terminal-ux-intent-human-envelope-20260604 --timeout-ms 240000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-22-35-347Z/summary.md`;
  - resultado parcial: `/intent` default e `/intent detail` passaram com envelope humano;
  - falha útil: `ux-no-raw-sdk-info-labels` ainda exigia a antiga linha de configuração, embora a
    decisão atual seja silenciar configuração informativa;
  - achado visual adicional: `session.skills_loaded` e `session.tools_updated` ainda usavam linha
    viva em modo full, poluindo a região do prompt com inventário de boot.
- [x] Correção complementar:
  - `session.skills_loaded` e `session.tools_updated` agora ficam fora de stdout/linha viva;
  - ambos preservam SSE/diagnóstico, mas usam `updateCurrent:false` para não sequestrar a atividade
    atual;
  - o critério `ux-no-raw-sdk-info-labels` passa a validar silêncio operacional para inventário
    rotineiro e ausência de rótulos crus.
- [x] Live canônico final:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --label terminal-ux-intent-human-envelope-pass2-20260604 --timeout-ms 240000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-27-06-077Z/summary.md`;
  - resultado: `PASS`;
  - critérios novos aprovados: `ux-intent-command-default-human`,
    `ux-intent-command-detail-human-envelope` e `ux-no-raw-sdk-info-labels`;
  - inspeção manual do `terminal.plain.log`: `/intent` e `/intent detail` renderizam origem humana,
    ferramenta humana e `chamada id interno`; `report_intent_local`, `toolu_*` e `chatcmpl-tool-*`
    aparecem apenas após `/events --raw`.
- [x] Próximo achado visual:
  - o mesmo live mostrou `Título` da sessão como linha durável logo após o prompt longo do operador;
  - decisão: título gerado pelo SDK é metadado de sessão, não progresso da LLM-B;
  - deve permanecer em SSE/diagnóstico e não roubar a região entre `prompt do usuário` e `LLM-B
    trabalhando`.
- [x] Correção aplicada:
  - `session.title_changed` deixa de imprimir linha durável;
  - `Título da sessão atualizado` usa `updateCurrent:false` e `recordHistory:false`;
  - `ux-no-raw-sdk-info-labels` agora também falha se `Título` reaparecer na superfície default do
    live canônico.
- [x] Live de verificação:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --label terminal-ux-silent-session-title-20260604 --timeout-ms 240000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-32-05-756Z/summary.md`;
  - resultado: `BLOCKED` por `assistant-empty-after-user-input`, mas o critério
    `ux-no-raw-sdk-info-labels` passou;
  - inspeção do `terminal.plain.log`: sem `Título`, `LLM-B sessão · skills`,
    `LLM-B sessão · ferramentas` ou `LLM-B sessão · Configuração` na superfície default.
- [ ] Próxima lacuna real:
  - investigar `dialog.empty_after_user_input` recorrente quando a LLM-B recebe a resposta humana e
    encerra sem texto público;
  - avaliar se a UX deve oferecer comando de recuperação mais explícito, recuperação assistida no
    harness, ou uma política de retry controlada pelo operador;
  - manter a separação: produto não deve fazer retry automático caro/perigoso sem decisão explícita,
    mas o terminal precisa tornar o próximo passo óbvio.

## 2026-06-04 — Recuperação Humana para Continuação Pós-Pergunta Vazia

- [x] Auditoria da falha live:
  - artefato: `artifacts/terminal-live/2026-06-04T18-32-05-756Z/summary.md`;
  - o fluxo canônico chegou ao `ask_user`, registrou `SIM`, emitiu `llm.usage` classificado como
    continuação de pergunta humana e encerrou `turn:2` com `dialog.turn_end.reply=""`;
  - não houve vazamento de `Título`, `Skills`, `Ferramentas` ou `Configuração`, portanto o bloqueio
    restante não era regressão estética de boot;
  - a cópia anterior dizia apenas para tentar `/turn`, reenviar ou trocar modelo, sem confirmar ao
    operador que a resposta humana tinha sido aceita.
- [x] Decisão UX:
  - não implementar retry automático de produto nesta etapa, porque ele pode consumir chamada de
    modelo, repetir intenção sensível ou esconder uma falha real de protocolo;
  - tornar a recuperação explícita, humana e acionável: estado, resposta aceita, turno, detalhe,
    comando de retomada, comandos de diagnóstico e alternativa de troca de modelo;
  - manter `requestId` e envelopes técnicos fora da superfície default; eles continuam disponíveis
    em `/events --raw`, SSE e export técnico.
- [ ] Implementação planejada:
  - [x] criar presenter compartilhado para recuperação de `dialog.empty_after_user_input`;
  - [x] trocar a linha genérica de warning por um cartão de recuperação com `Retomar`,
    `Diagnóstico` e `Alternativa`;
  - [x] alinhar `/events` default para mostrar a mesma ação de retomada em vez de uma frase
    genérica;
  - [x] adicionar critério live opcional garantindo que uma execução bloqueada por
    `assistant-empty-after-user-input` mostre o comando de recuperação;
  - [x] repetir live canônico para observar o cartão em uma falha real ou confirmar PASS quando a
    LLM-B materializar o pós-ask.
  - [x] live de confirmação:
    - comando:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --live-scenario=canonical --label terminal-ux-question-safe-diagnostics-20260604 --timeout-ms 240000 --transport=pty`;
    - artefato: `artifacts/terminal-live/2026-06-04T18-45-44-582Z/summary.md`;
    - resultado: `PASS`;
    - validou tools reais, deltas públicos, `ask_user`, prompt `[PERG]`, resposta `SIM`,
      pós-pergunta via `assistant.message`, export e correlação SSE;
    - não houve comando diagnóstico injetado em prompt `[PERG]`.

## 2026-06-04 — Harness Não Deve Injetar Diagnóstico Dentro de `[PERG]`

- [x] Achado live:
  - artefato: `artifacts/terminal-live/2026-06-04T18-42-31-896Z/summary.md`;
  - a LLM-B chamou `ask_user` antes dos deltas públicos obrigatórios;
  - o harness detectou corretamente `assistant-asked-before-required-deltas`, mas começou a enviar
    `/activity`, `/intent`, `/events` e `/export` enquanto o terminal ainda estava em
    `você[…][PERG]›`;
  - isso fazia os comandos parecerem respostas humanas e poluía a visão real do operador.
- [x] Decisão UX/teste:
  - diagnóstico automatizado nunca deve disputar um prompt de pergunta humana;
  - se o modelo abre `ask_user` prematuramente, o harness deve responder com a resposta do cenário,
    aguardar retorno ao prompt normal e só então emitir comandos diagnósticos;
  - o bloqueio continua sendo protocolar, mas a evidência visual deixa de criar uma segunda falha
    artificial.
- [x] Correção aplicada:
  - criado detector de prompt normal que exclui `[PERG]`;
  - `scheduleAskBeforeDeltasDiagnostics()` agora libera a pergunta pendente antes dos diagnósticos;
  - os diagnósticos só disparam depois de `você[…]›` normal, preservando a região de input humano.
- [x] Live posterior:
  - artefato: `artifacts/terminal-live/2026-06-04T18-45-44-582Z/summary.md`;
  - resultado: `PASS`;
  - o cenário não repetiu o `ask_user` prematuro, mas confirmou que a nova espera por prompt normal
    não afetou o caminho feliz.

## 2026-06-04 — Timeline `/activity` sem Prefixo de Fase Redundante

- [x] Achado live:
  - em `artifacts/terminal-live/2026-06-04T18-45-44-582Z/terminal.plain.log`, a timeline default de
    `/activity 40` ainda mostrava linhas como `turno · Intenção da LLM-B` e
    `sistema · Resposta concluída`;
  - esses prefixos são tecnicamente corretos, mas visualmente redundantes: o próprio label já
    explica o evento.
- [x] Decisão UX:
  - a timeline default deve ser escaneável por evento humano, não por enum de fase;
  - fases continuam úteis quando o label é genérico, como `Processando mensagem`;
  - labels semanticamente fortes (`Intenção`, `Mensagem`, `Resposta`, `Uso BYOK`, `Modelo`) não
    recebem prefixo de fase.
- [x] Correção aplicada:
  - `renderTimelineEntryHeading()` reconhece `Intenção da LLM-B`, `Mensagem...` e
    `Resposta concluída` como labels autossuficientes;
  - teste focado cobre ausência de `turno · Intenção da LLM-B` e
    `sistema · Resposta concluída`.
- [x] Guardrail live:
  - `ux-activity-no-redundant-timeline-labels` também falha se `/activity 40` voltar a mostrar
    `turno · Intenção...` ou `sistema · Resposta...`.
- [x] Validação focada:
  - `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js --hookTimeout=30000`;
  - `npx eslint src/copilot/terminal/commands/activity.js tests/unit/copilot/terminal/test_commands_activity.spec.js`.

## 2026-06-04 — `/usage now` com Coluna Visual Compacta

- [x] Achado live:
  - em `artifacts/terminal-live/2026-06-04T18-45-44-582Z/terminal.plain.log`, `/usage now`
    comunicava a semântica correta, mas labels longos como `Histórico Copilot`,
    `Telemetria LLM`, `Pergunta humana` e `Correlacionar` quebravam o alinhamento visual;
  - isso era especialmente perceptível em PTY estreito, onde a coluna de valor começava em
    posições diferentes.
- [x] Decisão UX:
  - labels default devem ser curtos e escaneáveis;
  - contexto semântico vai para o valor: `Histórico` pode dizer `Copilot ...`, `LLM` pode dizer
    `modelo ...`, `Pergunta` pode dizer `pós-resposta humana`;
  - detalhe técnico continua em `/usage now detail`.
- [x] Correção aplicada:
  - `BYOK ativo` virou label `BYOK`;
  - `Histórico Copilot` virou label `Histórico` com valor começando por `Copilot`;
  - `Telemetria LLM` virou label `LLM`;
  - `Pergunta humana` virou label `Pergunta`;
  - `Correlacionar` virou label `Conferir`.
- [x] Guardrail live:
  - `ux-cycle-usage-byok-current-first` agora aceita a forma compacta e reprova os labels longos
    antigos no default.
- [x] Live UX:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-usage-compact-labels-20260604 --timeout-ms 160000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T18-54-21-268Z/summary.md`;
  - resultado: `PASS` em 28/28 critérios;
  - verificação visual: `/usage now` mostrou `BYOK`, `Histórico`, `LLM`, `Pergunta` e
    `Conferir`, sem `BYOK ativo`, `Histórico Copilot`, `Telemetria LLM` ou `Correlacionar`.
- [x] Próxima lacuna visual promovida:
  - `/byok` default ainda era superfície muito densa;
  - `/help full` continua denso por escolha explícita do operador e será tratado em rodada separada.

## 2026-06-04 — `/byok` Default como Cockpit Compacto

- [x] Achado live:
  - no artefato `artifacts/terminal-live/2026-06-04T18-54-21-268Z/terminal.plain.log`, `/byok`
    e `/byok model terminal-ux-boundary-fixture` renderizavam o estado correto, mas terminavam com
    um bloco `Comandos` de nove linhas;
  - esse bloco incluía catálogo de gateway, seleção, importers, probes, recomendações e automação,
    ocupando o primeiro viewport como se o operador tivesse pedido documentação completa;
  - a tela de status perdia o papel de cockpit e voltava a parecer dump de manual.
- [x] Decisão UX:
  - `/byok` padrão deve responder quatro perguntas rápidas: qual é o estado, qual é a sessão viva,
    como trocar, como provar;
  - catálogo completo e comandos avançados continuam disponíveis, mas apenas por intenção explícita
    em `/byok gateway commands`, `/byok auto policy` e `/byok env`;
  - linhas de fronteira entre seleção preparada e sessão viva devem usar o mesmo tema visual do
    terminal, sem ANSI manual nem frases fora do alinhamento comum.
- [x] Correção aplicada:
  - `printByokSdkSessionBoundaryHint()` reduziu `Próximo`, separou `Conversa` de `Modelo vivo` e
    deixou claro que `/restart` não troca provedor;
  - `tryApplyLiveByokModelSwitch()` trocou mensagens ANSI manuais por rows temáticas `Sessão viva`,
    `Troca modelo`, `Modelo vivo` e `Confirmar`;
  - `/byok` default substituiu o bloco `Comandos` por quatro linhas compactas:
    `Rotina`, `Trocar`, `Provar` e `Avançado`.
- [x] Guardrails:
  - `test_commands_byok.spec.js` exige `Rotina`, `Trocar`, `Provar` e `Avançado`;
  - o teste bloqueia o retorno de `/byok gateway catalog refresh|diff|integrity|sqlite|search`
    e do bloco `/byok auto [on|policy|doctor|standby|proof-plan|switch|history|off]` no status
    default;
  - o runner live `--ux-cycle` exige cockpit compacto e também bloqueia catálogo avançado dentro
    da superfície `/byok` default.
- [x] Segunda correção derivada da live:
  - `/session sdk` ainda mostrava `Metadados modelo ... · provedor BYOK · limite mudança de
    provider/modelo BYOK`;
  - o vocabulário foi normalizado para `rota BYOK` e `mudança de rota/modelo BYOK`;
  - `classifyTerminalByokSdkBinding()` também passou a dizer `rota BYOK da sessão atual coincide`
    no caso de mesma rota com modelo ainda pendente;
  - o runner live agora reprova `provedor BYOK` e `provider/modelo BYOK` dentro da superfície
    default de `/session sdk`.
- [x] Live UX:
  - comando:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-byok-session-route-copy-20260604 --timeout-ms 170000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T19-03-09-938Z/summary.md`;
  - resultado: `PASS` em 28/28 critérios;
  - inspeção adicional: o plain log não contém `provedor BYOK`, `provider/modelo BYOK`,
    `/byok gateway catalog refresh|diff|integrity|sqlite|search` nem o bloco antigo
    `/byok auto [on|policy|doctor...]` na UX default.
- [x] Terceira correção derivada da live:
  - `/session sdk 6` ainda repetia seis linhas `Resumo` com 137 colunas;
  - o preview default de resumo de sessão foi reduzido de 120 para 84 caracteres úteis;
  - `test_commands_session.spec.js` passou a bloquear linhas `Resumo` maiores que 112 caracteres
    na superfície default;
  - live posterior:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-session-summary-compact-20260604 --timeout-ms 170000 --transport=pty`;
  - artefato: `artifacts/terminal-live/2026-06-04T19-06-07-106Z/summary.md`;
  - resultado: `PASS` em 28/28 critérios; `awk length>135` não encontrou linhas longas, e os
    resumos de sessão ficaram em 101 colunas no plain log.
- [x] Quarta correção derivada da auditoria do plain log:
  - `/help full` ainda dizia `/session sdk commands  CommandDefinition[] registrados no SDK`;
  - mesmo em modo completo, tipo TypeScript cru não ajuda o operador;
  - a descrição virou `comandos registrados no SDK`;
  - `test_commands_help.spec.js` bloqueia `CommandDefinition[]` no help humano.
- [x] Quinta correção derivada da reauditoria de libs auxiliares:
  - `/menu picker` textual já bloqueava TUI quando havia pergunta humana pendente;
  - `/menu picker --interactive` ainda enviava `pendingQuestion=false` ao planner;
  - `cmdMenu()` agora lê a pendência real do runtime também no caminho interativo;
  - mesmo com TTY reportado como pronto, `ask_user` pendente mantém fallback textual e impede
    `withExclusiveTty()`;
  - `test_commands_menu.spec.js` cobre esse cenário.
  - live de regressão:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --picker-interactive-cycle --timeout-ms 90000 --label terminal-picker-pending-guard-after-menu-fix-20260604`;
  - artefato: `artifacts/terminal-live/2026-06-04T19-13-40-513Z/summary.md`;
  - resultado: `PASS` em 5/5 critérios.
- [x] Sexta correção derivada da reauditoria de libs auxiliares:
  - `bat` já recebia argumentos tokenizados e sem shell livre, mas o path ainda era passado sem
    `--`;
  - `file-preview.js` agora insere `--` antes do caminho para evitar que arquivos iniciados por
    hífen sejam interpretados como flags do renderer externo;
  - `test_file_preview.spec.js` cobre esse contrato.
- [x] Sétima correção derivada da reauditoria de libs auxiliares:
  - `jq`/`yq` também têm parser de opções próprio;
  - `structured-preview.js` agora bloqueia filtros iniciados por hífen e filtros com caracteres de
    controle antes de chamar renderer externo;
  - o fallback JS permanece canônico e declara `filtro ignorado`;
  - `test_structured_preview.spec.js` cobre JSON/YAML.
- [x] Oitava correção derivada da reauditoria de libs auxiliares:
  - `gum choose` recebe opções antes das escolhas;
  - `picker-runner.js` agora passa `--` antes das escolhas;
  - `test_picker_runner.spec.js` cobre o separador.
- [ ] Próxima lacuna visual:
  - auditar `/help full`, `/byok gateway commands`, `/byok gateway operator-ready` e `/byok auto`
    para confirmar que o modo detalhado é rico sem parecer lixo técnico;
  - manter os catálogos longos em comandos explícitos, com títulos humanos, paginação/filtros e
    ações curtas por linha.

## 2026-06-04 — Auditoria Profunda do Contrato de Turno Vazio, Tools e Linha Viva

### 12.62 Escopo e motivação

- [x] Reabrir a investigação a partir do comportamento real observado no terminal:
  - `Turno vazio · sem resposta pública materializada; nenhuma pergunta humana pendente`;
  - tools de listagem ou shell que mostram apenas o nome genérico da operação;
  - linha viva que conhece a tool, mas não necessariamente o alvo operacional que interessa ao
    operador;
  - eventos de troca de modelo que existem tecnicamente, mas ainda precisam ser avaliados como uma
    narrativa operacional única.
- [x] Expandir a análise para fora do renderer:
  - `src/copilot/agent/dialog/`;
  - `src/copilot/channel/client-dialog.js`;
  - `src/copilot/presentation/`;
  - `src/copilot/terminal/dialog/`;
  - `src/copilot/terminal/events/`;
  - `src/copilot/terminal/state/`;
  - `src/copilot/core/tool-target-introspection.js`.
- [x] Reafirmar a decisão arquitetural:
  - terminal não deve inventar semântica que o runtime já pode conhecer;
  - `agent` é owner da resolução semântica do turno;
  - `channel` é owner da entrega e da origem do reply ao consumidor;
  - terminal é owner da materialização humana, reconciliação visual e diagnóstico;
  - metadados semânticos de tools devem nascer em um contrato compartilhado, não em strings
    específicas de um renderer.

### 12.63 Mapa causal atual do turno explícito

- [x] O turno explícito começa em `terminal/dialog/engine.js`:
  - marca `busy`;
  - chama `beginTerminalTurnMaterialization()`;
  - cria callbacks de reasoning e delta;
  - chama `runTerminalDialogTurnDetailed()`;
  - imediatamente após o retorno, chama `completeTerminalTurnMaterialization()`;
  - se nenhuma fonte textual estiver presente, chama `recordTerminalExplicitEmptyOutput()`.
- [x] O gateway `terminal/frontend/gateways/dialog.js` delega para
  `llmBridgeClient.dialogTurnDetailed()` quando não há `requestHeaders`.
- [x] O transporte `channel/client-dialog.js` observa:
  - retorno direto de `sendRuntimeDialogTurnOnActiveLoop()`;
  - espelho `dialog.reply`;
  - deltas `task.delta` e `dialog.delta`;
  - reasoning `task.reasoning`.
- [x] O transporte usa uma única passagem por `setImmediate()` quando o retorno direto está vazio e
  `dialog.reply` ainda não chegou.
- [x] O runtime do dialog loop em `agent/dialog/executors/turn-executor.js` usa
  `createDialogTurnOutputCollector()` como owner semântico do reply.
- [x] O collector observa:
  - `assistant.message`;
  - `dialog.delta`;
  - `task.delta`;
  - `assistant.turn_end`;
  - sinais de início/fim de tools;
  - snapshot de protocolo pendente.
- [x] O collector deliberadamente considera delta inelegível quando houve sinal de tool depois do
  último delta:
  - isso evita tratar texto pré-tool como resposta final;
  - também significa que um turno tool-only sem mensagem final pode terminar legitimamente sem
    reply textual.
- [x] O terminal também observa `assistant.message` em `sdk-session-events.js`:
  - quando `getBusy()` é verdadeiro, a mensagem é anexada ao materializador do turno;
  - quando `getBusy()` já é falso, ela é tratada como mensagem fora do turno ativo ou reconciliada
    contra materialização recente.
- [x] `dialog.turn_end` em `terminal-agent-wiring.js` é lifecycle e fallback visual, não deveria ser
  uma segunda fonte semântica independente de transcript.

### 12.64 Situações reais em que “sem resposta pública materializada” pode aparecer

- [x] Caso A — vazio real do modelo:
  - modelo recebe o prompt;
  - não emite `REPLY`, `assistant.message` nem delta público elegível;
  - encerra o turno;
  - não deixa pergunta humana pendente.
- [x] Caso B — continuação pós-`ask_user` vazia:
  - resposta humana é aceita;
  - o modelo continua;
  - o turno termina sem fala pública final;
  - `dialog.empty_after_user_input` registra essa condição.
- [x] Caso C — turno tool-only:
  - modelo chama uma ou mais tools;
  - não emite síntese pública depois da última tool;
  - deltas anteriores à última tool são inelegíveis por design;
  - nenhuma pergunta humana permanece pendente.
- [x] Caso D — mensagem final tardia:
  - runtime/SDK resolve o caminho principal;
  - `assistant.message` ou `dialog.reply` chega numa fila assíncrona posterior;
  - o terminal completa a materialização antes de a mensagem entrar no estado ativo;
  - o operador vê falso “Turno vazio” seguido de resposta tardia ou mensagem fora do turno.
- [x] Caso E — divergência entre canais:
  - retorno direto fica vazio;
  - espelho `dialog.reply` não chega dentro de um único `setImmediate()`;
  - `assistant.message` pode existir em outro canal;
  - o transporte devolve `replySource=empty` cedo demais.
- [x] Caso F — finalização ou erro de protocolo sem conteúdo:
  - READY/STOPPED, cancelamento, warning de sessão, falha de provider ou transição de loop altera o
    estado;
  - nenhum conteúdo público é produzido;
  - o terminal precisa distinguir falha, encerramento autorizado, pergunta pendente e vazio real.
- [x] Caso G — conteúdo suprimido corretamente:
  - eco de resposta humana é descartado;
  - mensagem de protocolo READY/STOPPED é descartada;
  - conteúdo duplicado já materializado é suprimido;
  - se não houver outra fala pública, o resultado pode parecer vazio, mas o diagnóstico deve
    explicar que houve conteúdo não público ou duplicado.

### 12.65 Bugs e gaps identificados no contrato de turno

- [x] Gap: `replySource` do transporte descreve apenas `runtime_return`, `transport_mirror` ou
  `empty`; ele não carrega diagnóstico suficiente para explicar por que o runtime terminou vazio.
- [x] Gap: o materializador do terminal conhece deltas e mensagens capturados localmente, mas não
  conhece o snapshot semântico do collector do `agent`.
- [x] Gap: o terminal decide vazio imediatamente após o retorno do gateway, sem uma política
  explícita de quiescência para eventos finais assíncronos.
- [x] Gap: o transporte usa um único `setImmediate()` como drenagem implícita:
  - é uma heurística de event loop;
  - não representa uma janela de quiescência;
  - não produz diagnóstico de quanto tempo ou quais sinais foram aguardados.
- [x] Gap: `dialog.empty_after_user_input` e `terminal.turn.empty_output` podem representar a mesma
  falha em camadas diferentes, mas não compartilham uma classificação causal canônica.
- [x] Gap: o turno vazio é atualmente registrado como falha BYOK sempre que BYOK está pronto:
  - isso pode ser correto para vazio real do provider;
  - pode ser incorreto para falso positivo causado por mensagem tardia;
  - pode ser excessivo para turno tool-only deliberado.
- [x] Gap: o operador recebe ação de recuperação, mas não recebe uma classificação curta do motivo:
  - `sem conteúdo do modelo`;
  - `continuação pós-pergunta vazia`;
  - `turno tool-only sem síntese`;
  - `mensagem final tardia`;
  - `encerramento de protocolo`.
- [x] Hipótese de propriedade `metrics` duplicada reavaliada:
  - a releitura numerada de `turn-executor.js` não encontrou duplicidade no estado atual;
  - o item foi classificado como não reproduzido e não gerou alteração artificial.

### 12.66 Situação ideal para resolução semântica do turno

- [x] Criar um resultado semântico canônico de turno no `agent`, além da string simples.
- [x] O resultado semântico distingue:
  - `public_reply`;
  - `pending_human_input`;
  - `tool_only`;
  - `protocol_transition`;
  - `empty`;
  - `failed`;
  - `interrupted`.
- [ ] O resultado deve carregar diagnóstico seguro:
  - origem do reply;
  - presença de `assistant.message`;
  - quantidade e elegibilidade de deltas;
  - último sinal de tool;
  - presença de pergunta humana;
  - turn id e timestamps;
  - motivo de finalização.
- [x] Preservar compatibilidade:
  - APIs públicas que ainda esperam `Promise<string>` continuam funcionando;
  - uma API detalhada expõe o resultado semântico;
  - migração deve ocorrer por barrels e sem duplicar lógica.
- [x] `channel/client-dialog.js` transporta o resultado detalhado em vez de reconstruir
  semântica a partir de uma string e um espelho eventual.
- [x] `terminal/frontend/gateways/dialog.js` expõe os metadados detalhados ao engine.
- [x] `terminal/dialog/engine.js` materializa e classifica usando o resultado semântico:
  - não acusar falha quando há pergunta humana pendente;
  - não acusar falha silenciosamente em tool-only sem síntese;
  - acusar vazio real com diagnóstico acionável;
  - registrar falha BYOK apenas quando a classificação atribui o vazio ao caminho de provider.
- [ ] Uma janela curta e limitada de quiescência pode existir como defesa de borda:
  - deve aguardar apenas quando o resultado é vazio e há sinais de finalização concorrentes;
  - deve terminar cedo quando chega mensagem ou delta público;
  - deve ser configurável, observável e testável;
  - não pode mascarar stalls nem adicionar latência ao caminho feliz.
- [ ] Eventos tardios devem ser correlacionados com o turno recém-concluído:
  - resposta tardia deve reconciliar o diagnóstico anterior;
  - se um falso vazio já foi exibido, registrar explicitamente a correção;
  - evitar contar falha BYOK quando a resposta foi materializada dentro da janela de reconciliação.

### 12.67 Contrato atual de metadados de tools

- [x] `core/tool-target-introspection.js` centraliza:
  - arquivos;
  - URLs;
  - termos de busca;
  - arquivos presentes em patches;
  - ranges de linha;
  - alvo primário.
- [x] `terminal/events/tool-activity-presenter.js` usa esse contrato para construir:
  - nome humano;
  - operação;
  - label;
  - target;
  - linha de início;
  - linha de progresso;
  - linha de conclusão.
- [x] `tool-lifecycle-runtime.js` preserva a apresentação no `ToolCallRegistry` e a reutiliza em
  start, progress, complete, SSE e turn trace.
- [x] A linha viva usa `activity.toolName`, mas não recebe um campo semântico específico para o alvo
  operacional atual.
- [x] `exec_command` tem argumento `command`, porém `command` não faz parte da introspecção
  canônica:
  - o `cwd` pode aparecer como arquivo/alvo;
  - o comando não aparece;
  - a UX reduz a operação a `Executar comando · executando comando`.
- [x] `list_tools` tem filtros `category` e `search`, e resultado com `count`, mas não possui nome
  humano nem resumo semântico dedicado.
- [x] Tools de listagem de arquivo podem mostrar path ou busca quando esses campos existem, mas
  contagem e escopo retornados não são apresentados de forma consistente.

### 12.68 Bugs e gaps identificados na narrativa de tools

- [x] Gap: não há campo canônico para comando shell.
- [x] Gap: não há campo canônico para filtro/categoria de listagem.
- [x] Gap: não há campo canônico para contagem de resultados.
- [x] Gap: não há campo canônico para resumo seguro de resultado.
- [x] Gap: `hasSemanticToolTarget()` considera apenas paths, ranges, URLs, buscas e patches; uma
  apresentação enriquecida por comando ou contagem pode ser descartada na conclusão.
- [x] Gap: `tool.lifecycle` não transporta comando seguro, filtro ou contagem.
- [x] Gap: `recordTerminalTurnToolActivity()` recebe apenas `target`, então a projeção de turno não
  consegue diferenciar arquivo, comando, filtro e resultado.
- [x] Gap: a linha viva mostra o nome humano da tool, mas não prioriza `presentation.target` ou um
  alvo operacional enriquecido.
- [x] Gap: nomes humanos não cobrem `list_tools`, apesar de a tool ser parte relevante da
  introspecção da sessão.
- [x] Risco: mostrar comando bruto pode vazar segredos, tokens, headers ou payloads longos.
- [x] Risco: mostrar stdout/stderr bruto na linha viva criaria verborragia, quebras e vazamento de
  dados.

### 12.69 Situação ideal para metadados e UX de tools

- [x] Expandir a introspecção canônica para um contrato de alvos operacionais.
- [x] O contrato separa:
  - `fileTargets`;
  - `urlTargets`;
  - `searchTerms`;
  - `patchFiles`;
  - `lineRange`;
  - `commands`;
  - `filters`;
  - `resultCount`;
  - `resultSummary`;
  - `primaryTarget`;
  - `primaryTargetKind`.
- [x] Comandos passam por sanitização própria para superfície humana:
  - compactar whitespace;
  - truncar agressivamente;
  - mascarar variáveis e argumentos sensíveis;
  - evitar imprimir conteúdo multilinha;
  - preservar o comando bruto apenas em diagnóstico técnico autorizado.
- [x] Resultados são resumidos, nunca despejados:
  - `12 arquivos`;
  - `105 tools`;
  - `saída 0`;
  - `3 correspondências`;
  - `2 páginas`.
- [x] `tool-activity-presenter` escolhe alvo pela operação:
  - shell prioriza comando;
  - leitura/escrita prioriza arquivo;
  - busca prioriza termo e escopo;
  - listagem prioriza filtro, path e contagem;
  - introspecção prioriza recurso e contagem;
  - pergunta prioriza texto da pergunta;
  - intent prioriza intenção.
- [x] `ToolCallRegistry` preserva a apresentação enriquecida do start e permite upgrade no
  complete quando o resultado adiciona contagem ou resumo.
- [x] `tool.lifecycle` carrega metadados semânticos seguros para consumidores externos.
- [x] Linha viva deve mostrar:
  - `LLM-B ferramenta · Executar comando · git status · 2s`;
  - `LLM-B ferramenta · Listar tools · categoria code · 1s`;
  - `LLM-B ferramenta · Buscar arquivos · "turn-materialization" · 3s`;
  - sem IDs internos, sem stdout bruto e sem ocupar o input.
- [ ] Histórico durável deve mostrar começo e conclusão sem repetir frases:
  - início: ação e alvo;
  - conclusão: resultado curto, duração e eventual exit code;
  - progresso: apenas milestones semânticos.

### 12.70 Linha viva como projeção do trabalho atual

- [x] Estado atual:
  - a linha viva lê `readTerminalActivitySnapshot()`;
  - tools usam `activity.toolName`;
  - detalhes existem, mas o caminho especial de tool ignora `activity.detail`;
  - por isso uma tool enriquecida ainda pode aparecer apenas como nome humano.
- [x] Decisão:
  - a linha viva não deve inferir novamente argumentos de tool;
  - `recordTerminalActivity()` deve receber a apresentação semântica já resolvida;
  - a linha viva deve escolher uma projeção curta do alvo operacional.
- [x] Criar prioridade visual:
  - pergunta humana;
  - resposta/delta;
  - tool ativa com alvo;
  - reasoning;
  - recuperação/troca de modelo;
  - turno genérico;
  - boot/idle.
- [x] Garantir que a linha viva não ocupe o input:
  - manter região reservada;
  - truncar por largura efetiva;
  - nunca renderizar conteúdo multilinha;
  - não imprimir heartbeats duráveis concorrentes.

### 12.71 Seleção e troca automática de modelo

- [x] Estado atual identificado:
  - SDK emite `session.model_changed`;
  - terminal registra `Modelo confirmado`;
  - model-gateway grava confirmação de handoff em SQLite;
  - `auto_mode_switch.requested` e `auto_mode_switch.completed` são observados;
  - BYOK possui comandos explícitos de automação e troca;
  - narração de `session.model_changed` é silenciosa por default e visível em modo verbose.
- [x] Reavaliar se toda troca efetiva deve ser um fato durável no modo default:
  - troca de modelo muda custo, capacidade, comportamento e interpretação da resposta;
  - operador precisa saber quando ocorreu, mesmo sem verbose;
  - evitar narrar apenas mudanças redundantes ou confirmações sem alteração real.
- [ ] Distinguir visualmente:
  - rota selecionada pelo model-gateway;
  - handoff preparado;
  - sessão SDK reiniciada;
  - modelo efetivamente confirmado pelo SDK;
  - retry interno do provider;
  - auto mode switch solicitado/concluído.
- [ ] Linha viva deve mostrar transição apenas enquanto ela está acontecendo:
  - `LLM-B trocando modelo · antigo → novo`;
  - depois retornar à atividade real;
  - histórico deve preservar a confirmação efetiva.
- [ ] SSE e `/events` devem manter IDs e correlação; stdout default deve usar nomes humanos e
  motivo curto.

### 12.72 Sequência técnica priorizada

- [x] Fase A — fortalecer contrato de resultado de turno no `agent`.
  - [x] definir tipo detalhado e compatibilidade com retorno string;
  - [x] expor snapshot do collector;
  - [x] classificar tool-only, pending-human e vazio real;
  - [x] reavaliar hipótese de propriedade `metrics` duplicada;
  - [x] adicionar testes unitários do collector.
- [x] Fase B — transportar resultado detalhado pelo `channel`.
  - [x] remover drenagem implícita por `setImmediate()`;
  - [x] preservar origem e diagnóstico;
  - [x] testar espelho, vazio real e classificação semântica.
- [x] Fase C — materializar resultado detalhado no terminal.
  - [x] reconciliar fontes locais e resultado semântico;
  - [x] classificar mensagem humana de vazio;
  - [x] evitar falha BYOK em tool-only;
  - [x] preservar eventos técnicos.
- [x] Fase D — expandir metadados canônicos de tools.
  - [x] comandos;
  - [x] filtros;
  - [x] contagens;
  - [x] resumos;
  - [x] target kind;
  - [x] sanitização.
- [x] Fase E — enriquecer presenter, lifecycle, registry e turn trace.
  - [x] start;
  - [x] progress;
  - [x] complete;
  - [x] SSE;
  - [x] `/activity`;
  - [x] `/tools`;
  - [x] `/events`.
- [x] Fase F — projetar alvo operacional na linha viva.
  - [x] comando shell;
  - [x] listagem;
  - [x] busca;
  - [x] tool desconhecida;
  - [x] truncamento por largura.
- [ ] Fase G — consolidar narrativa de troca de modelo.
  - [ ] evento efetivo;
  - [ ] linha viva transitória;
  - [ ] histórico durável;
  - [ ] correlação model-gateway/SDK.
- [ ] Fase H — validar em lives reais.
  - [ ] turno com read;
  - [ ] turno com `exec_command`;
  - [ ] turno com `list_tools`;
  - [ ] turno com busca;
  - [ ] ask_user com resposta e síntese;
  - [ ] ask_user com continuação vazia;
  - [ ] tool-only sem síntese;
  - [ ] troca automática ou manual de modelo;
  - [ ] resposta tardia;
  - [ ] largura estreita no PTY.

### 12.73 Critérios de aceite

- [ ] Nenhum turno com resposta final tardia é acusado como vazio antes da janela de reconciliação.
- [ ] Vazio real continua visível e acionável.
- [ ] Continuação pós-pergunta vazia continua distinta de turno vazio comum.
- [ ] Turno tool-only é diagnosticado sem ser confundido automaticamente com falha de provider.
- [x] `exec_command` mostra comando seguro e compacto no start, linha viva e conclusão.
- [ ] `list_tools` mostra nome humano, filtro e contagem quando disponíveis.
- [ ] Tools de busca/listagem mostram alvo e resultado curto sem stdout bruto.
- [x] Linha viva comunica a ação atual sem IDs internos, sem multiline e sem ocupar o input.
- [ ] Troca efetiva de modelo é comunicada com precisão e sem confundir seleção preparada com
  sessão viva.
- [ ] Testes focados e lives PTY preservam legibilidade, correlação e ausência de regressões.

### 12.74 Implementação estrutural concluída em 2026-06-04

- [x] `createDialogTurnOutputCollector()` agora preserva diagnóstico observável do turno:
  - contagem de `assistant.message`;
  - caracteres de delta observados;
  - elegibilidade do delta;
  - contagem e sequência de sinais de tool;
  - tipo de protocolo pendente;
  - origem da resolução semântica.
- [x] `executeTurnImpl()` passou a produzir `DialogTurnSemanticResult`.
- [x] `DialogLoopManager.sendTurnDetailed()` é a capability detalhada canônica.
- [x] `DialogLoopManager.sendTurn()` continua retornando apenas string para compatibilidade.
- [x] O resultado detalhado atravessa barrels e façades:
  - `agent/facades/agent-dialog-runtime.js`;
  - `presentation/runtime/dialog.js`;
  - `runtime/index.js`;
  - `channel/client-dialog.js`;
  - `terminal/frontend/gateways/dialog.js`.
- [x] `channel/client-dialog.js` não usa mais um único `setImmediate()` como drenagem implícita.
- [x] O terminal distingue:
  - vazio real, que continua sendo erro operacional;
  - pergunta humana pendente, que é saída válida;
  - tool-only sem síntese, que é warning acionável e não degrada saúde BYOK;
  - transição de protocolo sem transcript, que é informativa.
- [x] `session.model_changed` efetivo virou fato durável no modo default:
  - mudança real imprime `modelo anterior → modelo novo`;
  - confirmação redundante permanece silenciosa sem verbose;
  - a atividade não fica presa na linha viva.
- [x] A fila strict encontrada em helpers do terminal também foi eliminada:
  - opções `exactOptionalPropertyTypes`;
  - rows wrapped;
  - comandos auxiliares;
  - registry de tools;
  - apresentação de recovery.

### 12.75 Primeiro live PTY da projeção semântica de tools — 2026-06-04

- [x] Cenário executado:
  - `long-tool-heartbeat`;
  - transporte PTY real;
  - BYOK real;
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-05-46-656Z/summary.md`.
- [x] O live confirmou que `exec_command` agora preserva e apresenta o comando seguro:
  - start durável com `Executar comando`;
  - `/activity` com alvo operacional;
  - `/tools diag` com linha `Alvo`;
  - `tool.lifecycle` SSE com `commands` e `primaryTargetKind=command`;
  - conclusão estruturada com sucesso e `exitCode=0`.
- [x] O live revelou um bug visual real:
  - o comando longo fez a linha viva ocupar duas linhas físicas;
  - a região reservada cresceu para duas linhas;
  - o input continuou tecnicamente preservado, mas a UX deixou de cumprir o contrato de pulso
    compacto e previsível.
- [x] Decisão arquitetural consolidada:
  - blocos transitórios genéricos podem usar a área reservada elástica;
  - a linha viva canônica deve ser estritamente uma linha física;
  - a projeção semântica deve calcular o orçamento restante antes de incluir o alvo;
  - uma barreira ANSI-aware deve impedir multiline e overflow mesmo quando um produtor futuro
    fornecer texto inesperadamente longo.
- [x] Implementação:
  - `formatTerminalLiveStatusLine()` aceita largura explícita para testes determinísticos;
  - largura real de `process.stdout.columns` é usada em produção;
  - o alvo de tool é compactado conforme o orçamento restante;
  - toda linha viva passa por truncamento ANSI-aware com reset e clear-to-end preservados.
- [x] O live também revelou falso negativo no runner:
  - lifecycle estruturado de `exec_command` estava correto;
  - o critério ainda reconhecia apenas badges legados como `[EXEC]` e `✅ [OK]`;
  - o runner passou a aceitar também as linhas humanas `Ferramenta` e `Concluído`.
- [x] Reexecutar `long-tool-heartbeat` e confirmar:
  - linha viva fisicamente única no PTY;
  - lifecycle sem falso negativo;
  - input permanentemente disponível;
  - nenhuma regressão no ask_user posterior.

### 12.76 Metadado contextual de shell e segunda rodada live — 2026-06-04

- [x] A primeira reexecução após o truncamento width-aware passou:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-12-10-531Z/summary.md`;
  - lifecycle humano de `exec_command` foi reconhecido pelo runner;
  - linha viva permaneceu em uma linha física;
  - ask_user posterior continuou dedicado e sem disputa com input.
- [x] A inspeção humana desse live revelou um bug de metadado:
  - `cwd` era classificado como `fileTarget`;
  - o diretório do workspace virava `path` da tool;
  - a formatação humana reduzia o workspace para `.`;
  - resumo do turno mostrava `Arquivos EXEC .`;
  - `/activity` mostrava arquivo de execução `.`;
  - `/tools diag` substituía o comando pelo alvo `.`.
- [x] Decisão arquitetural:
  - diretório de trabalho é contexto operacional, não arquivo afetado;
  - `cwd`, `directory`, `root` e equivalentes devem viver em `directoryTargets`;
  - apenas arquivos realmente afetados entram em `fileTargets`, `path`, contagem de arquivos e
    resumo de arquivos tocados;
  - para shell, o comando continua sendo o alvo primário e `primaryTargetKind=command`.
- [x] Implementação:
  - `introspectToolTargets()` separa `directoryTargets`;
  - `TerminalToolActivityPresentation` preserva diretórios contextuais;
  - `tool.lifecycle` publica `directoryTargets` sem poluir `fileTargets`;
  - projeção diagnóstica mantém o novo campo;
  - linha viva estreita remove o rótulo redundante de fase antes de omitir o alvo.
- [x] Terceira execução PTY confirmou o comportamento real:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-19-17-919Z/summary.md`;
  - linha viva:
    `LLM-B · Executar comando · node -e "setT… · 0s`;
  - resumo do turno:
    `Turno 1 ação`, sem arquivo fictício;
  - `/activity`: `Arquivos 0`;
  - `/tools diag`: alvo é o comando;
  - SSE: `path=null`, `fileTargets=[]`, `directoryTargets=[workspace]`,
    `primaryTargetKind=command`.
- [x] O terceiro live encontrou novo falso negativo do runner:
  - regex ampla alcançava JSON técnico contendo `LLM-B` e `modelo`;
  - o critério passou a inspecionar frames físicos delimitados por `\r`;
  - um frame de tool só é válido quando contém duração no mesmo frame e não carrega tail de
    modelo/runtime.
- [x] Reexecutar `long-tool-heartbeat` após o critério por frame e registrar PASS final:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-22-39-510Z/summary.md`;
  - status PASS;
  - `ux-tool-live-status-stays-single-line` passou;
  - `ux-command-cwd-not-file-target` passou.

### 12.77 Precedência de foco entre tool e watchdog de silêncio — 2026-06-04

- [x] O live PASS ainda revelou uma discrepância humana não coberta pelo runner:
  - `exec_command` estava em voo;
  - a linha viva começou corretamente com o comando;
  - antes do complete, o ticker do diálogo publicou `thinking/LLM-B trabalhando`;
  - a linha viva passou a mostrar `pensando · 11s sem resposta pública`;
  - o operador deixou de ver a atividade concreta ainda em execução.
- [x] Diagnóstico:
  - `recordTerminalActivity()` possui um foco operacional separado de `_currentActivity`;
  - eventos `system` já não substituem o foco de tool;
  - `thinking` é fase focalizável e substituía a tool;
  - o watchdog de silêncio é um sinal genérico de background, não uma atividade concreta;
  - qualquer conclusão sem `toolName` também podia limpar foco de tool por engano.
- [x] Decisão:
  - produtores devem declarar quando uma atividade é de foco `background`;
  - background pode refinar `boot`, `turn` ou `thinking` genéricos;
  - background não pode desalojar tool, streaming, pergunta, tarefa, compaction, subagente ou erro;
  - completions só limpam foco por identidade de tool, mesma fase, fluxo de turno compatível ou idle.
- [x] Implementação:
  - `recordTerminalActivity()` aceita `focusMode`;
  - ticker de silêncio do diálogo usa `focusMode=background`;
  - conclusão de tarefa não relacionada não limpa mais tool ativa;
  - testes cobrem preservação de tool, refinamento de turno genérico e completion não relacionada.
- [x] Runner live ganhou critério estruturado:
  - coleta IDs de start e completion por tool;
  - falha se um `terminal.activity` de `thinking` surgir entre esses eventos;
  - evita depender apenas da aparência final do stdout.
- [x] Reexecutar `long-tool-heartbeat` e confirmar que `exec_command` permanece foreground até o complete:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-28-19-696Z/summary.md`;
  - status PASS;
  - `scenario-tool-exec_command-focus-preserved` passou;
  - a linha viva permaneceu no comando durante os quatro segundos de execução;
  - `thinking` só assumiu o foco depois do complete, durante a espera legítima por resposta pública.

### 12.78 Recuperação canônica de turno vazio pré-ação — 2026-06-04

- [x] Live real `recoverable-tool-error` encontrou uma falha anterior ao cenário de erro:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-30-57-924Z/summary.md`;
  - status `BLOCKED`;
  - blocker `assistant-empty-turn`;
  - o provider/SDK consumiu tokens e emitiu `assistant.turn_end`;
  - não houve `assistant.message`, delta público, tool, pergunta humana ou protocolo pendente;
  - o terminal registrou corretamente `terminal.turn.empty_output`, mas encerrou o fluxo antes de
    testar a recuperação de tool.
- [x] Diagnóstico:
  - este é o Caso A da taxonomia de vazio real;
  - não é falso positivo de materialização tardia, pois a quiescência não encontrou mensagem
    posterior;
  - também não é tool-only, pois `toolSignalCount=0`;
  - como nenhuma tool/pergunta/transição ocorreu, uma única continuação automática é segura;
  - depois de qualquer tool ou pergunta, retry automático deixa de ser seguro por risco de duplicar
    efeitos ou atropelar o contrato do SDK.
- [x] Decisão arquitetural:
  - o terminal deve tratar vazio pré-ação como recuperável uma vez;
  - a recuperação pertence ao mesmo turno humano na camada visual/materialização;
  - o prompt de recuperação é curto, explícito e instrui a continuar a solicitação anterior sem
    narrar a recuperação;
  - o terminal emite `terminal.turn.empty_recovery` antes da segunda tentativa;
  - somente a segunda falha vazia degrada saúde BYOK e imprime `Turno vazio`.
- [x] Implementação:
  - `shouldAttemptPreActionEmptyTurnRecovery()` valida ator, ausência de requestHeaders, ausência
    de input humano, ausência de protocolo, zero tools, zero assistant messages e zero deltas;
  - `_executeTurn()` faz uma segunda chamada com `RECUPERAÇÃO AUTOMÁTICA DO TERMINAL`;
  - a materialização do terminal permanece aberta até a segunda chamada resolver;
  - `/events` ganhou label humano `Recuperação de turno` e resumo de tentativa/motivo;
  - os diagnósticos exportáveis incluem `emptyTurnRecovery`.
- [x] Testes de contrato adicionados/ajustados:
  - vazio pré-ação recuperado não degrada saúde BYOK;
  - vazio BYOK só vira falha operacional quando continua vazio após a recuperação;
  - `/events` renderiza a recuperação sem envelope cru.
- [x] Reexecutar `recoverable-tool-error` e confirmar que o cenário avança para tools reais, erro
      recuperável, segunda leitura, deltas públicos, `ask_user` e final pós-resposta:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-48-30-966Z/summary.md`;
  - status PASS;
  - `scenario-tool-exec_command-lifecycle` passou com `expected=failure`;
  - `scenario-tool-exec_command-focus-preserved` passou;
  - `scenario-recoverable-tool-error-observed` passou;
  - `ask_user`, resposta humana, export, SSE e `/health full` permaneceram coerentes;
  - neste run específico não houve vazio pré-ação, portanto `terminal.turn.empty_recovery` não foi
    necessário; o contrato permanece coberto por teste unitário e pelo blocker anterior.

### 12.79 Roundtrip de arquivos: prompt único e confirmação cruzada SDK/IO — 2026-06-04

- [x] Live real `file-write-roundtrip` executado com criação, movimento e exclusão reais:
  - artefato:
    `artifacts/terminal-live/2026-06-04T20-51-40-410Z/summary.md`;
  - status FAIL apenas em `no-prompt-double-render`;
  - critérios positivos: `create_file`, `move_file`, `delete_file`, ausência de prompt de permissão,
    `ask_user`, resposta final, export, SSE, `/errors`, `/health full` e fechamento limpo;
  - a autorização automática permaneceu funcional para escrita/movimento/exclusão.
- [x] Achado UX principal:
  - quando o modelo estava ocioso e uma intervenção era roteada como novo turno, a linha permanente
    `Intervenção · modelo ocioso; encaminhada como novo turno` redesenhava prompt idle antes de o
    novo turno entrar em estado ocupado;
  - em PTY estreito isso produzia `você›` vazio e, logo em seguida, o prompt vivo do turno, o que
    violava a regra de uma única superfície de input.
- [x] Correção aplicada:
  - o caminho `handleImmediateIntervention()` imprime a intervenção ociosa com
    `{ redrawPrompt: false }`;
  - `queueUserTurn()` passa a ser o único responsável pelo próximo prompt/linha viva.
- [x] Achado UX secundário:
  - `/activity` mostrava `Arquivo movimento ... ×2` para o mesmo caminho quando SDK e IO reportavam
    a mesma operação;
  - isso sugeria duas ações humanas, quando na prática era confirmação cruzada de observabilidade.
- [x] Correção aplicada:
  - `aggregateTurnTraceFiles()` mantém contagem acumulada apenas quando a origem é a mesma;
  - quando origens diferentes confirmam a mesma operação/caminho, a linha humana permanece única e
    o detalhe preserva a origem como `múltiplas origens`.
- [x] Correção fundacional adicional:
  - `recordTerminalTurnToolActivity()` deixou de contar `started` e `completed` da mesma
    `toolCallId` como duas operações de arquivo;
  - `recordTerminalTurnFileActivity()` ganhou `dedupeKey` opcional para que alvos extras do
    lifecycle também sejam deduplicados por chamada;
  - chamadas distintas ao mesmo arquivo continuam podendo renderizar `×2` quando isso representa
    repetição real.
- [x] Teste unitário de regressão:
  - `/activity` default não renderiza `×2` para confirmação cruzada SDK/IO do mesmo arquivo.
- [x] Reexecutar live `file-write-roundtrip` e confirmar `Status: PASS`, prompt único e `/activity`
      sem duplicidade artificial de arquivo:
  - artefato:
    `artifacts/terminal-live/2026-06-04T21-05-26-400Z/summary.md`;
  - status PASS;
  - `no-prompt-double-render` passou;
  - `create_file`, `move_file`, `delete_file`, `ask_user`, resposta humana, export, SSE,
    `/errors`, `/health full` e fechamento limpo passaram;
  - `/activity 40` mostrou arquivos sem `×2` falso para start/complete da mesma tool.
- [x] Achado UX pós-PASS:
  - o resumo compacto do turno selecionava os três primeiros arquivos únicos, então um roundtrip
    podia mostrar `CRIAR · MOVER · MOVER` e deixar `EXCLUIR` de fora;
  - isso é tecnicamente correto, mas comunica pior o fluxo canônico do operador.
- [x] Correção aplicada:
  - `selectTerminalTurnTraceSummaryFiles()` agora prioriza diversidade de operação antes de preencher
    detalhes laterais;
  - com limite curto, o resumo prefere `CRIAR`, `MOVER` e `EXCLUIR` a repetir dois lados do move.
- [x] Contrato live reforçado:
  - o runner ganhou `ux-turn-file-summary-operation-coverage`;
  - em cenários com `create_file`, `move_file` e `delete_file`, a linha compacta `Arquivos` deve
    cobrir `CRIAR`, `MOVER` e `EXCLUIR`.
- [x] Live de confirmação encontrou fricção canônica de autonomia antes de medir a nova linha:
  - artefato:
    `artifacts/terminal-live/2026-06-04T21-10-32-808Z/summary.md`;
  - status BLOCKED;
  - blocker `assistant-asked-before-required-deltas`;
  - a LLM-B invocou `ask_user` para confirmar caminho relativo/workspace antes de executar
    `create_file`, `move_file` e `delete_file`;
  - a UX da pergunta permaneceu limpa, mas o comportamento viola o contrato de autorização máxima
    do cenário.
- [x] Correção aplicada no harness:
  - o prompt do cenário `file-write-roundtrip` declara que caminhos relativos `data/...` são
    deliberados, relativos ao workspace atual e já autorizados pelo operador;
  - o cenário proíbe confirmação intermediária sobre caminho, workspace, permissão, criação,
    movimento ou exclusão.
- [x] Live pós-endurecimento removeu a pergunta intermediária e completou o fluxo real, mas revelou
      que o novo critério estava rígido demais:
  - artefato:
    `artifacts/terminal-live/2026-06-04T21-16-48-282Z/summary.md`;
  - status FAIL apenas em `ux-turn-file-summary-operation-coverage`;
  - `create_file`, `move_file`, `delete_file`, deltas, `ask_user`, resposta humana, final pós-ask,
    `/activity`, `/events`, `/errors`, `/health full` e export passaram;
  - o SDK repartiu `CRIAR`, `MOVER` e `EXCLUIR` em turnos separados, portanto a cobertura visual
    ficou distribuída em linhas compactas diferentes.
- [x] Correção do contrato live:
  - `ux-turn-file-summary-operation-coverage` agora aceita cobertura em uma única linha compacta ou
    distribuída em linhas `Ações`/`Arquivos` separadas;
  - o critério continua exigindo que `CRIAR`, `MOVER` e `EXCLUIR` estejam visíveis ao operador.
- [x] Live seguinte encontrou uma segunda variação de provedor:
  - artefato:
    `artifacts/terminal-live/2026-06-04T21-19-34-926Z/summary.md`;
  - status BLOCKED;
  - blocker `assistant-empty-turn`;
  - após `create_file` e `move_file`, a LLM-B encerrou um turno com tools executadas, sem síntese
    pública e sem `delete_file`;
  - o terminal foi corretamente conservador: depois de tools com efeito colateral, não é seguro
    repetir ou continuar automaticamente dentro do produto sem instrução explícita.
- [x] Correção aplicada no harness live:
  - o runner agora detecta cadeia incompleta de tools esperadas via lifecycle estruturado;
  - quando o terminal retorna ao prompt com `tools executadas; sem síntese pública`, o runner envia
    uma continuação explícita para executar apenas as tools faltantes;
  - isso mantém a segurança do produto e torna o teste live mais robusto contra divisão real de
    turnos pelo provider.
- [x] Reexecutar live dirigido para confirmar a cobertura visual do roundtrip completo:
  - artefato:
    `artifacts/terminal-live/2026-06-04T21-28-51-100Z/summary.md`;
  - status PASS;
  - `ux-turn-file-summary-operation-coverage` passou com cobertura distribuída em linhas compactas;
  - `CRIAR`, `MOVER` e `EXCLUIR` ficaram visíveis ao operador;
  - `no-prompt-double-render`, ausência de prompt SDK de permissão, foco de tool, `ask_user`,
    resposta humana, final pós-ask, export, SSE, `/errors`, `/health full` e fechamento limpo
    também passaram.
- [x] Decisão de UX consolidada:
  - a linha compacta ideal deve cobrir diversidade de operação quando o turno contém múltiplas
    ações de arquivo;
  - quando o provider reparte o roundtrip em turnos distintos, a obrigação visual migra para a
    cobertura distribuída em linhas `Ações`/`Arquivos` recentes, sem exigir uma linha artificial
    única que não corresponda ao envelope real do SDK.

### 12.80 Troca de modelo BYOK: intenção, adiamento e confirmação observada — 2026-06-04

- [x] Auditoria do fluxo atual:
  - `/byok model <id>` alterava a projeção local com `setTerminalModelProjection()` e imprimia
    `Modelo vivo · solicitado <id>`;
  - a confirmação real já existia em `session.model_changed`, que atualiza `lastPrInfo`, emite SSE
    e grava confirmação no SQLite do model-gateway;
  - o gap era a etapa intermediária: a solicitação/adiamento de troca não tinha unidade canônica,
    nem registro histórico consistente para `/activity`;
  - a automação `model-gateway auto` aplicava `set_live_model` por caminho próprio, repetindo a
    mesma semântica sem reaproveitar a UX do comando manual.
- [x] Decisão arquitetural:
  - “solicitação de troca” e “confirmação observada” são eventos diferentes;
  - a solicitação local não deve ocupar a linha viva permanente quando o modelo está ocioso, porque
    a linha viva é reservada para trabalho em andamento da LLM-B;
  - a solicitação deve entrar como histórico operacional (`/activity`) e stdout curto;
  - a confirmação canônica continua sendo `session.model_changed`/uso observado, não uma promessa
    feita pelo comando.
- [x] Correção aplicada:
  - criado `src/copilot/terminal/byok/live-model-switch.js`;
  - `requestTerminalLiveByokModelSwitch()` centraliza `setTerminalModelProjection()` e registra
    `Troca de modelo solicitada` com transição anterior → novo quando disponível;
  - `recordTerminalLiveByokModelSwitchDeferred()` registra `Troca de modelo adiada` quando a sessão
    viva não pode ser inspecionada ou cruza provedor/perfil;
  - `/byok model` passou a usar essa unidade e a imprimir `Confirmação · aguarde
    session.model_changed ou próximo uso observado`;
  - `applyTerminalByokGatewayAutoEffects()` passou a usar a mesma unidade para efeitos
    `set_live_model`.
- [x] Contrato de UX:
  - stdout humano mostra transição quando conhecida;
  - `/activity` registra solicitação/adiamento sem poluir a linha viva;
  - `session.model_changed` permanece como confirmação final observável em `/events`, SSE e SQLite;
  - auto-switch e comando manual compartilham o mesmo vocabulário.
- [x] Ciclo PTY dirigido executado:
  - artefato:
    `artifacts/terminal-live/byok-model-switch-ux-20260604-1844/summary.md`;
  - `/byok model terminal-ux-boundary-fixture` mostrou `Modelo vivo · solicitado kilo-auto/free →
    terminal-ux-boundary-fixture`;
  - o prompt exibiu `[MODEL?]` enquanto havia divergência configurado/observado;
  - após confirmação observada, `/byok` mostrou a transição do modelo e removeu o marcador de
    divergência no prompt.
- [x] Achado de precisão pós-ciclo:
  - `/byok` dizia `modelo BYOK já confirmado na sessão atual`, mas a própria tela ainda mostrava
    `Sessão viva ... modelo kilo-auto/free`;
  - tecnicamente o runtime havia confirmado o modelo preparado, enquanto o vínculo SDK de boot
    permanecia com o modelo original.
- [x] Correção de linguagem aplicada:
  - `live-model-confirmed` agora diz:
    `modelo preparado confirmado no runtime vivo; vínculo de boot original permanece até nova sessão`;
  - a ação sugerida passa a ser `/session sdk next new` apenas quando o operador quiser materializar
    a seleção preparada no vínculo de boot.
- [x] Ciclo PTY pós-correção:
  - artefato:
    `artifacts/terminal-live/byok-model-switch-ux-20260604-1846/summary.md`;
  - status PASS;
  - novo critério `ux-cycle-byok-model-switch-request-confirmation` passou;
  - evidência visual:
    `Modelo vivo · solicitado kilo-auto/free → terminal-ux-boundary-fixture`;
  - evidência visual:
    `Confirmação · aguarde session.model_changed ou próximo uso observado`;
  - evidência visual:
    `[MODEL?]` apareceu no prompt durante divergência transitória;
  - evidência visual:
    `modelo preparado confirmado no runtime vivo; vínculo de boot original permanece até nova sessão`
    apareceu em `/byok` e `/session sdk`.
- [x] Ciclo PTY reforçado com `/activity`:
  - artefato:
    `artifacts/terminal-live/byok-model-switch-ux-20260604-activity/summary.md`;
  - status PASS;
  - o comando `/activity 10` foi executado imediatamente após `/byok model
    terminal-ux-boundary-fixture`;
  - `ux-cycle-byok-model-switch-request-confirmation` agora valida:
    solicitação visual, prompt `[MODEL?]`, timeline `Troca de modelo solicitada`, cópia de
    confirmação runtime-vs-boot e ausência da frase antiga imprecisa.
- [x] Testar o fluxo com `/byok auto apply` em ciclo dirigido do terminal.
- [x] Adicionar critério live dedicado para troca de modelo:
  - solicitação aparece sem tomar o prompt;
  - `/activity` mostra `Troca de modelo solicitada`;
  - `session.model_changed`, quando emitido pelo SDK, aparece como confirmação;
  - divergência modelo configurado/efetivo aparece em `/usage`/prompt sem ids técnicos desnecessários.

### 12.81 Auto-probe BYOK: `apply`, ledgers humanos e sincronização do harness — 2026-06-04

- [x] Auditoria live do fluxo `/byok auto`:
  - execução observacional inicial:
    `artifacts/terminal-live/byok-auto-probe-ux-20260604-observe/summary.md`;
  - falhou porque o runner antigo disparava comandos por relógio e porque critérios exigiam
    alternativas mesmo quando o seletor real retornava 0/0;
  - a tela real mostrou empty states legítimos para perfil `kilo`, sem provider call.
- [x] Correção do runner:
  - `auto-probe` e `model-probe` migraram para sequência sincronizada por prompt;
  - entradas sincronizadas agora aceitam `waitBeforeMs`;
  - o auto-probe aguarda após o catálogo canônico longo antes de abrir o cockpit
    `operator-ready`, reduzindo eco de comandos colado na superfície anterior.
- [x] Correção de UX de `/byok auto apply`:
  - quando não há efeitos derivados, o terminal mostra:
    `Auto apply · nenhum efeito terminal derivado para aplicar`;
  - quando há efeitos pulados, o terminal usa linhas temáticas e próxima ação humana, sem frase
    solta `Auto apply: ...`;
  - quando há `set_live_model`, o mesmo vocabulário da troca manual é usado:
    solicitação, transição e confirmação por `session.model_changed`/próximo uso observado.
- [x] Correção dos ledgers automáticos:
  - ações e status técnicos passaram por `renderByokTokenLabel()`;
  - `manual_intervention` virou `intervenção manual`;
  - `effect_not_authorized` virou `aguardando autorização`;
  - `new_session_not_allowed` virou `nova sessão não autorizada`;
  - `model_mismatch` virou `modelo divergente`;
  - `rate-limit` virou `limite de taxa`;
  - registros persistidos continuam técnicos no SQLite, mas a superfície default do operador é
    humana.
- [x] Critérios live atualizados:
  - `auto-apply-visible` cobre efeito aplicado ou empty state claro;
  - `auto-proof-plan-visible` e `auto-standby-visible` aceitam comandos reais ou empty state 0/0;
  - `auto-recovery-fixture-visible` aceita a cópia atual em português e a linha de health;
  - `no-terminal-errors` passou a aceitar caixa baixa em `nenhum erro recente`.
- [x] Prova PTY aprovada:
  - artefato:
    `artifacts/terminal-live/byok-auto-probe-ux-20260604-human-ledgers/summary.md`;
  - status PASS;
  - 31 critérios passaram, incluindo `auto-apply-visible`, `auto-human-default-copy`,
    ledgers, SSE archive, ausência de erros e fechamento limpo.
- [x] Prova PTY pós-ajuste de espaçamento:
  - artefato:
    `artifacts/terminal-live/byok-auto-probe-ux-20260604-wait-before/summary.md`;
  - status PASS;
  - o cockpit `operator-ready` deixou de colar no eco do catálogo canônico longo.
- [x] Limpeza pós-PASS:
  - recovery fixture deixou de expor `ação manual_intervention`;
  - empty state de standby passou de `selector atual`/`prontidao` para `seletor atual`/`prontidão`;
  - linha `health:` do fixture virou `saúde:`;
  - detalhe de recovery passou a usar `pós-falha`.
- [x] Limpeza dos painéis `auto status` e `auto doctor`:
  - `model_unavailable`, `route_blocked`, `runtime_selector_route_missing`,
    `selected_route_missing`, `policy_disabled`, `no_effect_policy_enabled` e
    `automation_decision_blocked` passaram por tradução visual;
  - `target:` virou `alvo:`;
  - `set model vivo` virou `modelo vivo`;
  - cooldowns, bloqueios, classes e motivos de não ação agora usam a mesma função de rótulo
    humano dos ledgers.
- [ ] Próxima auditoria:
  - segmentar critérios de auto-probe por superfície em vez de procurar alguns termos no log
    inteiro;
  - criar fixture controlado para provar também o caminho `set_live_model` aplicado por
    `/byok auto apply`, sem depender de seleção real do catálogo atual.

### 12.82 Lifecycle conversacional: pergunta humana e intenção fora da estética de tool crua — 2026-06-04

- [x] Auditoria do ponto de entrada:
  - as screenshots ruins mostram `request_user_input ainda executando`, `report_intent`, `chatcmpl-tool-*`
    e blocos `[TOOL]`/`[INTENT]` competindo com a narrativa principal;
  - o código já possui `human-question-renderer`, `intent-renderer`, `tool-activity-presenter` e
    `live-status-line`, mas alguns eventos laterais ainda chegam pelo lifecycle genérico;
  - quando isso acontece, a superfície default pode chamar pergunta/intenção de “Tool” ou usar
    `requestId`/`toolCallId` como alvo visual;
  - raw/diag/export devem preservar envelope técnico, mas stdout padrão, `/activity`, `/live` e
    `/tools diag` devem ser humanos.
- [x] Decisão de UX:
  - `ask_user` e `request_user_input` são “Pergunta ao operador”, nunca tool comum;
  - `report_intent` e `report_intent_local` são “Intenção capturada”, nunca comando externo;
  - IDs como `chatcmpl-tool-*`, `toolu_*`, `call_*` e UUIDs são rastreio técnico e só pertencem a
    raw/all/export;
  - lifecycle pode continuar emitindo `tool.lifecycle`, mas a narrativa local deve usar fase
    `question` ou `turn` quando a semântica for pergunta/intenção;
  - a linha viva deve permanecer livre para trabalho em andamento e nunca ocupar input quando uma
    pergunta estruturada está pendente.
- [x] Correção aplicada:
  - introduzir helpers canônicos para detectar apresentação de pergunta/intenção no runtime de
    lifecycle;
  - ajustar `handleTerminalToolUserRequested()` para imprimir “Pergunta ao operador” quando a tool
    pedir ação humana, sem `Tool ... aguarda usuário`;
  - ajustar labels de start/progress/complete para `Pergunta concluída/falhou` e
    `Intenção capturada`, evitando `Tool concluída` para eventos conversacionais;
  - garantir que targets visuais default não caiam para `requestId` técnico;
  - reforçar testes unitários para lifecycle e presenter;
  - propagar `choices` e `allowFreeform` de `request_user_input` pelo `TerminalToolActivityPresentation`,
    para o card humano não perder opções estruturadas.
- [x] Validação focada:
  - `node --check` em presenter, lifecycle e testes alterados;
  - `npx vitest run tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js
    tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js
    tests/unit/copilot/terminal/test_human_question_renderer.spec.js
    tests/unit/copilot/terminal/test_live_status_line.spec.js`;
  - `npx eslint src/copilot/terminal/events/tool-activity-presenter.js
    src/copilot/terminal/events/tool-lifecycle-runtime.js
    tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js
    tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js`;
  - `git diff --check`.
- [ ] Próxima etapa:
  - atualizar critérios live para procurar resíduos por superfície e não apenas no log inteiro;
  - testar cenário live com `request_user_input`/`ask_user` e confirmar que o operador vê card humano,
    opções, timestamp e input livre sem heartbeat repetitivo.
- [x] Harness live:
  - `evaluateOutput()` ganhou `questionWaitSurface`, recortando a tela da pergunta até a resposta do
    operador antes dos diagnósticos raw;
  - novo critério `ux-question-wait-surface-human` valida card/prompt humano sem
    `request_user_input ainda executando`, `ask_user SDK`, `chatcmpl-tool-*`, `toolu_*`,
    `Tool solicitou`, `Tool concluída/falhou` ou `LLM-B ainda trabalhando` no trecho que o
    operador usa para responder;
  - isso reduz mistura entre superfície humana e `/events --raw`, mantendo raw/export intactos.
- [x] Live estruturado:
  - comando executado:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs
    --structured-input-cycle --transport=pty --timeout-ms=180000
    --out-dir=artifacts/terminal-live/structured-input-ux-20260604-lifecycle-question`;
  - status PASS;
  - evidência: card `Pergunta humana estruturada`, `Origem`, `Hora` ISO completo,
    `[PERGUNTA]`, opções `[1] SIM [2] NAO`, prompt `[PERG]`, resposta roteada e `/sdk waits`
    limpo após resposta;
  - busca no log confirmou ausência de `chatcmpl-tool`, `Tool solicitou`, `LLM-B ainda trabalhando`
    e `ask_user SDK` na superfície limpa.
- [x] Live canônico com LLM-B real:
  - comando executado:
    `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs
    --live-scenario=canonical --transport=pty --timeout-ms=240000
    --out-dir=artifacts/terminal-live/canonical-ux-20260604-question-lifecycle`;
  - status PASS;
  - evidência visual:
    `Intenção capturada`, `Ler arquivo`, bloco de deltas `DELTA-CANONICAL-*`, card
    `Pergunta ao operador`, ISO completo, opção `[1] SIM`, prompt `[PERG]`, confirmação
    `Resposta enviada para pergunta pendente` e resposta final pós-pergunta;
  - critérios relevantes aprovados:
    `ux-no-durable-waiting-spam`, `ux-question-live-status-does-not-compete-with-input`,
    `ux-question-wait-surface-human`, `ux-no-durable-tool-output-inside-question-prompt`,
    `ux-human-tool-names`, `ux-intent-command-default-human`, `ux-intent-command-detail-human-envelope`
    e `no-terminal-errors`.

### 12.83 Vocabulário humano em health/status/diagnose/metrics — 2026-06-04

- [x] Auditoria pós-live:
  - o terminal já passava os critérios canônicos, mas `/health full` ainda exibiu
    `Runtime alvo`, `Sessão runtime`, `Mapa runtime` e `Linha viva reservada`;
  - esses termos eram tecnicamente corretos, mas ruins para o operador humano e desalinhados com a
    meta de UX fluida.
- [x] Correção aplicada:
  - `/status full` passou a usar `Ambiente alvo`, `Sessão ambiente`, `Perfil ambiente` e
    `Mapa ambiente`;
  - aviso de fallback passou de `runtime solicitado ... usando runtime principal` para
    `ambiente solicitado ... usando ambiente principal`;
  - `/diagnose` passou a usar `Ambiente alvo`, `Sessão ambiente`, `Mapa ambiente`;
  - modo visual `reserved` passou a renderizar `acima do prompt`;
  - origem default da linha viva passou a renderizar `ambiente principal`;
  - `/metrics` passou a usar `Ambiente alvo`;
  - summary do runner live passou de `TTY inline/reserved status rendered` para
    `TTY status line rendered above the prompt`.
- [x] Contratos reforçados:
  - testes de sessão/diagnóstico/métricas agora exigem `Ambiente alvo`;
  - testes negam retorno de `Runtime alvo`, `runtime solicitado`, `reservada` e `reserved` nas
    superfícies humanas;
  - critério live de `/health full` rejeita `Runtime alvo` e `Linha viva reserved/reservada`.

### 12.84 Preset diário limpo e `full` como opt-in — 2026-06-04

- [x] Auditoria:
  - as screenshots mostravam o terminal iniciando em `TERMINAL_DISPLAY_PRESET=full`;
  - `full` ligava `thinking`, `usage`, `session`, `tools`, `intent` e `streaming`, deixando o caminho feliz
    parecido com diagnóstico permanente;
  - o rodapé de usage pós-turno explicava modelo/custo/tokens, mas era ruído quando o operador só queria
    uma conversa fluida;
  - os comandos canônicos `terminal:llm-b`, `terminal:llm-b:dev`, `dev:terminal` e o runner live forçavam
    `full`, então o default real não correspondia à UX ideal.
- [x] Decisão UX:
  - `default` é o modo diário elegante: streaming público, tools e intenção continuam visíveis;
  - `usage`, `session` e `thinking` deixam de aparecer por padrão e ficam disponíveis em `/usage now`,
    `/metrics`, `/status full`, `/display usage on`, `/display session on`, `/display thinking on`,
    `/display preset full` e `/display preset debug`;
  - `full` continua existindo como opt-in para auditoria e troubleshooting, sem ser o boot canônico.
- [x] Implementação:
  - `TERMINAL_DISPLAY_PRESET` agora cai para `default` quando não configurado;
  - preset inválido também cai para `default`, em vez de `full`;
  - script `terminal:llm-b`, `terminal:llm-b:dev` e `dev:terminal` iniciam em `default`;
  - runner live usa `TERMINAL_DISPLAY_PRESET` do ambiente quando presente e `default` quando ausente;
  - contrato unitário garante que `default` mantém `usage=false`, `session=false` e `thinking=false`.
- [ ] Próxima validação live:
  - rodar cenário canônico PTY com preset default e confirmar ausência de footer pós-turno verboso;
  - rodar cenário diagnóstico com `TERMINAL_DISPLAY_PRESET=full` explicitamente para confirmar que
    o modo rico continua acessível.

### 12.85 Prompt obsoleto cancelado ao receber nova linha — 2026-06-04

- [x] Evidência live:
  - live PTY em `artifacts/terminal-live/default-ux-20260604-display-default/summary.md` confirmou
    o preset `default` e ausência de footer de usage automático;
  - a mesma live falhou em `no-prompt-double-render`;
  - no `terminal.plain.log`, o prompt anterior aparecia vazio e, logo abaixo, outro prompt era pintado
    junto da linha viva do turno.
- [x] Diagnóstico:
  - prompts são coalescidos via `setImmediate`;
  - se uma linha nova chega antes desse `setImmediate`, o redraw agendado pertence ao estado anterior
    e não deve mais materializar;
  - o novo turno já vai assumir a tela com linha viva/prompt de espera, portanto manter o prompt antigo
    cria duplicação visual.
- [x] Correção:
  - adicionada primitiva `cancelScheduledTerminalPromptRedraw(rl)` no renderer do diálogo;
  - o lifecycle do REPL cancela redraw pendente no início de cada evento `line`;
  - teste unitário cobre o cancelamento do redraw obsoleto antes do próximo tick.
- [ ] Próxima validação live:
  - repetir o cenário canônico PTY em preset `default` e exigir `no-prompt-double-render`.

### 12.86 Recuperação automática pós-pergunta vazia — 2026-06-04

- [x] Evidência live:
  - live PTY em `artifacts/terminal-live/canonical-ux-20260604-display-default-prompt-fix/summary.md`
    confirmou `no-prompt-double-render` e o preset `default`;
  - o mesmo ciclo bloqueou porque, após o operador responder `SIM`, a LLM-B encerrou a continuação sem
    mensagem pública;
  - a UX atual mostrou uma placa `RECUPERAR` com `/turn Continue...`, ou seja, exigiu ação manual para
    um caso em que o operador já tinha respondido corretamente.
- [x] Decisão UX:
  - resposta humana aceita é um contrato forte: o terminal deve tentar preservar o fluxo conversacional
    sem pedir ao operador para repetir comandos;
  - a recuperação automática só é segura como uma continuação textual única, depois da pergunta humana,
    sem repetir o prompt original e sem reexecutar tools anteriores por conta própria;
  - a tentativa deve ser rastreável em SSE/activity e ter chave idempotente por `requestId`/turno/janela,
    para não criar loop infinito;
  - se a tentativa automática também falhar, a placa manual continua existindo como fallback explícito.
- [x] Implementação:
  - separar mensagem de retomada humana (`Continue...`) do comando visual (`/turn Continue...`);
  - adicionar política testável de tentativa única para `dialog.empty_after_user_input`;
  - enfileirar a continuação via `sendTurn()` depois do turno atual, sem disputar o mutex de envio;
  - emitir `dialog.empty_after_user_input.auto_recovery` antes da tentativa;
  - tratar retorno nulo da continuação automática como falha explícita em activity/SSE;
  - atualizar `/events` e summary quando necessário para diferenciar `tentando recuperar` de
    `recuperação manual necessária`.
- [x] Validação:
  - [x] teste unitário da política de idempotência;
  - [x] live PTY canônico com preset `default`, exigindo pergunta, resposta humana e ausência de
    duplicação visual;
  - [ ] live ou harness focado que force `dialog.empty_after_user_input` para exercitar a retomada
    automática sem depender de não determinismo do modelo.
- [x] Evidência:
  - `artifacts/terminal-live/canonical-ux-20260604-auto-recovery-default-rerun/summary.md`
    terminou PASS;
  - critérios relevantes verdes: `no-prompt-double-render`, `ux-question-wait-surface-human`,
    `ux-question-live-status-does-not-compete-with-input`, `post-ask-final-visible`,
    `sse-canonical-transcript-events`, `export-post-ask-final` e `no-terminal-errors`;
  - a recuperação automática não foi exercitada porque, nesta rodada, a LLM-B entregou o final
    pós-pergunta corretamente via `assistant.message`.

### 12.87 Vocabulário remanescente de runtime em comandos humanos — 2026-06-04

- [x] Achado live:
  - `/usage now` ainda renderizava `runtime, SDK e hub conectados`;
  - `/health full` ainda tinha cabeçalho `Agente · runtime · modelo · entrada`;
  - esses textos contradiziam a decisão já aplicada em `/status`, `/diagnose`, `/metrics` e linha viva:
    `runtimeId` é contrato interno; superfície humana usa `ambiente`.
- [x] Correção:
  - `/usage now` passou a dizer `ambiente, SDK e hub conectados`;
  - `/usage now detail` passou a dizer `ambiente <id> · SDK <id> · hub <id>`;
  - `/health full`/diagnóstico passou a usar `Agente · ambiente · modelo · entrada`;
  - notas de fallback passaram a falar em `ambiente principal`.
- [x] Validação:
  - testes focados de usage/diagnose passaram junto da bateria de wiring/eventos/display;
  - lint escopado dos arquivos tocados passou sem erros;
  - runner live ganhou critério `ux-human-runtime-vocabulary` para reprovar o vocabulário antigo
    antes dos diagnósticos raw;
  - live PTY em `artifacts/terminal-live/2026-06-04T22-50-51-354Z/summary.md` terminou PASS com
    `ux-human-runtime-vocabulary`, `/usage now` usando `ambiente, SDK e hub conectados` e
    `/health full` usando `Agente · ambiente · modelo · entrada`;
  - em próxima live, confirmar ausência de `runtime, SDK e hub conectados` e do cabeçalho antigo.

### 12.88 Runner live import-safe — 2026-06-04

- [x] Achado:
  - `node --input-type=module -e "await import('./scripts/.../model-gateway-terminal-llm-b-live-test.mjs')"`
    executava uma live real por causa de `await main()` no topo do módulo;
  - isso torna validação ESM perigosa, lenta e surpreendente, além de poder consumir chamada real sem
    intenção explícita do operador.
- [x] Correção:
  - runner passou a comparar `import.meta.url` com `pathToFileURL(process.argv[1])`;
  - execução direta continua chamando `main()`;
  - import dinâmico agora apenas carrega o módulo.
- [x] Validação:
  - import dinâmico retornou `import-ok` sem iniciar terminal;
  - `node --check`, `eslint` do runner e `git diff --check` passaram.

### 12.89 Higiene de vocabulário humano em superfícies detalhadas — 2026-06-04

- [x] Achado:
  - depois da troca principal de `/usage now` e `/health full`, ainda havia resíduos visuais em telas
    menos frequentes:
    - auto-brief detalhado exibia `Runtime`;
    - `/now full` exibia `Runtime default`;
    - `/live full` exibia `Runtime principal`;
    - `/answer --runtime alt` confirmava `runtime alt`;
    - `/sdk skills status/config/disable` usava `Runtime`, `Runtime off`,
      `disabledSkills runtime atualizadas` e `runtime/CLI`;
    - `/metrics detail` usava `Runtime` para resumir auto-início/recuperação da injeção.
- [x] Decisão UX:
  - `runtime` permanece nome interno, opção CLI (`--runtime`) e contrato de código;
  - superfícies humanas usam `Ambiente`, `ambiente <id>`, `sessão`, `Subagente` e `Retomada`;
  - rótulos devem comunicar função operacional, não classe interna.
- [x] Correção:
  - auto-brief detalhado passou a renderizar `Ambiente principal`;
  - `/now full` e `/live full` passaram a renderizar `Ambiente`;
  - resposta pendente no REPL e `/answer` passaram a dizer `ambiente <id>`;
  - `/sdk skills` passou a usar `Ambiente`, `Sessão off`, `Subagente` e
    `lista da sessão atualizada`;
  - `/metrics detail` passou a usar `Retomada` para auto-início/recuperação.
- [x] Validação:
  - [x] testes unitários focados de auto-brief, sessão, SDK e métricas;
  - [x] `node --check`/lint escopado dos arquivos alterados;
  - [x] live PTY `long-tool-heartbeat` passou `ux-human-runtime-vocabulary`.

### 12.90 Heartbeat de tool longa como pulso transitório — 2026-06-04

- [x] Achado:
  - screenshots antigas mostravam linhas repetidas de espera/progresso competindo com o prompt;
  - a auditoria local encontrou `agent-runtime-events.js` imprimindo heartbeat de tool longa no
    histórico e também escrevendo inline;
  - esse heartbeat é útil como pulso vivo, mas ruim como transcript durável porque acumula linhas
    quase idênticas.
- [x] Decisão UX:
  - tool start/progress/complete continuam eventos duráveis quando trazem mudança real;
  - heartbeat periódico fica transitório por padrão via linha viva;
  - `/activity` e `/events` continuam preservando o estado operacional;
  - operadores que queiram log durável de cada batimento podem ativar
    `COPILOT_TERMINAL_DURABLE_TOOL_HEARTBEAT=true`.
- [x] Correção:
  - heartbeat de tool longa passou a chamar `writeInlineStatus()` sempre que tool activity está
    visível;
  - `println()` do heartbeat ficou protegido pelo opt-in explícito;
  - testes agora cobrem default sem spam e opt-in durável.
- [x] Validação:
  - [x] testes unitários focados de `agent-runtime-events`;
  - [x] `node --check`/lint escopado;
  - [x] live PTY de tool longa confirmou ausência de spam durável.

### 12.91 Recuperação pós-tools sem síntese pública — 2026-06-04

- [x] Evidência live:
  - live PTY `artifacts/terminal-live/long-tool-ux-20260604-transient-heartbeat/summary.md`
    terminou `BLOCKED`;
  - a tool longa real executou e concluiu;
  - o heartbeat apareceu como linha viva transitória, sem cascata durável de `ainda trabalhando`;
  - depois das tools, a LLM-B encerrou o turno sem deltas públicos, sem mensagem final e sem
    `ask_user`;
  - o runner classificou como `blocked-by-assistant-empty-turn`.
- [x] Diagnóstico:
  - o engine já tinha recuperação para turno vazio antes de qualquer tool;
  - o caso live era semanticamente diferente: `tool_only` com tools reais concluídas, mas sem síntese
    pública;
  - a UX apenas avisava `tools executadas; a LLM-B não emitiu síntese pública`, exigindo ação manual.
- [x] Decisão UX:
  - `tool_only` sem resposta pública e sem pergunta humana deve tentar continuação segura uma vez;
  - a continuação não deve repetir tools já concluídas;
  - sucesso pode ser resposta pública ou pergunta humana real pendente;
  - se a continuação também falhar, o caminho de diagnóstico manual permanece.
- [x] Implementação:
  - adicionada política `shouldAttemptPostToolOnlyRecovery`;
  - adicionada mensagem de recuperação pós-tools que proíbe simulação textual de tools;
  - engine emite `terminal.turn.empty_recovery` com razão `post_tool_only_no_public_output`;
  - BYOK health não é degradado quando a recuperação pós-tools produz saída pública;
  - teste unitário cobre continuação única após `tool_only`.
- [x] Validação:
  - [x] testes unitários focados do dialog engine;
  - [x] `node --check`/lint escopado;
  - [x] live PTY `long-tool-heartbeat` avançou para delta, `ask_user`, resposta humana e final
    pós-pergunta.
  - [x] evidência: `artifacts/terminal-live/long-tool-ux-20260604-post-tool-recovery/summary.md`
    terminou PASS, com `ux-no-durable-waiting-spam`, `ux-human-runtime-vocabulary`,
    `scenario-tool-exec_command-lifecycle`, `ask-user-visible`, `post-ask-final-visible`,
    `export-post-ask-final` e `no-terminal-errors`.

### 12.92 `/tools diag` menos repetitivo e mais alinhado — 2026-06-04

- [x] Achado live:
  - `/tools diag` estava funcional, mas repetia `Classe ferramenta` para quase toda tool;
  - linhas `Alvo` do lifecycle usavam largura diferente da linha principal, parecendo desalinhadas em
    PTY;
  - o diagnóstico humano ficava com ar de dump técnico apesar de já ter bons nomes de tool.
- [x] Decisão UX:
  - tipo/classe só aparece quando acrescenta informação;
  - `tool` não precisa de linha própria em diagnóstico humano porque a própria seção já é de
    ferramentas;
  - detalhes de alvo seguem a mesma coluna visual das linhas de lifecycle.
- [x] Implementação:
  - `Classe` virou `Tipo`;
  - `Tipo ferramenta` é omitido no modo `diag`;
  - `Tipo` continua aparecendo para `file`, `io`, `terminal`, diagnóstico e no modo completo;
  - `Alvo` em lifecycle usa a mesma largura da linha de tool.
- [ ] Validação:
  - [x] teste focado de `/tools`;
  - [x] `node --check`/lint escopado;
  - [ ] próxima live deve confirmar `/tools diag` sem `Classe ferramenta` repetido.

### 12.93 Transições de modelo como narrativa operacional própria — 2026-06-04

- [x] Achado:
  - `session.model_changed` aparecia como linha genérica `Modelo`, sem distinguir confirmação do SDK,
    troca real, reconfirmação redundante ou origem;
  - `pr.fallback_model` dizia apenas `fallback aplicado: A -> B`, sem timestamp ISO completo nem
    resumo operacional no SSE;
  - `/byok model` e automação BYOK já falavam em solicitação/aguardo de confirmação, mas a confirmação
    posterior do SDK usava outra linguagem.
  - live control probe de `/model` mostrou outro ruído: `/model <id>` dizia `Modelo configurado`
    mesmo antes da confirmação do SDK, enquanto o prompt já mostrava `[MODEL?]`.
- [x] Decisão UX:
  - transição de modelo é um evento de estado de alto valor e deve ter vocabulário canônico:
    `confirmado`, `confirmado sem troca` e `fallback aplicado`;
  - tela, `/activity` e SSE devem compartilhar o mesmo resumo curto;
  - todo evento visível de transição deve carregar timestamp ISO 8601 completo;
  - `session.model_changed` continua sendo confirmação observada, não promessa de que a solicitação
    original foi aplicada com sucesso sem checar handoff/uso posterior.
- [x] Implementação:
  - criado `terminal/events/model-transition-presenter.js`;
  - `session.model_changed` passou a renderizar `Modelo SDK` com resumo canônico e
    `operatorSummary` no SSE;
  - reconfirmação sem troca continua silenciosa por padrão e aparece apenas com sessão verbose;
  - `pr.fallback_model` passou a renderizar `Fallback modelo` com origem, razão opcional e
    `operatorSummary` no SSE;
  - `/model <id>` passou a renderizar `Modelo solicitado`, usar seta única `→`, registrar a
    solicitação em `/activity` e manter a confirmação como etapa separada;
  - o live runner `--model-probe` passou a validar `Modelo solicitado` e `operatorSummary` canônico
    em `session.model_changed`;
  - contratos unitários foram atualizados para a linguagem humana atual de ferramenta aguardando
    operador (`Ferramenta aguarda operador`, operação `write`).
- [x] Validação:
  - [x] `node --check` dos listeners e presenter;
  - [x] testes focados de `sdk-session-events`, `agent-runtime-events` e `/model`;
  - [x] lint escopado dos arquivos tocados e runner live;
  - [x] live PTY control probe `--model-probe` confirmou `/model` como `Modelo solicitado`,
    `/activity` com solicitações auditáveis e SSE raw com `operatorSummary` ISO completo;
  - [x] evidência:
    `artifacts/terminal-live/model-probe-20260604-model-transition-ux-rerun/summary.md` terminou
    PASS com `model-change-sse-operator-summary`, `model-human-default-copy` e zero erros.
- [x] Lacuna seguinte:
  - resolvida na seção 12.94: `/events` passou a usar a semântica do `operatorSummary` e distinguir
    `Modelo confirmado` de `Modelo alterado`.

### 12.94 `/events` e avisos assíncronos de modelo sem ambiguidade visual — 2026-06-04

- [x] Achado live:
  - após `/model auto`, o SDK pode emitir `session.model_changed` com `auto -> auto`;
  - `/events` resumia esse caso como `Modelo alterado`, apesar do SSE já carregar
    `operatorSummary: confirmado sem troca`;
  - em PTY real, uma confirmação `Modelo SDK` podia aparecer colada no prompt quando chegava no mesmo
    instante em que o operador/runner digitava o próximo comando.
- [x] Decisão UX:
  - reconfirmação sem troca deve ser `Modelo confirmado`, não `Modelo alterado`;
  - quando `operatorSummary` existir, ele é a fonte humana preferida do detalhe;
  - avisos assíncronos de transição de modelo devem abrir sua própria linha antes do texto, para não
    ocupar a entrada viva.
- [x] Implementação:
  - `/events` passa a usar `operatorSummary` em `session.model_changed`;
  - `/events` escolhe `Modelo confirmado` quando o resumo diz `confirmado sem troca`;
  - `session.model_changed` e `pr.fallback_model` visíveis são impressos com quebra inicial para não
    grudar no prompt;
  - live runner `--model-probe` ganhou critério `model-events-summary-semantic`.
- [x] Validação:
  - [x] testes unitários focados de `/events`, `/model` e listeners de eventos;
  - [x] live PTY `artifacts/terminal-live/model-probe-20260604-model-events-semantic/summary.md`
    confirmou `Modelo SDK` em linha própria no plain log quando houve troca efetiva;
  - [x] live PTY `artifacts/terminal-live/model-probe-20260604-model-async-line/summary.md`
    confirmou `/events` com `Modelo confirmado` para no-op e critério
    `model-events-summary-semantic` verde.

### 12.95 Fronteira humana/técnica de tools e empty-turn recuperado — 2026-06-04

- [x] Achado:
  - a superfície default já humanizava `report_intent`, `request_user_input`, ids `chatcmpl-tool-*`
    e `toolu_*`, mas a atividade canônica ainda gravava `toolName` técnico em alguns eventos
    `terminal.activity`;
  - isso mantinha a UX dependente de cada comando lembrar de re-humanizar o payload depois;
  - a live `long-tool-heartbeat` mostrou que o terminal recuperava corretamente alguns
    `dialog.turn_end` vazios transitórios, mas o runner ainda classificava o primeiro empty-turn do
    mesmo `traceId` como bloqueio mesmo quando havia `assistant.message` pública posterior.
- [x] Decisão UX/contrato:
  - `tool.lifecycle` continua sendo o contrato técnico: preserva `toolName`, `rawToolName`,
    ids e correlação para diagnóstico;
  - `terminal.activity` é superfície operacional humana: `toolName` deve ser o nome que o operador
    vê, como `Intenção capturada`, `Pergunta ao operador`, `Executar comando` e `Ler arquivo`;
  - empty-turn vazio só é bloqueador live se permanecer sem recuperação pública posterior no mesmo
    `traceId` ou `turnId`;
  - eventos `dialog.turn_end` com `replySuppressed=true` e razão `already_materialized` continuam
    explicitamente não-bloqueadores.
- [x] Implementação:
  - `tool-lifecycle-runtime.js` passou a gravar `presentation.displayToolName` em
    `terminal.activity` para native tools;
  - reconciliação de tools pendentes no fim do turno trocou `Tool reconciliada` por
    `Ferramenta reconciliada` e detalhe humano `sem conclusão explícita`;
  - testes de lifecycle agora cobrem `ask_user`/`request_user_input` com `Pergunta ao operador` em
    activity humana e `report_intent` com `Intenção capturada` em activity, mantendo
    `report_intent_local`/`rawToolName=report_intent` no lifecycle técnico;
  - runner live passou a usar `findUnrecoveredTerminalEmptyOutputEvent` e
    `findUnrecoveredEmptyDialogTurnEnd`, ignorando empty-turns seguidos de `assistant.message`
    pública no mesmo turno/trace.
- [x] Validação:
  - [x] `node --check` do runtime de tools, teste e runner live;
  - [x] teste focado `tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js`;
  - [x] live PTY `artifacts/terminal-live/ux-tool-name-heartbeat-current-20260604/summary.md`
    reproduziu o falso bloqueio `assistant-empty-after-user-input` apesar de a resposta final estar
    em `assistant.message`;
  - [x] live PTY `artifacts/terminal-live/ux-tool-name-heartbeat-recovery-fixed-20260604/summary.md`
    terminou PASS com `ux-human-tool-names`, `ux-no-raw-tool-ids-in-default-tool-lines`,
    `ux-no-durable-waiting-spam`, `ux-question-live-status-does-not-compete-with-input`,
    `post-ask-final-visible`, `no-terminal-errors` e `sse-critical-events-sourced`.
- [ ] Lacunas remanescentes:
  - manter payloads raw visíveis somente em `/events --raw`, `/tools raw` e modos explicitamente
    detalhados;
  - continuar procurando surfaces que ainda aceitem nome técnico como rótulo humano primário;
  - próxima frente de alto retorno: revisar comandos de arquivo/mover/deletar e seleção automática de
    modelo em live, garantindo que toda transição e toda permissão apareça como evento humano claro.

### 12.96 Permissões autoaprovadas fora da superfície humana — 2026-06-04

- [x] Achado live:
  - no cenário de criação/move/delete de arquivo, o SDK emitia `permission.requested` e
    `permission.completed` mesmo quando o modo efetivo era `approve_all`;
  - a política aprovava corretamente, mas o terminal ainda renderizava linhas duráveis
    `Permissão ...` e `Acompanhar /permission list ...`;
  - para o operador, isso parecia uma segunda pergunta ou uma janela textual, contrariando o default
    canônico de máxima autonomia;
  - a auditoria/SSE precisava continuar preservada, porque permissões são eventos importantes para
    diagnóstico posterior.
- [x] Decisão UX:
  - em `approve_all` e `audit_only`, permissões SDK aprovadas automaticamente ficam fora da superfície
    visual default;
  - nesses modos, `permission.requested` e `permission.completed` continuam no SSE e no estado de
    permissões para `/permission`, `/events --raw`, auditoria e testes;
  - em `selective`, permissões continuam visíveis como pergunta operacional, com ajuda de comandos;
  - negações, políticas automáticas restritivas e resultados inseguros continuam podendo aparecer como
    alerta humano, mesmo fora de `selective`;
  - a linha viva não deve ser atualizada por permissão autoaprovada silenciosa, para não competir com
    o input.
- [x] Implementação:
  - `sdk-session-events.js` passou a consultar `readTerminalRuntimePermissionMode()` e
    `terminalPermissionModeSkipsSdkPrompts()`;
  - `onPermissionRequested` registra/broadcasta sempre, mas só grava atividade visual, imprime ajuda e
    refresca prompt quando o modo exige superfície seletiva;
  - `onPermissionCompleted` preserva SSE com `decision`, mas omite linha durável e activity de
    aprovação automática nos modos silenciosos;
  - teste unitário cobre o contrato `approve_all`: nenhum `println` com `Permissão`, nenhuma activity
    `Permissão SDK solicitada/aprovada`, nenhum refresh do prompt, mas SSE completo preservado;
  - teste existente de narrativa seletiva agora fixa `selective` explicitamente, protegendo os dois
    modos.
- [x] Validação:
  - [x] `node --check` nos arquivos alterados;
  - [x] `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js`;
  - [x] lint escopado de `sdk-session-events.js` e do teste;
  - [x] `git diff --check`.
- [x] Live:
  - repetir `file-write-roundtrip` em PTY;
  - confirmar que permissões autoaprovadas não poluem o log visual;
  - se ainda houver bloqueio por tool inesperada (`grep`, `search_in_files`) ou intenção stale, tratar
    como lacuna separada de roteamento/harness, não como falha de permissão.
  - evidência PASS:
    `artifacts/terminal-live/ux-file-roundtrip-question-tag-fixed-20260604/summary.md`.

### 12.97 `/errors` como falha ativa, não incidente BYOK recuperado — 2026-06-04

- [x] Achado live:
  - `file-write-roundtrip` concluiu create/move/delete reais, deltas públicos, `ask_user` real e final
    pós-resposta;
  - o critério `no-sdk-permission-prompt-in-approve-all` passou, confirmando que permissões
    autoaprovadas saíram da superfície visual;
  - o run ainda terminou FAIL porque `/errors 10` mostrava uma falha BYOK recuperável ocorrida antes
    das tools;
  - essa falha foi seguida por recuperação segura e resposta pública, portanto não representava
    terminal sujo ou falha ativa.
- [x] Decisão UX/observabilidade:
  - `/errors` deve representar falhas finais/fatais ou incidentes que ainda pedem ação direta;
  - erro recuperável de `model_call`, inclusive BYOK, continua em `agent.error`, activity, health e
    eventos brutos;
  - quando o dialog engine recupera o turno, o operador não deve ver “erro recente” como estado
    terminal;
  - falhas fatais de sessão e falhas não recuperáveis continuam indo ao error tracker.
- [x] Implementação:
  - `agent-runtime-events.js` deixou de chamar `trackOperatorVisibleTerminalError` para
    `model_call` recuperável;
  - o comentário do helper passou a documentar a diferença entre incidente recuperável e erro final;
  - testes unitários agora exigem que falha BYOK recuperável preserve painel/SSE sem sujar
    `defaultErrorTracker`;
  - expectativas antigas de activity humana foram atualizadas para nomes humanos (`Ler arquivo`,
    `Editar arquivo`) em vez de nomes técnicos.
- [x] Validação:
  - [x] `node --check` dos arquivos alterados;
  - [x] `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js`;
  - [x] lint escopado dos listeners e testes.
- [x] Live:
  - repetir `file-write-roundtrip` para confirmar PASS completo;
  - se o provider não produzir incidente recuperável nessa execução, manter a evidência anterior como
    reprodução e validar a limpeza por teste unitário;
  - se produzir, confirmar `/errors` com `nenhum erro recente` e `agent.error` ainda presente no SSE.
  - evidência PASS:
    `artifacts/terminal-live/ux-file-roundtrip-question-tag-fixed-20260604/summary.md`, com
    `no-terminal-errors` verde e `/errors 10` exibindo `0 total · 0 no buffer`.

### 12.98 Runner live alinhado ao prompt humano `[Q:n][PERG]` — 2026-06-04

- [x] Achado live:
  - a pergunta `ASK-FILEWRITE` apareceu corretamente como card humano e prompt dedicado;
  - o prompt real era `você[modelo/high][Q:1][PERG]›`;
  - o live runner só reconhecia `você[modelo/high][PERG]›`;
  - por isso, em turno de recuperação, o runner não respondeu `SIM` e o teste terminou
    `blocked-by-live-timeout`;
  - a falha era do harness, não da UX terminal, porque `user_input.requested` também apareceu no SSE.
- [x] Decisão:
  - tags intermediárias de estado, como `[Q:1]`, são parte válida da UX;
  - todo helper de reconhecimento de prompt humano deve aceitar uma sequência de tags antes de
    `[PERG]`;
  - o runner deve validar a UX real que o operador vê, não uma gramática antiga.
- [x] Implementação:
  - `hasHumanQuestionInputPrompt()` passou a aceitar `você[...][...][PERG]›`;
  - o critério `structured-input-prompt-tag` foi atualizado com a mesma gramática.
- [x] Validação:
  - [x] `node --check` do runner live;
  - [x] `git diff --check`.
- [x] Live:
  - repetir `file-write-roundtrip` e confirmar auto-answer em prompt `[Q:1][PERG]`;
  - se a LLM-B ordenar create/move/delete incorretamente, registrar como gap de aderência do modelo ao
    cenário, mas manter a UX mostrando falha/sucesso com clareza.
  - evidência PASS:
    `artifacts/terminal-live/ux-file-roundtrip-question-tag-fixed-20260604/summary.md`, com
    `ask-user-answer`, `post-ask-final-visible`, `no-sdk-permission-prompt-in-approve-all` e
    `clean-quit` verdes.

### 12.99 `/tools diag` sem repetição de tipo por item — 2026-06-04

- [x] Achado live:
  - `/tools diag` já removia `Classe ferramenta`, mas ainda imprimia várias linhas `Tipo I/O local`
    entre ferramentas de arquivo;
  - a seção `Categorias` já resume essa informação de maneira agregada;
  - a repetição enfraquecia a leitura visual e recriava o ruído que a seção 12.92 tentou remover.
- [x] Decisão UX:
  - `diag` é diagnóstico humano compacto: cada linha principal deve trazer nome, uso, bloqueios,
    falhas e latência;
  - categoria/tipo agregado aparece em `Categorias`;
  - tipo por item fica reservado ao modo profundo `/tools all`.
- [x] Implementação:
  - `cmdTools` passou a renderizar `Tipo` por item somente em `wantsDeepDiag`;
  - teste de `/tools diag` agora exige ausência de `Tipo` no diagnóstico humano, preservando os nomes
    humanos e a categoria agregada.
- [x] Validação:
  - [x] teste focado de `/tools`;
  - [x] lint/sintaxe escopados;
  - [ ] próxima live deve confirmar `/tools diag` sem linhas repetidas `Tipo I/O local`.

### 12.100 `/events` default sem “classe” técnica em erro recuperável — 2026-06-04

- [x] Achado:
  - `agent.error` recuperável já era humanizado, mas o resumo default ainda dizia
    `classe erro recuperável do modelo`;
  - “classe” comunica estrutura interna do payload, não estado operacional para o operador.
- [x] Decisão UX:
  - `/events` default deve dizer o que aconteceu e como foi tratado;
  - termos de schema como `class`, `handledAs` e nomes crus continuam restritos a raw/detail;
  - o default deve usar `tratado como erro recuperável do modelo`.
- [x] Implementação:
  - `summarizeAgentErrorPayload()` trocou `classe ...` por `tratado como ...`;
  - teste de `/events` protege a nova frase e bloqueia regressão para `classe erro recuperável do modelo`.
- [x] Validação:
  - [x] teste focado de `/events`;
  - [x] lint/sintaxe escopados.

### 12.101 `/permission show` e `/elicitation show` como cards humanos, não dumps — 2026-06-04

- [x] Achado:
  - `show` de permissões e formulários misturava operação humana com auditoria interna;
  - o título trazia IDs crus (`perm-*`, `el-*`, `chatcmpl-tool-*`) mesmo quando o operador só queria
    entender o estado atual;
  - `/permission show` sempre imprimia `data:` com payload completo, recriando a poluição visual que
    as lives recentes mostraram;
  - `Formulário SDK` ainda dizia `respondível pelo runtime`, termo técnico inadequado para a camada
    de UX.
- [x] Decisão UX:
  - `show` default deve ser card operacional: estado, tipo/modo, mensagem, idade, resultado humano e
    ação recomendada;
  - handles, request IDs, tool call IDs, schemas e payload bruto ficam atrás de `detail/raw/full`;
  - `latest` é o atalho humano preferido nos comandos sugeridos, para evitar cópia de IDs;
  - `all` continua sendo visão de auditoria/listagem histórica onde IDs podem aparecer para escolha
    explícita;
  - o termo “runtime” sai da superfície default, substituído por “sessão”.
- [x] Implementação:
  - `parseSdkShowArgs()` aceita `detail`, `raw`, `debug`, `full` e variantes `--*`;
  - `renderPermissionEntry()` passa a esconder `data:` e `requestId` por padrão;
  - `renderElicitationEntry()` passa a esconder schema/payload/handles por padrão;
  - estados, modos, fontes e resultados ganharam rótulos humanos em português;
  - comandos sugeridos usam `/permission respond latest ...` e `/elicitation respond latest ...`;
  - testes de `/permission` e `/elicitation` agora fixam a separação entre card limpo e detalhe bruto.
- [x] Validação:
  - [x] `node --check src/copilot/terminal/commands/sdk.js`;
  - [x] `node --check tests/unit/copilot/terminal/test_commands_sdk.spec.js`;
  - [x] `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js` com 40 testes verdes.
- [ ] Próximas verificações:
  - rodar live com pergunta/permissão/formulário real e conferir o plain log;
  - revisar `/sdk waits`, `/status`, `/activity` e linha viva para garantir que nenhum comando
    semelhante ainda trate payload interno como UI primária;
  - manter raw/detail auditável sem regressão para operador humano.

### 12.102 `/activity`, `/status full` e `/metrics` sem jargão inglês ou `phase:label` cru — 2026-06-04

- [x] Achado:
  - `/activity` default ainda chamava o caminho profundo de `Drill-down`, destoando do restante da UX
    em português;
  - `/status full` imprimia `Origem` como `${phase} · ${source}`, expondo `turn`, `tool`, `agent`,
    `terminal` e similares como linguagem primária;
  - `Atividade info` e `Atividade rec.` ainda deixavam detalhes livres e histórico recente com
    formato técnico (`phase:label`).
  - `/metrics` usava o rótulo `Label`, que descreve o schema interno e não a experiência do operador.
- [x] Decisão UX:
  - default e full continuam diferentes, mas ambos devem falar primeiro com o operador humano;
  - fases e fontes devem ser traduzidas para `pensando`, `respondendo`, `ferramenta`, `agente`,
    `diálogo`, `SDK`, `I/O real`;
  - a palavra `Detalhes` substitui `Drill-down` para manter uma gramática única;
  - histórico recente em `/status full` deve ser uma frase compacta, não uma tupla de estado.
- [x] Implementação:
  - `/activity` passou a usar `Detalhes` nos links para modo profundo;
  - `/activity detail` humaniza a origem com `renderSourceLabel()`;
  - `/status full` substituiu `Origem` por `Fluxo`, usando `renderLivePhaseLabel()` e
    `renderLiveSourceLabel()`;
  - `Atividade info` virou `Detalhe atividade`, com compactação/humanização;
  - `Atividade rec.` passou de `phase:label` para `fase · rótulo`.
  - `/metrics` trocou `Label` por `Evento`, traduziu fases `tool/turn/streaming/question` e humanizou
    detalhes de atividade como `display=full`, `status=success`, `choices=`.
- [x] Validação:
  - [x] `node --check` de `activity.js`, `session.js`, `metrics.js` e testes focados;
  - [x] `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`
    com 63 testes verdes.
- [ ] Próximas verificações:
  - confirmar em live que `/activity 10` não exibe `Drill-down`, tool IDs ou fontes cruas;
  - revisar `/diagnose` para a mesma fronteira default/detail;
  - fazer uma live curta de boot/status/activity após o próximo bloco de limpeza.
