# Terminal Copilot - Guia Canonico de Sessao, Comandos SDK e BYOK

Data: 2026-05-22
Autor: Codex
Escopo primario: `src/copilot`
Fonte anterior consolidada: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/TERMINAL-STREAMING-MODEL-RECOVERY-CODEX-2026-05-20.md`

## 1. Proposito

Este documento substitui o roadmap operacional disperso por um guia mais sobrio para a proxima fase do terminal LLM-B. O foco e manter um fluxo unico, observavel e auditavel para:

- sessoes SDK;
- sessoes do conversation hub;
- dialog loop e ask_user;
- comandos locais e comandos SDK;
- lifecycle events do SDK;
- `SessionUiApi`, elicitation e user input;
- BYOK universal e selecao inteligente de modelos;
- streaming, tools, deltas e materializacao no terminal.

O terminal nao deve mascarar falhas arquiteturais. A UX e parte do backend operacional: se ela duplica, omite ou rotula mal um evento, o operador fica cego e a arquitetura fica menos verificavel.

## 2. Contratos lidos no SDK local 0.3.0

Auditoria local feita contra:

- `node_modules/@github/copilot-sdk/dist/types.d.ts`
- `node_modules/@github/copilot-sdk/dist/session.d.ts`

Contratos confirmados:

- `CommandContext`: `{ sessionId, command, commandName, args }`
- `CommandHandler`: `(context: CommandContext) => Promise<void> | void`
- `CommandDefinition`: `{ name, description?, handler }`
- `SessionUiApi`: `elicitation`, `confirm`, `select`, `input`
- `UserInputRequest`: `question`, `choices?`, `allowFreeform?`
- `UserInputResponse`: `answer`, `wasFreeform`
- `UserInputHandler`
- `ElicitationSchemaField`, `ElicitationSchema`, `ElicitationFieldValue`, `ElicitationResult`, `ElicitationParams`, `ElicitationContext`, `ElicitationHandler`
- `SessionConfig` e `ResumeSessionConfig`: aceitam `commands`, `onUserInputRequest`, `onElicitationRequest`, `provider`, `model`, `reasoningEffort`, `modelCapabilities`, `streaming`, `includeSubAgentStreamingEvents`, `createSessionFsHandler`, `enableConfigDiscovery`, tools, hooks e outros campos de sessao.
- `SessionEventType`, `SessionEventPayload`, `TypedSessionEventHandler`, `SessionEventHandler`
- `ConnectionState`
- `SessionContext`, `SessionFsConfig`, `SessionListFilter`, `SessionMetadata`
- `SessionLifecycleEventType`, `SessionLifecycleEvent`, `SessionLifecycleHandler`, `TypedSessionLifecycleHandler`
- `ForegroundSessionInfo`
- `CopilotSession`: `send`, `sendAndWait`, `on`, `registerCommands`, `registerTools`, `registerElicitationHandler`, `registerUserInputHandler`, `registerPermissionHandler`, `getMessages`, `disconnect`, `abort`, `setModel`, `log`, `[Symbol.asyncDispose]`.

Contrato negativo tambem confirmado no pacote local:

- `session.keepAlive` e `session.updateMetadata` nao aparecem como APIs publicas no SDK local instalado. Devem continuar fora do roadmap de implementacao direta ate existirem no pacote real.

## 3. Situacao atual consolidada

### 3.1 O que ja esta solido

- Streaming assistant/tool/user input ja passa por trilhas normalizadas antes de chegar ao terminal.
- `broadcastSse()` e o ponto unico mais importante de fanout publico para terminal/SSE/JSONL.
- Deltas finais duplicados e algumas duplicacoes de ask_user foram reduzidas em rodadas anteriores.
- `usage` foi reclassificado: uso de LLM nao e automaticamente Premium Request; BYOK nunca deve ser narrado como Premium Request.
- BYOK ja possui perfis, catalogo, health, shortlist, recommend, admissao de modelo, safe default, testes reais no runner e cockpit de binding.
- `/session sdk` ja informa provider vivo, BYOK preparado e boundary de sessao.
- `/byok status`, `/byok use`, `/byok model`, `/byok recommend`, `/byok health` ja formam a base do cockpit do operador.

### 3.2 O que ainda esta ambiguo

- Comandos locais do terminal e `CommandDefinition` do SDK ainda nao nascem de uma fonte canonica unica.
- O SDK lifecycle ja e observado no boot do agent, mas o terminal ainda nao materializa esse canal com a mesma riqueza de tools, usage e question.
- `SessionUiApi` existe em comandos diagnosticos, mas ainda nao virou uma trilha canonicamente integrada de UX, teste e historico.
- `Elicitation` ainda precisa de teste live e trilha de materializacao comparavel a ask_user.
- A diferenca entre session SDK, hub session, dialog loop, turn e runtime ainda aparece dispersa na UX.
- A gestao de sessao pelo operador ainda e mais diagnostica do que operacional: faltam cockpit de nova sessao, trocar sessao, retomar sessao especifica, encerrar/desconectar e pre-sessao assistida.
- O catalogo BYOK ainda precisa calibrar tokens/limites por provider/modelo e expor filtros de gratuidade/capacidade de forma mais direta.

## 4. Arquitetura canonica TO-BE

### 4.1 Identidades

- SDK session: unidade real do SDK; contem modelo/provider, handlers, tools, commands e historico do SDK.
- Hub session: unidade local persistida para conversa, auditoria e retomada.
- Dialog loop: protocolo ask_user/READY que mantem uma conversa operacional dentro da sessao.
- Turn: uma interacao materializavel, com deltas, tools, usage, arquivos, perguntas, resultado e possivel erro.
- Runtime: processo local que orquestra boot, agent, terminal, HTTP, SSE, JSONL e estado.
- Provider binding: provider/modelo efetivamente ligados a sessao viva.
- BYOK prepared selection: provider/modelo escolhido pelo operador para proxima sessao ou tentativa de binding.

### 4.2 Regra de fanout

Todos os eventos publicos devem convergir para um envelope canonico antes de serem renderizados, exportados ou transmitidos:

1. SDK/local runtime event
2. Normalizacao e correlacao de turno/sessao
3. Materializacao em estado terminal
4. `broadcastSse()`
5. Render terminal, SSE, JSONL, export e diagnosticos

Nao deve haver emissores paralelos que renderizem a mesma mensagem final ou o mesmo delta final independentemente.

### 4.3 Comandos

Fonte ideal:

- Um catalogo canonico de comandos com metadados (`name`, aliases, categoria, descricao, permissao, escopo, handler local, elegibilidade SDK).
- O REPL local e os `CommandDefinition[]` do SDK derivam desse catalogo.
- O `handler` SDK nao deve reimplementar logica. Ele deve chamar o mesmo nucleo do comando local ou emitir uma solicitacao rastreavel para o runtime.

### 4.4 Sessao e lifecycle

Eventos SDK de lifecycle devem ser visiveis como eventos de primeira classe:

- `session.created`
- `session.deleted`
- `session.updated`
- `session.foreground`
- `session.background`

O operador deve conseguir ver a sessao viva, sessoes resumiveis, provider/modelo de cada uma, status de binding, origem do boot, erros e eventos recentes.

### 4.5 UI SDK, ask_user e elicitation

- `ask_user` e `onUserInputRequest` continuam sendo o caminho canonico do dialog loop.
- `SessionUiApi.input/select/confirm` deve aparecer como canal explicito de UI SDK, nao confundido com ask_user do dialog loop.
- Elicitation deve materializar schema, campos, resposta, cancelamento/decline e origem em um envelope canonico.
- Testes live devem cobrir delta parcial, delta final, tool, ask_user, resposta do operador, elicitation e pos-ask_user.

### 4.6 BYOK

- Um unico arquivo local seguro de perfis BYOK deve concentrar configuracao do operador.
- O terminal deve carregar perfis, catalogos, health e limites automaticamente.
- Operador deve conseguir listar providers, filtrar modelos por gratuidade/capacidade/risco, testar modelo em live fake, selecionar, trocar provider/modelo e voltar ao SDK sem corromper sessao.
- A troca de provider/modelo deve distinguir claramente:
  - selecao preparada;
  - binding vivo;
  - necessidade de nova sessao;
  - incompatibilidade com sessao atual.

## 5. Achados atuais

### BUG-SDK-LIFE-001 - Lifecycle SDK pouco visivel no terminal

`boot-wiring.js` observa lifecycle do `CopilotClient` e emite `sdk.lifecycle`, mas `terminal/events/agent-runtime-events.js` nao trata esse canal. Resultado: eventos importantes de criacao, delecao, foreground/background e update podem existir no runtime, mas nao entram na UX viva, SSE terminal e timeline do operador com semantica propria.

### GAP-CMD-001 - Comandos locais e SDK commands ainda sao duas arquiteturas

`SessionConfigBuilder.commands()` existe e os tipos SDK estao importados, mas os comandos do REPL vivem em roteadores locais sem uma fonte de metadados unica. Isso impede `/help` dinamico, `CommandDefinition[]` completo e telemetria uniforme.

### GAP-UI-001 - SessionUiApi existe, mas ainda e diagnostico

`SessionUiApi` aparece em comandos `/sdk`, mas a experiencia ainda nao e tratada como workflow de operador com timeline, artefatos e testes live completos.

### GAP-ELICIT-001 - Elicitation ainda nao tem circuito completo comparavel a ask_user

Schemas, respostas, cancelamentos e declinios precisam virar eventos materializados, testaveis e exportaveis.

### GAP-SESS-001 - Gestao de sessao ainda nao tem cockpit operacional completo

Faltam comandos e UX para escolher entre retomar anterior, criar nova, trocar sessao, desconectar, deletar, listar por filtros e entender riscos de provider/modelo por sessao.

### GAP-BYOK-001 - Catalogo ainda precisa de limites/capacidades melhores

O operador ja consegue selecionar e testar providers, mas precisa de filtros mais ricos: free/paid, contexto, vision, tools, JSON, reasoning, limites free, saude local e compatibilidade com fluxo terminal.

## 6. Roadmap

### Faixa A - Fechar BYOK como cockpit operacional

- A1. Persistir evidencia do ultimo live fake e live real por provider/modelo.
- A2. Calibrar estimativa de tokens por provider/modelo.
- A3. Expandir `/byok models` com filtros `free`, `vision`, `tools`, `reasoning`, `json`, `healthy`, `terminal-safe`.
- A4. Fazer `/byok recommend all-providers safe` considerar health por alias de provider/modelo.
- A5. Separar claramente modelo recomendado, modelo preparado e modelo vivo.
- A6. Adicionar resumo de limites conhecidos por provider/modelo quando disponivel.
- A7. Incluir Gemini 403 e NVIDIA ask_user como casos de diagnostico provider-specific.
- A8. Planejar Ollama local, LiteLLM e vLLM como providers locais.

### Faixa B - Sessao SDK e cockpit de operador

- B1. Materializar `sdk.lifecycle` no terminal com SSE, activity e JSONL.
- B2. Criar `/session events [n]` ou integrar lifecycle recente ao `/session sdk`.
- B3. Distinguir no prompt: SDK session, hub session, dialog loop, provider binding e prepared BYOK.
- B4. Implementar cockpit de nova sessao: criar nova, retomar anterior, selecionar antiga, deletar, desconectar.
- B5. Avaliar pre-sessao assistida no boot sem quebrar retomada padrao.
- B6. Expor `SessionListFilter` nos comandos de lista.
- B7. Expor `SessionMetadata` com provider/modelo/boundary quando possivel.
- B8. Garantir que troca de provider/modelo nao contamine sessao antiga sem aviso.

### Faixa C - Comandos SDK canonicos

- C1. Inventariar todos os comandos locais e classificar elegibilidade SDK.
- C2. Criar catalogo canonico de comandos.
- C3. Fazer `/help`, `/menu` e telemetria lerem o catalogo.
- C4. Gerar `CommandDefinition[]` a partir do catalogo.
- C5. Registrar os comandos elegiveis no `SessionConfigBuilder.commands()`.
- C6. Criar handlers SDK que chamem o mesmo nucleo local ou emitam evento canonico de comando.
- C7. Testar `CommandContext` com `sessionId`, `command`, `commandName`, `args`.
- C8. Evitar comandos destrutivos via SDK sem confirmacao.

### Faixa D - User input, ask_user, SessionUiApi e elicitation

- D1. Documentar diferenca entre ask_user do dialog loop e `SessionUiApi`.
- D2. Criar trilha canonica para `SessionUiApi.input/select/confirm`.
- D3. Materializar `ElicitationContext` e `ElicitationResult`.
- D4. Renderizar schemas com campos, required, enum, oneOf e defaults.
- D5. Persistir resposta/cancelamento/decline.
- D6. Criar testes live para ask_user + elicitation no mesmo turno.
- D7. Garantir ausencia de duplicacao entre pergunta pendente, mensagem final e delta final.

### Faixa E - Streaming, tools e materializacao

- E1. Manter `broadcastSse()` como fanout publico unico.
- E2. Auditar todos os renderizadores diretos que podem duplicar delta final.
- E3. Criar contrato de "assistant wrote" com delta parcial, delta final e message final.
- E4. Melhorar tool identity para external completions/progress.
- E5. Expandir JSONL canonico com turn/session/provider/command correlation.
- E6. Adicionar fake SDK end-to-end deterministico.

### Faixa F - Session FS, metadata e persistencia

- F1. Auditar `SessionFsConfig` e `createSessionFsHandler`.
- F2. Expor path/estado de sessao de forma segura.
- F3. Enriquecer metadata local com provider/modelo/boundary sem depender de API inexistente.
- F4. Paginar e filtrar sessoes antigas.
- F5. Validar delecao/desconexao sem perda acidental.

### Faixa G - Testes live e fake

- G1. Runner live padrao deve cobrir: delta parcial, delta final, tool, ask_user, resposta, usage, session cockpit e provider cockpit.
- G2. Runner BYOK deve cobrir pelo menos dois providers reais e troca de modelo dentro de provider.
- G3. Live fake deve testar chat sem contaminar a sessao canonica do operador.
- G4. Fake SDK deve reproduzir `SessionEventType`, lifecycle, commands, user input e elicitation.
- G5. Artefatos devem apontar claramente falha raiz, nao apenas "timeout".

### Faixa H - Documentacao operacional

- H1. Atualizar README do `src/copilot` com os conceitos de sessao.
- H2. Criar guia do operador para BYOK.
- H3. Criar guia do operador para sessoes.
- H4. Criar matriz de recursos SDK local: suportado, ausente, implementado, planejado.
- H5. Remover promessas de APIs nao existentes no pacote local.

## 7. Primeira fatia de implementacao

Prioridade imediata:

1. Tratar `sdk.lifecycle` no terminal como evento de primeira classe. **Concluido em 2026-05-22.**
2. Registrar lifecycle em activity/SSE sem poluir a resposta do assistente. **Concluido em 2026-05-22.**
3. Atualizar testes de `agent-runtime-events`. **Concluido em 2026-05-22.**
4. Atualizar este documento com a fatia concluida.
5. Em seguida, iniciar catalogo canonico de comandos SDK/local.

Implementacao inicial concluida:

- `src/copilot/terminal/events/agent-runtime-events.js` agora escuta `EMITTER_SDK_LIFECYCLE`.
- Eventos `session.created`, `session.deleted`, `session.foreground` e `session.background` entram em activity/SSE como eventos visiveis, respeitando o toggle de atividade de sessao.
- `session.updated` continua materializado, mas discreto, para nao poluir streaming e blocos de resposta.
- Metadados sensiveis de lifecycle sao redigidos antes de fanout.
- Teste focado: `node scripts/ci/run-vitest-copilot.mjs tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.

