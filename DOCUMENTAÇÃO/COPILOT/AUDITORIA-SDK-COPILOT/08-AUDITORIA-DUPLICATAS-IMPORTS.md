# 08 — Auditoria de Duplicatas, Imports e Violações de Camada

**Data**: 2026-06-15
**Autor**: Auditoria automatizada (Copilot Agent)
**Status**: Diagnóstico completo — ações corretivas pendentes

---

## 1. Resumo Executivo

A auditoria identificou **5 categorias de problema** na interação entre as camadas do projeto e o `@github/copilot-sdk`:

| # | Categoria | Severidade | Qtd de Arquivos |
|---|-----------|------------|-----------------|
| A | **Imports runtime diretos ao SDK fora de `sdk/`** | 🔴 Alta | 1 arquivo |
| B | **Referências JSDoc tipadas ao SDK fora de `sdk/`** | 🟡 Média | 21 arquivos (40 refs) |
| C | **Implementações duplicadas (código nosso × SDK wrapper)** | 🔴 Alta | 3 implementações |
| D | **Múltiplos builders de SessionConfig** | 🟡 Média | 3 patterns concorrentes |
| E | **Exports mortos (dead code)** | 🟠 Moderada | 3 exports |

---

## 2. Arquitetura de Camadas (L1–L4)

```
L1: src/copilot/sdk/        → Wrapper do @github/copilot-sdk (SSOT)
L2: src/copilot/config/     → Configuração do projeto (builders, env, system prompt)
L3: src/copilot/hooks/      → Hook system, permissões, presets
L4: src/copilot/services/   → Fachadas de alto nível (api/, terminal/)
L5: src/copilot/agent/      → Always-Alive agent + lifecycle
L6: src/copilot/api/        → Express routes
L7: src/copilot/tools/      → Custom tools
```

**Regra fundamental**: Camadas de L2 em diante **NÃO devem importar** de `@github/copilot-sdk` — devem usar `#copilot/sdk` (`L1`).

---

## 3. Categoria A — Imports Runtime Diretos ao SDK (fora de `sdk/`)

**Princípio violado**: `sdk/session/permissions.js` declara explicitamente: _"Consumers **não** devem importar `approveAll` diretamente do `@github/copilot-sdk`."_

| Arquivo | Import | Deveria ser |
|---------|--------|-------------|
| `config/session-config.js:14` | `import { approveAll } from '@github/copilot-sdk'` | `import { approveAll } from '#copilot/sdk'` |

> **Nota**: Dentro de `sdk/` (L1) os imports diretos ao SDK são **corretos e esperados**. A violação é exclusiva de `config/session-config.js`.

**Ação**: Trocar import por `#copilot/sdk`.

---

## 4. Categoria B — Referências JSDoc Tipadas ao SDK (fora de `sdk/`)

40 referências em 21 arquivos usam `import('@github/copilot-sdk').TypeName` em JSDoc em vez de `import('#copilot/sdk/types.js').TypeName`.

### 4.1. `config/` (L2) — 13 arquivos

| Arquivo | # Refs | Tipos referenciados |
|---------|--------|---------------------|
| `config/session-config.js` | 8 | SessionConfig, ResumeSessionConfig, PermissionHandler, Tool, SystemMessageConfig, MCPServerConfig, CustomAgentConfig, InfiniteSessionConfig, SessionEventHandler |
| `config/client-options.js` | 2 | CopilotClientOptions, ModelInfo |
| `config/system-prompt/index.js` | 2 | SectionOverrideAction |
| `config/system-prompt/sections/*.js` | 10× | SectionOverrideAction (em 10 section files) |

### 4.2. `agent/` (L5)

| Arquivo | # Refs | Tipos referenciados |
|---------|--------|---------------------|
| `agent/lifecycle/reconnect-policy.js` | 1 | CopilotSession |
| `agent/lifecycle/session-setup.js` | 1 | SessionConfig |
| `agent/types.js` | 1 | MessageOptions |

### 4.3. `api/` (L6)

| Arquivo | # Refs | Tipos referenciados |
|---------|--------|---------------------|
| `api/express/agent.js` | 1 | CopilotClient |
| `api/express/client.js` | 1 | CopilotClient |
| `api/express/session-messaging.js` | 1 | SessionEvent |

