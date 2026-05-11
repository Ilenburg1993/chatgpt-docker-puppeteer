## Lote F2-T4.5 — `tools/infra` + barrel purity total em `tools/**/index.js`

- Renomeação física completa de `src/copilot/tools/_infra/` para `src/copilot/tools/infra/`.
- Reescrita completa dos imports consumidores para `tools/infra/*`.
- Conversão de `file/index.js`, `todo/index.js`, `git/index.js` e `shell/index.js` em barrels puros.
- Extração da lógica concreta para:
   - `src/copilot/tools/file/file-tools.js`
   - `src/copilot/tools/todo/todo-tools.js`
   - `src/copilot/tools/git/git-tools.js`
   - `src/copilot/tools/shell/shell-tools.js`
- Atualização do lint F25 para cobrir `src/copilot/tools/**/index.js` como regra geral.

# Execução Incremental — Rebuild `src/copilot/tools/`

> **Data base**: 2026-05-10
> **Objetivo**: rastrear execução real do roadmap canônico em lotes pequenos, verificáveis e reversíveis.

---

## Status geral

- Fase 0 (hardening imediato): **em andamento avançado**
- Fase 1 (unificação observabilidade/factory): **iniciada e com entregas parciais concluídas**
- Fase 2+ (estado por sessão, boundaries fortes, refactor domínio): **planejado**

---

## Lotes executados

### Lote P0/P1-1 (concluído)

- `session-rpc-tools`: timeout tratado como advisory real para telemetria/log.
- `hook-tools` + `user-input-state` + `tool-port`: hardening de ciclo de vida de `request_user_input`.
- `shell/sandbox`: cache de `safeEnv` migrado para estado privado de módulo.
- `sdk/tools/registry`: warning em sobrescrita de tool registrada.
- `file/read-tools-io`: prefetch condicionado para reduzir I/O desnecessário.
- `sdk/tools/state`: reset explícito para testes.

### Lote P1-2 (concluído)

- `tools/tool-factory`: remoção de wrapping redundante de handler (redução de double-logging).
- `tools/tool-factory`: fallback recoverable normaliza parâmetros antes de `plain tool`.
- `tools/web-tools`: captura específica de JSON inválido na DDG API.
- `sdk/tools/state`: clones defensivos no load/patch para evitar aliasing de arrays.
- `eslint.config.mjs`: regra progressiva (`warn`) de boundary para `tools/` não depender direto de `infra/db`.

### Lote P1-3 (concluído)

