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
- `/sdk prompt` agora expõe o status canônico do system prompt modular + instruction sources da
  sessão SDK ativa, sem abrir parser paralelo fora de `config/system-prompt/status.js` e
  `presentation/runtime-sdk-session.js`.
- `/sdk prompt` agora também mostra `binding` e `freshness` do prompt persistido pela sessão SDK,
  transformando a diagnose de reload live/staleness em UX terminal canônica em vez de inspeção ad
  hoc em logs/estado bruto.
- `/status`, `/metrics`, `/health` e `/config` agora também promovem `systemPromptBinding` /
  `systemPromptFreshness`, e `/metrics` correlaciona o último `/inject` com digest/frescor do
  prompt; isso fecha a diagnose do ciclo live numa cadeia única
  `config -> runtime-overview -> adapters`, sem dashboards paralelos.
- rodada 2026-05-05: a auditoria profunda do `/inject` convergiu a policy de timeout de
  `presentation`/`terminal`/`channel` para `core/dialog-timeout-policy.js`, aceitou watchdog-only
  (`timeout=0/null`) fim a fim, anexou diagnósticos estruturados do turno
  (`preflight/context/attachments/dialog`, `autoStarted`, `recoveredInputChannel`) e passou a
  filtrar o último inject por `runtimeId` em `/metrics`, evitando troubleshooting cruzado entre
  runtimes.

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

Subfaixas:

1. manter `#copilot/channel` isolado em `frontend/gateways/dialog.js`;
2. evitar bypass de composição nas bordas SDK/HTTP;
3. reduzir o passthrough SSE residual conforme adapters dedicados cobrirem novos eventos;
4. eliminar timeline dual (bridge history vs session history) nas projections de UX;
5. reforçar metadata de fallback runtime (`requestedRuntimeId`, `runtimeId`,
   `usedDefaultRuntimeFallback`) em todos os comandos críticos.

Checkpoint atual:

timeline (**feito na primeira onda da E3**); projection canônica, com dedupe por assinatura,
metadata `terminal.timeline_sync` e exposição do

Observação transversal alinhada ao plano geral:

- a regra 2.1 de barrels puros (`index.js` apenas import/export + JSDoc/tipagem) passou a valer como
  guideline explícita fora do terminal também; a rodada de `config/system-prompt` serviu como
  referência concreta dessa migração, removendo lógica operacional do barrel e deslocando-a para
  builders/live-builders/registry. estado `scheduled/inflight/synced/failed` em `/status`, `/now`,
  `/history`, `/context` e `/export` (**feito na segunda onda da E3**);
- o sync lazy ganhou retry por turno, retentativa lifecycle pós-falha, TTL/limite de cache e
  telemetria exposta em `/metrics`, removendo o último resíduo operacional da E3 (**feito na
  terceira onda da E3**);
- camada HTTP canônica consolidada em `server/routes/presentation-route.js`; o antigo
  `server/handler-bridge.js` foi removido (**feito**);
- boot compatível `src/copilot/agent.js` / `boot/compat-entrypoint.js` e o processo PM2
  `copilot-sdk-agent` foram removidos; `llm-b-terminal` é o único owner executável (**feito**);
- o adapter `/sdk/*` agora falha estritamente com `AGENT_RUNTIME_NOT_FOUND` quando um `runtimeId`
  explícito é inválido, evitando que terminal/bordas administrativas operem sem querer sobre o
  runtime default errado (**feito fora do terminal, mas relevante para W129**);
- as rotas SDK auxiliares de leitura que ainda escapavam do projector canônico (`agent/tools`,
  `agent/telemetry`, `hooks/registry`, `observability/otel-status`, `events/catalog`,
  `events/dead-letter`) agora também falham com `AGENT_RUNTIME_NOT_FOUND` e metadata explícita,
  mantendo a UX terminal alinhada às bordas HTTP (**feito fora do terminal, mas relevante para
  W129**);
