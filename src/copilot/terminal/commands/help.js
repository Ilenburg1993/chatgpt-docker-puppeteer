// @ts-check
/**
 * src/copilot/terminal/commands/help.js
 *
 * Comando /help do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands/help
 * @see EventBus
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
  \x1b[33m/status\x1b[0m                              — status do agente + modelo + reasoning + binding/frescor do prompt
  \x1b[33m/now\x1b[0m                                 — snapshot operacional curto (loop/ask/model mismatch)
  \x1b[33m/live [n]\x1b[0m                             — fluxo live: loop, streaming, SSE, tools, arquivos e I/O real
  \x1b[33m/activity [n]\x1b[0m                        — atividade atual da LLM-B + timeline recente
  \x1b[33m/history [n]\x1b[0m                         — últimos N turnos em memória
  \x1b[33m/db-history [n]\x1b[0m                      — últimos N turnos (SQLite)
  \x1b[33m/db-sessions [n]\x1b[0m                     — últimas N sessões hub
  \x1b[33m/who\x1b[0m                                 — atores e canais ativos
  \x1b[33m/count\x1b[0m                               — estatísticas da sessão
  \x1b[33m/clear\x1b[0m                               — limpa histórico em memória
  \x1b[33m/clear-shadow\x1b[0m                        — limpa shadow persistida de ask_user restaurada do disco
  \x1b[33m/restart\x1b[0m                             — reinicia dialog loop
  \x1b[33m/emergency-reset\x1b[0m (\x1b[33m/ereset\x1b[0m)            — limpa rate limiters + reinicia loop
  \x1b[33m/quit\x1b[0m / \x1b[33m/exit\x1b[0m                         — encerra terminal

  \x1b[1mConfiguração do Modelo\x1b[0m
  \x1b[33m/model\x1b[0m                               — exibe modelo ativo
  \x1b[33m/model list\x1b[0m                          — lista modelos disponíveis (via SDK)
  \x1b[33m/model <id>\x1b[0m                          — troca modelo (ex: /model gpt-5-mini)
  \x1b[33m/reasoning\x1b[0m                           — exibe nível de raciocínio atual
  \x1b[33m/reasoning low|medium|high|xhigh|off\x1b[0m — altera reasoning effort

  \x1b[1mContexto e Arquivos\x1b[0m
  \x1b[33m/attach\x1b[0m                              — lista fila de arquivos agendados para embed
  \x1b[33m/attach <caminho>\x1b[0m                    — adiciona arquivo à fila (embed no próximo turno)
  \x1b[33m/attach clear\x1b[0m                        — limpa fila de attachments
  \x1b[33m@<caminho>\x1b[0m (inline)                  — embed automático: @src/foo.js no texto da mensagem
  \x1b[33m/context\x1b[0m                             — estima uso atual de tokens da sessão
  \x1b[33m/compact\x1b[0m                             — compacta histórico em resumo técnico denso
  \x1b[33m/plan [on|off|autopilot|read|clear]\x1b[0m — controla o mode/plan vanilla da sessão SDK
  \x1b[33m/thinking [on|off]\x1b[0m                   — toggle da expansão ao vivo do thinking/reasoning
  \x1b[33m/thinking list [n]\x1b[0m                  — lista thinkings capturados (colapsados)
  \x1b[33m/thinking show <id>|latest\x1b[0m          — abre thinking completo capturado
  \x1b[33m/usage [on|off|now]\x1b[0m                  — toggle usage pós-turno ou snapshot instantâneo
  \x1b[33m/tools\x1b[0m                               — lista ferramentas observadas com stats
  \x1b[33m/sdk [status|models|tools|quota|prompt|capabilities|waits|compact]\x1b[0m — catálogo/quota/capabilities/ops SDK via Agent
  \x1b[33m/workspace [list|read|write|sync|mirror|promote]\x1b[0m — workspace SDK + convergência SDK↔FS auditável
  \x1b[33m/fs [list|read|search|create|write]\x1b[0m   — filesystem local canônico via file-tools
  \x1b[33m/elicitation [list|show|request]\x1b[0m      — formulários/URL estruturados do SDK
  \x1b[33m/permission [list|all|show|clear|mode|respond]\x1b[0m — permissões SDK observadas + governança + resposta manual
  \x1b[33m/errors [n]\x1b[0m                          — mostra últimos N erros rastreados (default: 10)
  \x1b[33m/audit [n]\x1b[0m                           — últimas N entradas do audit log (default: 10)
  \x1b[33m/display [toggle] [on|off]\x1b[0m           — gerencia toggles de exibição (thinking, streaming, usage, tools, intent)
  \x1b[33m/display preset <default|minimal|verbose|debug|focus>\x1b[0m — aplica presets de UX
  \x1b[33m/display theme <elegant|vivid|mono>\x1b[0m — ajusta paleta visual (sóbria, contraste alto, sem cor)
  \x1b[33m/display detail <compact|detailed>\x1b[0m — define densidade textual da UX live
  \x1b[33m/menu [n|id|run n]\x1b[0m                  — command palette inteligente (pseudo-botões/dropdown no terminal)
  \x1b[33m/metrics\x1b[0m                             — métricas consolidadas da sessão (turns, tokens, billing, inject/prompt)
  \x1b[33m/export [path]\x1b[0m                       — exporta conversa como Markdown
  \x1b[33m/resume\x1b[0m                              — lista últimas sessões do hub (para retomar)
  \x1b[33m/resume <sessionId>\x1b[0m                  — injeta resumo de sessão anterior como contexto

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
