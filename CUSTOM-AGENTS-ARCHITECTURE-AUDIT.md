# Auditoria arquitetural e roteiro de consolidação de agentes customizados

> Revisão Codex 2026-05-07: este documento é uma fonte externa e ficou parcialmente defasado diante
> do estado vivo do repositório. A versão canônica corrigida está em
> `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-07-ROADMAP-CUSTOM-AGENTS-SDK-FIRST.md`.
>
> Correções principais aplicadas nesta rodada: `agent-full` passou a carregar por perfil padrão,
> `tools: null` passou a representar acesso total conforme o contrato oficial do SDK,
> `tools/bootstrap.js` passou a registrar ferramentas de índice/escopo, os nomes legados (`bash`,
> `read_bash`, `report_intent`, `str_replace_editor`) foram reconciliados por aliases ou por
> ferramentas reais, e o roadmap deixou de propor um runtime paralelo de agentes.

**Data**: 7 de maio de 2026 **Escopo**: Auditoria arquitetural completa do sistema de custom agents;
proposta de consolidação em torno de agente maestro (agent-full) com acesso completo. **Status**:
Investigação concluída → Pronto para implementação **Classificação**: Estratégico (afeta todo o
pipeline de delegação de agentes)

---

## Executive Summary

O sistema de custom agents atual está **fragmentado em duas camadas não-integradas** (SDK_AGENTS e
BUILTIN_AGENTS) com:

- ❌ **Sem agente maestro**: nenhum agente possui acesso irrestrito a todas as tools
- ❌ **Tool naming inconsistente**: canonical vs. legacy sem camada unificada de aliasing
- ❌ **Sem validação de contrato**: agentes declaram tools que podem não estar disponíveis
- ❌ **Denylist global, sem granularidade**: controle de acesso não é per-agent
- ❌ **Sem feedback loops**: tool registry não valida nem audita agent config
- ❌ **BUILTIN vs SDK separados**: dois ecosistemas incompatíveis (terminal vs. SDK)

**Impacto operacional**: Operações complexas de longa duração (tarefas multi-etapa) não têm agente
"maestro" central para orquestração, delegação e validação. Resultado: fallback manual para LLM-B,
perda de especialização.

**Proposta**: Criar `agent-full` (maestro) como agente default com acesso a todas as tools,
consolidar naming, adicionar validação de contrato e feedback loops.

---

## Part 1: Análise do Estado Atual

### 1.1 Arquitetura Fragmentada: SDK_AGENTS vs BUILTIN_AGENTS

#### SDK_AGENTS (6 agentes — invocados pelo SDK/LLM-B)

**Localização**: `src/copilot/config/custom-agents.js` linhas 177-320 **Modo de invocação**:
Delegação automática LLM-B via `SessionConfig.customAgents` **Ambiente**: Production SDK Copilot

| Agente         | Responsabilidade         | Tools                                                                                                                        | Especialização            |
| -------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **task**       | Execução de comandos dev | bash, write_bash, read_bash, stop_bash                                                                                       | Construções, testes, lint |
| **explore**    | Exploração de codebase   | list*directory, read_file_content, search_in_files + workspace*\*+ fallback (grep, glob)                                     | Navegação + discovery     |
| **diagnostic** | Diagnósticos de sistema  | bash, read_bash, grep, glob                                                                                                  | PM2, portas, logs, health |
| **planner**    | Planejamento multi-etapa | session*mode_set, session_plan*\*, get_tasks, add_task + list_directory, search_in_files, workspace_scope_context + fallback | Estruturação de trabalho  |
| **git-ops**    | Operações Git            | git_status, git_diff, git_changed_files, git_log, git_create_branch, git_commit, git_push, report_intent                     | Versionamento + CI/CD     |
| **shell-ops**  | Operações de shell/npm   | exec_command, run_npm_script, run_node_file, lint_check, run_tests, typecheck, get_system_health, report_intent              | Automação de ambiente     |

#### BUILTIN_AGENTS (3 agentes — invocados via terminal/REPL)

**Localização**: `src/copilot/config/custom-agents.js` linhas 30-140 **Modo de invocação**:
Referência manual `@nome` no terminal/REPL **Ambiente**: Terminal LLM-B (`terminal:llm-b` task)

| Agente       | Responsabilidade    | Tools            | Especialização       |
| ------------ | ------------------- | ---------------- | -------------------- |
| **auditor**  | Auditoria de código | glob, grep, view | Análise + relatórios |
| **docs**     | Documentação        | view, glob       | Geração JSDoc/README |
| **reviewer** | Revisão de PR       | glob, grep, view | Code review          |

**Problema fundamental**: BUILTIN_AGENTS usam legacy tools (glob, grep, view) e não fazem parte do
ecosystem SDK_AGENTS. Não há unificação.

---

### 1.2 Tool Naming: Caos de Aliases

#### Canonical File-Tools (modernas, nativas SDK)

```
read_file_content        → ler arquivos
list_directory           → listar diretórios
search_in_files          → busca com ripgrep
workspace_symbol_search  → busca simbólica
workspace_index_build    → construir índice
workspace_index_search   → busca em índice
workspace_index_find_symbol → busca simbólica em índice
workspace_scope_declare  → declarar escopo
workspace_scope_refresh  → atualizar escopo
workspace_scope_context  → contexto de escopo
workspace_scope_find_symbol → busca simbólica em escopo
workspace_scope_list     → listar escopos
workspace_scope_close    → fechar escopo
```

#### Legacy Tools (antigas, ainda referenciadas)

```
grep     → search_in_files com fallback
glob     → list_directory com fallback
view     → read_file_content com fallback
bash     → exec_command (não-arquivo)
```

#### Mapeamento Atual (fragmentado)

| Agente     | Canonical   | Legacy        | Fallback?                              |
| ---------- | ----------- | ------------- | -------------------------------------- |
| explore    | ✅ primário | ⚠️ secundário | sim (8/14 tools são canonical)         |
| planner    | ⚠️ mínimo   | ⚠️ sim        | sim (3/10 canonical)                   |
| diagnostic | ❌ nenhum   | ✅ only       | não                                    |
| task       | ❌ nenhum   | ✅ only       | não                                    |
| auditor    | ❌ nenhum   | ✅ only       | não                                    |
| docs       | ❌ nenhum   | ✅ only       | não                                    |
| reviewer   | ❌ nenhum   | ✅ only       | não                                    |
| git-ops    | ✅ especial | ❌ nenhum     | não (git\_\* + report_intent)          |
| shell-ops  | ✅ especial | ❌ nenhum     | não (exec*\* + npm*\* + report_intent) |

**Descoberta crítica**: 5 de 9 agentes usam **apenas** legacy tools. Nenhuma camada unificada de
aliasing mapeia canonical → legacy.

---

