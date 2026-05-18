# Auditoria Ampla — `SessionConfig`, `ResumeSessionConfig` e Subagentes (`@github/copilot-sdk` 0.3.0)

> Arquivo-fonte inicial desta auditoria: `node_modules/@github/copilot-sdk/dist/types.d.ts`
>
> Recorte auditado prioritário: linhas `798–1149`
>
> Fontes adicionais confrontadas:
>
> - `node_modules/@github/copilot-sdk/dist/client.d.ts`
> - `https://raw.githubusercontent.com/github/copilot-sdk/main/nodejs/README.md`
> - `https://raw.githubusercontent.com/github/copilot-sdk/main/docs/features/custom-agents.md`
> - `https://raw.githubusercontent.com/github/copilot-sdk/main/docs/features/session-persistence.md`
> - `https://raw.githubusercontent.com/github/copilot-sdk/main/docs/features/skills.md`
> - `src/copilot/config/**`
> - `src/copilot/sdk/session/**`
> - `src/copilot/sdk/agent/**`
> - `src/copilot/server/routes/sdk/**`
> - `src/copilot/agent/session/**`
>
> Documento complementar desta trilha:
>
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/COPILOTCLIENT-AUDITORIA-AMPLA-2026-05-18.md`

---

## 1. Objetivo

Esta auditoria verifica três superfícies intimamente relacionadas do SDK instalado:

1. `SessionConfig`
2. `ResumeSessionConfig`
3. `CustomAgentConfig` e sua manifestação runtime via `subagent.*`

Nota semântica importante desta auditoria:

- `custom agent` = definição declarativa anexada à sessão em `SessionConfig.customAgents`;
- `sub-agent` = manifestação runtime de um custom agent quando o SDK o seleciona/invoca e emite eventos `subagent.*`.

O critério aqui não é “há algo vagamente parecido no runtime”.

O critério usado foi:

1. o contrato existe no SDK instalado;
2. a implementação local cobre o contrato na trilha canônica;
3. builders, fábricas, validação e rotas não introduzem drift desnecessário;
4. toda lacuna é classificada como **full / partial / missing / not-applicable**;
5. tudo o que for corrigível nesta rodada deve sair já implementado.

---

## 2. Fonte de verdade adotada

A fonte de verdade para esta rodada foi, em ordem:

1. `node_modules/@github/copilot-sdk/dist/types.d.ts`
2. documentação oficial do SDK 0.3.0
3. código local do repositório

Isso foi especialmente importante porque a documentação narrativa e a implementação local nem sempre estavam perfeitamente sincronizadas em temas como:

- optionalidade de `CustomAgentConfig.description`
- semântica de `tools: []`
- preload de `skills` por subagente
- separação entre `SessionConfig` e `ResumeSessionConfig`

---

## 3. Veredito executivo

### Antes desta rodada

A situação era:

- `SessionConfig`: **majoritariamente full**, mas com gaps de superfície serializável no adapter HTTP
- `ResumeSessionConfig`: **parcial**, sem módulo dedicado e com builder local estruturalmente frouxo
- subagentes: **parciais**, com drift real em schema/validação/factory sobre `description?`, `skills` e `mcpServers`

### Após esta rodada

A situação ficou:

- `SessionConfig`: **full na camada programática** e **full na superfície HTTP serializável**
- `ResumeSessionConfig`: **full**, agora com módulo dedicado e sanitização explícita
- `CustomAgentConfig` / subagentes: **full na camada de contrato/config/factory** e **endurecido na governança de skills**, mantendo backlog apenas para UX/produto mais rico, não para ausência de contrato

---

## 4. Matriz de paridade — `SessionConfig`

### 4.1. Camada programática local (`config/` + `sdk/session/`)

| Campo                            | Estado antes              | Estado após | Veredito | Owner principal                                         |
| -------------------------------- | ------------------------- | ----------- | -------- | ------------------------------------------------------- |
| `sessionId`                      | builder fluente existente | mantido     | **full** | `src/copilot/config/session-config.js`                  |
| `clientName`                     | existente                 | mantido     | **full** | `session-config.js`                                     |
| `model`                          | existente                 | mantido     | **full** | `session-config.js`, `sdk/session/lifecycle.js`         |
| `reasoningEffort`                | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `modelCapabilities`              | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `configDir`                      | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `enableConfigDiscovery`          | existente                 | mantido     | **full** | `session-config.js`, `initializer.js`, `lifecycle.js`   |
| `tools`                          | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `commands`                       | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `systemMessage`                  | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `availableTools`                 | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `excludedTools`                  | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `provider`                       | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `onPermissionRequest`            | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `onUserInputRequest`             | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `onElicitationRequest`           | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `hooks`                          | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `workingDirectory`               | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `streaming`                      | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `includeSubAgentStreamingEvents` | existente                 | mantido     | **full** | `session-config.js`, `initializer.js`, `lifecycle.js`   |
| `mcpServers`                     | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `customAgents`                   | existente                 | mantido     | **full** | `session-config.js`, `custom-agents.js`, `lifecycle.js` |
| `defaultAgent`                   | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `agent`                          | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `skillDirectories`               | existente                 | mantido     | **full** | `session-config.js`, `initializer.js`, `lifecycle.js`   |
| `disabledSkills`                 | existente                 | mantido     | **full** | `session-config.js`, `initializer.js`, `lifecycle.js`   |
| `infiniteSessions`               | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `gitHubToken`                    | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `onEvent`                        | existente                 | mantido     | **full** | `session-config.js`, `lifecycle.js`                     |
| `createSessionFsHandler`         | existente                 | mantido     | **full** | `session-config.js`, `initializer.js`, `lifecycle.js`   |

### 4.2. Surface HTTP serializável (`server/routes/sdk`)

Nem todos os campos de `SessionConfig` podem cruzar HTTP em JSON: callbacks e handlers são process-local por natureza.

#### Não-aplicáveis via HTTP JSON por desenho

- `tools[].handler`
- `commands[].handler`
- `onPermissionRequest`
- `onUserInputRequest`
- `onElicitationRequest`
- `hooks`
- `onEvent`
- `createSessionFsHandler`

Esses permanecem **full no runtime programático** e **not-applicable no adapter HTTP**.

#### Campos seriais auditados na rota

Antes desta rodada, a rota de sessão não repassava todos os campos seriais que o SDK permite. Faltavam:

- `modelCapabilities`
- `enableConfigDiscovery`
- `includeSubAgentStreamingEvents`
- `defaultAgent`
- `gitHubToken`

**Correção aplicada:**

- `src/copilot/server/routes/sdk/session-schemas.js`
- `src/copilot/server/routes/sdk/session-crud.js`
- `src/copilot/server/routes/sdk/README.md`

**Veredito final:** superfície HTTP serializável de `SessionConfig` agora está **full**.

---

## 5. Matriz de paridade — `ResumeSessionConfig`

### 5.1. Achado principal

O SDK define `ResumeSessionConfig` como:

- subconjunto explícito de `SessionConfig`
- mais `disableResume?: boolean`

Antes desta rodada, o repositório **não tinha módulo dedicado** para essa interface.

Havia apenas:

- `SessionConfigBuilder.buildForResume()`

E esse método fazia um cast frouxo do `build()` completo para `ResumeSessionConfig`.

### 5.2. Problemas confirmados

#### RSCFG-001 — ausência de módulo dedicado

Não existia `resume-session-config.js` nem builder específico no lugar correto.

**Veredito:** confirmado.

#### RSCFG-002 — vazamento de `sessionId`

Como `buildForResume()` convertia o objeto completo via cast, um call site podia fazer:

- `.sessionId(...)`
- `.buildForResume()`

E o payload resultante ainda carregava `sessionId`, embora esse campo não faça parte de `ResumeSessionConfig`.

**Veredito:** confirmado.

#### RSCFG-003 — `disableResume` vazava no `build()` normal

Como o builder compartilhava um único objeto interno, `disableResume` podia acabar presente até em `build()` de `SessionConfig`.

**Veredito:** confirmado.

### 5.3. Correções aplicadas

#### Novo módulo dedicado

Criado:

- `src/copilot/config/resume-session-config.js`

Com:

- `ResumeSessionConfigBuilder`
- surface explícita só com campos válidos para resume
- `build()` / `buildForResume()` canônicos

#### SSOT de sanitização

Adicionados em `src/copilot/config/session-config.js`:

- `RESUME_SESSION_CONFIG_KEYS`
- `sanitizeResumeSessionConfig(...)`

#### Builder antigo endurecido

`SessionConfigBuilder` agora:

- remove `disableResume` de `build()`
- sanitiza corretamente `buildForResume()`

#### Barrel canônico atualizado

`src/copilot/config/index.js` agora exporta:

- `ResumeSessionConfigBuilder`
- `sanitizeResumeSessionConfig`
- `RESUME_SESSION_CONFIG_KEYS`

### 5.4. Veredito final

`ResumeSessionConfig` agora está:

- **full**
- com **módulo dedicado no lugar correto**
- com **builder dedicado**
- com **sanitização estrutural explícita**

---

## 6. Matriz de paridade — subagentes / `CustomAgentConfig`

### 6.1. Achados confirmados

#### SUBAGENT-001 — `description` estava indevidamente tratada como obrigatória

O SDK oficial trata `description` como opcional.

O schema local (`SdkCustomAgentConfigSchema`) a tratava como obrigatória.

**Veredito:** confirmado.

**Correção aplicada:** `description` agora é opcional no schema local.

#### SUBAGENT-002 — `skills` ainda não estavam full no contrato estrutural local

O SDK oficial expõe `skills?: string[]` em `CustomAgentConfig`.

O repositório tinha suporte desigual:

- typings/docs locais: parciais
- schema estrutural: ausente
- factory pública `createAgent(...)`: ausente

**Veredito:** confirmado.

**Correção aplicada:**

- `src/copilot/core/schemas.js`
- `src/copilot/sdk/agent/agents.js`
- documentação SSOT local atualizada

#### SUBAGENT-003 — `mcpServers` não estava full no contrato estrutural local

O SDK oficial expõe `mcpServers?` por agente.

A factory já aceitava parcialmente, mas os contratos/documentação locais não estavam coerentes.

**Veredito:** parcial confirmado.

**Correção aplicada:** typedefs, schema e docs locais alinhados.

#### SUBAGENT-004 — `tools: []` era tratado como erro estrutural

O SDK aceita `tools?: string[] | null`.

O validador local tratava `tools=[]` como erro fatal, assumindo que ao menos uma tool seria obrigatória.

Isso era mais restritivo que o contrato do SDK.

**Veredito:** confirmado.

**Correção aplicada:** `tools=[]` agora é aceito e tratado como warning operacional, não erro estrutural.

#### SUBAGENT-005 — faltava governança para `skills` por subagente

Mesmo após aceitar `skills`, ainda faltava uma validação útil contra o contexto real da sessão:

- agente declara `skills`, mas a sessão não configurou `skillDirectories`
- agente declara `skills`, mas elas estão em `disabledSkills`

**Veredito:** confirmado.

**Correção aplicada:** `validateAgentContracts(...)` agora aceita contexto opcional da sessão (`skillDirectories`, `disabledSkills`) e produz warnings canônicos.

### 6.2. Melhoria arquitetônica adicional

O validador local agora também emite warning quando:

- o agente é inferível (`infer !== false`)
- e não declara `description`

Isso **não bloqueia** a sessão, porque o SDK aceita o contrato, mas torna explícito que a inferência de subagentes tende a perder qualidade sem descrição específica.

### 6.3. Veredito final

Na camada de contrato/configuração/factory:

- `CustomAgentConfig` está **full**
- `skills` está **full**
- `mcpServers` por agente está **full**
- governança mínima de skills por subagente está **entregue**
- a superfície terminal agora expõe projeção rica e mutação básica via `/sdk skills config`, `/sdk skills agents`, `/sdk skills disable ...` e `/sdk skills enable ...`

O backlog residual aqui já não é de contrato, e sim de produto/UX mais rica:

- projeções ainda mais visíveis/correlacionadas de skills por subagente em streaming
- diffs de config mais ricos em eventos
- mutações/config administrativas adicionais (ex.: alinhamento entre estado server-scoped e persistência declarativa do processo)

---

## 7. Arquivos alterados nesta rodada

### Código

- `src/copilot/config/session-config.js`
- `src/copilot/config/resume-session-config.js`
- `src/copilot/config/index.js`
- `src/copilot/config/custom-agents.js`
- `src/copilot/core/schemas.js`
- `src/copilot/sdk/agent/agents.js`
- `src/copilot/agent/facades/sdk/agent-contract.js`
- `src/copilot/agent/session/initializers/initializer.js`
- `src/copilot/server/routes/sdk/session-schemas.js`
- `src/copilot/server/routes/sdk/session-crud.js`
- `src/copilot/server/routes/sdk/README.md`
- `src/copilot/sdk/types.js`
- `src/copilot/boot/contract.js`

### Testes

- `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
- `tests/unit/copilot/agent/test_agent_contract.spec.js`
- `tests/unit/copilot/sdk/test_sdk_agents.spec.js`
- `tests/unit/copilot/test_sdk_route_session_ownership.spec.js`
- `tests/unit/copilot/contracts/test_barrel_contracts_i7.spec.js`

---

## 8. Validação executada

Validação concluída nesta rodada:

- `npm run test:copilot:unit -- ...` (lote focal) ✅
- `npm run typecheck:strict:src.copilot` ✅
- `npm run typecheck:strict:tests.unit` ✅
- `npm run lint:copilot` ✅

A baseline completa do lote Copilot continua sendo o próximo checkpoint natural após a sincronização documental desta frente.

---

## 9. Palavra final

A conclusão final desta auditoria é:

- `SessionConfig`: **full**
- `ResumeSessionConfig`: **full**, agora com **módulo dedicado correto**
- subagentes / `CustomAgentConfig`: **full na camada de contrato/config/factory**

O que restou para o roadmap já não é “falta implementar o contrato do SDK”.

O que restou é:

1. enriquecer UX e projeções de subagentes/skills na superfície terminal
2. avançar em `instructions.getSources()` / `convertMcpCallToolResult()`
3. seguir com persistência longa e hardening residual

Ou seja: esta frente deixa de ser gap estrutural e passa a ser base estabilizada para a próxima onda do roadmap principal.