### 4.4. `services/` (L4)

| Arquivo | # Refs | Tipos referenciados |
|---------|--------|---------------------|
| `services/session-service.js` | 6 | CopilotClient, CopilotSession, SessionConfig, ResumeSessionConfig, SessionListFilter, SessionMetadata |

### 4.5. `tools/` (L7)

| Arquivo | # Refs | Tipos referenciados |
|---------|--------|---------------------|
| `tools/experimental-rpc-tools.js` | 4 | CopilotSession (×4) |

**Ação**: Para cada referência, trocar `import('@github/copilot-sdk').X` por `import('#copilot/sdk/types.js').X`. Todos os tipos já estão disponíveis em `sdk/types.js`.

---

## 5. Categoria C — Implementações Duplicadas

### C1. `createPermissionHandler` — DUPLICADA em 2 arquivos

| Local | Arquivo | Utilizado? |
|-------|---------|------------|
| **hooks/** (L3) | `hooks/permission-handler.js` | ✅ Sim — todos os 8+ consumers usam este |
| **sdk/** (L1) | `sdk/session/permissions.js` | ❌ Não — dead code (só chamado por `createAllowlistPermissionHandler` do mesmo arquivo, que também é dead) |

**Diferenças**:
- `hooks/` versão: mais completa (suporta `content-exclusion-policy`, `onRequest` async + boolean return, audit-mode verboso)
- `sdk/` versão: mais simples (sem `content-exclusion-policy`, `onRequest` retorna `PermissionRequestResult` diretamente)

**Ação**: Excluir `createPermissionHandler` de `sdk/session/permissions.js`. Manter `approveAll` re-export. A versão em `hooks/` é a canônica.

### C2. Pre-tool-use allow/deny decision logic — 3 implementações

| Local | Função | Nível |
|-------|--------|-------|
| `hooks/factory.js` | `resolveToolDecision()` | L3 — Hooks PreToolUseHandler |
| `hooks/presets/production.js` | `onPreToolUse()` | L3 — Preset production |
| `hooks/factory.js` (E1.2) | `buildDynamicOnlyPreToolUseHandler()` | L3 — Hooks dynamic path |

Todos implementam lógica allow/deny/ask com campos similares (`allowTools`/`denyTools`/`denyPatterns`/`isToolDisabled`), mas em níveis diferentes:
- `resolveToolDecision`: estático, baseado em `HooksConfig`
- production preset: integrado inline com audit + bus
- dynamic-only: simplificado sem filtering estático

**Ação**: Documentar intencionalmente como **3 perfis de complexidade crescente** (minimal, hooks, production). Não consolidar — são pipelines diferentes com garantias diferentes. Marcar no JSDoc a relação.

### C3. `approveAll` — Re-exportado de 3 locais

| Caminho de importação | Módulo-fonte real |
|-----------------------|-------------------|
| `#copilot/sdk` | `sdk/session/permissions.js` → re-export de `@github/copilot-sdk` |
| `#copilot/services` | `services/session-service.js` → re-export de `#copilot/sdk` |
| `@github/copilot-sdk` (direto) | `config/session-config.js` (VIOLAÇÃO) |

**Ação**:
1. Fixar `config/session-config.js` → importar de `#copilot/sdk`
2. Documentar que `#copilot/sdk` é o SSOT para `approveAll`
3. `#copilot/services` re-export é intencional (conveniência para api/ — evita que api/ importe de L1)

---

## 6. Categoria D — Múltiplos Builders de SessionConfig

| # | Pattern | Arquivo | Usado? |
|---|---------|---------|--------|
| D1 | `SessionConfigBuilder` (fluent) | `config/session-config.js` | ✅ `session-setup.js` |
| D2 | `buildSessionConfig(input, defaults)` (merge+spread) | `sdk/config.js` | ⚠️ Exportado na barrel, mas **sem callers diretos** |
| D3 | `buildSessionConfig(opts, mode)` (field-by-field) | `sdk/session/lifecycle.js` | ✅ `createSession()`, `resumeSession()` |

### Análise

- **D1** é o builder modern (Faixa C), agora canonical para o `agent/lifecycle`.
- **D2** foi criado antes de D1 como uma facade de merge; agora é **dead code** (exportado mas não chamado).
- **D3** é **interno** de `lifecycle.js` (não exportado) — construtor field-by-field para `createSession`/`resumeSession`.

**D2 vs D1**: D2 faz `{ ...base, ...defaults, ...input }` (shallow merge). D1 (`SessionConfigBuilder`) faz `.model()`, `.tools()`, `.build()` (builder fluent com validação). D1 subsume D2.

**D3**: Função interna de `lifecycle.js` com lógica específica de `create`/`resume` mode. Não duplica D1 — opera no nível SDK lifecycle interno.

**Ação**:
1. Deprecar `sdk/config.js::buildSessionConfig` — marcar como `@deprecated` apontando para `SessionConfigBuilder`
2. Manter `sdk/config.js::getProjectDefaults()`, `mergeTools()`, `mergeExcludedTools()` (são úteis e não duplicados)
3. Manter `sdk/session/lifecycle.js::buildSessionConfig` (interno, finalidade diferente)

---

## 7. Categoria E — Dead Code / Exports Mortos

| Export | Módulo | Barrel | Callers |
|--------|--------|--------|---------|
| `createAllowlistPermissionHandler` | `sdk/session/permissions.js` | `sdk/index.js` | **0** |
| `createPermissionHandler` | `sdk/session/permissions.js` | Não (comentário no barrel) | `createAllowlistPermissionHandler` (mesmo arquivo) |
| `buildSessionConfig` | `sdk/config.js` | `sdk/index.js` | **0** (internos de lifecycle.js usam local) |

**Ação**: Deprecar com `@deprecated` + prazo de remoção.

---

## 8. Situação dos `@github/copilot-sdk/package.json` Deep Imports

| Arquivo | Uso |
|---------|-----|
| `server/routes/copilot-api/control.js:25` | `require('@github/copilot-sdk/package.json').version` |
| `tools/introspection-tools.js:159` | `require('@github/copilot-sdk/package.json').version` |

**Ação**: Centralizar em `sdk/constants.js` (ex: `export const SDK_VERSION = ...`). Ou aceitar como edge-case (apenas 2 locais, ambos leitura de version).

---

## 9. Situação Ideal Proposta

### 9.1. Regra de Ouro

```
@github/copilot-sdk  →  SOMENTE importado dentro de  src/copilot/sdk/**

Todos os outros módulos usam:
  - Runtime values:  import { X } from '#copilot/sdk'
  - Tipos (JSDoc):   import('#copilot/sdk/types.js').TypeName
```

### 9.2. Hierarquia de responsabilidades

| Camada | Responsabilidade | Importa de |
|--------|-----------------|------------|
| `sdk/` (L1) | Wrapper: re-exports + thin adapters + tipos | `@github/copilot-sdk` |
| `config/` (L2) | Builders de configuração | `#copilot/sdk` |
| `hooks/` (L3) | Hook system, permissions, presets | `#copilot/sdk`, `#copilot/config` |
| `services/` (L4) | Facades de alto nível | `#copilot/sdk`, `#copilot/config`, `#copilot/hooks` |
| `agent/` (L5) | Always-Alive lifecycle | `#copilot/config`, `#copilot/hooks`, `#copilot/services` |
| `api/` (L6) | Express routes | `#copilot/services` (preferencialmente) |
| `tools/` (L7) | Custom tools | `#copilot/sdk` (via #copilot/tools barrel) |

### 9.3. Permissão Handler — Canonical Path

```
@github/copilot-sdk::approveAll
    ↓ re-export
sdk/session/permissions.js::approveAll
    ↓ barrel
#copilot/sdk  →  usado por hooks/, config/, agent/, services/

hooks/permission-handler.js::createPermissionHandler  →  SSOT para criação customizada
    ↓ barrel
#copilot/hooks  →  usado por presets/, agent/
```

### 9.4. SessionConfig — Canonical Path

```
SessionConfigBuilder (config/session-config.js)  →  SSOT para agent lifecycle
    usado por: agent/lifecycle/session-setup.js

sdk/session/lifecycle.js::buildSessionConfig (interno)  →  para createSession()/resumeSession()
    NÃO exportado, NÃO conflita

sdk/config.js::buildSessionConfig  →  DEPRECAR (subsumido por SessionConfigBuilder)
```

---

## 10. Plano de Ações Corretivas

### 10.1. Ações Imediatas (Blitz ~4h)

| # | Ação | Arquivos | Impacto |
|---|------|----------|---------|
| 1 | Fixar `config/session-config.js`: `@github/copilot-sdk` → `#copilot/sdk` | 1 | Runtime + tipos |
| 2 | Fixar 21 arquivos JSDoc: `import('@github/copilot-sdk')` → `import('#copilot/sdk/types.js')` | 21 | Tipos only |
| 3 | Deprecar `sdk/config.js::buildSessionConfig` com `@deprecated` | 1 | Documentação |
| 4 | Deprecar `sdk/session/permissions.js::createPermissionHandler` e `createAllowlistPermissionHandler` | 1 | Documentação |

### 10.2. Ações de Médio Prazo (Sprint ~8h)

| # | Ação | Descrição |
|---|------|-----------|
| 5 | Remover `createPermissionHandler` de `sdk/session/permissions.js` | Dead code — toda lógica real é em `hooks/`
| 6 | Remover `createAllowlistPermissionHandler` de `sdk/index.js` barrel | Sem callers |
| 7 | Remover `buildSessionConfig` de `sdk/config.js` export | Sem callers, subsumido por SessionConfigBuilder |
| 8 | Centralizar `SDK_VERSION` em `sdk/constants.js` | Eliminar 2 `require(.../package.json)` |
| 9 | ESLint rule `no-restricted-imports` para `@github/copilot-sdk` fora de `sdk/` | Prevenir regressão permanente |

### 10.3. Ações Opcionais (Nice-to-have)

| # | Ação | Descrição |
|---|------|-----------|
| 10 | Documentar os 3 perfis de pre-tool-use decision | resolveToolDecision, production onPreToolUse, dynamic-only |
| 11 | Lint rule para imports JSDoc `@github/copilot-sdk` fora de `sdk/` | Extensão custom ou plugin ESLint |

---

## 11. Mapa de Dependências Atual (grafo simplificado)

```
@github/copilot-sdk
    ├── sdk/session/client.js         → CopilotClient (runtime)
    ├── sdk/session/lifecycle.js      → CopilotClient, approveAll (runtime)
    ├── sdk/session/permissions.js    → approveAll (runtime)
    ├── sdk/session/system-message.js → SYSTEM_PROMPT_SECTIONS (runtime)
    ├── sdk/tools/core.js             → defineTool (runtime)
    ├── sdk/config.js                 → approveAll (runtime)
    └── config/session-config.js      → approveAll (runtime) ⚠️ VIOLAÇÃO


#copilot/sdk (barrel)
    ├── config/   (L2) — client-options, session-config, system-prompt, env
    ├── hooks/    (L3) — permission-handler, factory, presets, session-hooks
    ├── services/ (L4) — session-service re-exports approveAll
    ├── agent/    (L5) — permission-controller, session-setup, reconnect
    ├── api/      (L6) — uses session-crud via #copilot/services
    └── tools/    (L7) — tool-factory, experimental-rpc-tools
```

---

## 12. Apêndice — Contadores

| Métrica | Valor |
|---------|-------|
| Total de imports runtime `@github/copilot-sdk` (dentro de `sdk/`) | 7 (correto) |
| Total de imports runtime `@github/copilot-sdk` (fora de `sdk/`) | **1** (violação) |
| Total de referências JSDoc `@github/copilot-sdk` (dentro de `sdk/`) | ~97 |
| Total de referências JSDoc `@github/copilot-sdk` (fora de `sdk/`) | **40** (em 21 arquivos) |
| Exports sem callers (dead exports) | 3 |
| Implementações duplicadas (semanticamente equivalentes) | 2 (createPermissionHandler, buildSessionConfig) |
| Consumers de `#copilot/sdk` barrel | 49 |
| Consumers de `#copilot/hooks` barrel | 7 |
| Consumers de `#copilot/config` barrel | 44 |
| Consumers de `#copilot/services` barrel | 12 |