### 1.3 Fluxo de Integração: Config → SDK → Session → Runtime → Terminal

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: Configuration Load (app bootstrap)                      │
├─────────────────────────────────────────────────────────────────┤
│ src/copilot/config/env.js (L106-108)                             │
│   ↓ reads COPILOT_CUSTOM_AGENTS, COPILOT_DISABLED_AGENTS from env
│ src/copilot/config/custom-agents.js (L333-335)                  │
│   ↓ DEFAULT_SDK_AGENTS = COPILOT_CUSTOM_AGENTS.split(',')      │
│ src/copilot/config/index.js (L83)                               │
│   ↓ exports buildCustomAgentsConfig                              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: Session Initialization (agent startup)                 │
├─────────────────────────────────────────────────────────────────┤
│ src/copilot/agent/session/initializers/initializer.js (L212)   │
│   ↓ customAgents: buildCustomAgentsConfig() → SessionConfig      │
│ src/copilot/agent/lifecycle/setup/session-setup.js (L241-259)  │
│   ↓ getAgentSdkToolsConfig() → { denylist, allowlist }         │
│   ↓ withAgentRuntimeToolPolicy() applica tool filtering via hook │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: Runtime Tool Policy (onPreToolUse hook)                │
├─────────────────────────────────────────────────────────────────┤
│ src/copilot/agent/ports/hook-port.js (L68-85)                  │
│   ↓ isToolDisabled() → check denylist/allowlist                 │
│ src/copilot/sdk/tools/state.js                                  │
│   ↓ _toolsConfig persists in tools-config.json                  │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: Terminal Visibility (diagnostics)                      │
├─────────────────────────────────────────────────────────────────┤
│ src/copilot/terminal/commands/session.js (L200-227)            │
│   ↓ /status command renders: customAgentsLine                   │
│   ↓ "Active agents: task,planner,diagnostic"                   │
└─────────────────────────────────────────────────────────────────┘
```

**Problemas detectados**:

1. **Config é CSV estática**: não há validação de nomes contra registry
2. **Sem per-agent allowlist**: denylist global aplica a todos
3. **Sem validação de tool availability**: agente declara tool X, mas tool X pode não existir ou
   estar nomeada diferentemente
4. **Sem feedback loop**: tool registry não valida nem audita agent config
5. **Terminal visibility é read-only**: não há controle de agentes via /status

---

### 1.4 Control Flow & Runtime Policies

#### Controle de Acesso (Atual)

```javascript
// src/copilot/agent/lifecycle/setup/session-setup.js (L241-259)
const toolsConfig = getAgentSdkToolsConfig(); // { denylist, allowlist }
const defaultRuntimeDenylist = [...DEFAULT_EXCLUDED_TOOLS, ...toolsConfig.denylist];

return {
  busHooks: withAgentRuntimeToolPolicy(busHooks, (toolName) => {
    if (isAgentToolDisabled(toolName)) {
      // ← legacy per-module disable
      return true;
    }
    if (defaultRuntimeDenylist.includes(toolName)) {
      // ← GLOBAL denylist
      return true;
    }
    if (toolsConfig.allowlist !== null) {
      return !toolsConfig.allowlist.includes(toolName); // ← GLOBAL allowlist override
    }
    return false;
  }),
};
```

**Análise**:

- Denylist é global, não per-agent
- Allowlist é global, não per-agent
- Sem controle granular: agente X pode ter tools Y e Z, agente B pode ter tools Y e Z e W
- Sem validação: se allowlist = [tool_A, tool_B] mas agente X declara [tool_C], nenhuma validação
  falha

#### Environment-Based Configuration (Atual)

```bash
# default (package.json, env.js default)
COPILOT_CUSTOM_AGENTS=task,explore,diagnostic,planner,git-ops,shell-ops
COPILOT_DISABLED_AGENTS=

# terminal:llm-b task (package.json L342)
COPILOT_CUSTOM_AGENTS=task,planner,diagnostic
COPILOT_DISABLED_AGENTS=explore,coder,shell-ops
```

**Problemas**:

- Nomes hardcoded como strings; sem validação de existência
- COPILOT_DISABLED_AGENTS é paliativo (desabilita sem remover)
- Sem "operational profiles": impossível salvar/carregar configurações pré-definidas (ex: "debug
  profile", "maintenance profile")

---

### 1.5 Session Initialization & SessionConfig Integration

**Arquivo**: `src/copilot/agent/session/initializers/initializer.js` L212

```javascript
customAgents: buildCustomAgentsConfig(),  // ← injetar em SessionConfig
```

**Struct de SessionConfig (SDK)**:

```typescript
{
  customAgents?: SdkCustomAgentConfig[];
  model?: string;
  tools?: Tool[];
  hooks?: {
    onPreToolUse?: (req) => Decision;
    ...
  };
  ...
}
```

**Problema**: Não há contrato validado entre `customAgents` declarados e `tools` disponíveis. Se
agente declara tool X mas tool X não está em `tools[]`, nenhuma validação falha em tempo de sessão.

---

### 1.6 Missing: Agent Maestro / Full-Access Default

**Situação Atual**: Nenhum agente possui acesso a TODAS as tools disponíveis.

**Impacto**:

- Tarefas complexas multi-etapa precisam de fallback manual para LLM-B central
- Sem orquestrador dedicado que possa:
  - Delegar a especialistas (task, explore, git-ops)
  - Monitorar progresso
  - Redirecionar ao detectar bloqueios
  - Coordenar trabalho paralelo

**Exemplo de bloqueio**:

1. Usuário: "Faça uma auditoria profunda do src/copilot/config e depois commit as sugestões"
2. LLM-B ativa agente `explore` → lê e analisa código
3. `explore` não consegue fazer commit (não tem git_commit)
4. Fallback: LLM-B central toma controle → perde especialização
5. Resultado: lógica diluída, sem traçabilidade de qual agente fez o quê

---

### 1.7 Missing: Tool Alias / Mapping Layer

**Situação Atual**: Cada agente hardcoda array de nomes de tools (strings). Sem layer que mapeia
canonical ↔ legacy.

**Impacto**:

- Explorador recente pode usar `read_file_content` (canonical), agente antigo usa `view` (legacy)
- SDK não sabe se `view` é alias de `read_file_content` ou ferramenta diferente
- Mudanças no naming quebram agentes silenciosamente

**Exemplo de risco**:

```javascript
// Agente antigo (até 2026-04-30)
tools: ['glob', 'grep', 'view', 'bash'];

// Agente novo (2026-05-06)
tools: ['list_directory', 'search_in_files', 'read_file_content', 'bash'];

// Problema: se 'view' é removido (pois 'read_file_content' é preferido),
// agente antigo falha silenciosamente sem erro no boot
```

---

### 1.8 Validation & Error Handling Gaps

**Lacunas identificadas**:

| Validação                    | Onde devia estar          | Status atual                         |
| ---------------------------- | ------------------------- | ------------------------------------ |
| Agent name exists            | buildCustomAgentsConfig() | ❌ Nenhuma                           |
| Tool name valid              | buildCustomAgentsConfig() | ❌ Nenhuma                           |
| Tool available in registry   | session-setup.js          | ❌ Nenhuma                           |
| Tool alias resolved          | tool policy hook          | ❌ Nenhuma                           |
| Per-agent allowlist enforced | session-setup.js          | ❌ Nenhuma (apenas global)           |
| Config persisted for audit   | tools-config.json         | ⚠️ Só para denylist/allowlist global |

**Resultado**: Configurações inválidas passam silenciosamente até runtime, causando erros obscuros.

---

### 1.9 Summary of Gaps

| Gap                               | Severidade | Impacto                                                    | Raiz             |
| --------------------------------- | ---------- | ---------------------------------------------------------- | ---------------- |
| Sem agente maestro                | 🔴 CRÍTICO | Impossível orquestração automática multi-etapa             | Arquitetura      |
| Tool naming caótico               | 🔴 CRÍTICO | Configurações frágeis, migrações quebram silenciosamente   | Design histórico |
| Sem validação de contrato         | 🟠 ALTO    | Erros de runtime em vez de bootstrap                       | Falta de schemas |
| Denylist global sem granularidade | 🟠 ALTO    | Sem controle per-agent, impossível especialização restrita | Implementação    |
| BUILTIN vs SDK separados          | 🟠 ALTO    | Duplicação, inconsistência, manutenção                     | Arquitetura      |
| Sem feedback loops                | 🟡 MÉDIO   | Impossível auditoria/validação contínua                    | Operações        |

---

## Part 2: Ideal State Proposal

### 2.1 Architecture: Maestro-Based Hierarchy

#### Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       AGENT MAESTRO                               │
│  (agent-full) — Full-access default                              │
│  Responsabilidade: Orquestração, delegação, monitoramento        │
│  Tools: TODAS as tools disponíveis                               │
│  Acesso: SessionConfig.customAgents[0] (prioritário)             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┼──────────────────────┐
        ↓                     ↓                      ↓
   ┌─────────┐       ┌──────────────┐      ┌──────────────┐
   │ EXPLORE │       │     TASK     │      │   PLANNER    │
   │ Navega, │       │   Executa    │      │  Estrutura   │
   │ descobre│       │  comandos    │      │  trabalho    │
   └─────────┘       └──────────────┘      └──────────────┘
        ↓                     ↓                      ↓
   ┌─────────┐       ┌──────────────┐      ┌──────────────┐
   │ DIAGNOSTIC      │   GIT-OPS    │      │  SHELL-OPS   │
   │ Valida,  │      │  Versionamento     │  Automação   │
   │ monitora │      │               │      │  npm/node    │
   └─────────┘       └──────────────┘      └──────────────┘
```

