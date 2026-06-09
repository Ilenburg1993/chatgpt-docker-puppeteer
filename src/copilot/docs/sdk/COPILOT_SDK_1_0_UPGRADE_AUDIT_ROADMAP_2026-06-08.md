# Copilot SDK 1.0 Upgrade Audit And Roadmap

Data: 2026-06-08

Escopo primário: `src/copilot`

Escopo crítico imediato: `src/copilot/sdk`, `src/copilot/config`, `src/copilot/agent`, `src/copilot/hooks`,
`src/copilot/terminal`, `src/copilot/server/routes/sdk`, `tests/unit/copilot`

Pacote auditado: `@github/copilot-sdk@1.0.0`

Estado de entrada: o operador atualizou `@github/copilot-sdk` de `0.3.0` para `1.0.0` no `package.json` e no
`package-lock.json`. O código local ainda contém contratos da série `0.3.x` que agora são campos mortos, aliases
renomeados ou superfícies incompletas.

Este documento passa a guiar a migração técnica da camada SDK 1.0 dentro de `src/copilot`. Ele não substitui os roadmaps
de terminal e model-gateway, mas cria uma faixa fundacional nova: antes de polir UX e runtime selector em profundidade,
a wrapper local precisa falar o contrato correto do SDK 1.0.

---

## Fontes Lidas

- [x] `node_modules/@github/copilot-sdk/package.json`
- [x] `node_modules/@github/copilot-sdk/README.md`
- [x] `node_modules/@github/copilot-sdk/docs/examples.md`
- [x] `node_modules/@github/copilot-sdk/docs/agent-author.md`
- [x] `node_modules/@github/copilot-sdk/docs/extensions.md`
- [x] `node_modules/@github/copilot-sdk/dist/index.d.ts`
- [x] `node_modules/@github/copilot-sdk/dist/client.d.ts`
- [x] `node_modules/@github/copilot-sdk/dist/session.d.ts`
- [x] `node_modules/@github/copilot-sdk/dist/types.d.ts`
- [x] `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`
- [x] `/tmp/copilot-sdk-compare-46694/package` como snapshot de `@github/copilot-sdk@0.3.0`
- [x] `npm view @github/copilot-sdk@1.0.0`
- [x] `npm view @github/copilot-sdk@0.3.0`
- [x] GitHub Docs: Getting Started com SDK
- [x] GitHub Docs: Backend services
- [x] GitHub Docs: Multi-tenancy and server deployments
- [x] GitHub Docs: BYOK
- [x] GitHub repository README `github/copilot-sdk`
- [x] `src/copilot/sdk/session/client-options.js`
- [x] `src/copilot/sdk/session/lifecycle.js`
- [x] `src/copilot/sdk/session/runtime.js`
- [x] `src/copilot/sdk/session/system-message.js`
- [x] `src/copilot/sdk/session/events.js`
- [x] `src/copilot/sdk/session/session-events.js`
- [x] `src/copilot/sdk/session/session-fs.js`
- [x] `src/copilot/sdk/constants.js`
- [x] `src/copilot/sdk/types.js`
- [x] `src/copilot/config/session-config.js`
- [x] `src/copilot/config/resume-session-config.js`
- [x] `src/copilot/config/sdk-config-port.js`
- [x] `src/copilot/hooks/factory.js`
- [x] `src/copilot/hooks/types.js`
- [x] `src/copilot/sdk/tools/core.js`
- [x] `src/copilot/tools/infra/tool-factory.js`
- [x] `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
- [x] `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`
- [x] Nova passada 2026-06-08: `npm view @github/copilot-sdk version dist-tags --json`
- [x] Nova passada 2026-06-08: `node_modules/@github/copilot-sdk/dist/types.d.ts`
- [x] Nova passada 2026-06-08: `node_modules/@github/copilot-sdk/dist/index.d.ts`
- [x] Nova passada 2026-06-08: `node_modules/@github/copilot-sdk/dist/toolSet.d.ts`
- [x] Nova passada 2026-06-08: `src/copilot/config/session-config.js`
- [x] Nova passada 2026-06-08: `src/copilot/config/resume-session-config.js`
- [x] Nova passada 2026-06-08: `src/copilot/sdk/tools/core.js`
- [x] Nova passada 2026-06-08: `src/copilot/sdk/tools/index.js`
- [x] Nova passada 2026-06-08: `src/copilot/sdk/index.js`
- [x] Nova passada 2026-06-08: `src/copilot/sdk/types.js`
- [x] Nova passada 2026-06-08: `src/copilot/terminal/events/agent-runtime-events.js` e diff local existente
- [x] Nova passada 2026-06-08: `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
- [x] Nova passada 2026-06-08: `tests/unit/copilot/sdk/test_sdk_tools.spec.js`
- [x] Nova passada 2026-06-08: `scripts/model-gateway/run.mjs liveReadiness --json`
- [x] Nova passada 2026-06-08: `scripts/model-gateway/run.mjs livePlan --json`
- [x] Nova passada 2026-06-08: `scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`
- [x] Nova passada 2026-06-08: `scripts/model-gateway/run.mjs llmBLiveTest --byok-probe --byok-fixture --no-pr --timeout-ms=240000`

---

## Evidências Oficiais Relevantes

- [x] A documentação oficial de Getting Started usa `new CopilotClient()` e `session.sendAndWait({ prompt })` como fluxo
  mínimo, e confirma Node.js 20+ para o SDK TypeScript.
- [x] A documentação oficial de Backend Services mostra `import { CopilotClient, RuntimeConnection }` e conexão externa
  por `connection: RuntimeConnection.forUri("localhost:4321")`, não por `cliUrl`.
- [x] A documentação oficial de Multi-tenancy afirma que runtimes externos devem usar `RuntimeConnection.forUri(url)`.
- [x] A documentação oficial de Multi-tenancy afirma que `gitHubToken` por sessão deve ser usado para content exclusion,
  model routing, quota checks e acesso Copilot específico de usuário.
- [x] A documentação oficial de Backend Services recomenda `mode: "empty"` em servidores multiusuário, junto de
  `availableTools`.
- [x] A documentação oficial de BYOK confirma providers `openai`, `azure` e `anthropic`, endpoints OpenAI-compatible,
  Ollama como `type: "openai"`, `wireApi: "completions" | "responses"`, e exigência de `model` quando `provider` é
  custom.
- [x] O README oficial do repositório confirma que o SDK usa JSON-RPC contra o runtime Copilot CLI, que Node/Python/.NET
  incluem runtime automaticamente, e que BYOK pode dispensar autenticação GitHub.

---

## Situação Atual

- [x] O pacote `@github/copilot-sdk` foi atualizado para `^1.0.0`.
- [x] O SDK instalado depende de `@github/copilot@^1.0.57`.
- [x] O SDK 1.0 exporta `RuntimeConnection`, `ToolSet`, `BuiltInTools`, `Canvas`, `createCanvas`,
  `SYSTEM_MESSAGE_SECTIONS`, `UiInputOptions` e todos os eventos gerados.
- [x] A wrapper local ainda preserva diversos nomes da API 0.3 como aliases de borda, mas agora traduz os principais
  aliases antes da fronteira vendor.
- [x] A suite de testes de builder foi atualizada para validar a superfície oficial 1.0.
- [x] O terminal e a observabilidade dependem de taxonomia de eventos que agora está testada contra os
  108 tipos da 1.0.
- [x] O código tem aliases históricos úteis para compat interna, mas alguns aliases estão sendo enviados diretamente ao
  SDK e, portanto, provavelmente são ignorados.
- [x] Há alterações de lockfile amplas além do SDK. Elas precisam ser tratadas como estado de entrada do operador, não
  revertidas.

---

## Mudanças De Contrato Confirmadas

### Client Options

- [x] `CopilotClientOptions.connection` substitui o conjunto antigo de transporte.
- [x] `RuntimeConnection.forStdio({ path, args })` representa spawn stdio.
- [x] `RuntimeConnection.forTcp({ port, connectionToken, path, args })` representa spawn TCP.
- [x] `RuntimeConnection.forUri(url, { connectionToken })` representa runtime externo já iniciado.
- [x] `workingDirectory` substitui o antigo uso local de `cwd` para diretório do runtime.
- [x] `baseDirectory` substitui configuração indireta via `COPILOT_HOME` quando o SDK spawna runtime.
- [x] `mode: "empty" | "copilot-cli"` controla defaults de ambiente e segurança.
- [x] `enableRemoteSessions` entra como novo knob client-level.
- [x] `cliUrl`, `cliPath`, `cliArgs`, `port`, `useStdio`, `isChildProcess`, `autoStart` e `autoRestart` não pertencem
  ao contrato público atual de `CopilotClientOptions`.

### Session Config

- [x] `configDirectory` substitui `configDir`.
- [x] `createSessionFsProvider` substitui `createSessionFsHandler`.
- [x] `suppressResumeEvent` substitui o alias local `disableResume`.
- [x] `continuePendingWork` entra no contrato oficial de resume.
- [x] `openCanvases` entra no contrato oficial de resume.
- [x] `reasoningSummary` e `contextTier` entram ao lado de `reasoningEffort`.
- [x] `largeOutput` entra para controle de outputs grandes de tools.
- [x] `enableSessionTelemetry` entra como controle por sessão, com BYOK sempre desabilitando telemetria de sessão.
- [x] `mcpOAuthTokenStorage` entra como escolha `"persistent" | "in-memory"`.
- [x] `skipEmbeddingRetrieval` e `embeddingCacheStorage` entram como knobs importantes de isolamento.
- [x] `pluginDirectories` e `instructionDirectories` entram no contrato.
- [x] `enableFileHooks`, `enableHostGitOperations`, `enableSessionStore`, `enableSkills` entram como knobs de host.
- [x] `enableMcpApps`, `requestCanvasRenderer`, `requestExtensions`, `canvases` entram como opt-ins de superfície UI.

### System Message

- [x] O SDK 1.0 exporta `SYSTEM_MESSAGE_SECTIONS`.
- [x] A wrapper local ainda importa/exporta `SYSTEM_PROMPT_SECTIONS`.
- [x] `SystemPromptSection` foi renomeado para `SystemMessageSection`.
- [x] A seção `runtime_instructions` aparece no contrato 1.0 e não está no mapa local antigo.

### Session Runtime

- [x] `session.getEvents()` substitui `session.getMessages()`.
- [x] `session.setModel(model, options)` aceita `reasoningEffort`, `reasoningSummary`, `contextTier` e
  `modelCapabilities`.
- [x] `session.log(message, { level, ephemeral })` existe no SDK 1.0 e pode sustentar eventos ephemerais de UX.
- [x] `session.openCanvases` e `session.capabilities` viraram superfícies importantes.

### Tools

- [x] `Tool.handler` agora é opcional.
- [x] Tools sem handler são declaration-only e devem ser resolvidas por eventos/RPC de external tool.
- [x] `ToolInvocation` inclui `traceparent` e `tracestate`.
- [x] `convertMcpCallToolResult` entra como ponte oficial MCP -> ToolResultObject.
- [x] `ToolSet` e `BuiltInTools` são a forma preferencial de montar allow/exclude source-qualified.

### Hooks

- [x] `BaseHookInput` agora usa `sessionId`, `timestamp: Date` e `workingDirectory`.
- [x] O código local ainda tipa hooks como `timestamp: number` e `cwd`.
- [x] `onPreMcpToolCall` é novo e precisa entrar no pipeline local.
- [x] `onPostToolUseFailure` é novo e precisa entrar no pipeline local.
- [x] `onPostToolUse` agora é sucesso-only; falhas precisam do hook específico.

### Events

- [x] O SDK 1.0 expõe 108 tipos de evento em `dist/generated/session-events.d.ts`.
- [x] Eventos novos relevantes incluem `model.call_failure`, `hook.progress`, `instruction_discovered`,
  `mcp_app.tool_call_complete`, `extension_context`, `session.permissions_changed`,
  `session.autopilot_objective_changed`, `session.canvas.opened`, `session.canvas.registry_changed`,
  `session.custom_notification`, `session.extensions.attachments_pushed`, `session.schedule_created`,
  `session.schedule_cancelled`, `new_inbox_message`, `session.custom_agents_updated`,
  `session.remote_steerable_changed`.
- [x] O mapa local `SESSION_EVENTS` ainda é manual, mas agora tem teste de paridade contra o `.d.ts` gerado do SDK 1.0.
- [x] Descoberta adicional: `CopilotClient.getState()` não é API pública do SDK 1.0; a fachada local agora mantém estado
  próprio e usa `getState()` apenas como fallback para mocks/SDK legado.
- [x] Descoberta adicional: lifecycle de client usa `onLifecycle()`, não `on()`; wrappers e rotas SSE foram adaptados.
- [x] Descoberta adicional: `ping()` retorna `timestamp` string/ISO, não número.
- [x] Descoberta adicional: `SessionListFilter.cwd` virou `workingDirectory`; `cwd` permanece apenas como alias HTTP.

---

## Bugs E Gaps Confirmados

- [x] BUG-SDK10-A01: `ClientOptionsBuilder` emite campos 0.3 mortos (`cliUrl`, `cliPath`, `cliArgs`, `cwd`, `port`,
  `useStdio`, `isChildProcess`, `autoStart`, `autoRestart`) em vez de `connection`, `workingDirectory` e
  `baseDirectory`.
- [x] BUG-SDK10-A02: `buildCopilotClientOptionsFromEnv()` provavelmente ignora `COPILOT_CLI_URL` na prática com SDK 1.0.
- [x] BUG-SDK10-A03: `createClientFromCliUrl()` instancia `new CopilotClient({ cliUrl })`, contrato obsoleto.
- [x] BUG-SDK10-A04: `SessionConfigBuilder.configDir()` e lifecycle enviam `configDir` ao SDK em vez de
  `configDirectory`.
- [x] BUG-SDK10-A05: `createSessionFsHandler` é enviado ao SDK em vez de `createSessionFsProvider`.
- [x] BUG-SDK10-A06: `disableResume` é alias local, mas não é traduzido para `suppressResumeEvent`.
- [x] BUG-SDK10-A07: `getSessionMessages()` chama `session.getMessages()`, método ausente no SDK 1.0.
- [x] BUG-SDK10-A08: `system-message.js` importa `SYSTEM_PROMPT_SECTIONS` do SDK, export removido na 1.0.
- [x] BUG-SDK10-A09: typedefs locais importam `InputOptions`, export substituído por `UiInputOptions`.
- [x] BUG-SDK10-A10: hooks locais ainda tipam e documentam `cwd/timestamp:number`, enquanto SDK 1.0 envia
  `workingDirectory/timestamp:Date/sessionId`.
- [x] BUG-SDK10-A11: pipeline local de hooks não expõe `onPreMcpToolCall`.
- [x] BUG-SDK10-A12: pipeline local de hooks não expõe `onPostToolUseFailure`.
- [x] BUG-SDK10-A13: `setSessionModel()` não preserva `reasoningSummary` e `contextTier`.
- [x] BUG-SDK10-A14: `SESSION_EVENTS` não está sincronizado automaticamente com os eventos gerados do SDK 1.0.
- [x] BUG-SDK10-A15: `INFINITE_SESSION_DEFAULTS` contém chave duplicada.
- [x] BUG-SDK10-A16: testes validam a API antiga e podem mascarar regressões reais.
- [x] BUG-SDK10-A17: rotas SDK ainda aceitam/documentam `configDir` e `disableResume` sem contrato oficial paralelo.
- [x] BUG-SDK10-A18: BYOK com provider custom exige `model`, mas a camada local ainda permite caminhos ambíguos.
- [x] BUG-SDK10-A19: `mode: "empty"` não está modelado como decisão explícita para server/multiuser.
- [x] BUG-SDK10-A20: `Tool.handler` opcional não está representado na factory local sem separar tool executável de
  declaration-only.
- [x] BUG-SDK10-A21: rotas e facades chamam `CopilotClient.getState()`, método não público no SDK 1.0.
- [x] BUG-SDK10-A22: wrappers de lifecycle/stream usam `client.on()`, substituído por `onLifecycle()` no SDK 1.0.
- [x] BUG-SDK10-A23: facades de ping e interfaces públicas tipam `timestamp` como número, mas SDK 1.0 retorna string.
- [x] BUG-SDK10-A24: `/sessions?cwd=` atravessa `cwd` até `SessionListFilter`, campo removido; agora traduz para
  `workingDirectory`.
- [x] BUG-SDK10-A25: terminal BYOK importava `#copilot/sdk` diretamente; agora usa gateway terminal canônico.

---

## Situação Ideal

- [x] Todo campo enviado ao `@github/copilot-sdk@1.0.0` deve ser campo oficial 1.0.
- [x] Aliases históricos podem existir apenas como compat de borda local.
- [x] Todo alias local deve ser traduzido antes de atravessar a fronteira vendor.
- [x] O builder de client deve produzir `RuntimeConnection` explícito e auditável.
- [x] O fluxo de runtime externo deve usar `RuntimeConnection.forUri`.
- [x] O fluxo de spawn stdio deve usar `RuntimeConnection.forStdio`.
- [x] O fluxo de spawn TCP deve usar `RuntimeConnection.forTcp`.
- [ ] O terminal deve conseguir explicar o transporte ativo sem vazar campos mortos.
- [x] Config de sessão deve distinguir create-only, resume-only e base config.
- [x] `disableResume` pode permanecer como alias humano, mas o payload oficial deve ser `suppressResumeEvent`.
- [x] `configDir` pode permanecer como alias humano, mas o payload oficial deve ser `configDirectory`.
- [x] `createSessionFsHandler` pode permanecer como alias humano, mas o payload oficial deve ser
  `createSessionFsProvider`.
- [x] System message deve usar `SYSTEM_MESSAGE_SECTIONS` canônico e exportar alias legado apenas localmente.
- [x] `getSessionMessages` local deve virar compat que chama `getEvents`.
- [x] Hooks devem aceitar o contrato novo e também normalizar inputs legados em testes/consumers locais.
- [x] Eventos devem ser derivados ou testados contra o `.d.ts` gerado do SDK para evitar drift silencioso.
- [ ] UX/terminal deve receber eventos novos categorizados, mesmo quando ainda sem renderer especializado.
- [x] BYOK/model-gateway deve alimentar `onListModels`, `provider`, `model`, `reasoningSummary`, `contextTier` e
  `modelCapabilities` de forma coerente.
- [x] O sistema deve manter a arquitetura de barrels: consumers importam de `#copilot/sdk`, `#copilot/config` e portas
  internas, nunca direto do vendor exceto na wrapper L1.

---

## Roadmap

### Faixa A - Client Connection 1.0

- [x] A.1 Mapear `COPILOT_CLI_URL` para `RuntimeConnection.forUri`.
- [x] A.2 Mapear `COPILOT_CLI_PORT` ou `COPILOT_USE_STDIO=false` para `RuntimeConnection.forTcp`.
- [x] A.3 Mapear default/spawn stdio para `RuntimeConnection.forStdio`.
- [x] A.4 Mapear `COPILOT_CLI_PATH` e `COPILOT_CLI_ARGS` para `path/args` do `RuntimeConnection`.
- [x] A.5 Mapear `COPILOT_CLI_CWD` e `COPILOT_WORKING_DIRECTORY` para `workingDirectory`.
- [x] A.6 Mapear `COPILOT_HOME` ou variável canônica nova para `baseDirectory`.
- [x] A.7 Adicionar suporte a `COPILOT_CONNECTION_TOKEN` para URI/TCP quando configurado.
- [x] A.8 Manter métodos `cliUrl`, `cliPath`, `cliArgs`, `cwd`, `port`, `useStdio` como aliases de builder, mas sem
  emitir campos mortos.
- [x] A.9 Tornar `autoStart`, `autoRestart` e `isChildProcess` aliases deprecated/no-op documentados ou removidos do
  payload final.
- [x] A.10 Atualizar `createClientFromCliUrl()` para `RuntimeConnection.forUri`.
- [x] A.11 Atualizar testes para validar `connection.kind`, `connection.url/path/args/port` e `workingDirectory`.

### Faixa B - Session Config 1.0

- [x] B.1 Adicionar `configDirectory()` ao builder.
- [x] B.2 Fazer `configDir()` alias local de `configDirectory()`.
- [x] B.3 Adicionar `createSessionFsProvider()` ao builder.
- [x] B.4 Fazer `createSessionFsHandler()` alias local de `createSessionFsProvider()`.
- [x] B.5 Adicionar `suppressResumeEvent()` ao builder.
- [x] B.6 Fazer `disableResume()` alias local de `suppressResumeEvent()`.
- [x] B.7 Adicionar `continuePendingWork()` ao builder de resume.
- [x] B.8 Adicionar `openCanvases()` ao builder de resume.
- [x] B.9 Incluir novos campos base: `reasoningSummary`, `contextTier`, `largeOutput`, `enableSessionTelemetry`,
  `skipCustomInstructions`, `customAgentsLocalOnly`, `coauthorEnabled`, `manageScheduleEnabled`.
- [x] B.10 Incluir novos campos de storage/isolamento: `mcpOAuthTokenStorage`, `skipEmbeddingRetrieval`,
  `embeddingCacheStorage`.
- [x] B.11 Incluir novos campos de descoberta: `pluginDirectories`, `instructionDirectories`,
  `organizationCustomInstructions`, `enableOnDemandInstructionDiscovery`.
- [x] B.12 Incluir knobs host: `enableFileHooks`, `enableHostGitOperations`, `enableSessionStore`, `enableSkills`.
- [x] B.13 Incluir opt-ins UI/experimental com guards: `enableMcpApps`, `canvases`, `requestCanvasRenderer`,
  `requestExtensions`, `extensionSdkPath`, `extensionInfo`.
- [x] B.14 Incluir `remoteSession` sem habilitar defaults perigosos.
- [ ] B.16 Investigar `cloud` no contrato público antes de modelar fluent helper dedicado.
- [x] B.15 Atualizar `sanitizeResumeSessionConfig()` para chaves oficiais 1.0.

### Faixa C - Lifecycle And Runtime

- [x] C.1 Atualizar `buildSessionConfig()` para traduzir aliases antes do SDK.
- [x] C.2 Atualizar `createSession()` e `resumeSession()` para preservar `reasoningSummary/contextTier`.
- [x] C.3 Atualizar `normalizeResumeModelSelection()` para não descartar opções válidas quando modelo concreto existir.
- [x] C.4 Corrigir `getSessionMessages()` para chamar `getEvents()` e manter nome compat local.
- [x] C.5 Atualizar `setSessionModel()` para passar `reasoningSummary` e `contextTier`.
- [x] C.6 Atualizar métricas de troca de modelo para registrar `reasoningSummary/contextTier` sem payload sensível.
- [x] C.7 Garantir que `session.log()` seja usado só quando exposto, com erro claro em runtimes antigos.
- [x] C.8 Revisar fallback RPC de model switching contra contrato 1.0.
- [x] C.9 Substituir dependência local de `CopilotClient.getState()` por estado gerenciado na fachada.
- [x] C.10 Substituir lifecycle de client para `onLifecycle()` com fallback legado.
- [x] C.11 Propagar `ping().timestamp` string/ISO nas facades e interfaces públicas.

### Faixa D - System Message

- [x] D.1 Importar `SYSTEM_MESSAGE_SECTIONS` do SDK.
- [x] D.2 Exportar `SYSTEM_MESSAGE_SECTIONS` como nome canônico local.
- [x] D.3 Exportar `SYSTEM_PROMPT_SECTIONS` como alias legacy local.
- [x] D.4 Atualizar typedefs de `SystemPromptSection` para `SystemMessageSection`.
- [x] D.5 Incluir `runtime_instructions` no mapa local.
- [x] D.6 Atualizar testes e mocks para o nome novo preservando compat.

### Faixa E - Events And Terminal Compatibility

- [x] E.1 Sincronizar `SESSION_EVENTS` com os 108 eventos do SDK 1.0.
- [x] E.2 Adicionar teste que compara o mapa local com `dist/generated/session-events.d.ts`.
- [x] E.3 Criar categoria fallback para eventos de conteúdo multimodal (`text`, `image`, `audio`, `blob`, `resource`,
  `resource_link`, `file`, `directory`, `selection`, `object`, `function`, `terminal`, `github_reference`).
- [x] E.4 Adicionar normalizers para `model.call_failure`.
- [x] E.5 Adicionar normalizers para `session.permissions_changed`.
- [x] E.6 Adicionar normalizers para `session.canvas.opened` e `session.canvas.registry_changed`.
- [x] E.7 Adicionar normalizers para `hook.progress`.
- [x] E.8 Garantir que terminal não apresente eventos novos como ids crus sem rótulo humano.

### Faixa F - Hooks 1.0

- [x] F.1 Atualizar typedefs locais para `sessionId`, `timestamp: Date`, `workingDirectory`.
- [x] F.2 Criar normalizador local que aceita `cwd/timestamp:number` e produz contrato 1.0 quando necessário.
- [x] F.3 Adicionar `onPreMcpToolCall` à factory.
- [x] F.4 Adicionar `onPostToolUseFailure` à factory.
- [x] F.5 Atualizar docs e testes que assumem `onPostToolUse` para falhas.
- [x] F.6 Propagar trace context em logs de tool quando `traceparent/tracestate` existirem.
- [x] F.7 Atualizar `HookRegistry` para refletir campos novos.

### Faixa G - Tools 1.0

- [x] G.1 Separar `createTool()` executável de `createDeclarationTool()`.
- [x] G.2 Permitir `handler` opcional apenas em API explicitamente declaration-only.
- [x] G.3 Integrar `convertMcpCallToolResult` onde houver ponte MCP.
- [x] G.4 Atualizar `ToolBinaryResult.type` para `"image" | "resource"` quando aplicável.
- [x] G.5 Registrar `toolTelemetry` com shape 1.0.
- [x] G.6 Introduzir helpers `ToolSet`/`BuiltInTools` via barrel local sem vazar vendor.

### Faixa H - BYOK, Model Gateway And Quotas

- [x] H.1 Garantir que provider custom sempre acompanhe `model` concreto.
- [x] H.2 Documentar que BYOK não usa quota GitHub Copilot, mas provider externo pode falhar por quota/rate limit.
- [x] H.3 Separar falha `model.call_failure` por quota/account/rate/model unsupported/network.
- [x] H.4 Preservar per-session `gitHubToken` para model routing e quota GitHub quando não-BYOK.
- [x] H.5 Usar `onListModels` do model-gateway sem conflitar com `client.listModels()` nativo.
- [x] H.6 Expor `reasoningSummary` e `contextTier` no seletor de modelo quando metadados suportarem.
- [x] H.7 Manter Ollama/local suportado, mas fora dos defaults de seleção automática salvo pedido explícito.

### Faixa I - Server Routes And Public Contracts

- [x] I.1 Atualizar schemas de `/sdk/session` para `configDirectory` e alias `configDir`.
- [x] I.2 Atualizar schemas de resume para `suppressResumeEvent` e alias `disableResume`.
- [x] I.3 Atualizar README de rotas SDK.
- [x] I.4 Garantir que respostas de diagnóstico mostrem campos oficiais e aliases legados apenas como compat.
- [x] I.5 Validar que request bodies antigos não quebram, mas payload vendor sai limpo.
- [x] I.6 Traduzir `/sessions?cwd=` para `SessionListFilter.workingDirectory`.

### Faixa J - Tests And Validators

- [x] J.1 Atualizar mocks do SDK para `SYSTEM_MESSAGE_SECTIONS`.
- [x] J.2 Atualizar testes de builder para `RuntimeConnection`.
- [x] J.3 Atualizar testes de lifecycle para `createSessionFsProvider`, `configDirectory` e `suppressResumeEvent`.
- [x] J.4 Adicionar teste de `getSessionMessages()` compat via `getEvents()`.
- [x] J.5 Adicionar teste de `setSessionModel()` com `reasoningSummary/contextTier`.
- [x] J.6 Rodar testes focados de `tests/unit/copilot/config` e `tests/unit/copilot/sdk`.
- [x] J.7 Rodar typecheck strict de `src/copilot`.
- [x] J.8 Rodar lint de `src/copilot`.
- [ ] J.9 Rodar suite ampla apenas após os patches estruturais iniciais.