- Migração de `createTool` direto → `buildTool` em toda a árvore `src/copilot/tools/**` (session, session-rpc,
   experimental-rpc, introspection, shell, git, task, todo/*).
- Consolidação de **fábrica canônica única**: no domínio `tools/`, apenas `tool-factory.js` centraliza a criação
   efetiva e integração com SDK (`createTool` do SDK deixa de ser dependência direta dos módulos de tool).
- Remoção de fluxo paralelo de criação de tools no domínio: manutenção futura passa a ter ponto único de evolução
   (observabilidade, normalização de parâmetros, semântica de permissionamento).
- Ajuste de tipagem em parâmetros Zod nos módulos `todo/*` convertidos para `buildTool`, eliminando casts legados
   incompatíveis com a assinatura canônica da factory.
- Endurecimento do caminho de custom tools em `src/copilot/sdk/tools/custom.js`: remoção de fallback
   `_buildTool ?? createToolSync`, com falha explícita quando o builder canônico não foi injetado.

### Lote P1-4 (concluído)

- Leitura integral de `src/copilot/sdk/tools/*` (`core`, `registry`, `state`, `agent-policy`, `custom`) para
   validar o encaixe arquitetural do `buildTool` no fluxo SDK→tools→bootstrap.
- `src/copilot/sdk/tools/core.js` promovido a **fonte canônica única** de normalização de parâmetros de tool,
   com export de `normalizeToolParametersSchema()`.
- `src/copilot/sdk/tools/core.js`: hardening da detecção de Zod/Zod-like para reduzir falso-positivos em objetos
   literais com campos `_def`/`_zod` arbitrários.
- `src/copilot/sdk/tools/core.js`: suporte preferencial a `toJSONSchema()` quando disponível, reduzindo dependência
   implícita de caminhos paralelos de conversão.
- `src/copilot/tools/tool-factory.js` simplificado para **delegar ao SDK** a adaptação de schema, removendo lógica
   local duplicada de `zod-to-json-schema`/`tryZodV4ToJsonSchema`/validação de schema útil.
- `src/copilot/tools/tool-factory.js`: validação explícita de contrato via `validateToolDefinitionContract()` antes
   de devolver a tool ao chamador, falhando cedo em definições inválidas.
- `src/copilot/sdk/index.js` e `src/copilot/sdk/tools/custom.js` alinhados ao novo contrato canônico de parâmetros,
   reduzindo deriva de typedefs entre SDK e domínio `tools/`.

---

## Backlog imediato (próximos lotes)

1. Reforçar compliance da fábrica única com guarda arquitetural no lint (regra para bloquear import de
   `createTool` do SDK em `src/copilot/tools/**`, exceto `tool-factory.js`).
2. Introduzir contratos formais em código para:
   - `ToolDefinitionContract`
   - `ToolExecutionTelemetryContract`
   - `ToolPermissionDecisionContract`
   - `UserInputBridgeContract`
3. Criar `ToolSessionContext` para reduzir estado module-level compartilhado.
4. Iniciar adapter de migração do fluxo de input estruturado para o caminho canônico do SDK.
5. Evoluir regra de boundary de `warn` → `error` por submódulo quando cobertura estiver pronta.

---

## Princípios mantidos durante execução

- **LLM-B first**: sem bloqueio por timeout temporal como padrão.
- **Timeouts advisory**: usados para diagnóstico e observabilidade.
- **Mudanças pequenas e reversíveis**: cada lote deve ser audível e de baixo risco.
- **Documento externo ≠ SSOT**: toda correção nasce de validação no código real.


### Lote P1-5 (concluído)

- Eliminação do estado paralelo de introspecção em `src/copilot/tools/introspection-tools.js`: a fonte única de verdade para tools/categorias/metadados passa a ser o `ToolRegistry` canônico.
- Remoção das estruturas legadas `_registeredTools`, `_CATEGORY_TOOL_MAP_DYNAMIC` e `_toolNameToMetadataMap`, eliminando risco de drift entre introspecção e registry.
- `registerForIntrospection()` simplificado para aceitar apenas o `registry` canônico; `src/copilot/tools/bootstrap.js` atualizado para o novo contrato.
- `list_tools`, `get_agent_info`, `toggle_tool` e `readIntrospectionRegistrySnapshot()` migrados para derivar dados sob demanda direto do registry, sem snapshot duplicado de tools.


### Lote P1-6 (concluído)

- Remoção da camada compat fantasma `src/copilot/hooks/permission-handler.js`, que apenas delegava ao núcleo canônico de permissões do SDK.
- Presets de hooks migrados para importar `createPermissionHandler` diretamente de `#copilot/sdk`, eliminando um caminho interno paralelo de resolução de policy.
- `src/copilot/hooks/index.js` passou a expor os helpers públicos de permissão diretamente sobre o núcleo canônico do SDK, preservando a superfície de API sem manter um arquivo intermediário dedicado.
- `src/copilot/hooks/presets/profiles.js` simplificado para usar `approveAll`/`createPermissionHandler()` diretamente, sem wrappers transitivos.


### Lote P1-7 (concluído)

- Introduzida regra arquitetural **F24** no `eslint.config.mjs`: fora de `src/copilot/hooks/**`, imports para `#copilot/hooks` e caminhos relativos `hooks/**` passam a ser sinalizados (modo `warn`) para enforcement progressivo da decisão “hooks é camada final”.
- Validação direcionada do lint confirmou 10 violações ativas mapeadas em `bootstrap`, `observability/bootstrap`, `server/routes/*` e `agent/ports/hook-port`.
- `src/copilot/sdk/config.js` e `src/copilot/sdk/session/lifecycle.js` migrados para fonte canônica de `approveAll` via `sdk/session/permissions.js` (eliminação de import direto redundante do pacote externo).


### Lote P1-8 (concluído)

- `PermissionController` promovido para `src/copilot/sdk/session/permission-controller.js` como núcleo canônico de policy operacional de permissões.
- `src/copilot/agent/ports/permission-port.js` religado para consumir `PermissionController` via `#copilot/sdk`, reduzindo acoplamento direto `agent → hooks`.
- `src/copilot/hooks/permission-controller.js` convertido em compat layer mínima (re-export), preservando compatibilidade sem manter implementação paralela.
- `src/copilot/audit/pipeline-permission.js` endurecido para fallback **fail-closed** (`reject`) quando `baseHandler` está ausente ou lança erro (substituindo approve-all implícito).
- `src/copilot/sdk/session/permissions.js` evoluído com `defaultDecision: 'allow' | 'deny'` para suportar perfis deny-by-default sem callbacks ad hoc.


### Lote P1-9 (concluído)

- Migração arquitetural de superfícies de hooks consumidas por camadas não-hooks para módulos canônicos neutros:
   - `src/copilot/sdk/session/hook-bus.js`
   - `src/copilot/sdk/session/hook-registry.js`
   - `src/copilot/sdk/session/hook-logger.js`
   - `src/copilot/audit/hook-audit-trail.js`
- Módulos legados de `hooks/*` (`bus`, `registry`, `logger`, `audit-trail`, `di-tokens`) convertidos em compat layers/re-exports para evitar drift e manter compatibilidade.
- Consumidores fora de hooks migrados para superfícies canônicas (`#copilot/sdk` / `#copilot/audit`):
   - `bootstrap.js`
   - `observability/bootstrap.js`
   - `server/routes/sdk/deps.js`
   - `server/routes/copilot-api/control.js`
   - `agent/ports/hook-port.js`
- `agent/ports/hook-port.js` removido de dependências diretas de `hooks/*` com implementação local de lifecycle + composição preTool baseada em tipos/fluxos SDK.
- Remoção de resíduos de tipagem `import('#copilot/hooks...')` fora da camada hooks (`agent-context`, `audit/pipeline-sdk-buffer`, observability collectors).
- Regra arquitetural F24 em `eslint.config.mjs` endurecida de `warn` para `error` após zerar violações runtime.


### Lote P1-10 (concluído) — Consolidação do sistema de permissões

- `src/copilot/sdk/session/permission-runtime.js` criado com primitivos canônicos compartilhados:
   `normalizePermissionMode`, `sanitizeToolNames`, `extractPermissionToolName`, `PERMISSION_MODES`,
   `DEFAULT_PERMISSION_MODE`, `TOOL_NAME_RE`.
- SDK barrel atualizado com re-exports de `permission-runtime.js` (incluindo `sanitizePermissionToolNames`).
- `permissions.js` usa `extractPermissionToolName` do runtime helper (elimina duplicação inline).
- `permission-controller.js` refatorado para usar primitivos canônicos; adicionado `getPolicySnapshot()` + campo
   `#snapshot` atualizado nos 3 modos (`approve_all`, `audit_only`, `selective`).
- `permission-policy.js` criado — helper `createToolPermissionPolicy()` para eliminar drift entre `onPreToolUse`
   e `onPermissionRequest` nos presets.
- Presets `safe.js`, `interactive.js`, `deny-all.js` e `production.js` refatorados para usar
   `createToolPermissionPolicy` (consistência garantida entre hooks).
- `control.js` (HTTP): substituída implementação inline de `sanitizeToolNames` por `sanitizePermissionToolNames` do SDK.
- `GET /permissions` enriquecido com `policy` (snapshot detalhado de allowTools/denyTools/denyShell/defaultDecision).
- `agent-context.js`: adicionado `getPermissionPolicySnapshot()` delegando para `PermissionController.getPolicySnapshot()`.
- `governance-readers.js`: adicionado `readRuntimePermissionPolicySnapshot()` + typedef `AgentRuntimeGovernanceTarget`
   atualizado.
- `always-alive.js`: expõe `getPermissionPolicySnapshot()` publicamente.
- `permission-port.js`: adicionado typedef `PermissionPolicySnapshot` e campo opcional `getPolicySnapshot` ao
   `AgentPermissionController`.
- Default LLM-B = `approve_all` garantido em 4 camadas: `PermissionController`, `buildAlwaysAliveConfig`,
   `SessionConfigBuilder`, `getProjectDefaults`.


### Lote P2-1 (concluído) — ToolSessionContext: encapsulamento de estado por sessão

- `src/copilot/sdk/session/tool-session-context.js` criado — classe `ToolSessionContext` canônica que encapsula:
   - Resolvers de input estruturado pendentes (`request_user_input`): sem mais singletons module-level globais.
   - Contador sequencial de IDs de request por instância de sessão.
   - Callback de broadcast SSE (anti-import-circular).
   - Método `snapshot()` para observabilidade sem expor internals.
- `createToolSessionContext(opts?)` factory exportada.
- SDK barrel atualizado com `ToolSessionContext` e `createToolSessionContext`.
- `agent-context.js`: campo `toolSessionContext = createToolSessionContext()` adicionado; inicializado inline para
   satisfazer `strictPropertyInitialization`.
- `always-alive.js`: expõe `getToolSessionContext()` publicamente.
- `hook-tools.js` integrado com suporte progressivo a `ToolSessionContext`:
   - `configureHookTools({ broadcastSse?, toolSessionContext? })` agora aceita o context opcional.
   - Helpers internos `_getPendingInputCount`, `_getPendingInputIds`, `_nextInputId`, `_registerPendingInput`,
      `_deletePendingInput`, `_broadcast` delegam ao context quando disponível, com fallback para singletons globais.
   - Funções exportadas `resolveUserInput`, `getPendingInputIds`, `hasPendingUserInputRequests`,
      `cancelAllUserInputRequests` atualizadas para preferir o `ToolSessionContext` injetado.
   - **Backward-compat total**: sem `ToolSessionContext` injetado, comportamento idêntico ao anterior.


### Lote P2-2 (concluído) — Eliminação dos singletons globais de user-input

- `src/copilot/sdk/session/user-input.js` migrado: singletons globais `_pendingStructuredUserInputResolvers` e
  `_pendingStructuredUserInputSeq` **eliminados**; substituídos por um `ToolSessionContext` default (`_defaultCtx`).
- Nova função exportada: `configureDefaultUserInputContext(ctx)` — permite que o bootstrap injete o mesmo
  `ToolSessionContext` do agente principal, tornando o estado de user-input unificado por sessão.
- SDK barrel atualizado: `configureDefaultUserInputContext` adicionado às re-exports de `user-input.js`.
- `runtime-wiring.js` atualizado: `wireCopilotRuntimeDI` agora:
  - Obtém `toolSessionContext = alwaysAliveAgent.getToolSessionContext()` (Proxy lazy — sem side-effects antecipados).
  - Chama `configureHookTools({ broadcastSse, toolSessionContext })` — `hook-tools.js` passa a usar o mesmo context.
  - Chama `configureDefaultUserInputContext(toolSessionContext)` — `user-input.js` passa a usar o mesmo context.
- **Resultado**: todos os subsistemas (`hook-tools.js`, `user-input.js`, terminal consumers via SDK) passam a
  compartilhar um único `ToolSessionContext` por sessão — eliminando o risco de divergência de estado entre singletons
  paralelos.
- Teardown correto: `cancelAllUserInputRequests()` via `tool-port.js` → `_toolSessionContext.cancelAllPendingInput()`
  cancela todos os pending inputs do context unificado no encerramento da sessão.


### Lote F2-T1/T2 (concluído) — Barrel purity + boundary hardening inicial

- `src/copilot/tools/index.js` convertido para **barrel-only** (sem cache local, sem `getAllTools` com lógica interna,
   sem proxy montado no barrel).
- Ownership de composição/enumeração flat de tools movido para o owner canônico `src/copilot/tools/bootstrap.js`:
   - `getAllStaticTools()`
   - `getAllTools()` (compat)
   - `allTools` (proxy compat)
- `src/copilot/runtime-wiring.js` ajustado para consumir setters via `#copilot/tools`
   (remoção de bypass direto para `./tools/hub-tools.js` e `./tools/permission-tools.js`).
- Lint direcionado pós-refactor executado sem erros nos arquivos críticos (`tools/bootstrap`, `tools/index`,
   `runtime-wiring`, `sdk/session/user-input`, `server/routes/sdk/deps`).


### Lote F2-T4.1 (concluído) — Subdomínios físicos com barrels de compatibilidade

- Criação de `src/copilot/tools/session/index.js` (barrel-only) para concentrar exports do domínio de sessão:
   `sessionTools`, `sessionRpcTools`, `experimentalRpcTools` e setters associados.
- Criação de `src/copilot/tools/introspection/index.js` (barrel-only) para concentrar exports de introspecção e
   contratos (`verifyToolRegistryContracts`, `createEmptyToolContractReport`).
- `tools/bootstrap.js` migrado para consumir os novos barrels `./session/index.js` e `./introspection/index.js`.
- `tools/index.js` (barrel canônico) migrado para re-exportar sessão/introspecção via subdomínios, reduzindo acoplamento
   com arquivos flat de implementação.
- Validação de lint pós-migração concluída sem erros.


### Lote F2-T5.1 (concluído) — Guardrail de barrel-only em `tools/**/index.js`

- `eslint.config.mjs` atualizado com regra arquitetural **F25** para `src/copilot/tools/**/index.js`:
   - proíbe `ImportDeclaration` em `index.js` de tools;
   - proíbe `ExportNamedDeclaration` com `declaration` local (ex.: `export const`, `export function`).
- Efeito prático: `index.js` em `tools/**` fica restrito a re-exports (`export { ... } from ...`, `export * from ...`).
- Lint direcionado executado sem erros em `tools/index.js`, `tools/session/index.js`, `tools/introspection/index.js`.


### Lote F2-T4.2 (concluído) — Migração física completa de `session/` e `introspection/`

- Migração física (move real) dos módulos flat legados para subdomínios:
   - `tools/session-tools.js` → `tools/session/session-tools.js`
   - `tools/session-rpc-tools.js` → `tools/session/session-rpc-tools.js`
   - `tools/experimental-rpc-tools.js` → `tools/session/experimental-rpc-tools.js`
   - `tools/introspection-tools.js` → `tools/introspection/introspection-tools.js`
   - `tools/tool-contract-verifier.js` → `tools/introspection/tool-contract-verifier.js`
- Atualização completa de imports consumidores (bootstrap, barrels, terminal commands/projections, typings internos).
- `tools/introspection/index.js` ampliado para expor snapshots/reset/report helpers consumidos pelo terminal.
- Remoção explícita dos arquivos legados na raiz de `tools/` (sem wrappers de compatibilidade “fantasmas”).
- Validação final:
   - `file_search` confirma inexistência dos caminhos antigos.
   - `eslint` direcionado sem erros nos arquivos migrados/consumidores.


### Lote F2-T4.3 (concluído) — Migração física completa de `tools/_infra`

- Migração física (move real) dos módulos de infraestrutura compartilhada de `tools/` para subdomínio `_infra/`:
   - `tools/logger.js` → `tools/_infra/logger.js`
   - `tools/metrics-proxy.js` → `tools/_infra/metrics-proxy.js`
   - `tools/di-tokens.js` → `tools/_infra/di-tokens.js`
- Rewire completo de imports consumidores em:
   - `tools/*` (módulos raiz, `session/`, `introspection/`, `file/`, `todo/`, `git/`, `shell/`)
   - `observability/bootstrap.js`
   - `tools/index.js` (barrel)
- Remoção explícita dos arquivos legados na raiz de `tools/` (sem wrappers/compat fantasma).
- Correção de path de typedef em `_infra/metrics-proxy.js` após move.


### Lote F2-T5.2 (concluído) — Ajuste de escopo da regra F25 (barrel-only)

- Regra F25 em `eslint.config.mjs` restringida aos barrels canônicos reais:
   - `src/copilot/tools/index.js`
   - `src/copilot/tools/session/index.js`
   - `src/copilot/tools/introspection/index.js`
- Motivo: evitar falso positivo em `index.js` que são módulos de implementação (ex.: `tools/git/index.js`,
   `tools/shell/index.js`) e não barrels puros.
- Lint final da migração `_infra` executado sem erros.


### Lote F2-T4.4 (concluído) — Migração física completa de `tool-factory` para `_infra`

- Migração física (move real):
   - `tools/tool-factory.js` → `tools/_infra/tool-factory.js`
- Rewire completo dos consumidores em domínios `tools/*`:
   - raiz (`code-tools`, `hub-tools`, `task-tools`, `web-tools`, `permission-tools`, `hook-tools`)
   - subdomínios (`session/`, `introspection/`, `file/`, `todo/`, `shell/`, `git/`)
   - barrel canônico `tools/index.js`
- Ajustes internos pós-move:
   - imports relativos de `core/tool-contracts` e `logger` no novo módulo `_infra/tool-factory.js`
   - atualização de referências documentais em `sdk/tools/core.js` para o novo path canônico.
- Remoção explícita do arquivo legado na raiz (`tools/tool-factory.js`) — sem compat layer fantasma.
- Validação final:
   - `file_search` confirma inexistência dos arquivos legados (`logger.js`, `metrics-proxy.js`, `di-tokens.js`, `tool-factory.js`) na raiz de `tools/`.
   - `grep` sem matches para paths antigos.
   - `eslint` direcionado sem erros.
