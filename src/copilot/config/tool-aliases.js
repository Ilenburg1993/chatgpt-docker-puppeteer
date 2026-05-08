// @ts-check
/**
 * src/copilot/config/tool-aliases.js
 *
 * Registro unificado de aliases de tools: mapeamento nome canônico ↔ nome legado.
 *
 * Este módulo fornece resolução bidirecional entre nomes canônicos alinhados ao SDK moderno e nomes legados ainda
 * referenciados por agentes antigos.
 *
 * **Nomes canônicos** seguem as convenções do SDK: read_file_content, list_directory etc. **Nomes legados** são aliases
 * históricos: view, glob, grep.
 *
 * Centralizar esse mapeamento permite:
 *
 * - Agentes declararem tools usando nomes canônicos ou legados, com compatibilidade retroativa.
 * - A inicialização de sessão normalizar todas as listas de tools para a forma canônica.
 * - Relatórios claros quando uma tool não puder ser resolvida.
 *
 * @module copilot/config/tool-aliases
 */

/**
 * Registro de aliases de tools: mapeia nomes canônicos para aliases legados.
 *
 * Estrutura: canônico → [legado_1, legado_2, ...]
 *
 * @type {Record<string, string[]>}
 */
export const TOOL_ALIASES = {
    // Wildcard usado pelo custom agent SDK com acesso total. Ele é resolvido contra o registry vivo de tools durante a
    // inicialização da sessão; fora desse contexto, continua sendo uma declaração simbólica válida.
    '*': [],

    // Tools de arquivos e diretórios
    read_file_content: ['view'],
    list_directory: ['glob'],
    search_in_files: ['grep'],
    create_file: ['create'],

    // Tools de workspace
    workspace_symbol_search: [],
    workspace_index_build: [],
    workspace_index_status: [],
    workspace_index_search: [],
    workspace_index_find_symbol: [],
    workspace_scope_declare: [],
    workspace_scope_refresh: [],
    workspace_scope_context: [],
    workspace_scope_find_symbol: [],
    workspace_scope_list: [],
    workspace_scope_close: [],

    // Tools de shell/comandos
    exec_command: ['bash', 'write_bash', 'read_bash', 'stop_bash'],
    run_npm_script: [],
    run_node_file: [],

    // Tools de Git
    git_status: [],
    git_diff: [],
    git_changed_files: [],
    git_log: [],
    git_create_branch: [],
    git_commit: [],
    git_push: [],

    // Tools de sessão/planejamento
    session_mode_set: [],
    session_plan_read: [],
    session_plan_update: [],
    get_tasks: [],
    add_task: [],

    // Tools de diagnóstico/sistema
    lint_check: [],
    run_tests: [],
    typecheck: [],
    get_system_health: [],

    // Tools utilitárias
    patch_file: ['str_replace_editor', 'edit'],
    diff_files: [],
    toggle_tool: [],
    list_available_tools: [],
    report_intent_local: ['report_intent'],
};

/**
 * Resolve qualquer nome de tool (canônico ou legado) para sua forma canônica.
 *
 * Se a entrada já for canônica, retorna a própria entrada. Se for um alias legado, retorna o nome canônico. Se não for
 * reconhecida, retorna null.
 *
 * @example
 *     resolveToolName('read_file_content'); // → 'read_file_content'
 *     resolveToolName('view'); // → 'read_file_content'
 *     resolveToolName('unknown_tool'); // → null
 *
 * @param {string} toolName - Tool name (canonical or legacy)
 * @returns {string | null} Canonical tool name, or null if unresolved
 */
export function resolveToolName(toolName) {
    // Já é canônico.
    if (toolName in TOOL_ALIASES) {
        return toolName;
    }

    // Busca mapeamento legado → canônico.
    for (const [canonical, legacyNames] of Object.entries(TOOL_ALIASES)) {
        if (legacyNames.includes(toolName)) {
            return canonical;
        }
    }

    // Não resolvido.
    return null;
}

/**
 * Retorna todos os nomes válidos (canônico + aliases legados) de uma tool.
 *
 * Se a entrada for canônica, retorna [canônico, ...aliasesLegados]. Se a entrada for legada, resolve primeiro para o
 * nome canônico e depois retorna todos os nomes. Se não resolver, retorna array vazio.
 *
 * @example
 *     getAllToolNames('read_file_content'); // → ['read_file_content', 'view']
 *     getAllToolNames('view'); // → ['read_file_content', 'view']
 *     getAllToolNames('unknown'); // → []
 *
 * @param {string} toolName - Tool name (canonical or legacy)
 * @returns {string[]} All valid names for this tool
 */
export function getAllToolNames(toolName) {
    const canonical = resolveToolName(toolName);
    if (!canonical) {
        return [];
    }
    const legacyAliases = TOOL_ALIASES[canonical] || [];
    return [canonical, ...legacyAliases];
}

/**
 * Normaliza a lista de tools de um agente: converte todos os nomes legados para a forma canônica.
 *
 * Retorna objeto com:
 *
 * - canonical: array de nomes canônicos resolvidos, deduplicados e ordenados
 * - unresolved: array de nomes que não puderam ser resolvidos
 *
 * Usado durante a inicialização da sessão para validar declarações de tools dos agentes.
 *
 * @example
 *     normalizeAgentToolList(['view', 'grep', 'bash']);
 *     // → { canonical: ['bash', 'read_file_content', 'search_in_files'], unresolved: [] }
 *
 *     normalizeAgentToolList(['view', 'unknown_tool']);
 *     // → { canonical: ['read_file_content'], unresolved: ['unknown_tool'] }
 *
 * @param {string[]} toolNames - Tool names (mix of canonical and legacy)
 * @returns {{ canonical: string[]; unresolved: string[] }} Normalized result
 */
export function normalizeAgentToolList(toolNames) {
    const canonical = new Set();
    const unresolved = [];

    for (const toolName of toolNames) {
        const resolved = resolveToolName(toolName);
        if (resolved) {
            canonical.add(resolved);
        } else {
            unresolved.push(toolName);
        }
    }

    return {
        canonical: Array.from(canonical).sort(),
        unresolved,
    };
}