### Faixa K - Terminal UX Depois Da Fundação SDK

- [ ] K.1 Reavaliar screenshots do operador com eventos 1.0 já categorizados.
- [ ] K.2 Padronizar labels humanos para `ask_user`, `report_intent`, `model.call_failure`, tools e intents.
- [x] K.3 Garantir timestamps ISO 8601 completos em contratos de ping SDK.
- [x] K.8 Garantir timestamps ISO 8601 completos no renderer final de eventos do terminal.
- [x] K.4 Garantir linha viva separada do input.
- [x] K.5 Reduzir repetição de `request_user_input` pendente.
- [x] K.6 Apresentar troca automática de modelo com motivo, modelo anterior, modelo novo e confiança.
- [x] K.7 Fazer lives LLM-B depois da migração SDK estar estável.

---

## Prioridade De Execução

1. [x] Corrigir `ClientOptionsBuilder` e `createClientFromCliUrl`.
2. [x] Corrigir `SessionConfigBuilder`, `sanitizeResumeSessionConfig()` e `buildSessionConfig()`.
3. [x] Corrigir `SYSTEM_MESSAGE_SECTIONS` e typedefs.
4. [x] Corrigir `getEvents/getMessages` e `setModel` novo.
5. [x] Atualizar testes focados para não validar API morta.
6. [x] Sincronizar eventos e hooks.
7. [ ] Reabrir foco terminal UX com base de eventos correta.

---

## Execução Em 2026-06-08

- [x] Criado este documento-guia antes dos patches de código.
- [x] Migrado `ClientOptionsBuilder` para `RuntimeConnection`.
- [x] Migrado `createClientFromCliUrl()` para `RuntimeConnection.forUri`.
- [x] Migrados aliases `configDir`, `createSessionFsHandler` e `disableResume` para os nomes oficiais
  `configDirectory`, `createSessionFsProvider` e `suppressResumeEvent`.
- [x] Adicionados passthroughs oficiais de sessão SDK 1.0, incluindo `reasoningSummary`, `contextTier`,
  `enableMcpApps`, canvas/extensions opt-in, storage, skills e host knobs.
- [x] Migrado system-message para `SYSTEM_MESSAGE_SECTIONS`, com fallback local para mocks/alias legado.
- [x] Migrado `getSessionMessages()` para `getEvents()`.
- [x] Migrado `setSessionModel()` e RPC fallback para `reasoningSummary/contextTier`.
- [x] Sincronizado `SESSION_EVENTS` com os 108 eventos gerados do SDK 1.0 e adicionado teste de paridade.
- [x] Adicionados hooks `onPreMcpToolCall` e `onPostToolUseFailure`.
- [x] Removida dependência runtime de `CopilotClient.getState()`; estado de conexão agora é SSOT local da fachada.
- [x] Migrado lifecycle de client para `onLifecycle()` com fallback `.on()` apenas para compat.
- [x] Propagado `ping().timestamp` string/ISO por SDK, agente e interfaces públicas.
- [x] Corrigido filtro `/sessions?cwd=` para `workingDirectory`.
- [x] Corrigida violação terminal→SDK em BYOK gateway movendo a leitura de SessionFs para gateway terminal.
- [x] Validado com `npm run typecheck:strict:src.copilot.sdk`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com suíte focada: 10 arquivos, 272 testes.

### Execução Contínua Em 2026-06-08 - Segunda Passada

- [x] Confirmado via `npm view` que `@github/copilot-sdk` latest continua em `1.0.0`; tags atuais:
  `latest=1.0.0`, `prerelease=1.0.0-beta.11`, `unstable=0.2.1-unstable.0`.
- [x] Revarrido o contrato SDK instalado e confirmado que `SessionConfig.cloud` é create-only, enquanto
  `ResumeSessionConfig.openCanvases` é resume-only e deve ficar fora de `SessionConfigBuilder.build()`.
- [x] Fechado B.8 com `SessionConfigBuilder.openCanvases()` e `ResumeSessionConfigBuilder.openCanvases()`, preservando o
  snapshot apenas no payload de resume.
- [x] Fechado BUG-SDK10-A20/G.1/G.2 com `createDeclarationTool()`: `createTool()` e `createToolSync()` continuam exigindo
  handler executável, e a API declaration-only é explícita.
- [x] Fechado G.6 ao expor `ToolSet`, `BuiltInTools` e `convertMcpCallToolResult` pelos barrels locais
  `#copilot/sdk/tools` e `#copilot/sdk`.
- [x] Corrigido typedef local de `ToolBinaryResult.type` para `"image" | "resource"` e documentado `Tool.handler?`.
- [x] Preservada alteração local pré-existente de UX em `src/copilot/terminal/events/agent-runtime-events.js`, que já
  suprime heartbeat genérico de `ask_user`/`request_user_input` quando a interação é pergunta humana.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js tests/unit/copilot/sdk/test_sdk_tools.spec.js`
  (2 arquivos, 79 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot.sdk`.

### Achados Novos Da Segunda Passada

- [x] SDK10-P2-01: `convertMcpCallToolResult` agora está disponível na fronteira local, mas ainda falta aplicar na ponte
  MCP concreta para eliminar conversões manuais de `CallToolResult`.
- [x] SDK10-P2-02: `ToolSet`/`BuiltInTools` estão expostos, mas `availableTools`/`excludedTools` nos builders locais ainda
  aceitam apenas `string[]`; falta permitir `ToolSet` sem casts.
- [x] SDK10-P2-03: `SessionConfig.cloud` foi confirmado no SDK 1.0 como create-only; falta helper explícito ou decisão de
  não expor fluent helper até existir fluxo de cloud/remote UX.
- [x] SDK10-P2-04: a mudança local pré-existente no terminal corrige ruído de heartbeat de pergunta humana, mas ainda
  precisa ser validada no pacote terminal completo e em live LLM-B.
- [x] SDK10-P2-05: os normalizers de `model.call_failure`, `session.permissions_changed`, canvas e `hook.progress`
  continuam o principal caminho para fechar a UX de eventos 1.0.

### Execução Contínua Em 2026-06-08 - Terceira Passada

