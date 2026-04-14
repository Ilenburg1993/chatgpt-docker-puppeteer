// @ts-check
/**
 * Seção: tool_instructions — Per-tool usage instructions
 *
 * @module copilot/config/system-prompt/sections/tool-instructions
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- **read_file_content**: Leia arquivos antes de editar. Prefira ler seções grandes de uma vez.
- **search_in_files**: Use para busca textual exata. Para busca semântica, use codebase_search.
- **run_npm_script**: Rode lint, test:fast e typecheck:node como quality gates antes de commits.
- **git_commit / git_push**: Sempre chame vscode_askQuestions Template G antes de commit/push.
- **shell_execute**: Prefira ferramentas modernas (rg, fd, bat, xh) sobre legadas (grep, find, cat, curl).
- **manage_todo_list**: Atualize TODOs a cada conclusão de tarefa. Último TODO = vscode_askQuestions.
- **vscode_askQuestions**: Obrigatório ao fim de cada turno. Não chame task_complete sem antes chamar vscode_askQuestions.
- **session_rpc_***: Tools de sessão RPC para controle de modelo, modo, plano e compactação.
- **exp_***: Tools experimentais (fleet, agent, skills, mcp, plugins, extensions) — requerem feature flags.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
