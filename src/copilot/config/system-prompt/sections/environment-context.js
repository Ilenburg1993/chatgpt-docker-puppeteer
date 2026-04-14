// @ts-check
/**
 * Seção: environment_context — CWD, OS, git root, directory listing, available tools
 *
 * @module copilot/config/system-prompt/sections/environment-context
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
Ambiente: DevContainer Debian 12, Node.js v24.x, VS Code Copilot Chat.
Workspace: /workspaces/chatgpt-docker-puppeteer
Estrutura: src/core/, src/nerv/, src/kernel/, src/orchestrator/, src/agent/, src/driver/, src/infra/, src/server/, src/missions/
Ferramentas CLI disponíveis: rg, fd, bat, delta, gh, jq, yq, sd, dust, xh, shellcheck, hyperfine.
Scripts npm: lint, format:check, test:unit, test:fast, typecheck:node, audit:quick, analyze:deps, diagnose, health:core.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('@github/copilot-sdk').SectionOverrideAction}
 */
export const ACTION = 'replace';
