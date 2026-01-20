/* scripts/status_fila.js (Audit Level 15 - Intelligent Dashboard) */
// Responsabilidade: Monitoramento em tempo real da fila com telemetria avançada.
// Uso: node scripts/status_fila.js [--watch] [--failed] [--tag "Projeto X"]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');

// --- ARGUMENTOS ---
const args = process.argv.slice(2);
const WATCH_MODE = args.includes('--watch');
const ONLY_FAILED = args.includes('--failed');
const TAG_FILTER = args.find(a => a.startsWith('--tag='))?.split('=')[1];
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 15;

// Cores ANSI
const C = {
    RESET: '\x1b[0m', BRIGHT: '\x1b[1m', DIM: '\x1b[2m',
    RED: '\x1b[31m', GREEN: '\x1b[32m', YELLOW: '\x1b[33m', 
    CYAN: '\x1b[36m', WHITE: '\x1b[37m', BLUE: '\x1b[34m'
};

const STATUS_COLORS = {
    PENDING: C.DIM + C.WHITE, RUNNING: C.BRIGHT + C.YELLOW,
    DONE: C.GREEN, FAILED: C.RED, PAUSED: C.CYAN, 
    SCHEDULED: C.BLUE, SKIPPED: C.DIM + C.WHITE
};

// --- HELPERS DE DADOS (V2/V3 ADAPTER) ---
const getStatus = (t) => t.state?.status || t.status || 'UNKNOWN';
const getPrio = (t) => t.meta?.priority ?? t.prioridade ?? 5;
const getId = (t) => t.meta?.id || t.id || '???';
const getPrompt = (t) => t.spec?.payload?.user_message || t.prompt || '';
const getCreated = (t) => t.meta?.created_at || t.criadoEm;
const getStarted = (t) => t.state?.started_at || t.startedEm;
const getCompleted = (t) => t.state?.completed_at;
const getError = (t) => t.state?.history?.find(h => h.event === 'ERROR')?.msg || t.erro || '';
const getSchedule = (t) => t.policy?.execute_after;
const getTags = (t) => t.meta?.tags || [];

function timeAgo(isoDate) {
    if (!isoDate) return '-';
    const sec = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h`;
}

// --- RENDERIZAÇÃO ---

function render() {
    if (!fs.existsSync(QUEUE_DIR)) {
        console.log(`${C.RED}❌ Erro: Pasta 'fila' não encontrada.${C.RESET}`);
        return;
    }

    const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
    const stats = { TOTAL: 0, PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, PAUSED: 0, SCHEDULED: 0, SKIPPED: 0 };
    const activeTasks = [];
    const recentFailures = [];
    const completedDurations = []; // Para cálculo de ETA

    files.forEach(f => {
        try {
            const t = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf-8'));
            let status = getStatus(t);
            const tags = getTags(t);

            // Filtro de Tag
            if (TAG_FILTER && !tags.includes(TAG_FILTER)) return;

            // Lógica de Agendamento
            const schedule = getSchedule(t);
            if (status === 'PENDING' && schedule && new Date(schedule) > new Date()) {
                status = 'SCHEDULED';
            }

            stats.TOTAL++;
            if (stats[status] !== undefined) stats[status]++;

            // Telemetria de Tempo (últimas 20 tarefas concluídas para média móvel)
            if (status === 'DONE') {
                const start = getStarted(t);
                const end = getCompleted(t);
                if (start && end) {
                    completedDurations.push(new Date(end) - new Date(start));
                }
            }

            const taskData = {
                id: getId(t), status, prio: getPrio(t),
                prompt: getPrompt(t), created: getCreated(t),
                started: getStarted(t), error: getError(t),
                schedule, tags
            };

            if (status === 'FAILED') recentFailures.push(taskData);
            if (['RUNNING', 'PENDING', 'PAUSED', 'SCHEDULED'].includes(status)) {
                if (!ONLY_FAILED) activeTasks.push(taskData);
            }
        } catch (e) { /* arquivo sendo escrito */ }
    });

    // Cálculos de Performance
    const recentDurations = completedDurations.slice(-20);
    const avgMs = recentDurations.length > 0 ? recentDurations.reduce((a, b) => a + b) / recentDurations.length : 0;
    const etaMin = Math.round((avgMs * stats.PENDING) / 60000);

    if (WATCH_MODE) console.clear();
    
    console.log(`${C.BRIGHT}${C.CYAN}=== MISSION CONTROL DASHBOARD ===${C.RESET}`);
    
    // Barra de Progresso
    const width = 40;
    const donePct = stats.TOTAL ? stats.DONE / stats.TOTAL : 0;
    const barLen = Math.round(donePct * width);
    const bar = '█'.repeat(barLen) + '░'.repeat(width - barLen);
    console.log(`Progresso: [${C.GREEN}${bar}${C.RESET}] ${(donePct * 100).toFixed(1)}%`);
    if (etaMin > 0) console.log(`${C.DIM}ETA p/ Fila: ~${etaMin} min (baseado nas últimas ${recentDurations.length} tarefas)${C.RESET}\n`);
    else console.log('');

    // Linha de Status
    console.log(`${C.BRIGHT}TOTAL: ${stats.TOTAL}${C.RESET} | ${C.GREEN}DONE: ${stats.DONE}${C.RESET} | ${C.YELLOW}RUN: ${stats.RUNNING}${C.RESET} | PEND: ${stats.PENDING} | ${C.BLUE}SCHED: ${stats.SCHEDULED}${C.RESET} | ${C.RED}FAIL: ${stats.FAILED}${C.RESET}`);

    // Alertas Críticos
    if (stats.PENDING > 0 && stats.RUNNING === 0) {
        console.log(`${C.RED}${C.BRIGHT}[!] ALERTA: Fila estagnada. O agente está offline?${C.RESET}`);
    }

    // Listagem de Ativas
    console.log(`\n${C.DIM}TAREFAS ATIVAS (Limit: ${LIMIT}):${C.RST}`);
    console.log(`${C.DIM}ID                       STATUS      PRIO   TEMPO   PROMPT${C.RESET}`);
    console.log(C.DIM + '-'.repeat(80) + C.RESET);

    activeTasks.sort((a, b) => (a.status === 'RUNNING' ? -1 : 1) || b.prio - a.prio).slice(0, LIMIT).forEach(t => {
        const color = STATUS_COLORS[t.status] || C.WHITE;
        let timeLabel = t.status === 'RUNNING' ? timeAgo(t.started) : timeAgo(t.created);
        if (t.status === 'SCHEDULED') {
            const d = new Date(t.schedule);
            timeLabel = `🕒 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        }
        console.log(`${color}${t.id.padEnd(24)} ${t.status.padEnd(11)} ${String(t.prio).padEnd(6)} ${timeLabel.padEnd(7)} ${t.prompt.replace(/\n/g,' ').slice(0, 30)}...${C.RESET}`);
    });

    // Listagem de Falhas (Se houver)
    if (recentFailures.length > 0) {
        console.log(`\n${C.RED}FALHAS RECENTES:${C.RESET}`);
        recentFailures.sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, 3).forEach(f => {
            console.log(`  ${C.RED}✖${C.RESET} ${f.id.padEnd(20)} | ${f.error.slice(0, 60)}...`);
        });
    }

    if (WATCH_MODE) console.log(`\n${C.DIM}Atualizando a cada 2s... Ctrl+C para sair.${C.RESET}`);
}

render();
if (WATCH_MODE) setInterval(render, 2000);