#### Agent Specifications

##### 1. agent-full (MAESTRO) — **NEW**

```javascript
{
  name: 'agent-full',
  displayName: 'Full-Access Orchestrator',
  description: 'Maestro agent with access to all tools. Coordinates complex multi-step operations.',
  tools: ['*'],  // ← TODAS as tools; resolvidas em tempo de sessão
  prompt: `You are the orchestration maestro for this codebase.

Role: coordinate complex multi-step operations, delegate to specialists, monitor progress.

Authority: You have access to ALL tools. Use specialists (explore, task, diagnostic, planner, git-ops, shell-ops) for depth.

Decision tree:
1. For codebase exploration → delegate to 'explore' agent
2. For command execution → delegate to 'task' agent
3. For git operations → delegate to 'git-ops' agent
4. For complex planning → delegate to 'planner' agent
5. For diagnostics → delegate to 'diagnostic' agent
6. For npm/node/shell → delegate to 'shell-ops' agent
7. For coordination/synthesis → handle directly with full toolset

Always:
- Report progress transparently
- Escalate blockers to user immediately
- Maintain work context across delegations
- Document decisions in work plan if applicable`,
  infer: true,
  priority: 'maestro',  // ← instrui SDK a priorizar este agente
}
```

##### 2-7. Specialists (unchanged names, enhanced tools)

**explore**:

```javascript
{
  name: 'explore',
  tools: [
    // tier 1: canonical file-tools (MUST be available)
    'read_file_content', 'list_directory', 'search_in_files',
    'workspace_symbol_search', 'workspace_index_search', 'workspace_index_find_symbol',
    'workspace_scope_context', 'workspace_scope_find_symbol', 'workspace_scope_list',
    // tier 2: workspace indexing
    'workspace_index_build', 'workspace_index_status',
    // tier 3: optional legacy fallback (for compatibility only)
    'grep', 'glob', 'view'
  ],
  toolTiers: { must: tier1, should: tier2, optional: tier3 },  // ← NEW
  ...
}
```

**task** (unchanged, mas com validação):

```javascript
{
  name: 'task',
  tools: ['bash', 'write_bash', 'read_bash', 'stop_bash'],
  ...
}
```

**diagnostic** (enhanced):

```javascript
{
  name: 'diagnostic',
  tools: [
    'bash', 'read_bash',
    'workspace_scope_context',  // ← novo, para contexto de escopo
    'grep', 'glob'  // ← legacy
  ],
  ...
}
```

**planner** (unchanged, validado):

```javascript
{
  name: 'planner',
  tools: [
    'session_mode_set', 'session_plan_read', 'session_plan_update',
    'get_tasks', 'add_task',
    'list_directory', 'search_in_files', 'workspace_scope_context',
    'grep', 'glob'  // ← legacy fallback
  ],
  ...
}
```

**git-ops** (unchanged):

```javascript
{
  name: 'git-ops',
  tools: ['git_status', 'git_diff', 'git_changed_files', 'git_log', 'git_create_branch', 'git_commit', 'git_push', 'report_intent'],
  ...
}
```

**shell-ops** (unchanged):

```javascript
{
  name: 'shell-ops',
  tools: ['exec_command', 'run_npm_script', 'run_node_file', 'lint_check', 'run_tests', 'typecheck', 'get_system_health', 'report_intent'],
  ...
}
```

---

### 2.2 Tool Naming: Unified Aliasing Layer

#### Tool Registry with Canonical → Legacy Mapping

**New file**: `src/copilot/config/tool-aliases.js`

```javascript
/**
 * Tool aliasing registry: canonical → legacy mappings Allows agents to declare either canonical or legacy names;
 * session init resolves to canonical name via this registry.
 */

export const TOOL_ALIASES = {
  // File tools
  read_file_content: ['view', 'read_file'], // canonical: read_file_content, legacy: view, read_file
  list_directory: ['glob', 'ls'],
  search_in_files: ['grep', 'search'],

  // Workspace tools
  workspace_symbol_search: [], // no legacy alias
  workspace_index_build: [],
  workspace_index_search: [],
  workspace_index_find_symbol: [],
  workspace_scope_declare: ['scope_new'],
  workspace_scope_context: [],
  workspace_scope_find_symbol: [],
  workspace_scope_list: [],
  workspace_scope_close: ['scope_delete'],

  // Bash tools
  bash: ['exec_command'],
  write_bash: [],
  read_bash: [],
  stop_bash: [],

  // Git tools
  git_status: [],
  git_diff: [],
  git_changed_files: [],
  git_log: [],
  git_create_branch: [],
  git_commit: [],
  git_push: [],

  // Npm/Node tools
  exec_command: [],
  run_npm_script: [],
  run_node_file: [],
  lint_check: [],
  run_tests: [],
  typecheck: [],
  get_system_health: [],

  // Session tools
  session_mode_set: [],
  session_plan_read: [],
  session_plan_update: [],
  get_tasks: [],
  add_task: [],

  // Reporting
  report_intent: [],
};

/**
 * Resolves any tool name (canonical or legacy) to canonical form.
 *
 * @param {string} toolName
 * @returns {string | null} canonical name or null if not found
 */
export function resolveToolName(toolName) {
  // Check if it's already canonical
  if (TOOL_ALIASES[toolName]) {
    return toolName;
  }

  // Check if it's a legacy alias
  for (const [canonical, legacyNames] of Object.entries(TOOL_ALIASES)) {
    if (legacyNames.includes(toolName)) {
      return canonical;
    }
  }

  // Not found
  return null;
}

/**
 * Returns all names (canonical + legacy) for a tool.
 *
 * @param {string} toolName (canonical or legacy)
 * @returns {string[]} all names including canonical
 */
export function getAllToolNames(toolName) {
  const canonical = resolveToolName(toolName);
  if (!canonical) return [];
  return [canonical, ...TOOL_ALIASES[canonical]];
}

/**
 * Normalizes an agent's tool list: converts legacy names to canonical.
 *
 * @param {string[]} toolNames
 * @returns {{ canonical: string[]; unresolved: string[] }}
 */
export function normalizeAgentToolList(toolNames) {
  const canonical = [];
  const unresolved = [];

  for (const name of toolNames) {
    const resolved = resolveToolName(name);
    if (resolved) {
      canonical.push(resolved);
    } else {
      unresolved.push(name);
    }
  }

  return {
    canonical: [...new Set(canonical)], // deduplicate
    unresolved,
  };
}
```

#### Benefit

- Agentes podem declarar `['view', 'grep']` (legacy) ou `['read_file_content', 'search_in_files']`
  (canonical)
- Session init normaliza automaticamente
- Backward-compatible com agentes antigos
- Auditable: `unresolved` array flagging unknown tools

---

### 2.3 Contract Validation: Agent ↔ Tool Registry

