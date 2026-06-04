// @ts-check
/**
 * src/copilot/terminal/commands/help.js
 *
 * Comando /help do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands/help
 * @see EventBus
 */

import { terminalThemeDivider, terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/ui/index.js';

/**
 * @typedef {object} SessionContext
 * @property {number} injectPort
 * @property {(text: string) => void} println
 */

/**
 * @param {string} value
 * @returns {string}
 */
function command(value) {
    return terminalThemeText('command', value);
}

/**
 * @typedef {{ command: string; description: string }} HelpCommand
 */

/**
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapHelpText(text, width) {
    /** @type {string[]} */
    const lines = [];
    let current = '';
    for (const word of text.split(/\s+/u).filter(Boolean)) {
        const next = current ? `${current} ${word}` : word;
        if (next.length <= width) {
            current = next;
            continue;
        }
        if (current) lines.push(current);
        current = word;
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

/**
 * @param {(text: string) => void} println
 * @param {string} title
 * @param {HelpCommand[]} rows
 * @returns {void}
 */
function renderHelpSection(println, title, rows) {
    const commandWidth = 48;
    const descriptionWidth = 66;
    const descriptionIndent = '  ' + ' '.repeat(commandWidth);
    println('');
    println(terminalThemeHeadline('assistant', title, [`${rows.length} comando(s)`]));
    for (const row of rows) {
        const descriptionLines = wrapHelpText(row.description, descriptionWidth);
        if (row.command.length > commandWidth) {
            println(`  ${terminalThemeText('command', row.command)}`);
            for (const line of descriptionLines) {
                println(`${descriptionIndent} ${terminalThemeText('muted', line)}`);
            }
            continue;
        }
        println(
            `  ${terminalThemeText('command', row.command.padEnd(commandWidth))} ${terminalThemeText('muted', descriptionLines[0] ?? '')}`,
        );
        for (const line of descriptionLines.slice(1)) {
            println(`${descriptionIndent} ${terminalThemeText('muted', line)}`);
        }
    }
}

/**
 * @param {string[]} commands
 * @returns {string}
 */
function commandChain(commands) {
    return commands.map((item) => command(item)).join(terminalThemeText('muted', ' · '));
}

/**
 * Exibe ajuda curta dos comandos do terminal por padrão; `/help full` preserva o catálogo completo.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdHelp({ injectPort, println }, arg = '') {
    const mode = arg.trim().toLowerCase();
    if (mode === 'full' || mode === 'all' || mode === 'detail' || mode === 'detalhe') {
        renderFullHelp({ injectPort, println });
        return;
    }
    if (mode === 'libs' || mode === 'lib' || mode === 'preview' || mode === 'previews') {
        renderAuxiliaryLibsHelp(println);
        return;
    }

    println('');
    println(terminalThemeHeadline('assistant', 'Ajuda rápida - Terminal LLM-B'));
    println(terminalThemeDivider(58));
    println(terminalThemeRow('Situação', commandChain(['/status', '/now', '/activity 10']), { role: 'muted' }));
    println(
        terminalThemeRow(
            'Conversa',
            `${terminalThemeText('muted', 'texto livre')} · ${commandChain(['/turn <msg>', '/answer <texto>'])}`,
            { role: 'muted' },
        ),
    );
    println(terminalThemeRow('Ações', commandChain(['/menu', '/menu 1', '/menu status']), { role: 'muted' }));
    println(
        terminalThemeRow('Arquivos', commandChain(['@caminho', '/fs list', '/fs read <path>', '/search <termo>']), {
            role: 'muted',
        }),
    );
    println(
        terminalThemeRow('Modelo', commandChain(['/byok status', '/byok recommend', '/sdk quota']), { role: 'muted' }),
    );
    println(
        terminalThemeRow(
            'Esperas',
            commandChain(['/sdk waits', '/elicitation show latest', '/permission show latest']),
            { role: 'muted' },
        ),
    );
    println(
        terminalThemeRow('Diagnóstico', commandChain(['/health', '/errors 20', '/display preset focus']), {
            role: 'muted',
        }),
    );
    println(terminalThemeRow('Terminal', commandChain(['/terminal libs', '/libs detail']), { role: 'muted' }));
    println(terminalThemeRow('Ajuda', commandChain(['/help libs', '/help full']), { role: 'muted' }));
    println(terminalThemeRow('HTTP local', `porta ${injectPort}: /inject · /events · /sessions`));
    println(terminalThemeDivider(58));
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderAuxiliaryLibsHelp(println) {
    println('');
    println(terminalThemeHeadline('assistant', 'Ajuda de libs auxiliares'));
    println(terminalThemeDivider(66));
    renderHelpSection(println, 'Inspeção', [
        { command: '/terminal libs', description: 'visão compacta de ferramentas externas opcionais e fallbacks' },
        { command: '/terminal libs detail [filtro]', description: 'detalhes com política, riscos, path, versão e exemplos' },
        { command: '/terminal libs json [filtro]', description: 'contrato JSON com schema, timestamp, policy e tools filtradas' },
        { command: '/terminal libs refresh [filtro]', description: 'redetecta PATH antes de renderizar a superfície solicitada' },
        { command: '/libs deferred|available|missing|fzf', description: 'filtros rápidos por decisão, disponibilidade ou ferramenta' },
    ]);
    renderHelpSection(println, 'Previews', [
        { command: '/fs preview <path>', description: 'preview read-only com bat/batcat quando disponível; fallback JS' },
        { command: '/fs preview <path> --markdown', description: 'Markdown via glow por stdin; sem pager automático' },
        { command: '/fs preview <path> --json --query .x', description: 'JSON via jq quando disponível; parser JS continua canônico' },
        { command: '/fs preview <path> --yaml --query .x', description: 'YAML via yq com env/file ops bloqueadas; fallback js-yaml' },
        { command: '/git diff [--plain]', description: 'delta apenas quando a superfície aceita cor; diff bruto permanece canônico' },
    ]);
    renderHelpSection(println, 'TUI e smoke', [
        { command: '/menu picker', description: 'mostra plano seguro e guardas antes de qualquer TUI externa' },
        { command: '/menu picker --interactive', description: 'usa fzf/gum somente com TTY exclusivo e sem pergunta pendente' },
        { command: 'npm run terminal:aux-libs:smoke', description: 'prova fallbacks, renderers reais e envelope JSON limpo' },
        { command: 'atuin/zoxide', description: 'inventariados, mas adiados por histórico/cwd pessoal e estado fora do produto' },
    ]);
    println(terminalThemeDivider(66));
    println('');
}

/**
 * @param {SessionContext} ctx
 * @returns {void}
 */
function renderFullHelp({ injectPort, println }) {
    println('');
    println(terminalThemeHeadline('assistant', 'Terminal LLM-B - Ajuda completa', [`HTTP local ${injectPort}`]));
    println(terminalThemeDivider(76));
    renderHelpSection(println, 'Sessão e observação', [
        { command: '/status', description: 'status do agente, modelo, acesso, prompt e próximo passo' },
        { command: '/health', description: 'diagnóstico completo do runtime, infra, I/O e lifecycle' },
        { command: '/now', description: 'snapshot operacional curto da conversa' },
        { command: '/live [n]', description: 'fluxo live com conversa, SSE, tools, arquivos e I/O real' },
        { command: '/activity [n]', description: 'atividade atual da LLM-B e timeline recente' },
        { command: '/history [n]', description: 'últimos turnos em memória' },
        { command: '/db-history [n]', description: 'últimos turnos persistidos no SQLite' },
        { command: '/db-sessions [n]', description: 'últimas sessões do hub' },
        { command: '/who', description: 'atores e canais ativos' },
        { command: '/count', description: 'estatísticas da sessão' },
        { command: '/terminal libs', description: 'libs auxiliares opcionais, decisões de uso e fallbacks' },
        { command: '/libs [detail|json|refresh] [filtro]', description: 'atalho para inspecionar capacidades externas por grupo ou tool' },
    ]);
    renderHelpSection(println, 'Conversa e controle', [
        { command: '/queue <msg>', description: 'guarda intervenção para a próxima pergunta humana' },
        { command: '/turn <msg>', description: 'abre novo turno explicitamente, podendo consumir PR' },
        { command: '/steer <msg>', description: 'envio SDK immediate explícito, bloqueado por padrão' },
        { command: '/interrupt <msg>', description: 'aborta turno ativo e guarda substituição para a próxima pergunta' },
        { command: '/answer <texto>', description: 'responde pergunta humana pendente' },
        { command: '/abort', description: 'aborta apenas o turno SDK ativo' },
        { command: '/mailbox [status|consume|clear]', description: 'inspeciona, consome ou limpa a fila de intervenção' },
        { command: '/clear', description: 'limpa histórico em memória' },
        { command: '/clear-shadow', description: 'limpa pergunta humana restaurada do disco' },
        { command: '/restart', description: 'reinicia a conversa' },
        { command: '/emergency-reset (/ereset)', description: 'limpa limitadores e reinicia a conversa' },
        { command: '/quit ou /exit', description: 'encerra terminal' },
    ]);
    renderHelpSection(println, 'Sessão SDK persistente', [
        { command: '/session [sdk [n]]', description: 'cockpit da sessão SDK persistente' },
        { command: '/session sdk commands', description: 'CommandDefinition[] registrados no SDK' },
        { command: '/session sdk events [n]', description: 'lifecycle e comandos SDK pelo archive SSE canônico' },
        {
            command: '/session sdk waits [n]',
            description: 'perguntas, formulários e permissões publicados pelo fanout',
        },
        { command: '/session sdk next <new|resume|auto>', description: 'agenda seleção de sessão SDK no próximo boot' },
        { command: '/session sdk delete <id|#n>', description: 'apaga estado persistido SDK fora da sessão viva' },
    ]);
    renderHelpSection(println, 'Modelo, BYOK e quota', [
        { command: '/model', description: 'exibe modelo ativo' },
        { command: '/model list', description: 'lista modelos disponíveis via SDK' },
        { command: '/model <id>', description: 'troca modelo, como /model auto' },
        { command: '/byok status|recommend|use|provider|model', description: 'BYOK universal via .env.local' },
        { command: '/reasoning', description: 'exibe nível de raciocínio atual' },
        { command: '/reasoning low|medium|high|xhigh|off', description: 'altera reasoning effort' },
        { command: '/sdk quota', description: 'quota e usage RPC do SDK' },
    ]);
    renderHelpSection(println, 'Contexto, arquivos e índice', [
        { command: '/attach [path|clear]', description: 'gerencia fila de anexos para o próximo turno' },
        {
            command: '/attach blob <mime> <base64> [--name n]',
            description: 'adiciona blob inline sem roundtrip por disco',
        },
        { command: '@<caminho>', description: 'embed automático de arquivo no texto da mensagem' },
        { command: '/context', description: 'estima uso atual de tokens da sessão' },
        { command: '/compact', description: 'compacta histórico em resumo técnico denso' },
        {
            command: '/fs [list|read|preview|search|create|write]',
            description: 'filesystem local canônico via file-tools e preview opcional',
        },
        {
            command: '/workspace [list|read|write|sync|mirror|promote]',
            description: 'workspace SDK e convergência SDK/FS',
        },
        {
            command: '/scope [list|declare|context|find|refresh|close]',
            description: 'escopos inteligentes de contexto',
        },
        {
            command: '/index [status|build|search|symbol|clear]',
            description: 'índice local FTS, símbolos, imports e poda',
        },
        { command: '/search <termo>', description: 'busca textual rápida no workspace' },
    ]);
    renderHelpSection(println, 'Previews e libs auxiliares', [
        { command: '/terminal libs detail [filtro]', description: 'mostra disponibilidade, política, riscos, fallbacks e exemplos' },
        { command: '/terminal libs deferred|fzf|bat|jq', description: 'filtros compactos por decisão, disponibilidade ou ferramenta' },
        { command: '/fs preview <path>', description: 'preview read-only com bat/batcat quando disponível; fallback JS' },
        { command: '/fs preview <path> --plain', description: 'força fallback textual JS, útil para comparar renderers' },
        { command: '/fs preview <path> --markdown', description: 'render Markdown com glow quando disponível; sem pager automático' },
        { command: '/fs preview <path> --json [--query .x]', description: 'pretty/query JSON com jq quando disponível; parser JS é canônico' },
        { command: '/fs preview <path> --yaml [--query .x]', description: 'pretty/query YAML com yq seguro quando disponível; fallback js-yaml' },
        { command: '/git diff [--staged] [--plain]', description: 'diff com delta quando disponível; diff bruto continua canônico' },
        { command: '/gh pr diff <n> [--plain]', description: 'preview de patch de PR com o mesmo contrato de diff' },
        { command: '/menu picker', description: 'mostra plano seguro; não abre TUI sem ação explícita' },
        { command: '/menu picker --interactive', description: 'abre fzf/gum somente com TTY exclusivo e sem pergunta pendente' },
        { command: 'npm run terminal:aux-libs:smoke', description: 'smoke read-only de renderers externos e fallbacks JS' },
        { command: 'npm --silent run terminal:aux-libs:smoke -- --json', description: 'JSON pipeável do smoke sem banner do npm' },
        { command: 'atuin/zoxide', description: 'detectados apenas; adiados por histórico/cwd pessoal e estado fora do produto' },
    ]);
    renderHelpSection(println, 'Interações humanas e SDK', [
        {
            command: '/sdk [status|models|tools|quota|prompt|capabilities|waits|compact]',
            description: 'catálogo e operações SDK via Agent',
        },
        { command: '/sdk waits', description: 'esperas humanas unificadas' },
        { command: '/elicitation [list|show|request|respond]', description: 'formulários e URL estruturados do SDK' },
        { command: '/permission [list|show|mode|respond]', description: 'permissões SDK observadas e governança' },
        { command: '/tools [diag|all|raw]', description: 'telemetria canônica de ferramentas' },
        { command: '/events [n|sources|trace|tool]', description: 'archive SSE e mapa de fontes canônicas' },
        { command: '/errors [n]', description: 'últimos erros rastreados' },
        { command: '/audit [n]', description: 'últimas entradas do audit log' },
    ]);
    renderHelpSection(println, 'Exibição e navegação', [
        { command: '/menu [n|id|run n]', description: 'command palette inteligente no terminal' },
        {
            command: '/display [toggle] [on|off]',
            description: 'toggles de thinking, streaming, telemetria, tools e intenção',
        },
        { command: '/display preset <default|minimal|verbose|debug|focus>', description: 'aplica presets de UX' },
        { command: '/display theme <elegant|vivid|mono>', description: 'ajusta paleta visual' },
        { command: '/display detail <compact|detailed>', description: 'define densidade textual live' },
        { command: '/thinking [on|off|list|show]', description: 'controla e consulta thinking/reasoning capturado' },
        { command: '/intent [n|detail|clear]', description: 'intenções explícitas capturadas da LLM-B' },
        { command: '/usage [on|off|now]', description: 'telemetria de tokens e custo' },
        { command: '/metrics', description: 'métricas consolidadas da sessão' },
        { command: '/export [path]', description: 'exporta conversa como Markdown' },
        { command: '/resume [sessionId]', description: 'lista ou injeta resumo do hub' },
    ]);
    renderHelpSection(println, 'Memória, GitHub e Git', [
        { command: '/remember [tag:] texto', description: 'persiste memória semântica' },
        { command: '/recall [tag|?busca]', description: 'recupera memória por tag ou full-text' },
        { command: '/forget <id>', description: 'remove memória por ID' },
        { command: '/gh issue|pr|run|release|search|status|api', description: 'opera GitHub CLI pelo terminal' },
        {
            command: '/git status|log|diff|branch|pull|stash',
            description: 'opera Git local e aliases /st, /gst, /diff',
        },
        { command: '/alias [list|set|remove]', description: 'gerencia aliases do terminal' },
    ]);
    renderHelpSection(println, 'HTTP local', [
        { command: 'POST /inject', description: 'injeta mensagem no terminal' },
        { command: 'POST /pipeline', description: 'envia pipeline local' },
        { command: 'GET /events', description: 'stream/eventos do terminal' },
        { command: 'GET /sessions', description: 'sessões do hub' },
        { command: 'POST|GET|DELETE /memory', description: 'memória semântica via HTTP' },
        { command: 'GET /gh/issues|/gh/prs|/gh/ci', description: 'projeções GitHub' },
        { command: 'GET /git/status|/git/log', description: 'projeções Git' },
    ]);
    println('');
    println(
        terminalThemeRow(
            'Texto livre',
            'sem / entra na fila de intervenção por padrão e será aplicado na próxima pergunta humana',
        ),
    );
    println(
        terminalThemeRow(
            'Novo turno',
            'use /turn ou prefixo !!turn apenas quando quiser abrir novo turno que pode consumir PR',
        ),
    );
    println(terminalThemeDivider(76));
    println('');
}
