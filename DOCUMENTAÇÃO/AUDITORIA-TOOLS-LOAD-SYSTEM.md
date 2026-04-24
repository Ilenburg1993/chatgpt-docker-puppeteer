# Auditoria: Tools Loading System

**Data**: 24 de abril de 2026  
**Scope**: `src/copilot/tools/` (34 arquivos, 388KB)  
**Metodologia**: Manual semantic audit + code inspection (sem ferramentas automáticas)  
**Classificação**: PROFUNDA

---

## PARTE 1 — ACHADOS (Issues & Gaps)

### 🔴 CRÍTICO (C1) — Bootstrap sem Error Handling

**Arquivo**: `src/copilot/tools/bootstrap.js` (linhas 59-135)  
**Função**: `bootstrapTools(registry, mcpTools)`  
**Problema**: Nenhum try-catch envolvendo as chamadas para `registerTools()`. Se uma ferramenta falhar durante registro (ex: Zod schema inválido em `tool-factory.js`), a exceção não é tratada e deruba a inicialização de sessão.

**Evidência**:
```js
// Linhas 91-101: registerTools chamadas sem proteção
for (const [tools, opts] of TOOL_GROUPS) {
    registerTools(registry, tools, opts);  // ← Sem try-catch
}

if (mcpTools.length > 0) {
    registerTools(registry, mcpTools, { category: 'mcp', tags: ['mcp', 'external'] });  // ← Sem proteção
}

const customTools = buildCustomTools();
if (customTools.length > 0) {
    registerTools(registry, customTools, { category: 'custom', tags: ['runtime', 'declarative'] });  // ← Sem proteção
}
```

**Cenário de Falha**:
1. Um arquivo de tool contém schema Zod inválido
2. `tool-factory.js` lança exceção em `normalizeParameters()`
3. `bootstrapTools()` propaga a exceção sem contexto
4. Sessão falha a iniciar — agente fica inoperável

**Severidade**: CRÍTICO (resulta em falha de sessão)  
**Correção**: Envolver cada `registerTools()` com try-catch granular, logging de erro e fallback (toolParcial ou skip com aviso).

---

### 🔴 CRÍTICO (C2) — Tool Interception NOT Implemented

**Arquivo**: `src/copilot/tools/introspection-tools.js` (linhas 25-37)  
**Código**:
```js
/**
 * GAP-TOOLS-004: Set de tools desabilitadas em runtime. O agente pode desabilitar/habilitar tools durante a sessão via
 * toggle_tool. O tool-interceptor consulta isToolDisabled() para bloquear chamadas a tools desabilitadas.
 */
const _disabledTools = new Set();
```

**Problema**: O comentário menciona "tool-interceptor" que deveria bloquear chamadas a tools desabilitadas. Este interceptor **não existe** no codebase. Resultado: `isToolDisabled()` retorna true/false, mas nada impede que o agente chame a tool desabilitada.

**Evidência**: Busca por "tool-interceptor", "intercept", "disabled" em `src/copilot/` não retorna implementação real.

**Cenário de Falha**:
1. Agente desabilita a tool `exec_command` via `toggle_tool`
2. `_disabledTools.add('exec_command')`
3. Agente tenta chamar `exec_command` novamente
4. Nenhum bloqueio ocorre — tool é executada apesar de desabilitada
5. Política de segurança violada

**Severidade**: CRÍTICO (falha de segurança — bypass possível)  
**Correção**: Implementar interceptor em `src/copilot/sdk/` ou wrapper em `bootstrap.js` que bloqueia tools desabilitadas antes da invocação.

---

### 🟡 ALTO (H1) — Schema Zod Conversion Fragile

**Arquivo**: `src/copilot/tools/tool-factory.js` (linhas 103-115)  
**Função**: `normalizeParameters(parameters, toolName)`  
**Problema**: Detecção de instância Zod via `'_def' in parameters || '_zod' in parameters` é frágil. Se Zod muda internamente novamente (v5+), o detectador quebra.

**Evidência**:
```js
if ('_def' in parameters || '_zod' in parameters) {
    try {
        return zodToJsonSchema(...);
    } catch (err) {
        const message = /** @type {Error} */ (err).message;
        log('WARN', `[tool-factory] Falha ao converter Zod schema: ${message}`);
        throw new Error(`[tool-factory] Schema inválido para tool '${toolName}': ${message}`);
    }
}
```

**Problema adicional**: A exceção é relançada, que deruba o `bootstrapTools()` (veja C1).