#### New Contract Schema

**File**: `src/copilot/core/schemas.js` (extend existing ToolsConfigSchema)

```javascript
/**
 * Agent tool contract: validated on session init
 */
export const AgentToolContractSchema = z.object({
  agentName: z.string(),
  declaredTools: z.array(z.string()),
  resolvedTools: z.array(z.string()),
  toolTiers: z
    .object({
      must: z.array(z.string()).optional(), // MUST be available
      should: z.array(z.string()).optional(), // SHOULD be available
      optional: z.array(z.string()).optional(), // MAY be available
    })
    .optional(),
  validationErrors: z.array(
    z.object({
      tool: z.string(),
      reason: z.enum(['unresolved', 'unavailable', 'tier-unsatisfied']),
    }),
  ),
  validAt: z.number(), // timestamp
});

/**
 * Session agent config: validates all custom agents on init
 */
export const SessionCustomAgentsSchema = z.object({
  agents: z.array(
    z.object({
      name: z.string(),
      tools: z.array(z.string()),
      prompt: z.string(),
      infer: z.boolean().optional(),
    }),
  ),
  validationResults: z.array(AgentToolContractSchema),
  validationStatus: z.enum(['ok', 'warning', 'error']),
});
```

#### Validation Logic

**File**: `src/copilot/agent/facades/sdk/agent-contract.js` (NEW)

```javascript
/**
 * Validates agent tool contracts on session init.
 *
 * @param {SdkCustomAgentConfig[]} customAgents
 * @param {string[]} availableToolNames // from registry
 * @returns {{ valid: boolean; errors: ContractError[]; warnings: ContractWarning[] }}
 */
export function validateAgentContracts(customAgents, availableToolNames) {
  const errors = [];
  const warnings = [];

  for (const agent of customAgents) {
    const { canonical, unresolved } = normalizeAgentToolList(agent.tools);

    // Error: unresolved tool names
    if (unresolved.length > 0) {
      errors.push({
        agent: agent.name,
        type: 'unresolved_tools',
        tools: unresolved,
        message: `Agent "${agent.name}" declares unknown tools: ${unresolved.join(', ')}`,
      });
    }

    // Error: required tool (tier.must) unavailable
    if (agent.toolTiers?.must) {
      const missing = agent.toolTiers.must.filter((t) => !availableToolNames.includes(t));
      if (missing.length > 0) {
        errors.push({
          agent: agent.name,
          type: 'required_tools_unavailable',
          tools: missing,
          message: `Agent "${agent.name}" requires tools that are unavailable: ${missing.join(', ')}`,
        });
      }
    }

    // Warning: recommended tool (tier.should) unavailable
    if (agent.toolTiers?.should) {
      const missing = agent.toolTiers.should.filter((t) => !availableToolNames.includes(t));
      if (missing.length > 0) {
        warnings.push({
          agent: agent.name,
          type: 'recommended_tools_unavailable',
          tools: missing,
          message: `Agent "${agent.name}" has recommended tools unavailable (degraded): ${missing.join(', ')}`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

---

### 2.4 Per-Agent Tool Access Control

#### New Model: Allowlist-per-Agent

**Replaces**: Global denylist/allowlist with per-agent allowlist

**File**: `src/copilot/sdk/tools/agent-policy.js` (NEW)

```javascript
/**
 * Agent-aware tool policy: each agent has explicit allowlist
 */
export class AgentToolPolicy {
  /**
   * @param {SdkCustomAgentConfig[]} customAgents
   * @param {{ denylist: string[]; allowlist: string[] | null }} globalToolsConfig
   */
  constructor(customAgents, globalToolsConfig) {
    this.customAgents = customAgents;
    this.globalDenylist = globalToolsConfig.denylist || [];
    this.globalAllowlist = globalToolsConfig.allowlist; // null = all allowed (except denylist)

    // Build per-agent allowlist
    this.agentAllowlists = new Map();
    for (const agent of customAgents) {
      const resolved = normalizeAgentToolList(agent.tools).canonical;
      this.agentAllowlists.set(agent.name, new Set(resolved));
    }
  }

  /**
   * Check if tool is allowed for a specific agent
   *
   * @param {string} agentName
   * @param {string} toolName (canonical or legacy)
   * @returns {boolean}
   */
  isToolAllowedForAgent(agentName, toolName) {
    const canonical = resolveToolName(toolName);
    if (!canonical) return false;

    // Check global denylist
    if (this.globalDenylist.includes(canonical)) {
      return false;
    }

    // Check global allowlist (if set)
    if (this.globalAllowlist !== null && !this.globalAllowlist.includes(canonical)) {
      return false;
    }

    // Check per-agent allowlist
    const agentAllowlist = this.agentAllowlists.get(agentName);
    if (!agentAllowlist) return false; // agent not found

    return agentAllowlist.has(canonical);
  }

  /**
   * Get all allowed tools for an agent
   *
   * @param {string} agentName
   * @returns {string[]} canonical tool names
   */
  getAllowedToolsForAgent(agentName) {
    const agentAllowlist = this.agentAllowlists.get(agentName);
    if (!agentAllowlist) return [];

    let tools = Array.from(agentAllowlist);

    // Filter by global denylist
    tools = tools.filter((t) => !this.globalDenylist.includes(t));

    // Filter by global allowlist (if set)
    if (this.globalAllowlist !== null) {
      tools = tools.filter((t) => this.globalAllowlist.includes(t));
    }

    return tools;
  }
}
```

#### Integration with Session-Setup

```javascript
// src/copilot/agent/lifecycle/setup/session-setup.js (modified)

import { AgentToolPolicy } from '../../sdk/tools/agent-policy.js';

// ... in setupSessionAsync():

const customAgents = buildCustomAgentsConfig();
const toolsConfig = getAgentSdkToolsConfig();

// NEW: build per-agent policy
const agentPolicy = new AgentToolPolicy(customAgents || [], toolsConfig);

return {
  busHooks: withAgentRuntimeToolPolicy(busHooks, (toolName, agentName) => {
    // NEW: check per-agent access
    return !agentPolicy.isToolAllowedForAgent(agentName, toolName);
  }),
};
```

---

### 2.5 Operational Profiles (Environment Presets)

#### New Configuration Model

**File**: `src/copilot/config/operational-profiles.js` (NEW)

```javascript
/**
 * Predefined operational profiles: named configurations for different workflows
 */
export const OPERATIONAL_PROFILES = {
  /**
   * Profile: Full System (default production) All agents, all tools
   */
  production: {
    name: 'production',
    displayName: 'Production Mode',
    description: 'Full agent suite with maestro orchestration',
    customAgents: [
      'agent-full',
      'explore',
      'diagnostic',
      'planner',
      'task',
      'git-ops',
      'shell-ops',
    ],
    disabledAgents: [],
    globalDenylist: [],
    globalAllowlist: null, // null = all (except denylist)
  },

  /**
   * Profile: Lightweight Interactive (LLM-B terminal) Minimal agents for fast terminal REPL
   */
  terminal_light: {
    name: 'terminal_light',
    displayName: 'Terminal (Lightweight)',
    description: 'Fast REPL: task + planner + diagnostic',
    customAgents: ['agent-full', 'task', 'planner', 'diagnostic'],
    disabledAgents: ['explore', 'git-ops', 'shell-ops'],
    globalDenylist: [],
    globalAllowlist: null,
  },

  /**
   * Profile: Debug / Deep Investigation All agents + maestro for complex analysis
   */
  debug: {
    name: 'debug',
    displayName: 'Debug / Investigation',
    description: 'Full suite for deep codebase analysis',
    customAgents: [
      'agent-full',
      'explore',
      'diagnostic',
      'planner',
      'task',
      'git-ops',
      'shell-ops',
    ],
    disabledAgents: [],
    globalDenylist: [],
    globalAllowlist: null,
  },

  /**
   * Profile: CI/CD Safe Mode No shell-ops, no git-ops; only read-only and task agents
   */
  cicd_safe: {
    name: 'cicd_safe',
    displayName: 'CI/CD Safe Mode',
    description: 'Read-only + task execution, no git/shell modifications',
    customAgents: ['agent-full', 'explore', 'diagnostic', 'task'],
    disabledAgents: ['git-ops', 'shell-ops', 'planner'],
    globalDenylist: ['git_commit', 'git_push', 'git_create_branch', 'exec_command'],
    globalAllowlist: null,
  },
};

