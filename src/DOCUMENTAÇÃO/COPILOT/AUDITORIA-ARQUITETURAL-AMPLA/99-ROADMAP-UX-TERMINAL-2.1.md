# 99 — Roadmap UX Terminal 2.1

**Data:** 2026-05-01 **Escopo:** transformação contínua de `src/copilot/terminal`.

---

## W117 — Governança de risco do terminal root

**Objetivo:** levar `terminal/module-map.js` ao mesmo patamar de governança usado em
`server/routes`.

**Status:** iniciada e executável.

Subfaixas:

1. adicionar `risk` ao layout da raiz (**feito**);
2. adicionar `listTerminalModulesByRisk` (**feito**);
3. adicionar `buildTerminalModuleScorecard` (**feito**);
4. atualizar README com papéis e riscos (**feito**);
5. criar contratos para arquivos grandes (`>300 = hotspot`, `>220 = watch/hotspot`) (**feito**);
6. nomear hotspots atuais (**feito**).

Pronto quando: scorecard do terminal mostra hotspots reais e impede novos arquivos opacos.

---

## W118 — UX status/now/usage unificados

**Objetivo:** consolidar a narrativa de modelo configurado/cobrado, PR, fila e pergunta pendente.

Subfaixas:

1. extrair helper/projection comum para `lastPrInfo` (**feito:
   `normalizeTerminalModelBillingProjection`**);
2. alinhar `/status`, `/now`, pós-turno, `/usage` e `/metrics` (**feito no eixo de billing/modelo:
   todas as superfícies usam `normalizeTerminalModelBillingProjection`; o render textual ainda pode
   ser refinado por comando**);
3. criar testes para mismatch, ausência de usage e modelo coerente (**em andamento: coverage de
   projection/status expandida**);
4. documentar ação recomendada por estado (**pendente**).

Pronto quando: a mesma semântica aparece em todas as superfícies, sem duplicação de parsing.

---

## W119 — Display density policy

**Objetivo:** transformar `/display preset` em policy de UX, não lista local.

Subfaixas:

1. extrair presets para módulo próprio (**feito: `terminal/display-policy.js`**);
2. validar preset por contrato (**feito: policy exporta presets/toggles e teste dedicado cobre
   nomes**);
3. expor estado atual em `/display` (**feito: comando mostra preset atual derivado**);
4. alinhar waiting prompt com preset ativo (**feito para densidade `minimal`; prompts críticos
   preservados**);
5. testar minimal/focus/debug (**em andamento: minimal/debug cobertos, focus ainda pendente como
   contrato explícito**).

Pronto quando: sinais densos do prompt são governados por preset.

---

## W120 — Pending question replay e dedupe

**Objetivo:** estabilizar replay de pergunta pendente em reconexões/restarts do terminal.

Subfaixas:

1. formalizar quando `READY`/protocolo deve ser suprimido (**feito em
   `pending-question-replay.js`**);
2. criar memória local curta de último replay (**feito: TTL curto local ao listener**);
3. evitar reanúncio duplicado em rewire rápido (**feito para evento/replay idênticos dentro do
   TTL**);
4. testar snapshot legado sem kind explícito (**feito anteriormente e preservado**);
5. alinhar `/answer` e mensagem normal como resposta pendente (**feito para `ask_user` interativo:
   `terminal/pending-question-answer.js` evita deadlock da fila quando a resposta chega enquanto o
   turno original ainda aguarda; protocolo `READY` continua pelo fluxo normal de `sendTurn` para
   preservar streaming/reply**).

Pronto quando: operador nunca perde pergunta viva e nunca recebe spam em reconexão.

---

## W121 — Decomposição de `repl.js`

**Objetivo:** separar lifecycle readline de catálogo/dispatch/parsing.

Atualização recente:

- `repl.js` já opera como composition root fino, delegando bootstrap assíncrono do dialog loop para
  `launchTerminalDialogLoopBootstrap()` e o lifecycle readline para `repl-lifecycle.js`;
- `repl-command-router.js` concentra `CMD_ROUTES`/`dispatchCmd`, removendo o catálogo de comandos do
  root do REPL;
- ainda resta isolar o parsing de input humano/attachments/resposta pendente em seam explícita, hoje
  concentrada em `repl-lifecycle.js`.