- a borda HTTP de webhooks agora também inclui metadata canônica de runtime ausente no erro
  `AGENT_RUNTIME_NOT_FOUND`, evitando uma exceção de payload em relação ao restante das superfícies
  operacionais (**feito fora do terminal, mas relevante para W129**);
- smoke test live do `/inject` revelou uma fronteira operacional residual fora da UX pura: o logger
  ainda assumia stdout/stderr vivos e podia derrubar o request path com `write EIO` em runtime
  destacado; a correção agora trata TTY quebrado como detalhe do sink, não como falha do fluxo
  canônico.
- decisão de persistência da cauda viva fechada como **lazy sync**: o terminal mantém leitura
  imediata do bridge, mas materializa a cauda no Hub sem bloquear a UX. O ciclo associado está
  completo: retry, backoff, TTL, cache bound, métrica e UX de falha estão implementados.
- a auditoria de latência do `/inject` deixou de depender apenas do histórico bruto: o último inject
  agora carrega outcome, timeout efetivo e correlação com digest/frescor do system prompt também em
  `/metrics`, reduzindo a necessidade de inspeção manual do estado interno para separar gargalo de
  runtime vs prompt stale.

Pronto quando: o terminal permanece borda fina, runtime-aware e 100% alinhada ao fluxo canônico
compartilhado de `src/copilot`.

---

## W130 — Hardening de streaming/output live (dialog)

**Objetivo:** eliminar glitches de render ao vivo no dialog loop (flicker/interleaving/prompt drift)
sem quebrar o contrato canônico de `terminal/dialog/*`.

Achado atual (rodada 2026-05-05):

- havia escrita fragmentada de chunks ao vivo durante reasoning/streaming, sujeita a interleaving;
- faltava guarda explícita entre redraw de prompt e blocos de streaming contínuo;
- alguns contratos de teste de `output.js` ficaram incompletos após introdução da policy de sessão
  (`getShowSessionActivity`).

Situação ideal:

- toda escrita de stream passa por helpers canônicos de `output.js`;
- redraw de prompt é suspenso enquanto blocos live estão ativos;
- indicadores inline de espera são úteis para operador (tempo/estratégia) sem corromper stream;
- contratos de teste cobrem lifecycle de lock e exports públicos do output.

Subfaixas:

1. centralizar escrita raw/prefixed em `output.js` (**feito**);
2. introduzir render lock explícito e usar no ciclo de streaming/reasoning (**feito**);
3. tornar `writeInlineStatus/clearInlineStatus` lock-aware para evitar corrupção de stream
   (**feito**);
4. adicionar ticker live de espera no `dialog/engine` com elapsed + timeout/strategy (**feito**);
5. corrigir mocks de contrato (`test_terminal_dialog_output.spec.js`) para incluir policy de sessão
   (**feito**);
6. ampliar testes de lifecycle do lock (`test_turn_display.spec.js`) e validar suíte terminal ampla
   (**feito: bateria `test_terminal_*.spec.js` + `terminal/test_*.spec.js` verde**).

Pronto quando: o dialog live preserva legibilidade sob streaming longo, mantém prompt estável e
continua compatível com os contratos canônicos da camada terminal.

---

## W131 — UX visual elegante/sóbria + semântica de tool/file/thinking

**Objetivo:** elevar a UX do terminal para um padrão “bonito, coerente e rápido” sem romper o
contrato TTY/headless e sem duplicar lógica fora das camadas canônicas.

Achados da auditoria geral (rodada 2026-05-05):

- havia boa cobertura funcional, mas a linguagem visual estava fragmentada (cores/ícones/textos
  distribuídos);
- faltava camada canônica de tema para garantir consistência entre prompt, palette, tools e
  perguntas pendentes;
- o terminal já expunha tool lifecycle e arquivo-alvo, porém com semântica visual irregular em
  diferentes renderizadores.

Implementado nesta faixa:

1. **Sistema de tema terminal canônico** (`ui-theme.js`) com perfis:

