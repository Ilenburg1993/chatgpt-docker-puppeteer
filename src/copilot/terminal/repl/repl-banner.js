// @ts-check
/**
 * @module copilot/terminal/repl-banner
 * @file Banner operacional do REPL LLM-B.
 */

/**
 * @param {number} injectPort
 * @returns {string}
 */
export function buildTerminalReplBanner(injectPort) {
    if (process.env['COPILOT_TERMINAL_BOOT_MENU'] === 'full') {
        return buildTerminalReplFullBanner(injectPort);
    }
    return `
\x1b[36m┌──────────────────────────────────────────────────────────────┐\x1b[0m
\x1b[36m│\x1b[0m  \x1b[1mTerminal LLM-B\x1b[0m  \x1b[90m· sessão permanente\x1b[0m                         \x1b[36m│\x1b[0m
\x1b[36m└──────────────────────────────────────────────────────────────┘\x1b[0m
  \x1b[33m/status\x1b[0m · \x1b[33m/health\x1b[0m · \x1b[33m/now\x1b[0m · \x1b[33m/activity 10\x1b[0m · \x1b[33m/tools\x1b[0m · \x1b[33m/events 20\x1b[0m · \x1b[33m/help\x1b[0m
  \x1b[90mturno explícito: /turn <msg> · fila zero-PR: /queue <msg> · menu completo: /help\x1b[0m
  \x1b[90mHTTP :${injectPort} · /inject · /events · /sessions · @caminho/arquivo para anexar\x1b[0m
`;
}

/**
 * @param {number} injectPort
 * @returns {string}
 */
function buildTerminalReplFullBanner(injectPort) {
    return `
\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m  💬  \x1b[1mTerminal LLM-B\x1b[0m  \x1b[90m—\x1b[0m  Sessão Permanente                            \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m
    \x1b[33m/status\x1b[0m · \x1b[33m/health\x1b[0m · \x1b[33m/now\x1b[0m · \x1b[33m/live [n]\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n] [offset]\x1b[0m · \x1b[33m/db-sessions [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/restart\x1b[0m
    \x1b[33m/activity [n]\x1b[0m \x1b[90m← atividade atual + timeline\x1b[0m · \x1b[33m/live [n]\x1b[0m \x1b[90m← loop/stream/SSE/tools/I-O\x1b[0m
  \x1b[33m/model [list|id]\x1b[0m · \x1b[33m/reasoning [low|medium|high|xhigh|off]\x1b[0m · \x1b[33m/count\x1b[0m
    \x1b[33m/attach [path|blob|clear]\x1b[0m · \x1b[33m/context\x1b[0m · \x1b[33m/compact\x1b[0m · \x1b[33m/plan [on|off|autopilot|read|clear]\x1b[0m · \x1b[33m/resume [id]\x1b[0m
  \x1b[33m/pause\x1b[0m · \x1b[33m/dialog-resume [bootPrompt]\x1b[0m · \x1b[33m/handoff\x1b[0m \x1b[90m← pausa/retoma/handoff\x1b[0m
  \x1b[33m/queue <msg>\x1b[0m · \x1b[33m/turn <msg>\x1b[0m · \x1b[33m/mailbox [status|consume|clear]\x1b[0m \x1b[90m← zero-PR vs turno explícito\x1b[0m
  \x1b[33m/thinking [on|off]\x1b[0m · \x1b[33m/intent [n]\x1b[0m · \x1b[33m/usage [on|off|now]\x1b[0m \x1b[90m← thinking, intent e usage\x1b[0m
  \x1b[33m/tools\x1b[0m · \x1b[33m/errors [n]\x1b[0m · \x1b[33m/events [n|sources]\x1b[0m · \x1b[33m/audit [n]\x1b[0m \x1b[90m← tools, erros, SSE e fontes\x1b[0m
  \x1b[33m/sdk [status|models|tools|quota|prompt|capabilities|waits|compact]\x1b[0m · \x1b[33m/workspace [list|read|write|sync|mirror|promote]\x1b[0m · \x1b[33m/fs [list|read|search|create|write]\x1b[0m · \x1b[33m/scope [list|declare|find]\x1b[0m · \x1b[33m/index [status|build|search|symbol]\x1b[0m · \x1b[33m/elicitation\x1b[0m · \x1b[33m/permission [mode|respond]\x1b[0m
  \x1b[33m/display [toggle] [on|off]\x1b[0m · \x1b[33m/metrics\x1b[0m · \x1b[33m/export [path]\x1b[0m \x1b[90m← F24: display, metrics, export\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m · \x1b[33m/recall [tag]\x1b[0m · \x1b[33m/recall ?busca\x1b[0m · \x1b[33m/forget <id>\x1b[0m
  \x1b[33m/skills [list|add <path>|remove <path>|reload]\x1b[0m
  \x1b[36m/gh issue list\x1b[0m · \x1b[36m/gh pr list\x1b[0m · \x1b[36m/gh run list\x1b[0m · \x1b[36m/git status\x1b[0m · \x1b[36m/git log\x1b[0m · \x1b[36m/alias\x1b[0m · \x1b[36m/help\x1b[0m
  \x1b[90mPOST :${injectPort}/inject  ·  POST :${injectPort}/pipeline  ·  GET :${injectPort}/events  ·  GET :${injectPort}/sessions  ·  POST/GET/DELETE :${injectPort}/memory\x1b[0m
  \x1b[90mGET :${injectPort}/gh/issues  ·  GET :${injectPort}/gh/prs  ·  GET :${injectPort}/gh/ci  ·  GET :${injectPort}/git/status  ·  GET :${injectPort}/git/log\x1b[0m
  \x1b[90mGET :${injectPort}/config  ·  GET :${injectPort}/health  |  @caminho/arquivo → embed automático\x1b[0m
`;
}