Subfaixas:

1. `repl/banner.js` (**feito como `terminal/repl-banner.js`, sem shim temporário**);
2. `repl/command-router.js` (**feito como `terminal/repl-command-router.js`**);
3. `repl/input-parser.js` (**em andamento: comandos slash extraídos em
   `terminal/repl-command-parser.js`; input humano/attachments/resposta pendente ainda ficam no
   lifecycle**);
4. `repl/multiline.js` (**feito como `terminal/repl-multiline.js`, com reset explícito em
   `SIGINT`**);
5. `repl/lifecycle.js` (**feito como `terminal/repl-lifecycle.js`**);
6. remover shims e atualizar imports (**feito: `repl.js` delega para router/lifecycle e não mantém
   mais catálogo/lifecycle inline**).

Pronto quando: `repl.js` for composition fina e testes de comando continuarem estáveis.

---

## W122 — Decomposição de `frontend/llm-b-frontend.js`

**Objetivo:** separar projection families.

Atualização recente:

- histórico/contexto/export/status/metrics agora convergem pela family explícita
  `frontend/projections/timeline.js`, que reconcilia hub persistido + bridge vivo;
- `frontend/index.js` deixou de expor helpers crus do feed do bridge, preservando a timeline
  reconciliada como caminho público preferencial.
- `/status` passou a exibir `runtime profile`, preparando a UX do terminal para cenários futuros de
  multi-runtime/multi-agent sem reabrir deep-domain.

Subfaixas:

1. `frontend/projections/status.js` (**feito**);
2. `frontend/projections/now.js` (**feito**);
3. `frontend/projections/metrics.js` (**feito**);
4. `frontend/projections/usage.js` (**feito**);
5. `frontend/projections/config.js` (**feito**);
6. `frontend/projections/sdk-session.js` (**feito**);
7. `frontend/index.js` vira barrel/composition canônico (**feito**);
8. remover compat após migração (**feito: `llm-b-frontend.js` removido; testes e consumidores
   migrados para `index.js`/`projections/*.js`**).

Pronto quando: nenhuma projection family crítica fica escondida no mesmo arquivo gigante.

---

## W123 — Decomposição de `frontend/llm-b-runtime.js`

**Objetivo:** separar gateway runtime/hub/session/dialog.

Subfaixas:

1. gateway de agent runtime (**feito: `frontend/gateways/agent-runtime.js`**);
2. gateway de conversation hub (**feito: `frontend/gateways/hub.js`**);
3. gateway de SDK session binding (**feito: `frontend/gateways/sdk-session.js`**);
4. gateway de dialog loop (**feito: `frontend/gateways/dialog.js`**);
5. contratos anti-deep-domain para comandos/dialog (**feito: consumidores internos migrados para
   gateways; `llm-b-runtime.js` removido**).

Pronto quando: comandos e dialog consomem gateways sem conhecer topologia interna.

---

## W124 — Decomposição de `terminal/index.js`

**Objetivo:** tornar o composition root pequeno e transacional.

Atualização recente:

- `index.js` já opera como pipeline de fases (`init`, `aliases`, `runtime-config`, `pinned-context`,
  `conversation-hub`, `http-server`, `runtime-listeners`, `repl`);
- o hotspot anterior `terminal-phases/boot-listeners.js` foi fatiado em módulos menores para banner,
  reflection loop e shutdown handler, preservando a fase de runtime listeners como composition root
  fino.

Subfaixas:

1. mover banner standalone para módulo dedicado (**feito como `terminal-phases/boot-banner.js`**);
2. mover reflection loop para módulo dedicado (**feito como
   `terminal-phases/boot-reflection-loop.js`**);
3. mover pinned context bridge para `boot/pinned-context.js` (**feito semanticamente como
   `terminal-phases/boot-pinned.js`**);
4. mover conversation hub phase para `boot/conversation-hub-phase.js` (**feito semanticamente como
   `terminal-phases/boot-hub.js`**);
5. mover runtime listeners phase para `boot/runtime-listeners-phase.js` (**feito semanticamente como
   `terminal-phases/boot-listeners.js`**);
6. mover shutdown handlers para módulo dedicado (**feito como `terminal-phases/boot-shutdown.js`**);
7. manter `index.js` como pipeline de fases (**feito**).