- `elegant` (padrão sóbrio),
- `vivid` (alto contraste),
- `mono` (sem cor / log-clean).

2. **Comando de ajuste em runtime**:

- `/display theme <elegant|vivid|mono>`
- status do tema exibido em `/display`.

3. **Menu inteligente** com paleta consistente:

- chips/actions/hot markers reaproveitando a camada de tema.

4. **Narrativa de runtime events refinada**:

- pending question com `QUESTION/OPTIONS/SELECT` claros,
- tools com badges semânticos (`TOOL`, operação READ/WRITE/EDIT/DELETE),
- melhor distinção visual de progresso/parciais/conclusão.

5. **Prompt e waiting prompt tematizados**:

- tags de estado preservadas (`ASK`, `SHADOW`, `MODEL mismatch`, `NOLOOP`, etc.),
- semântica visual centralizada e ajustável por tema.

Validação:

- bateria terminal ampla verde (`test_terminal_*.spec.js` + `terminal/test_*.spec.js`),
- cobertura dedicada para `/display theme` adicionada,
- lint/format limpos nos arquivos tocados.

Pronto quando: todas as superfícies críticas do terminal (prompt, waiting, menu, tools, questions,
thinking/streaming) permanecem semanticamente consistentes sob qualquer tema, com baixa fadiga
visual em sessões longas.

---

## W132 — UX live ajustável por nível de detalhe (`compact|detailed`)

**Objetivo:** tornar a UX do terminal adaptável ao contexto operacional sem abrir caminhos
paralelos: `detailed` para auditoria/diagnóstico e `compact` para sessões longas de diálogo ao vivo
com menor fadiga visual.

Diagnóstico da situação anterior:

- o terminal já tinha tema, prompt rico e narrativa elegante, mas ainda faltava uma alavanca
  canônica de densidade textual;
- waiting prompt, pending question e tool lifecycle seguiam semanticamente corretos, porém sempre em
  densidade relativamente alta;
- para sessões longas live, ainda havia espaço para uma UX mais enxuta sem perder rastreabilidade.

Situação ideal:

- `compact` reduz tags, hints e linhas secundárias ao mínimo útil;
- `detailed` preserva contexto completo para engenharia/auditoria;
- progressos de tools podem usar linha inline transitória em vez de empilhar narrativa longa quando
  o operador quer foco na conversa;
- a alternância entre modos é pública, explícita e canônica via comando do terminal.

Implementado nesta rodada:

1. **Preferência canônica de detalhe** (`ui-preferences.js`) com leitura por env e mutação em
   runtime;
2. **Comando público** `/display detail <compact|detailed>` integrado ao painel `/display`;
3. **Prompt do usuário** com tags sintetizadas no modo compacto (`[ASK]`, `[MM]`, `SHDW` curto, MODE
   curto etc.);
4. **Waiting prompt** reduzido no modo compacto, preservando modelo/reasoning e sinais essenciais;
5. **Pending question** com badges/choices mais curtos no modo compacto, mantendo pick numérico;
6. **Tool progress live** com `writeInlineStatus()` em `compact` e narrativa expandida em
   `detailed`.

Validação:

- testes dedicados adicionados para `/display detail`, `buildUserPrompt/buildWaitingPrompt` em modo
  compacto e progress inline em `agent-runtime-events`;
- suíte terminal ampla verde após a mudança (`55 passed | 1 skipped`).

Pronto quando: o operador consegue alternar entre uma UX densa e uma UX minimalista elegante sem
perder coerência semântica nem rastreabilidade ao vivo.

---

## W133 — Resumo pós-turno de tools/arquivos no fluxo canônico do SDK

**Objetivo:** fechar o ciclo de observabilidade live do terminal com um resumo elegante do que a
LLM-B realmente fez em cada turno, sem depender apenas da narrativa incremental durante a execução.

Diagnóstico da situação anterior:

- tools e arquivos já eram narrados ao vivo, mas a visão consolidada do turno exigia reconstrução
  mental pelo operador;