**Severidade**: ALTO (fragilidade + cascata de falha)  
**Correção**: 
1. Usar `instanceof ZodType` + `package.json` version check para Zod
2. Não relançar exceção; logar e retornar schema vazio (permitindo tool sem parâmetros)
3. Implementar fallback em `bootstrapTools()` (C1)

---

### 🟡 ALTO (H2) — Categories Hardcoded in CATEGORY_TOOL_MAP

**Arquivo**: `src/copilot/tools/introspection-tools.js` (linhas 60-70)  
**Código**:
```js
const CATEGORY_TOOL_MAP = Object.freeze({
    code: ['lint_check', 'run_tests', 'typecheck'],
    git: ['git_status', 'git_diff', 'git_commit', 'git_changed_files'],
    session: ['read_briefing', 'write_pending_task'],
    task: ['get_tasks', 'add_task', 'get_session_state', 'get_system_health'],
    hook: ['hook_get_audit_tail', 'request_user_input', 'hook_get_pending_tasks'],
    introspection: ['list_tools', 'get_agent_info', 'get_telemetry'],
});
```

**Problema**: Categorias precisam ser atualizadas manualmente quando novas tools são adicionadas. Existe um TODO:
```js
// TODO(RF-026): derivar categorias do ToolRegistry para evitar manutenção manual.
```

**Cenário de Falha**:
1. Uma tool nova `workspace_symbol_search` é adicionada à categoria `file`
2. `bootstrap.js` registra a tool com categoria `file`
3. `CATEGORY_TOOL_MAP` não é atualizado
4. Filtrar por categoria `file` em `list_tools` retorna lista incompleta ou vazia
5. Agente não descobre a nova tool via `list_tools`

**Severidade**: ALTO (manutenibilidade + runtime discovery fraco)  
**Correção**: Derivar categorias dinamicamente do `ToolRegistry` passado via `registerForIntrospection()`. Manter `CATEGORY_TOOL_MAP` como fallback apenas.

---

### 🟡 ALTO (H3) — Lazy Initialization Race Condition

**Arquivo**: `src/copilot/tools/index.js` (linhas 111-127)  
**Código**:
```js
let _allToolsCache;

export function getAllTools() {
    if (!_allToolsCache) {
        _allToolsCache = [
            ...taskTools,
            ...codeTools,
            ...gitTools,
            // ... 14 mais
        ];
    }
    return _allToolsCache;
}
```

**Problema**: Se `getAllTools()` for chamado simultaneamente (ex: dois `await` sem `await` intermediário), pode haver race condition. Embora não provável em prática (JS é single-threaded), o padrão é fragile.

**Agravante**: A importação de `taskTools`, `codeTools` etc. pode ter circular dependencies. O lazy cache tenta evitar isso, mas é um hack.

**Severidade**: ALTO (design fragile, difícil de debugar)  
**Correção**: Usar inicialização estática com top-level `await` ou module-level function call. Evitar lazy patterns.

---

### 🟠 MÉDIO (M1) — Missing Validation in registerForIntrospection

**Arquivo**: `src/copilot/tools/introspection-tools.js` (linhas 52-56)  
**Código**:
```js
export function registerForIntrospection(tools) {
    _registeredTools = tools;
    log('DEBUG', `[introspection] ${tools.length} tools registradas para introspecção.`);
}
```

**Problema**: Nenhuma validação de que `tools` é um array válido. Se `bootstrapTools()` passa `null`, `undefined`, ou um objeto sem `.length`, o código quebra silenciosamente.

**Cenário**:
1. Erro em `bootstrapTools()` causa `null` ser retornado
2. `registerForIntrospection(null)` é chamado
3. `_registeredTools = null`
4. `list_tools` falha com `null.filter is not a function`

**Severidade**: MÉDIO (erro runtime obscuro)  
**Correção**: Validar tipo + logar aviso se array vazio.

---

### 🟠 MÉDIO (M2) — Symbol Tools Registration Gap

**Arquivo**: `src/copilot/tools/file/symbol-search-tool.js` (novo — Phase 4)  
**Problema**: A nova tool `workspace_symbol_search` foi adicionada e exportada de `file/index.js`, mas **não está registrada em `bootstrap.js`**. As tools de arquivo estão em `fileReadTools` + `fileWriteTools`, mas `symbolSearchTools` não está incluso no TOOL_GROUPS.

**Evidência**: 
```js
// bootstrap.js — TOOL_GROUPS não inclui symbolSearchTools:
[fileReadTools, { category: 'file', tags: ['filesystem', 'io', 'read'], readOnly: true }],
[fileWriteTools, { category: 'file', tags: ['filesystem', 'io', 'write'] }],

// Mas fileReadTools já inclui symbolSearchTools:
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    listDirectoryTool,
    searchInFilesTool,
    diffFilesTool,
    withSkipPermission(workspaceSymbolSearchTool),  // ← Incluído aqui
];
```