Pronto quando: boot/shutdown continua observável e `index.js` perde responsabilidade operacional
detalhada.

---

## W125 — Event adapters UX

**Objetivo:** governar adapters densos.

Subfaixas:

1. fatiar `agent-runtime-events.js` por question/tool/subagent/session (**parcial: presenter puro
   `tool-activity-presenter.js` extraído para narrativa de tools/arquivos/comandos; adapter agora
   suporta REPL e headless sem depender de `readline`**);
2. fatiar `sdk-session-events.js` por streaming/mode/plan/usage/workspace (**parcial: elicitation,
   permission, external tool, MCP OAuth e pending messages agora têm narrativa local e SSE dedicado
   no adapter**);
3. fatiar `terminal-agent-wiring.js` por watchdog/SSE/recovery/listeners (**parcial:
   `event-adapters.js` virou composition root canônico para registrar adapters em REPL/headless**);
4. substituir fallback genérico por passthrough explícito e auditável.

Sugestões adicionais a partir da revisão atual:

- separar o fluxo de `tool.user_requested`/`permission.*` em adapter ou presenter dedicado, para
  reduzir o volume cognitivo remanescente em `sdk-session-events.js`;
- criar resumo por turno de arquivos tocados reaproveitando a narrativa já inferida por
  `tool-activity-presenter.js`, evitando novo parser paralelo em `/activity`;
- explicitar uma matriz “evento coberto por adapter” vs “evento em passthrough SSE” vs “evento
  ignorado no terminal” como artefato de contrato para impedir regressão silenciosa na expansão
  multi-runtime.

Checkpoint recente:

- `/activity` agora consome `turn-trace-state.js`, que reconcilia `assistant.turn_start/end`, tool
  lifecycle e `session.workspace_file_changed` em resumo por turno sem parser paralelo;
- `agent-runtime-events.js` e `sdk-session-events.js` passaram a alimentar esse resumo canônico,
  preparando o terreno para fatiar adapters sem perder contexto operacional ao vivo.
- `agent-sse-fallback.js` foi removido em favor de `agent-sse-passthrough.js`, reduzindo o fluxo
  residual do terminal a uma allowlist explícita de eventos raw ainda sem adapter dedicado.

Pronto quando: cada adapter tem owner e contrato visual claro.

---

## W126 — Interrupções SDK como primeira classe no terminal

**Objetivo:** eliminar eventos SDK “silenciosos” durante o loop de diálogo padrão.

Achado atual:

- `elicitation.pending` já existia como armazenamento local, mas estava acoplado ao wiring geral;
- `permission.requested/completed`, `tool.user_requested`, `external_tool.*`, `mcp.oauth.*` e
  `pending_messages.modified` tinham cobertura parcial em observabilidade, mas não viravam UX
  operacional consistente no terminal;
- `/status` e `/now` mostravam `ask_user`, mas não diferenciavam interrupções SDK estruturadas como
  elicitation/permissão.

Situação ideal:

- `event-adapters.js` é a via preferencial única para plugar UX live do terminal em `agent`/SDK;
- todo evento que exige atenção humana aparece com comando de próxima ação;
- interrupções estruturadas aparecem em `/status` e `/now`;
- wiring geral não contém semântica visual de elicitation/permissão;
- eventos sidechannel do SDK são propagados pelo agent quando necessário e sempre chegam à borda
  terminal como SSE/atividade.

Subfaixas:

1. mover semântica visual de elicitation para `sdk-session-events.js` (**feito**);
2. rastrear permissões SDK pendentes em `sdk-interactions.js` (**feito**);
3. exibir contadores de elicitation/permissão em `/status` e `/now` (**feito**);
4. propagar `external_tool.*` e `pending_messages.modified` nos handlers do agent (**feito**);
5. unificar registro de adapters entre REPL e headless (**feito via `event-adapters.js`; headless
   agora recebe também adapter de runtime/tools, não só SDK**);
6. adicionar comando dedicado `/permission` ou seção `/sdk interactions` para histórico e filtros
   (**feito: `/permission list|all|show|clear` cobre observabilidade local de permissões SDK**);