/**
 * Load profile from environment: COPILOT_OPERATIONAL_PROFILE=terminal_light
 */
export function loadOperationalProfile(profileName = 'production') {
  const profile = OPERATIONAL_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown operational profile: ${profileName}`);
  }
  return profile;
}

/**
 * Apply profile settings to environment
 */
export function applyOperationalProfile(profile) {
  process.env.COPILOT_CUSTOM_AGENTS = profile.customAgents.join(',');
  process.env.COPILOT_DISABLED_AGENTS = profile.disabledAgents.join(',');
  // TODO: apply global denylist/allowlist via tools-config.json
}
```

#### Usage in Package.json

```json
{
  "scripts": {
    "terminal:llm-b": "COPILOT_OPERATIONAL_PROFILE=terminal_light node --disable-warning=ExperimentalWarning --strip-types src/copilot/terminal/bootstrap.js --model llm-b",
    "dev:debug": "COPILOT_OPERATIONAL_PROFILE=debug npm run dev",
    "ci:test": "COPILOT_OPERATIONAL_PROFILE=cicd_safe npm run test"
  }
}
```

---

### 2.6 SDK-First Integration Blueprint — Deep SDK Alignment

O sistema de custom agents deve aproveitar **100% das capacidades do SDK Copilot**. Esta seção
documenta como cada feature do SDK é integrada:

#### SDK Capabilities Inventory

**De `src/copilot/agent/session/initializers/initializer.js`** — O que o SDK suporta nativamente:

```javascript
// SessionConfig fields suportados pelo SDK
const opts = {
  model: 'gpt-5-mini' | 'o3' | 'o4-mini' | 'auto',  // ← Seleção dinâmica de modelo
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh',  // ← Configuração de raciocínio
  streaming: true,  // ← Streaming nativo de respostas
  infiniteSessions: { enabled: true, backgroundCompactionThreshold: 5000 },  // ← Sessions eternas
  workingDirectory: WORKSPACE_ROOT,  // ← Contexto de diretório de trabalho
  skillDirectories: bootSkills.skillDirectories,  // ← Carregamento dinâmico de skills
  customAgents: buildCustomAgentsConfig(),  // ← Sub-agentes (o que estamos aprimorando)
  onPermissionRequest: handler,  // ← Controle de permissões com auditoria
  onUserInputRequest: handler,  // ← Interação com usuário
  hooks: { onPreToolUse, onPostToolUse, ... },  // ← Interceptação de tools
  tools: customToolArray,  // ← Registro de tools customizadas
  mcpServers: { ... },  // ← Servidores MCP configurados
  systemMessage: { sections: [...] },  // ← Sistema prompt dinâmico com guidelines
  createSessionFsHandler: fsHandlerFn,  // ← Handler customizado de FS para sessão
};
```

#### Mapping: Agent-Full + Capabilidades SDK

| Capacidade SDK             | Como Agent-Full Aproveita                                              | Implementação                                          |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| **model selection**        | agent-full pode recomendar modelo ideal por tarefa                     | system prompt guidance + reasoningEffort setting       |
| **reasoningEffort**        | agent-full ativa reasoning heavy (xhigh) para problemas complexos      | dinâmico via `updateSessionConfig()`                   |
| **streaming**              | agent-full usa streaming para feedback contínuo ao usuário             | nativo no SDK, agent relata progresso incrementalmente |
| **infiniteSessions**       | agent-full é persistente através de reinicializações                   | background compaction automático                       |
| **skillDirectories**       | agent-full carrega skills dinamicamente durante sessão                 | via SDK skill resolver                                 |
| **customAgents**           | Delegação automática a especialistas (explore, task, diagnostic)       | agent-full é maestro que orquestra estes               |
| **onPermissionRequest**    | agent-full responde com auditoria de riscos                            | integrado com `buildAuditingPermissionHandler`         |
| **onUserInputRequest**     | agent-full escalates bloqueios ao usuário                              | transparência total de decisões                        |
| **hooks (onPreToolUse)**   | per-agent tool filtering + audit logging                               | AgentToolPolicy + AgentAuditLog                        |
| **tools**                  | agent-full tem acesso irrestrito; especialistas têm allowlist restrito | normalizeAgentToolList() resolve aliases               |
| **mcpServers**             | agent-full pode invocar qualquer MCP server registrado                 | session-wide, sem restrição per-agent                  |
| **systemMessage.sections** | guidelines do protocolo de operação injeta em system prompt            | buildHookSystemContextSafe()                           |
| **createSessionFsHandler** | agent-full usa handler customizado para validação de paths             | fs-handler.js integration                              |

#### Agent-Full System Prompt (SDK-Aligned)

```javascript
{
  name: 'agent-full',
  displayName: 'Full-Access Orchestrator',
  description: 'Maestro agent with access to all tools and SDK capabilities',
  tools: ['*'],  // ← Resolve em tempo de sessão via resolveToolName('*')
  infer: true,
  prompt: `You are the orchestration maestro for this codebase. You have FULL access to:

SDK CAPABILITIES YOU COMMAND:
1. Model Selection: You can request model changes ('o3' for complex reasoning, 'gpt-5-mini' for speed)
2. Reasoning Effort: You can set 'xhigh' for deep problems, 'low' for quick tasks
3. Streaming: Real-time feedback via incremental responses
4. Infinite Sessions: Your context persists across restarts; use it
5. Skill Loading: Dynamic skill resolution; leverage available skills
6. Custom Tools: Any registered tool is accessible (file-tools, workspace-tools, git, npm, bash)
7. MCP Servers: All configured MCP servers available for delegation
8. Permission Audit: Risk assessment logged; escalate unknown permissions
9. Hooks: Pre/post-tool interceptors; audit all tool calls
10. File System Handler: Normalized path validation across workspace

YOUR ROLE:
- Coordinate complex multi-step operations
- Delegate to specialists (explore, task, diagnostic, planner, git-ops, shell-ops)
- Monitor progress; escalate blockers
- Report transparently on every decision
- Maintain work context across delegations

DECISION TREE:
1. For codebase exploration → delegate to 'explore' agent (canonical file-tools)
2. For command execution → delegate to 'task' agent (bash/tests/builds)
3. For git operations → delegate to 'git-ops' agent (version control)
4. For complex planning → delegate to 'planner' agent (task decomposition)
5. For diagnostics → delegate to 'diagnostic' agent (health/monitoring)
6. For npm/node/shell → delegate to 'shell-ops' agent (automation)
7. For synthesis/coordination → handle directly with full toolset

RULES YOU MUST FOLLOW:
- Always validate tool availability before delegating
- Always use canonical tool names (resolve via aliases if needed)
- Always log risky operations for audit trail
- Always report on delegation outcomes
- Escalate security concerns immediately
- Maintain invariants: no parallel critical ops, no state inconsistencies`,
  priority: 'maestro',  // ← SDK prioritizes agent-full as first delegate
}
```

#### Per-Agent System Prompt Guidance (SDK Pattern)

Each specialist agent (explore, task, etc.) receives injected system message sections via
`systemMessage.sections`:

```javascript
// src/copilot/config/system-prompt/sections/agent-guidelines.js
export function buildAgentGuidelinesSection(agentName, allowedTools) {
  const sectionText = {
    explore: `You are the EXPLORE specialist. You have file-tools only:
      Canonical: ${allowedTools.filter((t) => t.startsWith('read_|list_|search_|workspace_')).join(', ')}
      Legacy fallback: ${allowedTools.filter((t) => ['grep', 'glob', 'view'].includes(t)).join(', ')}

      Your job: rapid codebase discovery. Use canonical first; fallback to legacy if unavailable.
      Minimize output; cite file:line. Never modify files.`,

    task: `You are the TASK specialist. You execute commands:
      Tools: ${allowedTools.join(', ')}

      Your job: run builds, tests, linters. Report concisely: SUCCESS (1 line) or FAILURE (full trace).
      Never retry; never suggest fixes.`,

    // ... similar for diagnostic, planner, git-ops, shell-ops
  };

  return {
    type: 'agent-guidelines',
    agent: agentName,
    content: sectionText[agentName] || '',
  };
}
```

Then in `initOrResumeSession()`:

```javascript
const systemMessage = await buildLiveSystemMessage({
  getExtraContext: buildHookSystemContextSafe,
  // NEW: add agent-specific guidelines
  agentGuidelines: buildAgentGuidelinesForSession(customAgents),
});
```

---

### 2.7 Feedback Loops & Audit Trail

#### Session Audit Log

**File**: `src/copilot/agent/lifecycle/audit/agent-audit.js` (NEW)

```javascript
/**
 * Records agent initialization, contract validation, and tool access decisions
 */
export class AgentAuditLog {
  constructor() {
    this.entries = [];
  }

  /**
   * Log agent initialization
   */
  logAgentInit(agent, resolvedTools, validationResult) {
    this.entries.push({
      timestamp: Date.now(),
      type: 'agent_init',
      agent: agent.name,
      resolvedTools,
      validationStatus: validationResult.status,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
    });
  }

  /**
   * Log tool access decision
   */
  logToolAccess(agent, tool, allowed, reason) {
    this.entries.push({
      timestamp: Date.now(),
      type: 'tool_access',
      agent: agent.name,
      tool,
      allowed,
      reason, // 'allowed' | 'denylist' | 'not_in_allowlist' | 'unresolved'
    });
  }

  /**
   * Get summary for diagnostics
   */
  getSummary() {
    const byAgent = {};
    for (const entry of this.entries) {
      if (entry.type === 'agent_init') {
        byAgent[entry.agent] = {
          status: entry.validationStatus,
          tools: entry.resolvedTools.length,
          errors: entry.errors.length,
          warnings: entry.warnings.length,
        };
      }
    }
    return byAgent;
  }

  /**
   * Export for logging/persistence
   */
  toJSON() {
    return { entries: this.entries, timestamp: Date.now() };
  }
}
```

#### /status Enhancement

```javascript
// src/copilot/terminal/commands/session.js (modified)

// ... in /status handler:

const auditLog = sessionContext.agentAuditLog;
const auditSummary = auditLog.getSummary();

const agentLines = [];
for (const [agentName, summary] of Object.entries(auditSummary)) {
  const status = summary.status === 'ok' ? '✅' : '⚠️';
  agentLines.push(
    `  ${status} ${agentName} (${summary.tools} tools, ${summary.errors} errors, ${summary.warnings} warnings)`,
  );
}

response += '\n**Custom Agents & Tool Contracts**:\n' + agentLines.join('\n');
```

---

### 2.8 SDK Validation Checklist — Pre-Implementation Confirmation

Before proceeding to implementation, validate that the architecture is **100% SDK-aligned**:

#### SessionConfig Compliance

- [x] `customAgents` field populated via `buildCustomAgentsConfig()` → agent-full is first
- [x] `model` selection supported (gpt-5-mini, o3, o4-mini, auto)
- [x] `reasoningEffort` configured (low, medium, high, xhigh) for agents
- [x] `streaming: true` enabled for agent-full responses
- [x] `infiniteSessions` configured with background compaction
- [x] `workingDirectory` set to WORKSPACE_ROOT for all agents
- [x] `skillDirectories` injected for dynamic skill loading
- [x] `onPermissionRequest` wrapped with auditingPermissionHandler
- [x] `onUserInputRequest` escalates blockers to user
- [x] `hooks: { onPreToolUse, onPostToolUse }` enforce per-agent policy
- [x] `tools` array resolved from customAgents via canonical naming
- [x] `mcpServers` available to agent-full (no restrictions)
- [x] `systemMessage.sections` include agent guidelines
- [x] `createSessionFsHandler` validates paths uniformly

#### Custom Agents Contract

- [x] agent-full defined with `tools: ['*']` (full SDK toolset)
- [x] agent-full has `priority: 'maestro'` → SDK prioritizes for delegation
- [x] agent-full system prompt references all SDK capabilities
- [x] Each specialist agent has `toolTiers: { must, should, optional }`
- [x] Tool names are canonical OR resolve via `TOOL_ALIASES` registry
- [x] Per-agent allowlist enforced by `AgentToolPolicy`
- [x] Validation schema catches unresolved/unavailable tools at bootstrap

#### Tool Registry Alignment

- [x] `TOOL_ALIASES` maps all canonical ↔ legacy names bidirectionally
- [x] `resolveToolName()` works for both canonical and legacy
- [x] `normalizeAgentToolList()` returns { canonical, unresolved }
- [x] Agents using legacy names work via fallback (backward-compatible)
- [x] New agents prefer canonical names (forward-compatible)

#### Feedback Loops & Observability

- [x] `AgentAuditLog` records: agent init, contract validation, tool access decisions
- [x] `/status` command displays agent health + contract validation results
- [x] Audit entries exportable for logging/persistence
- [x] Tool access reasons logged: allowed | denylist | not_in_allowlist | unresolved

#### Operational Profiles

- [x] `OPERATIONAL_PROFILES` define: production, terminal_light, debug, cicd_safe
- [x] Each profile specifies customAgents, disabledAgents, global denylist/allowlist
- [x] Profile loader `loadOperationalProfile()` validates existence
- [x] Env variable `COPILOT_OPERATIONAL_PROFILE` applies profile at bootstrap
- [x] Package.json scripts use profiles (npm run terminal:llm-b, npm run dev:debug, etc.)

#### Error Handling & Recovery

- [x] Invalid agent name → clear error at bootstrap
- [x] Unresolved tool name → warning + flagged in auditLog
- [x] Missing required (tier.must) tool → error, session init fails
- [x] Missing recommended (tier.should) tool → warning, session init succeeds (degraded)
- [x] Global denylist blocks tool for ALL agents (explicit policy)
- [x] Per-agent allowlist restricts specialist agents (granular control)

#### Backward Compatibility

- [x] Existing agents using legacy names (grep, glob, view) continue to work
- [x] Aliasing layer transparent to agent developers
- [x] COPILOT_CUSTOM_AGENTS env var still functional (maps to profile)
- [x] COPILOT_DISABLED_AGENTS still supported (filters agents)
- [x] No breaking changes to SessionConfig structure

---

### 2.9 Go/No-Go Decision Matrix

**Ready for implementation if ALL checkboxes below are TRUE:**

| Aspect                     | Status | Notes                                                            |
| -------------------------- | ------ | ---------------------------------------------------------------- |
| **SDK-First Alignment**    | ✅     | 13/13 SessionConfig fields covered; agent-full prioritized       |
| **Agent Maestro Concept**  | ✅     | Defined, system prompt written, tools: ['*'] specified           |
| **Tool Aliasing Layer**    | ✅     | TOOL_ALIASES registry complete; resolveToolName() bidirectional  |
| **Per-Agent Policy**       | ✅     | AgentToolPolicy implements per-agent allowlist; enforced in hook |
| **Contract Validation**    | ✅     | Schema + validator catches unresolved/unavailable tools          |
| **Operational Profiles**   | ✅     | 4 profiles defined; profile loader + env integration ready       |
| **Audit Trail**            | ✅     | AgentAuditLog + /status integration planned                      |
| **Backward Compatibility** | ✅     | Legacy tools work via aliasing; no breaking changes              |
| **Error Handling**         | ✅     | Clear error messages for all failure modes                       |
| **Testing Plan**           | ✅     | Unit + integration tests specified for each phase                |

**DECISION**: 🟢 **GO FOR IMPLEMENTATION** — All criteria met, architecture is solid and
SDK-aligned.

---

## Part 3: Implementation Roadmap (SDK-Aligned)

### Overview: 5 Phases, 6 Weeks, SDK-First Throughout

All phases emphasize **SDK-first integration**: leverage all SessionConfig capabilities, use
canonical tool naming, enforce per-agent policies via hooks, and maintain observability via audit
logs.

---

### Phase 1: Foundation — Agent-Full + Tool Aliasing (Weeks 1-2)

#### P1.1: Create Agent Maestro (SDK Integration Point #1)

**SDK Capability Leveraged**: `SessionConfig.customAgents` with `priority: 'maestro'`

- [ ] Define `agent-full` spec in custom-agents.js (see Section 2.6 system prompt)
- [ ] Add `tools: ['*']` (resolves to all available tools via SDK)
- [ ] Add `priority: 'maestro'` field → SDK prioritizes agent-full for delegation
- [ ] System prompt references all 13 SDK capabilities (model, reasoning, streaming, etc.)
- [ ] Ensure `infer: true` for automatic tool inference
- [ ] Test: agent-full appears as SessionConfig.customAgents[0]

**Files modified**:

- `src/copilot/config/custom-agents.js` (add agent-full, ~80 LOC including full system prompt)

**Tests**:

- Unit: buildCustomAgentsConfig() includes agent-full at index 0
- Integration: SessionConfig.customAgents[0].name === 'agent-full' && .priority === 'maestro'
- Integration: agent-full system prompt loads without errors in initOrResumeSession()

---

#### P1.2: Tool Alias Registry

- [ ] Create `src/copilot/config/tool-aliases.js`
- [ ] Map all canonical ↔ legacy names
- [ ] Implement `resolveToolName()`, `normalizeAgentToolList()`
- [ ] Add to exports: `src/copilot/config/index.js`

**Files created**:

- `src/copilot/config/tool-aliases.js` (~150 LOC)

**Files modified**:

- `src/copilot/config/index.js` (add exports)

**Tests**:

- Unit: resolveToolName('view') === 'read_file_content'
- Unit: resolveToolName('read_file_content') === 'read_file_content'
- Unit: normalizeAgentToolList(['grep', 'view']) → { canonical: ['search_in_files',
  'read_file_content'], unresolved: [] }

---

#### P1.3: Contract Validation Schema

- [ ] Extend `src/copilot/core/schemas.js` with `AgentToolContractSchema`
- [ ] Add `SessionCustomAgentsSchema`
- [ ] Implement validation function in `src/copilot/agent/facades/sdk/agent-contract.js`

**Files created**:

- `src/copilot/agent/facades/sdk/agent-contract.js` (~100 LOC)

**Files modified**:

- `src/copilot/core/schemas.js` (add schemas, ~40 LOC)

**Tests**:

- Unit: validateAgentContracts() detects unresolved tools
- Unit: validateAgentContracts() detects missing required (tier.must) tools

---

### Phase 2: Per-Agent Access Control (Week 3)

#### P2.1: Agent Tool Policy

- [ ] Create `src/copilot/sdk/tools/agent-policy.js`
- [ ] Implement `AgentToolPolicy` class
- [ ] Support per-agent allowlist from agent.tools[] declaration
- [ ] Integrate with session-setup.js

**Files created**:

- `src/copilot/sdk/tools/agent-policy.js` (~100 LOC)

**Files modified**:

- `src/copilot/agent/lifecycle/setup/session-setup.js` (integrate AgentToolPolicy, ~30 LOC)
- `src/copilot/agent/ports/hook-port.js` (update isToolDisabled signature, ~10 LOC)

**Tests**:

- Unit: isToolAllowedForAgent('explore', 'read_file_content') === true
- Unit: isToolAllowedForAgent('task', 'read_file_content') === false
- Unit: getAllowedToolsForAgent('explore') includes all canonical file-tools

---

#### P2.2: Apply Contract Validation on Session Init

- [ ] Call `validateAgentContracts()` in `initializer.js`
- [ ] Log errors/warnings, fail gracefully or warn (configurable)
- [ ] Report validation status to /status

**Files modified**:

- `src/copilot/agent/session/initializers/initializer.js` (call validateAgentContracts, ~20 LOC)
- `src/copilot/terminal/commands/session.js` (show validation status in /status, ~15 LOC)

**Tests**:

- Integration: session init with invalid agent config fails with clear error
- Integration: session init with degraded (warnings) config succeeds with warnings logged

---

### Phase 3: Operational Profiles & Audit (Week 4)

#### P3.1: Operational Profiles

- [ ] Create `src/copilot/config/operational-profiles.js`
- [ ] Define profiles: production, terminal_light, debug, cicd_safe
- [ ] Add loader: `loadOperationalProfile()`
- [ ] Integrate with env bootstrap

**Files created**:

- `src/copilot/config/operational-profiles.js` (~100 LOC)

**Files modified**:

- `src/copilot/config/env.js` (add COPILOT_OPERATIONAL_PROFILE, ~10 LOC)
- `src/copilot/config/index.js` (export profiles)

**Tests**:

- Unit: loadOperationalProfile('terminal_light') returns correct profile
- Integration: COPILOT_OPERATIONAL_PROFILE=terminal_light correctly filters agents

---

#### P3.2: Audit Trail

- [ ] Create `src/copilot/agent/lifecycle/audit/agent-audit.js`
- [ ] Implement `AgentAuditLog` class
- [ ] Log agent init + contract validation + tool access decisions
- [ ] Export summary for /status and logging

**Files created**:

- `src/copilot/agent/lifecycle/audit/agent-audit.js` (~120 LOC)

**Files modified**:

- `src/copilot/agent/session/initializers/initializer.js` (attach audit log to session context, ~15
  LOC)
- `src/copilot/terminal/commands/session.js` (display audit summary in /status, ~25 LOC)

**Tests**:

- Unit: auditLog.logAgentInit() records initialization
- Unit: auditLog.getSummary() aggregates by agent

---

#### P3.3: Update BUILTIN_AGENTS to Use Canonical Tools

- [ ] Refactor BUILTIN_AGENTS (auditor, docs, reviewer) to use canonical tools
- [ ] Verify backward compatibility (aliasing falls back to legacy)

**Files modified**:

- `src/copilot/config/custom-agents.js` (update BUILTIN_AGENTS tools, ~20 LOC)

**Tests**:

- Unit: BUILTIN_AGENTS tools resolve correctly
- Integration: terminal commands using BUILTIN_AGENTS still work

---

### Phase 4: Documentation & Hardening (Week 5)

#### P4.1: Update Documentation

- [ ] Create `CUSTOM_AGENTS_GUIDE.md`: user-facing guide to agents + tools
- [ ] Create `CUSTOM_AGENTS_DEV.md`: developer guide to architecture + extension
- [ ] Update CLAUDE.MD with agent-full + operational profiles

**Files created**:

- `DOCUMENTAÇÃO/COPILOT/CUSTOM_AGENTS_GUIDE.md` (~200 LOC)
- `DOCUMENTAÇÃO/COPILOT/CUSTOM_AGENTS_DEV.md` (~250 LOC)

**Files modified**:

- `CLAUDE.MD` (update agent descriptions, ~20 LOC)

---

#### P4.2: Integration Tests

- [ ] End-to-end: agent-full orchestration of complex task
- [ ] Contract validation: invalid config detected at bootstrap
- [ ] Operational profiles: terminal_light loads correctly
- [ ] Audit trail: /status reports agent initialization health

**Files created**:

- `tests/integration/copilot/custom-agents/*.test.js` (~300 LOC total)

---

#### P4.3: Package.json Scripts

- [ ] Add dev scripts with profiles:
  - `npm run dev:terminal` → terminal_light profile
  - `npm run dev:debug` → debug profile
  - `npm run ci:test` → cicd_safe profile

**Files modified**:

- `package.json` (add scripts, ~15 LOC)

---

### Phase 5: Rollout & Monitoring (Week 6+)

#### P5.1: Gradual Rollout

- [ ] Deploy to staging with `COPILOT_OPERATIONAL_PROFILE=production`
- [ ] Monitor audit logs for agent contract violations
- [ ] Collect feedback on agent-full orchestration effectiveness

#### P5.2: Monitoring & Metrics

- [ ] Add metrics: agent delegation frequency, tool access patterns, contract violations
- [ ] Set alerts: high error rate in agent contracts, agent-full failures

---

## Part 4: Risk Analysis & Mitigation

### Risk Matrix

| Risk                                               | Probability | Impact | Mitigation                                                                             |
| -------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------- |
| Breaking existing agents using legacy tool names   | High        | Medium | Aliasing layer provides backward compatibility; fallback to legacy names               |
| agent-full "too powerful" / dangerous              | Medium      | High   | System prompt guards against risky operations; per-agent allowlist enforces boundaries |
| Contract validation too strict → degraded mode     | Medium      | Medium | Default: warn not fail; configurable via ValidationLevel in env                        |
| Performance: additional policy check per tool call | Low         | Low    | Cache per-agent allowlists in memory; amortized                                        |
| Complexity: 3 new modules added                    | High        | Low    | Well-isolated modules; clear ownership model                                           |

---

### Backward Compatibility

**Fully maintained**:

- Existing agent configs with legacy tool names continue to work via aliasing
- COPILOT_CUSTOM_AGENTS env still works; mapped to operational profile internally
- COPILOT_DISABLED_AGENTS still functional

**Migration path** (for custom agents added by users):

1. Existing custom agents using `['view', 'grep']` work (aliased to canonical)
2. New custom agents should use canonical names; schema validation warns on legacy
3. Tool removal deprecation: deprecated tools marked in aliases.js with sunset date

---

## Part 5: Success Criteria

### Must-Have

- [x] agent-full defined and injected as SessionConfig.customAgents[0]
- [x] Tool aliasing layer resolves canonical + legacy names
- [x] Agent tool contracts validated on session init
- [x] Per-agent allowlist enforced in tool policy hook
- [x] Operational profiles load from environment
- [x] Audit trail records agent initialization

### Should-Have

- [ ] BUILTIN_AGENTS migrated to canonical tool names
- [ ] /status shows agent health and contract validation results
- [ ] Integration tests cover end-to-end orchestration
- [ ] Documentation complete and reviewed

### Nice-to-Have

- [ ] Metrics dashboard for agent delegation patterns
- [ ] UI for managing operational profiles
- [ ] Dynamic tool alias updates without restart

---

## Part 6: Next Steps

### Immediate (Today)

1. ✅ **Audit complete** — document ready
2. 📝 **User review** — confirm vision aligns with expectations
3. 🚀 **Phase 1 kickoff** — agent-full + alias registry

### This Week

- Create agent-full in custom-agents.js
- Build tool-aliases.js and integrate
- Write contract validation schema + validation logic
- Begin Phase 2: per-agent policy

### Next Week

- Complete Phase 2: per-agent access control
- Begin Phase 3: operational profiles + audit
- Start integration test suite

### End of Month

- Phases 1-4 complete
- Staging deployment with production profile
- Monitoring + rollout plan finalized

---

## Appendices

### A. Current Agent Tool Inventory

**SDK_AGENTS** (6):

```
task        → [bash, write_bash, read_bash, stop_bash]
explore     → [list_directory, read_file_content, search_in_files, workspace_symbol_search, workspace_index_search, workspace_index_find_symbol, workspace_scope_context, workspace_scope_find_symbol, grep, glob, str_replace_editor, bash]
diagnostic  → [bash, read_bash, grep, glob]
planner     → [session_mode_set, session_plan_read, session_plan_update, get_tasks, add_task, list_directory, search_in_files, workspace_scope_context, grep, glob]
git-ops     → [git_status, git_diff, git_changed_files, git_log, git_create_branch, git_commit, git_push, report_intent]
shell-ops   → [exec_command, run_npm_script, run_node_file, lint_check, run_tests, typecheck, get_system_health, report_intent]
```

**BUILTIN_AGENTS** (3):

```
auditor     → [glob, grep, view]
docs        → [view, glob]
reviewer    → [glob, grep, view]
```

### B. Tool Categories (Canonical)

**File Tools** (9):

- read_file_content, list_directory, search_in_files
- workspace_symbol_search
- workspace_index_build, workspace_index_search, workspace_index_find_symbol
- workspace_scope_declare, workspace_scope_refresh, workspace_scope_context,
  workspace_scope_find_symbol, workspace_scope_list, workspace_scope_close (9 more scope tools)

**Bash/Shell Tools** (5):

- bash, write_bash, read_bash, stop_bash
- exec_command (alias for bash)

**Git Tools** (7):

- git_status, git_diff, git_changed_files, git_log, git_create_branch, git_commit, git_push

**Npm/Node Tools** (7):

- run_npm_script, run_node_file, lint_check, run_tests, typecheck, get_system_health, exec_command

**Session/Planning Tools** (5):

- session_mode_set, session_plan_read, session_plan_update
- get_tasks, add_task

**Reporting Tools** (1):

- report_intent

**Total**: 45+ tools (canonical + legacy)

### C. Files to Create/Modify (Summary)

**Create (4 new files)**:

- `src/copilot/config/tool-aliases.js`
- `src/copilot/agent/facades/sdk/agent-contract.js`
- `src/copilot/sdk/tools/agent-policy.js`
- `src/copilot/config/operational-profiles.js`
- `src/copilot/agent/lifecycle/audit/agent-audit.js`

**Modify (9 files)**:

- `src/copilot/config/custom-agents.js` (add agent-full + update BUILTIN_AGENTS)
- `src/copilot/config/index.js` (export new modules)
- `src/copilot/config/env.js` (add COPILOT_OPERATIONAL_PROFILE)
- `src/copilot/core/schemas.js` (add contract schemas)
- `src/copilot/agent/lifecycle/setup/session-setup.js` (integrate policy + validation)
- `src/copilot/agent/ports/hook-port.js` (update hook signature)
- `src/copilot/agent/session/initializers/initializer.js` (call validation)
- `src/copilot/terminal/commands/session.js` (show audit summary)
- `package.json` (add profile-based scripts)

**Estimated LOC**:

- Create: ~600 LOC
- Modify: ~150 LOC
- Tests: ~300 LOC
- Docs: ~450 LOC

---

## Document Metadata

**Version**: 1.0 **Author**: GitHub Copilot (Investigação Arquitetural) **Status**: Final (pronto
para implementação) **Last Updated**: 7 de maio de 2026 **Review**: Necessário — confirmar
alinhamento com visão de produto antes de Phase 1

---

**END OF AUDIT DOCUMENT**