Segunda fatia concluida:

- `src/copilot/agent/session/commands/terminal-sdk-command-definitions.js` registra uma safelist inicial de
  `CommandDefinition[]`: `terminal_status`, `terminal_health`, `terminal_session`, `terminal_byok` e
  `terminal_events`.
- `buildSessionOptions()` injeta esses comandos no `SessionConfigBuilder.commands()`.
- Os handlers SDK nao duplicam o REPL: emitem `sdk.command.executed` com `CommandContext` normalizado.
- `src/copilot/terminal/events/agent-runtime-events.js` materializa `sdk.command.executed` em activity/SSE e respeita o
  toggle de atividade de sessao.
- `agent/session/module-map.js`, `agent/session/README.md` e `agent/session/commands/index.js` agora declaram o papel
  `commands` sem bypass cross-folder.
- `events/event-adapter-events.js` foi reclassificado como hotspot no module-map do terminal, alinhando governanca com
  tamanho real do arquivo.
- Teste focado: `node scripts/ci/run-vitest-copilot.mjs tests/unit/copilot/test_session_setup.spec.js tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`.

Proximo passo da Faixa C:

- Extrair um catalogo comum de metadados de comando para deixar `/help`, `/menu`, `CMD_ROUTES` e `CommandDefinition[]`
  derivados da mesma fonte.