7. revisar eventos restantes do SDK vanilla (`session.skills_loaded`, `extensions_loaded`,
   `mcp_servers_loaded`, `commands.changed`) e decidir quais merecem narrativa live (**parcial:
   skills/extensions/MCP servers/background tasks/tools updated agora propagam e/ou aparecem como
   atividade/SSE; `commands.changed` ainda fica para triagem posterior**).

Pronto quando: durante um streaming dialog loop o operador entende claramente se a LLM-B está
respondendo, pedindo dados estruturados, aguardando permissão, chamando tool externa ou apenas
atualizando fila interna.

---

## W127 — Narrativa live de arquivos e tools

**Objetivo:** tornar o streaming de tools útil para operação real, sem despejar payload bruto.

Achado atual:

- `tool.execution_start/progress/partial/complete` imprimia apenas o nome da tool;
- caminhos de arquivos presentes em `args/path/filePath` eram invisíveis no terminal;
- SSE de tool não carregava operação/caminho normalizados.

Situação ideal:

- tools de leitura/escrita/patch/listagem mostram operação e alvo;
- partial output preserva linhas úteis, mas a atividade usa preview compacto;
- SSE inclui `operation` e `path` quando inferíveis;
- heurísticas ficam em presenter puro e testável, fora do listener.

Subfaixas:

1. criar `terminal/tool-activity-presenter.js` (**feito**);
2. enriquecer `agent-runtime-events.js` com operação/caminho em stdout/SSE (**feito**);
3. expandir heurística para shell commands que mencionam arquivos;
4. integrar arquivos tocados ao `/activity` com resumo por turno (**feito via `turn-trace-state.js`,
   ainda com espaço para enriquecer shell commands sem `path` explícito**);
5. estudar painel “turn trace” para listar read/write/edit por resposta.

Pronto quando: um operador consegue acompanhar ao vivo quais arquivos estão sendo lidos/editados sem
precisar abrir logs.

---

## W128 — `ask_user`, elicitation e `SessionUiApi` compatíveis com contrato SDK

**Objetivo:** alinhar a UX terminal ao contrato real de
`node_modules/@github/copilot-sdk/dist/types.d.ts`.

Atualização recente:

- a validação de conteúdo de elicitation deixou de ser detalhe local do comando do terminal e agora
  usa helper compartilhado em `core/elicitation-schema.js`;
- a mesma normalização/defaults passou a ser aplicada no resolvedor canônico da fila de elicitation
  (`hooks/elicitation.js`), reduzindo bypasss de callers alternativos;
- a rota compat `/api/copilot/elicitation/:id/respond` agora responde `400` quando o payload não
  respeita o schema pendente, em vez de encaminhar conteúdo inválido diretamente ao SDK.

Achado atual:

- `ask_user` retornava `wasFreeform=true` mesmo quando a resposta era uma das `choices` do SDK;
- respostas numéricas rápidas (`1`, `2`, `3`) eram exibidas no terminal, mas não eram normalizadas
  para a opção correspondente antes de resolver a Promise do SDK;
- perguntas `allowFreeform=false` podiam aceitar texto arbitrário pela borda terminal;
- `/elicitation input` imprimia a Promise em vez do valor de `session.ui.input`;
- `/elicitation respond ... accept` fazia cast amplo de JSON para `ElicitationResult.content` sem
  validar valores primitivos, required fields ou enum/oneOf simples do schema;
- eventos vanilla `user_input.requested/completed` do SDK estavam em observabilidade, mas não tinham
  adapter explícito no terminal.

Situação ideal:

- `ask_user` resolve sempre `{ answer, wasFreeform }` coerente com `choices` e `allowFreeform`;
- choice-only rejeita resposta livre e mantém a pergunta pendente;
- terminal aceita índice 1-based como atalho operacional, mas envia o valor textual ao SDK;
- `SessionUiApi.confirm/select/input/elicitation` é acessado por uma rota/comando canônico;
- elicitation valida o shape mínimo do SDK antes de chamar `handlePendingElicitation`;
- eventos `user_input.*`, `elicitation.*` e `permission.*` têm narrativa local, SSE e testes.

Subfaixas:

1. normalizar resposta de `ask_user` por choice, índice e freeform (**feito**);
2. bloquear resposta livre em `allowFreeform=false` na borda terminal e no resolver do agent
   (**feito**);