**Impacto**: A tool está registrada, mas não está listada em `list_tools` se filtrar por categoria='file' (devido ao M2 anterior).

**Severidade**: MÉDIO (tool funciona mas discovery fraco)  
**Correção**: Garantir que `symbolSearchTools` está em `fileReadTools` (já está), e/ou adicionar método explícito de registro em bootstrap.

---

### 🟠 MÉDIO (M3) — Metrics Injection Missing Validation

**Arquivo**: `src/copilot/tools/metrics-proxy.js` (não lido, presumido)  
**Padrão**: Assim como `setToolsLogger()`, há setters para `setToolsMetrics()`. Se métricas não forem injetadas, `recordToolCall()` pode falhar silenciosamente.

**Severidade**: MÉDIO (telemetria fraca)  
**Correção**: Validar injeção + fallback.

---

### 🔵 BAIXO (L1) — Logger Fallback Too Silent

**Arquivo**: `src/copilot/tools/logger.js` (linhas 38-64)  
**Código**:
```js
case 'DEBUG':
    // Supress em produção sem logger injetado
    break;
```

**Problema**: DEBUG logs são completamente suprimidos se logger não está injetado. Dificulta debugging em desenvolvimento.

**Severidade**: BAIXO (QoL)  
**Correção**: Logar DEBUG via `console.debug` mesmo sem logger injetado.

---

## PARTE 2 — UPGRADES (Recomendações Estruturais)

### UPG-1: Implementar Tool Registry Introspection

**Proposta**: Passar `ToolRegistry` para `registerForIntrospection()` para que as categorias sejam derivadas dinamicamente.

**Benefício**: Elimina CATEGORY_TOOL_MAP hardcoded; resolve H2 + M2.

**Impacto**: Médio refactor; sem breaking changes.

---

### UPG-2: Granular Bootstrap Error Handling

**Proposta**: Envolver cada categoria de tools com try-catch em `bootstrapTools()`. Se falhar:
1. Logar erro com detalhe
2. Registrar ferramenta "dummy" que retorna erro
3. Continuar com próxima categoria
4. Retornar status de "partial bootstrap" para agente diagnosticar

**Benefício**: Resolve C1; permite bootstrap robusto mesmo com tool quebrada.

**Impacto**: Refactor em bootstrap.js; pequeno overhead.

---

### UPG-3: Implement Tool Interception Middleware

**Proposta**: Adicionar middleware em `sdk/` que intercepta invocações de tool e verifica `isToolDisabled()`.

**Benefício**: Resolve C2; implementa a segurança desabilitada de tools.

**Impacto**: Novo módulo + integração em SDK; significante.

---

### UPG-4: Version-Agnostic Zod Detection

**Proposta**: Usar `typeof parameters?.constructor?.name` ou versão check de `package.json` em vez de `_def` / `_zod`.

**Benefício**: Resolve H1; futureproof.

**Impacto**: Pequeno refactor em tool-factory.js.

---

### UPG-5: Static Initialization Instead of Lazy

**Proposta**: Mover `getAllTools()` para static initialization com top-level `await` ou IIFE.

**Benefício**: Resolve H3; código mais limpo.

**Impacto**: Refactor em index.js; pode exigir ajustes em module loading.

---

### UPG-6: Input Validation in registerForIntrospection

**Proposta**: Adicionar validação de tipo + schema em `registerForIntrospection()`.

**Benefício**: Resolve M1; erros mais cedo.

**Impacto**: Minimal (2-3 linhas).

---

### UPG-7: Explicit Symbol Tools Registration

**Proposta**: Adicionar `symbolSearchTools` como categoria explícita em `bootstrap.js` ou verificar se está presente em fileReadTools.

**Benefício**: Resolve M2; melhor explicitness.

**Impacto**: Minimal (1-2 linhas).

---

## PARTE 3 — Resumo Executivo

| Severidade | Qtd | Descrição                                          |
| ---------- | --- | -------------------------------------------------- |
| 🔴 Crítico | 2   | C1: Bootstrap sem erro handling C2: Tool interception não implementado |
| 🟡 Alto    | 3   | H1: Zod detection frágil H2: Categories hardcoded H3: Race condition |
| 🟠 Médio   | 3   | M1: registerForIntrospection sem validação M2: Symbol tools gap M3: Metrics fallback fraco |
| 🔵 Baixo   | 1   | L1: Logger DEBUG suppressed                        |

**Recomendação**: Executar C1 + C2 + H2 como prioridade; depois H1, H3, M1.