Evidencia live apos as duas primeiras fatias:

- Runner: `artifacts/terminal-live/2026-05-22T00-36-22-750Z/summary.md`.
- Status: PASS.
- BYOK: `kilo-code` / `kilo-auto/free`.
- Validou deltas parciais, bloco final, `report_intent`, `read_file_content`, `ask_user` real, resposta `SIM`,
  mensagem pos-ask, usage sem Premium Request, `/tools diag`, `/events`, `/errors`, `/health`, export Markdown e
  ausencia de duplicacao obvia.
- O archive SSE mostrou `sdk.lifecycle` como evento publico materializado, com `session.updated` discreto.

Terceira fatia concluida:

- `/session sdk events [n]` agora resume `sdk.lifecycle` e `sdk.command.executed` diretamente a partir do archive SSE
  canonico, sem criar novo emissor.
- Eventos repetidos consecutivos, como rajadas de `session.updated`, sao colapsados na lente de operador, mas continuam
  integrais no JSONL bruto para auditoria.
- `/session sdk waits [n]` agrega `user_input.*`, `elicitation.*` e `permission.*` publicados no mesmo fanout canonico,
  criando uma visao operacional unica para ask_user, SessionUiApi/elicitation e permissoes.
- `/help` passou a expor a lente nova junto do cockpit de sessao.
- O runner live `scripts/copilot/run-terminal-llm-b-live-test.mjs --no-pr` agora executa e valida
  `/session sdk events` e `/session sdk waits`, para que a regressao seja visivel sem abrir turno LLM explicito.