3. corrigir `/elicitation input` para aguardar `session.ui.input` (**feito**);
4. validar content de `/elicitation respond accept` contra contrato básico do SDK (**feito: valores
   primitivos/string[], required, tipos simples, enum e oneOf**);
5. propagar e adaptar `user_input.requested/completed` para atividade/SSE do terminal (**feito**);
6. ampliar validação de schema para arrays `items.enum/items.anyOf` e defaults (**feito via
   `core/elicitation-schema.js`, com cobertura em terminal + hooks**);
7. conectar essas mesmas regras às rotas HTTP de SDK UI, evitando divergência entre terminal e API
   (**parcial: helper compartilhado já cobre a rota compat `/api/copilot/elicitation/:id/respond)`;
   ainda vale estudar migração/sunset do caminho compat para uma superfície HTTP única do SDK**).

Pronto quando: a LLM-B pode pedir choice-only, formulário SDK ou input textual e o operador tem um
fluxo único, audível e validado para responder sem quebrar o contrato do SDK.

---

## Ordem de ataque imediata

1. W117 — scorecard/risk do terminal root;
2. W118 — status/now/usage unificados;
3. W119 — display density policy;
4. W120 — pending question replay/dedupe;
5. W121 — decompor `repl.js`;
6. W122/W123 — decompor frontend;
7. W124/W125 — boot e event adapters;
8. W126/W127 — interrupções SDK e narrativa live de arquivos/tools;
9. W128 — compatibilidade fina de `ask_user`, elicitation e `SessionUiApi`;
10. W122/W123 — decomposição das projections/gateways mantendo esses contratos novos.

---

## W129 — Convergência canônica cross-`src/copilot` (terminal como borda exemplar)

**Objetivo:** sincronizar a evolução do terminal com o plano global de convergência canônica de
`src/copilot`, evitando nova divergência entre UX local e arquiteturas compartilhadas.

Referências diretas:

- `100-MAPEAMENTO-COMPLETO-FLUXOS-SRC-COPILOT-2026-05.md`
- `101-MATRIZ-FLUXOS-CANONICOS-VS-PARALELOS-SRC-COPILOT.md`
- `102-SITUACAO-IDEAL-UNIFICADA-CANONICA-MULTIRUNTIME-MULTIAGENT.md`
- `103-PLANO-EXECUCAO-CONVERGENCIA-CANONICA-GERAL.md`

Subfaixas:

1. manter `#copilot/channel` isolado em `frontend/gateways/dialog.js`;
2. evitar bypass de composição nas bordas SDK/HTTP;
3. reduzir o passthrough SSE residual conforme adapters dedicados cobrirem novos eventos;
4. eliminar timeline dual (bridge history vs session history) nas projections de UX;
5. reforçar metadata de fallback runtime (`requestedRuntimeId`, `runtimeId`,
   `usedDefaultRuntimeFallback`) em todos os comandos críticos.

Checkpoint atual:

- timeline canônica extraída para `frontend/projections/timeline.js` (**feito**);
- `/history`, `/context`, `/export`, `/status`, `/now` e diagnose agora expõem origem/autoridade da
  timeline (**feito na primeira onda da E3**);
- `/db-history` corrigido para ler a cauda persistida em vez da cabeça histórica (**feito**);
- reconciliação bridge↔hub já detecta `aligned`, `bridge_tail` e `diverged` (**feito**);
- camada HTTP canônica consolidada em `server/routes/presentation-route.js`; o antigo
  `server/handler-bridge.js` foi removido (**feito**);
- boot compatível `src/copilot/agent.js` / `boot/compat-entrypoint.js` e o processo PM2
  `copilot-sdk-agent` foram removidos; `llm-b-terminal` é o único owner executável (**feito**);
- smoke test live do `/inject` revelou uma fronteira operacional residual fora da UX pura: o logger
  ainda assumia stdout/stderr vivos e podia derrubar o request path com `write EIO` em runtime
  destacado; a correção agora trata TTY quebrado como detalhe do sink, não como falha do fluxo
  canônico.
- ainda falta decidir se `bridge_tail` deve ser persistido eagerly, lazy ou somente por sync
  lifecycle (**pendente**).

Pronto quando: o terminal permanece borda fina, runtime-aware e 100% alinhada ao fluxo canônico
compartilhado de `src/copilot`.
