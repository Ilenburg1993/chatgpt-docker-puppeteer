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
- [ ] BUG-SDK10-A15: `INFINITE_SESSION_DEFAULTS` contém chave duplicada.
- [x] BUG-SDK10-A16: testes validam a API antiga e podem mascarar regressões reais.
- [x] BUG-SDK10-A17: rotas SDK ainda aceitam/documentam `configDir` e `disableResume` sem contrato oficial paralelo.
- [ ] BUG-SDK10-A18: BYOK com provider custom exige `model`, mas a camada local ainda permite caminhos ambíguos.
- [ ] BUG-SDK10-A19: `mode: "empty"` não está modelado como decisão explícita para server/multiuser.
- [ ] BUG-SDK10-A20: `Tool.handler` opcional não está representado na factory local sem separar tool executável de
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
- [ ] BYOK/model-gateway deve alimentar `onListModels`, `provider`, `model`, `reasoningSummary`, `contextTier` e
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
- [ ] B.8 Adicionar `openCanvases()` ao builder de resume.
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
- [ ] C.7 Garantir que `session.log()` seja usado só quando exposto, com erro claro em runtimes antigos.
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
- [ ] E.3 Criar categoria fallback para eventos de conteúdo multimodal (`text`, `image`, `audio`, `blob`, `resource`,
  `resource_link`, `file`, `directory`, `selection`, `object`, `function`, `terminal`, `github_reference`).
- [ ] E.4 Adicionar normalizers para `model.call_failure`.
- [ ] E.5 Adicionar normalizers para `session.permissions_changed`.
- [ ] E.6 Adicionar normalizers para `session.canvas.opened` e `session.canvas.registry_changed`.
- [ ] E.7 Adicionar normalizers para `hook.progress`.
- [ ] E.8 Garantir que terminal não apresente eventos novos como ids crus sem rótulo humano.

### Faixa F - Hooks 1.0

- [x] F.1 Atualizar typedefs locais para `sessionId`, `timestamp: Date`, `workingDirectory`.
- [ ] F.2 Criar normalizador local que aceita `cwd/timestamp:number` e produz contrato 1.0 quando necessário.
- [x] F.3 Adicionar `onPreMcpToolCall` à factory.
- [x] F.4 Adicionar `onPostToolUseFailure` à factory.
- [ ] F.5 Atualizar docs e testes que assumem `onPostToolUse` para falhas.
- [ ] F.6 Propagar trace context em logs de tool quando `traceparent/tracestate` existirem.
- [ ] F.7 Atualizar `HookRegistry` para refletir campos novos.

### Faixa G - Tools 1.0

- [ ] G.1 Separar `createTool()` executável de `createDeclarationTool()`.
- [ ] G.2 Permitir `handler` opcional apenas em API explicitamente declaration-only.
- [ ] G.3 Integrar `convertMcpCallToolResult` onde houver ponte MCP.
- [ ] G.4 Atualizar `ToolBinaryResult.type` para `"image" | "resource"` quando aplicável.
- [ ] G.5 Registrar `toolTelemetry` com shape 1.0.
- [ ] G.6 Introduzir helpers `ToolSet`/`BuiltInTools` via barrel local sem vazar vendor.

### Faixa H - BYOK, Model Gateway And Quotas

- [ ] H.1 Garantir que provider custom sempre acompanhe `model` concreto.
- [ ] H.2 Documentar que BYOK não usa quota GitHub Copilot, mas provider externo pode falhar por quota/rate limit.
- [ ] H.3 Separar falha `model.call_failure` por quota/account/rate/model unsupported/network.
- [ ] H.4 Preservar per-session `gitHubToken` para model routing e quota GitHub quando não-BYOK.
- [ ] H.5 Usar `onListModels` do model-gateway sem conflitar com `client.listModels()` nativo.
- [ ] H.6 Expor `reasoningSummary` e `contextTier` no seletor de modelo quando metadados suportarem.
- [ ] H.7 Manter Ollama/local suportado, mas fora dos defaults de seleção automática salvo pedido explícito.

### Faixa I - Server Routes And Public Contracts

- [x] I.1 Atualizar schemas de `/sdk/session` para `configDirectory` e alias `configDir`.
- [x] I.2 Atualizar schemas de resume para `suppressResumeEvent` e alias `disableResume`.
- [ ] I.3 Atualizar README de rotas SDK.
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
- [ ] K.8 Garantir timestamps ISO 8601 completos no renderer final de eventos do terminal.
- [ ] K.4 Garantir linha viva separada do input.
- [ ] K.5 Reduzir repetição de `request_user_input` pendente.
- [ ] K.6 Apresentar troca automática de modelo com motivo, modelo anterior, modelo novo e confiança.
- [ ] K.7 Fazer lives LLM-B depois da migração SDK estar estável.

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