- Teste focado: `node scripts/ci/run-vitest-copilot.mjs tests/unit/copilot/terminal/test_commands_session.spec.js`.
- Evidencia live no-PR: `artifacts/terminal-live/2026-05-22T00-49-31-572Z/summary.md` (PASS, BYOK kilo-code,
  zero turno explicito, criterios `sdk-session-events-cockpit-visible` e `sdk-session-waits-cockpit-visible` verdes).

Proximo passo da Faixa B/C:

- Usar a mesma lente de eventos para conectar `SessionUiApi`/elicitation e comandos SDK no cockpit, distinguindo
  claramente "arquivo bruto completo" de "visao operacional agregada".

Quarta fatia concluida:

- `CommandDefinition[]` ganhou os comandos seguros `terminal_session_events` e `terminal_session_waits`.
- `/session sdk commands` lista a safelist registrada no SDK, com comando local correspondente e explicacao de que a
  execucao observavel publica `sdk.command.executed` em vez de criar um REPL paralelo.
- O runner live no-PR passou a executar `/session sdk commands` e validar o criterio
  `sdk-session-command-catalog-visible`.
- Evidencia live no-PR: `artifacts/terminal-live/2026-05-22T00-52-07-706Z/summary.md` (PASS; criterios
  `sdk-session-command-catalog-visible`, `sdk-session-events-cockpit-visible` e
  `sdk-session-waits-cockpit-visible` verdes).

