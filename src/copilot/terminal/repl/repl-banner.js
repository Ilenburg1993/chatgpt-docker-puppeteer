// @ts-check
/**
 * @module copilot/terminal/repl-banner
 * @file Banner operacional do REPL LLM-B.
 */

import { terminalThemeDivider, terminalThemeHeadline, terminalThemeJoin, terminalThemeText } from '../state/repl/index.js';

/**
 * @param {string} command
 * @returns {string}
 */
function command(command) {
    return terminalThemeText('command', command);
}

/**
 * @param {string[]} commands
 * @returns {string}
 */
function commandList(commands) {
    return terminalThemeJoin(commands.map(command));
}

/**
 * @param {string} label
 * @param {string[]} commands
 * @param {string | null} [hint=null] Default is `null`
 * @returns {string}
 */
function bannerGroup(label, commands, hint = null) {
    return `  ${terminalThemeText('muted', label.padEnd(13))} ${commandList(commands)}${hint ? `  ${terminalThemeText('muted', hint)}` : ''}`;
}

/**
 * @param {number} injectPort
 * @returns {string}
 */
export function buildTerminalReplBanner(injectPort) {
    if (process.env['COPILOT_TERMINAL_BOOT_MENU'] === 'full') {
        return buildTerminalReplFullBanner(injectPort);
    }
    return `
${terminalThemeDivider(62)}
${terminalThemeHeadline('assistant', 'Terminal LLM-B', ['sessão permanente'])}
${terminalThemeDivider(62)}
  ${commandList(['/status', '/now', '/menu', '/activity 10', '/help'])}
  ${terminalThemeText('muted', 'texto livre → fila zero-PR · /turn <msg> abre turno · @arquivo anexa contexto')}
  ${terminalThemeText('muted', `HTTP :${injectPort} · /inject · /events · /sessions · diagnóstico: /health /tools`)}
`;
}

/**
 * @param {number} injectPort
 * @returns {string}
 */
function buildTerminalReplFullBanner(injectPort) {
    return `
${terminalThemeDivider(74)}
${terminalThemeHeadline('assistant', 'Terminal LLM-B', ['sessão permanente', 'menu completo'])}
${terminalThemeDivider(74)}
${bannerGroup('Essenciais', ['/status', '/health', '/now', '/live [n]', '/activity [n]', '/help'])}
${bannerGroup('Sessão', ['/history [n]', '/db-history [n] [offset]', '/db-sessions [n]', '/who', '/restart'])}
${bannerGroup('Modelo', ['/model [list|id]', '/reasoning [low|medium|high|xhigh|off]', '/count'])}
${bannerGroup('Contexto', ['/attach [path|blob|clear]', '/context', '/compact', '/plan [on|off|autopilot|read|clear]', '/resume [id]'])}
${bannerGroup('Fluxo', ['/pause', '/dialog-resume [bootPrompt]', '/handoff', '/queue <msg>', '/turn <msg>', '/mailbox [status|consume|clear]'])}
${bannerGroup('Observação', ['/thinking [on|off]', '/intent [n]', '/usage [on|off|now]', '/tools', '/errors [n]', '/events [n|sources]', '/audit [n]'])}
${bannerGroup('SDK/FS', ['/sdk [status|models|tools|quota|prompt|capabilities|waits|compact]', '/workspace [list|read|write|sync|mirror|promote]', '/fs [list|read|search|create|write]'])}
${bannerGroup('Índice', ['/scope [list|declare|find]', '/index [status|build|search|symbol]', '/elicitation', '/permission [mode|respond]'])}
${bannerGroup('Preferências', ['/display [toggle] [on|off]', '/metrics', '/export [path]', '/skills [list|add <path>|remove <path>|reload]'])}
${bannerGroup('Memória', ['/remember [tag:] texto', '/recall [tag]', '/recall ?busca', '/forget <id>'])}
${bannerGroup('Git/GitHub', ['/gh issue list', '/gh pr list', '/gh run list', '/git status', '/git log', '/alias'])}
  ${terminalThemeText('muted', `HTTP local   POST :${injectPort}/inject · POST :${injectPort}/pipeline · GET :${injectPort}/events · GET :${injectPort}/sessions · POST/GET/DELETE :${injectPort}/memory`)}
  ${terminalThemeText('muted', `Integrações  GET :${injectPort}/gh/issues · GET :${injectPort}/gh/prs · GET :${injectPort}/gh/ci · GET :${injectPort}/git/status · GET :${injectPort}/git/log`)}
  ${terminalThemeText('muted', `Diagnóstico  GET :${injectPort}/config · GET :${injectPort}/health · @caminho/arquivo anexa contexto`)}
`;
}