- o estado canônico do turno já existia em `turn-trace-state.js`, porém ainda não era promovido a
  uma superfície visual elegante no encerramento do turno;
- havia oportunidade clara de aumentar a legibilidade sem criar outro parser/estado paralelo.

Situação ideal:

- ao final do turno do assistente, o terminal exibe um resumo curto e confiável com contagem de
  tools e arquivos tocados;
- o resumo usa exclusivamente o snapshot retornado por `completeTerminalTurnTrace()`;
- `compact` e `detailed` controlam a densidade desse resumo, preservando a mesma semântica base.

Implementado nesta rodada:

1. `sdk-session-events.js` passou a capturar o snapshot retornado por
   `completeTerminalTurnTrace({ turnId })`;
2. foi criado um renderer local e canônico de resumo pós-turno com badges `TURN/TOOLS/FILES`;
3. o renderer usa `ui-preferences.js` para sintetizar ou expandir a densidade conforme o modo ativo;
4. a cobertura de `test_terminal_sdk_session_events.spec.js` agora valida a emissão do resumo com
   tool/file reais do turno.

Pronto quando: cada resposta da LLM-B pode ser acompanhada não só pelo texto gerado, mas também por
um fechamento claro do trabalho operacional realizado no turno.

---

## W134 — Unificação da observabilidade live de interrupções SDK (`ask_user`, `elicitation`, `permission`)

**Objetivo:** consolidar a UX live de interrupções SDK para que o operador veja o estado completo do
que está bloqueando ou aguardando input humano, sem precisar cruzar mentalmente múltiplas
superfícies.

Diagnóstico do fluxo anterior (como aparecia ao usuário):

- `elicitation` e `permission` já tinham estado local rastreável e comandos dedicados;
- `ask_user` do SDK era narrado em atividade/SSE, porém sem trilha canônica equivalente para resumo
  operacional em `/status`, `/now` e `/menu`;
- a command palette não priorizava explicitamente interrupções SDK pendentes (`elicitation`/
  `permission`/`ask_user`) como atalhos HOT;
- o snapshot curto (`/now`) e o status completo (`/status`) ainda não mostravam a foto unificada de
  todas as categorias de espera humana.

Situação ideal:

- uma única leitura operacional para interrupções SDK, com estado pendente + último tipo relevante;
- `/status` e `/now` mostrando o mesmo modelo mental do operador;
- `/menu` promovendo ações HOT para resolver pendências imediatamente;
- rastreabilidade canônica para `user_input.requested/completed` (não apenas impressão transitória).

Implementado nesta rodada:

1. `sdk-interactions.js` passou a rastrear `user_input` (`requested/completed`) com estado próprio
   (`pending/completed`) e resumo canônico (`readTerminalUserInputSummary`);
2. `sdk-session-events.js` agora persiste eventos `user_input` no estado canônico e mantém narrativa
   live do ASK para o operador;
3. `frontend/projections/status.js` foi ampliado com novos campos: `pendingUserInputs`,
   `latestUserInputKind`, `latestElicitationMode`;
4. `/status` e `/now` exibem interrupções SDK de forma unificada (`ELICIT`, `PERM`, `ASKSDK`) com
   ações sugeridas;
5. `/menu` recebeu atalhos HOT contextuais para `ask_user`, `elicitation` e `permission` pendentes;
6. `/sdk status` passou a refletir o mesmo resumo de waits da camada canônica.

Validação:

- testes focados verdes: `test_commands_menu.spec.js`, `test_commands_sdk.spec.js`,
  `test_terminal_sdk_session_events.spec.js`, `test_commands_session.spec.js`;
- suíte terminal ampla verde (`55 passed | 1 skipped`);
- lint, format e typecheck strict limpos após patch.

Pronto quando: o operador consegue identificar e agir sobre qualquer interrupção SDK em segundos,
usando `/now`, `/status` ou `/menu`, sem perder contexto da conversa live.