Quinta fatia concluida - Faixa F:

- Investigacao SDK local 0.3.0 confirmou que `SessionFsConfig` e `createSessionFsHandler` existem, mas
  `session.updateMetadata` continua ausente. A correcao, portanto, nao tenta escrever metadata no SDK; ela persiste
  metadata local redigida no estado do agent.
- `src/copilot/sdk/session/session-fs.js` agora expoe `describeConfiguredSessionFs()` e
  `readConfiguredSessionFsState()`, reaproveitando a configuracao canonica de boot e retornando paths seguros
  (`workspace:<relativo>` ou `external:<basename>`) com estado `exists/missing/unknown`.
- `src/copilot/agent/session/initializers/initializer.js` persiste `sdkSessionLocalMetadata` por `sessionId`, contendo
  modelo, reasoning, provider redigido e boundary/decisao de boot. O mapa e limitado para evitar crescimento indefinido.
- `src/copilot/presentation/runtime/sdk-session.js` enriquece o inventario de sessoes com `sessionFs` e metadata local,
  sem depender de API SDK inexistente e enriquecendo com I/O apenas a janela solicitada pelo terminal.
- `/session sdk` agora mostra Session FS, metadata local provider/modelo/boundary, filtros `cwd`, `gitRoot`, `repo`/
  `repository`, `branch`, e paginacao `offset=<n>`/`limit` numerico.
