// @ts-check
/**
 * src/copilot/terminal/commands/help.js
 *
 * Comando /help do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands/help
 */

/**
 * @typedef {object} SessionContext
 * @property {number} injectPort
 * @property {(text: string) => void} println
 */

/**
 * Exibe ajuda completa dos comandos do terminal.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdHelp({ injectPort, println }) {
    println(`
  \x1b[36m╔═══════════════════════ Terminal LLM-B — Ajuda ═══════════════════════╗\x1b[0m

  \x1b[1mComandos de Sessão\x1b[0m
  \x1b[33m/status\x1b[0m                              — status do agente LLM-B
  \x1b[33m/history [n]\x1b[0m                         — últimos N turnos em memória
  \x1b[33m/db-history [n]\x1b[0m                      — últimos N turnos (SQLite)
  \x1b[33m/db-sessions [n]\x1b[0m                     — últimas N sessões hub
  \x1b[33m/who\x1b[0m                                 — atores e canais ativos
  \x1b[33m/count\x1b[0m                               — estatísticas da sessão
  \x1b[33m/clear\x1b[0m                               — limpa histórico em memória
  \x1b[33m/restart\x1b[0m                             — reinicia dialog loop
  \x1b[33m/quit\x1b[0m / \x1b[33m/exit\x1b[0m                         — encerra terminal

  \x1b[1mMemória Semântica\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m               — persiste memória
  \x1b[33m/recall [tag]\x1b[0m                        — recupera por tag
  \x1b[33m/recall ?busca\x1b[0m                       — busca full-text
  \x1b[33m/forget <id>\x1b[0m                         — remove memória por ID

  \x1b[1mGitHub CLI (/gh)\x1b[0m
  \x1b[33m/gh issue list [open|closed|all] [label]\x1b[0m  — lista issues
  \x1b[33m/gh issue <n>\x1b[0m                             — detalhe de issue
  \x1b[33m/gh issue create <título>\x1b[0m                 — criar issue
  \x1b[33m/gh issue close <n>\x1b[0m                       — fechar issue
  \x1b[33m/gh issue comment <n> <txt>\x1b[0m               — comentar issue
  \x1b[33m/gh pr list [open|closed|merged]\x1b[0m          — lista PRs
  \x1b[33m/gh pr <n>\x1b[0m                                — detalhe de PR
  \x1b[33m/gh pr diff <n>\x1b[0m                           — diff de PR
  \x1b[33m/gh run list [limit]\x1b[0m                      — lista CI runs
  \x1b[33m/gh run <id>\x1b[0m                              — detalhe de run
  \x1b[33m/gh release list\x1b[0m                          — lista releases
  \x1b[33m/gh search <query>\x1b[0m                        — buscar issues/prs
  \x1b[33m/gh status\x1b[0m                                — status da conta GitHub
  \x1b[33m/gh api <endpoint>\x1b[0m                        — chamada raw à API

  \x1b[1mGit CLI (/git)\x1b[0m
  \x1b[33m/git status\x1b[0m                          — status working tree (alias: /st, /gst)
  \x1b[33m/git log [n] [--oneline]\x1b[0m             — log de commits (alias: /log, /glog)
  \x1b[33m/git diff [--staged] [file]\x1b[0m          — diff (alias: /diff)
  \x1b[33m/git branch\x1b[0m                          — branches
  \x1b[33m/git pull\x1b[0m                            — git pull
  \x1b[33m/git stash [list|pop|drop]\x1b[0m           — stash

  \x1b[1mAliases\x1b[0m
  \x1b[33m/alias\x1b[0m / \x1b[33m/alias list\x1b[0m                — listar aliases
  \x1b[33m/alias set <nome> <cmd>\x1b[0m              — criar alias
  \x1b[33m/alias remove <nome>\x1b[0m                 — remover alias

  \x1b[1mHTTP Endpoints\x1b[0m  \x1b[90m(porta ${injectPort})\x1b[0m
  \x1b[33mPOST /inject\x1b[0m  \x1b[33mPOST /pipeline\x1b[0m  \x1b[33mGET /events\x1b[0m
  \x1b[33mGET /sessions\x1b[0m  \x1b[33mPOST|GET|DELETE /memory\x1b[0m
  \x1b[33mGET /gh/issues\x1b[0m  \x1b[33mGET /gh/prs\x1b[0m  \x1b[33mGET /gh/ci\x1b[0m
  \x1b[33mGET /git/status\x1b[0m  \x1b[33mGET /git/log\x1b[0m

  \x1b[90mDigite qualquer coisa sem /  para enviar mensagem à LLM-B\x1b[0m
  \x1b[36m╚═══════════════════════════════════════════════════════════════════════╝\x1b[0m
`);
}