- [x] Aberto o tipo dos builders `availableTools()` e `excludedTools()` para `SessionConfig['availableTools']` /
  `SessionConfig['excludedTools']`, preservando compat com `string[]` e aceitando `ToolSet`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js` (66 testes).
- [x] Revalidado com `npm run typecheck:strict:src.copilot.sdk`.

### Execução Contínua Em 2026-06-08 - Quarta Passada

- [x] Integrado `convertMcpCallToolResult` em `src/copilot/bridges/mcp-tool-bridge.js`.
- [x] Removida conversão manual de `content[].text` para string no bridge MCP, preservando o `ToolResultObject` oficial
  do SDK para texto, imagem, resource e `isError`.
- [x] Falhas de execução MCP agora retornam `resultType: "failure"` com `error`, em vez de texto solto que podia parecer
  sucesso para o runtime.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/test_mcp_tool_bridge.spec.js tests/unit/copilot/sdk/test_sdk_consumer_migration_f30.spec.js`
  (2 arquivos, 53 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-08 - Quinta Passada

- [x] Adicionados normalizers canônicos em `src/copilot/sdk/session/session-events.js` para:
  `model.call_failure`, `session.permissions_changed`, `session.canvas.opened`,
  `session.canvas.registry_changed` e `hook.progress`.
- [x] Os normalizers preservam `timestamp` ISO original e `ts` numérico compat, além de campos diagnósticos como
  `statusCode`, `durationMs`, `providerCallId` e `serviceRequestId`.
- [x] Exportados os novos normalizers por `#copilot/sdk/session` e `#copilot/sdk`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/sdk/test_sdk_events.spec.js tests/unit/copilot/sdk/test_sdk_barrel.spec.js
  tests/unit/copilot/sdk/test_sdk_barrel_f23.spec.js` (3 arquivos, 111 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Quinta Passada

- [x] SDK10-P5-01: os renderers e comandos de terminal ainda precisam consumir esses normalizers para que eventos 1.0
  novos não apareçam como ids crus ou payloads técnicos.
- [x] SDK10-P5-02: `model.call_failure` agora tem contrato normalizado, mas ainda falta classificação UX por
  quota/account/rate/model unsupported/network no model-gateway/terminal.
- [ ] SDK10-P5-03: canvas tem normalizers, mas falta decisão de UX para hosts sem renderer: esconder, resumir, ou expor
  aviso operacional quando `requestCanvasRenderer`/`canvases` forem opt-in.

### Execução Contínua Em 2026-06-08 - Sexta Passada

- [x] Humanizado `/events` para os eventos SDK 1.0 mais críticos: `model.call_failure`,
  `session.permissions_changed`, `session.canvas.opened`, `session.canvas.registry_changed` e `hook.progress`.
- [x] `model.call_failure` agora aparece para o operador como “Falha do modelo”, com modelo, origem, HTTP,
  duração, mensagem e request id compacto.
- [x] `session.permissions_changed` agora resume ativação/desativação de aprovação ampla em texto humano.
- [x] `session.canvas.*` e `hook.progress` ganharam labels e resumos operacionais no archive default de `/events`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/terminal/test_commands_events.spec.js` (24 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado com `npm run lint:copilot`.

### Achados Novos Da Sexta Passada

- [x] SDK10-P6-01: a humanização de `/events` cobre os eventos 1.0 críticos, mas os fluxos live/SSE ainda precisam ser
  exercitados com LLM-B para confirmar que os payloads reais chegam no mesmo shape dos testes.
- [ ] SDK10-P6-02: `session.canvas.registry_changed` tem resumo no archive, mas ainda não há decisão de produto para
  renderização ativa de canvas no terminal quando o runtime abrir uma instância.
- [x] SDK10-P6-03: o harness live BYOK esperava strings em inglês (`BYOK profiles/models/recommend`) enquanto a UX real e
  correta do terminal estava localizada (`BYOK perfis/modelos/recomendação`); a validação foi ajustada para aceitar os
  rótulos humanos atuais sem exigir regressão de idioma.

### Execução Contínua Em 2026-06-08 - Sétima Passada Live LLM-B

- [x] `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] `node scripts/model-gateway/run.mjs liveReadiness --json` passou em aproximadamente 67s, confirmando catálogo,
  paridade SQLite, redaction, runtime selector, terminal live runtime selector e live runner.
- [x] `node scripts/model-gateway/run.mjs livePlan --json` gerou plano canônico em
  `artifacts/model-gateway-live-plan/2026-06-08T08-35-16-685Z.md`.
- [x] `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` passou com artefato
  `artifacts/terminal-live/2026-06-08T08-35-30-193Z/summary.md`, confirmando REPL interativo, SSE público,
  `/events`, `/sdk`, `/usage`, `/activity`, `/metrics`, saída limpa e sem erro terminal.
- [x] Primeiro `node scripts/model-gateway/run.mjs llmBLiveTest --byok-probe --byok-fixture --no-pr --timeout-ms=240000`
  falhou por falso negativo do harness: o terminal renderizou corretamente `BYOK perfis`, `BYOK modelos`,
  `BYOK recomendação`, catálogo fixture e discovery remoto redigido, mas os checks exigiam apenas inglês.
- [x] Após corrigir o harness para aceitar a UX localizada, o rerun BYOK fixture passou com artefato
  `artifacts/terminal-live/2026-06-08T08-37-14-024Z/summary.md`.
- [x] O rerun BYOK fixture confirmou `/byok`, `/byok env`, `/byok profiles`, `/byok providers`, `/byok health`,
  ativação de perfil fixture, refresh de modelos, discovery `/models`, troca de modelo/provider, filtros,
  recomendações, retorno a `sdk`, não vazamento de token fixture, SSE archive default/raw e quit limpo.

### Achados Novos Da Sétima Passada

- [ ] SDK10-P7-01: live control/fixture validou terminal, SSE e BYOK sem abrir turno explícito; ainda falta rodada real
  com provider/modelo vivo para observar `model.call_failure`/fallback em payloads não sintéticos quando houver quota
  operacional aceitável.
- [ ] SDK10-P7-02: `/events` live mostrou archive saudável, mas ainda sem eventos `model.call_failure` ou canvas reais;
  os próximos testes devem provocar falha controlada de modelo e abertura/registro de canvas quando o runtime expuser
  esses eventos.
- [ ] SDK10-P7-03: o terminal está localizado em português, então novos validadores live devem tratar labels humanos
  como contrato de produto e não como strings internas em inglês.

### Execução Contínua Em 2026-06-08 - Oitava Passada

- [x] Expandida a taxonomia de recovery do SDK para `account` e `model_unsupported`, mantendo esses bloqueios fora de
  reconnect automático/circuit breaker local.
- [x] Espelhada a mesma semântica em `presentation/sdk/recovery-policy.js` para não criar uma classificação paralela no
  terminal.
- [x] `/events` agora classifica `model.call_failure` em linguagem operacional: rate limit, limite de sessão,
  limite semanal/modelo, quota esgotada, conta/cobrança, autenticação, modelo incompatível, rede, timeout ou
  não classificada.
- [x] O resumo humano de `model.call_failure` passou a incluir dica de ação curta da política compartilhada, preservando
  modelo, origem, HTTP, duração, mensagem e request id.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/test_presentation_sdk_recovery_policy.spec.js tests/unit/copilot/sdk/test_sdk_client.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js` (3 arquivos, 65 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Oitava Passada

- [x] SDK10-P8-01: ainda há duas implementações muito parecidas de taxonomia (`sdk/errors.js` e
  `presentation/sdk/recovery-policy.js`); a próxima limpeza ideal é extrair um núcleo shared puro para reduzir drift
  futuro sem violar as regras de arquitetura entre terminal e SDK.
- [ ] SDK10-P8-02: a classificação cobre eventos arquivados e policy do dialog, mas live real ainda precisa provocar
  falhas de rate/quota/modelo para confirmar que os campos do SDK 1.0 chegam com `statusCode/errorMessage` completos.

### Execução Contínua Em 2026-06-08 - Nona Passada

- [x] Extraída a taxonomia pura de erro SDK para `src/copilot/core/sdk-error-taxonomy.js`.
- [x] `src/copilot/sdk/errors.js` agora preserva a API pública antiga, mas delega `getSdkErrorFingerprint()`,
  `classifySdkRateLimitScope()` e `classifySdkError()` para o núcleo shared.
- [x] `src/copilot/presentation/sdk/recovery-policy.js` agora delega `classifyRuntimeSdkRateLimitScope()` e
  `classifyRuntimeSdkError()` para o mesmo núcleo, eliminando regexes paralelas entre SDK, presentation e terminal.
- [x] Atualizado mock legado de `@github/copilot-sdk` em teste de barrel para exportar `SYSTEM_MESSAGE_SECTIONS`, evitando
  que contrato antigo 0.3 esconda regressões reais da 1.0.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/test_presentation_sdk_recovery_policy.spec.js tests/unit/copilot/sdk/test_sdk_client.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/contracts/test_barrel_contracts.spec.js
  tests/unit/copilot/contracts/test_presentation_barrel_governance.spec.js` (5 arquivos, 75 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Nona Passada

- [x] SDK10-P9-01: alguns testes/contratos ainda podem conter mocks SDK 0.3 (`SYSTEM_PROMPT_SECTIONS`,
  `InputOptions`, campos mortos de client); falta varredura dedicada de mocks para impedir falsos positivos.

### Execução Contínua Em 2026-06-08 - Décima Passada

- [x] Varredura dedicada de mocks/fixtures SDK 0.3 em `tests/unit/copilot`.
- [x] Todo arquivo de teste que ainda exporta `SYSTEM_PROMPT_SECTIONS` em mock agora também exporta
  `SYSTEM_MESSAGE_SECTIONS`, preservando compat legado sem mascarar o contrato SDK 1.0.
- [x] Atualizada fixture `tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js`: `getSessionMessages()` local segue
  sendo nome compat, mas os mocks agora expõem `session.getEvents()` como no SDK 1.0.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js` em 14 arquivos de mocks/fixtures SDK
  (407 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Décima Passada

- [x] SDK10-P10-01: ainda existem usos textuais legítimos de `SYSTEM_PROMPT_SECTIONS` como alias compat; falta uma regra
  de teste que diferencie alias aceito de mock incompleto sem `SYSTEM_MESSAGE_SECTIONS`.

### Execução Contínua Em 2026-06-08 - Décima Primeira Passada

- [x] Adicionado guardrail `tests/unit/copilot/sdk/test_sdk_mock_contracts.spec.js`: qualquer mock que exporte
  `SYSTEM_PROMPT_SECTIONS` agora precisa exportar também `SYSTEM_MESSAGE_SECTIONS`.
- [x] Atualizado teste high-level de `config/system-prompt` para esperar a seção SDK 1.0 `runtime_instructions`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/sdk/test_sdk_mock_contracts.spec.js tests/unit/copilot/sdk/test_sdk_system_message.spec.js
  tests/unit/copilot/test_system_prompt.spec.js` (3 arquivos, 33 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Décima Primeira Passada

- [x] SDK10-P11-01: o pacote de testes ainda contém aliases de borda (`configDir`, `disableResume`,
  `createSessionFsHandler`) por compat; falta um guardrail equivalente garantindo que payload vendor final use apenas
  nomes oficiais.

### Execução Contínua Em 2026-06-08 - Décima Segunda Passada

- [x] Reforçados testes de `createSession()` e `resumeSession()` para aceitar aliases de borda (`configDir`,
  `createSessionFsHandler`, `disableResume`) e verificar que o payload final enviado ao SDK contém somente
  `configDirectory`, `createSessionFsProvider` e `suppressResumeEvent`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js` (1 arquivo, 16 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Décima Segunda Passada

- [ ] SDK10-P12-01: `buildSessionConfig()` ainda aceita aliases internamente por compat; a próxima evolução pode separar
  DTO de borda e DTO vendor em funções nomeadas para tornar o limite arquitetural mais explícito.

### Execução Contínua Em 2026-06-08 - Décima Terceira Passada

- [x] Coberto `logSessionTimeline()` contra runtimes antigos sem `session.log()`: a função falha antes do SDK com
  mensagem clara `sessão não expõe session.log()`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js` (1 arquivo, 35 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-08 - Décima Quarta Passada

- [x] Humanizados eventos de tool SDK 1.0 no `/events`: `tool.user_requested`, `tool.execution_start`,
  `tool.execution_progress`, `tool.execution_partial_result`, `tool.execution_complete`,
  `external_tool.requested` e `external_tool.completed`.
- [x] Adicionado fallback humano para conteúdo multimodal e anexos: `text`, `image`, `audio`, `blob`, `resource`,
  `resource_link`, `file`, `directory`, `selection`, `object`, `function`, `terminal` e `github_reference`.
- [x] `/events` agora resume `tool.execution_complete` com `contents` estruturados e `user.message` com `attachments`,
  exibindo tipo/nome/MIME/URI/exit code sem vazar base64 ou imprimir `[object Object]`.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 25 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Décima Quarta Passada

- [ ] SDK10-P14-01: o resumo multimodal cobre archive/default, mas renderers ativos de terminal ainda podem precisar de
  tratamento visual específico para `uiResource`/MCP Apps quando houver canvas/iframe real.

### Execução Contínua Em 2026-06-08 - Décima Quinta Passada

- [x] Adicionado `normalizeHookInputForSdk10()` na superfície SDK/session e exposto por `#copilot/hooks`; ele aceita
  `cwd` e `timestamp` legado (`number`/string) e emite `workingDirectory`, `timestamp: Date` e `sessionId`.
- [x] `HookBus.emitHook()` agora arquiva inputs normalizados, preservando `cwd` para compat, e `attachBus()` cobre
  também `onPreMcpToolCall` e `onPostToolUseFailure`.
- [x] Criados eventos canônicos `hook:pre_mcp_tool_call` e `hook:post_tool_use_failure`.
- [x] `HookRegistry` agora reflete os hooks SDK 1.0 novos, lista `sessionId`/`workingDirectory` e documenta
  `onPostToolUse` como sucesso-only.
- [x] Typedefs de hooks em `hooks/types.js` e `sdk/types.js` receberam `traceparent`/`tracestate` nos hooks de tool.
- [x] Logs de `hooks/factory` para pre/post/falha/MCP tool incluem trace context compacto quando presente.
- [x] Validado com `npx vitest run --config vitest.copilot.config.js
  tests/unit/copilot/test_hooks_module.spec.js tests/unit/copilot/sdk/test_sdk_barrel.spec.js` (2 arquivos, 136 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado com `npm run lint:copilot`.

### Achados Novos Da Décima Quinta Passada

- [ ] SDK10-P15-01: `HOOK_NAME_TO_EVENTBUS` cobre os eventos canônicos novos, mas consumers downstream de
  `hook:*` podem precisar de labels/rotas específicos se começarem a aparecer no terminal live.

### Execução Contínua Em 2026-06-08 - Décima Sexta Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após as mudanças de
  `/events`, hooks, registry e mocks SDK.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T09-09-06-755Z/summary.md`.
- [x] Confirmados REPL interativo, `/usage now`, `/activity`, `/session sdk commands`, `/session sdk events`,
  `/session sdk waits`, `/metrics`, `/events`, `/events --raw`, SSE conectado, ids monotônicos, nenhum erro terminal,
  nenhuma tool iniciada e quit limpo.
- [x] UX observada: `/events` default continuou enxuto e humano, mostrando apenas eventos operacionais de alta
  relevância; raw tail preservou auditoria técnica sem expor envelope interno.

### Achados Novos Da Décima Sexta Passada

- [ ] SDK10-P16-01: live control ainda não exercita eventos de tool multimodal reais; a cobertura atual é unitária para
  `tool.execution_complete`/attachments e live para saúde do archive.

### Execução Contínua Em 2026-06-08 - Décima Sétima Passada

- [x] `readConfiguredByokProfileSummaries()` agora expõe `ready`, `warnings` e `errors` por perfil, sem vazar segredos.
- [x] Perfis BYOK `custom`/`openai-compatible` sem `model` deixam de parecer simplesmente disponíveis no terminal:
  `/byok profiles` e `/byok providers` classificam como `bloqueado` e instruem `defina modelo explícito para o SDK 1.0`.
- [x] `/byok providers` agora conta perfis realmente prontos (`prontos N/M`) em vez de igualar quantidade configurada a
  prontidão operacional.
- [x] Fixture de `/byok` recebeu mock de `readTerminalConfiguredSessionFsState()` para cobrir fallback de inventário SDK
  indisponível usado pela automação BYOK.
- [x] `INFINITE_SESSION_DEFAULTS` confirmado sem duplicidade atual e protegido por teste de superfície que exige apenas
  `BACKGROUND_COMPACTION_THRESHOLD` e `BUFFER_EXHAUSTION_THRESHOLD`.
- [x] Modelados defaults explícitos de `CopilotClientOptions.mode`: `buildTerminalCopilotClientOptions()`/
  `createTerminalCopilotClient()` usam `copilot-cli`, enquanto `buildServerCopilotClientOptions()`/
  `createServerCopilotClient()` usam `empty`.
- [x] `createAgentSdkClient()` e o preflight do boot terminal agora usam a factory terminal explícita, sem depender do
  default implícito do SDK.
- [x] `ToolBinaryResult` local documentado como `type: "image" | "resource"` e protegido por teste estático contra
  `node_modules/@github/copilot-sdk/dist/types.d.ts`.
- [x] Adicionado `normalizeToolTelemetry()` em `sdk/tools/core.js` para o shape SDK 1.0
  `Record<string, Record<string, unknown> | undefined>`.
- [x] `createTool()` e `createToolSync()` agora anexam `toolTelemetry.copilot` (`toolName`, `durationMs`, `resultType`)
  somente quando o handler já retorna `ToolResultObject`, preservando strings e objetos de domínio.
- [x] `/byok status` agora exibe linha `Quota`: BYOK usa quota/cobrança do provider externo; GitHub Copilot/Premium
  Requests só valem para rotas não-BYOK.
- [x] Validado com `npx vitest run tests/unit/copilot/sdk/test_sdk_provider.spec.js` (1 arquivo, 50 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js` (1 arquivo, 119 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/sdk/test_sdk_constants.spec.js
  tests/unit/copilot/sdk/test_sdk_config.spec.js` (2 arquivos, 33 testes).
- [x] Validado novamente com `npx vitest run tests/unit/copilot/sdk/test_sdk_constants.spec.js` (1 arquivo, 27 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js
  tests/unit/copilot/sdk/test_sdk_barrel.spec.js` (2 arquivos, 96 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/sdk/test_sdk_tools.spec.js
  tests/unit/copilot/sdk/test_sdk_barrel.spec.js` (2 arquivos, 46 testes).
- [x] Validado novamente com `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js` (1 arquivo,
  119 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Décima Sétima Passada

- [ ] SDK10-P17-01: adicionar cenário live/fixture que force um perfil `openai-compatible` sem `model` e confirme que a
  UX bloqueia antes do boot SDK, sem chamada ao provider.
- [ ] SDK10-P17-02: isolar o adapter HTTP `/sdk` em manager/client server dedicado antes de habilitar multiusuário real;
  hoje o servidor embutido do terminal ainda compartilha o client terminal por desenho.

### Execução Contínua Em 2026-06-08 - Décima Oitava Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após BYOK profile
  readiness, client mode explícito e `toolTelemetry` SDK 1.0.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T09-31-12-422Z/summary.md`.
- [x] Confirmados boot terminal, BYOK pronto, `/usage now`, `/activity`, `/session sdk commands`,
  `/session sdk events`, `/session sdk waits`, `/metrics`, `/events`, `/events --raw`, `/errors 10` e `/quit`.
- [x] UX observada: cockpit continuou humano e enxuto; `/events` default não expôs envelope bruto, raw preservou auditoria,
  SSE sem fila, erros rastreados 0.

### Execução Contínua Em 2026-06-08 - Décima Nona Passada

- [x] Fechado H.4 com hardening nas rotas SDK: `gitHubToken` por sessão agora é validado como string não-vazia no schema
  HTTP de create/resume, evitando sessão com credencial vazia e comportamento ambíguo de quota GitHub.
- [x] Adicionados testes de contrato em `/sessions`: rota não-BYOK preserva `gitHubToken` e não materializa `provider`;
  `gitHubToken` vazio é rejeitado antes de chamar o SDK.
- [x] Adicionado teste de contrato em `/sessions/:id/resume`: `gitHubToken` e `provider` BYOK são preservados como campos
  independentes, sem misturar identidade/quota GitHub com cobrança/quota do provider externo.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_route_session_ownership.spec.js` (1 arquivo, 17 testes).

### Achados Novos Da Décima Nona Passada

- [x] SDK10-P19-01: revisar logs/telemetria das rotas SDK para garantir que `gitHubToken` de sessão nunca apareça em
  payloads, erros estruturados ou snapshots de debug, especialmente em falhas de validação e `createdConfigs` de testes.

### Execução Contínua Em 2026-06-08 - Vigésima Passada

- [x] Hardened redaction central em `src/copilot/observability/logger.js`: mensagens string, objetos, `meta.extra`,
  auditoria e métricas agora passam por `redactSecretText`/`redactSecretRecord` antes de persistir em arquivo ou console.
- [x] Expandido `src/copilot/core/security/redaction.js` para reconhecer prefixes GitHub de sessão (`ghs`, `gho`,
  `ghu`, `ghr`, `github_pat`) além de `ghp`, cobrindo `gitHubToken` por sessão do SDK 1.0.
- [x] Refinada a classificação por chave sensível para não redigir métricas legítimas como `tokens: 42`, mantendo
  `gitHubToken`, `providerToken`, `Authorization`, `apiKey`, `bearerToken`, `secret` e `password` redigidos.
- [x] Validado com `npx vitest run tests/unit/copilot/core/test_security_redaction.spec.js
  tests/unit/copilot/observability/test_logger_console_resilience.spec.js
  tests/unit/copilot/test_sdk_route_session_ownership.spec.js` (3 arquivos, 22 testes).

### Achados Novos Da Vigésima Passada

- [x] SDK10-P20-01: revisar `getRecentLogs()` e rotas de consulta de logs para garantir que ring buffer histórico criado
  antes deste hardening não exponha segredos caso o processo tenha iniciado com versão antiga.

### Execução Contínua Em 2026-06-08 - Vigésima Primeira Passada

- [x] `getRecentLogs()` agora redige `taskId` e `msg` também na leitura, garantindo que a rota
  `/observability/logs` receba entradas já sanitizadas mesmo se houver itens antigos no ring buffer.
- [x] Teste do logger passou a validar os três planos de exposição: arquivo (`agent.log`/`audit.log`/`metrics.log`),
  ring buffer (`getRecentLogs`) e preservação de métrica legítima `tokens: 42`.
- [x] Validado com `npx vitest run tests/unit/copilot/core/test_security_redaction.spec.js
  tests/unit/copilot/observability/test_logger_console_resilience.spec.js` (2 arquivos, 5 testes).

### Achados Novos Da Vigésima Primeira Passada

- [x] SDK10-P21-01: revisar coletores JSONL (`event-collector`, `error-alerting`, OTEL file exporter) para aplicar
  redaction equivalente antes de persistir eventos SDK 1.0 que possam conter headers, provider errors ou payloads de tool.

### Execução Contínua Em 2026-06-08 - Vigésima Segunda Passada

- [x] `events.jsonl` agora persiste entradas via `redactSecretRecord`, protegendo `session.error`, eventos de tool,
  headers e payloads ricos do SDK 1.0 antes do flush assíncrono.
- [x] Webhook de `error-alerting` passa por redaction antes de serializar o payload JSON.
- [x] OTEL manual redige `attrs.extra`, strings em `startSpanImmediate`, status de erro e `recordException`, evitando
  exportação de `gitHubToken`, bearer/api keys e headers em spans.
- [x] Adicionados testes focados para `event-collector` e OTEL redaction, além do pacote central logger/redaction.
- [x] Validado com `npx vitest run tests/unit/copilot/observability/test_event_collector_redaction.spec.js
  tests/unit/copilot/observability/test_otel_redaction.spec.js
  tests/unit/copilot/core/test_security_redaction.spec.js
  tests/unit/copilot/observability/test_logger_console_resilience.spec.js` (4 arquivos, 7 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot`.

### Achados Novos Da Vigésima Segunda Passada

- [x] SDK10-P22-01: revisar `error-tracker`, observers e convergence trace store para aplicar redaction em snapshots
  retornados por API, não só em logs persistidos.

### Execução Contínua Em 2026-06-08 - Vigésima Terceira Passada

- [x] `error-tracker` agora redige mensagem, stack, source, sessionId, toolName e metadata antes de armazenar/retornar
  `getErrors()` e `getStats().last`, preservando contadores e metadata numérica como `tokens`.
- [x] `convergence-trace-store` agora redige `traceId`, `phase`, paths, `reason`, `sessionId`, eventos em memória,
  snapshots e linhas persistidas/consultadas no SQLite.
- [x] Redaction central deixou de depender de `\b` para tokens; agora reconhece secrets embutidos depois de `_`, `-` ou
  separadores de path, cobrindo IDs compostos gerados por SDK/tooling.
- [x] Validado com `npx vitest run tests/unit/copilot/core/test_security_redaction.spec.js
  tests/unit/copilot/observability/test_error_tracker_redaction.spec.js
  tests/unit/copilot/observability/test_convergence_trace_store.spec.js` (3 arquivos, 11 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Vigésima Terceira Passada

- [x] SDK10-P23-01: revisar rotas `/observability/audit` e `/observability/audit-tail`; se o audit log interno ainda
  puder conter payload histórico cru, redigir também na leitura da API.

### Execução Contínua Em 2026-06-08 - Vigésima Quarta Passada

- [x] Audit pipeline geral agora redige entradas em `record`, `getEntries`, `getLast`, `flush`, tool JSONL,
  `recordToolStart` pendente, `recordToolComplete` e `getAuditSummary`.
- [x] `createJsonlWriter()` redige qualquer record antes de enfileirar JSONL.
- [x] `getAuditTail()` do buffer SDK agora redige entradas na leitura e o handler `createAuditPostToolHandler()` grava
  entrada já sanitizada no buffer.
- [x] Com isso, `/observability/audit` e `/observability/audit-tail` herdam saída sanitizada mesmo quando o audit buffer
  recebeu payload antigo/cru de hooks/tools.
- [x] Validado com `npx vitest run tests/unit/copilot/test_audit_pipeline.spec.js
  tests/unit/copilot/test_error_alerting_jsonl.spec.js tests/unit/copilot/test_hooks_module.spec.js` (3 arquivos,
  146 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Vigésima Quarta Passada

- [x] SDK10-P24-01: consolidar política de redaction em um teste de contrato que varra superfícies públicas de
  observabilidade (`logs`, `errors`, `audit`, `events`, `convergence`) com o mesmo conjunto de fixtures secretas.

### Execução Contínua Em 2026-06-08 - Vigésima Quinta Passada

- [x] Adicionada defesa de borda em `server/routes/sdk/observability.js`: endpoints ricos passam por
  `redactObservabilityPayload()` antes do `res.json`.
- [x] Cobertos por redaction HTTP: `/observability/metrics`, `/observability/convergence`, `/observability/quota`,
  `/observability/errors`, `/observability/errors/stats`, `/observability/logs`, `/observability/audit`,
  `/observability/audit-tail`, `/observability/otel-status`, `/observability/events/catalog` e
  `/observability/events/dead-letter`.
- [x] Redaction central agora sanitiza também nomes de chave, cobrindo counters/gauges/event keys que incorporem tokens
  em labels dinâmicos.
- [x] Criado contrato de rota com uma fixture única (`ghs_*` + `sk-*`) varrendo as superfícies públicas de
  observabilidade.
- [x] Validado com `npx vitest run tests/unit/copilot/core/test_security_redaction.spec.js
  tests/unit/copilot/test_observability_sdk_fs_routing.spec.js` (2 arquivos, 8 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Vigésima Quinta Passada

- [x] SDK10-P25-01: fazer rodada live LLM-B após hardening de observability/redaction para confirmar `/metrics`,
  `/events`, `/errors` e UX terminal sem regressão visual ou ruído excessivo.

### Execução Contínua Em 2026-06-08 - Vigésima Sexta Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após hardening amplo de
  redaction/observability/audit.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T09-57-20-605Z/summary.md`.
- [x] Confirmados boot terminal, BYOK pronto, `/usage now`, `/activity`, `/session sdk commands`,
  `/session sdk events`, `/session sdk waits`, `/metrics`, `/events`, `/events --raw`, `/errors 10` e `/quit`.
- [x] UX observada: `/metrics` permaneceu legível e sem ruído técnico excessivo; `/events` default continuou humano e
  raw preservou auditoria; `/errors` reportou 0 erros rastreados.

### Achados Novos Da Vigésima Sexta Passada

- [x] SDK10-P26-01: investigar por que `/session sdk events` ainda mostra “nenhum ciclo de vida SDK ou comando SDK
  arquivado” mesmo após sessão pronta; pode ser expectativa correta para resume silencioso, mas merece contrato explícito.

### Execução Contínua Em 2026-06-08 - Vigésima Sétima Passada

- [x] Confirmado que o live `--no-pr` não abre turno nem executa CommandDefinition; portanto a janela vazia em
  `/session sdk events` é esperada após resume silencioso.
- [x] Melhorada a cópia do estado vazio: agora explica que “nenhum ciclo de vida SDK ou comando SDK arquivado nesta
  janela” é normal após resume silencioso ou quando nenhum CommandDefinition foi chamado.
- [x] O detalhe agora aponta também para `/session sdk commands`, deixando clara a diferença entre catálogo exposto e
  eventos executados.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js` (1 arquivo, 48 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Vigésima Sétima Passada

- [x] SDK10-P27-01: considerar um indicador “catálogo exposto, nenhum comando chamado” em `/session sdk` principal para
  reduzir idas ao subcomando quando o operador está diagnosticando CommandDefinitions.

### Execução Contínua Em 2026-06-08 - Vigésima Oitava Passada

- [x] `/session sdk` principal agora mostra a linha `CommandDefinitions`, cruzando o catálogo local exposto ao SDK com
  chamadas `sdk.command.executed` observadas no archive SSE.
- [x] Estado sem chamadas ficou explícito: “CommandDefinitions expostos · nenhum comando chamado nesta janela ·
  /session sdk commands”, reduzindo ambiguidade em resumes silenciosos.
- [x] Quando há chamada arquivada, o cockpit mostra contagem recente, último CommandDefinition chamado e atalho para
  `/session sdk events`.
- [x] Adicionados testes para janela vazia e janela com `terminal_status` chamado.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js` (1 arquivo, 49 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Vigésima Oitava Passada

- [x] SDK10-P28-01: reexecutar live LLM-B garantindo que o fluxo percorra `/session sdk` principal, não apenas
  `/session sdk commands/events/waits`, para validar a nova linha em ambiente real.

### Execução Contínua Em 2026-06-08 - Vigésima Nona Passada Live LLM-B

- [x] Atualizado o harness `llmBLiveTest --no-pr` para executar `/session sdk 6` antes dos subcomandos
  `commands/events/waits`.
- [x] Adicionado critério live `sdk-session-main-cockpit-visible`, exigindo a linha `CommandDefinitions` com catálogo
  exposto versus chamadas observadas no archive.
- [x] Atualizado o critério diagnóstico de `/session sdk events` para a nova cópia “arquivado nesta janela”.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T10-05-32-088Z/summary.md`.
- [x] UX observada no terminal real: `/session sdk 6` mostrou `CommandDefinitions 7 CommandDefinitions expostos ·
  nenhum comando chamado nesta janela · /session sdk commands`, sem abrir turno LLM.

### Achados Novos Da Vigésima Nona Passada

- [x] SDK10-P29-01: investigar `onListModels`/model-gateway versus `client.listModels()` nativo do SDK 1.0 para eliminar
  fluxos paralelos de catálogo, sem perder metadados de reasoning/context tier na UX.

### Execução Contínua Em 2026-06-08 - Trigésima Passada

- [x] Confirmado no SDK 1.0 instalado que `CopilotClientOptions.onListModels` é a extensão oficial usada por
  `client.listModels()`, com cache nativo do client após a primeira chamada bem-sucedida.
- [x] Fechado H.5 por contrato: `buildTerminalCopilotClientOptions({ onListModels })` preserva o handler injetado pelo
  bootstrap/model-gateway sobre o fallback BYOK genérico do env, evitando dois catálogos concorrentes no terminal.
- [x] Fechado H.6 de forma compatível com o SDK atual: `/sdk models` segue exibindo `supportedReasoningEfforts` oficial
  e agora também mostra `supportedReasoningSummaries`/`supportedContextTiers` quando esses metadados estendidos
  existirem no catálogo, sem inventar suporte quando o `ModelInfo` oficial não trouxer esses campos.
- [x] Adicionado teste de UX para `/sdk models` com `resumo none, concise` e `contexto default, long_context`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js
  tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js` (2 arquivos, 109 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Passada

- [x] SDK10-P30-01: investigar H.7/Ollama/local na seleção automática: garantir que provedores locais continuem
  disponíveis sob opt-in explícito, mas não entrem em defaults automáticos do model-gateway sem pedido do operador.

### Execução Contínua Em 2026-06-08 - Trigésima Primeira Passada

- [x] Reauditado H.7: já havia contratos fortes garantindo que `ollama-local` é rejeitado no roteamento default com
  `local_provider_requires_explicit_request`, e aceito somente via `provider:ollama`, perfil `local_private` ou opt-out
  explícito.
- [x] Encontrada e corrigida lacuna no caminho `onListModels`: modelos Ollama/local explícitos chegavam ao SDK, mas
  perdiam `routeLayer`/`wireApi` quando vinham como projection-only.
- [x] `createModelRecord()` agora preserva campos extras de `routing`, em vez de manter apenas `tier/useCases`.
- [x] `env-byok-compat-importer` marca `ollama-local` como `routeLayer: "local_daemon"`, `wireApi:
  "openai_compatible"`, `runtimeKind: "local"` e `localPrivate: true`; `ollama-cloud` é marcado como cloud/direct.
- [x] `buildModelGatewayRouteCandidates()` preserva `routeLayer`/`wireApi` da projeção quando não há route option com
  política própria, evitando sobrescrever metadata operacional com `null`.
- [x] Adicionado contrato de `onListModels` para Ollama/local explícito, garantindo metadata local privada no catálogo
  SDK.
- [x] Validado com `npx vitest run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t
  "onListModels|Ollama/local"` (3 testes focados; 216 skipped).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Primeira Passada

- [x] SDK10-P31-01: revisar a faixa I de rotas server/public contracts após H.5-H.7; confirmar que endpoints HTTP
  também expõem/filtram metadata de modelo de forma consistente com o terminal.

### Execução Contínua Em 2026-06-08 - Trigésima Segunda Passada

- [x] Endurecida a borda HTTP de `/sdk/models`: o payload retornado por `client.listModels()` agora passa por
  `redactSecretRecord()` antes de sair pelo `res.json`.
- [x] A rota preserva metadata operacional útil para SDK 1.0/BYOK, incluindo `byok.provider`, `providerModel`,
  `routeLayer`, `wireApi`, `supportedReasoningSummaries` e `supportedContextTiers`.
- [x] Adicionado contrato de rota garantindo que um modelo Ollama/local explícito mantém metadata de provider/capacidade
  e redige `apiKey`/`Authorization` no payload público.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_runtime_projection_routes.spec.js` (1 arquivo,
  12 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Segunda Passada

- [x] SDK10-P32-01: atualizar README/contratos de rotas SDK para documentar `/models` com metadata SDK 1.0, BYOK/local e
  redaction obrigatória em superfícies públicas.

### Execução Contínua Em 2026-06-08 - Trigésima Terceira Passada

- [x] `server/routes/sdk/README.md` agora declara contratos públicos para respostas runtime-aware, incluindo
  `runtimeId`, `requestedRuntimeId`, `runtimeFound` e `usedDefaultRuntimeFallback`.
- [x] Documentada a regra de redaction em fronteiras HTTP para payloads agregados de SDK, provider, hooks, audit e
  observability.
- [x] Documentado `GET /models` como visão HTTP canônica de `client.listModels()`/`onListModels`, preservando metadata
  SDK 1.0/BYOK/local e proibindo vazamento de `apiKey`, `Authorization`, headers e tokens.

### Achados Novos Da Trigésima Terceira Passada

- [x] SDK10-P33-01: revisar a rota de criação/resume de sessão para garantir que campos SDK 1.0 de provider/reasoning,
  agent/skills e disponibilidade de ferramentas não entrem por caminhos paralelos ou nomes legados conflitantes.

### Execução Contínua Em 2026-06-08 - Trigésima Quarta Passada

- [x] Reauditada a precedência dos aliases locais `configDir`, `createSessionFsHandler` e `disableResume` no boundary
  `sdk/session/lifecycle.js`.
- [x] Corrigido bug de padronização: quando nome oficial e alias local chegam juntos, o nome oficial SDK 1.0 agora vence
  também no lifecycle direto, não apenas nas rotas HTTP.
- [x] `configDirectory` vence `configDir`, `createSessionFsProvider` vence `createSessionFsHandler` e
  `suppressResumeEvent` vence `disableResume`.
- [x] Adicionados contratos de lifecycle para create/resume impedindo que aliases legados sobrescrevam nomes oficiais.
- [x] Validado com `npx vitest run tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js` (1 arquivo,
  18 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Quarta Passada

- [x] SDK10-P34-01: adicionar contratos HTTP de create/resume garantindo que aliases aceitos na borda seguem a mesma
  precedência dos nomes oficiais SDK 1.0 antes de chegar ao `sdkSession`.

### Execução Contínua Em 2026-06-08 - Trigésima Quinta Passada

- [x] Adicionados contratos HTTP em `test_sdk_route_session_ownership` para create/resume com alias e nome oficial no
  mesmo body.
- [x] `POST /sessions` agora tem teste explícito de que `configDirectory` vence `configDir` antes de chamar
  `sdkSession.createClientSession`.
- [x] `POST /sessions/:id/resume` agora tem teste explícito de que `configDirectory` vence `configDir` e
  `suppressResumeEvent` vence `disableResume` antes de chamar `sdkSession.resumeClientSession`.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_route_session_ownership.spec.js` (1 arquivo,
  19 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Quinta Passada

- [x] SDK10-P35-01: revisar logs de rotas/session-core para garantir que model/session/reasoning aparecem de forma
  padronizada e que erro/provider/token continuam redigidos em caminhos de erro e sucesso.

### Execução Contínua Em 2026-06-08 - Trigésima Sexta Passada

- [x] Encontrado gap de segurança nos wrappers de erro das rotas SDK: respostas HTTP 4xx e logs podiam receber a
  mensagem de erro já sanitizada, mas ainda sem redaction específica de tokens.
- [x] `projectSdkHttpError()` agora aplica `redactSecretText()` sobre a mensagem pública sanitizada antes de montar o
  body JSON.
- [x] `withErrorHandler()` compartilhado e `session-middleware.withErrorHandler()` agora registram mensagens de erro
  redigidas, preservando status/código sem vazar `Authorization`, `apiKey` ou tokens.
- [x] Adicionado teste dedicado cobrindo resposta e log dos dois middlewares.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_route_error_redaction.spec.js` (1 arquivo, 2 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Sexta Passada

- [x] SDK10-P36-01: reexecutar live LLM-B após mudanças de lifecycle/HTTP/redaction para confirmar que `/session sdk`,
  `/sdk models`, `/metrics`, `/events` e `/errors` seguem legíveis e sem regressão operacional.

### Execução Contínua Em 2026-06-08 - Trigésima Sétima Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após mudanças de
  lifecycle, contratos HTTP e redaction de erro.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T10-27-01-474Z/summary.md`.
- [x] Confirmados boot terminal, BYOK pronto, `/usage now`, `/activity`, `/session sdk 6`,
  `/session sdk commands`, `/session sdk events`, `/session sdk waits`, `/metrics`, `/events`, `/events --raw`,
  `/errors 10` e `/quit`.
- [x] UX observada: linha `CommandDefinitions` continuou clara, `/session sdk events` explicou corretamente a janela
  vazia em resume silencioso, `/metrics` permaneceu legível e `/errors` reportou 0 erros rastreados.

### Achados Novos Da Trigésima Sétima Passada

- [x] SDK10-P37-01: investigar `/session sdk waits` estado vazio (“nenhuma espera SDK arquivada ainda”) para alinhar a
  cópia com `/session sdk events`, deixando explícito que resume silencioso sem ask_user/elicitation/permission é
  normal.

### Execução Contínua Em 2026-06-08 - Trigésima Oitava Passada

- [x] `/session sdk waits` agora explica o estado vazio como “nenhuma espera SDK arquivada nesta janela”, normal após
  resume silencioso ou quando não houve `ask_user`/elicitation/permission.
- [x] Mantido atalho para `/sdk waits` como fonte das pendências vivas e `/events --raw` como auditoria bruta.
- [x] Adicionado teste de UX para estado vazio, além do teste existente que agrega ask_user, elicitation e permission.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js` (1 arquivo, 50 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Oitava Passada

- [x] SDK10-P38-01: revisar `/sdk waits` principal para garantir que pendências vivas, histórico concluído e estado vazio
  usam a mesma linguagem operacional de `/session sdk waits`.

### Execução Contínua Em 2026-06-08 - Trigésima Nona Passada

- [x] `/sdk waits` agora deixa claro que mostra pendências humanas vivas no momento, não o archive histórico.
- [x] Estado vazio passou a dizer “sem espera humana viva agora; normal após resume silencioso ou sem
  ask_user/elicitation/permission”.
- [x] Adicionado atalho explícito para o histórico em `/session sdk waits` e auditoria bruta em `/events --raw`.
- [x] Adicionado teste de UX para estado vazio de `/sdk waits`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js` (1 arquivo, 42 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Trigésima Nona Passada

- [x] SDK10-P39-01: revisar help/menu para diferenciar `/sdk waits` (pendências vivas) de `/session sdk waits`
  (histórico/archive), evitando orientação ambígua no terminal.

### Execução Contínua Em 2026-06-08 - Quadragésima Passada

- [x] Menu inteligente agora descreve `/sdk waits` como pendências vivas agora e aponta o histórico para
  `/session sdk waits`.
- [x] Help completo diferencia `/session sdk waits [n]` como histórico/archive de perguntas, formulários e permissões,
  enquanto `/sdk waits` é pendência humana viva.
- [x] Adicionados contratos em `test_commands_menu` e `test_commands_help` para impedir regressão de copy/expectativa.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_menu.spec.js
  tests/unit/copilot/terminal/test_commands_help.spec.js` (2 arquivos, 14 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Passada

- [x] SDK10-P40-01: revisar o diff acumulado e identificar a próxima área de maior risco SDK 1.0 antes de ampliar mais
  mudanças, preservando alterações do operador e evitando misturar escopos.

### Execução Contínua Em 2026-06-08 - Quadragésima Primeira Passada

- [x] Revisado `git status --short`, `git diff --stat` e o diff focado das mudanças recentes de lifecycle, middleware
  SDK e UX terminal.
- [x] Confirmado que há alterações pré-existentes fora do nosso escopo imediato, incluindo `.codex/config.toml`,
  `agent-runtime-events.js` e roadmap terminal não rastreado; nenhuma foi revertida.
- [x] Identificado novo risco de borda: `GET /sessions` e `GET /sessions/:id` devolviam metadata/listagem do SDK sem
  redaction dedicada, diferente do hardening recém-feito para `/models` e observability.

### Achados Novos Da Quadragésima Primeira Passada

- [x] SDK10-P41-01: proteger metadata pública de sessões SDK (`listSessions`/`getSessionMetadata`) com redaction de
  borda, preservando ownership/runtime meta e sem vazar provider headers/tokens.

### Execução Contínua Em 2026-06-08 - Quadragésima Segunda Passada

- [x] `session-crud.js` agora aplica `redactSecretRecord()` em payloads externos de `GET /sessions` e
  `GET /sessions/:id`.
- [x] A resposta preserva `sessionId`, ownership compartilhado e runtime meta, mas redige `apiKey`, `Authorization`,
  `headers` e tokens em metadata/listagens do SDK.
- [x] Adicionados testes cobrindo listagem e detalhe de sessão com provider metadata contendo segredos.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_route_session_ownership.spec.js` (1 arquivo,
  21 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Segunda Passada

- [x] SDK10-P42-01: revisar `GET /sessions/:id/messages` e endpoints de workspace/timeline para decidir quais são
  conteúdo intencional do usuário versus superfícies diagnósticas que devem passar por redaction de borda.

### Execução Contínua Em 2026-06-08 - Quadragésima Terceira Passada

- [x] Classificados endpoints de conteúdo: `/sessions/:id/messages` e `/workspace/file` continuam devolvendo conteúdo
  intencional do usuário/SDK, sem redaction destrutiva por default.
- [x] Endpoints diagnósticos de workspace agora redigem mensagens de erro serializadas por `sendError()`, cobrindo
  `INVALID_LOCAL_PATH`, `MISSING_FILE_TOOL` e outros erros manuais.
- [x] Motivos derivados de exceção em itens/métricas de workspace também passam por `redactSecretText()` antes de entrar
  na resposta/observabilidade.
- [x] Adicionado teste garantindo que erro de path local com token-like string não ecoa segredo no JSON público.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js` (1 arquivo,
  11 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Terceira Passada

- [x] SDK10-P43-01: revisar endpoints de `session-core` (`send`, `model`, `abort`, `messages`) para padronizar
  respostas diagnósticas, redaction em erro manual e indicação de reasoningSummary/contextTier na UX/HTTP.

### Execução Contínua Em 2026-06-08 - Quadragésima Quarta Passada

- [x] Reauditado `session-core`: `send`/`messages` continuam sendo conteúdo intencional, enquanto `/model` é superfície
  diagnóstica de configuração de modelo.
- [x] `/sessions/:id/model` já respondia `reasoningSummary` e `contextTier`; o contrato de teste agora cobre também o
  passthrough desses campos ao SDK.
- [x] Log operacional de troca de modelo agora inclui `reasoning`, `summary` e `context` quando informados, além de
  effective/verified/rpc-fallback.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_route_session_ownership.spec.js` (1 arquivo,
  21 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Quarta Passada

- [x] SDK10-P44-01: revisar a UX de `/model` e `/reasoning` no terminal para garantir que `reasoningSummary` e
  `contextTier` não fiquem invisíveis quando configurados pelo SDK/model route.

### Execução Contínua Em 2026-06-08 - Quadragésima Quinta Passada

- [x] Confirmado que o estado ativo do terminal ainda projeta apenas `reasoningEffort`; adicionar summary/context ao
  runtime state exigirá uma mudança de estado mais ampla.
- [x] Feita melhoria conservadora em `/model list`: quando o catálogo SDK/BYOK traz `supportedReasoningEfforts`,
  `supportedReasoningSummaries` e `supportedContextTiers`, a lista exibe esses valores junto do modelo.
- [x] Isso alinha `/model list` com `/sdk models`, evitando que o operador veja support de summary/context em um comando
  e perca esse sinal no outro.
- [x] Adicionado teste de UX para catálogo enriquecido.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_config_errors.spec.js` (1 arquivo,
  14 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Quinta Passada

- [x] SDK10-P45-01: investigar se `readTerminalRuntimeState`/projeções de config devem carregar
  `reasoningSummary/contextTier` efetivos, ou se esses campos devem continuar apenas no nível de seleção/model catalog
  até haver source-of-truth confiável do SDK.

### Execução Contínua Em 2026-06-08 - Quadragésima Sexta Passada

- [x] Confirmado que `readRuntimeModelSelection()` lê apenas `model` e `reasoningEffort` do snapshot vivo do agent.
- [x] `AgentContext`/runtime persistem `reasoningEffort`, mas não há campos equivalentes para
  `reasoningSummary/contextTier` nem confirmação efetiva vinda do SDK.
- [x] Decisão: não projetar `reasoningSummary/contextTier` como estado efetivo do runtime ainda; manter esses campos em
  seleção enviada (`/sessions/:id/model`) e capabilities/catálogo (`/sdk models`, `/model list`) até existir fonte
  canônica confiável.
- [x] Risco evitado: mostrar summary/context como “ativo” no prompt/status sem confirmação do SDK criaria precisão falsa
  para o operador.

### Achados Novos Da Quadragésima Sexta Passada

- [x] SDK10-P46-01: rodar nova live LLM-B após mudanças de waits/help/model list/session-core/workspace para validar que
  a UX terminal continua limpa e que as novas copies aparecem sem quebrar critérios.

### Execução Contínua Em 2026-06-08 - Quadragésima Sétima Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após mudanças de
  waits/help/model list/session-core/workspace.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T10-42-03-855Z/summary.md`.
- [x] Confirmado em terminal real que `/session sdk waits` agora mostra “nenhuma espera SDK arquivada nesta janela;
  normal após resume silencioso ou sem ask_user/elicitation/permission”.
- [x] `/session sdk`, `/session sdk events`, `/metrics`, `/events`, `/events --raw` e `/errors 10` continuaram legíveis,
  sem erros rastreados.

### Achados Novos Da Quadragésima Sétima Passada

- [x] SDK10-P47-01: apertar critérios do harness live LLM-B para exigir a nova copy de `/session sdk waits`, evitando que
  regressões futuras passem apenas porque o comando foi executado.

### Execução Contínua Em 2026-06-08 - Quadragésima Oitava Passada Live LLM-B

- [x] Adicionado critério `sdk-session-waits-empty-state-human` ao harness `llmBLiveTest --no-pr`.
- [x] O critério exige a copy “nenhuma espera SDK arquivada nesta janela”, a explicação de resume silencioso sem
  `ask_user`/elicitation/permission e o ponteiro para `/sdk waits` como pendências vivas.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T10-43-38-329Z/summary.md`.
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Oitava Passada

- [x] SDK10-P48-01: rodar uma bateria focada dos testes alterados no bloco P31-P48 para capturar interações entre
  rotas HTTP, lifecycle, workspace, waits/help/model list e harness live.

### Execução Contínua Em 2026-06-08 - Quadragésima Nona Passada

- [x] Rodada bateria focada cobrindo rotas SDK, lifecycle, workspace, waits/help/model list e redaction de erro:
  `test_sdk_runtime_projection_routes`, `test_sdk_route_session_ownership`, `test_sdk_route_error_redaction`,
  `test_sdk_workspace_materialize_route`, `test_sdk_session_core_lifecycle`, `test_commands_session`,
  `test_commands_sdk`, `test_commands_config_errors`, `test_commands_menu` e `test_commands_help`.
- [x] Resultado: 10 arquivos, 184 testes passando.
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quadragésima Nona Passada

- [x] SDK10-P49-01: varrer rotas SDK remanescentes por `res.json`/payload público que ainda agregue dados externos sem
  redaction ou sem classificação explícita como conteúdo intencional.

### Execução Contínua Em 2026-06-08 - Quinquagésima Passada

- [x] Varridos `res.json`, `sendOk()` e `sendError()` em `server/routes/sdk`.
- [x] Classificados payloads de RPC/UI/shell/workspace/mensagens como conteúdo intencional quando retornam resultado
  explícito da ação do operador.
- [x] Encontrado hardening simples em `getActiveSessionEntryOrReply()`: o 404 de sessão ativa ecoava o `sessionId` da
  URL no texto de erro.
- [x] O helper agora redige `sessionId` token-like no erro 404 antes de montar a resposta pública.
- [x] Adicionado teste cobrindo `/sessions/:id/model` com `sessionId` token-like ausente.
- [x] Validado com `npx vitest run tests/unit/copilot/test_sdk_route_session_ownership.spec.js` (1 arquivo,
  22 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quinquagésima Passada

- [x] SDK10-P50-01: revisar `hooks.js` e SSE de hooks para metadata externa, redaction em snapshots e ergonomia de
  resposta inicial/listagem.

### Execução Contínua Em 2026-06-08 - Quinquagésima Primeira Passada

- [x] Reauditado `hooks.js`: `/hooks/registry` é catálogo declarativo, mas `/hooks/events` transmite payload vivo de
  HookBus com `input`/`output` potencialmente externos.
- [x] O SSE de hooks agora aplica `redactSecretRecord()` ao payload padronizado antes de `pool.broadcast('hook', ...)`.
- [x] Adicionado contrato em `test_security_hardening` garantindo que o broadcast de hooks passa por redaction.
- [x] Validado com `npx vitest run tests/unit/copilot/test_security_hardening.spec.js` (1 arquivo, 4 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quinquagésima Primeira Passada

- [x] SDK10-P51-01: atualizar README/contratos das rotas SDK com a classificação “conteúdo intencional cru” versus
  “diagnóstico/metadata redigido”, cobrindo sessions, workspace, hooks e observability.

### Execução Contínua Em 2026-06-08 - Quinquagésima Segunda Passada

- [x] `server/routes/sdk/README.md` agora documenta classificação de payload por rota antes do `res.json`.
- [x] Conteúdo intencional pode permanecer cru: mensagens, conteúdo explícito de workspace, output de shell/tool/RPC e
  respostas de UI solicitadas pelo caller.
- [x] Metadata diagnóstica deve ser redigida: modelos, sessões, hook events, observability, audit/log/error,
  convergence reasons e provider/BYOK records.
- [x] Payloads mistos devem redigir a casca diagnóstica sem destruir conteúdo solicitado, como já aplicado em workspace.
- [x] Decisão registrada: não inventar campos efetivos de modelo/reasoning sem fonte confiável do SDK/runtime.

### Achados Novos Da Quinquagésima Segunda Passada

- [x] SDK10-P52-01: revisar testes/contratos de arquitetura para garantir que novas rotas SDK futuras sigam a
  classificação de payload e passem por `deps.js`/helpers compartilhados.

### Execução Contínua Em 2026-06-08 - Quinquagésima Terceira Passada

- [x] Adicionado contrato em `test_arch_contracts` exigindo que `server/routes/sdk/README.md` documente “Payload
  Classification” e que o SSE de hooks use `redactSecretRecord()` antes de broadcast público.
- [x] O contrato arquitetural revelou dois bypasses existentes:
  `agent/dialog/wiring/user-input-handler.js` importava política via `#copilot/sdk/session`, e JSDocs externos em
  `channel/client-dialog.js`/`presentation/runtime/dialog.js` apontavam para o executor interno de turnos.
- [x] `resolveEffectiveUserInputAllowFreeform` agora sai pelo barrel público `#copilot/sdk`, e o agente consome essa
  fronteira canônica em vez do submódulo `sdk/session`.
- [x] `DialogTurnSemanticResult` ganhou alias público em `#copilot/agent/types`; consumidores externos passaram a usar o
  seam permitido sem conhecer `agent/dialog/executors/turn-executor.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/contracts/test_arch_contracts.spec.js` (1 arquivo, 76 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quinquagésima Terceira Passada

- [x] SDK10-P53-01: revisar o barrel `#copilot/sdk` e contratos de exports para garantir que helpers públicos promovidos
  do SDK 1.0 estejam disponíveis sem deep-imports, sem duplicatas e com testes cobrindo os novos símbolos de user-input.

### Execução Contínua Em 2026-06-08 - Quinquagésima Quarta Passada

- [x] `test_sdk_barrel` agora exige os helpers públicos `USER_INPUT_FREEFORM_POLICY`,
  `normalizeUserInputChoices` e `resolveEffectiveUserInputAllowFreeform` no barrel `#copilot/sdk`.
- [x] Rodada bateria de barrels com `test_sdk_barrel`, `test_sdk_barrel_f23`, `test_barrel_contracts` e
  `test_barrel_contracts_i7`.
- [x] Resultado: 4 arquivos, 94 testes passando.
- [x] Varrido uso de `#copilot/sdk/session`; ainda há consumidores legados/intencionais em hooks, facades, event
  handlers, probes e bootstrap, então a próxima migração deve ser por recortes seguros em vez de troca mecânica ampla.

### Achados Novos Da Quinquagésima Quarta Passada

- [x] SDK10-P54-01: reduzir deep-imports `#copilot/sdk/session` em composition roots, event handlers e observability
  quando os símbolos já estão no barrel público `#copilot/sdk`, preservando wrappers de compatibilidade em hooks/facades.

### Execução Contínua Em 2026-06-08 - Quinquagésima Quinta Passada

- [x] `runtime-wiring.js` passou a consumir `configureDefaultUserInputContext` pelo barrel público `#copilot/sdk`.
- [x] `observability/bootstrap.js` passou a consumir `defaultHookBus`/`setHooksLogger` pelo barrel público
  `#copilot/sdk`, mantendo `#copilot/sdk/telemetry` e `#copilot/sdk/tools` como bypasses já autorizados.
- [x] A primeira tentativa de mover event handlers/collectors para o barrel raiz expôs um problema real de arquitetura:
  imports leves do terminal passaram a carregar demais e `test_terminal_agent_runtime_events` estourou timeout de 15s.
- [x] Corrigido rumo criando um seam leve em `#copilot/events/sdk-events`, agora exportando listeners de sessão,
  capabilities e normalizers de eventos usados por `event-handlers/` e `observability/collectors/`.
- [x] Event handlers e collectors saíram de `#copilot/sdk/session` sem passar pelo barrel raiz pesado.
- [x] Validado com `test_terminal_agent_runtime_events` (35 testes), `test_sdk_zero_bypass_f33` (29 testes), bateria focada
  de observability/event handlers (6 arquivos, 101 testes), `npm run typecheck:strict:src.copilot` e `npm run
  lint:copilot`.

### Achados Novos Da Quinquagésima Quinta Passada

- [x] SDK10-P55-01: adicionar contrato explícito para proteger `event-handlers/` e `observability/collectors/` contra
  imports diretos de `#copilot/sdk` ou `#copilot/sdk/session`, exigindo o seam leve `#copilot/events/sdk-events`.

### Execução Contínua Em 2026-06-08 - Quinquagésima Sexta Passada

- [x] `test_arch_contracts` agora tem guarda dedicada: `event-handlers/` e `observability/collectors/` não podem importar
  `#copilot/sdk` nem `#copilot/sdk/session` diretamente.
- [x] O contrato cristaliza a decisão de UX/import graph: handlers de eventos devem passar pelo seam leve
  `#copilot/events/sdk-events`.
- [x] Validado com `npx vitest run tests/unit/copilot/contracts/test_arch_contracts.spec.js` (1 arquivo, 77 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quinquagésima Sexta Passada

- [x] SDK10-P56-01: reexecutar live LLM-B após a mudança de import graph/event seam para confirmar que o terminal real
  continua responsivo e que `/session sdk`/eventos seguem legíveis.

### Execução Contínua Em 2026-06-08 - Quinquagésima Sétima Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após a migração para
  `#copilot/events/sdk-events`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-02-51-069Z/summary.md`.
- [x] Confirmado no terminal real que `/session sdk`, `/session sdk commands`, `/session sdk events`,
  `/session sdk waits`, `/metrics`, `/events`, `/events --raw` e `/errors 10` continuam legíveis.
- [x] O critério `sdk-session-waits-empty-state-human` passou novamente, preservando a copy de resume silencioso sem
  `ask_user`/elicitation/permission.
- [x] O tracker de erros do terminal permaneceu limpo e o processo encerrou por `/quit` com copy humana.

### Achados Novos Da Quinquagésima Sétima Passada

- [x] SDK10-P57-01: adicionar teste de contrato para o facade `#copilot/events/sdk-events`, cobrindo listeners,
  capabilities e normalizers usados por event handlers/collectors sem carregar o barrel raiz do SDK.

### Execução Contínua Em 2026-06-08 - Quinquagésima Oitava Passada

- [x] `test_barrel_contracts` agora valida que `#copilot/events/sdk-events` exporta listeners de sessão, capabilities e
  normalizers usados por `event-handlers/` e `observability/collectors/`.
- [x] O mesmo contrato verifica que `events/sdk-events.js` não importa o barrel raiz pesado `#copilot/sdk`, preservando
  o caminho leve via `#copilot/sdk/session`.
- [x] Validado com `npx vitest run tests/unit/copilot/contracts/test_barrel_contracts.spec.js
  tests/unit/copilot/contracts/test_arch_contracts.spec.js` (2 arquivos, 85 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quinquagésima Oitava Passada

- [x] SDK10-P58-01: revisitar a renderização de eventos do terminal com o seam de eventos estabilizado, buscando labels,
  timestamps e empty states ainda desalinhados nos comandos `/events`, `/events --raw` e `/session sdk events`.

### Execução Contínua Em 2026-06-08 - Quinquagésima Nona Passada

- [x] Reauditada renderização de `/events`, `/events --raw`, `/session sdk events` e `/session sdk waits`.
- [x] Identificado desalinhamento em `/events` com filtros diagnósticos (`trace`, `turn`, `request`, `hub`, tool): a
  linha humana trocava para ISO seco em segundos, perdendo idade relativa e precisão de milissegundos.
- [x] `/events` filtrado agora usa `formatTerminalTimeLabel(..., mode: 'dual')`, mantendo ISO local completo com idade
  relativa e exibindo IDs diagnósticos na mesma linha.
- [x] Teste de `/events` passou a exigir timestamp dual completo e label humano de rastreamento.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 25 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Quinquagésima Nona Passada

- [x] SDK10-P59-01: investigar `/events --json` e `createRawPreviewEntry()` para confirmar que snapshots técnicos seguem
  úteis, redigidos quando necessário e sem divergência de campos públicos em relação ao archive SSE.

### Execução Contínua Em 2026-06-08 - Sexagésima Passada

- [x] Reauditado `/events --json`, `/events --raw full` e preview raw.
- [x] A saída explícita agora mantém o formato técnico, mas passa por `redactSecretRecord()` antes de imprimir no
  terminal; o archive JSONL em disco continua íntegro para auditoria local.
- [x] `createRawPreviewEntry()` resume payload já redigido, evitando que fallback de `JSON.stringify(payload)` reexponha
  bearer/api key.
- [x] Teste novo cobre `/events --json`, `--raw full` e preview raw com `Authorization: Bearer ...` e
  `api_key=sk-...`, preservando shape e removendo segredo.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 26 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Sexagésima Passada

- [x] SDK10-P60-01: ampliar o harness live LLM-B para consultar `/events --json` além de `/events --raw`, garantindo que
  a superfície estruturada continua parseável, redigida e sem abrir turno.

### Execução Contínua Em 2026-06-08 - Sexagésima Primeira Passada Live LLM-B

- [x] `llmBLiveTest --no-pr` agora executa `/events 20 --json` além de `/events 20` e `/events 20 --raw`.
- [x] Adicionado extrator tolerante para JSON multi-linha no harness, validando um objeto com `state`, `filters` e
  `entries`.
- [x] Novo critério `sse-archive-json-parseable` exige que `/events --json` renderize archive estruturado sem abrir turno
  explícito.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-10-28-802Z/summary.md`; critério novo passou com 18
  eventos estruturados.

### Achados Novos Da Sexagésima Primeira Passada

- [x] SDK10-P61-01: revisar a saída JSON pública de `/events --json` após o live; ela é parseável, mas imprime payloads
  longos de boot/activity, então vale investigar um modo `--json compact` ou envelope resumido para UX de operador.

### Execução Contínua Em 2026-06-08 - Sexagésima Segunda Passada

- [x] Adicionado modo `/events --json compact`, que preserva `state`, `filters` e `entries`, mas troca `payload` completo
  por `payloadKeys`/`payloadPreview` redigidos.
- [x] `/events` humano agora sugere `/events --json compact` na linha de detalhe.
- [x] O harness live passou a executar `/events 20 --json compact`, reduzindo ruído sem perder parseabilidade.
- [x] Teste unitário cobre JSON full como contrato de automação e JSON compact como contrato de UX/diagnóstico leve.
- [x] Uma primeira rodada live falhou em `sse-archive-json-parseable` por bug do harness: o extrator contava `{` dentro
  de strings `payloadPreview`.
- [x] Corrigido o extrator com contagem de chaves consciente de strings e escapes.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 27 testes),
  `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`, `npm run
  typecheck:strict:src.copilot` e `npm run lint:copilot`.
- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-13-51-704Z/summary.md`; critério
  `sse-archive-json-parseable` passou com 18 eventos compactos.

### Achados Novos Da Sexagésima Segunda Passada

- [x] SDK10-P62-01: revisar os previews compactos de `/events --json compact` para reduzir ainda mais JSON cru em
  `payloadPreview` de eventos de boot/quota, preferindo resumos humanos quando houver campos conhecidos.

### Execução Contínua Em 2026-06-08 - Sexagésima Terceira Passada

- [x] Adicionados resumos humanos para `terminal.runtime.wired`, `terminal.started`, `quota.warning`,
  `agent.background.completed` e `agent.background.idle`.
- [x] `payloadPreview` compacto agora mostra frases como “fase runtime config · preflight ok · 7ms”, “modelo auto”,
  “premium interactions · sem quota” e “estado concluído · session.cleanup.stale”, em vez de cair direto em JSON cru.
- [x] Ajustado `quotaId` para passar por humanização de tipo, removendo underscore visível no preview.
- [x] Teste novo cobre boot, quota e background no preview raw/compact e garante ausência de fallback `{"...` nos casos
  conhecidos.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 28 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Sexagésima Terceira Passada

- [x] SDK10-P63-01: revisar mensagens de help/detalhe relacionadas a `/events --json compact` para evitar que comandos
  antigos continuem sugerindo JSON full quando o operador quer diagnóstico leve.

### Execução Contínua Em 2026-06-08 - Sexagésima Quarta Passada

- [x] `/events --raw` agora sugere três saídas distintas: raw full, JSON leve com `/events <n> --json compact` e JSON
  full com `/events <n> --json`.
- [x] `/help` passou a listar `/events [n|sources|trace|tool|--json compact]`, deixando explícita a rota compacta de
  diagnóstico.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js
  tests/unit/copilot/terminal/test_commands_help.spec.js` (2 arquivos, 31 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Sexagésima Quarta Passada

- [x] SDK10-P64-01: rodar um live LLM-B curto após os ajustes de `/events --json compact`/help para confirmar que a saída
  compacta segue parseável e visualmente menor no terminal real.

### Execução Contínua Em 2026-06-08 - Sexagésima Quinta Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após os ajustes de
  `/events --json compact`, previews humanos e help.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-19-17-075Z/summary.md`.
- [x] Confirmado no terminal real que `/events` default passou a resumir boot/quota com detalhes humanos, por exemplo
  `fase runtime config · preflight ok`, `modelo auto` e `premium interactions · sem quota`.
- [x] Confirmado que `/events --raw` sugere raw full, JSON leve e JSON full em linhas explícitas.
- [x] Confirmado que `/events 20 --json compact` continua parseável; critério `sse-archive-json-parseable` passou com
  18 eventos estruturados e sem abrir turno.

### Achados Novos Da Sexagésima Quinta Passada

- [x] SDK10-P65-01: revisar outros comandos com saída JSON/diagnóstica (`/terminal libs json`, `/tools raw`,
  `/sdk ... --raw`) para aplicar a mesma separação entre JSON full, JSON compacto e redaction quando fizer sentido.

### Execução Contínua Em 2026-06-08 - Sexagésima Sexta Passada

- [x] Revisadas superfícies de saída técnica em `/terminal libs json`, `/tools raw`, `/tools diag` e comandos SDK com
  `raw/json`.
- [x] Decisão: conteúdo de workspace/SDK solicitado explicitamente permanece conteúdo intencional; não deve ser
  compactado/redigido genericamente como metadata diagnóstica.
- [x] `/tools` agora sugere `/events --json compact` como trilha estruturada leve, mantendo `/tools raw` apenas como
  nomes crus e `/events --raw` como auditoria bruta.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js
  tests/unit/copilot/terminal/test_commands_help.spec.js` (2 arquivos, 16 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Sexagésima Sexta Passada

- [x] SDK10-P66-01: rodar uma bateria focada de terminal/events/session/sdk/tools após as mudanças de UX para capturar
  regressões entre comandos vizinhos antes de nova rodada ampla.

### Execução Contínua Em 2026-06-08 - Sexagésima Sétima Passada

- [x] Rodada bateria focada de terminal e contratos após mudanças em `/events`, `/tools`, seam de eventos SDK e live
  harness.
- [x] Comando: `npx vitest run test_commands_events test_commands_session test_commands_sdk test_commands_tools
  test_commands_help test_commands_menu test_arch_contracts test_barrel_contracts`.
- [x] Resultado: 8 arquivos, 232 testes passando.
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Sexagésima Sétima Passada

- [x] SDK10-P67-01: reabrir itens antigos ainda pendentes de UX/eventos SDK 1.0 no roadmap e escolher o próximo patch
  com maior impacto em operador humano.

### Execução Contínua Em 2026-06-08 - Sexagésima Oitava Passada

- [x] Reaberta a frente K.2/P67 de labels humanos para `ask_user`, `request_user_input`, `report_intent`, tools e
  intents.
- [x] Confirmado que `report_intent`/`report_intent_local` já convergem para “Intenção capturada” no presenter,
  lifecycle, `/intent`, `/activity` e `/tools` default.
- [x] Encontrado gap no glossário de nomes canônicos SDK 1.0: aliases legados como `glob` e `view` tinham boa
  apresentação, mas nomes canônicos como `list_directory`, `search_in_files`, `list_available_tools`, `run_tests`,
  `session_plan_update` e `workspace_index_search` ainda podiam vazar em superfícies default.
- [x] Expandido o glossário central de `tool-activity-presenter.js` para tools canônicas de arquivos, workspace, git,
  sessão, diagnóstico e execução.
- [x] Teste novo garante que `humanizeTerminalToolSurfaceText()` troca nomes canônicos SDK 1.0 por labels humanos e não
  regride para identificadores snake_case nos resumos default.
- [x] Consolidada em teste a decisão de UX do SDK atual: escolhas de `request_user_input` são sugestões; texto livre
  permanece permitido mesmo quando payload legado carrega `allowFreeform: false`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js
  tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js
  tests/unit/copilot/terminal/test_live_status_line.spec.js
  tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js` (5 arquivos, 103 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Sexagésima Oitava Passada

- [x] SDK10-P68-01: revisar projeções de métricas/telemetria de tools para garantir que raw, canônico e label humano
  fiquem explicitamente separados e que `/tools raw` continue sendo a única superfície default com nomes crus.

### Execução Contínua Em 2026-06-08 - Sexagésima Nona Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após expansão do
  glossário SDK 1.0 de tools.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-29-40-945Z/summary.md`.
- [x] Confirmado no terminal real que `/events --json compact` continua parseável; critério
  `sse-archive-json-parseable` passou com 18 eventos estruturados e sem abrir turno.
- [x] Confirmado que `/errors 10` permaneceu limpo e que a saída default de `/events` preserva previews humanos de
  boot/quota/background.
- [x] Observação UX: `/session sdk commands` exibe descrições de CommandDefinitions sem acentuação (“diagnostico”,
  “saude”, “sessao”, “canonicos”), destoando do restante do terminal em português.

### Achados Novos Da Sexagésima Nona Passada

- [x] SDK10-P69-01: corrigir strings de descrição do catálogo `terminal_session_*` para português acentuado e padronizado.
- [x] SDK10-P69-02: ajustar o resumo do harness para nomear explicitamente `/events --json compact` no critério
  `sse-archive-json-parseable`.

### Execução Contínua Em 2026-06-08 - Septuagésima Passada

- [x] Atualizadas descrições visíveis das CommandDefinitions do terminal para português acentuado e vocabulário
  padronizado: “diagnóstico de saúde”, “sessão SDK viva”, “arquivo SSE canônico”, “ciclo de vida” e “limite BYOK”.
- [x] O catálogo `/session sdk commands` agora mantém a estética textual do restante do terminal, sem “diagnostico”,
  “saude”, “sessao” ou “canonico” sem acento.
- [x] Ajustado o resumo do harness live para declarar `/events --json compact` no critério
  `sse-archive-json-parseable`.
- [x] Teste de `/session sdk commands` agora falha se o catálogo regredir para strings sem acentuação.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js
  tests/unit/copilot/test_session_setup.spec.js` (2 arquivos, 64 testes).
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Septuagésima Passada

- [x] SDK10-P70-01: procurar outros textos visíveis de CommandDefinitions/SDK cockpit que ainda usem “archive”,
  “lifecycle”, “health”, “boundary” ou termos crus quando há equivalente humano já padronizado no terminal.

### Execução Contínua Em 2026-06-08 - Septuagésima Primeira Passada

- [x] Varredura focada em strings visíveis do cockpit `/session sdk`, `/session sdk commands`, eventos SDK e waits SDK.
- [x] Padronizados textos do catálogo de CommandDefinitions:
  `safelist observável` -> `lista segura observável`; `fanout canônico` -> `emissão canônica`.
- [x] Padronizado resumo de erro do catálogo no cockpit principal:
  `archive com erro/indisponível` -> `arquivo SSE com erro/indisponível`.
- [x] Padronizada descrição BYOK do catálogo:
  `provider preparado, binding vivo e health resumido` -> `provedor preparado, vínculo vivo e saúde resumida`.
- [x] Teste de `/session sdk commands` protege contra regressão de `safelist`, `fanout`, `provider preparado`,
  `binding vivo`, `health resumido` e acentuação removida.
- [x] Teste novo cobre o caminho de erro do arquivo SSE no resumo principal de `/session sdk`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js` (1 arquivo, 51 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Septuagésima Primeira Passada

- [x] SDK10-P71-01: revisar `/help` e textos de navegação para remover “histórico/archive” híbrido e apontar
  consistentemente para `/events --json compact` quando o operador quer trilha leve.

### Execução Contínua Em 2026-06-08 - Septuagésima Segunda Passada

- [x] Revisado `/help full` na seção de sessão SDK persistente e interações humanas.
- [x] `/session sdk events [n]` agora aparece como “ciclo de vida e comandos SDK pelo arquivo SSE canônico”.
- [x] `/session sdk waits [n]` agora aparece como “histórico de perguntas, formulários e permissões no arquivo SSE”.
- [x] `/events [n|sources|trace|tool|--json compact]` agora aparece como “arquivo SSE, JSON compacto e mapa de fontes
  canônicas”.
- [x] Teste de help protege contra regressão para `histórico/archive`, `archive SSE` e `lifecycle e comandos`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_help.spec.js
  tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js` (3
  arquivos, 82 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Septuagésima Segunda Passada

- [x] SDK10-P72-01: revisar live harness depois dos ajustes de help/catálogo para confirmar que o terminal real não
  voltou a mostrar termos híbridos em `/session sdk commands` e `/events`.

### Execução Contínua Em 2026-06-08 - Septuagésima Terceira Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` após ajustes de help e
  catálogo SDK.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-38-16-573Z/summary.md`.
- [x] Confirmado no terminal real que `/session sdk commands` mostra “lista segura observável”, “diagnóstico de saúde”,
  “arquivo SSE canônico”, “vínculo vivo”, “saúde resumida” e “emissão canônica”.
- [x] Confirmado que `/events --json compact` continua parseável; critério `sse-archive-json-parseable` passou com 18
  eventos estruturados e sem abrir turno.
- [x] Confirmado que `/errors 10` permaneceu limpo.
- [x] Observação UX: `/metrics` ainda mostra “Binding persistido coincide com a revisão atual do system prompt.” na linha
  de motivo do prompt, misturando inglês técnico em uma tela padrão do operador.
- [x] Observação de harness: o summary Markdown ainda usa “archive/canonical archive” em descrições de critérios, mesmo
  após o comando real preferir “arquivo SSE”.

### Achados Novos Da Septuagésima Terceira Passada

- [x] SDK10-P73-01: humanizar o motivo de prompt em `/metrics`/projeção de injeção, trocando “Binding persistido” por
  “Vínculo persistido” ou frase equivalente.
- [x] SDK10-P73-02: padronizar descrições dos critérios do live harness para “arquivo SSE”/“trilha SSE” em vez de
  “archive/canonical archive”, preservando IDs técnicos dos critérios.

### Execução Contínua Em 2026-06-08 - Septuagésima Quarta Passada

- [x] Humanizadas as razões públicas de `evaluateSystemPromptFreshness()`:
  “binding/system prompt/reload live” -> “vínculo/prompt do sistema/recarregamento vivo”.
- [x] `/metrics`, `/status` e `/sdk prompt` passam a receber a frase canônica já humanizada, sem criar tradutor paralelo
  por comando.
- [x] Fixtures de `/metrics` e `/status` atualizadas para proteger a frase “Vínculo persistido coincide com a revisão
  atual do prompt do sistema.” e rejeitar `binding ok`/`system prompt` na saída padrão.
- [x] Descrições humanas do live harness padronizadas para “SSE file” em vez de “SSE archive/canonical archive”, mantendo
  IDs técnicos como `sse-archive-json-parseable`.
- [x] Validado com `npx vitest run tests/unit/copilot/config/test_system_prompt_status.spec.js
  tests/unit/copilot/terminal/test_commands_session.spec.js
  tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js
  tests/unit/copilot/terminal/test_commands_sdk.spec.js` (4 arquivos, 103 testes).
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Septuagésima Quarta Passada

- [x] SDK10-P74-01: investigar `tests/unit/copilot/test_terminal_frontend_primary.spec.js` com `--hookTimeout=30000`:
  quatro falhas indicam timeline `mixed/reconciled` e contagem dobrada onde o teste esperava `hub/persistent`; separar
  regressão real de isolamento de fixture antes de ajustar expectativas.

### Execução Contínua Em 2026-06-08 - Septuagésima Quinta Passada

- [x] Investigada `test_terminal_frontend_primary`: o fixture injeta hub persistido (`a/b`) e bridge vivo (`olá/oi`) ao
  mesmo tempo.
- [x] Confirmado que a projection atual está correta ao classificar a timeline como `mixed`/`reconciled` com
  `reconciliationStatus: diverged` e `sync.status: blocked`, em vez de fingir autoridade puramente persistida.
- [x] Atualizadas expectativas para 4 turnos totais, 2 turnos de bridge vivo e conteúdo reconciliado
  `olá`, `oi`, `a`, `b`.
- [x] `readTerminalContextProjection()` agora é protegido por teste como `timelineSource: mixed` e
  `timelineAuthority: reconciled` nesse fixture divergente.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_frontend_primary.spec.js --hookTimeout=30000` (1
  arquivo, 17 testes).

### Achados Novos Da Septuagésima Quinta Passada

- [x] SDK10-P75-01: consolidar uma bateria focada de frontend/status/metrics/session/help após as mudanças em timeline e
  vocabulário de prompt para garantir que as projections vizinhas concordam.

### Execução Contínua Em 2026-06-08 - Septuagésima Sexta Passada

- [x] Rodada bateria focada juntando frontend primary, frescor de prompt, sessão, métricas/usage, help, events e SDK
  prompt.
- [x] Comando: `npx vitest run tests/unit/copilot/test_terminal_frontend_primary.spec.js
  tests/unit/copilot/config/test_system_prompt_status.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js
  tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js
  --hookTimeout=30000`.
- [x] Resultado: 7 arquivos, 151 testes passando.
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Septuagésima Sexta Passada

- [x] SDK10-P76-01: rodar live LLM-B após P73-P75 para confirmar no terminal real a frase nova do prompt e os detalhes do
  summary do harness.

### Execução Contínua Em 2026-06-08 - Septuagésima Sétima Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-47-33-073Z/summary.md`.
- [x] Confirmado no terminal real que `/metrics` mostra:
  “Vínculo persistido coincide com a revisão atual do prompt do sistema.”
- [x] Confirmado que o summary do harness usa “SSE file” nos critérios de arquivo/JSON compacto, preservando IDs técnicos
  como `sse-archive-json-parseable`.
- [x] Confirmado que `/events --json compact` continua parseável com 18 eventos estruturados, sem abrir turno.
- [x] Confirmado que `/errors 10` permaneceu limpo.

### Achados Novos Da Septuagésima Sétima Passada

- [x] SDK10-P77-01: revisar se o summary do harness deve usar “lifecycle/command” ou “ciclo de vida/comandos” nos detalhes
  humanos, preservando IDs técnicos e nomes de eventos.

### Execução Contínua Em 2026-06-08 - Septuagésima Oitava Passada

- [x] Padronizado o bloco de critérios SDK do live harness para português completo:
  cockpit principal, catálogo de CommandDefinitions, ciclo de vida/comandos, ask_user/elicitation/permission e janela
  vazia do arquivo SSE.
- [x] Preservados IDs técnicos de critérios e nomes de eventos/ferramentas (`CommandDefinitions`, `ask_user`,
  `elicitation`, `permission`) para automação e rastreabilidade.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Busca focada não encontrou mais `rendered lifecycle`, `canonical archive`, `SSE archive`, `archive tail`,
  `empty archive` ou `lifecycle/command diagnostics` no harness.

### Achados Novos Da Septuagésima Oitava Passada

- [x] SDK10-P78-01: revisar diff/status consolidado e escolher próxima frente estrutural além de textos de UX.

### Execução Contínua Em 2026-06-08 - Septuagésima Nona Passada

- [x] Reaberto SDK10-P2-03 após diff/status consolidado.
- [x] Confirmado na instalação atual que `cloud` não aparece no contrato local pesquisável de `SessionConfig` e não há
  fluxo terminal/server para cloud/remote UX.
- [x] Decisão explícita: não expor helper fluent `cloud()` no `SessionConfigBuilder` até existir produto/UX remoto
  desenhado.
- [x] `CompatSessionConfig` agora reconhece `cloud?: unknown` apenas para descarte deliberado em `build()`, impedindo que
  `merge({ cloud: ... })` vaze campo experimental/ambíguo para `createSession`.
- [x] `buildForResume()` também permanece sem `cloud`, preservando a separação create/resume e evitando fluxo paralelo
  escondido.
- [x] Teste novo cobre `build()` e `buildForResume()` sem `cloud` mesmo quando o campo entra via `merge()`.
- [x] Validado com `npx vitest run tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js` (1 arquivo, 69
  testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Septuagésima Nona Passada

- [x] SDK10-P79-01: revisar SDK10-P2-04 sobre heartbeat de pergunta humana no pacote terminal completo/live, agora que
  labels de ask_user/request_user_input e política freeform estão estabilizados.

### Execução Contínua Em 2026-06-08 - Octogésima Passada

- [x] Revisitada a proteção de heartbeat de pergunta humana em `agent-runtime-events.js`, preservando o comportamento
  local pré-existente: `ask_user` e `request_user_input` são estado humano, não progresso periódico de tool.
- [x] Confirmado que o pacote terminal cobre: heartbeat de `request_user_input` sem linha viva periódica, `ask_user`
  protocolar sem tool narration/SSE lifecycle, READY sem reanúncio visível, replay de pergunta pendente deduplicado e
  linha viva compacta `[PERG]` fora do pulso periódico.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js
  tests/unit/copilot/terminal/test_live_status_line.spec.js
  tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js
  tests/unit/copilot/terminal/test_human_question_renderer.spec.js` (4 arquivos, 71 testes).
- [x] SDK10-P2-04 fechado sem patch funcional adicional: a cobertura atual já bloqueia o ruído que motivou o item.

### Achados Novos Da Octogésima Passada

- [x] SDK10-P80-01: revisar a próxima frente estrutural em `src/copilot/terminal/events`, procurando termos crus,
  paralelismo de eventos e gaps de redaction/normalização entre SSE, activity log e linha viva.

### Execução Contínua Em 2026-06-08 - Octogésima Primeira Passada

- [x] Identificado gap real de hardening: `tool.lifecycle` aceitava campos textuais livres no construtor canônico, e
  `recordTerminalActivity()` preservava `detail`/`toolTarget` sem redaction central.
- [x] `activity-state` agora redige secrets em label, source, detail, toolName e toolTarget antes de expor snapshot,
  histórico ou eventos de activity.
- [x] `buildToolLifecycleEvent()` agora redige IDs, nomes, caminhos, targets, commands, filters, summaries,
  `progressMessage`, `partialOutput`, `ioTargets`, `ioError` e correlação antes da emissão SSE.
- [x] Testes novos cobrem activity snapshot/histórico sem secret e partial result sem secret em `tool.lifecycle`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_activity_state.spec.js
  tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js` (2 arquivos, 18 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Octogésima Primeira Passada

- [x] SDK10-P81-01: rodar live LLM-B após o hardening central de redaction para confirmar que `/events --json compact`,
  `/activity`, `/session sdk events` e `/errors` seguem legíveis e parseáveis no terminal real.

### Execução Contínua Em 2026-06-08 - Octogésima Segunda Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T11-59-37-672Z/summary.md`.
- [x] Confirmado `/activity 12` e `/activity 20` legíveis com estado ocioso e timeline operacional.
- [x] Confirmado `/session sdk`, `/session sdk commands`, `/session sdk events` e `/session sdk waits` renderizando
  cockpit/catálogo/arquivo SSE sem abrir turno.
- [x] Confirmado `/events 20 --json compact` parseável com 18 eventos estruturados e `/errors 10` limpo.
- [x] Confirmado que as novas descrições em português aparecem no terminal real: "arquivo SSE canônico",
  "diagnóstico de saúde", "provedor preparado" e "emissão canônica".

### Achados Novos Da Octogésima Segunda Passada

- [x] SDK10-P82-01: revisar no live/harness as linhas de critérios ainda em inglês (`activity-visible`,
  `sse-archive-*`) e decidir se devem ser mantidas como IDs humanos híbridos ou traduzidas preservando apenas o ID.

### Execução Contínua Em 2026-06-08 - Octogésima Terceira Passada

- [x] Padronizadas descrições humanas do live harness preservando IDs técnicos (`activity-visible`,
  `sse-archive-*`, `sse-*`, `ready`, `interactive-repl`, `clean-quit`).
- [x] Traduções aplicadas no cenário `--no-pr`, nos critérios SSE comuns e em cenários correlatos BYOK/auto/model/blocker
  onde a mesma frase aparecia nos summaries.
- [x] Mantidos nomes de campos/eventos como `traceId`, `source/eventSource`, `tool.lifecycle` e ids de critérios como
  contrato técnico.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Busca focada não encontrou mais as frases antigas `terminal reached ready state`, `terminal ran with an interactive`,
  `terminal error tracker stayed clean`, `terminal exited through /quit`, `/events --raw exposed`,
  `rendered the durable public SSE file tail` ou `without opening a turn` no harness.

### Achados Novos Da Octogésima Terceira Passada

- [x] SDK10-P83-01: revisar estado/dados de SSE archive e redaction para garantir que `recordTerminalSseEventArchive()`
  redige payloads antes de disco, não apenas na leitura de `/events`.

### Execução Contínua Em 2026-06-08 - Octogésima Quarta Passada

- [x] Identificado gap real: `recordTerminalSseEventArchive()` gravava `payload: data` direto no JSONL; a redaction de
  `/events` na leitura não protegia o arquivo durável em disco.
- [x] `sse-event-archive` agora aplica `redactSecretRecord()` antes de projetar envelope e antes de enfileirar o JSONL.
- [x] O envelope (`source`, `eventSource`, `traceId`, `turnId`, `hubSessionId`) passa a ser derivado do payload já
  redigido, mantendo filtros coerentes com o que foi persistido.
- [x] Teste canônico de SSE replay agora grava payload com `api_key`, `Authorization: Bearer` e `token` aninhado, lê a
  projection e o arquivo bruto, e garante que o secret não aparece em nenhum dos dois.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_sse_replay_canonical.spec.js` (1 arquivo, 1 teste).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Octogésima Quarta Passada

- [x] SDK10-P84-01: revisar se o fanout SSE público (`broadcastSse`) também deve redigir payload antes de enviar para
  clientes HTTP/replay, ou se a redaction deve ficar restrita a observabilidade/arquivo.

### Execução Contínua Em 2026-06-08 - Octogésima Quinta Passada

- [x] Decisão: redaction deve acontecer na borda pública `broadcastSse()`, não apenas no arquivo/observabilidade.
- [x] `broadcastSse()` agora normaliza payload para transporte e, antes de replay/raw SSE/socket/fanout/archive, aplica
  `redactSecretRecord()` no payload enriquecido com `hubSessionId`.
- [x] Isso unifica o contrato: clientes HTTP SSE, replay buffer, socket/fanout e arquivo durável recebem a mesma versão
  segura do payload.
- [x] Teste canônico ampliado para garantir que payload com `api_key` e `Authorization: Bearer` não aparece em raw SSE nem
  no replay buffer, além da projection e do JSONL.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_sse_replay_canonical.spec.js` (1 arquivo, 1 teste).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Octogésima Quinta Passada

- [x] SDK10-P85-01: rodar live LLM-B após redaction no fanout SSE público para confirmar que o coletor SSE do harness,
  `/events --raw` e `/events --json compact` continuam parseáveis e com source/eventSource preservados.

### Execução Contínua Em 2026-06-08 - Octogésima Sexta Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T12-09-00-436Z/summary.md`.
- [x] Confirmado coletor SSE conectado com 0 erros e 6/6 eventos públicos com ids monotônicos.
- [x] Confirmado `/events --raw` com 12 eventos de controle e `/events --json compact` com 18 eventos estruturados.
- [x] Confirmado `source/eventSource` preservado em 6/6 payloads objeto no coletor SSE.
- [x] Confirmado summary traduzido para os critérios humanos (`terminal chegou ao estado pronto`,
  `sem abrir turno`, `coletor SSE conectado`, `rastreador de erros do terminal permaneceu limpo`).

### Achados Novos Da Octogésima Sexta Passada

- [x] SDK10-P86-01: revisar arquitetura de redaction para evitar duplicação futura entre `activity-state`,
  `tool-lifecycle-event`, `sse-event-archive` e `broadcastSse`, possivelmente criando helper central de payload público.

### Execução Contínua Em 2026-06-08 - Octogésima Sétima Passada

- [x] Revisada a arquitetura de redaction após os hardenings em activity, lifecycle e SSE.
- [x] Decisão: não criar novo helper fino de "payload público" neste momento; a política central já é
  `src/copilot/core/security/redaction.js` (`redactSecretText`/`redactSecretRecord`).
- [x] A diferença entre os módulos é de formato, não de regra: `activity-state` redige campos escalares de snapshot;
  `tool-lifecycle-event` normaliza schema discriminado; `broadcastSse` redige payload público inteiro; e
  `sse-event-archive` redige novamente por defesa em profundidade antes do JSONL.
- [x] Mantida defesa em profundidade sem criar fluxo paralelo: redaction de borda pública no `broadcastSse()` e
  redaction de persistência no archive.
- [x] Validações herdadas da passada anterior seguem cobrindo a decisão: typecheck/lint, teste canônico de SSE e live
  LLM-B PASS.

### Achados Novos Da Octogésima Sétima Passada

- [x] SDK10-P87-01: revisar comandos `/events` e `/activity` para garantir que a nova redaction de origem não deixou
  redaction redundante visível (`[redacted]` excessivo) nem removeu campos úteis de diagnóstico.

### Execução Contínua Em 2026-06-08 - Octogésima Oitava Passada

- [x] Rodada bateria focada em `/events`, `/activity`, activity-state e SSE replay após redaction na origem.
- [x] Confirmado que `/events` ainda preserva `payloadKeys`/`payloadPreview`, formato raw técnico e JSON parseável.
- [x] Confirmado que testes existentes cobrem `/events --json`, `--raw full` e preview raw redigindo
  `Authorization: Bearer` e `api_key` sem perder estrutura.
- [x] Confirmado que previews humanizados de activity, hooks, boot, quota e background continuam cobertos.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js
  tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_activity_state.spec.js
  tests/unit/copilot/test_terminal_sse_replay_canonical.spec.js` (4 arquivos, 50 testes).

### Achados Novos Da Octogésima Oitava Passada

- [x] SDK10-P88-01: revisar `/events --json compact` e `compactTerminalSseArchiveEntry` para garantir que payload
  compacto nunca reexpõe `payload` completo nem perde filtros úteis (`toolCallId`, `requestId`, `hubSessionId`).

### Execução Contínua Em 2026-06-08 - Octogésima Nona Passada

- [x] Revisado modo compacto de `/events`: ele já não expunha `payload`, mas deixava `toolCallId`/`requestId` apenas no
  `payloadPreview` humano.
- [x] `createRawPreviewEntry()` agora extrai `toolCallId` e `requestId` de payloads aninhados conhecidos
  (`data`, `payload`, `request`, `invocation`, `context`, `toolCall`, `permission`) e os publica como campos próprios no
  JSON compacto.
- [x] O JSON compacto preserva `traceId`, `turnId`, `hubSessionId`, `toolCallId`, `requestId`, `payloadKeys` e
  `payloadPreview`, sem reintroduzir `payload`.
- [x] Teste de `/events --json compact` ampliado para exigir esses campos estruturados e ausência de `payload`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 28 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Octogésima Nona Passada

- [x] SDK10-P89-01: revisar se `/events --raw` preview deve também expor `toolCallId`/`requestId` estruturados de forma
  consistente com JSON compacto, além do preview textual.

### Execução Contínua Em 2026-06-08 - Nonagésima Passada

- [x] Confirmado que `/events --raw` preview usa o mesmo `createRawPreviewEntry()` do JSON compacto.
- [x] Teste de raw preview ampliado para exigir `traceId`, `turnId`, `hubSessionId`, `toolCallId` e `requestId`
  estruturados, além de `payloadKeys`/`payloadPreview`.
- [x] Mantida ausência de `payload` no preview raw compacto.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 28 testes).

### Achados Novos Da Nonagésima Passada

- [x] SDK10-P90-01: revisar `/events sources` e catálogo de fontes públicas para garantir que o novo contrato de SSE
  redigido/compacto esteja documentado para operador e diagnóstico.

### Execução Contínua Em 2026-06-08 - Nonagésima Primeira Passada

- [x] `/events sources` agora orienta explicitamente os formatos: `/events --json compact`, `/events --raw preview` e
  `/events --raw full`.
- [x] A tela também informa o contrato de segurança: payload público redigido; compacto usa preview e ids de filtro.
- [x] A orientação aparece tanto no mapa humano default quanto no modo `sources detail`.
- [x] Testes de `/events sources` ampliados para proteger essas linhas e continuar escondendo nomes técnicos no modo
  default.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 28 testes).
- [x] Validado novamente com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Nonagésima Primeira Passada

- [x] SDK10-P91-01: rodar live LLM-B após mudanças em `/events sources`/compact ids para confirmar a nova orientação no
  terminal real e a parseabilidade do summary.

### Execução Contínua Em 2026-06-08 - Nonagésima Segunda Passada Live LLM-B

- [x] Adicionado `/events sources` à sequência `--no-pr` do live harness.
- [x] Adicionado critério `events-sources-guidance-visible` exigindo orientação de formatos, redaction e ids de filtro.
- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T12-16-57-540Z/summary.md`.
- [x] Confirmado no terminal real: `/events sources` mostra "Formatos /events --json compact · /events --raw preview ·
  /events --raw full" e "Segurança payload público redigido; compacto usa preview e ids de filtro".
- [x] Confirmado summary com critério novo passando e `/events --json compact` ainda parseável com 18 eventos
  estruturados.

### Achados Novos Da Nonagésima Segunda Passada

- [x] SDK10-P92-01: revisar se o summary do live deve trocar a palavra "redaction" por "redação/redigido" nos detalhes
  humanos, mantendo termos técnicos apenas onde forem nomes de política.

### Execução Contínua Em 2026-06-08 - Nonagésima Terceira Passada

- [x] Ajustado o critério `events-sources-guidance-visible` no live harness para dizer "payload redigido" em vez de
  "redaction".
- [x] Preservados IDs técnicos e nomes de artefatos; a mudança afeta apenas texto humano do summary.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Busca focada não encontrou mais `redaction` no harness.

### Achados Novos Da Nonagésima Terceira Passada

- [x] SDK10-P93-01: revisar status consolidado/diff após as passadas de SSE/redaction/events e escolher próxima frente
  estrutural em `src/copilot`.

### Execução Contínua Em 2026-06-08 - Nonagésima Quarta Passada

- [x] Revisado `git status --short` e `git diff --stat` após as passadas de SSE/redaction/events.
- [x] Confirmado que `.codex/config.toml` segue modificado fora do escopo e não deve ser stageado/revertido.
- [x] Confirmado que a frente MCP `convertMcpCallToolResult` já está aplicada na ponte concreta e coberta em
  `test_mcp_tool_bridge.spec.js`.
- [x] Escolhida próxima frente estrutural ainda aberta: canvas/MCP Apps sem renderer dedicado, para evitar que eventos SDK
  1.0 novos virem ruído cru em `/events` e diagnósticos.

### Achados Novos Da Nonagésima Quarta Passada

- [x] SDK10-P94-01: revisar `session.canvas.*`, `mcp_app.*` e eventos correlatos em `/events`/SSE para definir resumo
  seguro enquanto não há renderer visual/canvas real no terminal.

### Execução Contínua Em 2026-06-08 - Nonagésima Quinta Passada

- [x] Confirmado que `/events` já tinha labels e resumos para `session.canvas.opened` e
  `session.canvas.registry_changed`, mas não tinha label/resumo específico para `mcp_app.tool_call_complete`.
- [x] `/events` agora humaniza `mcp_app.tool_call_complete` como "MCP App concluído", com origem "MCP App via SDK" para
  fontes `sdk/mcp_app*` e `sdk/mcp-app*`.
- [x] Resumo default de MCP App mostra app, tool, estado, título e recurso em formato compacto, sem expor payload cru de
  iframe/canvas/app.
- [x] Catálogo técnico de fontes públicas agora documenta a política `canvas.mcp-app.summary`, aceitando
  `session.canvas.opened`, `session.canvas.registry_changed` e `mcp_app.tool_call_complete`.
- [x] Fallback registrado: `/events --json compact` expõe ids e preview redigidos enquanto não existe renderer visual de
  canvas no terminal.
- [x] Testes de `/events sources` protegem a nova política no mapa humano e no modo detail.
- [x] Teste de resumo default cobre evento `mcp_app.tool_call_complete` realista e garante ausência de chave crua
  `appName`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 28 testes).
- [x] Validado com `node --check src/copilot/terminal/commands/events.js` e
  `node --check src/copilot/terminal/events/event-adapter-events.js`.

### Achados Novos Da Nonagésima Quinta Passada

- [x] SDK10-P95-01: revisar próximos eventos SDK 1.0 ainda tratados como ruído genérico em `/events` e no source-policy,
  priorizando `extension_context`, `session.autopilot_objective_changed` e eventos de reconciliação/sync.

### Execução Contínua Em 2026-06-08 - Nonagésima Sexta Passada

- [x] Adicionadas constantes canônicas `EMITTER_*` para `extension_context`, `new_inbox_message` e sinais SDK 1.0 de
  autopilot, custom agents, custom notification, extension attachments, remote steerable e schedule.
- [x] `wireSessionLifecycleEvents()` agora escuta esses tipos oficiais do `SESSION_EVENTS` e emite payloads internos
  normalizados, evitando que runtime real dependa de strings soltas ou caia apenas no catch-all.
- [x] `sdk-session-events` agora transforma esses sinais em activity + SSE público canônico, com narração curta e
  conservadora para operador.
- [x] `TERMINAL_EXPLICIT_AGENT_EVENTS` e `/events sources detail` ganharam a política
  `sdk.session.extension-signals`, com owner e fallback explícitos.
- [x] `/events` agora humaniza `session.autopilot_objective_changed`, `extension_context`,
  `session.custom_agents_updated`, `session.custom_notification`, `session.extensions.attachments_pushed`,
  `session.remote_steerable_changed`, `session.schedule_created`, `session.schedule_cancelled` e
  `new_inbox_message`.
- [x] `catch-all` deixou de classificar esses eventos como desconhecidos.
- [x] Teste de `wireSessionLifecycleEvents()` cobre os novos eventos SDK 1.0 e seus payloads normalizados.
- [x] Teste de `/events` cobre labels/resumos humanos desses sinais e garante ausência de ids crus como
  `autopilot objective changed`, `extension context` e `attachments_pushed`.
- [x] Ajustado contrato de teste de `user_input.requested`: o payload bruto preserva `allowFreeform: false` em `data`,
  mas a emissão canônica expõe `allowFreeform: true`, alinhada à UX terminal atual.
- [x] Validado com `node --check` dos módulos tocados.
- [x] Validado com `npx vitest run tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js` (2 arquivos, 66 testes).
- [x] Validado com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Nonagésima Sexta Passada

- [x] SDK10-P96-01: rodar live LLM-B após a cobertura de sinais SDK 1.0 long-tail para confirmar que `/events sources`,
  SSE collector, `/events --json compact` e `/events --raw` continuam parseáveis no terminal real.

### Execução Contínua Em 2026-06-08 - Nonagésima Sétima Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T12-35-47-778Z/summary.md`.
- [x] Confirmado `/events --json compact` parseável com 18 eventos estruturados e sem `payload` completo.
- [x] Confirmado `/events --raw` preview com 12 eventos e ids estruturados.
- [x] Confirmado `/events sources` exibindo a política nova "Objetivo autopiloto + Contexto de extensão" e orientação de
  formatos/segurança.
- [x] Confirmado coletor SSE conectado, 0 erros, ids monotônicos e `source/eventSource` preservados em payloads objeto.
- [x] Confirmado `/errors 10` sem erros recentes.

### Achados Novos Da Nonagésima Sétima Passada

- [x] SDK10-P97-01: live revelou que o hint default de `/events sources` para políticas com muitos eventos ficava longo
  demais, especialmente em `sdk.session.extension-signals`.

### Execução Contínua Em 2026-06-08 - Nonagésima Oitava Passada

- [x] `buildHumanPolicyQueryHint()` agora limita o assunto humano a três labels e adiciona sufixo `+N` quando a política
  cobre mais eventos.
- [x] O modo detail continua expondo hints técnicos completos por evento/fonte.
- [x] Teste de `/events sources` protege o formato compacto
  `ver Objetivo autopiloto + Contexto de extensão + Agentes customizados +6: /events 50`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 29 testes).

### Achados Novos Da Nonagésima Oitava Passada

- [x] SDK10-P98-01: revalidar typecheck/lint após o ajuste de UX de `/events sources` e então escolher a próxima frente
  estrutural fora de eventos/SSE.

### Execução Contínua Em 2026-06-08 - Nonagésima Nona Passada

- [x] Revalidado `npm run typecheck:strict:src.copilot`.
- [x] Revalidado `npm run lint:copilot`.
- [x] Revisado `git status --short` e confirmado que `.codex/config.toml` permanece fora do escopo.
- [x] Revisado diff focado da frente P95-P98 para confirmar arquivos tocados: eventos públicos, wirer de sessão, terminal
  SDK events, `/events`, testes e roadmap.
- [x] Escolhida próxima frente curta de UX: K.2, padronização de labels humanos para `ask_user`, `report_intent`,
  `model.call_failure`, tools e intents.

### Achados Novos Da Nonagésima Nona Passada

- [x] SDK10-P99-01: investigar labels humanos restantes para `ask_user`, `report_intent`, intents e tools no terminal,
  evitando mistura de ids crus, português inconsistente e duplicidade entre `/events`, `/activity` e lifecycle de tools.

### Execução Contínua Em 2026-06-08 - Centésima Passada

- [x] Revisada a cobertura de labels: `/events` já humaniza `assistant.intent` como "Intenção da LLM-B",
  `user_input.requested` como "Pergunta ao operador", `user_input.completed` como "Resposta do operador" e
  `model.call_failure` como "Falha do modelo".
- [x] Confirmado por testes existentes que `report_intent`/`report_intent_local` aparecem como "Intenção capturada" em
  `/activity`, tool lifecycle e `/tools`, preservando ids técnicos apenas em superfícies detail/raw.
- [x] Confirmado que detalhes livres de intenção preservam termos técnicos quando fazem parte do texto do operador/LLM
  (`ask_user` dentro do conteúdo), sem substituição semântica indevida.
- [x] Gap real encontrado: `tests/unit/copilot/test_terminal_event_adapter_events.spec.js` ainda restringia classes de
  source-policy ao conjunto antigo e não protegia as políticas `extension`.
- [x] Teste de contrato atualizado para aceitar `class: "extension"` e exigir `canvas.mcp-app.summary` e
  `sdk.session.extension-signals`.
- [x] Teste também cobre lookup de `session.autopilot_objective_changed` e `mcp_app.tool_call_complete` na policy correta.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_event_adapter_events.spec.js` (1 arquivo, 2 testes).
- [x] Revalidado com `npm run typecheck:strict:src.copilot` e `npm run lint:copilot`.

### Achados Novos Da Centésima Passada

- [x] SDK10-P100-01: revisar timestamps e formatos temporais em renderers finais do terminal (`/events`, `/activity`,
  `/session sdk events`, `/session sdk waits`) para concluir K.8 sem regressão visual.

### Execução Contínua Em 2026-06-08 - Centésima Primeira Passada

- [x] Confirmado que o helper central `formatTerminalTimeLabel(..., { mode: "dual" })` já gera ISO 8601 local completo
  com milissegundos e offset, acompanhado de idade relativa.
- [x] Confirmado que `/events` e `/activity` já tinham testes exigindo formato dual completo.
- [x] Reforçados testes de `/session sdk events` e `/session sdk waits` para exigir ISO completo + relativo nas linhas
  agregadas.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_time_format.spec.js` (1 arquivo, 7 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js` (1 arquivo, 51 testes).

### Achados Novos Da Centésima Primeira Passada

- [x] SDK10-P101-01: revalidar typecheck/lint após hardening de timestamps e escolher próxima frente de UX terminal
  ainda aberta em K.1/K.4/K.5/K.6.

### Execução Contínua Em 2026-06-08 - Centésima Segunda Passada

- [x] Revalidado `npm run typecheck:strict:src.copilot`.
- [x] Revalidado `npm run lint:copilot`.
- [x] Escolhida próxima frente UX: K.5, reduzir repetição de `request_user_input`/pergunta humana pendente sem perder
  visibilidade operacional.

### Achados Novos Da Centésima Segunda Passada

- [x] SDK10-P102-01: investigar renderers, live status e lifecycle de `request_user_input`/`ask_user` para localizar
  duplicidade visual remanescente entre card humano, activity heartbeat e tool lifecycle.

### Execução Contínua Em 2026-06-08 - Centésima Terceira Passada

- [x] Confirmado que `agent-runtime-events` suprime heartbeat durável de `ask_user`/`request_user_input` como progresso de
  ferramenta, mantendo pergunta humana no renderer dedicado.
- [x] Confirmado que `live-status-line` mostra pergunta humana compacta (`aguardando você`, `[PERG]`, choices) e fica fora
  do pulso periódico para não disputar o input.
- [x] Confirmado que `tool-lifecycle-runtime` renderiza `tool.user_requested` de `request_user_input` como
  "Pergunta ao operador aguardando resposta", sem linha "Tool" crua.
- [x] Confirmado que o replay de pergunta pendente evita repetição por janela/assinatura.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js
  tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js
  tests/unit/copilot/terminal/test_pending_question_replay.spec.js` (4 arquivos, 72 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js
  tests/unit/copilot/terminal/test_human_question_renderer.spec.js` (2 arquivos, 27 testes).

### Achados Novos Da Centésima Terceira Passada

- [x] SDK10-P103-01: investigar K.4, garantindo que a linha viva permaneça fisicamente separada do input em terminais
  estreitos e durante redraws/clearInlineStatus.

### Execução Contínua Em 2026-06-08 - Centésima Quarta Passada

- [x] Confirmado que `formatTerminalLiveStatusLine()` passa por barreira física de uma linha e respeita orçamento de
  colunas com truncamento ANSI-safe.
- [x] Confirmado que `writeInlineStatus()` usa linha reservada acima do prompt quando stdout é TTY/readline ativo.
- [x] Confirmado que `clearInlineStatus()` e `clearInlineStatusForReadlineSubmit()` não limpam a linha do prompt quando
  não há overlay reservado.
- [x] Confirmado que pulsos atrasados são suprimidos durante submit e quando o operador já digitou resposta parcial.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js
  tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js` (2 arquivos, 52 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js` (1 arquivo, 8 testes).

### Achados Novos Da Centésima Quarta Passada

- [x] SDK10-P104-01: investigar K.6, apresentação de troca automática de modelo com motivo, modelo anterior, modelo novo
  e confiança, comparando `/activity`, linha viva, `/events` e model-gateway.

### Execução Contínua Em 2026-06-08 - Centésima Quinta Passada

- [x] `buildTerminalModelTransitionPresentation()` passou a aceitar `confidence` e renderizar "confiança ..." no detalhe
  canônico de troca solicitada, confirmada, reconfirmada ou fallback.
- [x] `requestTerminalLiveByokModelSwitch()` e `recordTerminalLiveByokModelSwitchDeferred()` passaram a preservar
  `confidence` no pedido vivo BYOK, no histórico de `/activity` e no casamento posterior com `session.model_changed`.
- [x] `buildModelGatewayRuntimeAutomationDecision()` agora expõe `selectedRouteReasons` e `selectedRouteConfidence`,
  inclusive quando a confiança vem de `selected.verification.confidence` ou de termos `confidence:*` da rota.
- [x] `buildModelGatewayRuntimeAutomationControllerStep()` propaga `reason`, `routeReasons` e `confidence` para efeitos
  `set_live_model`/`prepare_new_sdk_session`.
- [x] `applyTerminalByokGatewayAutoEffects()` passa o motivo/confiança do efeito para o executor vivo único, eliminando
  o fallback paralelo fixo "automação model-gateway" quando o controller já sabe o motivo real.
- [x] `sdk-session-events` agora imprime confirmação SDK casada com pedido anterior incluindo origem do pedido, horário
  ISO, motivo original e confiança, e expõe o mesmo em `matchedTerminalRequest` no SSE.
- [x] `agent-runtime-events` passou a renderizar `confidence` também em fallback de modelo.
- [x] A linha viva de fase `model` continua compacta, mas mostra `conf catalog` quando o detalhe canônico contém
  confiança, mantendo motivo completo no histórico detalhado.
- [x] Corrigido contrato do cenário live `invalid-choice`: o runner atual permite resposta livre e o teste agora valida
  o texto real do prompt/final.
- [x] Validado com `node --check` dos módulos tocados.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_model_transition_presentation.spec.js
  tests/unit/copilot/terminal/test_live_status_line.spec.js` (2 arquivos, 29 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js` (1 arquivo, 26 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js
  tests/unit/copilot/terminal/test_commands_byok.spec.js` (2 arquivos, 338 testes).
- [x] Revalidado `npm run typecheck:strict:src.copilot`.
- [x] Revalidado `npm run lint:copilot`.

### Achados Novos Da Centésima Quinta Passada

- [x] SDK10-P105-01: rodar live LLM-B pós-K.6 e revisar se `/events`, `/activity`, SSE e prompts continuam sem ruído
  visual após a padronização de confiança em transições de modelo.

### Execução Contínua Em 2026-06-08 - Centésima Sexta Passada Live LLM-B

- [x] Reexecutado `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`.
- [x] Live PASS com artefato `artifacts/terminal-live/2026-06-08T13-00-39-813Z/summary.md`.
- [x] Confirmado terminal pronto, REPL/TTY interativo, `/usage now`, `/activity`, `/session sdk`, `/session sdk commands`,
  `/session sdk events`, `/session sdk waits`, `/metrics`, `/events`, `/events --raw`, `/events --json compact`,
  `/events sources`, `/errors` e `/quit` sem abrir turno explícito.
- [x] Confirmado `/events --json compact` parseável com 18 eventos estruturados.
- [x] Confirmado `/events --raw` preview com 12 eventos de controle.
- [x] Confirmado `/events sources` mantendo hint compacto para `sdk.session.extension-signals`.
- [x] Confirmado coletor SSE conectado, 0 erros, ids monotônicos e source/eventSource preservados em payloads objeto.
- [x] Confirmado rastreador `/errors 10` limpo.
- [x] Observação: cenário `--no-pr` não força troca de modelo; a validação de confiança em transição foi coberta por testes
  unitários/contratuais e o live validou ausência de regressão visual nas superfícies comuns.

### Achados Novos Da Centésima Sexta Passada

- [x] SDK10-P106-01: investigar K.1 com foco em screenshots/superfícies do operador agora que eventos SDK 1.0, perguntas
  humanas, timestamps e transições de modelo já têm contratos atualizados.

### Execução Contínua Em 2026-06-08 - Centésima Sétima Passada

- [x] Revisado `terminal.plain.log` do live `artifacts/terminal-live/2026-06-08T13-00-39-813Z/terminal.plain.log`
  como snapshot textual de UX do operador.
- [x] Gap encontrado no cockpit `/session sdk`: o topo mostrava `Atual ativa fora desta página`, expressão ambígua em
  terminal porque "página" não é a unidade mental principal e "ativa" não serve para todos os labels que usam o helper.
- [x] `renderSdkSessionTopReference()` agora usa `não listada nesta janela` quando a sessão existe mas não aparece na
  janela paginada atual.
- [x] Teste de `cmdSessionSdk` protege o texto novo e rejeita `ativa fora desta página`.
- [x] Validado com `node --check src/copilot/terminal/commands/session.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js` (1 arquivo, 51 testes).

### Achados Novos Da Centésima Sétima Passada

- [x] SDK10-P107-01: continuar K.1 revisando microcopy de `/events sources`, `/metrics` e `/usage now` no plain log live,
  priorizando textos que pareçam internos, ambíguos ou longos demais para operador humano.

### Execução Contínua Em 2026-06-08 - Centésima Oitava Passada

- [x] Gap encontrado em `/metrics`: quando não havia diagnóstico de injeção recente, a linha de fases renderizava
  `checagem -ms · contexto -ms · anexos -ms · diálogo -ms`.
- [x] Criado helper `renderMetricDuration()` para renderizar duração como `Nms` quando numérica e `n/d` quando ausente.
- [x] `/metrics` agora exibe `checagem n/d · contexto n/d · anexos n/d · diálogo n/d` no estado vazio, evitando unidade
  falsa e ruído visual.
- [x] Teste de `cmdMetrics` protege `checagem n/d` e rejeita `-ms`.
- [x] Validado com `node --check src/copilot/terminal/commands/metrics.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js` (1 arquivo, 8 testes).

### Achados Novos Da Centésima Oitava Passada

- [x] SDK10-P108-01: revalidar typecheck/lint após os ajustes de microcopy de `/session sdk` e `/metrics`, depois escolher
  a próxima frente K.1 ou uma frente estrutural SDK ainda não revisada.

### Execução Contínua Em 2026-06-08 - Centésima Nona Passada

- [x] Revalidado `npm run typecheck:strict:src.copilot`.
- [x] Revalidado `npm run lint:copilot`.
- [x] Revisado `git status --short`; `.codex/config.toml` segue modificado fora do escopo e não deve ser revertido.
- [x] Confirmado que K.1 permanece aberto para mais revisão visual/microcopy; P106-P108 cobriram dois gaps reais
  encontrados no plain log live.

### Achados Novos Da Centésima Nona Passada

- [ ] SDK10-P109-01: continuar K.1 revisando `/usage now` e o bloco de `/events sources` no próximo ciclo, buscando
  termos ambíguos, linhas longas e mistura de detalhe técnico em superfície default.

### Execução Contínua Em 2026-06-08 - Centésima Décima Passada

- [x] Corrigida a divergência entre o relatório JSON do Vitest e o exit code do wrapper `scripts/ci/run-vitest-copilot.mjs`:
  quando o relatório estruturado tem `success: true`, testes executados, 0 falhas e 0 suites falhas, o gate agora encerra
  com exit code 0 e preserva `childExitCode` no resumo para auditoria.
- [x] Revalidado `npm run lint:copilot`.
- [x] Revalidado `npm run typecheck:strict:src.copilot`.
- [x] Revalidado `npm run test:copilot:unit` com `3801/3801` testes e `1139/1139` suites passando, sem warnings/errors,
  em `artifacts/test-runs/copilot/2026-06-08T14-33-29-286Z/summary.md`.
- [x] Revalidado madge circular em todo `src/copilot`: `cycles 0` em
  `artifacts/test-runs/copilot/madge-src-copilot-circular-2026-06-08T14-36-06.json`.
- [x] Revalidado madge full em todo `src/copilot`: `Processed 1227 files` com exit code 0 em
  `artifacts/test-runs/copilot/madge-src-copilot-full-2026-06-08T14-49-44.txt`; warnings auditados em
  `artifacts/test-runs/copilot/madge-src-copilot-warnings-2026-06-08T14-50-03.txt` são pacotes externos pulados
  (`@opentelemetry/sdk-trace-node`, `uuid`, `@modelcontextprotocol/sdk/server/*`), não arquivos locais.
- [x] Revalidado live test LLM-B com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`;
  PASS em `artifacts/terminal-live/2026-06-08T14-50-33-176Z/summary.md`.
- [x] Confirmado no live: REPL interativo pronto, `/usage now`, `/activity`, `/session sdk`, `/events`, `/metrics` e
  `/errors` renderizam sem abrir turno explícito, SSE conectado, ids monotônicos e rastreador de erros limpo.
- [x] Consolidadas portas estreitas para quebrar ciclos sem reabrir barrels largos: `agent/ports/legacy-runtime`,
  `agent/ports/session-setup`, `terminal/byok/*/index.js`, `terminal/dialog/io`, sub-barrels de presenters/projections e
  `#copilot/tools/observability`.
- [x] Contratos de arquitetura atualizados para reconhecer façades/ports estreitas como fronteira canônica quando o barrel
  amplo reintroduz ciclos; madge passa a ser gate explícito contra regressão.

### Achados Novos Da Centésima Décima Passada

- [x] SDK10-P110-01: investigar por que `/usage now` ainda renderiza `dados da janela de contexto não disponíveis` no live
  mesmo com sessão SDK conectada; decidido como estado vazio legítimo de medição SDK ainda não reportada, com limite do
  modelo disponível via metadados BYOK/model-gateway.
- [ ] SDK10-P110-02: avaliar se os 5 warnings externos do madge devem virar allowlist documentada em contrato próprio para
  evitar ambiguidade em revisões futuras.

### Execução Contínua Em 2026-06-08 - Centésima Décima Primeira Passada

- [x] `/usage now` deixou de renderizar o alerta genérico `dados da janela de contexto não disponíveis`.
- [x] Estado vazio de contexto agora renderiza `Janela de contexto · uso ainda não medido`, linha `Medição` explicando que
  o SDK ainda não reportou tokens usados e `Limite do modelo` quando metadados de modelo/BYOK estão disponíveis.
- [x] Teste unitário cobre o estado sem `contextState`, garante limite conhecido do modelo e bloqueia a string antiga.
- [x] Harness `llmBLiveTest` reconhece a nova microcopy de `/usage now`.
- [x] Validado com `node --check src/copilot/terminal/commands/usage.js`.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js` (1 arquivo, 9 testes).
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T14-56-15-736Z/summary.md`.

### Achados Novos Da Centésima Décima Primeira Passada

- [x] SDK10-P111-01: aplicar a mesma estratégia de estado vazio humano em `/metrics`, onde a linha `Contexto (sem dados)`
  ainda pode ser enriquecida com limite do modelo sem fingir uso medido.

### Execução Contínua Em 2026-06-08 - Centésima Décima Segunda Passada

- [x] `/metrics` deixou de renderizar `Contexto (sem dados)` quando o runtime ainda não mediu tokens usados, mas o
  catálogo/model-gateway já conhece o limite do modelo.
- [x] Novo helper `readKnownMetricContextLimit()` centraliza a leitura de `modelMeta`, metadados observados e capacidades
  BYOK antes de montar a linha visual de contexto.
- [x] Estado vazio de contexto agora renderiza `uso ainda não medido · limite N tokens`, preservando o caminho antigo de
  percentual/tokens quando `contextState` real existe.
- [x] Teste unitário cobre o caso sem `contextState`, garante `limite 128.000 tokens` e bloqueia a regressão para
  `Contexto      (sem dados)`.
- [x] Validado com `node --check src/copilot/terminal/commands/metrics.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js` (1 arquivo, 10 testes).
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T14-59-18-020Z/summary.md`, confirmando `/metrics` com
  `Contexto      uso ainda não medido · limite 200.000 tokens` e `/usage now` mantendo a microcopy nova.

### Achados Novos Da Centésima Décima Segunda Passada

- [x] SDK10-P112-01: auditar `/events sources` no plain log live, separando detalhe técnico útil de ruído default e
  verificando se `sdk.session.extension-signals` precisa de microcopy mais humana sem perder rastreabilidade.

### Execução Contínua Em 2026-06-08 - Centésima Décima Terceira Passada

- [x] `/events sources` ganhou um default mais escaneável: `Mais detalhes` vira a porta explícita para o modo técnico,
  enquanto o catálogo padrão reduz a lista de eventos por política a um resumo humano com `+N`.
- [x] As dicas de investigação no default deixaram de repetir o ruído `detalhe técnico` em cada linha; o detalhe
  estrutural fica concentrado no modo `sources detail`.
- [x] O modo detalhe segue mostrando a lista completa, incluindo `id`, `classe`, `dono técnico`, `emissor`, `aceita`,
  `suprime` e `fallback`.
- [x] Teste unitário atualizado para proteger o resumo humano padrão, o atalho `Mais detalhes` e o modo detail técnico.
- [x] Validado com `node --check src/copilot/terminal/commands/events.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 29 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-05-16-026Z/summary.md`, confirmando `/events sources` mais humano,
  `/events`, `/metrics`, `/usage now`, `/session sdk events` e `/session sdk waits` sem regressão visual.

### Achados Novos Da Centésima Décima Terceira Passada

- [x] SDK10-P113-01: seguir revisando superfícies de operação com foco em coerência entre comandos irmãos (`/events`,
  `/activity`, `/session sdk`, `/metrics`) e eliminar mais um caso de microcopy duplicada ou técnica demais no default.

### Execução Contínua Em 2026-06-08 - Centésima Décima Quarta Passada

- [x] `/session sdk events` trocou o rodapé vazio para `Mais detalhes /events sources · /session sdk commands`, removendo
  a explicação de arquivo bruto do caminho padrão.
- [x] `/session sdk waits` trocou o rodapé vazio para `Mais detalhes /sdk waits para pendências vivas`, sem citar o
  arquivo bruto no default.
- [x] O modo detalhado de `/events sources` e os catálogos irmãos seguem preservados; a simplificação vale só para o
  empty-state/summary path do operador.
- [x] Testes unitários de sessão foram atualizados para proteger os novos footers humanos.
- [x] Validado com `node --check src/copilot/terminal/commands/session.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`
  (2 arquivos, 80 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-07-49-033Z/summary.md`, confirmando os footers novos em `/session sdk events`
  e `/session sdk waits` sem regressão em `/events`, `/metrics`, `/usage now` e `/session sdk`.

### Achados Novos Da Centésima Décima Quarta Passada

- [x] SDK10-P114-01: revisar `/activity` e reduzir também o rodapé técnico do default, buscando o mesmo padrão humano
  usado em `/events`, `/session sdk events` e `/session sdk waits`.

### Execução Contínua Em 2026-06-08 - Centésima Décima Quinta Passada

- [x] `/activity` trocou o rodapé default para `Mais detalhes /activity detail`, removendo a explicação de origem,
  auditoria técnica e streaming do caminho comum.
- [x] Teste de `/activity` passou a proteger o atalho curto e o rótulo humano, sem depender da frase técnica antiga.
- [x] Validado com `node --check src/copilot/terminal/commands/activity.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js` (1 arquivo, 11 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-09-36-725Z/summary.md`, confirmando `/activity`, `/session sdk events`,
  `/session sdk waits`, `/metrics`, `/usage now` e `/events` sem regressão visual.

### Achados Novos Da Centésima Décima Quinta Passada

- [x] SDK10-P115-01: continuar caçando rodapés e dicas default que ainda misturam instrução técnica com navegação
  humana, começando pelos comandos irmãos de status/diagnóstico e suas telas de vazio.

### Execução Contínua Em 2026-06-08 - Centésima Décima Sexta Passada

- [x] `/diagnose` trocou o rodapé default para `Mais detalhes`, preservando o conjunto de comandos e reduzindo a
  frase explicativa no caminho comum.
- [x] O teste de `/diagnose` passou a verificar o atalho humano e o acesso a `/health full`.
- [x] Validado com `node --check src/copilot/terminal/commands/diagnose.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_diagnose.spec.js` (1 arquivo, 5 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-11-52-080Z/summary.md`, confirmando `/diagnose`, `/activity`, `/session sdk events`,
  `/session sdk waits`, `/metrics`, `/usage now` e `/events` sem regressão visual.

### Achados Novos Da Centésima Décima Sexta Passada

- [x] SDK10-P116-01: revisar ainda os fluxos de diagnóstico e saúde adjacentes para padronizar o mesmo vocabulário
  curto em footers de summary, empty-state e next-step.

### Execução Contínua Em 2026-06-08 - Centésima Décima Sétima Passada

- [x] `/tools` trocou os footers default para `Mais detalhes` nos caminhos de observação e fallback.
- [x] O modo explícito `diag` preservou o conjunto de comandos de investigação, agora com rótulo humano curto.
- [x] O teste de `/tools` passou a proteger o rótulo curto no caminho default e no caminho de diagnóstico.
- [x] Validado com `node --check src/copilot/terminal/commands/tools.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js` (1 arquivo, 13 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-14-43-175Z/summary.md`, confirmando `/tools`, `/activity`, `/session sdk events`,
  `/session sdk waits`, `/metrics`, `/usage now` e `/events` sem regressão visual.

### Achados Novos Da Centésima Décima Sétima Passada

- [x] SDK10-P117-01: seguir padronizando atalhos de navegação em comandos irmãos e revisar se `Detalhe` ainda aparece
  em algum summary default que possa virar `Mais detalhes` sem perda de informação.

### Execução Contínua Em 2026-06-08 - Centésima Décima Oitava Passada

- [x] `/sdk` passou a usar `Mais detalhes` nos atalhos compactos de waits, capabilities, elicitation e permission.
- [x] O modo detalhado continua disponível, sem alterar o conteúdo técnico dos comandos ou dos painéis de suporte.
- [x] Teste de `/sdk` passou a cobrir o novo vocabulário compactado sem perder cobertura funcional.
- [x] Validado com `node --check src/copilot/terminal/commands/sdk.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_sdk.spec.js` (1 arquivo, 42 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-16-42-754Z/summary.md`, confirmando `/sdk`, `/session sdk events`,
  `/session sdk waits`, `/metrics`, `/usage now` e `/events` sem regressão visual.

### Achados Novos Da Centésima Décima Oitava Passada

- [x] SDK10-P118-01: revisar `display`, `usage` e demais comandos de suporte para padronizar o mesmo rótulo curto em
  atalhos compactos e reduzir ainda mais a linguagem de instrução no default.

### Execução Contínua Em 2026-06-08 - Centésima Décima Nona Passada

- [x] `/display` passou a usar `Mais detalhes` nos atalhos e estados de nível de detalhe, preservando os comandos
  `/display detail <...>`.
- [x] `/usage now` passou a usar `Mais detalhes /usage now detail para classe técnica` no bloco resumido de cobrança LLM.
- [x] Teste de `/display` atualizado para o novo rótulo, e o bloco de `/usage now` foi revalidado junto de `/metrics`.
- [x] Validado com `node --check src/copilot/terminal/commands/display.js && node --check src/copilot/terminal/commands/usage.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_display.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`
  (2 arquivos, 20 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-19-06-305Z/summary.md`, confirmando `/display`, `/usage now`, `/activity`,
  `/session sdk events`, `/session sdk waits`, `/metrics` e `/events` sem regressão visual.

### Achados Novos Da Centésima Décima Nona Passada

- [x] SDK10-P119-01: rodar uma busca final por rótulos `Detalhe` em summaries default restantes e separar o que é
  detalhe de dado real do que ainda é apenas atalho de navegação.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Passada

- [x] Busca final por `terminalThemeRow('Detalhe'|'Detalhes')` separou atalhos de navegação de linhas que carregam dado
  real do runtime.
- [x] `/status`, `/live`, `/events`, `/activity` truncado e `/terminal libs` passaram a usar `Mais detalhes` nos atalhos
  de navegação.
- [x] `/activity` truncado deixou de renderizar a frase longa `mostra timeline completa` e passou a apontar diretamente
  para `/activity detail`.
- [x] Mantidos como `Detalhe` os campos que são dado operacional real: detalhe da atividade atual, detalhe de métrica,
  detalhe de diagnóstico e tags de modelo BYOK.
- [x] Validado com `node --check` dos comandos tocados.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js`
  (4 arquivos, 100 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-21-58-598Z/summary.md`, confirmando `/events` com `Mais detalhes`,
  `/activity`, `/session sdk events`, `/session sdk waits`, `/metrics`, `/usage now` e `/errors` sem regressão visual.

### Achados Novos Da Centésima Vigésima Passada

- [x] SDK10-P120-01: voltar da frente de microcopy para hardening estrutural: revisar se algum comando terminal ainda
  importa barrels largos quando há porta estreita disponível, priorizando `src/copilot/terminal/commands`.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Primeira Passada

- [x] Migração estrutural inicial dos comandos simples para portas estreitas: `tools`, `usage`, `metrics`, `diagnose`,
  `resume`, `search`, `export`, `activity`, `context` e `errors` deixaram de importar projeções via
  `terminal/frontend/index.js`.
- [x] `activity` passou a validar o caminho consolidado de eventos via `terminal/events/projections/index.js`,
  evitando fixture preso em módulo interno antigo.
- [x] Testes unitários foram atualizados para mockar as portas reais (`frontend/projections/{config,metrics,usage,now,timeline,status}.js`
  e `events/projections/index.js`) em vez do barrel largo quando o comando já usa a projection específica.
- [x] A busca residual em `src/copilot/terminal/commands` ficou limitada a comandos mais densos (`session`, `byok`,
  `plan`, `config`, `memory`, `fs`, `sdk`, `events`), separados para a próxima passada por terem acoplamento maior ou
  mock suites extensas.
- [x] Validado com `node --check` dos comandos tocados.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js tests/unit/copilot/terminal/test_commands_export.spec.js tests/unit/copilot/terminal/test_commands_context.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_config_errors.spec.js tests/unit/copilot/terminal/test_commands_memory_resume_search.spec.js tests/unit/copilot/contracts/test_terminal_timeline_projection_consistency.spec.js tests/unit/copilot/contracts/test_arch_contracts.spec.js`
  (10 arquivos, 157 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-29-53-139Z/summary.md`, confirmando `/usage now`, `/activity`, `/session sdk`,
  `/session sdk commands`, `/session sdk events`, `/session sdk waits`, `/metrics`, `/events sources` e `/errors` sem
  regressão visual.

### Achados Novos Da Centésima Vigésima Primeira Passada

- [x] SDK10-P121-01: continuar o corte de barrels largos nos comandos densos restantes (`session`, `byok`, `plan`,
  `config`, `memory`, `fs`, `sdk`, `events`), criando portas estreitas novas somente onde a projection/gateway atual
  ainda não expõe uma fronteira suficientemente específica.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Segunda Passada

- [x] `memory` passou a importar memórias via `frontend/projections/now.js`, `plan` via `frontend/projections/sdk-session-vanilla.js`
  e `config` passou a separar `frontend/projections/config.js` de `frontend/gateways/agent-runtime.js`.
- [x] `fs` e `sdk` passaram a ler I/O operacional pelo port estreito `terminal/events/projections/index.js`.
- [x] `events` deixou de usar o barrel amplo e passou a consumir os presenters e adaptadores específicos
  (`event-adapter-events.js` e `dialog-recovery-presenter.js`) no caminho comum.
- [x] Testes unitários foram atualizados para mockar as novas projeções/gateways diretamente, preservando isolamento
  e alinhando o contrato de import com o runtime real.
- [x] A busca residual em `src/copilot/terminal/commands` agora ficou concentrada em `session.js` e `byok.js`.
- [x] Validado com `node --check` dos comandos tocados.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_memory_resume_search.spec.js tests/unit/copilot/terminal/test_commands_plan.spec.js tests/unit/copilot/terminal/test_commands_config_errors.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/contracts/test_arch_contracts.spec.js`
  (7 arquivos, 185 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-34-12-903Z/summary.md`, confirmando `/usage now`, `/activity`, `/session sdk`,
  `/session sdk commands`, `/session sdk events`, `/session sdk waits`, `/metrics`, `/events sources` e `/errors` sem
  regressão visual.

### Achados Novos Da Centésima Vigésima Segunda Passada

- [x] SDK10-P122-01: fazer a passagem separada nos comandos de maior acoplamento (`session` e `byok`), para cortar o
  último barrel amplo e decidir, com cuidado, se convém expor uma fronteira de projection/adapter mais granular.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Terceira Passada

- [x] `session` passou a ler projeções via `frontend/projections/index.js`, e os imperativos de boot/remoção ficaram
  separados entre `frontend/gateways/session/index.js` e `frontend/gateways/sdk-session.js`.
- [x] `byok` passou a buscar `readTerminalByokProjection`, `readTerminalByokGatewayProjectionFromEnv`, `readTerminalConfigProjection`
  e `setTerminalModelProjection` diretamente em `frontend/projections/config.js`, enquanto `listTerminalSdkSessionInventory`
  e `readTerminalRuntimeState` vieram de gateways específicos.
- [x] Os testes grandes de `session` e `byok` foram realinhados para mockar essas portas estreitas, mantendo o isolamento
  sem depender do barrel `frontend/index.js`.
- [x] A busca residual por `from '../frontend/index.js'` e `from '../events/index.js'` dentro de
  `src/copilot/terminal/commands` ficou vazia.
- [x] Validado com `node --check` dos comandos tocados.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (2 arquivos, 170 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000`; PASS em
  `artifacts/terminal-live/2026-06-08T15-40-10-686Z/summary.md`, confirmando `/usage now`, `/activity`, `/session sdk`,
  `/session sdk commands`, `/session sdk events`, `/session sdk waits`, `/metrics`, `/events sources` e `/errors` sem
  regressão visual.

### Achados Novos Da Centésima Vigésima Terceira Passada

- [x] SDK10-P123-01: continuar a investigação além dos comandos, agora revisando barrels amplos restantes em
  `src/copilot/terminal` e procurando oportunidades de UX/hardening que apareçam em `frontend/index.js`,
  `events/index.js` e módulos vizinhos.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Quarta Passada

- [x] Análise minuciosa da imagem do terminal: o bloco `Resposta pós-pergunta  LLM-B via SDK` era um vazamento do
  `protocolKind=question` para o operador. Em sessões de muitas horas, quase toda continuação depois de `ask_user`
  pode ser tecnicamente "pós-pergunta", então o rótulo não separava estado útil de transporte interno e fazia uma
  resposta normal da LLM-B parecer um modo especial.
- [x] Causa raiz do status seguinte na imagem: `sendTurn()` registrava `recordTerminalActivity('turn', 'Processando mensagem')`
  no início do turno, e `buildWaitingPrompt()` renderizava literalmente `LLM-B pensando · turno · Processando mensagem`.
  Esse texto é correto como marcador interno, mas pobre como UX porque combina duas palavras genéricas e não explica a
  etapa real quando o humano acabou de responder.
- [x] `assistant.message` classificado como `question` agora renderiza `Resposta da LLM-B`, preservando a origem
  `LLM-B via SDK` sem expor "pós-pergunta" no cabeçalho do transcript.
- [x] O registro após resposta humana de `ask_user` deixou de chamar `Continuação pós-pergunta` e passou a usar
  `Resposta registrada`, enquanto a linha viva/prompt de espera compacta esse estado para `LLM-B continuando`.
- [x] O prompt de espera deixou de vazar `turno · Processando mensagem` no caminho comum; quando a atividade atual é
  apenas o turno genérico, a superfície mostra `LLM-B pensando`, e quando é continuação após resposta humana mostra
  `LLM-B continuando`.
- [x] O runner live da LLM-B passou a reconhecer tanto o cabeçalho antigo quanto `Resposta da LLM-B`, permitindo validar
  a migração sem quebrar artefatos históricos durante a transição.
- [x] Mantido o vocabulário `continuação pós-pergunta vazia` apenas no fluxo específico de recuperação automática quando
  a LLM-B encerra uma continuação sem texto público. Esse é um diagnóstico acionável diferente do cabeçalho normal de
  mensagem, e continua coberto por testes próprios.
- [x] O validador vivo também foi realinhado para aceitar a superfície atual de `/activity` e `/intent`, com
  `Mais detalhes /activity detail` e envelope humano `origem SDK` quando a intenção vem do assistente.
- [x] Validado com `node --check src/copilot/terminal/events/sdk-session-events.js && node --check src/copilot/terminal/dialog/output.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_build_user_prompt.spec.js tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js`
  (7 arquivos, 140 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T02-16-46-462Z/summary.md`, confirmando o cenário canônico completo
  com `ask_user`, a resposta humana `SIM`, o cabeçalho `Resposta da LLM-B`, os cockpits `/session sdk`,
  `/session sdk waits`, `/events`, `/metrics`, `/activity` e a saída limpa.

### Achados Novos Da Centésima Vigésima Quarta Passada

- [ ] SDK10-P124-01: revisar as telas `/activity`, `/metrics`, `/usage now` e recovery para separar rigorosamente
  vocabulário de protocolo, diagnóstico acionável e microcopy de operador; qualquer ocorrência de `pós-pergunta` deve
  permanecer restrita a recuperação vazia ou ser renomeada para uma ação humana concreta.

### Achados Novos Da Centésima Vigésima Quinta Passada

- [ ] SDK10-P125-01: a linha viva ainda pode mostrar `turno · Contexto atualizado` durante bursts de processamento;
  investigar se dá para trocar esse pulso residual por um verbo mais operacional, sem perder a distinção entre
  waiting, question e turn.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Sexta Passada

- [x] `Pending messages alteradas` passou a se humanizar como `Contexto da conversa atualizado` nas superfícies de
  diagnóstico e sessão, alinhando o vocabulário com o restante do terminal.
- [x] A linha viva periódica comprime essa mesma atividade para `Conversa atualizada`, evitando truncamento na largura
  estreita do PTY sem perder a noção de que o contexto foi recalculado.
- [x] O teste da linha viva foi ajustado para proteger a forma compacta renderizada no pulso contínuo.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js` (1 arquivo, 27 testes).
- [x] Validado com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T02-30-10-503Z/summary.md`, confirmando a linha viva compacta, o
  cenário canônico completo e a saída limpa.

### Achados Novos Da Centésima Vigésima Sexta Passada

- [ ] SDK10-P126-01: revisar se há outras atividades de pulso periódico que ainda merecem compressão semelhante à
  linha viva de contexto, sem sacrificar o detalhe útil nos comandos de diagnóstico.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Sétima Passada

- [x] A linha viva de fase `turn` deixou de exibir o prefixo abstrato `turno ·` no caminho comum e passou a usar
  estados operacionais curtos: `preparando · Conversa atualizada`, `planejando · Intenção da LLM-B`, `pensando` e
  `finalizando` conforme o contexto.
- [x] O comportamento novo foi validado na superfície real do terminal com o cenário canônico, onde a linha viva
  exibiu `LLM-B preparando · Conversa atualizada` durante a retomada e manteve `LLM-B continuando` após `ask_user`.
- [x] A cobertura unitária da linha viva passou a proteger também o caso genérico `Processando mensagem`, evitando
  o retorno do prefixo `turno` em bursts de processamento.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js` (1 arquivo, 28 testes).
- [x] Validado com `node --check src/copilot/terminal/repl/live-status-line.js`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T02-35-25-284Z/summary.md`, confirmando o pulso humano compacto e o
  fechamento canônico limpo.

### Achados Novos Da Centésima Vigésima Sétima Passada

- [ ] SDK10-P127-01: seguir caçando outras superfícies periódicas em `src/copilot/terminal` que ainda falem em fase de
  runtime em vez de ação humana, sobretudo em status compactos que o operador vê de relance.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Oitava Passada

- [x] `/activity` passou a renderizar `phase=turn` como `Estado conversa`, mantendo `turn` apenas como semântica interna
  e preservando os títulos históricos de trace (`Resumo do turno atual`, `Último turno concluído`) onde o termo é
  diagnóstico útil.
- [x] `/status` e superfícies de sessão passaram a usar `conversa` para a fase viva equivalente, alinhando comando e
  linha viva sem alterar o estado armazenado nem os eventos SSE.
- [x] A timeline operacional ganhou cobertura contra os prefixos `turno ·` e `conversa ·` em eventos que já carregam o
  rótulo humano, como `Intenção da LLM-B`.
- [x] Validado com `node --check src/copilot/terminal/commands/activity.js && node --check src/copilot/terminal/commands/session.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js`
  (2 arquivos, 63 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T02-41-59-628Z/summary.md`, confirmando `/activity`, `/usage now`,
  `/events`, `ask_user` e pós-resposta sem regressão.

### Achados Novos Da Centésima Vigésima Oitava Passada

- [ ] SDK10-P128-01: revisar se `question` ainda cobre mais de uma semântica interna em `recordTerminalActivity`
  (`pergunta pendente`, `resposta registrada`, formulários, OAuth e mailbox), e decidir se a unificação correta é por
  fase nova ou por presenter comum.

### Execução Contínua Em 2026-06-08 - Centésima Vigésima Nona Passada

- [x] `question` passou a ter apresentação contextualizada por subestado tanto na linha viva quanto em `/activity`:
  `pergunta` para ask_user humano, `continuando` para resposta registrada, `decisão` para formulário/permissão e
  `intervenção`/`integração` para os fluxos auxiliares.
- [x] O estado interno permaneceu estável, mas a UX agora evita tratar OAuth, mailbox e formulário como se fossem a
  mesma coisa que a pergunta humana direta.
- [x] A timeline de `/activity` também ganhou cobertura para impedir a regressão do rótulo genérico `pergunta` quando
  o subestado já é claramente outra ação operacional.
- [x] Validado com `node --check src/copilot/terminal/repl/live-status-line.js && node --check src/copilot/terminal/commands/activity.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_activity.spec.js`
  (2 arquivos, 42 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T02-48-15-604Z/summary.md`, confirmando o fluxo canônico, a linha viva
  humana e o painel `/activity` sem regressão.

### Achados Novos Da Centésima Vigésima Nona Passada

- [x] SDK10-P129-01: continuar revisando os outros subestados `question` e decidir se vale extrair um presenter
  compartilhado entre linha viva, `/activity` e `/status`, ou se a variedade atual já está suficientemente estável.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Passada

- [x] A classificação dos subestados internos de `question` foi extraída para
  `src/copilot/terminal/events/question-activity-presenter.js`, com reexport dedicado em
  `src/copilot/terminal/events/presenters/question/index.js`.
- [x] Linha viva e `/activity` deixaram de manter tabelas paralelas para `resposta registrada`, mailbox/intervenção,
  permissão/formulário, OAuth/Sampling MCP, pergunta humana e fallback de interação.
- [x] O presenter canônico expõe rótulos separados para cada superfície: `continuando` na linha viva pós-resposta e
  `continuação` no estado histórico de `/activity`, preservando a semântica visual já validada.
- [x] A cobertura direta foi adicionada em `tests/unit/copilot/terminal/test_question_activity_presenter.spec.js`,
  protegendo o glossário compartilhado contra regressões futuras.
- [x] Validado com `node --check src/copilot/terminal/events/question-activity-presenter.js &&
  node --check src/copilot/terminal/events/presenters/question/index.js &&
  node --check src/copilot/terminal/repl/live-status-line.js &&
  node --check src/copilot/terminal/commands/activity.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_question_activity_presenter.spec.js
  tests/unit/copilot/terminal/test_live_status_line.spec.js
  tests/unit/copilot/terminal/test_commands_activity.spec.js` (3 arquivos, 50 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T02-58-58-442Z/summary.md`, confirmando `LLM-B continuando` após o SIM,
  `Resposta da LLM-B` no transcript final e ausência dos vazamentos antigos `Resposta pós-pergunta`/`turno ·
  Processando mensagem`.

### Achados Novos Da Centésima Trigésima Passada

- [x] SDK10-P130-01: o live canônico ainda mostrou no `/activity 40` linhas de conclusão como `Integração externa
  concluída — aguardando decisão humana concluído` e `Integração externa concluída — lendo arquivo concluído`; investigar
  `tool-lifecycle-runtime.js`/`tool-activity-presenter.js` para trocar o fallback genérico por conclusão semântica da
  própria ferramenta (`Pergunta ao operador concluída`, `Leitura concluída`, etc.) sem perder o diagnóstico de integração.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Primeira Passada

- [x] `tool-lifecycle-runtime.js` deixou de registrar completions externos/pós-tool-use com o label genérico
  `Integração externa concluída/falhou` no `activity-state`.
- [x] O mesmo helper de fase/rótulo já usado pelo caminho nativo agora cobre completions externos: `ask_user` volta para
  `phase=question` com `Pergunta respondida`, intents usam `Intenção registrada`, leitura usa `Leitura concluída` e
  execuções com erro usam `Execução falhou`.
- [x] `/activity` foi ajustado para reconhecer rótulos operacionais (`Leitura`, `Edição`, `Execução`, etc.) como títulos
  já humanos, evitando o retorno de prefixos redundantes como `ferramenta · Leitura concluída`.
- [x] O presenter compartilhado de `question` também passou a classificar `Pergunta respondida`/`Resposta do operador`
  como fluxo de continuação, preservando `LLM-B continuando` quando esse estado aparecer na linha viva entre resposta
  humana e próxima fala da LLM-B.
- [x] Validado com `node --check src/copilot/terminal/events/tool-lifecycle-runtime.js &&
  node --check src/copilot/terminal/events/question-activity-presenter.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_question_activity_presenter.spec.js
  tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js
  tests/unit/copilot/terminal/test_commands_activity.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js
  tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js` (5 arquivos, 85 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T03-05-32-879Z/summary.md`, confirmando `/activity 40` com
  `Pergunta respondida`, `Leitura concluída` e `Intenção registrada`, sem o fallback genérico de integração externa.

### Achados Novos Da Centésima Trigésima Primeira Passada

- [x] SDK10-P131-01: o resumo de último turno ainda lista `Pergunta ao operador` dentro da seção `Ferramentas` e depois
  novamente em `Interações humanas`; investigar o turn trace/projection para separar action/tool técnica de interação
  humana na superfície resumida, sem perder a contagem operacional do SDK.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Segunda Passada

- [x] `/activity` passou a filtrar tools humanas (`ask_user`/`request_user_input`/`operation=ask`) da seção
  `Ferramentas` quando o mesmo trace já possui `Interações humanas`.
- [x] A contagem default agora reflete a superfície humana (`Ferramentas 0`, `Operador 1` para turno só de pergunta),
  enquanto o modo `detail` preserva a pista de contagem bruta do SDK em `SDK bruto`.
- [x] A cobertura unitária reproduz o cenário canônico do live: `ask_user` concluído com resposta `SIM` aparece apenas
  em `Interações humanas`, sem linha duplicada `Ferramenta Pergunta ao operador`.
- [x] Validado com `node --check src/copilot/terminal/commands/activity.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_activity.spec.js` (1 arquivo, 14 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T03-13-40-835Z/summary.md`, confirmando `/activity 40` com
  `Ferramentas 0`, `Operador 1` e a pergunta canônica somente em `Interações humanas`.

### Achados Novos Da Centésima Trigésima Segunda Passada

- [x] SDK10-P132-01: no live canônico, logo após `Intervenção   modelo ocioso; encaminhada como novo turno`, o prompt
  default reapareceu antes do estado vivo de processamento; investigar renderização/prompt parking nesse caminho para
  evitar uma piscada de prompt ocioso enquanto o turno já foi aceito.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Terceira Passada

- [x] `repl-lifecycle.js` passou a definir o prompt efetivo como `buildWaitingPrompt()` logo antes de encaminhar uma
  intervenção com modelo ocioso como novo turno, além de manter `parkTerminalPromptForContinuation()`.
- [x] A linha durável `Intervenção   modelo ocioso; encaminhada como novo turno` continua sem `redrawPrompt`, mas agora
  qualquer repaint automático do readline nesse intervalo usa estado de espera, não o prompt default ocioso.
- [x] Foi adicionada cobertura unitária em `tests/unit/copilot/terminal/test_repl_lifecycle.spec.js`, simulando readline
  e política zero-PR para garantir que o handoff define `LLM-B pensando` antes de `sendTurn()`.
- [x] Validado com `node --check src/copilot/terminal/repl/repl-lifecycle.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_repl_lifecycle.spec.js
  tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js` (2 arquivos, 26 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T03-20-02-965Z/summary.md`, confirmando o handoff sem prompt default entre
  `Intervenção` e `LLM-B preparando`.

### Achados Novos Da Centésima Trigésima Terceira Passada

- [x] SDK10-P133-01: após a resposta humana `SIM`, a linha viva em alguns runs mostra `LLM-B finalizando` quase
  imediatamente, sem passar visivelmente por `LLM-B continuando`; investigar se o evento `Pergunta respondida` está sendo
  sobreposto rápido demais por `turn`/finalização e se vale um grace label curto para continuidade pós-resposta.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Quarta Passada

- [x] A linha viva ganhou uma janela curta de continuidade pós-resposta: quando uma finalização de turno acontece até
  5s depois de uma atividade `question` classificada como `continuando`, o pulso mostra `LLM-B continuando` em vez de
  saltar imediatamente para `finalizando`.
- [x] A heurística ficou local em `live-status-line.js` e usa `readTerminalActivityHistory(8)`, evitando alterar a
  semântica global de foco/atividade do terminal.
- [x] `src/copilot/terminal/state/repl/index.js` passou a reexportar `readTerminalActivityHistory` para a superfície REPL.
- [x] A cobertura unitária adicionada em `test_live_status_line.spec.js` protege o caso de `Pergunta respondida` seguida
  de `Turno do assistente concluído`, garantindo `continuando` e ausência de `finalizando` nessa janela.
- [x] Validado com `node --check src/copilot/terminal/repl/live-status-line.js &&
  node --check src/copilot/terminal/state/repl/index.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js` (1 arquivo, 30 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T03-25-13-712Z/summary.md`, observando `LLM-B continuando` por 1s, 2s e 3s
  após o `SIM` antes da resposta final.

### Achados Novos Da Centésima Trigésima Quarta Passada

- [x] SDK10-P134-01: em um live run apareceu uma pintura breve do comando `/activity 12` na linha do prompt antes da
  saída do comando; investigar se comandos rápidos ainda podem ecoar/repintar input de forma visualmente irregular sob
  PTY e linha viva ativa.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Quinta Passada

- [x] O runner live passou a sincronizar também o primeiro comando de uma sequência diagnóstica com o prompt REPL, não
  apenas os comandos seguintes. Isso evita que o próprio teste injete `/usage now`/`/activity` antes de o operador
  humano ter uma linha de prompt visível.
- [x] O live canônico ganhou o critério `ux-diagnostic-commands-start-at-prompt`, que reprova comandos diagnósticos
  ecoados como linha solta (`/usage now`, `/activity 40`, `/events`, `/health`, etc.) sem `você[…]›`.
- [x] A investigação do P134 expôs um bug real mascarado: a recuperação automática pós-pergunta mantinha um ledger de
  chaves, mas o listener de `dialog.turn_end` não passava esse ledger para `shouldAttemptEmptyAfterUserInputAutoRecovery`,
  permitindo retomadas repetidas para a mesma resposta humana dentro da janela de 30s.
- [x] `terminal-agent-wiring.js` agora passa `attemptedKeys: emptyAfterUserInputAutoRecoveryKeys`, impedindo a segunda
  retomada automática pós-pergunta e evitando uma fala extra de fechamento depois de `POST-ASK-CANONICAL-FINAL`.
- [x] `dialog.turn_end` com reply já materializado por `assistant.message` agora agenda um redraw final de prompt com
  guarda por fase `idle`. Se uma pergunta humana aparece logo depois dos deltas, o redraw é descartado; se era o final
  pós-pergunta, o prompt volta e o operador pode seguir com diagnósticos/comandos.
- [x] `output.js` passou a tratar `question` como fase operacional para suppression de prompt, evitando que o prompt
  default apareça entre `Resposta enviada`, `Pergunta respondida` e o resumo `Turno 1 ação`.
- [x] O harness e os testes cobrem os três pontos: comando diagnóstico deve começar em prompt visível; fase `question`
  continua protegida contra repaint prematuro; `turn_end` materializado devolve o prompt apenas quando a atividade
  realmente voltou para `idle`.
- [x] Validado com `node --check src/copilot/terminal/wiring/terminal-agent-wiring.js
  src/copilot/terminal/dialog/output.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js
  tests/unit/copilot/test_terminal_agent_wiring.spec.js tests/unit/copilot/test_terminal_dialog_engine.spec.js`
  (3 arquivos, 63 testes).
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T03-49-48-450Z/summary.md`, confirmando prompt pós-`POST-ASK`,
  `/usage now` pós-resposta iniciado em `você[…]›`, ausência de retomada duplicada e ausência de prompt prematuro entre
  resposta humana e resumo da pergunta.

### Achados Novos Da Centésima Trigésima Quinta Passada

- [x] SDK10-P135-01: os runs bloqueados intermediários mostraram que o modelo pode chamar `ask_user` antes dos oito
  deltas públicos obrigatórios ou escrever deltas com texto extra na mesma linha. O harness agora torna essa regra
  explícita no prompt canônico e reprova deltas que não sejam linhas exatas `DELTA-CANONICAL-1..8`, sem esconder falhas
  reais do SDK/LLM.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Sexta Passada

- [x] O prompt canônico do live test passou a dizer que cada uma das oito linhas `DELTA-CANONICAL-*` deve conter apenas
  o marcador exato, sem texto auxiliar na mesma linha.
- [x] `llm-b-live-test` ganhou o critério obrigatório `canonical-delta-lines-exact`, calculado tanto pelos blocos
  visíveis do terminal quanto pelos eventos `assistant.message` do transcript canônico.
- [x] A checagem normaliza bordas renderizadas com `│`, ANSI e espaços, mas exige as oito linhas distintas
  `DELTA-CANONICAL-1` até `DELTA-CANONICAL-8`; marcador correto colado em frase ou lista passa a falhar.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T03-54-53-189Z/summary.md`, incluindo
  `canonical-delta-lines-exact` e `ux-diagnostic-commands-start-at-prompt`.

### Achados Novos Da Centésima Trigésima Sexta Passada

- [x] SDK10-P136-01: auditar a janela pós-`ask_user` no log bruto e nos eventos exportados para garantir que a sequência
  visual e semântica seja sempre `Resposta enviada` -> continuação/ferramentas -> `Resposta da LLM-B` -> prompt pronto,
  sem ressurgimento de rótulos antigos como `Resposta pós-pergunta`, `turno · Processando mensagem` ou status duplicado
  `pensando/processando` após uma resposta já materializada.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Sétima Passada

- [x] A auditoria do artifact `artifacts/terminal-live/2026-06-09T03-54-53-189Z/summary.md` confirmou que o pós-`ask_user`
  público já estava correto (`Resposta enviada` -> `LLM-B continuando` -> `Resposta da LLM-B` -> prompt pronto), mas
  expôs outra piscada real: o `assistant.turn_end` intermediário de um turno só de ferramentas aparecia como
  `LLM-B finalizando` antes do watchdog `LLM-B pensando · 10s sem resposta pública`.
- [x] `live-status-line.js` agora trata `Turno do assistente concluído` como `continuando` quando o runtime ainda está
  processando e não houve resposta pública recente; `finalizando` fica reservado para encerramento real ou para turnos
  que acabaram de materializar mensagem pública.
- [x] A regra preserva a janela pós-resposta humana já validada: `Pergunta respondida` seguida de `turn_end` continua
  mostrando `LLM-B continuando`, sem voltar para o rótulo antigo `Resposta pós-pergunta`.
- [x] O live harness ganhou os critérios `ux-no-intermediate-finalizing-before-public-output` e
  `ux-no-legacy-post-answer-labels`, protegendo a imagem original contra regressão no terminal real.
- [x] Validado com `node --check src/copilot/terminal/repl/live-status-line.js
  scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_live_status_line.spec.js` (1 arquivo, 32 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T04-02-46-641Z/summary.md`, observando
  `LLM-B continuando · 0s/1s` antes de `LLM-B pensando · 10s sem resposta pública`, sem `finalizando` intermediário e
  sem `Resposta pós-pergunta`/`turno · Processando mensagem` na superfície pública.

### Achados Novos Da Centésima Trigésima Sétima Passada

- [x] SDK10-P137-01: revisar o `/events --raw` e os previews do archive SSE, pois eventos internos ainda exibem
  `Turno do assistente concluído` cru no payload preview. Confirmar se isso deve continuar restrito ao raw técnico ou se
  há alguma superfície default/detail onde o fechamento intermediário de tool-only turn ainda deveria ser humanizado como
  continuação do pedido.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Oitava Passada

- [x] `/events --raw` agora humaniza `activity.changed` de `Turno do assistente concluído` quando o evento anterior ainda
  era operacional: o preview passa a dizer `continuação do pedido` em vez de sugerir conclusão final da conversa.
- [x] `terminal.activity` isolado com o mesmo evento técnico passa a aparecer como `etapa da LLM-B encerrada`, mantendo o
  raw útil para diagnóstico sem contaminar a leitura do operador com linguagem interna do SDK.
- [x] O live harness ganhou o critério `sse-archive-raw-preview-humanized-intermediate-turn`, condicional à janela do
  preview: quando o turno intermediário aparece no raw preview, ele precisa estar humanizado.
- [x] A investigação dos timeouts pós-`POST-ASK-CANONICAL-FINAL` mostrou que remover `force` do redraw final evitava
  alguns prompts duplicados, mas podia deixar o runner e o operador sem prompt de comando quando a materialização ainda
  estava marcada como ativa.
- [x] `scheduleTerminalPromptRedraw()` ganhou a opção `finalizeTurn`: ela atravessa janelas de estacionamento/supressão
  pós-resposta e materialização visual ainda ativa, mas continua respeitando input humano parcial e dedupe de prompt
  idêntico recente.
- [x] O repaint final pós-`dialog.turn_end` materializado agora usa `{ finalizeTurn: true }`; comandos explícitos
  continuam usando `{ force: true }`, separando "devolver controle ao operador" de "repintar imediatamente por comando".
- [x] O prompt final também limpa a linha viva reservada e abre uma linha própria quando havia status residual; isso
  elimina a colagem `LLM-B trabalhando · Mensagem da LLM-B recebida…você[…]›` vista em live e permite diagnósticos
  começarem sempre em prompt visível.
- [x] Validado com `node --check src/copilot/terminal/dialog/output.js
  src/copilot/terminal/wiring/terminal-agent-wiring.js src/copilot/terminal/commands/events.js
  scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js tests/unit/copilot/test_terminal_agent_wiring.spec.js
  tests/unit/copilot/test_terminal_dialog_output.spec.js` (4 arquivos, 83 testes).
- [x] Live bloqueado diagnóstico: `artifacts/terminal-live/2026-06-09T04-20-59-779Z/summary.md` e
  `artifacts/terminal-live/2026-06-09T04-28-06-262Z/summary.md` mostraram `postAsk=observed` mas timeout em diagnósticos,
  confirmando que a falha era devolução/limpeza do prompt final, não boot nem SSE.
- [x] Live bloqueado de contrato do modelo: `artifacts/terminal-live/2026-06-09T04-31-51-726Z/summary.md` registrou
  `assistant-asked-before-required-deltas` com `deltasBeforeAsk=0`; o terminal coletou diagnósticos corretamente, mas a
  LLM-B chamou `ask_user` antes da resposta pública exigida pelo cenário.
- [x] Validado live final com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000
  --live-scenario=canonical`; PASS em `artifacts/terminal-live/2026-06-09T04-32-50-896Z/summary.md`, incluindo
  `sse-archive-raw-preview-humanized-intermediate-turn`, `ux-diagnostic-commands-start-at-prompt`,
  `no-prompt-double-render` e `ux-no-intermediate-finalizing-before-public-output`.

### Achados Novos Da Centésima Trigésima Oitava Passada

- [x] SDK10-P138-01: em `artifacts/terminal-live/2026-06-09T04-20-59-779Z/terminal.plain.log`, a resposta pública antes
  dos deltas incluiu `&lt;thinking&gt;`, uma frase em chinês e `&lt;/thinking&gt;`. O HTML foi escapado, mas a semântica
  de "thinking" vazou para o operador; adicionar critério live e decidir se o terminal deve filtrar tags de raciocínio
  conhecidas ou apenas reprovar o provider/modelo.
- [x] SDK10-P138-02: o live `artifacts/terminal-live/2026-06-09T04-31-51-726Z/summary.md` confirmou que a LLM-B pode
  chamar `ask_user` antes de materializar a resposta pública obrigatória, mesmo com instrução explícita. Investigar se o
  terminal deve oferecer uma política opcional de guarda para fluxos que exigem "resposta pública antes da pergunta", ou
  se isso deve ficar como contrato/validador de harness.

### Execução Contínua Em 2026-06-08 - Centésima Trigésima Nona Passada

- [x] `turn-display.js` agora possui `stripPublicReasoningLeakText()`, uma sanitização única para remover blocos iniciais
  `<thinking>`, `<analysis>` e `<reasoning>` que vazem no canal público. A regra é conservadora: só remove blocos no
  começo da resposta e preserva exemplos literais que apareçam depois de texto público.
- [x] O streaming visual passa a decidir abertura do bloco usando `sanitizeTerminalRenderText(state.streamingBuffer)`;
  assim, um bloco inicial de raciocínio completo ou ainda aberto não dispara transcript público nem aparece antes dos
  deltas reais.
- [x] `assistant-transcript-renderer.js` e `sdk-session-events.js` usam o mesmo sanitizador antes de renderizar,
  materializar e arquivar `assistant.message`, evitando divergência entre tela ao vivo, transcript local, export Markdown
  e envelope público canônico.
- [x] O live harness ganhou o critério `ux-no-public-reasoning-tags`, calculado antes dos diagnósticos raw, para reprovar
  qualquer tag pública `thinking/analysis/reasoning` sem confundir com comandos técnicos posteriores.
- [x] Validado com `node --check src/copilot/terminal/dialog/turn-display.js
  src/copilot/terminal/events/assistant-transcript-renderer.js src/copilot/terminal/events/sdk-session-events.js
  scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_turn_display.spec.js
  tests/unit/copilot/terminal/test_assistant_transcript_renderer.spec.js
  tests/unit/copilot/test_terminal_sdk_session_events.spec.js` (3 arquivos, 52 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T04-41-25-967Z/summary.md`, incluindo
  `ux-no-public-reasoning-tags`, `canonical-delta-lines-exact`, `sse-archive-raw-preview-humanized-intermediate-turn` e
  `ux-diagnostic-commands-start-at-prompt`.

### Achados Novos Da Centésima Trigésima Nona Passada

- [x] SDK10-P139-01: auditar o contrato de `assistant.message` sanitizado versus SSE raw: hoje o canal público canônico
  passa a receber conteúdo sem blocos iniciais de raciocínio, mas os eventos `delta` ainda preservam chunks crus para
  diagnóstico. Decidir se `/events --raw full` deve continuar como evidência forense crua ou também carregar um campo
  público sanitizado paralelo.

### Execução Contínua Em 2026-06-08 - Centésima Quadragésima Passada

- [x] A análise da imagem e do live bloqueado confirmou que "resposta pós-pergunta" não deve ser um estado nominal de
  produto: em sessões longas há respostas comuns, perguntas humanas e continuações após resposta humana; o rótulo antigo
  induzia a leitura de um fluxo paralelo permanente.
- [x] A decisão de UX foi não bloquear globalmente `ask_user` antes de resposta pública: uma pergunta clarificadora no
  começo do turno é legítima. O terminal agora marca apenas o caso suspeito: pergunta humana emitida logo após atividade
  operacional recente de tool/arquivo e sem materialização pública do assistente.
- [x] `sdk-session-events.js` passou a observar a materialização pública do turno e a projeção curta de trace; se houver
  tool/arquivo recente sem delta/mensagem pública, a atividade vira `Pergunta antes de síntese pública` com severidade
  `warn`.
- [x] O primeiro live após a mudança expôs um falso positivo no fluxo correto `tools -> deltas públicos -> ask_user`.
  `turn-materialization-state.js` agora oferece uma leitura booleana temporal de materialização pública recém-concluída,
  sem expor conteúdo, e o warning só dispara quando não houve fala pública ativa ou concluída após a atividade
  operacional suspeita.
- [x] `human-question-renderer.js` ganhou o campo opcional `Contexto`, preservando a ação principal da pergunta e
  explicando discretamente que a LLM-B pediu resposta antes de escrever uma síntese pública.
- [x] A cobertura unitária reproduz os dois lados do fluxo: trace operacional recente com materialização pública vazia
  renderiza `Contexto`; trace operacional seguido por deltas públicos materializados não renderiza o alerta.
- [x] Validado com `node --check src/copilot/terminal/state/turn-materialization-state.js &&
  node --check src/copilot/terminal/state/events/index.js &&
  node --check src/copilot/terminal/events/sdk-session-events.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_turn_materialization_state.spec.js
  tests/unit/copilot/terminal/test_human_question_renderer.spec.js
  tests/unit/copilot/test_terminal_sdk_session_events.spec.js` (3 arquivos, 49 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000 --live-scenario=canonical`;
  PASS em `artifacts/terminal-live/2026-06-09T04-56-31-438Z/summary.md`, confirmando o card canônico sem `Contexto`
  indevido depois dos oito deltas públicos e `/activity 40` com `Pergunta ao operador`, não
  `Pergunta antes de síntese pública`.

### Achados Novos Da Centésima Quadragésima Passada

- [x] SDK10-P140-01: após a correção de observabilidade de pergunta antes de síntese pública, executar live canônico e
  revisar se o warning deve aparecer apenas em `/activity`/card ou também no archive SSE como campo estruturado
  `prePublicResponse: true`, para permitir dashboards detectarem esse padrão sem parsing textual.

### Execução Contínua Em 2026-06-08 - Centésima Quadragésima Primeira Passada

- [x] A decisão do P139 foi preservar `chunk` cru em eventos SSE `delta` como evidência forense, sem rebaixar
  `/events --raw full` a uma superfície apenas sanitizada.
- [x] `turn-display.js` passou a adicionar `publicChunk` ao envelope `delta`, calculado pela mesma sanitização pública do
  terminal. Clientes, replay e dashboards passam a ter um campo seguro sem precisar reinterpretar HTML, ANSI ou tags de
  raciocínio.
- [x] O cálculo de `publicChunk` é acumulativo: se `<thinking>`/`</thinking>` vier dividido em múltiplos deltas, o
  primeiro evento público seguro fica vazio e o segundo entrega apenas o texto realmente público, evitando vazamento por
  fronteira de chunk.
- [x] `assistant.message` continua com `content` já sanitizado no canal público canônico; a retenção forense crua fica
  concentrada em `delta.chunk` e nas superfícies raw explícitas.
- [x] O live harness ganhou o critério `sse-delta-public-chunk`, exigindo que todos os eventos SSE `delta` carreguem
  `publicChunk` e que esse campo não contenha tags `thinking/analysis/reasoning`.
- [x] O primeiro live com o critério novo passou em `sse-delta-public-chunk` (`22/22`, sem reasoning leak), mas falhou
  em `no-prompt-double-render`: no fluxo de recuperação canônico, o modelo escreveu os deltas, voltou ao prompt, o
  harness pediu continuação e, depois do `POST-ASK-CANONICAL-FINAL`, apareceram dois prompts adjacentes antes de
  `/usage now`.
- [x] `output.js` ampliou a janela de dedupe de prompt idêntico para cobrir a cauda real de `assistant.turn_end`/
  `sessionend` pós-streaming final, mantendo repaint `{ force: true }` para comandos explícitos.
- [x] Validado com `node --check src/copilot/terminal/dialog/turn-display.js
  src/copilot/terminal/dialog/output.js
  scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_dialog_output_inline_status.spec.js
  tests/unit/copilot/terminal/test_turn_display.spec.js` (2 arquivos, 53 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Live bloqueado diagnóstico: `artifacts/terminal-live/2026-06-09T05-04-59-064Z/summary.md` confirmou
  `sse-delta-public-chunk`, mas falhou `no-prompt-double-render`, expondo a necessidade do dedupe pós-turno ampliado.
- [x] Validado live final com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000
  --live-scenario=canonical`; PASS em `artifacts/terminal-live/2026-06-09T05-09-51-796Z/summary.md`, confirmando
  `sse-delta-public-chunk` (`23/23`, sem reasoning leak), `no-prompt-double-render` e o fluxo de recuperação
  canônico sem duplicar prompt depois do `POST-ASK-CANONICAL-FINAL`.

### Achados Novos Da Centésima Quadragésima Primeira Passada

- [x] SDK10-P141-01: após o live com `sse-delta-public-chunk`, avaliar se comandos `/events --json compact` devem
  privilegiar `publicChunk` nos previews compactos de `delta`, mantendo `chunk` cru apenas no modo full/raw.

### Execução Contínua Em 2026-06-08 - Centésima Quadragésima Segunda Passada

- [x] `user_input.requested` passou a carregar `prePublicResponse` e `prePublicResponseReason` no envelope SSE. A
  superfície humana continua com card/atividade, mas dashboards e `/events --json` deixam de depender de parsing textual
  para detectar pergunta humana antes de síntese pública.
- [x] O campo fica explícito também no fluxo normal: `prePublicResponse: false` e `prePublicResponseReason: null` quando
  a pergunta veio depois de materialização pública recente.
- [x] A cobertura unitária em `test_terminal_sdk_session_events.spec.js` valida tanto o caso suspeito quanto o fluxo
  canônico `tools -> deltas públicos -> ask_user`.
- [x] Validado com `node --check src/copilot/terminal/events/sdk-session-events.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events.spec.js` (1 arquivo, 29 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-08 - Centésima Quadragésima Terceira Passada

- [x] `/events --json compact event=delta` agora usa `publicChunk` como `payloadPreview` quando ele existe, evitando que
  automações e dashboards compactos vejam `chunk` cru com tags de raciocínio ou HTML bruto.
- [x] `/events --raw preview` e `/events --raw full` permanecem forenses: o payload cru continua acessível apenas nas
  superfícies explicitamente raw/full.
- [x] A cobertura unitária adiciona um delta com `chunk` contendo `<thinking>segredo</thinking>` e `publicChunk` seguro,
  validando que o JSON compacto expõe `DELTA-CANONICAL-1` e não contém o segredo bruto.
- [x] Validado com `node --check src/copilot/terminal/commands/events.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 31 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-09 - Centésima Quadragésima Quarta Passada

- [x] A revisão da captura foi aprofundada no fluxo de recuperação após resposta humana: `Resposta pós-pergunta` já não
  aparecia no caminho principal de `assistant.message`, mas a família de strings `continuação pós-pergunta` ainda vazava
  em `dialog.turn_end` vazio, `/events`, linha viva e atividades de recuperação automática.
- [x] A decisão de UX foi aposentar `pós-pergunta` como linguagem pública. O estado real agora é descrito como
  `continuação após resposta humana sem texto público`, com headlines `Continuação vazia`/`Retomada automática` e
  atividades `Continuação sem resposta pública`/`Retomando resposta final sem texto público`.
- [x] A linha viva passou a reconhecer os novos textos e preserva os textos antigos apenas como compatibilidade de
  histórico/arquivo, evitando manter o pulso ativo quando uma recuperação antiga já terminou e o runtime voltou ao
  prompt.
- [x] `dialog/output.js` trocou o detector interno de `isPostQuestionContinuationActivity()` para
  `isAfterUserInputContinuationActivity()`, mantendo compat com sinais legados, mas alinhando o código ao contrato mental
  correto: pergunta ao operador, resposta do operador registrada e continuação pública da LLM-B.
- [x] `/events` agora usa `EMPTY_AFTER_USER_INPUT_DEFAULT_DETAIL` compartilhado pelo presenter, eliminando fallback
  textual divergente entre card humano, comandos e auto-recovery.
- [x] Validado com `node --check src/copilot/terminal/events/dialog-recovery-presenter.js
  src/copilot/terminal/wiring/terminal-agent-wiring.js src/copilot/terminal/repl/live-status-line.js
  src/copilot/terminal/commands/events.js src/copilot/terminal/dialog/output.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_dialog_recovery_presenter.spec.js
  tests/unit/copilot/terminal/test_live_status_line.spec.js tests/unit/copilot/terminal/test_commands_events.spec.js
  tests/unit/copilot/test_terminal_agent_wiring.spec.js` (4 arquivos, 79 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_build_user_prompt.spec.js --testTimeout=30000`
  (1 arquivo, 17 testes), confirmando que o rename do detector não quebrou o prompt `LLM-B continuando`.
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000
  --live-scenario=canonical`; PASS em `artifacts/terminal-live/2026-06-09T05-24-03-688Z/summary.md`, incluindo
  `ux-no-legacy-post-answer-labels`, `no-prompt-double-render`, `ux-answer-live-status-stays-single-line` e transcript
  final como `Resposta da LLM-B  LLM-B via SDK`.

### Achados Novos Da Centésima Quadragésima Quarta Passada

- [x] SDK10-P144-01: manter uma varredura contínua para termos técnicos que nasceram como diagnóstico temporário e viram
  contrato visual. A regra operacional passa a ser: termos de protocolo podem ficar em raw/export explícito; stdout,
  linha viva, cards e `/events` default devem falar em estados humanos acionáveis.

### Execução Contínua Em 2026-06-09 - Centésima Quadragésima Quinta Passada

- [x] A revisão do live PASS mostrou que `ux-no-legacy-post-answer-labels` protegia a superfície pública antes dos
  diagnósticos raw, mas não isolava explicitamente a janela depois da resposta humana. Isso era bom o bastante para
  detectar `Resposta pós-pergunta`, porém pouco preciso para a regressão visual da captura.
- [x] O harness `model-gateway-terminal-llm-b-live-test.mjs` agora calcula `postAnswerPublicPlain` a partir do prompt
  `[PERG]› SIM` e adiciona o critério `ux-no-post-answer-turn-processing-copy`, reprovando especificamente o trecho
  pós-resposta se aparecer `pós-pergunta`, `Resposta pós-pergunta` ou `Processando mensagem`.
- [x] A regra mantém SSE raw/arquivo como superfície forense: o bloqueio novo mira apenas o stdout público antes dos
  diagnósticos raw, onde o operador humano realmente percebe a fluidez do turno.
- [x] O live seguinte (`artifacts/terminal-live/2026-06-09T05-27-53-039Z/summary.md`) falhou de forma útil: a LLM-B
  gerou `POST-ASK-CANONICAL-FINAL`, mas continuou no mesmo fluxo com `report_intent ... follow-up` e uma mensagem extra
  sobre `task_complete`/`vscode_askQuestions`. Isso não violava o critério novo de rótulos, mas violava o contrato de
  fechamento do cenário.
- [x] O prompt canônico do harness agora instrui explicitamente: depois do marcador final, parar imediatamente, não
  chamar outra ferramenta e não escrever outra mensagem. O mesmo aperto foi aplicado ao prompt de recuperação de
  `ask_user` ausente.
- [x] O validador passou a incluir `no-extra-output-after-post-ask-final`, procurando em SSE completo qualquer
  `assistant.intent`, `tool.lifecycle` start ou `assistant.message` adicional depois do `assistant.message` que contém o
  marcador final.
- [x] `sse-delta-public-chunk` foi ajustado para avaliar apenas os eventos SSE completos coletados pelo harness. A prévia
  humana de `/events --raw` pode conter apenas `payloadPreview` e não deve ser contada como envelope completo de `delta`.
- [x] Validado com `node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Validado live final com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000
  --live-scenario=canonical`; PASS em `artifacts/terminal-live/2026-06-09T05-31-39-375Z/summary.md`, incluindo
  `sse-delta-public-chunk=19/19`, `no-extra-output-after-post-ask-final` e `ux-no-post-answer-turn-processing-copy`.

### Execução Contínua Em 2026-06-09 - Centésima Quadragésima Sexta Passada

- [x] A varredura de taxonomia de usage encontrou um fallback cru em `agent-runtime-events.js`: quando `llm.usage` sem PR
  tinha divergência de modelo, a linha técnica `Uso do modelo` podia incluir `classe ask_user_continuation` e
  `motivo user_input_completed_continuation`.
- [x] `formatLlmUsageDetail()` agora usa humanização local para `classification` e `premiumRequestReason`, preservando
  o valor técnico no SSE raw e no estado estruturado, mas evitando enums crus no stdout humano.
- [x] Cobertura adicionada para o caminho de divergência de modelo: `ask_user_continuation` vira
  `continuação da pergunta humana` e `user_input_completed_continuation` vira `continuação após resposta humana`.
- [x] O teste de `agent-runtime-events` também foi endurecido para mockar o ponto canônico
  `terminal/dialog/io/index.js`; isso evita que o fixture importe o renderer real e deixe stdout escapar durante unit
  tests.
- [x] Validado com `node --check src/copilot/terminal/events/agent-runtime-events.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js` (1 arquivo, 36 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-09 - Centésima Quadragésima Sétima Passada

- [x] A humanização de usage LLM foi centralizada em `terminal/events/usage-presenter.js`, removendo traduções paralelas
  de `agent-runtime-events.js`, `/usage` e `/events`.
- [x] O contrato ficou explícito: `classification` e `premiumRequestReason` reconhecem apenas enums de usage conhecidos;
  eles não fazem fallback livre. Isso evita que `/events` deixe de aplicar suas traduções próprias para tokens genéricos
  como `session.updated`, `configuration`, `recoverable_model_call` ou `pre_action_empty_output`.
- [x] `/usage now` segue com fallback legível em `renderTerminalLlmUsageKind()`, porque ali a categoria agregada precisa
  degradar para texto humano mesmo quando o runtime trouxer uma classificação nova.
- [x] A bateria de `/events` capturou a regressão antes do commit: o presenter amplo demais transformava
  `recoverable_model_call` em `recoverable model call`, pulando o label humano `erro recuperável do modelo`.
- [x] Validado com `node --check src/copilot/terminal/events/usage-presenter.js
  src/copilot/terminal/events/agent-runtime-events.js src/copilot/terminal/commands/events.js
  src/copilot/terminal/commands/usage.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_agent_runtime_events.spec.js
  tests/unit/copilot/terminal/test_commands_events.spec.js
  tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js` (3 arquivos, 77 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000
  --live-scenario=canonical`; PASS em `artifacts/terminal-live/2026-06-09T05-46-18-161Z/summary.md`, incluindo
  `ux-no-post-answer-turn-processing-copy`, `no-extra-output-after-post-ask-final`, `/events` default com
  `tipo continuação da pergunta humana` e `sse-delta-public-chunk=22/22`.

### Execução Contínua Em 2026-06-09 - Centésima Quadragésima Oitava Passada

- [x] A investigação pós-live mostrou que o terminal já escondia `turno · Processando mensagem` nos prompts e timelines
  principais, mas `dialog/engine.js` ainda era o produtor canônico do label interno `Processando mensagem` ao iniciar
  qualquer turno.
- [x] O início de turno agora registra `Preparando resposta` (`Preparando resposta da LLM-A` no caso LLM-A), removendo o
  jargão antigo da atividade nova sem quebrar renderização de arquivos/estado legados.
- [x] `buildWaitingPrompt()`, a linha viva permanente e `/activity` default tratam tanto `Processando mensagem` legado
  quanto `Preparando resposta` novo como estado genérico de preparação, renderizando `LLM-B pensando`/timeline compacta
  em vez de expor fase técnica.
- [x] O grep ativo de `src/copilot/terminal` não encontra mais emissão de `Processando mensagem`; restaram apenas
  asserts negativos em testes para impedir regressão nas superfícies públicas.
- [x] Validado com `node --check src/copilot/terminal/commands/activity.js src/copilot/terminal/dialog/engine.js
  src/copilot/terminal/dialog/output.js src/copilot/terminal/repl/live-status-line.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_activity_state.spec.js
  tests/unit/copilot/terminal/test_build_user_prompt.spec.js tests/unit/copilot/terminal/test_live_status_line.spec.js
  tests/unit/copilot/terminal/test_commands_activity.spec.js
  tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js` (5 arquivos, 83 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.
- [x] Validado live com `node scripts/model-gateway/run.mjs llmBLiveTest --timeout-ms=300000
  --live-scenario=canonical`; PASS em `artifacts/terminal-live/2026-06-09T05-53-28-219Z/summary.md`, com
  `ux-no-post-answer-turn-processing-copy`, `ux-activity-post-turn-timeline-operational`,
  `no-extra-output-after-post-ask-final`, `sse-delta-public-chunk=24/24` e grep do log público sem
  `Processando mensagem`/`Preparando resposta`.

### Execução Contínua Em 2026-06-09 - Centésima Quadragésima Nona Passada

- [x] A varredura do núcleo `ask_user`/`user_input` encontrou um fluxo paralelo de fallback em
  `sdk/session/user-input.js`: `createReadlineInputHandler()` ainda renderizava `"[ask_user] ..."` e a microcopy
  `"(ou texto livre)"`, diferente do vocabulário canônico do terminal.
- [x] O fallback readline agora usa `Pergunta ao operador`, `Opções` e `Texto livre também aceito`/`Digite sua resposta`,
  mantendo compat com choices numéricas e sem expor o nome cru da tool para operadores.
- [x] A implementação passou a usar explicitamente `resolveEffectiveUserInputAllowFreeform()` ao montar a superfície,
  deixando a política canônica de texto livre visível no código em vez de calculada e descartada.
- [x] Cobertura em `test_hooks_module.spec.js` usa streams em memória para validar que a factory exportada por
  `hooks/index.js` responde uma opção numérica, renderiza microcopy humana e não contém `[ask_user]`.
- [x] Validado com `node --check src/copilot/sdk/session/user-input.js tests/unit/copilot/test_hooks_module.spec.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/test_hooks_module.spec.js
  tests/unit/copilot/test_session_setup.spec.js tests/unit/copilot/test_hook_tools.spec.js
  tests/unit/copilot/terminal/test_pending_question_answer.spec.js` (4 arquivos, 149 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-09 - Centésima Quinquagésima Passada

- [x] A varredura de comandos/projeções encontrou resíduos de protocolo em superfícies de status: `READY vivo`,
  `ask_user humano`, `ask_user ausente`, `shadow persistida de ask_user` e `recovery/direct dispatch`.
- [x] `readTerminalStatusProjection()` agora descreve esses estados como `pronto protocolar`, `pergunta ao operador`,
  `pergunta ausente`, `sombra persistida de pergunta` e `recuperação/envio direto`, mantendo o detalhe operacional sem
  expor nomes internos da tool.
- [x] O fallback diagnóstico de `createTerminalPendingStructuredUserInput()` deixou de usar
  `Pergunta de diagnostico request_user_input` e passou para `Pergunta de diagnostico do operador`.
- [x] `/status full` e `/now` tiveram expectativas atualizadas para `standby sem prontidão viva`, alinhando status,
  terminal e fallback SDK ao mesmo vocabulário humano.
- [x] Validado com `node --check src/copilot/terminal/frontend/gateways/sdk-session.js
  src/copilot/terminal/frontend/projections/status.js tests/unit/copilot/terminal/test_commands_session.spec.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_session.spec.js
  tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js
  tests/unit/copilot/terminal/test_build_user_prompt.spec.js
  tests/unit/copilot/terminal/test_pending_question_answer.spec.js` (5 arquivos, 128 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-09 - Centésima Quinquagésima Primeira Passada

- [x] O renderer compartilhado de pergunta humana deixou de mapear sources técnicas literalmente: `runtime` agora aparece
  como `conversa`, `tool` como `ferramenta` e `headless` como `sem interface`.
- [x] A cobertura de `test_human_question_renderer.spec.js` passou a validar sources técnicas humanizadas, evitando que
  cards de pergunta/replay voltem a exibir `runtime`/`headless` na superfície pública.
- [x] A bateria do registry revelou uma fragilidade de teste importante: `test_terminal_sdk_session_events_registry` mockava
  `terminal/dialog/index.js`, mas a implementação real importa `terminal/dialog/io/index.js`; com isso, stdout real vazava
  durante o teste e os mocks de `println`/`broadcastSse` ficavam vazios.
- [x] O teste do registry agora mocka o ponto canônico `terminal/dialog/io/index.js`, cobrindo `println`, `broadcastSse`,
  `writeInlineStatus`, `clearInlineStatus` e `parkTerminalPromptForContinuation`. Isso elimina um fluxo paralelo nos
  fixtures e protege melhor regressões de UX em lifecycle de tool/pergunta.
- [x] Validado com `node --check src/copilot/terminal/events/human-question-renderer.js
  tests/unit/copilot/terminal/test_human_question_renderer.spec.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js` (1 arquivo,
  8 testes).
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_human_question_renderer.spec.js
  tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js
  tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js` (3 arquivos, 40 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

### Execução Contínua Em 2026-06-09 - Centésima Quinquagésima Segunda Passada

- [x] A revisão do live encontrou um resíduo técnico em `/events` default: o evento `terminal.runtime.wired` aparecia como
  `fase runtime config · preflight ok`, mesmo na superfície humana do arquivo SSE.
- [x] `humanPayloadKind()` agora traduz `runtime-config`/`runtime_config`/`runtime config` para
  `configuração do ambiente`, e `summarizeTerminalRuntimePayload()` troca `preflight ok/falhou` por
  `checagem ok/falhou`.
- [x] O raw continua preservado nas superfícies forenses; a mudança afeta o preview humano/default e o preview raw leve
  que já era intencionalmente resumido.
- [x] Cobertura de `/events --raw` foi atualizada para exigir `fase configuração do ambiente · checagem ok` e rejeitar
  `runtime config`/`preflight` no `payloadPreview` resumido.
- [x] Validado com `node --check src/copilot/terminal/commands/events.js
  tests/unit/copilot/terminal/test_commands_events.spec.js`.
- [x] Validado com `npx vitest run tests/unit/copilot/terminal/test_commands_events.spec.js` (1 arquivo, 31 testes).
- [x] Validado com `npm run lint:copilot`.
- [x] Validado com `npm run typecheck:strict:src.copilot`.

---

## Decisões Arquiteturais

- [x] A fronteira vendor é `src/copilot/sdk` e portas locais; consumidores não devem importar diretamente de
  `@github/copilot-sdk` fora dessa camada, salvo testes/mocks específicos.
- [x] Aliases antigos podem sobreviver apenas para ergonomia local e compat de rota.
- [x] Payloads enviados ao SDK não podem conter campos mortos quando houver campo oficial 1.0 equivalente.
- [x] `mode: "copilot-cli"` permanece default para o terminal local LLM-B enquanto queremos máxima capacidade ambientada.
- [x] `mode: "empty"` deve ser opção explícita para rotas server/multiuser e fluxos isolados.
- [x] Opt-ins experimentais de MCP Apps/canvas/extensions não entram por default sem renderer e plano de UX.
- [x] BYOK e GitHub-auth não devem ser misturados implicitamente: token GitHub por sessão serve identidade/quota Copilot;
  provider BYOK serve cobrança e quota do provider.
- [x] Tests antigos que validavam campos 0.3 são dívida, não verdade.

---

## Notas Para Commits

- [ ] Não stagear `.codex/config.toml`; está modificado localmente e fora do escopo.
- [ ] `package.json` e `package-lock.json` foram alterados pelo operador para SDK 1.0 e dependências correlatas; revisar
  antes de stagear.
- [ ] Commits devem separar, se possível, documentação/auditoria de patches estruturais.
- [ ] Depois de commit/push, continuar a investigação e implementação, sem tratar o commit como conclusão.