- A exclusao continua protegendo a sessao SDK viva; os novos metadados sao somente diagnosticos/operacionais e nao
  reabrem caminho paralelo de delete ou resume.
- Testes focados: `node scripts/ci/run-vitest-copilot.mjs tests/unit/copilot/sdk/test_sdk_session_fs.spec.js
  tests/unit/copilot/terminal/test_commands_session.spec.js`.
- Validadores executados nesta fatia: `npm run typecheck:strict:src.copilot` PASS; `npm run lint:copilot` PASS;
  testes focados PASS.
- `npm run test:copilot` completo foi executado e falhou em achados globais ja fora da Faixa F imediata. Uma violacao
  introduzida durante a fatia (`presentation/runtime/sdk-session.js` importando `#copilot/sdk/session`) foi corrigida,
  movendo o acesso a SessionFs para a facade do agent. O rerun focado de soberania deixou apenas o achado preexistente
  de `hooks/session-hooks.js`.

Sexta fatia correlata - MCP/OAuth/Cloudflare:

- A analise das telas reais do ChatGPT mostrou que o conector publico `https://mcp.aurelin.org/mcp` ja era descoberto,
  mas o issuer dev nao anunciava CIMD, o OIDC nao tinha `userinfo_endpoint` real e os escopos iniciais ficavam amplos
  demais.
- `src/copilot/mcp/control-plane/dev-oauth.js` passou a publicar `client_id_metadata_document_supported: true`,
  aceitar Client ID Metadata Documents HTTPS com validacao de metadata/redirect, expor `/oauth/userinfo` e emitir
  `id_token` quando `openid` for concedido.
- `src/copilot/mcp/control-plane/auth.js` passou a separar escopos suportados de escopos iniciais do protected resource
  metadata. A reducao temporaria do primeiro linking para `repo:read` e `repo:validate` foi revogada na nona fatia:
  o default canonico voltou a ser max-power.
- `src/copilot/mcp/adapters/http.js` passou a expor `MCP-Protocol-Version` em CORS e validar `Origin` quando presente,
  alinhando o transporte HTTP com a leitura MCP 2025-11-25 sem quebrar o modo stateless atual.
- `mcp_oauth_issuer_diagnostics` e o smoke OAuth agora reportam CIMD, userinfo/OIDC e escopos anunciados.
- Validadores focados desta fatia: `npm run typecheck:strict:src.copilot`, `npm run lint:copilot` e
  `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp --reporter=dot`.
- O `npm run test:copilot:unit` amplo foi reexecutado apos a estabilizacao da fatia e passou com 3084/3084.
- Publicacao operacional: `make copilot-mcp-restart`, `make copilot-mcp-status`, `make copilot-mcp-smoke` e
  `make copilot-mcp-oauth-smoke` passaram. A metadata publica em `https://mcp.aurelin.org` confirmou CIMD,
  `userinfo_endpoint` e, naquela fatia, escopos iniciais reduzidos; essa decisao foi substituida pela nona fatia.

Setima fatia correlata - prova operacional CIMD:

- O issuer dev passou a servir `/.well-known/oauth-client/codex-smoke.json` para smoke CIMD com `client_id` HTTPS
  autoconsistente.
- `copilot:mcp:oauth:smoke` agora valida DCR e CIMD. O fluxo CIMD confirma `id_token` e `/oauth/userinfo`.
- `copilot:mcp:cloudflare:smoke` agora falha se OAuth metadata, CIMD, userinfo ou escopos iniciais regredirem.
- `.env.example`, `.env.local.example` e `.env.schema.json` cobrem `COPILOT_MCP_OAUTH_INITIAL_SCOPES` e
  `COPILOT_MCP_ALLOWED_ORIGINS`.
- Validacao desta continuidade: typecheck strict Copilot, lint Copilot, 85 testes MCP, 3084 testes Copilot,
  env audit/validate/check, `make copilot-mcp-restart`, `make copilot-mcp-status`, `make copilot-mcp-smoke` e
  `make copilot-mcp-oauth-smoke`.

Oitava fatia correlata - diagnostico MCP CIMD:

- `mcp_oauth_issuer_diagnostics` passou a validar tambem o documento CIMD quando o issuer e o proprio resource MCP.
- A readiness do diagnostico agora inclui falhas no client metadata document quando ele deveria existir.
- Validacao: typecheck strict Copilot, lint Copilot e 85 testes MCP.

Nona fatia correlata - correcao max-power ChatGPT:

- A direcao de reduzir `scopes_supported` inicial para `repo:read`/`repo:validate` foi reclassificada como desalinhada
  do objetivo canonico deste repo. Para o conector ChatGPT, o default deve maximizar liberdade e autonomia sobre o
  workspace/repo.
- `COPILOT_MCP_OAUTH_INITIAL_SCOPES`, o protected resource metadata, o smoke OAuth, o smoke Cloudflare e o preview de
  `WWW-Authenticate` agora usam por default `repo:read`, `repo:write`, `repo:validate` e `repo:admin`.
- DCR e CIMD devem provar tokens max-power; CIMD continua somando `openid profile email` para OIDC.
- Os exemplos e o schema de ambiente documentam max-power como default, preservando override explicito apenas para
  operacao excepcional.
- Validacao desta correcao: typecheck strict Copilot, lint Copilot, 85 testes MCP, 3084 testes Copilot unit,
  env audit/validate/check, `make copilot-mcp-restart`, `make copilot-mcp-status`, `make copilot-mcp-smoke` e
  `make copilot-mcp-oauth-smoke`.
- Evidencia publica apos restart: protected resource metadata anuncia os quatro escopos repo; DCR emitiu
  `repo:read repo:write repo:validate repo:admin`; CIMD emitiu
  `repo:read repo:write repo:validate repo:admin openid profile email`, com `id_token` e `/oauth/userinfo` verdes.
