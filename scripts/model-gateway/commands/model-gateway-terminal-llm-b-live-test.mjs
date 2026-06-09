#!/usr/bin/env node
/**
 * Canonical live runner for `terminal:llm-b`.
 *
 * This is intentionally opt-in and not part of default CI: the default scenario talks to the real SDK and can consume a
 * Premium Request for the explicit user turn. Use `--no-pr` for a boot/resume/control-only probe that validates UX
 * telemetry without sending an LLM turn.
 */

import { parse as parseDotenv } from 'dotenv';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { modelGatewayScriptPath } from '../index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POST_ANSWER_DELAY_MS = 6_000;
const DEFAULT_POST_ASK_CONTINUATION_WAIT_MS = 45_000;
const DEFAULT_MISSING_REQUIRED_ASK_GRACE_MS = 2_000;
const SESSION_CYCLE_PROMPT_STABLE_MAX_WAIT_MS = 15_000;
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const SECRET_ENV_RE = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|BEARER)/iu;
const TURN_SETTLED_AFTER_ASK_RE =
    /(?:Resposta concluída|Turno concluído; aguardando próxima mensagem|Turno do assistente concluído)/iu;
const REPL_PROMPT_TAIL_RE = /(?:^|\n)voc[eê]\[[^\n]*?›\s*$/iu;
const REPL_NORMAL_PROMPT_TAIL_RE = /(?:^|\n)voc[eê]\[[^\n\]]+\](?!\[PERG(?:UNTA)?\])›\s*$/iu;
const LIVE_PROTOCOL_PROBE_KINDS = Object.freeze(['live_tool_protocol', 'live_ask_user']);
const LIVE_TURN_PROBE_KIND = 'live_turn';
const LIVE_BLOCKING_PROBE_KINDS = Object.freeze([...LIVE_PROTOCOL_PROBE_KINDS, LIVE_TURN_PROBE_KIND]);

/**
 * @typedef {{
 *     event: string;
 *     source: string | null;
 *     traceId: string | null;
 *     turnId: string | null;
 *     eventId: number | null;
 * }} CanonicalEventSummaryItem
 */

if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`Usage: node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs [options]

Canonical Terminal LLM-B live harness. It starts a real terminal session unless --dry-run is used.

Common options:
  --dry-run
  --no-pr
  --byok-real
  --byok-real-profile=<profile>
  --byok-real-model=<model>
  --byok-real-route-profile=<profile>
  --byok-real-route-fallback-profiles=<a,b>
  --byok-real-route-execute
  --byok-real-route-allow-probe
  --byok-real-route-selection-policy=<metadata_first|prefer_runtime_proved|require_runtime_proof>
  --byok-real-route-max-attempts=<n>
  --byok-real-route-max-attempts-per-provider=<n>
  --byok-real-route-temporary-failure-cooldown-ms=<ms>
  --byok-real-route-timeout-ms=<ms>
  --byok-real-require-vision-probe
  --auto-probe
  --model-probe
  --live-scenario=<canonical|freeform|invalid-choice|long-tool-heartbeat|recoverable-tool-error|file-write-roundtrip|file-patch-roundtrip>
  --structured-input-cycle
  --menu-cycle
  --picker-interactive-cycle
  --ux-cycle
  --diagnostic-ux-cycle
  --audit-ux-cycle
  --operator-ux-cycle
  --reuse-sdk-session
  --timeout-ms=<ms>
  --transport=<pty|stdio>
  --out-dir=<path>
`);
    process.exit(0);
}

function stripAnsi(value) {
    return String(value ?? '').replace(ANSI_RE, '');
}

function readArg(name, fallback) {
    const prefix = `${name}=`;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith(prefix)) return arg.slice(prefix.length);
        if (arg === name) {
            const next = args[index + 1];
            if (typeof next === 'string' && next.length > 0 && !next.startsWith('--')) return next;
            return fallback;
        }
    }
    return fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function hasCommand(name) {
    const result = spawnSync('sh', ['-lc', `command -v ${name}`], { stdio: 'ignore' });
    return result.status === 0;
}

const HUMAN_TERMINAL_SHUTDOWN_RE = /Terminal\s+fechado; API local permanece ativa até o processo encerrar/u;
const LEGACY_TERMINAL_SHUTDOWN_RE = /\[terminal\]\s+(?:readline fechado|Encerrando sessão)/iu;

function hasHumanTerminalShutdownCopy(plain) {
    const text = String(plain ?? '');
    return HUMAN_TERMINAL_SHUTDOWN_RE.test(text) && !LEGACY_TERMINAL_SHUTDOWN_RE.test(text);
}

function buildTerminalLlmbCommand(canUsePty) {
    if (canUsePty) {
        return {
            cmd: 'script',
            args: ['-qfec', 'npm --silent run terminal:llm-b', '/dev/null'],
        };
    }
    return { cmd: 'npm', args: ['--silent', 'run', 'terminal:llm-b'] };
}

function canListenOnPort(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, host, () => {
            server.close(() => resolve(true));
        });
    });
}

async function resolveLiveTerminalPort(preferredPort, { scanLimit = 50 } = {}) {
    const preferred = Number.isFinite(preferredPort) && preferredPort >= 0 ? Math.trunc(preferredPort) : 3009;
    if (preferred === 0) return 0;
    for (let offset = 0; offset <= scanLimit; offset += 1) {
        const candidate = preferred + offset;
        if (await canListenOnPort(candidate)) return candidate;
    }
    return preferred;
}

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureLine(input) {
    return input.endsWith('\n') ? input : `${input}\n`;
}

function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const DEFAULT_LIVE_SCENARIO_ID = 'canonical';

function buildExactLineRegex(value) {
    return new RegExp(escapeRegExp(value), 'iu');
}

function buildAskRenderedRegex(question) {
    return new RegExp(`\\[(?:PERGUNTA|ASK)\\]\\s+${escapeRegExp(question)}`, 'u');
}

function hasHumanQuestionInputPrompt(plain) {
    return /voc[eê]\[[^\]\n]+(?:\/[^\]\n]+)?\](?:\[[^\]\n]+\])*\[PERG(?:UNTA)?\]›/iu.test(
        String(plain ?? ''),
    );
}

function findDivergentScenarioAsk(plain, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    const text = String(plain ?? '');
    if (scenario.askRenderedRe.test(text)) return null;
    const prefix = scenario.askQuestion.split(':')[0];
    if (!prefix) return null;
    const match = text.match(new RegExp(`\\[(?:PERGUNTA|ASK)\\]\\s+(?<question>${escapeRegExp(prefix)}[^\\n\\r]*)`, 'iu'));
    const question = match?.groups?.['question']?.trim() ?? '';
    if (!question || question === scenario.askQuestion) return null;
    return {
        expected: scenario.askQuestion,
        observed: question,
        prefix,
    };
}

function buildQuestionPendingRegex(question) {
    return new RegExp(`\\[(?:QUESTION|ASK:[^\\]]+)\\]\\s+LLM-B perguntou:\\s*"${escapeRegExp(question)}"`, 'u');
}

function buildAnswerRegex(answer) {
    return new RegExp(escapeRegExp(answer), 'iu');
}

function createLiveScenario({
    id,
    description,
    askQuestion,
    finalMarker,
    answerSteps,
    askToolInstruction,
    finalInstruction,
    beforeDeltaInstructions = [],
    allowedTools = ['report_intent', 'read_file_content', 'ask_user'],
    expectedLifecycleTools = [],
    expectedOutputMarkers = [],
    expectedTerminalRender = [],
    invalidChoiceExpected = false,
    recoverableToolErrorExpected = false,
}) {
    return Object.freeze({
        id,
        description,
        askQuestion,
        finalMarker,
        answerSteps: Object.freeze(answerSteps.map((step) => Object.freeze({ ...step }))),
        askToolInstruction,
        finalInstruction,
        beforeDeltaInstructions: Object.freeze(beforeDeltaInstructions),
        allowedTools: Object.freeze(allowedTools),
        expectedLifecycleTools: Object.freeze(expectedLifecycleTools.map((tool) => Object.freeze({ ...tool }))),
        expectedOutputMarkers: Object.freeze(expectedOutputMarkers),
        expectedTerminalRender: Object.freeze(expectedTerminalRender.map((item) => Object.freeze({ ...item }))),
        invalidChoiceExpected,
        recoverableToolErrorExpected,
        askRenderedRe: buildAskRenderedRegex(askQuestion),
        askQuestionRe: buildExactLineRegex(askQuestion),
        questionPendingRe: buildQuestionPendingRegex(askQuestion),
        postAskFinalRe: buildExactLineRegex(finalMarker),
        finalAnswerRe: buildAnswerRegex(answerSteps.at(-1)?.answer ?? ''),
    });
}

const LIVE_SCENARIOS = Object.freeze({
    canonical: createLiveScenario({
        id: 'canonical',
        description: 'baseline: choice simples SIM e fechamento canônico',
        askQuestion: 'ASK-CANONICAL: responda SIM para fechar o teste',
        finalMarker: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
        answerSteps: [{ answer: 'SIM', trigger: 'ask', delayMs: 500 }],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-CANONICAL: responda SIM para fechar o teste". Use a opção SIM se o schema da tool expuser choices.',
        finalInstruction:
            'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-CANONICAL-FINAL: usuário confirmou SIM".',
    }),
    freeform: createLiveScenario({
        id: 'freeform',
        description: 'ask_user com resposta livre aceita pelo terminal e pelo SDK',
        askQuestion: 'ASK-FREEFORM: responda livremente para fechar o teste',
        finalMarker: 'POST-ASK-FREEFORM-FINAL: usuário respondeu livremente',
        answerSteps: [{ answer: 'SIM LIVRE - observacao humana', trigger: 'ask', delayMs: 500 }],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-FREEFORM: responda livremente para fechar o teste". Não forneça choices obrigatórias; permita resposta livre se o schema da tool expuser allowFreeform.',
        finalInstruction:
            'Depois que o usuário responder livremente, escreva uma última mensagem pública contendo exatamente "POST-ASK-FREEFORM-FINAL: usuário respondeu livremente".',
    }),
    'invalid-choice': createLiveScenario({
        id: 'invalid-choice',
        description: 'compatibilidade: choices presentes, mas resposta livre fora das opções aceita',
        askQuestion: 'ASK-CHOICE: escolha SIM ou responda livremente para fechar o teste',
        finalMarker: 'POST-ASK-CHOICE-FINAL: usuário respondeu livremente fora das opções',
        answerSteps: [{ answer: 'TALVEZ LIVRE - fora das opções', trigger: 'ask', delayMs: 500 }],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-CHOICE: escolha SIM ou responda livremente para fechar o teste", com choices contendo apenas SIM. Se o schema expuser allowFreeform, não bloqueie texto livre.',
        finalInstruction:
            'Depois que o usuário responder livremente fora das opções, escreva uma última mensagem pública contendo exatamente "POST-ASK-CHOICE-FINAL: usuário respondeu livremente fora das opções".',
    }),
    'long-tool-heartbeat': createLiveScenario({
        id: 'long-tool-heartbeat',
        description: 'tool demorada controlada com status/heartbeat visivel antes de ask_user',
        askQuestion: 'ASK-LONGTOOL: responda SIM depois da tool longa',
        finalMarker: 'POST-ASK-LONGTOOL-FINAL: tool longa concluída e usuário confirmou SIM',
        answerSteps: [{ answer: 'SIM', trigger: 'ask', delayMs: 500 }],
        beforeDeltaInstructions: [
            'Depois do read_file_content, invoque a ferramenta real exec_command com command exatamente "node -e \\"setTimeout(() => console.log(\'LONG-TOOL-HEARTBEAT-DONE\'), 4000)\\"" e timeoutSeconds=10.',
            'Aguarde a tool exec_command concluir e só então escreva as oito linhas DELTA-CANONICAL.',
        ],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-LONGTOOL: responda SIM depois da tool longa". Use a opção SIM se o schema da tool expuser choices.',
        finalInstruction:
            'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-LONGTOOL-FINAL: tool longa concluída e usuário confirmou SIM".',
        allowedTools: ['report_intent', 'read_file_content', 'exec_command', 'ask_user'],
        expectedLifecycleTools: [{ name: 'exec_command', renderedName: 'Executar comando' }],
        expectedOutputMarkers: ['LONG-TOOL-HEARTBEAT-DONE'],
        expectedTerminalRender: [
            { toolName: 'exec_command', renderedName: 'Executar comando', badge: 'EXEC', forbiddenBadge: 'VER' },
        ],
    }),
    'recoverable-tool-error': createLiveScenario({
        id: 'recoverable-tool-error',
        description: 'erro de tool contido antes de recuperacao por tool valida e ask_user',
        askQuestion: 'ASK-RECOVERABLE: responda SIM depois da recuperação',
        finalMarker: 'POST-ASK-RECOVERABLE-FINAL: erro de tool foi recuperado e usuário confirmou SIM',
        answerSteps: [{ answer: 'SIM', trigger: 'ask', delayMs: 500 }],
        beforeDeltaInstructions: [
            'Não encerre o turno depois de report_intent. Depois do primeiro read_file_content, e ainda antes de qualquer texto público, invoque a ferramenta real exec_command com command exatamente "node -e \\"console.error(\'RECOVERABLE-TOOL-ERROR\'); process.exit(7)\\"" e timeoutSeconds=10.',
            'A falha controlada de exec_command é esperada. Mesmo que exec_command retorne success=false ou exitCode=7, continue o turno e invoque read_file_content novamente para ler as primeiras 3 linhas de package.json.',
            'Somente depois dessa recuperação explícita escreva as oito linhas DELTA-CANONICAL. Não trate o erro recuperável como falha fatal do teste.',
        ],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-RECOVERABLE: responda SIM depois da recuperação". Use a opção SIM se o schema da tool expuser choices.',
        finalInstruction:
            'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-RECOVERABLE-FINAL: erro de tool foi recuperado e usuário confirmou SIM".',
        allowedTools: ['report_intent', 'read_file_content', 'exec_command', 'ask_user'],
        expectedLifecycleTools: [
            { name: 'exec_command', renderedName: 'Executar comando', expectedOutcome: 'failure' },
        ],
        expectedOutputMarkers: ['RECOVERABLE-TOOL-ERROR'],
        expectedTerminalRender: [
            { toolName: 'exec_command', renderedName: 'Executar comando', badge: 'EXEC', forbiddenBadge: 'VER' },
        ],
        recoverableToolErrorExpected: true,
    }),
    'file-write-roundtrip': createLiveScenario({
        id: 'file-write-roundtrip',
        description: 'create_file, move_file e delete_file reais sem prompt de permissao SDK',
        askQuestion: 'ASK-FILEWRITE: responda SIM depois do roundtrip de arquivo',
        finalMarker: 'POST-ASK-FILEWRITE-FINAL: arquivo criado, movido, deletado e usuário confirmou SIM',
        answerSteps: [{ answer: 'SIM', trigger: 'ask', delayMs: 500 }],
        beforeDeltaInstructions: [
            'Os caminhos relativos abaixo são deliberados, seguros, relativos ao workspace atual e já autorizados pelo operador; não invoque ask_user para confirmar caminho, workspace, permissão, criação, movimento ou exclusão.',
            'Use exatamente os caminhos relativos informados; não converta para caminho absoluto antes de chamar as tools e não peça confirmação intermediária.',
            'Depois do read_file_content, invoque create_file com path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-source.txt", content exatamente "TERMINAL-PERMISSION-ROUNDTRIP\\n", createParentDirs=true e overwrite=true.',
            'Em seguida invoque move_file com source exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-source.txt", destination exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-moved.txt" e overwrite=true.',
            'Em seguida invoque delete_file com path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-moved.txt".',
            'Aguarde create_file, move_file e delete_file concluírem e só então escreva as oito linhas DELTA-CANONICAL.',
        ],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-FILEWRITE: responda SIM depois do roundtrip de arquivo". Use a opção SIM se o schema da tool expuser choices.',
        finalInstruction:
            'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-FILEWRITE-FINAL: arquivo criado, movido, deletado e usuário confirmou SIM".',
        allowedTools: ['report_intent', 'read_file_content', 'create_file', 'move_file', 'delete_file', 'ask_user'],
        expectedLifecycleTools: [
            { name: 'create_file', renderedName: 'Criar arquivo' },
            { name: 'move_file', renderedName: 'Mover arquivo' },
            { name: 'delete_file', renderedName: 'Excluir arquivo' },
        ],
        expectedOutputMarkers: ['TERMINAL-PERMISSION-ROUNDTRIP'],
        expectedTerminalRender: [
            { toolName: 'move_file', renderedName: 'Mover arquivo', badge: 'MOVER', forbiddenBadge: 'VER' },
        ],
    }),
    'file-patch-roundtrip': createLiveScenario({
        id: 'file-patch-roundtrip',
        description: 'create_file, read_file_content com hash, patch_file dry-run/aplicado e delete_file reais',
        askQuestion: 'ASK-FILEPATCH: responda SIM depois do roundtrip de patch',
        finalMarker: 'POST-ASK-FILEPATCH-FINAL: patch simulado, aplicado, limpo e usuário confirmou SIM',
        answerSteps: [{ answer: 'SIM', trigger: 'ask', delayMs: 500 }],
        beforeDeltaInstructions: [
            'Os caminhos relativos abaixo são deliberados, seguros, relativos ao workspace atual e já autorizados pelo operador; não invoque ask_user para confirmar caminho, workspace, permissão, criação, edição ou exclusão.',
            'Use exatamente os caminhos relativos informados; não converta para caminho absoluto antes de chamar as tools e não peça confirmação intermediária.',
            'Depois do read_file_content de package.json, invoque create_file com path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PATCH-ROUNDTRIP.txt", content exatamente "TERMINAL-PATCH-ROUNDTRIP=before\\n", createParentDirs=true e overwrite=true.',
            'Em seguida invoque read_file_content no path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PATCH-ROUNDTRIP.txt" com includeHash=true e maxLines=20.',
            'Em seguida invoque patch_file no mesmo path com old_string exatamente "TERMINAL-PATCH-ROUNDTRIP=before\\n", new_string exatamente "TERMINAL-PATCH-ROUNDTRIP=after\\nPATCH-ROUNDTRIP-APPLIED\\n", dryRun=true, expected_occurrences=1 e expectedHash igual ao contentHash retornado pela leitura quando esse campo estiver disponível.',
            'Em seguida invoque patch_file novamente no mesmo path, com os mesmos old_string, new_string, expected_occurrences=1 e expectedHash, mas agora dryRun=false.',
            'Em seguida invoque read_file_content no mesmo path com maxLines=20 para confirmar que PATCH-ROUNDTRIP-APPLIED está presente.',
            'Por fim invoque delete_file com path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PATCH-ROUNDTRIP.txt".',
            'Aguarde create_file, read_file_content, patch_file dry-run, patch_file aplicado, read_file_content de confirmação e delete_file concluírem e só então escreva as oito linhas DELTA-CANONICAL.',
        ],
        askToolInstruction:
            'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-FILEPATCH: responda SIM depois do roundtrip de patch". Use a opção SIM se o schema da tool expuser choices.',
        finalInstruction:
            'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-FILEPATCH-FINAL: patch simulado, aplicado, limpo e usuário confirmou SIM".',
        allowedTools: ['report_intent', 'read_file_content', 'create_file', 'patch_file', 'delete_file', 'ask_user'],
        expectedLifecycleTools: [
            { name: 'create_file', renderedName: 'Criar arquivo' },
            { name: 'patch_file', renderedName: 'Editar arquivo', allowFocusTransitions: true },
            { name: 'delete_file', renderedName: 'Excluir arquivo' },
        ],
        expectedOutputMarkers: ['PATCH-ROUNDTRIP-APPLIED'],
        expectedTerminalRender: [
            { toolName: 'patch_file', renderedName: 'Editar arquivo', badge: 'EDITAR', forbiddenBadge: 'VER' },
            { toolName: 'delete_file', renderedName: 'Excluir arquivo', badge: 'EXCLUIR', forbiddenBadge: 'VER' },
        ],
    }),
});

function normalizeLiveScenarioId(value) {
    const normalized = String(value ?? DEFAULT_LIVE_SCENARIO_ID)
        .trim()
        .toLowerCase()
        .replaceAll('_', '-');
    if (normalized === 'choice-invalid') return 'invalid-choice';
    return normalized || DEFAULT_LIVE_SCENARIO_ID;
}

function readLiveScenario() {
    const id = normalizeLiveScenarioId(readArg('--live-scenario', readArg('--scenario', DEFAULT_LIVE_SCENARIO_ID)));
    const scenario = LIVE_SCENARIOS[id];
    if (!scenario) {
        const supported = Object.keys(LIVE_SCENARIOS).sort().join(', ');
        console.error(`[terminal-live] cenário live inválido: ${id}. Suportados: ${supported}`);
        process.exit(2);
    }
    return scenario;
}

function buildScenarioPrompt(scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    return [
        'Faça um teste integrado canônico do terminal.',
        'Use chamadas de ferramenta reais do SDK; texto, Markdown, JSON, pseudo-tool e exemplos de tool_calls não contam.',
        'Primeiro invoque a ferramenta real report_intent com o intent "terminal live canonical deltas tools ask_user usage".',
        'Depois invoque a ferramenta real read_file_content para ler as primeiras 3 linhas de package.json.',
        ...scenario.beforeDeltaInstructions,
        'Em seguida escreva obrigatoriamente uma resposta pública antes de qualquer ask_user, com exatamente 8 linhas separadas: DELTA-CANONICAL-1, DELTA-CANONICAL-2, DELTA-CANONICAL-3, DELTA-CANONICAL-4, DELTA-CANONICAL-5, DELTA-CANONICAL-6, DELTA-CANONICAL-7 e DELTA-CANONICAL-8.',
        'Cada uma dessas oito linhas deve conter somente o marcador exato da linha; por exemplo, a primeira linha deve ser exatamente "DELTA-CANONICAL-1" e nada mais.',
        'Essas oito linhas DELTA-CANONICAL devem ser texto puro: não use Markdown, HTML, links, imagens, tabelas, listas ou blocos de código nelas.',
        'Não invoque ask_user antes dessas 8 linhas públicas aparecerem no transcript.',
        scenario.askToolInstruction,
        scenario.finalInstruction,
        'Depois do marcador final, pare imediatamente: não chame outra ferramenta, não escreva outra mensagem e aguarde o próximo comando humano.',
        `Antes da resposta humana final, não escreva, cite nem antecipe o marcador ${scenario.finalMarker}.`,
        `A pergunta ${scenario.askQuestion.split(':')[0]} deve ser feita pela tool ask_user real; não a simule como texto, Markdown, JSON ou pseudo-tool no transcript público.`,
        'Nunca escreva um objeto tool_calls, uma chave function/args, nem diga que ações foram executadas sem a tool real aparecer no terminal.',
        'Nunca afirme que criou, editou, moveu, copiou ou excluiu arquivo antes de ver a respectiva tool real retornar sucesso.',
        `Não use outras tools além de ${scenario.allowedTools.join(', ')}.`,
    ].join(' ');
}

function buildMissingRequiredAskRecoveryPrompt(scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    return [
        'Continue o teste canônico exatamente de onde parou.',
        'Você já produziu as oito linhas públicas de delta, mas ainda não chamou a ferramenta real ask_user obrigatória.',
        'Não repita report_intent, read_file_content, exec_command nem as linhas de delta.',
        scenario.askToolInstruction,
        scenario.finalInstruction,
        'Depois do marcador final, pare imediatamente: não chame outra ferramenta, não escreva outra mensagem e aguarde o próximo comando humano.',
        `Antes da resposta humana final, não escreva, cite nem antecipe o marcador ${scenario.finalMarker}.`,
        `A pergunta ${scenario.askQuestion.split(':')[0]} deve ser feita pela tool ask_user real; não a simule como texto, Markdown, JSON ou pseudo-tool no transcript público.`,
        'Neste turno de recuperação, use somente a tool real ask_user antes da resposta humana.',
    ].join(' ');
}

function buildIncompleteExpectedToolRecoveryPrompt(
    scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID],
    missingTools = [],
) {
    const missing = missingTools.map((tool) => String(tool ?? '').trim()).filter(Boolean);
    const instructions = [];
    if (missing.includes('create_file')) {
        instructions.push(
            'Se create_file ainda estiver faltando, invoque create_file com path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-source.txt", content exatamente "TERMINAL-PERMISSION-ROUNDTRIP\\n", createParentDirs=true e overwrite=true.',
        );
    }
    if (missing.includes('move_file')) {
        instructions.push(
            'Se move_file ainda estiver faltando, invoque move_file com source exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-source.txt", destination exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-moved.txt" e overwrite=true.',
        );
    }
    if (missing.includes('delete_file')) {
        instructions.push(
            'Se delete_file ainda estiver faltando, invoque delete_file com path exatamente "data/copilot-terminal/live-scratch/TERMINAL-PERMISSION-ROUNDTRIP-moved.txt".',
        );
    }
    return [
        'Continue o teste canônico exatamente de onde parou.',
        `As tools esperadas ainda faltantes são: ${missing.join(', ') || 'nenhuma'}.`,
        'Não repita tools já concluídas; use somente as tools faltantes listadas acima.',
        ...instructions,
        'Depois que as tools faltantes concluírem, escreva exatamente as oito linhas públicas DELTA-CANONICAL-1 até DELTA-CANONICAL-8.',
        'Não invoque ask_user antes dessas oito linhas públicas aparecerem no transcript.',
        scenario.askToolInstruction,
        scenario.finalInstruction,
        `Antes da resposta humana final, não escreva, cite nem antecipe o marcador ${scenario.finalMarker}.`,
    ].join(' ');
}

function buildNoPrProbeCommands() {
    return [
        '/usage now',
        '/activity 20',
        '/session sdk 6',
        '/session sdk commands',
        '/session sdk events 20',
        '/session sdk waits 20',
        '/metrics',
        '/events 20',
        '/events 20 --raw',
        '/events 20 --json compact',
        '/events sources',
        '/errors 10',
        '/quit',
    ];
}

function buildByokProbeCommands({ fixtureBaseUrl = 'http://127.0.0.1:11434/v1' } = {}) {
    return [
        '/byok',
        '/byok env',
        '/byok providers',
        '/byok health',
        '/byok profiles',
        '/byok models refresh',
        '/byok models free reasoning safe 8',
        '/byok recommend free reasoning safe 5',
        '/byok use codex-fixture',
        '/byok providers',
        '/byok health',
        '/byok models refresh',
        '/byok models provider:openai-compatible free reasoning safe 8',
        '/byok recommend provider:openai-compatible 5',
        '/byok recommend free reasoning safe 5',
        '/byok model fixture/model-b',
        '/byok',
        `/byok provider openai-compatible fixture/model-c ${fixtureBaseUrl}`,
        '/byok',
        '/byok use sdk',
        '/byok',
        '/usage now',
        '/events 30',
        '/events 30 --raw',
        '/errors 10',
        '/quit',
    ];
}

function buildAutoProbeCommands({ profile = 'repo_agent' } = {}) {
    const routeProfile = profile || 'repo_agent';
    return [
        '/usage now',
        '/activity 20',
        '/byok gateway commands',
        { line: `/byok gateway operator-ready profile:${routeProfile} 5`, waitBeforeMs: 4_000 },
        '/byok auto policy',
        `/byok auto status profile:${routeProfile}`,
        `/byok auto doctor profile:${routeProfile}`,
        `/byok auto explain profile:${routeProfile}`,
        `/byok gateway auto profile:${routeProfile}`,
        `/byok auto apply profile:${routeProfile} allow-live-set-model`,
        '/activity 20',
        '/byok auto history 10',
        '/byok auto handoffs 10',
        '/byok auto confirmations 10',
        `/byok auto plan profile:${routeProfile} 5`,
        `/byok auto standby profile:${routeProfile} 5`,
        `/byok auto recovery-fixture profile:${routeProfile} provider:zai model:glm-4.5-flash failure:rate-limit`,
        '/byok auto recoveries 10',
        '/events 40',
        '/events 80 --raw',
        '/errors 10',
        '/quit',
    ];
}

function buildModelProbeCommands() {
    return [
        '/usage now',
        '/activity 20',
        '/model',
        '/model stats',
        '/model auto',
        '/model',
        '/model gpt-4.1-mini',
        '/model',
        '/activity 30',
        '/events 50',
        '/events 80 --raw',
        '/errors 10',
        '/quit',
    ];
}

function buildByokFixtureEnv({ baseUrl = 'http://127.0.0.1:11434/v1' } = {}) {
    const fixtureToken = ['codex', 'fixture', 'token', 'never', 'print'].join('-');
    return {
        COPILOT_BYOK_ENABLED: 'false',
        COPILOT_BYOK_MODEL_DISCOVERY_ENABLED: 'true',
        COPILOT_BYOK_MODELS: 'fixture/model-a,fixture/model-b',
        COPILOT_BYOK_PROFILES_JSON: JSON.stringify({
            'codex-fixture': {
                preset: 'openai-compatible',
                baseUrl,
                bearerToken: fixtureToken,
                model: 'fixture/model-a',
                models: 'fixture/model-a,fixture/model-b',
                modelDiscoveryEnabled: true,
                contextWindowTokens: 123456,
                supportsReasoning: true,
                supportsVision: false,
                metadata: {
                    owner: 'terminal-live',
                    purpose: 'byok-control-plane-fixture',
                },
            },
        }),
    };
}

async function loadDotenvLocalEnv() {
    try {
        const content = await readFile(path.join(ROOT, '.env.local'), 'utf8');
        return parseDotenv(content);
    } catch (error) {
        if (error?.code === 'ENOENT') return {};
        throw error;
    }
}

function collectSecretValues(env) {
    const values = [];
    for (const [key, value] of Object.entries(env)) {
        if (!SECRET_ENV_RE.test(key)) continue;
        if (typeof value !== 'string' || value.length < 8) continue;
        values.push({ key, value });
    }
    return values;
}

function hasSecretLeak(text, secretValues) {
    return secretValues.some(({ value }) => value.length > 0 && text.includes(value));
}

function parseProfilesJson(raw) {
    if (!raw || raw.trim() === '') return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function runtimeSelectorFallbackProfiles(raw) {
    return String(raw ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function optionalRuntimeSelectorString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function sdkWireApiForRuntimeRoute(wireApi) {
    const normalized = optionalRuntimeSelectorString(wireApi)?.replaceAll('-', '_') ?? '';
    if (normalized === 'openai_chat_completions' || normalized === 'chat_completions' || normalized === 'completions') {
        return 'completions';
    }
    if (normalized === 'openai_responses' || normalized === 'responses') return 'responses';
    return '';
}

function runtimeRouteSdkWireApi(selected) {
    const explicit = sdkWireApiForRuntimeRoute(selected?.wireApi);
    if (explicit) return explicit;
    const routeLayer = optionalRuntimeSelectorString(selected?.routeLayer) ?? '';
    const baseUrl =
        optionalRuntimeSelectorString(selected?.openAICompatibleBaseUrl) ||
        optionalRuntimeSelectorString(selected?.baseUrl);
    return baseUrl && routeLayer.includes('openai_compatible') ? 'completions' : '';
}

function parseRuntimeSelectorJsonOutput(text) {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

function selectRuntimeSelectorRoute(summary, requestedProfile) {
    const routes = Array.isArray(summary?.runtimeSelectorPlan?.routes) ? summary.runtimeSelectorPlan.routes : [];
    const requested = optionalRuntimeSelectorString(requestedProfile);
    const selectedRoutes = routes.filter((route) => route?.status === 'selected' && route?.selected);
    return selectedRoutes.find((route) => route.profileId === requested) ?? selectedRoutes[0] ?? null;
}

function selectRuntimeSelectorEffectiveRoute(summary, requestedProfile) {
    if (summary?.runtimeExecuted === true) {
        return summary.execution?.ok === true && summary.execution.final?.route?.selected
            ? summary.execution.final.route
            : null;
    }
    if (summary?.execution?.ok === true && summary.execution.final?.route?.selected) {
        return summary.execution.final.route;
    }
    return selectRuntimeSelectorRoute(summary, requestedProfile);
}

function runRuntimeSelectorLiveRoute({
    profileId,
    fallbackProfiles = [],
    execute = false,
    allowProbe = false,
    maxAttempts = 8,
    maxAttemptsPerProvider = 4,
    temporaryFailureCooldownMs = 0,
    timeoutMs = 45_000,
    selectionPolicy = '',
} = {}) {
    const requestedProfile = optionalRuntimeSelectorString(profileId);
    if (!requestedProfile) {
        return {
            requested: false,
            ok: true,
            status: null,
            executed: false,
            allowProbe,
            commandOk: true,
            profileId: '',
            fallbackProfiles: [],
            summary: null,
            selectedRoute: null,
            error: null,
        };
    }
    const args = [modelGatewayScriptPath('runtimeSelector'), '--json', '--fail', `--profile=${requestedProfile}`];
    if (allowProbe) args.push('--allow-probe');
    const normalizedFallbacks = runtimeSelectorFallbackProfiles(fallbackProfiles.join(','));
    if (normalizedFallbacks.length > 0) args.push(`--fallback-profiles=${normalizedFallbacks.join(',')}`);
    const normalizedSelectionPolicy = optionalRuntimeSelectorString(selectionPolicy).replaceAll('-', '_');
    if (normalizedSelectionPolicy) args.push(`--selection-policy=${normalizedSelectionPolicy}`);
    args.push(`--preferred-probes=${LIVE_PROTOCOL_PROBE_KINDS.join(',')}`);
    args.push(`--block-failed-probes=${LIVE_BLOCKING_PROBE_KINDS.join(',')}`);
    if (execute) {
        args.push(
            '--execute',
            '--attempts-per-route=1',
            `--max-attempts=${Math.max(1, Math.trunc(maxAttempts))}`,
            `--max-attempts-per-provider=${Math.max(1, Math.trunc(maxAttemptsPerProvider))}`,
            `--timeout-ms=${Math.max(1_000, Math.trunc(timeoutMs))}`,
        );
    }
    if (temporaryFailureCooldownMs > 0) {
        args.push(`--temporary-failure-cooldown-ms=${Math.max(1, Math.trunc(temporaryFailureCooldownMs))}`);
    }
    const result = spawnSync(process.execPath, args, {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
    });
    const summary = parseRuntimeSelectorJsonOutput(result.stdout);
    const selectedRoute = summary ? selectRuntimeSelectorEffectiveRoute(summary, requestedProfile) : null;
    const commandSucceeded = result.status === 0 && summary?.ok !== false;
    const executionSucceeded = !execute || summary?.execution?.ok === true;
    const routeUsable = Boolean(selectedRoute?.selected) && commandSucceeded && executionSucceeded;
    const summaryError =
        optionalRuntimeSelectorString(summary?.execution?.error) ||
        optionalRuntimeSelectorString(summary?.execution?.final?.error) ||
        optionalRuntimeSelectorString(summary?.routeDecisionPersistence?.error) ||
        optionalRuntimeSelectorString(summary?.runtimeProbePersistence?.error) ||
        optionalRuntimeSelectorString(summary?.runtimeHealthPersistence?.error) ||
        optionalRuntimeSelectorString(
            summary?.runtimeSelectorPlan?.routes?.find?.((route) => route?.status === 'blocked')?.reasons?.join(', '),
        );
    return {
        requested: true,
        ok: routeUsable,
        status: result.status,
        executed: execute,
        allowProbe,
        commandOk: summary?.ok === true && result.status === 0,
        profileId: requestedProfile,
        fallbackProfiles: normalizedFallbacks,
        summary,
        selectedRoute,
        error: routeUsable
            ? null
            : summaryError ||
              (result.stderr || result.stdout || `runtime selector exited with ${result.status}`).trim(),
    };
}

function profileHasUsableSecret(profileName, profile, env) {
    const tokenEnv = typeof profile?.bearerTokenEnv === 'string' ? profile.bearerTokenEnv : null;
    const apiKeyEnv = typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : null;
    if (tokenEnv && env[tokenEnv]) return true;
    if (apiKeyEnv && env[apiKeyEnv]) return true;
    if (/^kilo\b/iu.test(profileName)) return Boolean(env.KILO_CODE_API_KEY || env.KILO_API_KEY);
    if (/ollama-cloud/iu.test(profileName)) return Boolean(env.OLLAMA_CLOUD_API_KEY || env.OLLAMA_API_KEY);
    return Boolean(profile?.bearerToken || profile?.apiKey);
}

function chooseRealByokProfile(env, requestedProfile) {
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    if (requestedProfile) return requestedProfile;
    if (profiles.kilo && profileHasUsableSecret('kilo', profiles.kilo, env)) return 'kilo';
    if (profiles['ollama-cloud'] && profileHasUsableSecret('ollama-cloud', profiles['ollama-cloud'], env)) {
        return 'ollama-cloud';
    }
    const usable = Object.entries(profiles).find(([name, profile]) => profileHasUsableSecret(name, profile, env));
    return usable?.[0] ?? Object.keys(profiles)[0] ?? '';
}

function chooseAlternateByokProfile(env, activeProfile, requestedAltProfile) {
    if (requestedAltProfile) return requestedAltProfile === activeProfile ? '' : requestedAltProfile;
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    const first = Object.entries(profiles).find(
        ([name, profile]) => name !== activeProfile && profileHasUsableSecret(name, profile, env),
    );
    return first?.[0] ?? '';
}

function profileModel(env, profileName) {
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    const profile = profiles[profileName];
    return typeof profile?.model === 'string' && profile.model.trim() ? profile.model.trim() : '';
}

function profileProvider(env, profileName) {
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    const profile = profiles[profileName];
    for (const key of ['preset', 'providerType', 'provider', 'name']) {
        const value = profile?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return profileName || '';
}

function runtimeSelectorRouteDetails(runtimeSelector) {
    const selected = runtimeSelector?.selectedRoute?.selected;
    if (!selected) return null;
    const runtimeHealth =
        selected.runtimeHealth && typeof selected.runtimeHealth === 'object' ? selected.runtimeHealth : {};
    return {
        routeProfile: optionalRuntimeSelectorString(runtimeSelector.selectedRoute.profileId) || null,
        selectedRouteProfile: optionalRuntimeSelectorString(selected.routeProfile) || null,
        sourceRouteProfile: optionalRuntimeSelectorString(selected.sourceRouteProfile) || null,
        sourceTaskProfile: optionalRuntimeSelectorString(selected.sourceTaskProfile) || null,
        providerId: optionalRuntimeSelectorString(selected.providerId) || null,
        providerModel: optionalRuntimeSelectorString(selected.providerModel) || null,
        selectorKind: optionalRuntimeSelectorString(selected.selectorKind) || null,
        selectorSyntax: optionalRuntimeSelectorString(selected.selectorSyntax) || null,
        hasRuntimeProof: selected.hasRuntimeProof === true,
        verifiedProbes: Array.isArray(runtimeHealth.verifiedProbes)
            ? runtimeHealth.verifiedProbes.map(optionalRuntimeSelectorString).filter(Boolean)
            : [],
        failedProbes: Array.isArray(runtimeHealth.failedProbes)
            ? runtimeHealth.failedProbes.map(optionalRuntimeSelectorString).filter(Boolean)
            : [],
        routeLayer: optionalRuntimeSelectorString(selected.routeLayer) || null,
        wireApi: optionalRuntimeSelectorString(selected.wireApi) || null,
        sdkWireApi: runtimeRouteSdkWireApi(selected) || null,
        upstreamProvider: optionalRuntimeSelectorString(selected.upstreamProvider) || null,
        baseUrl:
            optionalRuntimeSelectorString(selected.openAICompatibleBaseUrl) ||
            optionalRuntimeSelectorString(selected.baseUrl) ||
            null,
        candidateSource: optionalRuntimeSelectorString(selected.candidateSource) || null,
        runtimeObservedOnly: selected.runtimeObservedOnly === true,
        runtimeEvidence:
            selected.runtimeEvidence &&
            typeof selected.runtimeEvidence === 'object' &&
            !Array.isArray(selected.runtimeEvidence)
                ? selected.runtimeEvidence
                : null,
    };
}

function buildRealByokRuntime({
    dotenvEnv,
    requestedProfile,
    requestedAltProfile,
    requestedModel,
    requestedAltModel,
    runtimeSelectorProfile,
    runtimeSelectorFallbackProfiles: fallbackProfiles = [],
    runtimeSelectorExecute = false,
    runtimeSelectorAllowProbe = false,
    runtimeSelectorMaxAttempts = 8,
    runtimeSelectorMaxAttemptsPerProvider = 4,
    runtimeSelectorTemporaryFailureCooldownMs = 0,
    runtimeSelectorTimeoutMs = 45_000,
    runtimeSelectorSelectionPolicy = '',
}) {
    const mergedEnv = { ...process.env, ...dotenvEnv };
    const routeSelectorMandatory = Boolean(optionalRuntimeSelectorString(runtimeSelectorProfile));
    const runtimeSelector = runRuntimeSelectorLiveRoute({
        profileId: runtimeSelectorProfile,
        fallbackProfiles,
        execute: runtimeSelectorExecute,
        allowProbe: runtimeSelectorAllowProbe,
        maxAttempts: runtimeSelectorMaxAttempts,
        maxAttemptsPerProvider: runtimeSelectorMaxAttemptsPerProvider,
        temporaryFailureCooldownMs: runtimeSelectorTemporaryFailureCooldownMs,
        timeoutMs: runtimeSelectorTimeoutMs,
        selectionPolicy: runtimeSelectorSelectionPolicy,
    });
    const runtimeRoute = runtimeSelectorRouteDetails(runtimeSelector);
    const profile = routeSelectorMandatory ? '' : chooseRealByokProfile(mergedEnv, requestedProfile);
    const altProfile = routeSelectorMandatory
        ? ''
        : chooseAlternateByokProfile(mergedEnv, profile, requestedAltProfile);
    const model =
        runtimeRoute?.providerModel ||
        (!routeSelectorMandatory ? requestedModel || profileModel(mergedEnv, profile) : '');
    const altModel = requestedAltModel || profileModel(mergedEnv, altProfile);
    const provider = runtimeRoute?.providerId || (!routeSelectorMandatory ? profileProvider(mergedEnv, profile) : '');
    const altProvider = profileProvider(mergedEnv, altProfile);
    return {
        env: {
            ...dotenvEnv,
            COPILOT_BYOK_ENABLED: 'true',
            ...(routeSelectorMandatory || runtimeRoute
                ? {
                      COPILOT_BYOK_PROFILE: '',
                      COPILOT_BYOK_PROVIDER_PRESET: runtimeRoute?.providerId ?? '',
                      COPILOT_BYOK_MODEL: model || '',
                      COPILOT_BYOK_BASE_URL: runtimeRoute?.baseUrl ?? '',
                      COPILOT_BYOK_WIRE_API: runtimeRoute?.sdkWireApi ?? '',
                  }
                : profile
                  ? { COPILOT_BYOK_PROFILE: profile }
                  : {}),
            COPILOT_BYOK_MODEL_DISCOVERY_ENABLED: mergedEnv.COPILOT_BYOK_MODEL_DISCOVERY_ENABLED ?? 'true',
        },
        profile,
        altProfile,
        model,
        altModel,
        provider,
        altProvider,
        runtimeSelector,
        runtimeRoute,
        redacted: {
            enabled: true,
            profile: profile || null,
            altProfile: altProfile || null,
            model: model || null,
            altModel: altModel || null,
            provider: provider || null,
            altProvider: altProvider || null,
            runtimeSelector: {
                requested: runtimeSelector.requested,
                ok: runtimeSelector.ok,
                status: runtimeSelector.status,
                executed: runtimeSelector.executed,
                allowProbe: runtimeSelector.allowProbe,
                commandOk: runtimeSelector.commandOk,
                profileId: runtimeSelector.profileId || null,
                fallbackProfiles: runtimeSelector.fallbackProfiles,
                selectionPolicy: runtimeSelector.summary?.selectionPolicy ?? null,
                selected: runtimeRoute,
                execution: runtimeSelector.summary?.execution
                    ? {
                          ok: runtimeSelector.summary.execution.ok,
                          status: runtimeSelector.summary.execution.status,
                          attemptedCount: runtimeSelector.summary.execution.attemptedCount,
                          skippedAttemptCount: runtimeSelector.summary.execution.skippedAttemptCount ?? 0,
                          selectedProfileId: runtimeSelector.summary.execution.selectedProfileId,
                          error: runtimeSelector.summary.execution.error,
                      }
                    : null,
                routeDecisionPersistence: runtimeSelector.summary?.routeDecisionPersistence
                    ? {
                          attempted: runtimeSelector.summary.routeDecisionPersistence.attempted === true,
                          ok: runtimeSelector.summary.routeDecisionPersistence.ok === true,
                          written: Number(runtimeSelector.summary.routeDecisionPersistence.written ?? 0),
                          error: runtimeSelector.summary.routeDecisionPersistence.error ?? null,
                      }
                    : null,
                runtimeProbePersistence: runtimeSelector.summary?.runtimeProbePersistence
                    ? {
                          attempted: runtimeSelector.summary.runtimeProbePersistence.attempted === true,
                          ok: runtimeSelector.summary.runtimeProbePersistence.ok === true,
                          runId: runtimeSelector.summary.runtimeProbePersistence.runId ?? null,
                          probeResults: Number(runtimeSelector.summary.runtimeProbePersistence.probeResults ?? 0),
                          skippedResults: Number(runtimeSelector.summary.runtimeProbePersistence.skippedResults ?? 0),
                          successCount: Number(runtimeSelector.summary.runtimeProbePersistence.successCount ?? 0),
                          failureCount: Number(runtimeSelector.summary.runtimeProbePersistence.failureCount ?? 0),
                          error: runtimeSelector.summary.runtimeProbePersistence.error ?? null,
                      }
                    : null,
                runtimeHealthPersistence: runtimeSelector.summary?.runtimeHealthPersistence
                    ? {
                          attempted: runtimeSelector.summary.runtimeHealthPersistence.attempted === true,
                          ok: runtimeSelector.summary.runtimeHealthPersistence.ok === true,
                          runId: runtimeSelector.summary.runtimeHealthPersistence.runId ?? null,
                          records: Number(runtimeSelector.summary.runtimeHealthPersistence.records ?? 0),
                          healthObservations: Number(
                              runtimeSelector.summary.runtimeHealthPersistence.healthObservations ?? 0,
                          ),
                          probeResults: Number(runtimeSelector.summary.runtimeHealthPersistence.probeResults ?? 0),
                          skippedRecords: Number(runtimeSelector.summary.runtimeHealthPersistence.skippedRecords ?? 0),
                          error: runtimeSelector.summary.runtimeHealthPersistence.error ?? null,
                      }
                    : null,
                error: runtimeSelector.error ? runtimeSelector.error.slice(0, 800) : null,
            },
            dotenvLocalLoaded: Object.keys(dotenvEnv).length > 0,
            secretKeysPresent: collectSecretValues(mergedEnv)
                .map(({ key }) => key)
                .sort(),
        },
    };
}

function byokLiveRouteIdentity(realByok) {
    const selected = realByok?.redacted?.runtimeSelector?.selected ?? {};
    const routeProfile =
        optionalRuntimeSelectorString(selected.routeProfile) ||
        optionalRuntimeSelectorString(realByok?.redacted?.runtimeSelector?.profileId) ||
        optionalRuntimeSelectorString(realByok?.redacted?.profile) ||
        null;
    const providerId =
        optionalRuntimeSelectorString(selected.providerId) ||
        optionalRuntimeSelectorString(realByok?.redacted?.provider) ||
        null;
    const providerModel =
        optionalRuntimeSelectorString(selected.providerModel) ||
        optionalRuntimeSelectorString(realByok?.redacted?.model) ||
        null;
    return { routeProfile, providerId, providerModel };
}

function renderedReadFileToolOk(plain) {
    return (
        (/\[LER\].*(?:read_file_content|Ler arquivo)/s.test(plain) ||
            /Ferramenta\s+Ler arquivo\s+·\s+lendo arquivo/s.test(plain)) &&
        (/✅ \[OK\].*(?:read_file_content|Ler arquivo)/s.test(plain) ||
            /Conclu[ií]do\s+(?:ok\s+)?Ler arquivo\s+·\s+lendo arquivo conclu[ií]do/s.test(plain))
    );
}

function defaultToolNarrationLines(plain) {
    return String(plain ?? '')
        .split(/\r?\n/u)
        .filter((line) => /\[(?:TOOL|INTENT|DONE|TOOLS|ASK)\]/u.test(line) || /^\s*(?:Ferramenta|Conclu[ií]do)\s/u.test(line));
}

function hasRawInternalIdInDefaultToolNarration(plain) {
    return defaultToolNarrationLines(plain).some((line) =>
        /(?:chatcmpl-tool-|toolu_|report_intent_local \(alias:)/iu.test(line),
    );
}

function extractHealthToolStatsSection(plain) {
    const match = String(plain ?? '').match(
        /(?:TOOL STATS|Ferramentas por lat[eê]ncia)[^\n]*\n(?<body>[\s\S]*?)(?:\n\s*[─╚]|você\[|$)/iu,
    );
    return match?.groups?.body?.trim() ?? '';
}

function healthToolStatsUseHumanNames(plain) {
    const section = extractHealthToolStatsSection(plain);
    if (!section) return false;
    if (/\b(?:read_file_content|report_intent_local)\b/u.test(section)) return false;
    return /(?:Ler arquivo|Intenção capturada)/u.test(section);
}

function byokLiveMaterializationState(plain, criteria = [], scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    const passed = new Set(criteria.filter((criterion) => criterion?.pass === true).map((criterion) => criterion.id));
    return {
        toolProtocolOk: passed.has('tool-start-done') && renderedReadFileToolOk(plain),
        askUserOk:
            passed.has('ask-user-visible') &&
            passed.has('ask-user-answer') &&
            passed.has('post-ask-final-visible') &&
            scenario.askRenderedRe.test(plain) &&
            scenario.postAskFinalRe.test(plain),
    };
}

async function recordByokLiveProtocolHealth({
    realByok,
    blocker,
    criteria,
    plain,
    startedAt,
    durationMs,
    noPr,
    byokControlProbe,
}) {
    if (!realByok || noPr || byokControlProbe)
        return { attempted: false, recorded: false, reason: 'not_full_byok_live_turn' };
    const identity = byokLiveRouteIdentity(realByok);
    if (!identity.providerId || !identity.providerModel) {
        return { attempted: true, recorded: false, reason: 'missing_route_identity', identity };
    }
    const timestamp = Date.parse(startedAt) + Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    if (blocker?.id === 'byok-provider-turn-failed') {
        try {
            const {
                classifyByokProviderFailure,
                flushByokProviderHealth,
                recordByokProviderModelCallFailure,
                recordByokProviderModelProbeResult,
            } = await import('../../../src/copilot/model-gateway/index.js');
            const providerFailure = classifyByokProviderFailure(
                new Error(`${blocker.detail ?? 'BYOK provider turn failed'}\n${plain.slice(-2000)}`),
            );
            recordByokProviderModelCallFailure({
                ...identity,
                message: providerFailure.message,
                errorContext: 'terminal_live_provider_turn',
                failureKind: providerFailure.kind,
                failureStatusCode: providerFailure.statusCode,
                retryAfterSeconds: providerFailure.retryAfterSeconds,
                resetAt: providerFailure.resetAt,
                timestamp,
            });
            recordByokProviderModelProbeResult({
                ...identity,
                probeKind: LIVE_TURN_PROBE_KIND,
                status: 'failed',
                ok: false,
                providerAttempted: true,
                message: providerFailure.operatorLabel,
                errorContext: 'terminal_live_provider_turn',
                failureKind: providerFailure.kind,
                failureStatusCode: providerFailure.statusCode,
                retryAfterSeconds: providerFailure.retryAfterSeconds,
                resetAt: providerFailure.resetAt,
                timestamp,
            });
            await flushByokProviderHealth();
            return {
                attempted: true,
                recorded: true,
                identity,
                providerFailure: {
                    kind: providerFailure.kind,
                    statusCode: providerFailure.statusCode,
                    errorContext: providerFailure.errorContext,
                },
                probes: [
                    {
                        probeKind: LIVE_TURN_PROBE_KIND,
                        status: 'failed',
                        ok: false,
                        errorContext: 'terminal_live_provider_turn',
                    },
                ],
            };
        } catch (error) {
            return {
                attempted: true,
                recorded: false,
                identity,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }
    if (blocker && blocker.id !== 'byok-live-tool-protocol-missed') {
        return {
            attempted: false,
            recorded: false,
            reason: `live_turn_not_attempted:${blocker.id}`,
        };
    }
    const materialized = byokLiveMaterializationState(plain, criteria);
    const blockedByProtocol = blocker?.id === 'byok-live-tool-protocol-missed';
    const probeInputs = [
        {
            probeKind: LIVE_TURN_PROBE_KIND,
            ok: !blockedByProtocol && materialized.toolProtocolOk && materialized.askUserOk,
            status: !blockedByProtocol && materialized.toolProtocolOk && materialized.askUserOk ? 'ok' : 'failed',
            message:
                !blockedByProtocol && materialized.toolProtocolOk && materialized.askUserOk
                    ? 'terminal live turn completed canonical SDK tool and ask_user handshake'
                    : (blocker?.detail ??
                      'terminal live turn did not complete the canonical SDK tool and ask_user handshake'),
            errorContext: blockedByProtocol ? 'terminal_live_turn_protocol' : 'terminal_live_turn_validation',
        },
        {
            probeKind: 'live_tool_protocol',
            ok: !blockedByProtocol && materialized.toolProtocolOk,
            status: !blockedByProtocol && materialized.toolProtocolOk ? 'ok' : 'failed',
            message:
                !blockedByProtocol && materialized.toolProtocolOk
                    ? 'terminal live turn materialized required SDK tools'
                    : (blocker?.detail ?? 'terminal live turn did not materialize required SDK tool protocol'),
            errorContext: blockedByProtocol ? 'terminal_live_tool_protocol' : 'terminal_live_tool_protocol_validation',
        },
        {
            probeKind: 'live_ask_user',
            ok: !blockedByProtocol && materialized.askUserOk,
            status: !blockedByProtocol && materialized.askUserOk ? 'ok' : 'failed',
            message:
                !blockedByProtocol && materialized.askUserOk
                    ? 'terminal live turn materialized ask_user, answer, and post-ask final'
                    : (blocker?.detail ?? 'terminal live turn did not complete real ask_user handshake'),
            errorContext: blockedByProtocol ? 'terminal_live_ask_user' : 'terminal_live_ask_user_validation',
        },
    ];
    try {
        const { flushByokProviderHealth, recordByokProviderModelProbeResult } =
            await import('../../../src/copilot/model-gateway/index.js');
        for (const probe of probeInputs) {
            recordByokProviderModelProbeResult({
                ...identity,
                probeKind: probe.probeKind,
                status: probe.status,
                ok: probe.ok,
                providerAttempted: true,
                message: probe.message,
                errorContext: probe.errorContext,
                failureKind: probe.ok ? null : 'tool_protocol',
                timestamp,
            });
        }
        await flushByokProviderHealth();
        return {
            attempted: true,
            recorded: true,
            identity,
            probes: probeInputs.map(({ probeKind, status, ok, errorContext }) => ({
                probeKind,
                status,
                ok,
                errorContext,
            })),
        };
    } catch (error) {
        return {
            attempted: true,
            recorded: false,
            identity,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

function buildByokCatalogCommands(provider) {
    const providerFilter = provider ? ` provider:${provider}` : '';
    return [
        `/byok models refresh${providerFilter}`,
        `/byok models free reasoning safe 8${providerFilter}`,
        `/byok recommend reasoning safe 8${providerFilter}`,
        `/byok probe shortlist free reasoning safe 1 timeout:60000${providerFilter}`,
    ];
}

function buildByokRouteCommand(provider, routeProfile = 'repo_agent') {
    const providerFilter = provider ? ` provider:${provider}` : '';
    return `/byok models route ${routeProfile || 'repo_agent'} active --show-rejected${providerFilter}`;
}

function buildRuntimeSelectorProviderCommand(runtimeRoute) {
    if (!runtimeRoute?.providerId || !runtimeRoute.providerModel) return '';
    return [
        '/byok provider',
        runtimeRoute.providerId,
        runtimeRoute.providerModel,
        runtimeRoute.baseUrl || '',
        runtimeRoute.sdkWireApi ? `wire:${runtimeRoute.sdkWireApi}` : '',
    ]
        .filter(Boolean)
        .join(' ');
}

function buildByokRealPreflightCommands({ profile, altProfile, model, altModel, provider, altProvider, runtimeRoute }) {
    const commands = ['/session sdk 8', runtimeRoute ? '/byok reload --no-status' : '/byok reload'];
    const runtimeProviderCommand = buildRuntimeSelectorProviderCommand(runtimeRoute);
    if (runtimeProviderCommand) {
        commands.push(runtimeProviderCommand);
    } else {
        if (profile) commands.push(`/byok use ${profile}`);
        if (model) commands.push(`/byok model ${model}`);
    }
    commands.push('/byok env', '/byok providers', '/byok health', '/byok profiles');
    commands.push(
        '/byok',
        buildByokRouteCommand(provider, runtimeRoute?.routeProfile ?? 'repo_agent'),
        '/byok probe timeout:45000',
        '/byok probe streaming timeout:60000',
        '/byok probe json timeout:60000',
        '/byok probe vision timeout:60000',
        '/byok probe agent timeout:60000',
        '/session sdk 8',
        ...buildByokCatalogCommands(provider),
    );
    if (!runtimeRoute && altModel && altModel !== model) {
        commands.push(`/byok model ${altModel}`, '/byok');
    }
    if (!runtimeRoute && model) {
        commands.push(`/byok model ${model}`, '/byok');
    }
    if (!runtimeRoute && altProfile) {
        commands.push(
            `/byok use ${altProfile}`,
            '/byok',
            '/byok providers',
            '/byok health',
            ...buildByokCatalogCommands(altProvider),
        );
        if (profile) {
            commands.push(`/byok use ${profile}`);
            if (model) commands.push(`/byok model ${model}`);
            commands.push('/byok');
        }
    }
    return commands;
}

function buildByokRealNoPrDiagnosticCommands() {
    return [
        '/usage now',
        '/activity 20',
        '/session sdk commands',
        '/session sdk events 40',
        '/session sdk waits 40',
        '/metrics',
        '/events 60',
        '/events 100 --raw',
        '/errors 10',
    ];
}

function startByokFixtureProviderServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url === '/v1/models' || req.url === '/models') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(
                    JSON.stringify({
                        object: 'list',
                        data: [
                            { id: 'fixture/model-a', object: 'model' },
                            { id: 'fixture/model-b', object: 'model' },
                            { id: 'fixture/model-remote-c', object: 'model' },
                        ],
                    }),
                );
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('BYOK fixture provider did not expose a TCP address'));
                return;
            }
            server.unref();
            resolve({
                baseUrl: `http://127.0.0.1:${address.port}/v1`,
                close: () =>
                    new Promise((closeResolve) => {
                        server.close(() => closeResolve());
                    }),
            });
        });
    });
}

function sendCommandSequence(write, commands, { delayMs = 250 } = {}) {
    commands.forEach((commandLine, index) => {
        setTimeout(() => write(commandLine), index * delayMs).unref();
    });
}

function normalizeLiveCommandEntry(entry) {
    if (typeof entry === 'string') return { line: entry, waitBeforeMs: 0, advanceAfterMs: 0, waitFor: null };
    if (!entry || typeof entry !== 'object') return { line: '', waitBeforeMs: 0, advanceAfterMs: 0, waitFor: null };
    return {
        line: typeof entry.line === 'string' ? entry.line : '',
        waitBeforeMs: Number.isFinite(entry.waitBeforeMs) ? Math.max(0, Number(entry.waitBeforeMs)) : 0,
        advanceAfterMs: Number.isFinite(entry.advanceAfterMs) ? Math.max(0, Number(entry.advanceAfterMs)) : 0,
        waitFor: typeof entry.waitFor === 'string' || entry.waitFor instanceof RegExp ? entry.waitFor : null,
    };
}

function liveWaitForMatched(waitFor, text) {
    if (!waitFor) return true;
    const value = String(text ?? '');
    if (typeof waitFor === 'string') return value.includes(waitFor);
    waitFor.lastIndex = 0;
    return waitFor.test(value);
}

function extractSdkSessionCockpitId(plain, label) {
    const match = String(plain ?? '').match(new RegExp(`\\b${escapeRegExp(label)}:\\s+([^\\s]+)`, 'iu'));
    const sessionId = match?.[1]?.trim();
    return sessionId && !sessionId.startsWith('(') ? sessionId : '';
}

function sessionCycleBootCriteria(boot, { expectCreated = false, expectResumed = false } = {}) {
    const plain = String(boot?.plain ?? '');
    return [
        {
            id: `${boot.id}-ready`,
            pass: /LLM-B pronta/u.test(plain),
            detail: `${boot.label} reached the REPL ready state`,
        },
        {
            id: `${boot.id}-cockpit`,
            pass: /\bSessão SDK\b/u.test(plain) && /\bPróximo boot:/u.test(plain),
            detail: `${boot.label} rendered the SDK session cockpit`,
        },
        {
            id: `${boot.id}-clean-close`,
            pass: boot.exitCode === 0 && !/ERR_USE_AFTER_CLOSE|UnhandledPromiseRejection|EPIPE/iu.test(plain),
            detail: `${boot.label} closed without redraw/stdin lifecycle errors`,
        },
        ...(expectCreated
            ? [
                  {
                      id: `${boot.id}-new-boot`,
                      pass: /último boot:\s+created\s+·\s+request=new/iu.test(plain),
                      detail: `${boot.label} consumed the scheduled next-boot create-new directive`,
                  },
              ]
            : []),
        ...(expectResumed
            ? [
                  {
                      id: `${boot.id}-resume-boot`,
                      pass: /último boot:\s+resumed\s+·\s+request=resume/iu.test(plain),
                      detail: `${boot.label} consumed the scheduled next-boot resume directive`,
                  },
              ]
            : []),
    ];
}

async function runSessionCycleBoot({ id, label, outDir, commands, terminalPort, requestedTransport, timeoutMs }) {
    const canUsePty = requestedTransport === 'pty' && hasCommand('script');
    const transport = canUsePty ? 'pty:script' : 'stdio:headless';
    const command = buildTerminalLlmbCommand(canUsePty);
    let raw = '';
    let ready = false;
    let childClosed = false;
    let waitingForPrompt = false;
    let activeWaitFor = null;
    let commandOutputOffset = 0;
    let commandPromptWaitStartedAt = 0;
    /** @type {NodeJS.Timeout | null} */
    let promptFallbackTimer = null;
    const remainingCommands = [...commands];
    const child = spawn(command.cmd, command.args, {
        cwd: ROOT,
        env: {
            ...process.env,
            COPILOT_MODEL: 'auto',
            COPILOT_REASONING_EFFORT: 'high',
            TERMINAL_DISPLAY_PRESET: process.env.TERMINAL_DISPLAY_PRESET ?? 'default',
            COPILOT_SDK_ENABLED: 'true',
            COPILOT_OPERATIONAL_PROFILE: 'production',
            LLM_B_TERMINAL_PORT: String(terminalPort),
            TERMINAL_SSE_EVENT_ARCHIVE_DIR: path.join(outDir, `${id}-sse-events`),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const write = (line) => {
        if (childClosed || child.stdin.destroyed || child.stdin.writableEnded) return false;
        try {
            return child.stdin.write(ensureLine(line));
        } catch (error) {
            if (error?.code !== 'EPIPE') {
                console.warn(`[terminal-live] ${label} write failed: ${error?.message ?? String(error)}`);
            }
            return false;
        }
    };
    const sendNextCommand = () => {
        if (promptFallbackTimer) {
            clearTimeout(promptFallbackTimer);
            promptFallbackTimer = null;
        }
        const next = remainingCommands.shift();
        if (!next) return;
        const entry = normalizeLiveCommandEntry(next);
        if (!entry.line.trim()) return sendNextCommand();
        const send = () => {
            waitingForPrompt = entry.line.trim() !== '/quit';
            activeWaitFor = entry.waitFor;
            commandOutputOffset = stripAnsi(raw).length;
            commandPromptWaitStartedAt = Date.now();
            write(entry.line);
            if (waitingForPrompt && entry.advanceAfterMs > 0) {
                promptFallbackTimer = setTimeout(() => {
                    promptFallbackTimer = null;
                    if (!waitingForPrompt || childClosed) return;
                    const plain = stripAnsi(raw);
                    const commandOutput = stripAnsi(raw).slice(commandOutputOffset);
                    const waitForMatched = liveWaitForMatched(activeWaitFor, commandOutput);
                    const promptReturned = hasReturnedToReplPrompt(plain, commandOutputOffset);
                    const timedOutWaitingForPrompt =
                        Date.now() - commandPromptWaitStartedAt >= SESSION_CYCLE_PROMPT_STABLE_MAX_WAIT_MS;
                    if (!waitForMatched || (!promptReturned && !timedOutWaitingForPrompt)) {
                        promptFallbackTimer = setTimeout(() => {
                            promptFallbackTimer = null;
                            if (!waitingForPrompt || childClosed) return;
                            const latestPlain = stripAnsi(raw);
                            const latestOutput = latestPlain.slice(commandOutputOffset);
                            if (
                                liveWaitForMatched(activeWaitFor, latestOutput) &&
                                (hasReturnedToReplPrompt(latestPlain, commandOutputOffset) ||
                                    Date.now() - commandPromptWaitStartedAt >= SESSION_CYCLE_PROMPT_STABLE_MAX_WAIT_MS)
                            ) {
                                waitingForPrompt = false;
                                activeWaitFor = null;
                                sendNextCommand();
                            } else {
                                promptFallbackTimer = setTimeout(() => {
                                    promptFallbackTimer = null;
                                    if (!waitingForPrompt || childClosed) return;
                                    waitingForPrompt = false;
                                    activeWaitFor = null;
                                    sendNextCommand();
                                }, entry.advanceAfterMs);
                                promptFallbackTimer.unref();
                            }
                        }, entry.advanceAfterMs);
                        promptFallbackTimer.unref();
                        return;
                    }
                    waitingForPrompt = false;
                    activeWaitFor = null;
                    sendNextCommand();
                }, entry.advanceAfterMs);
                promptFallbackTimer.unref();
            }
        };
        if (entry.waitBeforeMs > 0) {
            const timer = setTimeout(send, entry.waitBeforeMs);
            timer.unref();
        } else {
            send();
        }
    };
    child.stdin.on('error', (error) => {
        if (error?.code !== 'EPIPE') {
            console.warn(`[terminal-live] ${label} stdin error: ${error?.message ?? String(error)}`);
        }
    });
    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        raw += text;
        process.stdout.write(text);
        const plain = stripAnsi(raw);
        if (!ready && /LLM-B pronta/u.test(plain)) {
            ready = true;
            sendNextCommand();
            return;
        }
        const commandOutput = plain.slice(commandOutputOffset);
        if (
            waitingForPrompt &&
            hasReturnedToReplPrompt(plain, commandOutputOffset) &&
            liveWaitForMatched(activeWaitFor, commandOutput)
        ) {
            waitingForPrompt = false;
            activeWaitFor = null;
            if (promptFallbackTimer) {
                clearTimeout(promptFallbackTimer);
                promptFallbackTimer = null;
            }
            sendNextCommand();
        }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timeout = setTimeout(
        () => {
            write('/quit');
            setTimeout(() => child.kill('SIGTERM'), 2_000).unref();
        },
        Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
    );
    const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
            childClosed = true;
            resolve(code);
        });
    });
    clearTimeout(timeout);
    const plain = stripAnsi(raw);
    await writeFile(path.join(outDir, `${id}.raw.log`), raw, 'utf8');
    await writeFile(path.join(outDir, `${id}.plain.log`), plain, 'utf8');
    return {
        id,
        label,
        exitCode,
        raw,
        plain,
        sessionId: extractSdkSessionCockpitId(plain, 'atual'),
        lastSessionId: extractSdkSessionCockpitId(plain, 'last SDK'),
        transport,
    };
}

async function runSessionCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot1 = await runSessionCycleBoot({
        id: 'session-cycle-boot-1',
        label: 'boot 1 / schedule new',
        outDir,
        commands: ['/session sdk', '/session sdk next new', '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const resumeTarget = boot1.lastSessionId || boot1.sessionId || 'last';
    const boot2 = await runSessionCycleBoot({
        id: 'session-cycle-boot-2',
        label: 'boot 2 / create new and schedule resume',
        outDir,
        commands: ['/session sdk', `/session sdk next resume ${resumeTarget}`, '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const boot3 = await runSessionCycleBoot({
        id: 'session-cycle-boot-3',
        label: 'boot 3 / resume prior session and restore auto',
        outDir,
        commands: ['/session sdk', '/session sdk next auto', '/session sdk', '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const boots = [boot1, boot2, boot3];
    const criteria = [
        ...sessionCycleBootCriteria(boot1),
        {
            id: 'session-cycle-schedule-new',
            pass: /Próximo boot:\s+criar nova sessão SDK/iu.test(boot1.plain),
            detail: 'boot 1 scheduled SDK new-session selection for the next boot',
        },
        {
            id: 'session-cycle-resume-target',
            pass: Boolean(boot1.lastSessionId || boot1.sessionId),
            detail: `boot 1 exposed a resumable SDK target (${resumeTarget})`,
        },
        ...sessionCycleBootCriteria(boot2, { expectCreated: true }),
        {
            id: 'session-cycle-schedule-resume',
            pass:
                Boolean(resumeTarget) &&
                new RegExp(`Próximo boot:\\s+tentar retomar sessão SDK ${escapeRegExp(resumeTarget)}`, 'iu').test(
                    boot2.plain,
                ),
            detail: 'boot 2 scheduled explicit resume of a listed pre-cycle SDK session',
        },
        ...sessionCycleBootCriteria(boot3, { expectResumed: true }),
        {
            id: 'session-cycle-restore-auto',
            pass: /seleção automática restaurada/iu.test(boot3.plain) && /próximo boot:\s+auto/iu.test(boot3.plain),
            detail: 'boot 3 cleared the explicit selector and rendered next boot as auto again',
        },
    ];
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        resumeTarget,
        boots: boots.map((boot) => ({
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            lastSessionId: boot.lastSessionId || null,
            transport: boot.transport,
        })),
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B SDK Session Cycle Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            `Resume target: ${resumeTarget}`,
            '',
            '## Boots',
            '',
            ...summary.boots.map(
                (boot) =>
                    `- ${boot.id}: ${boot.label} · exit=${String(boot.exitCode)} · session=${boot.sessionId ?? '-'} · last=${boot.lastSessionId ?? '-'} · ${boot.transport}`,
            ),
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function structuredInputCycleCriteria(boot) {
    const plain = String(boot?.plain ?? '');
    const answerConfirmationRe = /Resposta\s+enviada para pergunta pendente/u;
    return [
        {
            id: 'structured-input-ready',
            pass: /LLM-B pronta/u.test(plain),
            detail: 'terminal reached ready state before synthetic request_user_input cycle',
        },
        {
            id: 'structured-input-simulated',
            pass:
                /Pergunta humana estruturada/iu.test(plain) &&
                /diagnóstico de pergunta estruturada/iu.test(plain) &&
                /REQUEST_USER_INPUT-SIM:\s+responda para fechar o teste/iu.test(plain),
            detail: '/sdk simulate pergunta rendered a human-facing diagnostic request',
        },
        {
            id: 'structured-input-calm-boot-copy',
            pass: !/\bAlwaysAliveAgent\b|\bSTANDALONE\b|Registry local ativo|\[brief:(?:boot|ready)\]/iu.test(plain),
            detail: 'default boot/lifecycle copy avoided raw agent names, standalone jargon, and bracketed brief prefixes',
        },
        {
            id: 'structured-input-prompt-tag',
            pass: /você\[[^\]\n]+\/[^\]\n]+\](?:\[[^\]\n]+\])*\[PERG(?:UNTA)?\]›/iu.test(plain),
            detail: 'REPL prompt marked the pending structured input as [PERGUNTA] or compact [PERG]',
        },
        {
            id: 'structured-input-human-card',
            pass:
                /Pergunta humana estruturada\s+·\s+aguardando operador/iu.test(plain) &&
                /Origem\s+diagnóstico de pergunta estruturada/iu.test(plain) &&
                /Hora\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(plain) &&
                /qualquer texto livre/iu.test(plain),
            detail: 'request_user_input rendered as a durable human question card with source, ISO timestamp and free-text action',
        },
        {
            id: 'structured-input-waits-pending',
            pass: /1 pergunta estruturada/iu.test(plain),
            detail: '/sdk waits saw one pending structured input before the answer',
        },
        {
            id: 'structured-input-no-default-id-leak',
            pass: !/request-user-input-[a-z0-9-]+/iu.test(plain),
            detail: 'default structured input UX hid internal request ids; detail mode remains available',
        },
        {
            id: 'structured-input-answer-routed',
            pass: answerConfirmationRe.test(plain) && /TALVEZ LIVRE - fora das opções/iu.test(plain),
            detail: 'plain human answer outside choices was routed to the pending structured input',
        },
        {
            id: 'structured-input-waits-cleared',
            pass: /0 perguntas estruturadas/iu.test(plain) && /Sem bloqueios de input humano do SDK/u.test(plain),
            detail: '/sdk waits confirmed that the structured input was cleared after answer',
        },
        {
            id: 'structured-input-no-durable-spam',
            pass: !/request_user_input ainda executando|LLM-B ainda trabalhando|chatcmpl-tool-[a-z0-9-]+|ask_user SDK/iu.test(
                plain,
            ),
            detail: 'structured input cycle did not print old durable waiting spam, raw ids, or SDK ask_user labels',
        },
        {
            id: 'structured-input-clean-close',
            pass: boot.exitCode === 0 && hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal closed cleanly after structured input cycle with human shutdown copy',
        },
    ];
}

async function runStructuredInputCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot = await runSessionCycleBoot({
        id: 'structured-input-cycle',
        label: 'structured request_user_input',
        outDir,
        commands: [
            '/sdk simulate pergunta --choices SIM|NAO --required REQUEST_USER_INPUT-SIM: responda para fechar o teste',
            { line: '/sdk waits', waitBeforeMs: 1_500, advanceAfterMs: 1_500 },
            'TALVEZ LIVRE - fora das opções',
            { line: '/sdk waits', advanceAfterMs: 1_500 },
            '/quit',
        ],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const criteria = structuredInputCycleCriteria(boot);
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        boot: {
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            transport: boot.transport,
        },
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B Structured Input Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
            '## Logs',
            '',
            `- raw: ${path.relative(ROOT, path.join(outDir, 'structured-input-cycle.raw.log'))}`,
            `- plain: ${path.relative(ROOT, path.join(outDir, 'structured-input-cycle.plain.log'))}`,
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function menuCycleCriteria(boot) {
    const plain = String(boot?.plain ?? '');
    const menuStartIndex = plain.indexOf('Painel de ações');
    const menuPlain = menuStartIndex >= 0 ? plain.slice(menuStartIndex) : plain;
    return [
        {
            id: 'menu-cycle-ready',
            pass: /LLM-B pronta/u.test(plain),
            detail: 'terminal reached ready state before opening the command palette',
        },
        {
            id: 'menu-cycle-themed-actions',
            pass:
                /Painel de ações/u.test(plain) &&
                /#01\s+Status completo\s+·\s+\/status/iu.test(plain) &&
                !/\[01\]/u.test(menuPlain),
            detail: '/menu rendered themed one-action rows without the old bracket table',
        },
        {
            id: 'menu-cycle-human-copy',
            pass:
                /pergunta pendente/iu.test(menuPlain) &&
                !/pending question|troubleshooting|Command Palette|Health|binding|prompt freshness|billing|╔|╚/iu.test(
                    menuPlain,
                ),
            detail: '/menu default copy avoided old technical English and decorative box chrome',
        },
        {
            id: 'menu-cycle-quick-actions',
            pass: /Executar[\s\S]*\/menu <n>[\s\S]*\/menu <id>[\s\S]*\/menu picker/iu.test(menuPlain),
            detail: '/menu rendered compact execution guidance footer',
        },
        {
            id: 'menu-cycle-clean-close',
            pass: boot.exitCode === 0 && hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal closed cleanly after menu cycle with human shutdown copy',
        },
    ];
}

async function runMenuCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot = await runSessionCycleBoot({
        id: 'menu-cycle',
        label: 'compact command palette',
        outDir,
        commands: [{ line: '/menu', advanceAfterMs: 1_500 }, '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const criteria = menuCycleCriteria(boot);
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        boot: {
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            transport: boot.transport,
        },
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B Menu Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
            '## Logs',
            '',
            `- raw: ${path.relative(ROOT, path.join(outDir, 'menu-cycle.raw.log'))}`,
            `- plain: ${path.relative(ROOT, path.join(outDir, 'menu-cycle.plain.log'))}`,
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function pickerInteractiveCycleCriteria(boot) {
    const plain = String(boot?.plain ?? '');
    return [
        {
            id: 'picker-interactive-ready',
            pass: /LLM-B pronta/u.test(plain),
            detail: 'terminal reached ready state before opening the interactive picker',
        },
        {
            id: 'picker-interactive-fzf-available',
            pass: hasCommand('fzf'),
            detail: 'fzf is available for the filtered picker handoff test',
        },
        {
            id: 'picker-interactive-selected-status',
            pass: /⏵\s+Status completo|Status completo[\s\S]{0,160}\/status/iu.test(plain),
            detail: 'filtered picker selected the first menu action and routed it back through /status',
        },
        {
            id: 'picker-interactive-no-false-render-lock',
            pass: !/renderização terminal em andamento/iu.test(plain),
            detail: 'interactive picker did not expose the dispatcher render lock as a user-facing blocker',
        },
        {
            id: 'picker-interactive-clean-close',
            pass: boot.exitCode === 0 && hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal closed cleanly after interactive picker cycle with human shutdown copy',
        },
    ];
}

async function runPickerInteractiveCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const canUsePty = requestedTransport === 'pty' && hasCommand('script');
    const transport = canUsePty ? 'pty:script' : 'stdio:headless';
    const command = buildTerminalLlmbCommand(canUsePty);
    let raw = '';
    let childClosed = false;
    let pickerSent = false;
    let quitSent = false;
    let pickerOffset = 0;
    const child = spawn(command.cmd, command.args, {
        cwd: ROOT,
        env: {
            ...process.env,
            COPILOT_MODEL: 'auto',
            COPILOT_REASONING_EFFORT: 'high',
            TERMINAL_DISPLAY_PRESET: process.env.TERMINAL_DISPLAY_PRESET ?? 'default',
            COPILOT_SDK_ENABLED: 'true',
            COPILOT_OPERATIONAL_PROFILE: 'production',
            COPILOT_TERMINAL_PICKER_FILTER: 'Status',
            LLM_B_TERMINAL_PORT: String(terminalPort),
            TERMINAL_SSE_EVENT_ARCHIVE_DIR: path.join(outDir, 'picker-interactive-sse-events'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const writeRaw = (text) => {
        if (childClosed || child.stdin.destroyed || child.stdin.writableEnded) return false;
        try {
            return child.stdin.write(text);
        } catch (error) {
            if (error?.code !== 'EPIPE') {
                console.warn(`[terminal-live] picker interactive write failed: ${error?.message ?? String(error)}`);
            }
            return false;
        }
    };
    const writeLine = (line) => writeRaw(ensureLine(line));
    child.stdin.on('error', (error) => {
        if (error?.code !== 'EPIPE') {
            console.warn(`[terminal-live] picker interactive stdin error: ${error?.message ?? String(error)}`);
        }
    });
    const timeout = setTimeout(
        () => {
            writeLine('/quit');
            setTimeout(() => child.kill('SIGTERM'), 2_000).unref();
        },
        Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
    );
    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        raw += text;
        process.stdout.write(text);
        const plain = stripAnsi(raw);
        if (!pickerSent && /LLM-B pronta/u.test(plain)) {
            pickerSent = true;
            pickerOffset = plain.length;
            writeLine('/menu picker --interactive');
            return;
        }
        const afterPicker = plain.slice(pickerOffset);
        if (!quitSent && /⏵\s+Status completo|Status completo[\s\S]{0,160}\/status/iu.test(afterPicker)) {
            quitSent = true;
            setTimeout(() => writeLine('/quit'), 1_000).unref();
        }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
            childClosed = true;
            resolve(code);
        });
    });
    clearTimeout(timeout);
    const plain = stripAnsi(raw);
    const boot = {
        id: 'picker-interactive-cycle',
        label: 'interactive menu picker',
        exitCode,
        sessionId: extractSdkSessionCockpitId(plain, 'Atual') || '',
        transport,
        raw,
        plain,
    };
    await writeFile(path.join(outDir, 'picker-interactive-cycle.raw.log'), raw, 'utf8');
    await writeFile(path.join(outDir, 'picker-interactive-cycle.plain.log'), plain, 'utf8');
    const criteria = pickerInteractiveCycleCriteria(boot);
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        boot: {
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            transport: boot.transport,
        },
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B Interactive Picker Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
            '## Logs',
            '',
            `- raw: ${path.relative(ROOT, path.join(outDir, 'picker-interactive-cycle.raw.log'))}`,
            `- plain: ${path.relative(ROOT, path.join(outDir, 'picker-interactive-cycle.plain.log'))}`,
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function hasDefaultUxInformativeLineInsidePrompt(plain) {
    const text = String(plain ?? '');
    const durableIntrusion =
        /voc[eê]\[[^\n]*?›\s*(?:\r?\n)+\s{2,}(?:Skills|Configuração|Ferramentas)\b[\s\S]{0,260}?(?:^|\n)(?:voc[eê]\[[^\n]*?›\s*)?\/(?:session sdk 6|quit)\b/imu.test(
            text,
        );
    const liveIntrusion =
        /voc[eê]\[[^\n]*?›\s*(?:\r?\n){1,4}voc[eê]\[[^\n]*?›[\s\S]{0,260}(?:LLM-B sessão · Configuração|LLM-B trabalhando · Configuração|LLM-B sessão · skills|LLM-B sessão · ferramentas)[\s\S]{0,180}\/(?:session sdk 6|quit)\b/imu.test(
            text,
        );
    return durableIntrusion || liveIntrusion;
}

function diagnosticUxCycleCriteria(boot) {
    const raw = String(boot?.raw ?? '');
    const plain = String(boot?.plain ?? '');
    const findPromptCommandStart = (command, from = 0) => {
        const promptStart = plain.indexOf(`› ${command}`, Math.max(0, from));
        if (promptStart >= 0) return promptStart + 2;
        const lineStart = plain.indexOf(`\n${command}`, Math.max(0, from));
        if (lineStart >= 0) return lineStart + 1;
        return plain.indexOf(command, Math.max(0, from));
    };
    const fsReadStart = plain.indexOf('/fs read data/copilot-terminal/live-scratch/');
    const fsPreviewStart = plain.indexOf('/fs preview data/copilot-terminal/live-scratch/', Math.max(0, fsReadStart));
    const fsMarkdownStart = plain.indexOf('/fs preview data/copilot-terminal/live-scratch/', Math.max(0, fsPreviewStart + 1));
    const fsJsonStart = plain.indexOf('/fs preview data/copilot-terminal/live-scratch/', Math.max(0, fsMarkdownStart + 1));
    const fsYamlStart = plain.indexOf('/fs preview data/copilot-terminal/live-scratch/', Math.max(0, fsJsonStart + 1));
    const fsSearchStart = plain.indexOf('/fs search TERMINAL_DIAGNOSTIC_UX_', Math.max(0, fsYamlStart));
    const terminalLibsStart = plain.indexOf('/terminal libs', Math.max(0, fsSearchStart));
    const menuPickerStart = plain.indexOf('/menu picker', Math.max(0, terminalLibsStart));
    const gitDiffStart = plain.indexOf('/git diff --plain src/copilot/terminal/README.md', Math.max(0, menuPickerStart));
    const activityStart = plain.indexOf('/activity 8', Math.max(0, gitDiffStart));
    const liveFullStart = plain.indexOf('/live full');
    const healthFullStart = plain.indexOf('/health full', Math.max(0, liveFullStart));
    const toolsStart = plain.indexOf('/tools', Math.max(0, healthFullStart));
    const toolsDiagStart = findPromptCommandStart('/tools diag', Math.max(0, toolsStart + 1));
    const eventsStart = plain.indexOf('/events 12', Math.max(0, toolsDiagStart));
    const sdkEventsStart = plain.indexOf('/session sdk events 8', Math.max(0, eventsStart));
    const sdkWaitsStart = plain.indexOf('/session sdk waits 8', Math.max(0, sdkEventsStart));
    const sdkInventoryStart = plain.indexOf('/session sdk 6', Math.max(0, sdkWaitsStart));
    const sdkStatusStart = plain.indexOf('/sdk status', Math.max(0, sdkInventoryStart));
    const byokRoutesStart = plain.indexOf('/byok gateway routes openrouter', Math.max(0, sdkStatusStart));
    const byokAccountsStart = plain.indexOf('/byok gateway accounts openrouter', Math.max(0, byokRoutesStart));
    const byokOverlaysStart = plain.indexOf('/byok gateway overlays openrouter', Math.max(0, byokAccountsStart));
    const byokLimitsStart = plain.indexOf('/byok gateway limits openrouter', Math.max(0, byokOverlaysStart));
    const byokQuotaMatrixStart = plain.indexOf('/byok gateway quota-matrix openrouter', Math.max(0, byokLimitsStart));
    const permissionModeStart = plain.indexOf('/permission mode', Math.max(0, byokQuotaMatrixStart));
    const permissionCockpitStart = plain.indexOf('/permission cockpit', Math.max(0, permissionModeStart));
    const queueStart = plain.indexOf('/queue intervenção visual sem turno novo', Math.max(0, permissionCockpitStart));
    const mailboxStatusStart = plain.indexOf('/queue status', Math.max(0, queueStart));
    const mailboxClearStart = plain.indexOf('/queue clear', Math.max(0, mailboxStatusStart));
    const historyStart = plain.indexOf('/history 6', Math.max(0, mailboxClearStart));
    const dbHistoryStart = plain.indexOf('/db-history 6', Math.max(0, historyStart));
    const dbSessionsStart = plain.indexOf('/db-sessions 6', Math.max(0, dbHistoryStart));
    const scopeDeclareStart = plain.indexOf('/scope declare terminal-ux-scope', Math.max(0, dbSessionsStart));
    const scopeContextStart = plain.indexOf('/scope context terminal-ux-scope', Math.max(0, scopeDeclareStart));
    const scopeFindStart = plain.indexOf('/scope find terminal-ux-scope cmdScope --exact', Math.max(0, scopeContextStart));
    const scopeCloseStart = plain.indexOf('/scope close terminal-ux-scope', Math.max(0, scopeFindStart));
    const whoStart = plain.indexOf('/who', Math.max(0, scopeCloseStart));
    const countStart = plain.indexOf('/count', Math.max(0, whoStart));
    const clearStart = plain.indexOf('/clear', Math.max(0, countStart));
    const quitStart = plain.indexOf('/quit', Math.max(0, clearStart));
    const surfaceBetween = (start, end) => {
        if (start < 0) return plain;
        const safeEnd = end > start ? end : plain.length;
        return plain.slice(start, safeEnd);
    };
    const fsReadSurface = surfaceBetween(fsReadStart, fsPreviewStart);
    const fsPreviewSurface = surfaceBetween(fsPreviewStart, fsMarkdownStart);
    const fsMarkdownSurface = surfaceBetween(fsMarkdownStart, fsJsonStart);
    const fsJsonSurface = surfaceBetween(fsJsonStart, fsYamlStart);
    const fsYamlSurface = surfaceBetween(fsYamlStart, fsSearchStart);
    const terminalLibsSurface = surfaceBetween(terminalLibsStart, menuPickerStart);
    const menuPickerSurface = surfaceBetween(menuPickerStart, gitDiffStart);
    const gitDiffSurface = surfaceBetween(gitDiffStart, activityStart);
    const activitySurface = surfaceBetween(activityStart, liveFullStart);
    const liveFullSurface = surfaceBetween(liveFullStart, healthFullStart);
    const healthFullSurface = surfaceBetween(healthFullStart, toolsStart);
    const toolsSurface = surfaceBetween(toolsStart, toolsDiagStart);
    const toolsDiagSurface = surfaceBetween(toolsDiagStart, eventsStart);
    const eventsSurface = surfaceBetween(eventsStart, sdkEventsStart);
    const sdkEventsSurface = surfaceBetween(sdkEventsStart, sdkWaitsStart);
    const sdkWaitsSurface = surfaceBetween(sdkWaitsStart, sdkInventoryStart);
    const sdkInventorySurface = surfaceBetween(sdkInventoryStart, sdkStatusStart);
    const sdkStatusSurface = surfaceBetween(sdkStatusStart, byokRoutesStart);
    const byokRoutesSurface = surfaceBetween(byokRoutesStart, byokAccountsStart);
    const byokAccountsSurface = surfaceBetween(byokAccountsStart, byokOverlaysStart);
    const byokOverlaysSurface = surfaceBetween(byokOverlaysStart, byokLimitsStart);
    const byokLimitsSurface = surfaceBetween(byokLimitsStart, byokQuotaMatrixStart);
    const byokQuotaMatrixSurface = surfaceBetween(byokQuotaMatrixStart, permissionModeStart);
    const permissionModeSurface = surfaceBetween(permissionModeStart, permissionCockpitStart);
    const permissionCockpitSurface = surfaceBetween(permissionCockpitStart, queueStart);
    const mailboxSurface = surfaceBetween(queueStart, historyStart);
    const historySurface = surfaceBetween(historyStart, dbHistoryStart);
    const dbHistorySurface = surfaceBetween(dbHistoryStart, dbSessionsStart);
    const dbSessionsSurface = surfaceBetween(dbSessionsStart, scopeDeclareStart);
    const scopeSurface = surfaceBetween(scopeDeclareStart, whoStart);
    const whoSurface = surfaceBetween(whoStart, countStart);
    const countSurface = surfaceBetween(countStart, clearStart);
    const clearSurface = surfaceBetween(clearStart, quitStart);
    const hasIsoSeconds = (surface) =>
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?[+-]\d{2}:\d{2}/u.test(surface);
    const hasRelativeAge = (surface) => /há \d+[smhda]/iu.test(surface);
    return [
        {
            id: 'diagnostic-ux-ready',
            pass: /LLM-B pronta/u.test(plain) && !/Fluxo\s+local-fs-primary/u.test(plain),
            detail: 'terminal reached ready state before diagnostic UX cycle without raw FS routing mode in the first viewport',
        },
        {
            id: 'diagnostic-ux-fs-themed',
            pass:
                /FS local[\s\S]*criado[\s\S]*I\/O[\s\S]*escrita · motor/iu.test(plain) &&
                /Arquivo[\s\S]*TERMINAL_DIAGNOSTIC_UX_\d+\.txt[\s\S]*\(FS local\)/iu.test(fsReadSurface) &&
                /Busca[\s\S]*Resultados[\s\S]*I\/O[\s\S]*busca · motor/iu.test(plain) &&
                !/(?:^|\n)\s*(?:FS search|I\/O\s+(?:read|write|search)|resultados)\b/mu.test(plain),
            detail: '/fs create/read/search rendered themed local-FS output and I/O summaries',
        },
        {
            id: 'diagnostic-ux-fs-preview',
            pass:
                /Arquivo[\s\S]*TERMINAL_DIAGNOSTIC_UX_\d+\.txt[\s\S]*\(FS local\)/iu.test(fsPreviewSurface) &&
                /Preview\s+(?:bat|js)/iu.test(fsPreviewSurface) &&
                !/\[copilot\/read_file_content\]|chatcmpl-tool-|toolu_|\\x1b\[/iu.test(fsPreviewSurface),
            detail: '/fs preview rendered explicit read-only preview through bat/js without raw file-tool logs, tool ids or ANSI literals',
        },
        {
            id: 'diagnostic-ux-fs-markdown-preview',
            pass:
                /Arquivo[\s\S]*TERMINAL_DIAGNOSTIC_UX_\d+\.md[\s\S]*\(FS local\)/iu.test(fsMarkdownSurface) &&
                /Preview\s+(?:glow|js)/iu.test(fsMarkdownSurface) &&
                /Terminal UX Markdown|Item de diagnóstico/iu.test(fsMarkdownSurface) &&
                !/\[copilot\/read_file_content\]|chatcmpl-tool-|toolu_|\\x1b\[/iu.test(fsMarkdownSurface),
            detail: '/fs preview --markdown rendered explicit Markdown preview through glow/js without raw file-tool logs, tool ids or ANSI literals',
        },
        {
            id: 'diagnostic-ux-fs-json-preview',
            pass:
                /Arquivo[\s\S]*TERMINAL_DIAGNOSTIC_UX_\d+\.json[\s\S]*\(FS local\)/iu.test(fsJsonSurface) &&
                /Preview\s+js\s+·\s+fallback canônico\s+·\s+motivo renderer externo desativado/iu.test(fsJsonSurface) &&
                /Preview[\s\S]*truncado/iu.test(fsJsonSurface) &&
                /"marker":\s*"TERMINAL_DIAGNOSTIC_UX_/iu.test(fsJsonSurface) &&
                /linhas omitidas/iu.test(fsJsonSurface) &&
                !/\[copilot\/read_file_content\]|chatcmpl-tool-|toolu_|\\x1b\[/iu.test(fsJsonSurface),
            detail: '/fs preview --json rendered explicit structured preview without raw file-tool logs, tool ids or ANSI literals',
        },
        {
            id: 'diagnostic-ux-fs-yaml-preview',
            pass:
                /Arquivo[\s\S]*TERMINAL_DIAGNOSTIC_UX_\d+\.yaml[\s\S]*\(FS local\)/iu.test(fsYamlSurface) &&
                /Preview\s+js\s+·\s+fallback canônico\s+·\s+motivo renderer externo desativado/iu.test(fsYamlSurface) &&
                /marker:\s+TERMINAL_DIAGNOSTIC_UX_/iu.test(fsYamlSurface) &&
                !/\[copilot\/read_file_content\]|chatcmpl-tool-|toolu_|\\x1b\[/iu.test(fsYamlSurface),
            detail: '/fs preview --yaml rendered explicit structured preview without raw file-tool logs, tool ids or ANSI literals',
        },
        {
            id: 'diagnostic-ux-terminal-libs',
            pass:
                /Libs auxiliares do terminal[\s\S]*(?:disponíveis|disponível)[\s\S]*Fallback[\s\S]*terminal JS canônico/iu.test(
                    terminalLibsSurface,
                ) &&
                /Preview[\s\S]*renderers disponíveis[\s\S]*TUI[\s\S]*TTY exclusivo[\s\S]*Guia[\s\S]*TERMINAL_AUX_LIBS_UX_ARCHITECTURE_DECISION_2026-06-05\.md/iu.test(
                    terminalLibsSurface,
                ) &&
                /fzf[\s\S]*(?:disponível|ausente)[\s\S]*bat[\s\S]*(?:disponível|ausente)[\s\S]*jq[\s\S]*(?:disponível|ausente)/iu.test(
                    terminalLibsSurface,
                ) &&
                !/chatcmpl-tool-|toolu_|\\x1b\[|API[_-]?KEY|TOKEN|SECRET|PASSWORD/iu.test(terminalLibsSurface),
            detail: '/terminal libs rendered optional-tool availability, decisions and fallback without secrets, raw ids or ANSI literals',
        },
        {
            id: 'diagnostic-ux-menu-picker-guard',
            pass:
                /Picker do menu/iu.test(menuPickerSurface) &&
                /picker textual seguro/iu.test(menuPickerSurface) &&
                /sessão ainda não liberou controle exclusivo do TTY/iu.test(menuPickerSurface) &&
                /\/menu <n> ou \/menu <id>/iu.test(menuPickerSurface) &&
                !/renderização terminal em andamento/iu.test(menuPickerSurface) &&
                !/chatcmpl-tool-|toolu_|\\x1b\[/iu.test(menuPickerSurface),
            detail: '/menu picker rendered safe textual guard instead of launching an external TUI over the live prompt',
        },
        {
            id: 'diagnostic-ux-git-diff-preview',
            pass:
                /Git diff/iu.test(gitDiffSurface) &&
                /Preview\s+js\s+·\s+fallback canônico\s+·\s+motivo diff externo desativado/iu.test(gitDiffSurface) &&
                /src\/copilot\/terminal\/README\.md|TERMINAL_DIAGNOSTIC_UX_/iu.test(gitDiffSurface) &&
                !/chatcmpl-tool-|toolu_|\\x1b\[/iu.test(gitDiffSurface),
            detail: '/git diff --plain rendered canonical diff preview without old manual ANSI or raw tool ids',
        },
        {
            id: 'diagnostic-ux-no-fs-ansi',
            pass: !/\\x1b\[|\[(?:LER|MOVER|ARQUIVO|OK|FALHA|TOOL|IO)\]/iu.test(plain) && !/\x1B\[;;/u.test(raw),
            detail: 'diagnostic cycle did not expose old ANSI literals, malformed external-renderer ANSI or uppercase FS/tool badges',
        },
        {
            id: 'diagnostic-ux-no-old-intervention-jargon',
            pass:
                /Operar[\s\S]*Entrada[\s\S]*texto direto = próxima pergunta[\s\S]*API local/iu.test(plain) &&
                !/Sistema\s+HTTP\s+:\d+|mailbox zero-PR|texto livre → fila (?:zero-PR|de intervenção)|\[mailbox/iu.test(plain),
            detail: 'terminal banner/help/intervention cycle used compact first-viewport copy without old mailbox/intervention jargon',
        },
        {
            id: 'diagnostic-ux-activity-human',
            pass:
                /Atividade Atual da LLM-B[\s\S]*(Arquivo|Ferramenta|Evento)/iu.test(activitySurface) &&
                hasIsoSeconds(activitySurface) &&
                hasRelativeAge(activitySurface),
            detail: '/activity after local FS operations used complete ISO 8601 timestamps plus relative time',
        },
        {
            id: 'diagnostic-ux-live-full-human',
            pass:
                /Fluxo operacional detalhado[\s\S]*Atividade operacional observada[\s\S]*I\/O real recente[\s\S]*Eventos recentes/iu.test(
                    liveFullSurface,
                ) &&
                hasIsoSeconds(liveFullSurface) &&
                hasRelativeAge(liveFullSurface) &&
                !/\bsearch\b|phase:|approve_all|not_needed|\bempty\b|Turno observado|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(
                    liveFullSurface,
                ) &&
                !/Runtime\s+default|Timeline\s+.*persistent only|Cache\/escopo|não pausada/iu.test(
                    liveFullSurface,
                ),
            detail: '/live full rendered detailed flow with complete ISO 8601 timestamps plus relative time and without raw labels, permission constants, empty/not_needed states, raw runtime/timeline labels, or UUIDs',
        },
        {
            id: 'diagnostic-ux-health-full-themed',
            pass:
                /Diagnóstico do Terminal LLM-B[\s\S]*Agente[\s\S]*Atividade[\s\S]*Infraestrutura[\s\S]*Ferramentas por latência/iu.test(
                    healthFullSurface,
                ) &&
                !/╔|╚|\bAGENTE\b|\bINFRAESTRUTURA\b|TOOL STATS|TODOs PENDENTES|Status\s+idle|Modo SDK\s+interactive|Permissões\s+approve_all|Runtime alvo|Mapa runtime\s+[*-][^\n]*:[^\n]*\/|Lifecycle mx|sdk-preflight|Linha viva\s+.*(?:reserved|reservada)|streaming on|tools on|Shadow idade|Shadow rest\.|conversation-hub\.store|local-fs-primary|[Ss]essão (?:runtime|SDK|hub)\s+(?:[a-z0-9_-]{8,}|.*…)|Hub storage\s+.*[Ss]essão\s+[a-z0-9_-]{8,}…|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u.test(
                    healthFullSurface,
                ),
            detail: '/health full rendered themed sections with human status/mode labels instead of the old decorative ANSI box, raw constants, UUIDs or session ids',
        },
        {
            id: 'diagnostic-ux-tools-human',
            pass:
                (/Ferramentas observadas[\s\S]*uso[\s\S]*Detalhes\s+\/tools diag/iu.test(toolsSurface) ||
                    /Nenhuma ferramenta observada[\s\S]*Próximo/iu.test(toolsSurface)) &&
                /Pasta local/iu.test(toolsSurface) &&
                /Leitura local/iu.test(toolsSurface) &&
                /Busca local/iu.test(toolsSurface) &&
                !/calls=|errors=|avg=|tool=|chatcmpl-tool/iu.test(toolsSurface),
            detail: '/tools default remained human-readable and used granular local I/O names after diagnostic operations',
        },
        {
            id: 'diagnostic-ux-tools-diag-hierarchy',
            pass:
                /Ferramentas[\s\S]*diagnóstico humano[\s\S]*Categorias[\s\S]*Superfícies operacionais[\s\S]*Contrato das ferramentas[\s\S]*Lifecycle recente/iu.test(
                    toolsDiagSurface,
                ) &&
                /Ponte local/iu.test(toolsDiagSurface) &&
                !/Nome técnico|Nome interno|Técnico|Refs|Rastreio\s+(?:call|req|trace)|chatcmpl-tool|call chatcmpl|Classe\s+tool|(?:^|\n)\s*(?:tool|bridge)\s+uso|tipo file|chamada |requisição |tool\(s\)|Superfícies de tools/iu.test(
                    toolsDiagSurface,
                ),
            detail: '/tools diag separated human summary from raw technical names/references, leaving trace ids to /tools all/raw',
        },
        {
            id: 'diagnostic-ux-events-human',
            pass:
                /Eventos[\s\S]*(Ferramenta|Atividade|terminal|io)/iu.test(eventsSurface) &&
                hasIsoSeconds(eventsSurface) &&
                hasRelativeAge(eventsSurface) &&
                !/estado io op|io_op|chatcmpl-tool-[a-z0-9-]+|rastreamento implicit:|#\d+ ·|hub [a-z0-9-]+/iu.test(
                    eventsSurface,
                ),
            detail: '/events default rendered diagnostics with complete ISO 8601 timestamps plus relative time and without raw tool ids, trace ids, event ids, raw io_op state or hub ids',
        },
        {
            id: 'diagnostic-ux-session-sdk-events-human',
            pass:
                /Eventos SDK da sessão[\s\S]*(Evento|Resultado)/iu.test(sdkEventsSurface) &&
                (/nenhum ciclo de vida SDK ou comando SDK arquivado nesta janela/iu.test(sdkEventsSurface) ||
                    (hasIsoSeconds(sdkEventsSurface) && hasRelativeAge(sdkEventsSurface))) &&
                !/#\d+|agent\/sdk|sdk\.lifecycle|session deleted|sessão sessão|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(
                    sdkEventsSurface,
                ),
            detail: '/session sdk events rendered aggregate SDK history with translated lifecycle and ISO seconds plus relative time, without event ids, raw sdk sources, or UUIDs',
        },
        {
            id: 'diagnostic-ux-session-sdk-waits-human',
            pass:
                /Esperas SDK da sessão/iu.test(sdkWaitsSurface) &&
                (/nenhuma espera SDK arquivada ainda/iu.test(sdkWaitsSurface) ||
                    (hasIsoSeconds(sdkWaitsSurface) && hasRelativeAge(sdkWaitsSurface))) &&
                !/#\d+|sdk\/user_input|request_user_input|chatcmpl-tool-|fs\.write|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(
                    sdkWaitsSurface,
                ),
            detail: '/session sdk waits rendered aggregate waits without event ids, raw SDK names, permission constants, or UUIDs',
        },
        {
            id: 'diagnostic-ux-session-sdk-inventory-human',
            pass:
                /Sessão SDK[\s\S]*(Sessões SDK listadas|nenhuma sessão SDK listada)/iu.test(sdkInventorySurface) &&
                /Última usada|Primeiro plano/iu.test(sdkInventorySurface) &&
                /Vínculo SDK/iu.test(sdkInventorySurface) &&
                /CommandDefinitions\s+\d+ CommandDefinitions expostos[\s\S]*(?:nenhum comando chamado nesta janela|chamadas? na janela)/iu.test(
                    sdkInventorySurface,
                ) &&
                /Comandos[\s\S]*\/session sdk controla sessões SDK[\s\S]*\/restart reinicia só a conversa[\s\S]*Próximo boot[\s\S]*\/session sdk next new[\s\S]*Filtros[\s\S]*offset=<n>/iu.test(
                    sdkInventorySurface,
                ) &&
                (!/Tempo/iu.test(sdkInventorySurface) || (hasIsoSeconds(sdkInventorySurface) && hasRelativeAge(sdkInventorySurface))) &&
                !/Vínculo BYOK\s+BYOK|\/session sdk controla sessão SDK;|\/session sdk next new \||Foreground|probe-residue|\blast\b|\bforeground\b|operator-next-boot|sdk-resume-fallback|provider-boundary|\bsdk-(?:current|old|probe|new|last|second)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(
                    sdkInventorySurface,
                ),
            detail: '/session sdk default rendered inventory, BYOK binding and command help as compact multiline human blocks without duplicate BYOK labels, raw ids or English flags',
        },
        {
            id: 'diagnostic-ux-sdk-status-human',
            pass:
                /SDK do Terminal\s+·\s+principal[\s\S]*Sessão\s+sessão ativa/iu.test(sdkStatusSurface) &&
                /Modelos\s+\/sdk models · \/sdk tools[\s\S]*Skills\s+\/sdk skills[\s\S]*Rotina\s+\/sdk quota · \/sdk waits[\s\S]*Headers\s+\/sdk headers[\s\S]*Simular\s+\/sdk simulate pergunta/iu.test(
                    sdkStatusSurface,
                ) &&
                /fonte\s+limite do SDK/iu.test(sdkStatusSurface) &&
                !/SDK do Terminal\s+·\s+default|\d{4}-\d{2}-\d{2}T|\bsdk-[a-z0-9_-]+\b|copilot_sdk_entitlement|premium_interactions|escopo entitlement|request-user-input|request_user_input|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|reasoning=|restante=|\/sdk models \| \/sdk skills/iu.test(
                    sdkStatusSurface,
                ),
            detail: '/sdk status rendered principal runtime, session presence, quota/status and compact multiline command help without raw ids, raw quota scopes or key=value diagnostics',
        },
        {
            id: 'diagnostic-ux-byok-quota-surfaces-human',
            pass:
                /BYOK rotas do gateway[\s\S]*Catálogo[\s\S]*(?:Rota|Resultado|Nota)/iu.test(byokRoutesSurface) &&
                /BYOK contas e chaves[\s\S]*Catálogo[\s\S]*Estados[\s\S]*(?:Provedor|Resultado|Nota)/iu.test(
                    byokAccountsSurface,
                ) &&
                /BYOK overlays de conta[\s\S]*Catálogo[\s\S]*(?:Provedor|Resultado|Nota)/iu.test(
                    byokOverlaysSurface,
                ) &&
                /BYOK limites de conta[\s\S]*Catálogo[\s\S]*Estados[\s\S]*Fontes[\s\S]*(?:Provedor|Resultado|Nota)/iu.test(
                    byokLimitsSurface,
                ) &&
                /BYOK matriz de quotas dos provedores[\s\S]*Resumo[\s\S]*Tipos de quota[\s\S]*(?:Provedor|Resultado|Nota)/iu.test(
                    byokQuotaMatrixSurface,
                ) &&
                !/\\x1b\[|\x1b\[|\/workspaces\/chatgpt-docker-puppeteer\/data\/copilot\/model-gateway\/catalog\.json|BYOK model-gateway routes|BYOK model-gateway account overlays|openrouter-key-account|redigido sanitized|estado rate_limited|quota SDK aplicável a BYOK|Tipos de quota:|key_credit_balance|headers_or_runtime_failure|not_blocking|wait_for_rate_limit_reset_or_choose_another_route|refresh_overlay_or_retry_pre_runtime_selection|^\s*(?:\x1b|\[)/imu.test(
                    `${byokRoutesSurface}\n${byokAccountsSurface}\n${byokOverlaysSurface}\n${byokLimitsSurface}\n${byokQuotaMatrixSurface}`,
                ),
            detail: '/byok gateway routes/accounts/overlays/limits/quota-matrix rendered themed pre-runtime quota/account information without raw ANSI or old line formatting',
        },
        {
            id: 'diagnostic-ux-permission-human',
            pass:
                /Modo de permissões[\s\S]*(automáticas|auditoria sem janelas|seletivas)/iu.test(permissionModeSurface) &&
                /Permissões SDK[\s\S]*(Pendentes|Mudanças)/iu.test(permissionCockpitSurface) &&
                !/approve_all|audit_only|selective|file_write|fs\.write|requestId|\\x1b\[/iu.test(
                    `${permissionModeSurface}\n${permissionCockpitSurface}`,
                ),
            detail: '/permission mode/cockpit rendered translated governance labels without raw mode constants, permission types, requestId labels, or ANSI',
        },
        {
            id: 'diagnostic-ux-intervention-queue-human',
            pass:
                /Fila[\s\S]*intervenção guardada para a próxima pergunta humana/iu.test(mailboxSurface) &&
                /Fila de intervenção[\s\S]*1 item na fila[\s\S]*limpa/iu.test(mailboxSurface) &&
                !/mailbox zero-PR|runtime default|runtime [a-z0-9_-]+|\[mailbox|modeHint|entryId|\\x1b\[/iu.test(
                    mailboxSurface,
                ),
            detail: '/queue status/clear rendered human intervention queue copy without mailbox-zero-PR jargon, runtime ids, entry ids, modeHint, or ANSI',
        },
        {
            id: 'diagnostic-ux-history-human',
            pass:
                /Histórico/iu.test(historySurface) &&
                (/Histórico\s+(?:sem mensagens visíveis nesta janela|vazio)/iu.test(historySurface) ||
                    (!/(LLM-B|Você|Sistema)/iu.test(historySurface) ||
                        (hasIsoSeconds(historySurface) && hasRelativeAge(historySurface)))) &&
                !/reconciled|\bmixed\b|\[live\]|(?:Você|LLM-B|Sistema)\s+\d{4}-\d{2}-\d{2}T[^\n]*·\s*(?:\n|$)/iu.test(
                    historySurface,
                ),
            detail: '/history rendered visible conversation turns with ISO seconds plus relative time and without empty rows, raw timeline labels or [live] badges',
        },
        {
            id: 'diagnostic-ux-db-history-human',
            pass:
                /(Últimos|Nenhum turno|janela persistida não tem mensagens visíveis|não disponível)/iu.test(
                    dbHistorySurface,
                ) &&
                /Histórico DB|Últimos \d+ turnos da sessão atual/iu.test(dbHistorySurface) &&
                (!/Últimos/iu.test(dbHistorySurface) || (hasIsoSeconds(dbHistorySurface) && hasRelativeAge(dbHistorySurface))) &&
                !/(?:Você|LLM-B|Sistema)\s+\d{4}-\d{2}-\d{2}T[^\n]*·\s*(?:\n|$)/iu.test(dbHistorySurface),
            detail: '/db-history rendered visible persisted turns or empty state with ISO seconds plus relative time and without empty rows',
        },
        {
            id: 'diagnostic-ux-db-sessions-human',
            pass:
                /(sessões persistidas|Nenhuma sessão persistida)/iu.test(dbSessionsSurface) &&
                (!/sessões persistidas/iu.test(dbSessionsSurface) || (hasIsoSeconds(dbSessionsSurface) && hasRelativeAge(dbSessionsSurface))) &&
                !/hub sessions|id [0-9a-f]{8}/iu.test(dbSessionsSurface),
            detail: '/db-sessions rendered persisted session list with ISO seconds plus relative time and without English hub-sessions copy or raw ids',
        },
        {
            id: 'diagnostic-ux-scope-human',
            pass:
                /Escopo declarado[\s\S]*Contexto de escopo[\s\S]*Busca de símbolo no escopo[\s\S]*Escopo fechado/iu.test(
                    scopeSurface,
                ) &&
                !/\\x1b\[|\bready\b|\bwarming\b|files=|parsed=|parseSymbols=|recursive=/iu.test(scopeSurface),
            detail: '/scope declare/context/find/close rendered themed scope output without ANSI literals or old diagnostic key=value labels',
        },
        {
            id: 'diagnostic-ux-small-commands-human',
            pass:
                /Atores ativos nesta sessão[\s\S]*digita diretamente no terminal/iu.test(whoSurface) &&
                /Estatísticas da sessão|nenhuma sessão persistida ativa/iu.test(countSurface) &&
                /Histórico[\s\S]*memória local limpa/iu.test(clearSurface) &&
                !/AlwaysAliveAgent|POST http|GET http|Hub session|SDK session|\\x1b\[|id [0-9a-f]{8}/iu.test(
                    `${whoSurface}\n${countSurface}\n${clearSurface}`,
                ),
            detail: '/who, /count and /clear rendered themed operator-facing copy without HTTP internals, ANSI, or ids',
        },
        {
            id: 'diagnostic-ux-clean-close',
            pass: boot.exitCode === 0 && hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal closed cleanly after diagnostic UX cycle with human shutdown copy',
        },
    ];
}

async function runDiagnosticUxCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const marker = `TERMINAL_DIAGNOSTIC_UX_${Date.now()}`;
    const scratchPath = `data/copilot-terminal/live-scratch/${marker}.txt`;
    const markdownPath = `data/copilot-terminal/live-scratch/${marker}.md`;
    const jsonPath = `data/copilot-terminal/live-scratch/${marker}.json`;
    const yamlPath = `data/copilot-terminal/live-scratch/${marker}.yaml`;
    const gitDiffFixturePath = path.join(ROOT, 'src/copilot/terminal/README.md');
    const gitDiffFixtureOriginal = await readFile(gitDiffFixturePath, 'utf8').catch(() => null);
    if (gitDiffFixtureOriginal !== null) {
        await writeFile(
            gitDiffFixturePath,
            `${gitDiffFixtureOriginal.trimEnd()}\ncanonical=diagnostic-${marker}\n`,
            'utf8',
        );
    }
    try {
        const boot = await runSessionCycleBoot({
            id: 'diagnostic-ux-cycle',
            label: 'diagnostic UX with local FS activity',
            outDir,
            commands: [
                {
                    line: `/fs create ${scratchPath} ${marker}`,
                    waitFor: new RegExp(`FS local[\\s\\S]*criado[\\s\\S]*${escapeRegExp(scratchPath)}`, 'u'),
                    advanceAfterMs: 1_000,
                },
                {
                    line: `/fs create ${markdownPath} # Terminal UX Markdown - Item de diagnóstico`,
                    waitFor: new RegExp(`FS local[\\s\\S]*criado[\\s\\S]*${escapeRegExp(markdownPath)}`, 'u'),
                    advanceAfterMs: 1_000,
                },
                {
                    line: `/fs create ${jsonPath} {"marker":"${marker}","items":[1,2,3,4,5,6,7,8],"nested":{"alpha":1,"beta":2}}`,
                    waitFor: new RegExp(`FS local[\\s\\S]*criado[\\s\\S]*${escapeRegExp(jsonPath)}`, 'u'),
                    advanceAfterMs: 1_000,
                },
                {
                    line: `/fs create ${yamlPath} marker: ${marker}`,
                    waitFor: new RegExp(`FS local[\\s\\S]*criado[\\s\\S]*${escapeRegExp(yamlPath)}`, 'u'),
                    advanceAfterMs: 1_000,
                },
                { line: `/fs read ${scratchPath}`, waitFor: 'leitura · motor', advanceAfterMs: 1_000 },
                { line: `/fs preview ${scratchPath} --lines 20`, waitFor: 'Preview', advanceAfterMs: 1_000 },
                { line: `/fs preview ${markdownPath} --markdown`, waitFor: 'Terminal UX Markdown', advanceAfterMs: 1_000 },
                {
                    line: `/fs preview ${jsonPath} --json --plain --lines 5`,
                    waitFor: 'linhas omitidas',
                    advanceAfterMs: 1_000,
                },
                { line: `/fs preview ${yamlPath} --yaml --plain --lines 5`, waitFor: 'leitura · motor', advanceAfterMs: 1_000 },
                { line: `/fs search ${marker} data/copilot-terminal/live-scratch`, waitFor: 'Resultados', advanceAfterMs: 1_000 },
                { line: '/terminal libs', waitFor: 'Libs auxiliares do terminal', advanceAfterMs: 1_000 },
                { line: '/menu picker', waitFor: 'Picker do menu', advanceAfterMs: 1_000 },
                { line: '/git diff --plain src/copilot/terminal/README.md', waitFor: 'Git diff', advanceAfterMs: 1_000 },
                { line: '/activity 8', waitFor: 'Atividade Atual da LLM-B', advanceAfterMs: 1_000 },
                { line: '/live full', waitFor: 'Fluxo operacional detalhado', advanceAfterMs: 1_000 },
                { line: '/health full', waitFor: 'Diagnóstico do Terminal LLM-B', advanceAfterMs: 1_000 },
                { line: '/tools', waitFor: 'Ferramentas observadas', advanceAfterMs: 1_000 },
                { line: '/tools diag', waitFor: 'diagnóstico humano', advanceAfterMs: 1_000 },
                { line: '/events 12', waitFor: 'Eventos SSE', advanceAfterMs: 1_000 },
                { line: '/session sdk events 8', waitFor: 'Eventos SDK da sessão', advanceAfterMs: 1_000 },
                { line: '/session sdk waits 8', waitFor: 'Esperas SDK da sessão', advanceAfterMs: 1_000 },
                { line: '/session sdk 6', waitFor: 'Sessões SDK listadas', advanceAfterMs: 1_000 },
                { line: '/sdk status', waitFor: 'SDK do Terminal', advanceAfterMs: 1_000 },
                { line: '/byok gateway routes openrouter', waitFor: 'BYOK rotas do gateway', advanceAfterMs: 1_000 },
                { line: '/byok gateway accounts openrouter', waitFor: 'BYOK contas e chaves', advanceAfterMs: 1_000 },
                { line: '/byok gateway overlays openrouter', waitFor: 'BYOK overlays de conta', advanceAfterMs: 1_000 },
                { line: '/byok gateway limits openrouter', waitFor: 'BYOK limites de conta', advanceAfterMs: 1_000 },
                {
                    line: '/byok gateway quota-matrix openrouter',
                    waitFor: 'BYOK matriz de quotas dos provedores',
                    advanceAfterMs: 1_000,
                },
                { line: '/permission mode', waitFor: 'Modo de permissões', advanceAfterMs: 1_000 },
                { line: '/permission cockpit', waitFor: 'Permissões SDK', advanceAfterMs: 1_000 },
                { line: '/queue intervenção visual sem turno novo', waitFor: 'intervenção guardada', advanceAfterMs: 1_000 },
                { line: '/queue status', waitFor: 'Fila de intervenção', advanceAfterMs: 1_000 },
                { line: '/queue clear', waitFor: 'limpa', advanceAfterMs: 1_000 },
                { line: '/history 6', waitFor: 'Histórico', advanceAfterMs: 1_000 },
                { line: '/db-history 6', waitFor: 'Histórico DB', advanceAfterMs: 1_000 },
                { line: '/db-sessions 6', waitFor: 'Últimas 6 sessões persistidas', advanceAfterMs: 1_000 },
                {
                    line: '/scope declare terminal-ux-scope src/copilot/terminal/commands --await --include scope.js --max-files 1',
                    waitFor: 'Escopo declarado',
                    advanceAfterMs: 1_000,
                },
                { line: '/scope context terminal-ux-scope', waitFor: 'Contexto de escopo', advanceAfterMs: 1_000 },
                { line: '/scope find terminal-ux-scope cmdScope --exact', waitFor: 'Busca de símbolo no escopo', advanceAfterMs: 1_000 },
                { line: '/scope close terminal-ux-scope', waitFor: 'Escopo fechado', advanceAfterMs: 1_000 },
                { line: '/who', waitFor: 'Atores ativos nesta sessão', advanceAfterMs: 1_000 },
                { line: '/count', waitFor: 'Estatísticas da sessão', advanceAfterMs: 1_000 },
                { line: '/clear', waitFor: 'Histórico', advanceAfterMs: 1_000 },
                '/quit',
            ],
            terminalPort,
            requestedTransport,
            timeoutMs,
        });
        const criteria = diagnosticUxCycleCriteria(boot);
        const durationMs = Date.now() - Date.parse(startedAt);
        const ok = criteria.every((criterion) => criterion.pass);
        const summary = {
            ok,
            startedAt,
            durationMs,
            terminalPort,
            marker,
            scratchPath,
            boot: {
                id: boot.id,
                label: boot.label,
                exitCode: boot.exitCode,
                sessionId: boot.sessionId || null,
                transport: boot.transport,
            },
            criteria,
        };
        await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
        await writeFile(
            path.join(outDir, 'summary.md'),
            [
                '# Terminal LLM-B Diagnostic UX Live Test',
                '',
                `Started: ${startedAt}`,
                `Duration: ${durationMs}ms`,
                `Status: ${ok ? 'PASS' : 'FAIL'}`,
                `Terminal port: ${terminalPort}`,
                `Marker: ${marker}`,
                '',
                '## Criteria',
                '',
                ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
                '',
                '## Logs',
                '',
                `- raw: ${path.relative(ROOT, path.join(outDir, 'diagnostic-ux-cycle.raw.log'))}`,
                `- plain: ${path.relative(ROOT, path.join(outDir, 'diagnostic-ux-cycle.plain.log'))}`,
                '',
            ].join('\n'),
            'utf8',
        );
        return summary;
    } finally {
        if (gitDiffFixtureOriginal !== null) await writeFile(gitDiffFixturePath, gitDiffFixtureOriginal, 'utf8');
    }
}

function defaultUxCycleCriteria(boot) {
    const plain = String(boot?.plain ?? '');
    const helpStart = plain.indexOf('Ajuda rápida');
    const helpLibsStart = plain.indexOf('Ajuda de libs auxiliares', Math.max(0, helpStart));
    const helpFullStart = plain.indexOf('Terminal LLM-B - Ajuda completa', Math.max(0, helpLibsStart));
    const terminalLibsDetailStart = plain.indexOf('Libs auxiliares do terminal', Math.max(0, helpFullStart));
    const terminalLibsFilteredStart = plain.indexOf('/terminal libs deferred', Math.max(0, terminalLibsDetailStart));
    const terminalLibsJsonStart = plain.indexOf('/terminal libs json', Math.max(0, terminalLibsFilteredStart));
    const statusStart = plain.indexOf('Status do Terminal LLM-B');
    const nowPanelStart = plain.indexOf('\n  Agora');
    const nowStart = nowPanelStart >= 0 ? nowPanelStart + 1 : plain.indexOf('[agora]');
    const usageStart = [
        plain.indexOf('Janela de contexto', Math.max(0, nowStart)),
        plain.indexOf('Medição       SDK ainda não reportou tokens usados nesta sessão', Math.max(0, nowStart)),
        plain.indexOf('Atenção       dados da janela de contexto', Math.max(0, nowStart)),
        plain.indexOf('\n  BYOK', Math.max(0, nowStart)),
        plain.indexOf('BYOK ativo', Math.max(0, nowStart)),
        plain.indexOf('Pedido premium', Math.max(0, nowStart)),
    ]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? -1;
    const healthStart = plain.indexOf('Saúde do Terminal LLM-B');
    const waitsStart = plain.lastIndexOf('Esperas humanas');
    const byokStatusStart = plain.indexOf('BYOK status', Math.max(0, waitsStart));
    const byokModelCommandStart = plain.indexOf('/byok model terminal-ux-boundary-fixture', Math.max(0, byokStatusStart));
    const byokModelStatusStart =
        byokModelCommandStart >= 0 ? plain.indexOf('BYOK status', byokModelCommandStart + 1) : -1;
    const byokModelActivityStart =
        byokModelStatusStart >= 0 ? plain.indexOf('Atividade Atual da LLM-B', byokModelStatusStart + 1) : -1;
    const byokAfterModelStart =
        byokModelActivityStart >= 0 ? plain.indexOf('BYOK status', byokModelActivityStart + 1) : -1;
    const sessionSdkAfterByokStart = plain.indexOf('Sessão SDK', Math.max(0, byokAfterModelStart));
    const toolsStart = (() => {
        const populated = plain.indexOf('Ferramentas observadas');
        return populated >= 0 ? populated : plain.indexOf('Nenhuma ferramenta observada');
    })();
    const sdkStart = plain.indexOf('SDK do Terminal');
    const sdkCapabilitiesStart = plain.indexOf('Capacidades SDK');
    const workspaceStart = plain.indexOf('Workspace SDK virtual');
    const liveStart = plain.indexOf('Fluxo da conversa');
    const activityStart = plain.indexOf('Atividade Atual da LLM-B');
    const eventsStart = plain.indexOf('Eventos SSE');
    const surfaceStarts = [
        helpStart,
        helpLibsStart,
        helpFullStart,
        terminalLibsDetailStart,
        terminalLibsFilteredStart,
        terminalLibsJsonStart,
        statusStart,
        nowStart,
        usageStart,
        healthStart,
        toolsStart,
        sdkStart,
        sdkCapabilitiesStart,
        workspaceStart,
        liveStart,
        activityStart,
        eventsStart,
        waitsStart,
        byokStatusStart,
        byokModelCommandStart,
        byokModelStatusStart,
        byokModelActivityStart,
        byokAfterModelStart,
        sessionSdkAfterByokStart,
    ]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);
    const surfaceAt = (start) => {
        if (start < 0) return '';
        const position = surfaceStarts.indexOf(start);
        return plain.slice(start, surfaceStarts[position + 1] ?? plain.length);
    };
    const defaultSurface = surfaceStarts.map((index) => surfaceAt(index)).join('\n');
    const helpSurface = surfaceAt(helpStart);
    const helpLibsSurface = surfaceAt(helpLibsStart);
    const helpFullSurface = surfaceAt(helpFullStart);
    const terminalLibsDetailSurface = surfaceAt(terminalLibsDetailStart);
    const terminalLibsFilteredSurface = surfaceAt(terminalLibsFilteredStart);
    const terminalLibsJsonSurface = surfaceAt(terminalLibsJsonStart);
    const terminalLibsJsonBlockStart = terminalLibsJsonSurface.indexOf('{');
    const terminalLibsJsonPromptAfterBlock =
        terminalLibsJsonBlockStart >= 0 ? terminalLibsJsonSurface.indexOf('\nvocê', terminalLibsJsonBlockStart) : -1;
    const terminalLibsJsonBlock =
        terminalLibsJsonBlockStart >= 0
            ? terminalLibsJsonSurface.slice(
                  terminalLibsJsonBlockStart,
                  terminalLibsJsonPromptAfterBlock > terminalLibsJsonBlockStart
                      ? terminalLibsJsonPromptAfterBlock
                      : undefined,
              )
            : terminalLibsJsonSurface;
    const normalizedTerminalLibsJsonBlock = terminalLibsJsonBlock.replace(/\r\n/gu, '\n').trimEnd();
    const statusSurface = surfaceAt(statusStart);
    const usageSurface = surfaceAt(usageStart);
    const byokStatusSurface = surfaceAt(byokStatusStart);
    const byokModelCommandSurface = surfaceAt(byokModelCommandStart);
    const byokModelStatusSurface = surfaceAt(byokModelStatusStart);
    const byokModelActivitySurface = surfaceAt(byokModelActivityStart);
    const byokAfterModelSurface = surfaceAt(byokAfterModelStart);
    const byokModelOutcomeSurface = `${byokModelCommandSurface}\n${byokModelStatusSurface}\n${byokModelActivitySurface}\n${byokAfterModelSurface}`;
    const sessionSdkAfterByokSurface = surfaceAt(sessionSdkAfterByokStart);
    const healthSurface = surfaceAt(healthStart);
    const toolsSurface = surfaceAt(toolsStart);
    const sdkSurface = surfaceAt(sdkStart);
    const sdkCapabilitiesSurface = surfaceAt(sdkCapabilitiesStart);
    const workspaceSurface = surfaceAt(workspaceStart);
    const liveSurface = surfaceAt(liveStart);
    const activitySurface = surfaceAt(activityStart);
    const eventsSurface = surfaceAt(eventsStart);
    const statusModel = extractTerminalUxRowValue(statusSurface, 'Modelo').split('·')[0]?.trim() ?? '';
    const nowModel = extractTerminalUxRowValue(surfaceAt(nowStart), 'Modelo').split('·')[0]?.trim() ?? '';
    const healthModel = extractTerminalUxRowValue(healthSurface, 'Modelo').split('·')[0]?.trim() ?? '';
    const sdkModel = extractTerminalUxRowValue(sdkSurface, 'Modelo').split('·')[0]?.trim() ?? '';
    const orderedSurfaceStarts = [
        helpStart,
        helpLibsStart,
        helpFullStart,
        terminalLibsDetailStart,
        terminalLibsFilteredStart,
        terminalLibsJsonStart,
        statusStart,
        nowStart,
        usageStart,
        healthStart,
        toolsStart,
        sdkStart,
        sdkCapabilitiesStart,
        workspaceStart,
        liveStart,
        activityStart,
        eventsStart,
        waitsStart,
        byokStatusStart,
        byokModelCommandStart,
        byokModelStatusStart,
        byokModelActivityStart,
        byokAfterModelStart,
        sessionSdkAfterByokStart,
    ];
    const surfacesRenderedInOrder =
        orderedSurfaceStarts.every((index) => index >= 0) &&
        orderedSurfaceStarts.every((index, position, values) => position === 0 || values[position - 1] < index);
    return [
        {
            id: 'ux-cycle-ready',
            pass: /LLM-B pronta/u.test(plain),
            detail: 'terminal reached ready state before opening default UX surfaces',
        },
        {
            id: 'ux-cycle-command-order',
            pass: surfacesRenderedInOrder,
            detail: 'default UX surfaces appeared in the same order as the operator commands',
        },
        {
            id: 'ux-cycle-no-informative-event-inside-prompt',
            pass: !hasDefaultUxInformativeLineInsidePrompt(plain),
            detail: 'informative SDK session events did not render between the prompt and the next operator command',
        },
        {
            id: 'ux-cycle-help-compact',
            pass:
                /Ajuda rápida[\s\S]*Situação[\s\S]*Ajuda\s+\/help libs[\s\S]*\/help full/iu.test(helpSurface) &&
                !/╔|╚|binding\/frescor|CommandDefinition/iu.test(helpSurface),
            detail: '/help default rendered the compact human guide and kept the old catalog behind /help full',
        },
        {
            id: 'ux-cycle-help-libs-topic',
            pass:
                /Ajuda de libs auxiliares[\s\S]*Inspeção[\s\S]*\/terminal libs json \[filtro\][\s\S]*Previews[\s\S]*\/fs preview <path> --markdown[\s\S]*TUI e smoke[\s\S]*terminal:aux-libs:smoke/iu.test(
                    helpLibsSurface,
                ) && !/Sessão SDK persistente|HTTP local|Memória, GitHub e Git/iu.test(helpLibsSurface),
            detail: '/help libs rendered a focused topical guide without opening the full command catalog',
        },
        {
            id: 'ux-cycle-help-full-structured',
            pass:
                /Terminal LLM-B - Ajuda completa[\s\S]*Sessão e observação[\s\S]*Previews e libs auxiliares[\s\S]*Interações humanas e SDK[\s\S]*HTTP local/iu.test(
                    helpFullSurface,
                ) &&
                /\/fs preview <path> --markdown[\s\S]*\/menu picker --interactive[\s\S]*atuin\/zoxide/iu.test(
                    helpFullSurface,
                ) &&
                !/╔|╚|\x1b\[/u.test(helpFullSurface),
            detail: '/help full rendered a structured catalog without the legacy ANSI box',
        },
        {
            id: 'ux-cycle-terminal-libs-detail',
            pass:
                /Libs auxiliares do terminal[\s\S]*detail[\s\S]*Estado[\s\S]*Default[\s\S]*Política[\s\S]*Exemplo 1/iu.test(
                    terminalLibsDetailSurface,
                ) &&
                /atuin|zoxide/iu.test(terminalLibsDetailSurface) &&
                /adiado|adiada/iu.test(terminalLibsDetailSurface) &&
                !/\bRetorno\b|\{\s*"tools"|\[OK\]|\[ERR\]/u.test(terminalLibsDetailSurface),
            detail: '/terminal libs detail explained policy, examples and deferred tools without raw JSON',
        },
        {
            id: 'ux-cycle-terminal-libs-filtered',
            pass:
                /Libs auxiliares do terminal[\s\S]*filtro adiadas[\s\S]*(Atuin|zoxide)/iu.test(
                    terminalLibsFilteredSurface,
                ) &&
                !/\bfzf\b|renderer externo|preview read-only com syntax highlighting/iu.test(terminalLibsFilteredSurface),
            detail: '/terminal libs deferred rendered a focused filtered surface without accepted-tool noise',
        },
        {
            id: 'ux-cycle-terminal-libs-json-contract',
            pass:
                /"schema":\s*"terminal-external-tools-capability-summary"/u.test(terminalLibsJsonSurface) &&
                /"generatedAt":\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/u.test(
                    terminalLibsJsonSurface,
                ) &&
                /"policy":\s*\{[\s\S]*"optionalByDefault":\s*true[\s\S]*"noAutomaticTui":\s*true/u.test(
                    terminalLibsJsonSurface,
                ) &&
                !/\x1b\[|\\u001b|\\u0007|\r/u.test(normalizedTerminalLibsJsonBlock),
            detail: '/terminal libs json rendered a named machine contract with ISO timestamp, explicit policy and no ANSI/control leakage',
        },
        {
            id: 'ux-cycle-boot-human-copy',
            pass:
                /Preparando terminal/iu.test(plain) &&
                /FS\/terminal locais ativos/iu.test(plain) &&
                !/Subindo servidor copilot|runtime do agente|stopped:noloop|starting:noloop|\bTools\s+locais|\b0 tools\b/iu.test(
                    plain,
                ),
            detail: 'default boot copy avoided raw server/runtime/tools labels and raw loop tails',
        },
        {
            id: 'ux-cycle-no-db-console-noise',
            pass: !/\[db\]\[(?:DEBUG|INFO|WARN|ERROR|FATAL)\]|SQLite copilot ready/iu.test(defaultSurface),
            detail: 'default terminal UX did not expose infrastructure DB logs in the human console',
        },
        {
            id: 'ux-cycle-status-compact',
            pass:
                /Status do Terminal LLM-B[\s\S]*Conversa[\s\S]*Entrada[\s\S]*Detalhe\s+\/status full/iu.test(plain) &&
                !/prompt digest|tools load|runtime id|billing\/modelo/iu.test(defaultSurface),
            detail: '/status default rendered a human decision panel instead of the full diagnostic dump',
        },
        {
            id: 'ux-cycle-model-labels-consistent',
            pass:
                Boolean(statusModel) &&
                statusModel === nowModel &&
                statusModel === healthModel &&
                statusModel === sdkModel &&
                [statusModel, nowModel, healthModel, sdkModel].every((model) => model.toLowerCase() !== 'auto') &&
                !/claude-haiku-4\.5/iu.test([statusModel, nowModel, healthModel, sdkModel].join(' ')),
            detail: '/status, /now, /health and /sdk agreed on the live BYOK route instead of stale auto/billing labels',
        },
        {
            id: 'ux-cycle-now-human',
            pass:
                /Agora[\s\S]*Conversa[\s\S]*Entrada[\s\S]*sem pendências humanas[\s\S]*Modelo/iu.test(
                    surfaceAt(nowStart),
                ) && !/\[agora\]|\[now\]\s+runtime=|entrada=|catálogo=|atividade=|próximo=|sse=/iu.test(defaultSurface),
            detail: '/now default rendered human labels instead of runtime key-value telemetry',
        },
        {
            id: 'ux-cycle-usage-byok-current-first',
            pass:
                (/^\s*Rota BYOK\s{2,}/imu.test(usageSurface) || /^\s*BYOK\s{2,}/imu.test(usageSurface) || /BYOK ativo/iu.test(usageSurface)
                    ? /(?:Janela de contexto|Medição\s+SDK ainda não reportou tokens usados nesta sessão|Atenção\s+dados da janela de contexto)[\s\S]*Rota BYOK[\s\S]*Histórico\s+Copilot|Rota BYOK[\s\S]*Histórico\s+Copilot/iu.test(
                          usageSurface,
                      )
                    : /(?:Janela de contexto|Medição\s+SDK ainda não reportou tokens usados nesta sessão|Atenção\s+dados da janela de contexto)[\s\S]*(?:Telemetria PR|Pedido premium)|Pedido premium/iu.test(
                          usageSurface,
                      )) &&
                !/Quota Copilot|side-channel|não é cobrança BYOK|BYOK ativo|BYOK\s+provedor|Histórico Copilot/iu.test(usageSurface),
            detail: '/usage now rendered BYOK as current state and Copilot telemetry as compact historical side-channel',
        },
        {
            id: 'ux-cycle-byok-boundary-human',
            pass:
                /BYOK status[\s\S]*Preparada[\s\S]*Sessão viva[\s\S]*Fronteira/iu.test(byokStatusSurface) &&
                (/(?:Sessão atual usa outro provedor\/perfil[\s\S]*modelo preparado para o próximo boot[\s\S]*sem troca cruzada na conversa viva)|(?:Modelo vivo[\s\S]*solicitado[\s\S]*Confirmação[\s\S]*(?:confirmação do SDK|modelo efetivo))/iu.test(
                    byokModelOutcomeSurface,
                )) &&
                /BYOK status[\s\S]*(seleção preparada cruza provedor ou perfil da sessão atual|seleção preparada e sessão BYOK atual estão alinhadas|modelo preparado confirmado no runtime vivo; vínculo de boot original permanece até nova sessão|rota BYOK da sessão atual coincide; o modelo preparado ainda precisa de confirmação|sem sessão SDK viva)/iu.test(
                    byokAfterModelSurface,
                ) &&
                /BYOK status[\s\S]*Rotina[\s\S]*Trocar[\s\S]*Provar[\s\S]*Avançado/iu.test(byokStatusSurface) &&
                !/\/byok gateway catalog refresh\|diff\|integrity\|sqlite\|search|\/byok gateway selection audit|\/byok auto \[on\|policy\|doctor/iu.test(
                    byokStatusSurface,
                ) &&
                !/\bbinding\b|provider-boundary|provider BYOK vivo|binding de nascimento|binding da sessão viva|cruzam provider\/perfil/iu.test(
                    `${byokStatusSurface}\n${byokModelOutcomeSurface}`,
                ),
            detail: '/byok rendered compact routine/switch/probe/advanced guidance and /byok model kept prepared/live boundary human',
        },
        {
            id: 'ux-cycle-byok-model-switch-request-confirmation',
            pass:
                /Modelo vivo\s+solicitado\s+[\s\S]{0,120}→\s*terminal-ux-boundary-fixture/iu.test(
                    byokModelOutcomeSurface,
                ) &&
                /Confirmação\s+aguarde\s+confirmação do SDK\s+ou próximo uso observado/iu.test(
                    byokModelOutcomeSurface,
                ) &&
                /Atividade Atual da LLM-B[\s\S]*Troca de modelo solicitada/iu.test(byokModelActivitySurface) &&
                /\[MODEL\?\][\s\S]{0,120}\/activity 10/iu.test(byokModelOutcomeSurface) &&
                /modelo preparado confirmado no runtime vivo; vínculo de boot original permanece até nova sessão/iu.test(
                    `${byokAfterModelSurface}\n${sessionSdkAfterByokSurface}`,
                ) &&
                !/modelo BYOK já confirmado na sessão atual/iu.test(
                    `${byokAfterModelSurface}\n${sessionSdkAfterByokSurface}`,
                ),
            detail: '/byok model rendered request, model-check prompt, and precise runtime-vs-boot confirmation copy',
        },
        {
            id: 'ux-cycle-session-sdk-boundary-human',
            pass:
                /Sessão SDK[\s\S]*Vínculo SDK[\s\S]*Preparado[\s\S]*Limite BYOK/iu.test(
                    sessionSdkAfterByokSurface,
                ) &&
                !/\bbinding\b|provider-boundary|provider\/perfil|Foreground|operator-next-boot|sdk-resume-fallback/iu.test(
                    sessionSdkAfterByokSurface,
                ) &&
                !/BYOK\s+pronto\s+BYOK|BYOK\s+BYOK|provedor BYOK|provider\/modelo BYOK/iu.test(
                    sessionSdkAfterByokSurface,
                ),
            detail: '/session sdk rendered BYOK selection boundary without raw binding/provider-boundary vocabulary',
        },
        {
            id: 'ux-cycle-health-compact',
            pass:
                /Saúde do Terminal LLM-B[\s\S]*Conversa[\s\S]*Entrada[\s\S]*Ferramentas[\s\S]*Detalhe\s+\/health full/iu.test(
                    healthSurface,
                ) && !/Diagnóstico do Terminal LLM-B|runtime id|sdk prompts=|streaming=/iu.test(healthSurface),
            detail: '/health default rendered a compact operations panel and kept the full diagnostic behind /health full',
        },
        {
            id: 'ux-cycle-tools-human',
            pass:
                (/Ferramentas observadas[\s\S]*uso[\s\S]*Detalhes\s+\/tools diag/iu.test(toolsSurface) ||
                    /Nenhuma ferramenta observada[\s\S]*Próximo\s+quando a LLM-B usar arquivos/iu.test(toolsSurface)) &&
                !/\btool\(s\)\b|calls=|errors=|blocked=|avg=/iu.test(toolsSurface),
            detail: '/tools default rendered human action stats instead of raw telemetry counters',
        },
        {
            id: 'ux-cycle-sdk-human',
            pass:
                /SDK do Terminal[\s\S]*Sessão[\s\S]*Modelo[\s\S]*Esperas[\s\S]*Modelos\s+\/sdk models/iu.test(
                    sdkSurface,
                ) &&
                /Skills\s+\/sdk skills[\s\S]*Rotina\s+\/sdk quota[\s\S]*Headers\s+\/sdk headers[\s\S]*Simular\s+\/sdk simulate/iu.test(
                    sdkSurface,
                ) &&
                !/SDK do Terminal[\s\S]*(reasoning=|restante=|\[OK\]|\[ERR\]|\n\s{14,}\/sdk skills|\n\s{14,}\/sdk quota|\n\s{14,}\/sdk headers)/iu.test(
                    sdkSurface,
                ) &&
                !/Premium Requests|premium_interactions/iu.test(sdkSurface),
            detail: '/sdk default rendered a themed operations panel with named command rows instead of raw counters or anonymous continuations',
        },
        {
            id: 'ux-cycle-sdk-capabilities-human',
            pass:
                /Capacidades SDK[\s\S]*UI[\s\S]*Tools[\s\S]*Plano[\s\S]*Detalhe\s+\/sdk capabilities detail/iu.test(
                    sdkCapabilitiesSurface,
                ) && !/(?:^|\n)\s*SDK Capabilities\b|\[OK\]|\[ERR\]|\bRetorno\b|\{\s*"ui"/u.test(sdkCapabilitiesSurface),
            detail: '/sdk capabilities rendered a themed human panel without raw JSON in the default surface',
        },
        {
            id: 'ux-cycle-workspace-human',
            pass:
                /Workspace SDK virtual[\s\S]*(Arquivo|Estado)[\s\S]*Listar\s+\/workspace list[\s\S]*Sync\s+\/workspace sync[\s\S]*Mirror\s+\/workspace mirror[\s\S]*Promover\s+\/workspace promote/iu.test(
                    workspaceSurface,
                ) &&
                /Contrato\s+list\/read\/write ficam no workspace SDK virtual[\s\S]*Materializar\s+sync\/mirror copiam SDK para FS local/iu.test(
                    workspaceSurface,
                ) &&
                !/\[OK\]|\[ERR\]|SDK→FS|FS→SDK|\bRetorno\b|\{\s*"files"|\n\s{14,}\[--overwrite\]|\n\s{14,}com auditoria/iu.test(
                    workspaceSurface,
                ),
            detail: '/workspace list rendered a themed SDK workspace panel with named command rows and no raw JSON or anonymous continuations',
        },
        {
            id: 'ux-cycle-live-compact',
            pass:
                /Fluxo da conversa[\s\S]*Estado[\s\S]*Sinais[\s\S]*Detalhe\s+\/live full/iu.test(plain) &&
                !/Terminal Live Flow|cache\/scope|streaming=|sdk\/session|runtime\s+|·\s+idle/iu.test(liveSurface),
            detail: '/live default rendered compact conversation flow instead of telemetry grid',
        },
        {
            id: 'ux-cycle-activity-human',
            pass:
                /Atividade Atual da LLM-B[\s\S]*Estado[\s\S]*Evento[\s\S]*Detalhes\s+\/activity detail mostra origem, auditoria técnica e streaming/iu.test(
                    activitySurface,
                ) &&
                !/\bsource\b|\btools\b|\btraceId\b|Streaming público|\bdeltas\b|cumulativo|Sessão SDK removida|session\.deleted/iu.test(
                    activitySurface,
                ),
            detail: '/activity default rendered human labels and moved technical identifiers behind detail mode',
        },
        {
            id: 'ux-cycle-events-complete-iso',
            pass:
                /Eventos SSE[\s\S]*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}/u.test(
                    eventsSurface,
                ) && !/\btraceId=|\bturnId=|\bhubSessionId=/u.test(eventsSurface),
            detail: '/events default rendered complete ISO 8601 timestamps without raw diagnostic ids',
        },
        {
            id: 'ux-cycle-waits-human',
            pass:
                /Esperas humanas[\s\S]*Estado[\s\S]*nenhuma pendência[\s\S]*Status[\s\S]*Sem bloqueios de input humano do SDK/iu.test(
                    surfaceAt(waitsStart),
                ) && !/SDK Waits|ask_user=|request_user_input=|estado\s{2,}|resumo\s{2,}/u.test(defaultSurface),
            detail: '/sdk waits default rendered human waits without raw SDK tool names',
        },
        {
            id: 'ux-cycle-no-session-cleanup-spam',
            pass: !/Sessão SDK removida|\[SESSION\]|session\.deleted/iu.test(defaultSurface),
            detail: 'default UX did not expose SDK session cleanup as operator-facing activity',
        },
        {
            id: 'ux-cycle-clean-close',
            pass: boot.exitCode === 0 && hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal closed cleanly after default UX cycle with human shutdown copy',
        },
    ];
}

async function runDefaultUxCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot = await runSessionCycleBoot({
        id: 'default-ux-cycle',
        label: 'default human UX surfaces',
        outDir,
        commands: [
            { line: '/help', waitFor: 'Ajuda rápida', advanceAfterMs: 1_500 },
            { line: '/help libs', waitFor: 'Ajuda de libs auxiliares', advanceAfterMs: 1_500 },
            { line: '/help full', waitFor: 'Terminal LLM-B - Ajuda completa', advanceAfterMs: 5_000 },
            { line: '/terminal libs detail', waitFor: 'Libs auxiliares do terminal', advanceAfterMs: 2_000 },
            { line: '/terminal libs deferred', waitFor: 'filtro adiadas', advanceAfterMs: 1_000 },
            { line: '/terminal libs json', waitFor: 'terminal-external-tools-capability-summary', advanceAfterMs: 1_500 },
            { line: '/status', waitFor: 'Status do Terminal LLM-B', advanceAfterMs: 1_500 },
            { line: '/now', waitFor: '\n  Agora', advanceAfterMs: 1_500 },
            { line: '/usage now', waitFor: 'Janela de contexto', advanceAfterMs: 1_500 },
            { line: '/health', waitFor: 'Saúde do Terminal LLM-B', advanceAfterMs: 1_500 },
            { line: '/tools', waitFor: /Ferramentas observadas|Nenhuma ferramenta observada/u, advanceAfterMs: 1_500 },
            { line: '/tools diag', waitFor: /Ferramentas observadas|Nenhuma ferramenta observada/u, advanceAfterMs: 1_500 },
            { line: '/sdk', waitFor: 'SDK do Terminal', advanceAfterMs: 1_500 },
            { line: '/sdk capabilities', waitFor: 'Capacidades SDK', advanceAfterMs: 1_500 },
            { line: '/workspace list', waitFor: 'Workspace SDK virtual', advanceAfterMs: 1_500 },
            { line: '/live', waitFor: 'Fluxo da conversa', advanceAfterMs: 1_500 },
            { line: '/activity 5', waitFor: 'Atividade Atual da LLM-B', advanceAfterMs: 1_500 },
            { line: '/events 20', waitFor: 'Eventos SSE', advanceAfterMs: 1_500 },
            { line: '/sdk waits', waitFor: 'Esperas humanas', advanceAfterMs: 1_500 },
            { line: '/byok', waitFor: 'BYOK status', advanceAfterMs: 1_500 },
            {
                line: '/byok model terminal-ux-boundary-fixture',
                waitFor: /modelo preparado para o próximo boot|Modelo vivo[\s\S]*solicitado/u,
                advanceAfterMs: 1_500,
            },
            { line: '/activity 10', waitFor: 'Atividade Atual da LLM-B', advanceAfterMs: 1_500 },
            { line: '/byok', waitFor: 'BYOK status', advanceAfterMs: 1_500 },
            { line: '/session sdk 6', waitFor: 'Sessão SDK', advanceAfterMs: 1_500 },
            '/quit',
        ],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const criteria = defaultUxCycleCriteria(boot);
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        boot: {
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            transport: boot.transport,
        },
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B Default UX Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
            '## Logs',
            '',
            `- raw: ${path.relative(ROOT, path.join(outDir, 'default-ux-cycle.raw.log'))}`,
            `- plain: ${path.relative(ROOT, path.join(outDir, 'default-ux-cycle.plain.log'))}`,
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function auditUxCycleCriteria(boot) {
    const plain = stripAnsi(boot.plain);
    const commandStart = (command, from = 0) => {
        const pattern = new RegExp(
            `(?:^|\\n)(?:\\s*voc[eê]\\[[^\\n]*?›\\s+|\\s*)${escapeRegExp(command)}(?:\\s*\\r?\\n|\\r|$)`,
            'iu',
        );
        const match = pattern.exec(plain.slice(from));
        return match ? from + match.index : -1;
    };
    const healthStart = commandStart('/health');
    const diagnoseStart = commandStart('/diagnose');
    const errorsStart = commandStart('/errors 10');
    const intentStart = commandStart('/intent 10');
    const intentDetailStart = commandStart('/intent detail 10');
    const auditStart = commandStart('/audit 10');
    const eventsSourcesStart = commandStart('/events sources');
    const eventsSourcesDetailStart = commandStart('/events sources detail', Math.max(0, eventsSourcesStart + 1));
    const quitStart = commandStart('/quit');
    const surfaceStarts = [
        healthStart,
        diagnoseStart,
        errorsStart,
        intentStart,
        intentDetailStart,
        auditStart,
        eventsSourcesStart,
        eventsSourcesDetailStart,
        quitStart,
    ].filter((index) => index >= 0);
    const surfaceAt = (start) => {
        if (start < 0) return '';
        const position = surfaceStarts.indexOf(start);
        return plain.slice(start, surfaceStarts[position + 1] ?? plain.length);
    };
    const healthSurface = surfaceAt(healthStart);
    const diagnoseSurface = surfaceAt(diagnoseStart);
    const errorsSurface = surfaceAt(errorsStart);
    const intentSurface = surfaceAt(intentStart);
    const intentDetailSurface = surfaceAt(intentDetailStart);
    const auditSurface = surfaceAt(auditStart);
    const eventsSourcesSurface = surfaceAt(eventsSourcesStart);
    const eventsSourcesDetailSurface = surfaceAt(eventsSourcesDetailStart);
    const auditDefaultSurface = [
        healthSurface,
        diagnoseSurface,
        errorsSurface,
        intentSurface,
        auditSurface,
        eventsSourcesSurface,
    ].join('\n');
    const rawIdPattern = /chatcmpl-tool-|toolu_|request_user_input|report_intent(?:_local)?|\\x1b\[|scope\.js::/iu;
    const staleCopyPattern = /Drill-down|Label|Atividade info|phase:|tipo I\/O local|disponível\(is\)|runtime ainda/iu;
    return [
        {
            id: 'audit-ux-ready',
            pass: /LLM-B pronta/iu.test(plain) && boot.exitCode === 0,
            detail: 'terminal reached ready state and closed cleanly during audit UX cycle',
        },
        {
            id: 'audit-ux-surfaces-rendered',
            pass:
                /Saúde do Terminal LLM-B/iu.test(healthSurface) &&
                /Diagnóstico do Terminal LLM-B/iu.test(diagnoseSurface) &&
                /Erros rastreados/iu.test(errorsSurface) &&
                /Intenções/iu.test(intentSurface) &&
                /Auditoria/iu.test(auditSurface) &&
                /Fontes do Terminal/iu.test(eventsSourcesSurface),
            detail: 'health, diagnose, errors, intent, audit and event-source surfaces rendered in one PTY session',
        },
        {
            id: 'audit-ux-default-no-raw-ids',
            pass: !rawIdPattern.test(auditDefaultSurface),
            detail: 'default audit surfaces avoided raw tool IDs, SDK prompt names and parser export syntax',
        },
        {
            id: 'audit-ux-default-no-stale-copy',
            pass: !staleCopyPattern.test(auditDefaultSurface),
            detail: 'default audit surfaces avoided stale English/schema copy and old visual placeholders',
        },
        {
            id: 'audit-ux-intent-detail-contained',
            pass:
                /detalhe técnico|Nenhuma intenção capturada ainda/iu.test(intentDetailSurface) &&
                !/toolu_|chatcmpl-tool-|call=/iu.test(intentDetailSurface),
            detail: '/intent detail stayed technical but did not leak provider/tool-call IDs',
        },
        {
            id: 'audit-ux-events-sources-default-human',
            pass:
                /Responsável/iu.test(eventsSourcesSurface) &&
                /Investigar/iu.test(eventsSourcesSurface) &&
                !/\bID\b|Classe|Dono técnico|Emissor|Aceita|Suprime/iu.test(eventsSourcesSurface),
            detail: '/events sources default stayed human while detail fields remained opt-in',
        },
        {
            id: 'audit-ux-events-sources-detail-not-duplicated',
            pass:
                /Fontes do Terminal - Detalhe/iu.test(eventsSourcesDetailSurface) &&
                !/(Fallback\s+[^\n]+\n\s*Fallback\s+)/iu.test(eventsSourcesDetailSurface),
            detail: '/events sources detail rendered technical fields without duplicate fallback rows',
        },
    ];
}

async function runAuditUxCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot = await runSessionCycleBoot({
        id: 'audit-ux-cycle',
        label: 'audit and diagnostic UX surfaces',
        outDir,
        commands: [
            { line: '/health', waitFor: 'Saúde do Terminal LLM-B', advanceAfterMs: 1_500 },
            { line: '/diagnose', waitFor: 'Diagnóstico do Terminal LLM-B', advanceAfterMs: 1_500 },
            { line: '/errors 10', waitFor: 'Erros rastreados', advanceAfterMs: 1_500 },
            { line: '/intent 10', waitFor: 'Intenções', advanceAfterMs: 1_500 },
            { line: '/intent detail 10', waitFor: /Intenções|Nenhuma intenção/u, advanceAfterMs: 1_500 },
            { line: '/audit 10', waitFor: 'Auditoria', advanceAfterMs: 1_500 },
            { line: '/events sources', waitFor: 'Fontes do Terminal', advanceAfterMs: 1_500 },
            { line: '/events sources detail', waitFor: 'Fontes do Terminal - Detalhe', advanceAfterMs: 1_500 },
            '/quit',
        ],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const criteria = auditUxCycleCriteria(boot);
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        boot: {
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            transport: boot.transport,
        },
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B Audit UX Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
            '## Logs',
            '',
            `- raw: ${path.relative(ROOT, path.join(outDir, 'audit-ux-cycle.raw.log'))}`,
            `- plain: ${path.relative(ROOT, path.join(outDir, 'audit-ux-cycle.plain.log'))}`,
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function operatorUxCycleCriteria(boot) {
    const plain = stripAnsi(boot.plain);
    const commandStart = (command, from = 0) => {
        const pattern = new RegExp(
            `(?:^|\\n)\\s*voc[eê]\\[[^\\n]*?›\\s+${escapeRegExp(command)}(?:\\s*\\r?\\n|\\r|$)`,
            'iu',
        );
        const match = pattern.exec(plain.slice(from));
        return match ? from + match.index : -1;
    };
    const indexStatusStart = commandStart('/index status');
    const indexSearchStart = commandStart('/index search terminal');
    const gitHelpStart = commandStart('/git help');
    const gitStatusStart = commandStart('/git status', Math.max(0, gitHelpStart + 1));
    const contextStart = commandStart('/context');
    const sessionSaveStart = commandStart('/session save terminal-ux-live');
    const attachEmptyStart = commandStart('/attach');
    const attachAddStart = commandStart('/attach src/copilot/terminal/commands/workspace-index.js', Math.max(0, attachEmptyStart + 1));
    const mailboxStart = commandStart('/queue clear');
    const modelListStart = commandStart('/model list');
    const byokModelStart = commandStart('/byok model terminal-ux-boundary-fixture');
    const activityAfterByokModelStart = commandStart('/activity 10', Math.max(0, byokModelStart + 1));
    const sdkModelsStart = commandStart('/sdk models');
    const workspaceStart = commandStart('/workspace list');
    const liveStart = commandStart('/live');
    const quitStart = commandStart('/quit');
    const surfaceStarts = [
        indexStatusStart,
        indexSearchStart,
        gitHelpStart,
        gitStatusStart,
        contextStart,
        sessionSaveStart,
        attachEmptyStart,
        attachAddStart,
        mailboxStart,
        modelListStart,
        byokModelStart,
        activityAfterByokModelStart,
        sdkModelsStart,
        workspaceStart,
        liveStart,
        quitStart,
    ].filter((index) => index >= 0);
    const surfaceAt = (start) => {
        if (start < 0) return '';
        const position = surfaceStarts.indexOf(start);
        return plain.slice(start, surfaceStarts[position + 1] ?? plain.length);
    };
    const operationalSurface = [
        surfaceAt(indexStatusStart),
        surfaceAt(indexSearchStart),
        surfaceAt(gitHelpStart),
        surfaceAt(gitStatusStart),
        surfaceAt(contextStart),
        surfaceAt(sessionSaveStart),
        surfaceAt(attachEmptyStart),
        surfaceAt(attachAddStart),
        surfaceAt(mailboxStart),
        surfaceAt(modelListStart),
        surfaceAt(byokModelStart),
        surfaceAt(activityAfterByokModelStart),
        surfaceAt(sdkModelsStart),
        surfaceAt(workspaceStart),
        surfaceAt(liveStart),
    ].join('\n');
    const staleCopyPattern =
        /item\(ns\)|resultado\(s\)|adicional\(is\)|modelo\(s\)|dispon[ií]vel\(is\)|embutido\(s\)|arquivo\(s\)|turno\(s\)|ferramenta\(s\)|cliente\(s\)|cr[ií]tico\(s\)|salva\(s\)|falhou:|workspaceRoot=|indexed=|gitignore=|Git CLI|Sessões Anteriores|Blob adicionado à fila/iu;
    return [
        {
            id: 'operator-ux-ready',
            pass: /LLM-B pronta/iu.test(plain) && boot.exitCode === 0,
            detail: 'terminal reached ready state and closed cleanly during operator UX cycle',
        },
        {
            id: 'operator-ux-index-human',
            pass:
                /Índice L2 local/iu.test(surfaceAt(indexStatusStart)) &&
                /\/index search[\s\S]*resultados/iu.test(surfaceAt(indexSearchStart)) &&
                !/workspaceRoot=|indexed=|gitignore=|falhou:|\s+export(?:\s|$)/iu.test(
                    `${surfaceAt(indexStatusStart)}\n${surfaceAt(indexSearchStart)}`,
                ),
            detail: '/index status/search rendered themed human rows without raw index fields',
        },
        {
            id: 'operator-ux-git-human-shell',
            pass:
                /\/git help[\s\S]*Git operacional[\s\S]*Status\s+\/git status[\s\S]*Diff\s+\/git diff[\s\S]*Stash\s+\/git stash/iu.test(
                    surfaceAt(gitHelpStart),
                ) &&
                /Git status/iu.test(surfaceAt(gitStatusStart)) &&
                !/Git CLI|Verificando status git|Buscando log|Executando git pull|Comandos\s+\/git status\s*\n|✗|✓/iu.test(
                    `${surfaceAt(gitHelpStart)}\n${surfaceAt(gitStatusStart)}`,
                ),
            detail: '/git help/status used themed command shell instead of old local ANSI banners',
        },
        {
            id: 'operator-ux-context-session-attach',
            pass:
                /Contexto|Uso do contexto/iu.test(surfaceAt(contextStart)) &&
                /Snapshot\s+salvo/iu.test(surfaceAt(sessionSaveStart)) &&
                /Fila|Fila de anexos|Adicionado/iu.test(`${surfaceAt(attachEmptyStart)}\n${surfaceAt(attachAddStart)}`),
            detail: '/context, /session save and /attach rendered the updated operator-facing copy',
        },
        {
            id: 'operator-ux-model-sdk-live',
            pass:
                /Modelos disponíveis|Nenhum modelo retornado pelo SDK/iu.test(surfaceAt(modelListStart)) &&
                /Modelos SDK/iu.test(surfaceAt(sdkModelsStart)) &&
                /Workspace SDK virtual/iu.test(surfaceAt(workspaceStart)) &&
                /Fluxo da conversa/iu.test(surfaceAt(liveStart)),
            detail: '/model list, /sdk models, /workspace list and /live rendered in one PTY session',
        },
        {
            id: 'operator-ux-byok-model-live-state',
            pass:
                /Modelo vivo\s+solicitado\s+[\s\S]{0,140}terminal-ux-boundary-fixture/iu.test(
                    surfaceAt(byokModelStart),
                ) &&
                /Confirmação\s+aguarde\s+confirmação do SDK\s+ou próximo uso observado/iu.test(
                    surfaceAt(byokModelStart),
                ) &&
                /Atividade Atual da LLM-B[\s\S]{0,700}(?:Troca de modelo solicitada|Modelo SDK confirmado)/iu.test(
                    surfaceAt(activityAfterByokModelStart),
                ) &&
                /Timeline operacional[\s\S]{0,900}Troca de modelo solicitada/iu.test(surfaceAt(activityAfterByokModelStart)) &&
                /Estado\s+modelo/iu.test(surfaceAt(activityAfterByokModelStart)) &&
                /confirma pedido terminal \/byok model/iu.test(surfaceAt(liveStart)) &&
                !/Estado\s+model\b|provider-boundary|binding de nascimento|binding da sessão viva|provider BYOK|terminal\.byok_model/iu.test(
                    `${surfaceAt(byokModelStart)}\n${surfaceAt(activityAfterByokModelStart)}\n${surfaceAt(liveStart)}`,
                ),
            detail: '/byok model rendered a live model request, confirmation guidance and model activity state',
        },
        {
            id: 'operator-ux-no-stale-copy',
            pass: !staleCopyPattern.test(operationalSurface),
            detail: 'operator command surfaces avoided old mechanical plurals, raw index fields and stale English banners',
        },
    ];
}

async function runOperatorUxCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot = await runSessionCycleBoot({
        id: 'operator-ux-cycle',
        label: 'operator command UX surfaces',
        outDir,
        commands: [
            { line: '/index status', waitFor: 'Índice L2', advanceAfterMs: 1_500 },
            { line: '/index search terminal', waitFor: '/index search', advanceAfterMs: 1_500 },
            { line: '/git help', waitFor: 'Git operacional', advanceAfterMs: 1_500 },
            { line: '/git status', waitFor: 'Git status', advanceAfterMs: 1_500 },
            { line: '/context', waitFor: /Contexto|Uso do contexto/u, advanceAfterMs: 1_500 },
            { line: '/session save terminal-ux-live', waitFor: 'Snapshot', advanceAfterMs: 1_500 },
            { line: '/attach', waitFor: 'Fila', advanceAfterMs: 1_500 },
            {
                line: '/attach src/copilot/terminal/commands/workspace-index.js',
                waitFor: 'Adicionado',
                advanceAfterMs: 1_500,
            },
            { line: '/queue clear', waitFor: 'Fila de intervenção', advanceAfterMs: 1_500 },
            { line: '/model list', waitFor: /Modelos disponíveis|Nenhum modelo retornado pelo SDK/u, advanceAfterMs: 1_500 },
            {
                line: '/byok model terminal-ux-boundary-fixture',
                waitFor:
                    /Modelo vivo\s+solicitado|Troca modelo\s+(?:sessão atual|falhou)|Sessão viva\s+não inspecionada/u,
                advanceAfterMs: 1_500,
            },
            { line: '/activity 10', waitFor: 'Atividade Atual da LLM-B', advanceAfterMs: 1_500 },
            { line: '/sdk models', waitFor: 'Modelos SDK', advanceAfterMs: 2_500 },
            { line: '/workspace list', waitFor: 'Workspace SDK virtual', advanceAfterMs: 1_500 },
            { line: '/live', waitFor: 'Fluxo da conversa', advanceAfterMs: 1_500 },
            '/quit',
        ],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const criteria = operatorUxCycleCriteria(boot);
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        boot: {
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            transport: boot.transport,
        },
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B Operator UX Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
            '## Logs',
            '',
            `- raw: ${path.relative(ROOT, path.join(outDir, 'operator-ux-cycle.raw.log'))}`,
            `- plain: ${path.relative(ROOT, path.join(outDir, 'operator-ux-cycle.plain.log'))}`,
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function hasReturnedToReplPrompt(plain, outputOffset) {
    return REPL_PROMPT_TAIL_RE.test(String(plain ?? '').slice(outputOffset));
}

function hasReturnedToNormalReplPrompt(plain, outputOffset) {
    return REPL_NORMAL_PROMPT_TAIL_RE.test(String(plain ?? '').slice(outputOffset));
}

function extractTerminalUxRowValue(surface, label) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s+([^\\n\\r]+)`, 'u');
    return String(surface ?? '').match(pattern)?.[1]?.trim() ?? '';
}

function findAssistantEndedBeforeRequiredAsk(plain, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID], events = []) {
    const text = String(plain ?? '');
    if (scenario.askRenderedRe.test(text)) return null;
    if (!hasRenderedRequiredDeltaTail(text)) return null;
    const promptReturned = /Turno concluído; aguardando próxima mensagem|Aguardando próxima mensagem/iu.test(text);
    const assistantMessage = Array.isArray(events)
        ? events.find((evt) => {
              if (evt?.event !== 'assistant.message' || !isObjectPayload(evt.data)) return false;
              return hasRequiredDeltaTail(String(evt.data.content ?? ''));
          })
        : null;
    const askEvent = Array.isArray(events)
        ? events.find((evt) => evt?.event === 'user_input.requested' || evt?.event === 'elicitation.pending')
        : null;
    if (askEvent) return null;
    if (!promptReturned && !assistantMessage) return null;
    return {
        eventId: Number(assistantMessage?.id),
        traceId: typeof assistantMessage?.data?.traceId === 'string' ? assistantMessage.data.traceId : null,
        turnId: typeof assistantMessage?.data?.turnId === 'string' ? assistantMessage.data.turnId : null,
    };
}

function findAssistantEndedAfterAskRecoveryWithoutAsk(plain, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    const text = String(plain ?? '');
    if (scenario.askRenderedRe.test(text)) return null;
    if (!/Turno conclu[ií]do; aguardando próxima mensagem|Aguardando próxima mensagem/iu.test(text)) return null;
    if (!/Continue o teste can[oô]nico exatamente de onde parou/iu.test(text)) return null;
    return { traceId: null, turnId: null, eventId: null };
}

function findIncompleteExpectedToolChain(events, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    const expectedTools = scenario.expectedLifecycleTools;
    if (expectedTools.length === 0) return null;
    const statuses = expectedTools.map((tool) => {
        const lifecycle = summarizeNamedToolLifecycle(events, tool.name);
        const expectsFailure = (tool.expectedOutcome ?? 'success') === 'failure';
        return {
            name: tool.name,
            completed: expectsFailure
                ? lifecycle.failed || lifecycle.postToolFailure
                : lifecycle.done || lifecycle.postToolSuccess,
            started: lifecycle.start,
            expectedOutcome: expectsFailure ? 'failure' : 'success',
        };
    });
    const completed = statuses.filter((tool) => tool.completed).map((tool) => tool.name);
    const missing = statuses.filter((tool) => !tool.completed).map((tool) => tool.name);
    if (completed.length === 0 || missing.length === 0) return null;
    return { completed, missing };
}

function isHardCriterionFailure(criterion) {
    return criterion?.pass !== true && criterion?.severity !== 'warning' && criterion?.required !== false;
}

function allRequiredCriteriaPassed(criteria) {
    return criteria.every((criterion) => !isHardCriterionFailure(criterion));
}

function criterionMarker(criterion) {
    if (criterion.pass) return '[x]';
    return isHardCriterionFailure(criterion) ? '[ ]' : '[!]';
}

function buildReport({
    criteria,
    durationMs,
    exitCode,
    blocker,
    outputPath,
    plainOutputPath,
    exportPath,
    exportSummary,
    sseRawPath,
    sseJsonlPath,
    sseSummary,
    startedAt,
    transport,
    liveHealthRecord,
    liveScenarioRunRecord,
    sdkSessionBootSelection,
    liveScenario,
}) {
    const ok = allRequiredCriteriaPassed(criteria);
    const status = blocker ? 'BLOCKED' : ok ? 'PASS' : 'FAIL';
    const lines = [
        '# Terminal LLM-B Live Test',
        '',
        `Started: ${startedAt}`,
        `Duration: ${durationMs}ms`,
        `Exit code: ${String(exitCode)}`,
        `Transport: ${transport}`,
        `Status: ${status}`,
        ...(liveScenario
            ? [
                  `Live scenario: ${liveScenario.id} · ${liveScenario.description}`,
                  `Ask question: ${liveScenario.askQuestion}`,
              ]
            : []),
        ...(blocker ? [`Blocker: ${blocker.id} · ${blocker.detail}`] : []),
        '',
        '## Artifacts',
        '',
        `- Raw output: ${outputPath}`,
        `- Plain output: ${plainOutputPath}`,
        `- Exported Markdown: ${exportPath ?? '-'}`,
        `- SSE raw output: ${sseRawPath}`,
        `- SSE JSONL: ${sseJsonlPath}`,
        `- BYOK live health record: ${liveHealthRecord?.recorded ? 'recorded' : liveHealthRecord?.attempted ? `not-recorded · ${liveHealthRecord.reason ?? 'unknown'}` : 'n/a'}`,
        `- Live scenario run record: ${liveScenarioRunRecord?.recorded ? 'recorded' : liveScenarioRunRecord?.attempted ? `not-recorded · ${liveScenarioRunRecord.reason ?? 'unknown'}` : 'n/a'}`,
        `- SDK session boot selection: ${sdkSessionBootSelection?.attempted ? (sdkSessionBootSelection.ok ? 'forced-new' : `failed · ${sdkSessionBootSelection.reason ?? 'unknown'}`) : 'unchanged'}`,
        '',
        '## SSE',
        '',
        `- Connected: ${sseSummary.connected ? 'yes' : 'no'}`,
        `- Events: ${sseSummary.eventCount}`,
        `- Events with id: ${sseSummary.eventsWithId}`,
        `- Events with source: ${sseSummary.eventsWithSource ?? 0}`,
        `- Events with traceId: ${sseSummary.eventsWithTraceId ?? 0}`,
        `- TraceIds: ${(sseSummary.traceIds ?? []).slice(0, 8).join(', ') || '-'}`,
        `- Errors: ${sseSummary.errors.length}`,
        `- Export: ${exportSummary?.ok ? 'ok' : exportSummary ? 'failed' : 'n/a'}${exportSummary?.detail ? ` · ${exportSummary.detail}` : ''}`,
        '',
        '## Criteria',
        '',
        ...criteria.map((criterion) => `- ${criterionMarker(criterion)} ${criterion.id}: ${criterion.detail}`),
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function liveScenarioKind({
    autoControlProbe,
    byokControlProbe,
    byokFixture,
    byokReal,
    noPr,
    sessionCycle,
    structuredInputCycle,
    menuCycle,
    pickerInteractiveCycle,
    uxCycle,
    diagnosticUxCycle,
    auditUxCycle,
    operatorUxCycle,
    modelControlProbe,
    liveScenario,
}) {
    if (sessionCycle) return 'session_cycle';
    if (structuredInputCycle) return 'structured_input_cycle';
    if (menuCycle) return 'menu_cycle';
    if (pickerInteractiveCycle) return 'picker_interactive_cycle';
    if (uxCycle) return 'default_ux_cycle';
    if (diagnosticUxCycle) return 'diagnostic_ux_cycle';
    if (auditUxCycle) return 'audit_ux_cycle';
    if (operatorUxCycle) return 'operator_ux_cycle';
    if (modelControlProbe) return 'model_probe';
    if (autoControlProbe) return 'auto_probe';
    if (byokFixture) return 'byok_fixture_no_pr';
    if (byokControlProbe) return 'byok_control_no_pr';
    if (byokReal && noPr) return 'byok_real_no_pr';
    if (byokReal) return 'byok_real_full';
    if (noPr) return 'control_no_pr';
    if (liveScenario?.id && liveScenario.id !== DEFAULT_LIVE_SCENARIO_ID)
        return `canonical_full_turn_${liveScenario.id}`;
    return 'canonical_full_turn';
}

async function scheduleFreshSdkSessionForCanonicalScenario({ enabled }) {
    if (!enabled) return { attempted: false, ok: true, reason: 'disabled' };
    try {
        const { scheduleAgentSdkSessionBootSelection } =
            await import('../../../src/copilot/presentation/runtime/sdk-session.js');
        const result = await scheduleAgentSdkSessionBootSelection({ mode: 'new' });
        const resultValue = result && typeof result === 'object' ? result.value : null;
        const persistedSelection =
            resultValue && typeof resultValue === 'object' && resultValue.nextSdkSessionBoot
                ? resultValue.nextSdkSessionBoot
                : null;
        const resultSummary = {
            ok: result?.ok !== false,
            persistedSelection,
        };
        if (result?.ok === false) {
            return {
                attempted: true,
                ok: false,
                reason: typeof result.error === 'string' ? result.error : 'schedule-returned-not-ok',
                result: resultSummary,
            };
        }
        return { attempted: true, ok: true, result: resultSummary };
    } catch (error) {
        return {
            attempted: true,
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

async function recordLiveScenarioRunToSqlite({
    criteria,
    startedAt,
    durationMs,
    exitCode,
    blocker,
    scenarioKind,
    outDir,
    mdPath,
    rawPath,
    plainPath,
    sseJsonlPath,
    transport,
}) {
    const failedCriteria = criteria.filter(isHardCriterionFailure);
    const completedAt = new Date(
        Date.parse(startedAt) + Math.max(0, Number.isFinite(durationMs) ? durationMs : 0),
    ).toISOString();
    const runId = `terminal-live:${String(startedAt).replace(/[:.]/gu, '-')}:${scenarioKind}`;
    try {
        const { SqliteModelGatewayCatalogStore } = await import('../../../src/copilot/model-gateway/index.js');
        const store = new SqliteModelGatewayCatalogStore();
        const result = await store.writeLiveScenarioRunRecords([
            {
                runId,
                scenarioKind,
                status: blocker ? 'blocked' : failedCriteria.length === 0 ? 'passed' : 'failed',
                ok: failedCriteria.length === 0 && !blocker,
                blocked: Boolean(blocker),
                blocker,
                startedAt,
                completedAt,
                durationMs,
                exitCode,
                artifactDir: path.relative(ROOT, outDir),
                summaryPath: path.relative(ROOT, mdPath),
                rawPath: path.relative(ROOT, rawPath),
                plainPath: path.relative(ROOT, plainPath),
                sseJsonlPath: path.relative(ROOT, sseJsonlPath),
                transport,
                criteriaTotal: criteria.length,
                criteriaFailed: failedCriteria.length,
                criteria: criteria.map((criterion) => ({
                    id: criterion.id,
                    pass: criterion.pass === true,
                    required: criterion.required !== false,
                    severity: criterion.severity ?? null,
                    detail: criterion.detail ?? null,
                })),
            },
        ]);
        return { attempted: true, recorded: result.liveScenarioRuns === 1, runId, result };
    } catch (error) {
        return {
            attempted: true,
            recorded: false,
            runId,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

async function writeEarlyBlockedSummary({
    blocker,
    startedAt,
    outDir,
    rawPath,
    plainPath,
    exportPath,
    sseRawPath,
    sseJsonlPath,
    jsonPath,
    mdPath,
    transport,
    realByok,
    sdkSessionBootSelection,
    liveScenario,
}) {
    const durationMs = Date.now() - Date.parse(startedAt);
    const raw = `[terminal-live] blocked before terminal start: ${blocker.id} · ${blocker.detail}\n`;
    const sseSummary = {
        connected: false,
        statusCode: null,
        eventCount: 0,
        eventsWithId: 0,
        eventsWithSource: 0,
        eventsWithTraceId: 0,
        traceIds: [],
        errors: ['blocked-before-terminal-start'],
        events: [],
        raw: '',
    };
    const criteria = [
        { id: `blocked-by-${blocker.id}`, pass: false, detail: blocker.detail },
        {
            id: 'terminal-not-started-after-blocker',
            pass: true,
            detail: 'runtime selector blocker prevented default BYOK fallback',
        },
    ];
    const liveHealthRecord = { attempted: false, recorded: false, reason: `live_turn_not_attempted:${blocker.id}` };
    await writeFile(rawPath, raw, 'utf8');
    await writeFile(plainPath, raw, 'utf8');
    await writeFile(sseRawPath, '', 'utf8');
    await writeFile(sseJsonlPath, '', 'utf8');
    await writeFile(
        jsonPath,
        `${JSON.stringify(
            {
                ok: false,
                blocked: true,
                blocker,
                startedAt,
                durationMs,
                exitCode: null,
                criteria,
                sse: sseSummary,
                byokReal: realByok?.redacted ?? null,
                sdkSessionBootSelection: sdkSessionBootSelection ?? {
                    attempted: false,
                    ok: true,
                    reason: 'not-applicable',
                },
                liveHealthRecord,
                export: null,
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
    await writeFile(
        mdPath,
        buildReport({
            criteria,
            durationMs,
            exitCode: null,
            blocker,
            outputPath: path.relative(ROOT, rawPath),
            plainOutputPath: path.relative(ROOT, plainPath),
            exportPath: path.relative(ROOT, exportPath),
            exportSummary: null,
            sseRawPath: path.relative(ROOT, sseRawPath),
            sseJsonlPath: path.relative(ROOT, sseJsonlPath),
            sseSummary,
            startedAt,
            transport,
            liveHealthRecord,
            sdkSessionBootSelection,
            liveScenario,
        }),
        'utf8',
    );
    if (realByok) {
        await writeFile(
            path.join(outDir, 'byok.real.redacted.json'),
            `${JSON.stringify(realByok.redacted, null, 2)}\n`,
            'utf8',
        );
    }
}

function detectLiveBlocker(plain, runtime = {}) {
    const rateLimitMatch = plain.match(
        /You've hit your rate limit\.[^\n]*(?:reset in ([^.]+)\.)?[^\n]*(?:Request ID: ([^)]+))?/i,
    );
    if (rateLimitMatch) {
        return {
            id: 'sdk-rate-limit',
            detail: `GitHub Copilot SDK rate limit${rateLimitMatch[1] ? ` · reset em ${rateLimitMatch[1].trim()}` : ''}${rateLimitMatch[2] ? ` · request=${rateLimitMatch[2].trim()}` : ''}`,
        };
    }
    if (/\[rate_limit\]/i.test(plain)) {
        return { id: 'sdk-rate-limit', detail: 'GitHub Copilot SDK rate limit' };
    }
    const byokCreditsMatch = plain.match(
        /\b402\s+Add credits to continue,\s*or switch to a free model\b|provider BYOK recusou a chamada por credito, saldo ou cota(?: \(HTTP 402\))?/i,
    );
    if (byokCreditsMatch) {
        return {
            id: 'byok-provider-credits',
            detail: 'BYOK provider rejected the selected paid model with 402; switch to a free/credited model',
        };
    }
    const byokAdmissionMatch = plain.match(
        /Turno não enviado ao provider BYOK:[^\n]*|terminal\.byok\.admission_blocked|BYOK budget:[^\n]*limite BYOK[^\n]*/i,
    );
    if (byokAdmissionMatch) {
        return {
            id: 'byok-admission-blocked',
            detail: 'BYOK admission control contained the turn before provider streaming because the declared request budget is too small',
        };
    }
    const byokRouteNoResponseMatch = plain.match(
        /Rota BYOK\s+rota BYOK ficou sem resposta dentro da janela esperada[^\n]*|\[DialogLoopManager\]\s+sendTurn sem progresso por\s+(\d+)ms/i,
    );
    if (byokRouteNoResponseMatch) {
        return {
            id: 'byok-route-no-response',
            detail:
                'BYOK route accepted the turn but produced no public response inside the dialog progress window' +
                `${byokRouteNoResponseMatch[1] ? ` · progress=${byokRouteNoResponseMatch[1]}ms` : ''}`,
        };
    }
    const byokPreflight = findByokRealPreflightProbeFailure(plain);
    if (byokPreflight) {
        return {
            id: 'byok-preflight-probe-failed',
            detail:
                'disposable BYOK preflight blocked the canonical live turn before operator transcript mutation' +
                `${byokPreflight.kinds.length > 0 ? ` · probes=${byokPreflight.kinds.join('+')}` : ''}` +
                `${byokPreflight.profile ? ` · profile=${byokPreflight.profile}` : ''}` +
                `${byokPreflight.model ? ` · model=${byokPreflight.model}` : ''}`,
        };
    }
    const byokLiveToolProtocolMiss = findByokRealLiveToolProtocolMiss(
        plain,
        runtime.liveScenario ?? LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID],
    );
    if (byokLiveToolProtocolMiss) {
        return {
            id: 'byok-live-tool-protocol-missed',
            detail:
                'BYOK live turn rendered tool-shaped protocol or a textual ask_user simulation without materializing the required live terminal interaction' +
                `${byokLiveToolProtocolMiss.markers.length > 0 ? ` · text=${byokLiveToolProtocolMiss.markers.join('+')}` : ''}`,
        };
    }
    const unexpectedScenarioTool = findUnexpectedScenarioTool(runtime.sseEvents, runtime.liveScenario);
    if (unexpectedScenarioTool) {
        return {
            id: 'unexpected-scenario-tool',
            detail:
                `LLM-B used a tool outside the live scenario allowlist before completing the canonical ask/final` +
                ` · tool=${unexpectedScenarioTool.toolName}` +
                `${unexpectedScenarioTool.allowedTools.length > 0 ? ` · allowed=${unexpectedScenarioTool.allowedTools.join(',')}` : ''}` +
                `${Number.isFinite(unexpectedScenarioTool.eventId) ? ` · sse=#${unexpectedScenarioTool.eventId}` : ''}`,
        };
    }
    if (
        /erro de provider BYOK/i.test(plain) ||
        /Erro de sessão BYOK/i.test(plain) ||
        /\[query\]\s+Failed to get response from the AI model/i.test(plain) ||
        /\[cancellation\]\s+Operation cancelled by user/i.test(plain)
    ) {
        const modelMatch = plain.match(/modelo=([^\s·\n]+)/i);
        return {
            id: 'byok-provider-turn-failed',
            detail: `BYOK provider turn failed and was contained without Copilot fallback${modelMatch?.[1] ? ` · model=${modelMatch[1]}` : ''}`,
        };
    }
    const scenario = runtime.liveScenario ?? LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID];
    const askBeforeDeltas = findAskBeforeRequiredPublicDeltas(runtime.sseEvents, scenario);
    if (askBeforeDeltas) {
        return {
            id: 'assistant-asked-before-required-deltas',
            detail:
                'assistant called the required ask_user tool before materializing the required public DELTA-CANONICAL lines' +
                `${askBeforeDeltas.askEventId ? ` · askSse=#${askBeforeDeltas.askEventId}` : ''}` +
                ` · deltasBeforeAsk=${askBeforeDeltas.deltaMarkersBeforeAsk}`,
        };
    }
    const divergentAsk = findDivergentScenarioAsk(plain, scenario);
    if (divergentAsk) {
        return {
            id: 'assistant-ask-question-diverged',
            detail:
                'assistant called ask_user with a question that does not match the live scenario contract' +
                ` · expected="${divergentAsk.expected}"` +
                ` · observed="${divergentAsk.observed}"`,
        };
    }
    const emptyOutput =
        findUnrecoveredTerminalEmptyOutputEvent(runtime.sseEvents) ??
        findUnrecoveredEmptyDialogTurnEnd(runtime.sseEvents);
    if (/Turno\s+(?:terminou\s+)?sem saída pública/i.test(plain) || emptyOutput) {
        const emptyOutputIndex = Number.isInteger(emptyOutput?.index) ? emptyOutput.index : null;
        const asked =
            Boolean(findUserInputRequestedEvent(runtime.sseEvents, { beforeIndex: emptyOutputIndex })) ||
            (emptyOutputIndex === null && scenario.askRenderedRe.test(plain));
        const answered =
            Boolean(findUserInputCompletedEvent(runtime.sseEvents, { beforeIndex: emptyOutputIndex })) ||
            (emptyOutputIndex === null &&
                new RegExp(
                    `\\[PERG(?:UNTA)?\\]›\\s*${escapeRegExp(scenario.answerSteps.at(-1)?.answer ?? '')}`,
                    'iu',
                ).test(plain));
        const id = answered ? 'assistant-empty-after-user-input' : asked ? 'assistant-empty-after-ask' : 'assistant-empty-turn';
        const recoveredAfterUserInput =
            id === 'assistant-empty-after-user-input' &&
            scenario.postAskFinalRe.test(plain) &&
            /Continuação automática|Retomada automática|Continuação vazia|RECUPERANDO|dialog\.empty_after_user_input\.auto_recovery/iu.test(
                plain,
            );
        if (recoveredAfterUserInput) return null;
        const phaseDetail = answered
            ? 'after the operator answered the required ask_user prompt'
            : asked
              ? 'after the required ask_user prompt was rendered'
              : 'before the required canonical ask/final was fully materialized';
        return {
            id,
            detail:
                `terminal reached an explicit turn with empty public output ${phaseDetail}` +
                `${emptyOutput?.traceId ? ` · trace=${emptyOutput.traceId}` : ''}` +
                `${emptyOutput?.turnId ? ` · turn=${emptyOutput.turnId}` : ''}` +
                `${Number.isFinite(emptyOutput?.eventId) ? ` · sse=#${emptyOutput.eventId}` : ''}`,
        };
    }
    const endedBeforeAsk = findAssistantEndedBeforeRequiredAsk(plain, runtime.liveScenario, runtime.sseEvents);
    if (endedBeforeAsk) {
        return {
            id: 'assistant-ended-before-ask',
            detail:
                'assistant produced the required public deltas and returned to idle before calling the required ask_user tool' +
                `${endedBeforeAsk.traceId ? ` · trace=${endedBeforeAsk.traceId}` : ''}` +
                `${endedBeforeAsk.turnId ? ` · turn=${endedBeforeAsk.turnId}` : ''}` +
                `${Number.isFinite(endedBeforeAsk.eventId) ? ` · sse=#${endedBeforeAsk.eventId}` : ''}`,
        };
    }
    if (runtime.timedOut) {
        return {
            id: 'live-timeout',
            detail:
                `runner timeout before scenario completion` +
                ` · stage=${runtime.timeoutStage ?? 'unknown'}` +
                `${Number.isFinite(runtime.timeoutBudgetMs) ? ` · budget=${Math.round(runtime.timeoutBudgetMs)}ms` : ''}` +
                ` · ask=${runtime.answerSent ? 'answered' : 'not-answered'}` +
                ` · postAsk=${runtime.postAskContinuationObserved ? 'observed' : 'missing'}` +
                ` · diagnostics=${runtime.postCommandsSent ? 'started' : 'not-started'}`,
        };
    }
    return null;
}

function findAskBeforeRequiredPublicDeltas(events, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    if (!Array.isArray(events) || !scenario?.askQuestion) return null;
    const askIndex = events.findIndex((evt) => evt?.event === 'user_input.requested' || evt?.event === 'elicitation.pending');
    if (askIndex < 0) return null;
    let deltaMarkersBeforeAsk = 0;
    for (const evt of events.slice(0, askIndex)) {
        const payload = eventPayload(evt);
        const content =
            typeof payload?.content === 'string'
                ? payload.content
                : typeof payload?.chunk === 'string'
                  ? payload.chunk
                  : '';
        deltaMarkersBeforeAsk += countRequiredDeltaMarkers(content);
    }
    if (deltaMarkersBeforeAsk >= 8) return null;
    const askEvent = events[askIndex];
    return {
        askEventId: Number.isFinite(askEvent?.id)
            ? Number(askEvent.id)
            : Number.isFinite(askEvent?.eventId)
              ? Number(askEvent.eventId)
              : null,
        deltaMarkersBeforeAsk,
    };
}

function findUnexpectedScenarioTool(events, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    const allowedTools = Array.isArray(scenario?.allowedTools) ? [...scenario.allowedTools] : [];
    if (allowedTools.length === 0 || !Array.isArray(events)) return null;
    for (const evt of events) {
        if (evt?.event !== 'tool.lifecycle') continue;
        const payload = evt.data && typeof evt.data === 'object' ? evt.data : {};
        const type = String(payload.type ?? '');
        if (!isLifecycleStartType(type)) continue;
        const toolName = normalizeLifecycleToolName(payload);
        if (!toolName || toolName.startsWith('io.')) continue;
        const allowed = allowedTools.some((expectedName) => isLifecycleTool(payload, expectedName));
        if (allowed) continue;
        return {
            toolName,
            allowedTools,
            eventId: typeof evt.id === 'number' ? evt.id : typeof evt.eventId === 'number' ? evt.eventId : null,
        };
    }
    return null;
}

function findByokRealPreflightProbeFailure(plain) {
    const results = [...plain.matchAll(/BYOK (chat|agent) probe[\s\S]{0,1800}?resultado:\s+failed\b([^\n]*)/giu)];
    if (results.length === 0) return null;
    const kinds = [...new Set(results.map((result) => result[1]?.toLowerCase()).filter(Boolean))];
    const detail = results.map((result) => result[2] ?? '').join(' ');
    return {
        kinds,
        profile: detail.match(/\bprofile=([^\s·]+)/iu)?.[1] ?? null,
        model: detail.match(/\bmodel=([^\s·]+)/iu)?.[1] ?? null,
    };
}

function findByokProbeResultStatus(plain, mode) {
    const escapedMode = escapeRegExp(mode);
    const match = String(plain ?? '').match(
        new RegExp(`BYOK ${escapedMode} probe[\\s\\S]*?resultado:\\s+([\\w-]+)`, 'iu'),
    );
    return match?.[1]?.toLowerCase() ?? null;
}

function findByokRealLiveToolProtocolMiss(plain, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    // The live transcript intentionally preserves assistant Markdown; the
    // public delta marker may therefore arrive as `DELTA-*` or `**DELTA-* **`.
    if (scenario.askRenderedRe.test(plain)) return null;
    const markers = [
        /(?:^|\n)\s*│\s+"tool_calls"\s*:/mu.test(plain) ? 'tool_calls' : null,
        /(?:^|\n)\s*│\s+"function"\s*:\s*"report_intent"/mu.test(plain) ? 'function:report_intent' : null,
        /(?:^|\n)\s*│\s+"function"\s*:\s*"read_file_content"/mu.test(plain) ? 'function:read_file_content' : null,
        /(?:^|\n)\s*│\s+"function"\s*:\s*"ask_user"/mu.test(plain) ? 'function:ask_user' : null,
        /(?:^|\n)\s*│\s+"tool":\s*"report_intent"/mu.test(plain) ? 'report_intent' : null,
        /(?:^|\n)\s*│\s+"tool":\s*"read_file_content"/mu.test(plain) ? 'read_file_content' : null,
        /(?:^|\n)\s*│\s+"tool":\s*"ask_user"/mu.test(plain) ? 'ask_user' : null,
        /(?:^|\n)\s*│\s+\*\*Pergunta ao usu[aá]rio:\*\*/mu.test(plain) ? 'ask_user_text' : null,
        new RegExp(`(?:^|\\n)\\s*│\\s+"question":\\s*"${escapeRegExp(scenario.askQuestion.split(':')[0])}:`, 'mu').test(
            plain,
        )
            ? 'ask_user_question_json'
            : null,
        /(?:^|\n)\s*│\s+The requested actions have been executed\b/mu.test(plain) ? 'claimed_execution' : null,
    ].filter(Boolean);
    if (markers.length > 0 && !renderedReadFileToolOk(plain)) {
        return { markers };
    }
    if (!hasRenderedRequiredDeltaTail(plain)) return null;
    const hasTextifiedAsk =
        markers.includes('ask_user') || markers.includes('ask_user_text') || markers.includes('ask_user_question_json');
    return hasTextifiedAsk || markers.length >= 2 ? { markers } : null;
}

function isObjectPayload(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function eventPayloadMatchesTurnIdentity(payload, identity) {
    if (!isObjectPayload(payload)) return false;
    const traceId = typeof payload.traceId === 'string' ? payload.traceId : null;
    const turnId = typeof payload.turnId === 'string' ? payload.turnId : null;
    if (identity.traceId && traceId === identity.traceId) return true;
    if (identity.turnId && turnId === identity.turnId) return true;
    return !identity.traceId && !identity.turnId;
}

function hasPublicAssistantMessageAfterEvent(events, eventIndex, identity) {
    if (!Array.isArray(events)) return false;
    for (let index = eventIndex + 1; index < events.length; index += 1) {
        const evt = events[index];
        if (evt?.event !== 'assistant.message' || !isObjectPayload(evt.data)) continue;
        if (!eventPayloadMatchesTurnIdentity(evt.data, identity)) continue;
        const content = typeof evt.data.content === 'string' ? evt.data.content.trim() : '';
        if (content.length > 0) return true;
    }
    return false;
}

function hasPublicMaterializationAfterEvent(events, eventIndex) {
    if (!Array.isArray(events)) return false;
    for (let index = eventIndex + 1; index < events.length; index += 1) {
        const evt = events[index];
        if (!isObjectPayload(evt?.data)) continue;
        if (evt.event === 'assistant.message') {
            const content = typeof evt.data.content === 'string' ? evt.data.content.trim() : '';
            if (content.length > 0) return true;
        }
        if (evt.event === 'delta') {
            const chunk = typeof evt.data.chunk === 'string' ? evt.data.chunk.trim() : '';
            if (chunk.length > 0) return true;
        }
        if (evt.event === 'dialog.reply') {
            const reply = typeof evt.data.reply === 'string' ? evt.data.reply.trim() : '';
            if (reply.length > 0) return true;
        }
        if (evt.event === 'dialog.turn_end') {
            const reply = typeof evt.data.reply === 'string' ? evt.data.reply.trim() : '';
            const originalReplyChars = Number(evt.data.originalReplyChars ?? 0);
            if (reply.length > 0 || (evt.data.replySuppressed === true && originalReplyChars > 0)) return true;
        }
        if (evt.event === 'user_input.requested' || evt.event === 'elicitation.pending') return true;
    }
    return false;
}

function hasRecoveredEmptyTurnAfterEvent(events, eventIndex, identity) {
    if (!Array.isArray(events)) return false;
    for (let index = eventIndex + 1; index < events.length; index += 1) {
        const evt = events[index];
        if (evt?.event !== 'terminal.turn.empty_recovery' || !isObjectPayload(evt.data)) continue;
        if (!eventPayloadMatchesTurnIdentity(evt.data, identity)) continue;
        return hasPublicMaterializationAfterEvent(events, index);
    }
    return false;
}

function findUnrecoveredEmptyDialogTurnEnd(events) {
    if (!Array.isArray(events)) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const evt = events[index];
        if (evt?.event !== 'dialog.turn_end' || !isObjectPayload(evt.data)) continue;
        if (evt.data.replySuppressed === true) continue;
        const reply = typeof evt.data.reply === 'string' ? evt.data.reply.trim() : '';
        if (reply.length > 0) continue;
        const identity = {
            traceId: typeof evt.data.traceId === 'string' ? evt.data.traceId : null,
            turnId: typeof evt.data.turnId === 'string' ? evt.data.turnId : null,
        };
        if (hasPublicAssistantMessageAfterEvent(events, index, identity)) continue;
        if (hasRecoveredEmptyTurnAfterEvent(events, index, identity)) continue;
        return {
            eventId: evt.id,
            traceId: identity.traceId,
            turnId: identity.turnId,
            index,
        };
    }
    return null;
}

function findUnrecoveredTerminalEmptyOutputEvent(events) {
    if (!Array.isArray(events)) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const evt = events[index];
        if (evt?.event !== 'terminal.turn.empty_output' || !isObjectPayload(evt.data)) continue;
        const identity = {
            traceId: typeof evt.data.traceId === 'string' ? evt.data.traceId : null,
            turnId: typeof evt.data.turnId === 'string' ? evt.data.turnId : null,
        };
        if (hasPublicAssistantMessageAfterEvent(events, index, identity)) continue;
        if (hasRecoveredEmptyTurnAfterEvent(events, index, identity)) continue;
        return {
            eventId: evt.id,
            traceId: identity.traceId,
            turnId: identity.turnId,
            index,
        };
    }
    return null;
}

function findUserInputRequestedEvent(events, options = {}) {
    if (!Array.isArray(events)) return null;
    const beforeIndex = Number.isInteger(options.beforeIndex) ? options.beforeIndex : events.length;
    return (
        events
            .slice(0, beforeIndex)
            .find((evt) => evt?.event === 'user_input.requested' || evt?.event === 'elicitation.pending') ?? null
    );
}

function findUserInputCompletedEvent(events, options = {}) {
    if (!Array.isArray(events)) return null;
    const beforeIndex = Number.isInteger(options.beforeIndex) ? options.beforeIndex : events.length;
    return (
        events
            .slice(0, beforeIndex)
            .find(
                (evt) =>
                    evt?.event === 'user_input.completed' ||
                    evt?.event === 'question.answered' ||
                    evt?.event === 'elicitation.completed',
            ) ?? null
    );
}

function shouldEvaluateScenarioDespiteBlocker(blocker) {
    return ['assistant-empty-after-user-input', 'assistant-empty-after-ask', 'assistant-ended-before-ask'].includes(
        blocker?.id,
    );
}

function evaluateEmptyAfterUserInputRecoveryVisible(plain) {
    const text = String(plain ?? '');
    const hasTitle =
        /Retomada autom[aá]tica[\s\S]{0,260}continua[cç][aã]o p[oó]s-pergunta sem resposta p[uú]blica/iu.test(text) ||
        /Continua[cç][aã]o vazia[\s\S]{0,260}p[oó]s-pergunta sem resposta p[uú]blica/iu.test(text) ||
        /RECUPERAR[\s\S]{0,260}Continua[cç][aã]o p[oó]s-pergunta sem resposta p[uú]blica/iu.test(text) ||
        /Continua[cç][aã]o p[oó]s-pergunta sem resposta p[uú]blica[\s\S]{0,260}RECUPERAR/iu.test(text) ||
        /RECUPERANDO[\s\S]{0,260}Continua[cç][aã]o p[oó]s-pergunta sem resposta p[uú]blica/iu.test(text) ||
        /Continua[cç][aã]o p[oó]s-pergunta sem resposta p[uú]blica[\s\S]{0,260}RECUPERANDO/iu.test(text);
    const hasResume =
        /Retomar\s+\/turn Continue a partir da ultima resposta humana e entregue a resposta final em texto publico\./iu.test(
            text,
        );
    const hasDiagnostics = /Diagn[oó]stico\s+\/activity 40\s+·\s+\/events 60\s+·\s+\/byok health/iu.test(text);
    return {
        id: 'ux-empty-after-user-input-recovery-card',
        pass: hasTitle && hasResume && hasDiagnostics,
        detail: `recovery title=${hasTitle ? 'yes' : 'no'} resume=${hasResume ? 'yes' : 'no'} diagnostics=${hasDiagnostics ? 'yes' : 'no'}`,
    };
}

function summarizeSseEvents(events) {
    const publicEvents = events.filter((evt) => !['connected', 'heartbeat'].includes(evt.event));
    const ids = publicEvents.map((evt) => evt.id).filter((id) => Number.isFinite(id));
    const names = new Set(publicEvents.map((evt) => evt.event));
    const payloadObjects = publicEvents.filter((evt) => isObjectPayload(evt.data));
    const sourceEvents = payloadObjects.filter(
        (evt) => typeof evt.data.source === 'string' && evt.data.source.length > 0,
    );
    const eventSourceEvents = payloadObjects.filter(
        (evt) => typeof evt.data.eventSource === 'string' && evt.data.eventSource.length > 0,
    );
    const sourceEnvelopeEvents = payloadObjects.filter(
        (evt) =>
            (typeof evt.data.source === 'string' && evt.data.source.length > 0) ||
            (typeof evt.data.eventSource === 'string' && evt.data.eventSource.length > 0),
    );
    const traceEvents = payloadObjects.filter(
        (evt) => typeof evt.data.traceId === 'string' && evt.data.traceId.length > 0,
    );
    const traceIds = [...new Set(traceEvents.map((evt) => evt.data.traceId))].sort();
    const criticalEvents = payloadObjects.filter((evt) =>
        [
            'delta',
            'assistant.message',
            'dialog.reply',
            'tool.lifecycle',
            'user_input.requested',
            'user_input.completed',
        ].includes(evt.event),
    );
    return {
        publicEvents,
        ids,
        names,
        payloadObjects,
        sourceEvents,
        eventSourceEvents,
        sourceEnvelopeEvents,
        traceEvents,
        traceIds,
        criticalEvents,
    };
}

function normalizeLifecycleToolName(payload) {
    const names = [payload?.rawToolName, payload?.toolName, payload?.correlatedToolName, payload?.name, payload?.tool];
    for (const value of names) {
        if (typeof value === 'string' && value.trim().length > 0) return value.trim().toLowerCase();
    }
    return '';
}

function isLifecycleTool(payload, expectedName) {
    const name = normalizeLifecycleToolName(payload);
    return name === expectedName || name.endsWith(`.${expectedName}`) || name === `${expectedName}_local`;
}

function isLifecycleStartType(type) {
    return type === 'start' || type === 'external_requested';
}

function isLifecycleCompletionType(type) {
    return type === 'complete' || type === 'external_completed' || type === 'io_op';
}

function parseToolResultPayload(toolResult) {
    if (!isObjectPayload(toolResult)) return null;
    const text = typeof toolResult.textResultForLlm === 'string' ? toolResult.textResultForLlm.trim() : '';
    if (!text.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(text);
        return isObjectPayload(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function summarizePostToolUseResult(payload, expectedName) {
    if (payload?.hookType !== 'postToolUse') return null;
    const input = isObjectPayload(payload.input) ? payload.input : null;
    if (!input || !isLifecycleTool({ toolName: input.toolName }, expectedName)) return null;
    const toolResult = isObjectPayload(input.toolResult) ? input.toolResult : null;
    const parsed = parseToolResultPayload(toolResult);
    const resultType = typeof toolResult?.resultType === 'string' ? toolResult.resultType : '';
    const parsedSuccess = typeof parsed?.success === 'boolean' ? parsed.success : null;
    const exitCode = typeof parsed?.exitCode === 'number' ? parsed.exitCode : null;
    const success = resultType === 'success' && parsedSuccess !== false && (exitCode === null || exitCode === 0);
    const failure = resultType.length > 0 && !success;
    return {
        success,
        failure,
        resultType,
        parsedSuccess,
        exitCode,
        text: typeof toolResult?.textResultForLlm === 'string' ? toolResult.textResultForLlm : '',
    };
}

function summarizeCanonicalToolLifecycle(events) {
    const summary = {
        reportIntentStart: false,
        reportIntentDone: false,
        readFileStart: false,
        readFileDone: false,
        readFilePostToolSuccess: false,
        readFilePostToolFailure: false,
        readFileIo: false,
        toolLifecycleEvents: 0,
        matchedEventIds: [],
    };
    for (const evt of events) {
        const payload = eventPayload(evt);
        if (!payload) continue;
        if (evt?.event === 'hook.start') {
            const readFilePostToolUse = summarizePostToolUseResult(payload, 'read_file_content');
            if (!readFilePostToolUse) continue;
            if (readFilePostToolUse.success) summary.readFilePostToolSuccess = true;
            if (readFilePostToolUse.failure) summary.readFilePostToolFailure = true;
            const eventId = eventPublicId(evt);
            if (Number.isFinite(eventId)) summary.matchedEventIds.push(eventId);
            continue;
        }
        if (evt?.event !== 'tool.lifecycle') continue;
        summary.toolLifecycleEvents += 1;
        const type = typeof payload.type === 'string' ? payload.type : '';
        const success = payload.success !== false;
        const eventId = eventPublicId(evt);
        if (isLifecycleTool(payload, 'report_intent')) {
            if (isLifecycleStartType(type)) summary.reportIntentStart = true;
            if (isLifecycleCompletionType(type) && success) summary.reportIntentDone = true;
            if (Number.isFinite(eventId)) summary.matchedEventIds.push(eventId);
        }
        if (isLifecycleTool(payload, 'read_file_content')) {
            if (isLifecycleStartType(type)) summary.readFileStart = true;
            if (isLifecycleCompletionType(type) && success) summary.readFileDone = true;
            if (type === 'io_op' && success) summary.readFileIo = true;
            if (Number.isFinite(eventId)) summary.matchedEventIds.push(eventId);
        }
    }
    summary.matchedEventIds = [...new Set(summary.matchedEventIds)].sort((a, b) => a - b);
    return summary;
}

function summarizeNamedToolLifecycle(events, expectedName) {
    const summary = {
        start: false,
        done: false,
        io: false,
        failed: false,
        postToolSuccess: false,
        postToolFailure: false,
        resultTypes: [],
        exitCodes: [],
        matchedEventIds: [],
        startEventIds: [],
        completionEventIds: [],
    };
    for (const evt of events) {
        const payload = eventPayload(evt);
        if (!payload) continue;
        if (evt?.event === 'hook.start') {
            const postToolUse = summarizePostToolUseResult(payload, expectedName);
            if (!postToolUse) continue;
            if (postToolUse.success) summary.postToolSuccess = true;
            if (postToolUse.failure) summary.postToolFailure = true;
            if (postToolUse.resultType) summary.resultTypes.push(postToolUse.resultType);
            if (Number.isFinite(postToolUse.exitCode)) summary.exitCodes.push(postToolUse.exitCode);
            const eventId = eventPublicId(evt);
            if (Number.isFinite(eventId)) summary.matchedEventIds.push(eventId);
            continue;
        }
        if (evt?.event !== 'tool.lifecycle' || !isLifecycleTool(payload, expectedName)) continue;
        const type = typeof payload.type === 'string' ? payload.type : '';
        const success = payload.success !== false;
        const eventId = eventPublicId(evt);
        if (isLifecycleStartType(type)) {
            summary.start = true;
            if (Number.isFinite(eventId)) summary.startEventIds.push(eventId);
        }
        if (isLifecycleCompletionType(type) && success) {
            summary.done = true;
            if (Number.isFinite(eventId)) summary.completionEventIds.push(eventId);
        }
        if (isLifecycleCompletionType(type) && !success) {
            summary.failed = true;
            if (Number.isFinite(eventId)) summary.completionEventIds.push(eventId);
        }
        if (type === 'io_op' && success) summary.io = true;
        if (Number.isFinite(eventId)) summary.matchedEventIds.push(eventId);
    }
    summary.resultTypes = [...new Set(summary.resultTypes)].sort();
    summary.exitCodes = [...new Set(summary.exitCodes)].sort((a, b) => a - b);
    summary.matchedEventIds = [...new Set(summary.matchedEventIds)].sort((a, b) => a - b);
    summary.startEventIds = [...new Set(summary.startEventIds)].sort((a, b) => a - b);
    summary.completionEventIds = [...new Set(summary.completionEventIds)].sort((a, b) => a - b);
    return summary;
}

function scenarioMarkerObservedInToolResults(events, marker) {
    if (typeof marker !== 'string' || marker.length === 0) return false;
    return events.some((evt) => {
        const payload = eventPayload(evt);
        if (!payload) return false;
        if (evt?.event === 'hook.start' && payload.hookType === 'postToolUse') {
            const input = isObjectPayload(payload.input) ? payload.input : null;
            const toolResult = isObjectPayload(input?.toolResult) ? input.toolResult : null;
            return typeof toolResult?.textResultForLlm === 'string' && toolResult.textResultForLlm.includes(marker);
        }
        if (evt?.event !== 'tool.lifecycle') return false;
        return (
            (typeof payload.partialOutput === 'string' && payload.partialOutput.includes(marker)) ||
            (typeof payload.progressMessage === 'string' && payload.progressMessage.includes(marker))
        );
    });
}

/**
 * @param {unknown} evt
 * @param {Record<string, unknown>} payload
 * @returns {CanonicalEventSummaryItem}
 */
function canonicalEventSummaryItem(evt, payload) {
    return {
        event: typeof evt?.event === 'string' ? evt.event : '',
        source:
            typeof payload?.source === 'string'
                ? payload.source
                : typeof payload?.eventSource === 'string'
                  ? payload.eventSource
                  : null,
        traceId: typeof payload?.traceId === 'string' ? payload.traceId : null,
        turnId:
            typeof payload?.turnId === 'string'
                ? payload.turnId
                : typeof payload?.turnId === 'number'
                  ? String(payload.turnId)
                  : null,
        eventId: eventPublicId(evt),
    };
}

/**
 * @param {unknown[]} events
 * @returns {{
 *     deltaAssistant: CanonicalEventSummaryItem | null;
 *     askRequested: CanonicalEventSummaryItem | null;
 *     askCompleted: CanonicalEventSummaryItem | null;
 *     postAskAssistant: CanonicalEventSummaryItem | null;
 * }}
 */
function summarizeCanonicalTranscriptEvents(events, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    /**
     * @type {{
     *     deltaAssistant: CanonicalEventSummaryItem | null;
     *     askRequested: CanonicalEventSummaryItem | null;
     *     askCompleted: CanonicalEventSummaryItem | null;
     *     postAskAssistant: CanonicalEventSummaryItem | null;
     * }}
     */
    const summary = {
        deltaAssistant: null,
        askRequested: null,
        askCompleted: null,
        postAskAssistant: null,
    };
    for (const evt of events) {
        const payload = eventPayload(evt);
        if (!payload) continue;
        if (evt?.event === 'assistant.message') {
            const content = typeof payload.content === 'string' ? payload.content : '';
            if (!summary.deltaAssistant && hasRequiredDeltaTail(content)) {
                summary.deltaAssistant = canonicalEventSummaryItem(evt, payload);
            }
            if (!summary.postAskAssistant && scenario.postAskFinalRe.test(content)) {
                summary.postAskAssistant = canonicalEventSummaryItem(evt, payload);
            }
            continue;
        }
        if (evt?.event === 'user_input.requested') {
            const question = typeof payload.question === 'string' ? payload.question : '';
            if (!summary.askRequested && scenario.askQuestionRe.test(question)) {
                summary.askRequested = canonicalEventSummaryItem(evt, payload);
            }
            continue;
        }
        if (evt?.event === 'user_input.completed') {
            const answer = typeof payload.answer === 'string' ? payload.answer : '';
            if (!summary.askCompleted && scenario.finalAnswerRe.test(answer)) {
                summary.askCompleted = canonicalEventSummaryItem(evt, payload);
            }
        }
    }
    return summary;
}

/**
 * @param {CanonicalEventSummaryItem | null} item
 * @returns {string}
 */
function formatCanonicalEventSummary(item) {
    if (!item) return '-';
    return [
        item.event || '-',
        item.source ? `source=${item.source}` : null,
        item.traceId ? `trace=${item.traceId}` : null,
        item.turnId ? `turn=${item.turnId}` : null,
        Number.isFinite(item.eventId) ? `#${item.eventId}` : null,
    ]
        .filter(Boolean)
        .join(' ');
}

/**
 * @param {null | {
 *     envelopes?: { source: string; traceId: string | null; turnId: string | null; eventId: string | null }[];
 * }} exportSummary
 * @param {CanonicalEventSummaryItem | null} event
 * @returns {boolean}
 */
function exportEnvelopeMatchesEvent(exportSummary, event) {
    if (!event || !Array.isArray(exportSummary?.envelopes)) return false;
    return exportSummary.envelopes.some((envelope) => {
        const traceMatches = event.traceId && envelope.traceId === event.traceId;
        const turnMatches = event.turnId && envelope.turnId === event.turnId;
        if (!traceMatches && !turnMatches) return false;
        if (!event.source || envelope.source === event.source) return true;
        return (
            event.source === 'sdk/assistant.message' &&
            (envelope.source === 'terminal.dialog.engine' || envelope.source === 'terminal-turn-display')
        );
    });
}

function extractArchiveRawEvents(plain) {
    const entries = [];
    for (const line of plain.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}') || !trimmed.includes('"schemaVersion"')) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && typeof parsed.event === 'string') {
                entries.push(parsed);
            }
        } catch {
            // Saida humana pode conter linhas parciais; o runner ignora e reporta pelos criterios agregados.
        }
    }
    return entries;
}

function countJsonStructuralBraceDelta(line, state) {
    let delta = 0;
    for (const char of String(line ?? '')) {
        if (state.escape) {
            state.escape = false;
            continue;
        }
        if (char === '\\' && state.inString) {
            state.escape = true;
            continue;
        }
        if (char === '"') {
            state.inString = !state.inString;
            continue;
        }
        if (state.inString) continue;
        if (char === '{') delta += 1;
        if (char === '}') delta -= 1;
    }
    return delta;
}

function extractArchiveJsonDump(plain) {
    const lines = String(plain ?? '').split('\n');
    for (let start = 0; start < lines.length; start += 1) {
        const first = (lines[start] ?? '').trim();
        if (first !== '{') continue;
        const collected = [];
        let depth = 0;
        const braceState = { inString: false, escape: false };
        for (let index = start; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            collected.push(line);
            depth += countJsonStructuralBraceDelta(line, braceState);
            if (depth !== 0) continue;
            const raw = collected.join('\n');
            if (!raw.includes('"state"') || !raw.includes('"filters"') || !raw.includes('"entries"')) break;
            try {
                const parsed = JSON.parse(raw);
                if (
                    parsed &&
                    typeof parsed === 'object' &&
                    parsed.state &&
                    parsed.filters &&
                    Array.isArray(parsed.entries)
                ) {
                    return parsed;
                }
            } catch {
                break;
            }
            break;
        }
    }
    return null;
}

function extractTerminalBlocks(plain, headerRe) {
    const lines = String(plain ?? '').split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
        if (!headerRe.test(lines[i] ?? '')) continue;
        const block = [lines[i]];
        for (let j = i + 1; j < lines.length; j += 1) {
            const line = lines[j] ?? '';
            if (
                /^\s*(?:você\[|─{8,}|\[[A-Z][^\]]+\]|\[\d{2}:\d{2}:\d{2}\]\s+🧠\s+LLM-B|\[LLM-B\]\s+Mensagem)/u.test(
                    line,
                )
            ) {
                break;
            }
            block.push(line);
            if (/^\s*└──/u.test(line) || /^\s*📊\s/u.test(line)) break;
        }
        blocks.push(block.join('\n'));
    }
    return blocks;
}

function extractSdkSessionCockpitProbeResidueCounts(plain) {
    return extractTerminalBlocks(plain, /^\s*Sessão SDK\b/u).map(
        (block) => block.match(/\bprobe-residue\b/gu)?.length ?? 0,
    );
}

function terminalBlockContains(plain, headerRe, markerRe) {
    return extractTerminalBlocks(plain, headerRe).some((block) => markerRe.test(block));
}

const REQUIRED_DELTA_TAIL_RE = /DELTA-(?:CANONICAL-)?8\b/u;
const RENDERED_REQUIRED_DELTA_TAIL_RE = /(?:^|\n)\s*│\s+(?:\*{1,2})?DELTA-(?:CANONICAL-)?8\b/u;

function countCanonicalDeltaMarkers(value) {
    return (String(value ?? '').match(/DELTA-CANONICAL-\d/g) ?? []).length;
}

function countExactCanonicalDeltaLines(value) {
    const observed = new Set();
    for (const rawLine of stripAnsi(String(value ?? '')).split(/\r?\n/u)) {
        const line = rawLine.replace(/^\s*│\s*/u, '').trim();
        const match = line.match(/^DELTA-CANONICAL-([1-8])$/u);
        if (match) observed.add(match[1]);
    }
    return observed.size;
}

function countRequiredDeltaMarkers(value) {
    return (String(value ?? '').match(/DELTA-(?:CANONICAL-)?\d/g) ?? []).length;
}

function hasRequiredDeltaTail(value) {
    return REQUIRED_DELTA_TAIL_RE.test(String(value ?? ''));
}

function hasRenderedRequiredDeltaTail(value) {
    return RENDERED_REQUIRED_DELTA_TAIL_RE.test(String(value ?? ''));
}

function normalizeTranscriptCoverageText(value) {
    return stripAnsi(value).replace(/\s+/gu, ' ').trim();
}

function eventPayload(evt) {
    if (isObjectPayload(evt?.payload)) return evt.payload;
    if (isObjectPayload(evt?.data)) return evt.data;
    return null;
}

function eventPublicId(evt) {
    const id = Number(evt?.eventId ?? evt?.id);
    return Number.isFinite(id) ? id : null;
}

function eventTurnKey(evt, payload) {
    const turnId = payload?.turnId ?? evt?.turnId;
    const traceId = payload?.traceId ?? evt?.traceId;
    if (typeof turnId === 'string' || typeof turnId === 'number') return `turn:${turnId}`;
    if (typeof traceId === 'string' && traceId.length > 0) return `trace:${traceId}`;
    return null;
}

function findTruncatedTurnEndDuplicate(events) {
    const assistantMessages = [];
    for (const evt of events) {
        const payload = eventPayload(evt);
        if (!payload) continue;
        const eventName = typeof evt?.event === 'string' ? evt.event : '';
        if (eventName === 'assistant.message') {
            const content = normalizeTranscriptCoverageText(payload.content);
            if (content.length >= 32) {
                assistantMessages.push({
                    content,
                    eventId: eventPublicId(evt),
                    turnKey: eventTurnKey(evt, payload),
                });
            }
            continue;
        }
        if (eventName !== 'dialog.turn_end') continue;
        const reply = normalizeTranscriptCoverageText(payload.reply);
        if (reply.length < 32) continue;
        const turnKey = eventTurnKey(evt, payload);
        const match = assistantMessages.find(
            (entry) =>
                entry.content !== reply &&
                entry.content.includes(reply) &&
                (!turnKey || !entry.turnKey || entry.turnKey === turnKey),
        );
        if (match) {
            return {
                turnEndEventId: eventPublicId(evt),
                assistantMessageEventId: match.eventId,
                replyChars: reply.length,
                contentChars: match.content.length,
                turnKey: turnKey ?? match.turnKey ?? null,
            };
        }
    }
    return null;
}

function extractPlainTraceIds(plain) {
    const ids = new Set();
    for (const match of plain.matchAll(/\btrace(?:Id)?["']?\s*[=:]\s*["']?(turn:[A-Za-z0-9_.:-]+)/giu)) {
        ids.add(match[1]);
    }
    return [...ids].sort();
}

function evaluateSseCriteria(sseSummary, { expectPublicEvents, plain = '' }) {
    if (sseSummary.disabled) {
        return [
            {
                id: 'sse-disabled',
                pass: true,
                detail: 'coletor SSE desativado por --no-sse',
            },
        ];
    }
    const summary = summarizeSseEvents(sseSummary.events);
    const { publicEvents, ids, names, payloadObjects, sourceEnvelopeEvents, traceEvents, traceIds, criticalEvents } =
        summary;
    const monotonic = ids.every((id, index) => index === 0 || id > ids[index - 1]);
    const plainTraceIds = extractPlainTraceIds(plain);
    const traceOverlap = traceIds.filter((traceId) => plainTraceIds.includes(traceId));
    const criticalWithSource = criticalEvents.filter(
        (evt) => typeof evt.data.source === 'string' || typeof evt.data.eventSource === 'string',
    );
    return [
        {
            id: 'sse-connected',
            pass: sseSummary.connected && sseSummary.errors.length === 0,
            detail: `coletor SSE conectado com ${sseSummary.errors.length} erro(s)`,
        },
        {
            id: 'sse-no-internal-envelope',
            pass: !sseSummary.raw.includes('__terminalSseEventId'),
            detail: 'metadados internos de replay não foram expostos aos clientes SSE',
        },
        {
            id: 'sse-event-ids-monotonic',
            pass: publicEvents.length === 0 || (ids.length > 0 && monotonic),
            detail: `${ids.length}/${publicEvents.length} eventos SSE públicos observados com ids monotônicos`,
        },
        {
            id: 'sse-public-events',
            pass:
                !expectPublicEvents ||
                names.has('delta') ||
                names.has('assistant.message') ||
                names.has('tool.lifecycle') ||
                names.has('user_input.requested'),
            detail: `eventos SSE públicos observados: ${[...names].slice(0, 8).join(', ') || 'nenhum'}`,
        },
        {
            id: 'sse-source-envelope',
            pass: payloadObjects.length === 0 || sourceEnvelopeEvents.length === payloadObjects.length,
            detail: `${sourceEnvelopeEvents.length}/${payloadObjects.length} eventos com payload objeto incluem source/eventSource`,
        },
        {
            id: 'sse-critical-events-sourced',
            pass: criticalEvents.length === 0 || criticalWithSource.length === criticalEvents.length,
            detail: `${criticalWithSource.length}/${criticalEvents.length} eventos críticos transcript/tool/user-input incluem source/eventSource`,
        },
        {
            id: 'sse-trace-envelope',
            pass: !expectPublicEvents || traceEvents.length > 0,
            detail: `${traceEvents.length}/${payloadObjects.length} eventos com payload objeto incluem traceId; traceIds=${traceIds.slice(0, 5).join(', ') || '-'}`,
        },
        {
            id: 'sse-stdout-trace-overlap',
            pass:
                !expectPublicEvents ||
                traceIds.length === 0 ||
                plainTraceIds.length === 0 ||
                traceOverlap.length > 0,
            detail: `stdout traceIds=${plainTraceIds.slice(0, 5).join(', ') || 'ocultos na cauda default/raw'} · sse traceIds=${traceIds.slice(0, 5).join(', ') || '-'} · interseção=${traceOverlap.slice(0, 5).join(', ') || '-'}`,
        },
    ];
}

function evaluateOutput(plain, sseSummary, exportSummary, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    const markerCount = countCanonicalDeltaMarkers(plain);
    const preEventsPlain = plain.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/events\b/i)[0] ?? plain;
    const beforeRawDiagnosticsPlain = plain.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/events\b[^\n]*--raw/i)[0] ?? plain;
    const beforeReadyPlain = plain.split(/LLM-B pronta/iu)[0] ?? plain;
    const answerText = scenario.answerSteps.at(-1)?.answer ?? '';
    const questionIndex = scenario.askQuestion ? beforeRawDiagnosticsPlain.search(scenario.askQuestionRe) : -1;
    const answerPromptIndex = answerText
        ? beforeRawDiagnosticsPlain.search(
              new RegExp(`\\[PERG(?:UNTA)?\\]›\\s*${escapeRegExp(answerText)}`, 'iu'),
          )
        : -1;
    const questionWaitSurface =
        questionIndex >= 0
            ? beforeRawDiagnosticsPlain.slice(
                  questionIndex,
                  answerPromptIndex > questionIndex ? answerPromptIndex : beforeRawDiagnosticsPlain.length,
              )
            : '';
    const postAnswerPublicPlain =
        answerPromptIndex >= 0 ? beforeRawDiagnosticsPlain.slice(answerPromptIndex) : beforeRawDiagnosticsPlain;
    const activity40Sections = beforeRawDiagnosticsPlain.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/activity\s+40\b[^\n\r]*/iu).slice(1);
    const latestActivity40Section =
        activity40Sections
            .at(-1)
            ?.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/(?:intent|tools|events|usage|errors|health|export|quit)\b/iu)[0] ?? '';
    const intentDefaultSections = beforeRawDiagnosticsPlain.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/intent\s+5\b[^\n\r]*/iu).slice(1);
    const latestIntentDefaultSection =
        intentDefaultSections
            .at(-1)
            ?.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/(?:intent|tools|events|usage|errors|health|export|quit)\b/iu)[0] ?? '';
    const intentDetailSections = beforeRawDiagnosticsPlain
        .split(/\n\s*voc[eê]\[[^\n]*?›\s+\/intent\s+detail\s+5\b[^\n\r]*/iu)
        .slice(1);
    const latestIntentDetailSection =
        intentDetailSections
            .at(-1)
            ?.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/(?:tools|events|usage|errors|health|export|quit)\b/iu)[0] ?? '';
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const canonicalEvents = [...sseSummary.events, ...archiveRawEvents];
    const canonicalToolLifecycle = summarizeCanonicalToolLifecycle(canonicalEvents);
    const scenarioToolLifecycle = scenario.expectedLifecycleTools.map((tool) => {
        const renderedName = escapeRegExp(tool.renderedName ?? tool.name);
        const lifecycle = summarizeNamedToolLifecycle(canonicalEvents, tool.name);
        const firstStartId = lifecycle.startEventIds.at(0) ?? null;
        const lastCompletionId = lifecycle.completionEventIds.at(-1) ?? null;
        const thinkingOverrideEventIds =
            firstStartId === null || lastCompletionId === null
                ? []
                : canonicalEvents
                      .filter((evt) => {
                          const eventId = eventPublicId(evt);
                          const payload = eventPayload(evt);
                          return (
                              Number.isFinite(eventId) &&
                              eventId > firstStartId &&
                              eventId < lastCompletionId &&
                              evt?.event === 'terminal.activity' &&
                              payload?.phase === 'thinking'
                          );
                      })
                      .map((evt) => eventPublicId(evt))
                      .filter((eventId) => Number.isFinite(eventId));
        return {
            ...tool,
            lifecycle,
            thinkingOverrideEventIds,
            renderedRe: new RegExp(
                `(?:\\[[^\\]]+\\][^\\n]*${renderedName}|Ferramenta\\s+[^\\n]*${renderedName})`,
                'iu',
            ),
            doneRe: new RegExp(
                `(?:✅\\s+\\[OK\\][^\\n]*${renderedName}|Conclu[ií]do\\s+[^\\n]*${renderedName})`,
                'iu',
            ),
        };
    });
    const scenarioOutputMarkers = scenario.expectedOutputMarkers.map((marker) => ({
        marker,
        observedInToolResult: scenarioMarkerObservedInToolResults(canonicalEvents, marker),
    }));
    const scenarioTerminalRender = scenario.expectedTerminalRender.map((item) => {
        const toolName = String(item.toolName ?? '');
        const badge = String(item.badge ?? '');
        const forbiddenBadge = String(item.forbiddenBadge ?? '');
        return {
            toolName,
            renderedName: String(item.renderedName ?? toolName),
            badge,
            forbiddenBadge,
            expectedRe: new RegExp(
                `(?:\\[${escapeRegExp(badge)}\\]\\s+${escapeRegExp(String(item.renderedName ?? toolName))}\\b|(?:Ferramenta|Conclu[ií]do|Falhou)\\s+[^\\n]*${escapeRegExp(String(item.renderedName ?? toolName))}\\b)`,
                'iu',
            ),
            forbiddenRe: forbiddenBadge
                ? new RegExp(
                      `\\[${escapeRegExp(forbiddenBadge)}\\]\\s+${escapeRegExp(String(item.renderedName ?? toolName))}\\b`,
                      'u',
                  )
                : null,
        };
    });
    const canonicalTranscriptEvents = summarizeCanonicalTranscriptEvents(canonicalEvents, scenario);
    const exportSseAskRequested = exportEnvelopeMatchesEvent(exportSummary, canonicalTranscriptEvents.askRequested);
    const exportSseAskCompleted = exportEnvelopeMatchesEvent(exportSummary, canonicalTranscriptEvents.askCompleted);
    const exportSsePostAsk = exportEnvelopeMatchesEvent(exportSummary, canonicalTranscriptEvents.postAskAssistant);
    const postAskEventId = canonicalTranscriptEvents.postAskAssistant?.eventId ?? null;
    const postAskSseIndex =
        postAskEventId === null ? -1 : sseSummary.events.findIndex((evt) => eventPublicId(evt) === postAskEventId);
    const unexpectedPostAskContinuation =
        postAskSseIndex >= 0
            ? (sseSummary.events.slice(postAskSseIndex + 1).find((evt) => {
                  const payload = eventPayload(evt);
                  if (!payload) return false;
                  if (evt?.event === 'assistant.intent') return true;
                  if (evt?.event === 'assistant.message') {
                      return !scenario.postAskFinalRe.test(String(payload.content ?? ''));
                  }
                  if (evt?.event !== 'tool.lifecycle') return false;
                  return isLifecycleStartType(String(payload.type ?? ''));
              }) ?? null)
            : null;
    const sseIds = summarizeSseEvents(sseSummary.events).ids;
    const archiveIds = archiveRawEvents.map((evt) => evt.eventId).filter((id) => Number.isFinite(id));
    const archiveSseOverlap = archiveIds.filter((id) => sseIds.includes(id));
    const truncatedTurnEndDuplicate = findTruncatedTurnEndDuplicate([...sseSummary.events, ...archiveRawEvents]);
    const askRenderedByQuestionPending = scenario.questionPendingRe.test(preEventsPlain);
    const askRenderedBySdk = scenario.askRenderedRe.test(preEventsPlain);
    const liveDeltaBlocks = extractTerminalBlocks(
        preEventsPlain,
        /^\s*(?:\[[^\]\n]*\]\s+🧠\s+LLM-B|LLM-B\s+·)/u,
    ).filter((block) => hasRequiredDeltaTail(block));
    const liveDeltaMarkerCount = liveDeltaBlocks.reduce((count, block) => count + countRequiredDeltaMarkers(block), 0);
    const liveCanonicalDeltaMarkerCount = liveDeltaBlocks.reduce(
        (count, block) => count + countCanonicalDeltaMarkers(block),
        0,
    );
    const liveExactCanonicalDeltaLineCount = liveDeltaBlocks.reduce(
        (count, block) => Math.max(count, countExactCanonicalDeltaLines(block)),
        0,
    );
    const assistantMessageDeltaMarkerCount = canonicalEvents.reduce((count, evt) => {
        const payload = eventPayload(evt);
        if (evt?.event !== 'assistant.message' || !payload) return count;
        return count + countRequiredDeltaMarkers(payload.content);
    }, 0);
    const assistantMessageCanonicalDeltaMarkerCount = canonicalEvents.reduce((count, evt) => {
        const payload = eventPayload(evt);
        if (evt?.event !== 'assistant.message' || !payload) return count;
        return count + countCanonicalDeltaMarkers(payload.content);
    }, 0);
    const assistantMessageExactCanonicalDeltaLineCount = canonicalEvents.reduce((count, evt) => {
        const payload = eventPayload(evt);
        if (evt?.event !== 'assistant.message' || !payload) return count;
        return Math.max(count, countExactCanonicalDeltaLines(payload.content));
    }, 0);
    const publicDeltaMarkerCount = Math.max(liveDeltaMarkerCount, assistantMessageDeltaMarkerCount);
    const canonicalPublicDeltaMarkerCount = Math.max(
        liveCanonicalDeltaMarkerCount,
        assistantMessageCanonicalDeltaMarkerCount,
    );
    const sseDeltaEvents = sseSummary.events.filter((evt) => evt?.event === 'delta');
    const sseDeltaEventsWithPublicChunk = sseDeltaEvents.filter((evt) => {
        const payload = eventPayload(evt);
        return typeof payload?.publicChunk === 'string';
    });
    const ssePublicChunkReasoningLeak = sseDeltaEvents.some((evt) => {
        const payload = eventPayload(evt);
        return /(?:<|&lt;)\/?(?:thinking|analysis|reasoning)(?:>|&gt;)/iu.test(String(payload?.publicChunk ?? ''));
    });
    const exactCanonicalDeltaLineCount = Math.max(
        liveExactCanonicalDeltaLineCount,
        assistantMessageExactCanonicalDeltaLineCount,
    );
    const liveDeltaBlockVisible = liveDeltaBlocks.length > 0;
    const assistantMessageTranscriptHeadingRe =
        /^\s*(?:\[LLM-B\]\s+Mensagem|Mensagem\s+sdk\/assistant\.message|Mensagem da LLM-B\s+(?:LLM-B via SDK|SDK assistant))/u;
    const postAskAssistantTranscriptHeadingRe =
        /^\s*(?:\[LLM-B\]\s+Mensagem|Mensagem\s+sdk\/assistant\.message|Resposta (?:da LLM-B|pós-pergunta)\s+(?:sdk\/assistant\.message|LLM-B via SDK))/u;
    const assistantMessageDeltaBlockVisible = terminalBlockContains(
        preEventsPlain,
        assistantMessageTranscriptHeadingRe,
        REQUIRED_DELTA_TAIL_RE,
    ) || assistantMessageDeltaMarkerCount >= 8;
    const postAskFinalRe = scenario.postAskFinalRe;
    const finalRenderedByLiveTurn = terminalBlockContains(
        preEventsPlain,
        /^\s*(?:\[[^\]\n]*\]\s+🧠\s+LLM-B|LLM-B\s+·)/u,
        postAskFinalRe,
    );
    const finalRenderedByAssistantMessage = terminalBlockContains(
        preEventsPlain,
        postAskAssistantTranscriptHeadingRe,
        postAskFinalRe,
    );
    const taskDeltaActivityDuringDialog =
        /task\s+·\s+Executando tarefa interna\s+—\s+delta/.test(preEventsPlain) ||
        /"label":"Executando tarefa interna","detail":"delta/.test(preEventsPlain);
    const promptDoubleRender =
        /voc[eê]\[[^\r\n]*?›[ \t]+voc[eê]\[[^\r\n]*?›/iu.test(plain) ||
        /(?:^|\n)voc[eê]\[[^\r\n]*?›[^\S\r\n]*(?:\r?\n)+voc[eê]\[[^\r\n]*?›/iu.test(plain);
    const readyPromptDuringActiveTurn =
        /(?:^|\n)voc[eê]\[[^\]\r\n]+\](?!\[PERG(?:UNTA)?\])›[ \t]*(?:\r[^\n\r]*){1,8}\r?[ \t]*─{3,}[\s\S]{0,320}^\s*LLM-B\s+·/imu.test(
            plain,
        );
    const inlineStatusRendered = /(?:⟲|⏳|⌛)\s+(?:LLM-B|aguardando)\b|LLM-B\s+(?:turno|pensando|iniciando)\s+·/iu.test(plain);
    const promptlessDiagnosticCommand =
        /(?:^|\n)\/(?:usage now|activity \d+|intent(?: detail)? \d+|tools diag|events \d+(?: --raw)?|errors \d+|health full|export \S+|quit)\s*(?:\r?\n|$)/iu.test(
            plain,
        );
    const publicReasoningTagLeak = /(?:<|&lt;)\/?(?:thinking|analysis|reasoning)(?:>|&gt;)/iu.test(
        beforeRawDiagnosticsPlain,
    );
    const rawPreviewHasIntermediateTurnCompletion =
        /"event":"activity\.changed"[^\n]*"payloadPreview":"fase turn · (?:Turno do assistente concluído|continuação do pedido)/iu.test(
            plain,
        );
    const rawPreviewHasLegacyIntermediateTurnCompletion =
        /"event":"activity\.changed"[^\n]*"payloadPreview":"fase turn · Turno do assistente concluído/iu.test(plain);
    const rawPreviewHasHumanIntermediateTurnContinuation =
        /"event":"activity\.changed"[^\n]*"payloadPreview":"fase turn · continuação do pedido/iu.test(plain);
    const duplicatePathologies = [/__anonymous__/, /hook:error_occurred/];
    const beforeRawWithoutExpectedScenarioMarkers = scenario.expectedOutputMarkers.reduce(
        (text, marker) => text.replaceAll(marker, 'EXPECTED_SCENARIO_MARKER'),
        beforeRawDiagnosticsPlain,
    );
    const sdkPermissionPromptObserved =
        /permission\.requested/iu.test(plain) ||
        /Permiss[aã]o solicitada/iu.test(plain) ||
        /permission request/iu.test(plain);
    const scenarioUsesPermissionedTool = scenario.expectedLifecycleTools.length > 0;
    const scenarioUsesExecCommand = scenario.expectedLifecycleTools.some((tool) => tool.name === 'exec_command');
    const scenarioUsesFileRoundtrip = ['create_file', 'move_file', 'delete_file'].every((toolName) =>
        scenario.expectedLifecycleTools.some((tool) => tool.name === toolName),
    );
    const fileRoundtripSingleSummaryCoverage =
        /Arquivos\s+CRIAR\b[^\n\r]*\bMOVER\b[^\n\r]*\bEXCLUIR\b/iu.test(beforeRawDiagnosticsPlain);
    const fileRoundtripDistributedSummaryCoverage =
        /(?:Ações|Arquivos)\s+CRIAR\b/iu.test(beforeRawDiagnosticsPlain) &&
        /(?:Ações|Arquivos)\s+MOVER\b/iu.test(beforeRawDiagnosticsPlain) &&
        /(?:Ações|Arquivos)\s+EXCLUIR\b/iu.test(beforeRawDiagnosticsPlain);
    const fileRoundtripSummaryCoverageOk =
        !scenarioUsesFileRoundtrip || fileRoundtripSingleSummaryCoverage || fileRoundtripDistributedSummaryCoverage;
    const expectedLiveToolLabels = scenario.expectedLifecycleTools
        .map((tool) => String(tool.renderedName ?? tool.name).trim())
        .filter(Boolean);
    const toolLiveStatusFrames = String(plain)
        .split('\r')
        .map((frame) => frame.trim())
        .filter(
            (frame) =>
                /^LLM-B\b/u.test(frame) &&
                (/\bferramenta\b/iu.test(frame) || expectedLiveToolLabels.some((label) => frame.includes(label))),
        );
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal chegou ao estado pronto',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal executou com superfície interativa REPL/TTY',
        },
        {
            id: 'partial-deltas',
            pass: publicDeltaMarkerCount >= 8,
            detail:
                `observed ${publicDeltaMarkerCount} public delta markers` +
                ` · canonical=${canonicalPublicDeltaMarkerCount}` +
                ` · total log canonical markers ${markerCount}`,
        },
        {
            id: 'canonical-delta-labels',
            pass: canonicalPublicDeltaMarkerCount >= 8,
            detail:
                canonicalPublicDeltaMarkerCount >= 8
                    ? 'assistant used the exact DELTA-CANONICAL labels requested by the scenario'
                    : `assistant used noncanonical public delta labels · canonical=${canonicalPublicDeltaMarkerCount} · public=${publicDeltaMarkerCount}`,
            severity: 'warning',
            required: false,
        },
        {
            id: 'canonical-delta-lines-exact',
            pass: exactCanonicalDeltaLineCount >= 8,
            detail:
                exactCanonicalDeltaLineCount >= 8
                    ? 'assistant rendered the eight DELTA-CANONICAL lines as exact marker-only lines'
                    : `assistant rendered extra text or missing exact canonical delta lines · exact=${exactCanonicalDeltaLineCount}/8`,
        },
        {
            id: 'sse-delta-public-chunk',
            pass:
                sseDeltaEvents.length === 0 ||
                (sseDeltaEventsWithPublicChunk.length === sseDeltaEvents.length && !ssePublicChunkReasoningLeak),
            detail:
                sseDeltaEvents.length === 0
                    ? 'scenario did not expose raw delta SSE events; assistant.message carried the public transcript'
                    : `delta events publicChunk=${sseDeltaEventsWithPublicChunk.length}/${sseDeltaEvents.length} · reasoningLeak=${ssePublicChunkReasoningLeak ? 'yes' : 'no'}`,
        },
        {
            id: 'final-delta-block',
            pass: liveDeltaBlockVisible || assistantMessageDeltaBlockVisible,
            detail: `canonical delta block visible live=${liveDeltaBlockVisible ? 'yes' : 'no'} assistant.message=${assistantMessageDeltaBlockVisible ? 'yes' : 'no'}`,
        },
        {
            id: 'tool-start-done',
            pass:
                canonicalToolLifecycle.readFileStart &&
                (canonicalToolLifecycle.readFileDone || canonicalToolLifecycle.readFilePostToolSuccess) &&
                renderedReadFileToolOk(plain),
            detail:
                `read_file_content lifecycle start=${canonicalToolLifecycle.readFileStart ? 'yes' : 'no'} done=${canonicalToolLifecycle.readFileDone ? 'yes' : 'no'} postSuccess=${canonicalToolLifecycle.readFilePostToolSuccess ? 'yes' : 'no'} io=${canonicalToolLifecycle.readFileIo ? 'yes' : 'no'} ` +
                `rendered=${renderedReadFileToolOk(plain) ? 'yes' : 'no'} events=${canonicalToolLifecycle.matchedEventIds.slice(0, 8).join(',') || '-'}`,
        },
        {
            id: 'report-intent-lifecycle',
            pass: canonicalToolLifecycle.reportIntentStart && canonicalToolLifecycle.reportIntentDone,
            detail:
                `report_intent lifecycle start=${canonicalToolLifecycle.reportIntentStart ? 'yes' : 'no'} done=${canonicalToolLifecycle.reportIntentDone ? 'yes' : 'no'} ` +
                `toolLifecycleEvents=${canonicalToolLifecycle.toolLifecycleEvents}`,
        },
        ...scenarioToolLifecycle.map((tool) => {
            const rendered = tool.renderedRe.test(plain) && tool.doneRe.test(plain);
            const expectedOutcome = tool.expectedOutcome === 'failure' ? 'failure' : 'success';
            const structuredFailure = tool.lifecycle.failed || tool.lifecycle.postToolFailure;
            const structuredSuccess = tool.lifecycle.done || tool.lifecycle.postToolSuccess;
            return {
                id: `scenario-tool-${tool.name}-lifecycle`,
                pass:
                    tool.lifecycle.start &&
                    (expectedOutcome === 'failure'
                        ? structuredFailure && !tool.lifecycle.postToolSuccess
                        : structuredSuccess && rendered),
                detail:
                    `${tool.name} lifecycle expected=${expectedOutcome} start=${tool.lifecycle.start ? 'yes' : 'no'} done=${tool.lifecycle.done ? 'yes' : 'no'} ` +
                    `failed=${tool.lifecycle.failed ? 'yes' : 'no'} postSuccess=${tool.lifecycle.postToolSuccess ? 'yes' : 'no'} postFailure=${tool.lifecycle.postToolFailure ? 'yes' : 'no'} ` +
                    `resultTypes=${tool.lifecycle.resultTypes.join(',') || '-'} exitCodes=${tool.lifecycle.exitCodes.join(',') || '-'} ` +
                    `rendered=${rendered ? 'yes' : 'no'} events=${tool.lifecycle.matchedEventIds.slice(0, 8).join(',') || '-'}`,
            };
        }),
        ...scenarioToolLifecycle.map((tool) => ({
            id: `scenario-tool-${tool.name}-focus-preserved`,
            pass: tool.allowFocusTransitions === true || tool.thinkingOverrideEventIds.length === 0,
            detail:
                tool.allowFocusTransitions === true
                    ? `${tool.name} allows focused transitions between repeated calls in this scenario`
                    : tool.thinkingOverrideEventIds.length === 0
                      ? `${tool.name} remained the foreground activity until completion`
                      : `${tool.name} was overwritten by thinking activity event(s) ${tool.thinkingOverrideEventIds.join(', ')}`,
        })),
        ...scenarioOutputMarkers.map(({ marker, observedInToolResult }) => ({
            id: `scenario-marker-${marker.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
            pass: observedInToolResult,
            detail: `scenario output marker ${marker} ${observedInToolResult ? 'observed in tool result' : 'missing from tool results'}`,
        })),
        ...scenarioTerminalRender.map(({ toolName, badge, forbiddenBadge, expectedRe, forbiddenRe }) => {
            const expectedObserved = expectedRe.test(plain);
            const forbiddenObserved = forbiddenRe ? forbiddenRe.test(plain) : false;
            return {
                id: `scenario-render-${toolName.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}-${badge.toLowerCase()}`,
                pass: expectedObserved && !forbiddenObserved,
                detail:
                    `${toolName} render expected=[${badge}] observed=${expectedObserved ? 'yes' : 'no'}` +
                    (forbiddenBadge
                        ? ` forbidden=[${forbiddenBadge}] observed=${forbiddenObserved ? 'yes' : 'no'}`
                        : ''),
            };
        }),
        ...(scenarioUsesPermissionedTool
            ? [
                  {
                      id: 'no-sdk-permission-prompt-in-approve-all',
                      pass: !sdkPermissionPromptObserved,
                      detail: sdkPermissionPromptObserved
                          ? 'approve_all emitted SDK permission prompt/event'
                          : 'approve_all executed permissioned scenario tools without SDK permission prompt/event',
                  },
                  {
                      id: 'health-full-permission-policy-visible',
                      pass:
                          /permission\s+approve_all[\s\S]{0,120}sdk prompts=skip/iu.test(plain) ||
                          /Permiss(?:ões|oes)\s+automáticas\s+·\s+prompts SDK ignorados/iu.test(plain),
                      detail: '/health full rendered automatic permissions with SDK prompts skipped for permissioned live scenario',
                  },
              ]
            : []),
        {
            id: 'ask-user-visible',
            pass: scenario.askRenderedRe.test(plain),
            detail: `ask_user prompt rendered persistently for scenario=${scenario.id}`,
        },
        {
            id: 'ask-user-input-prompt-visible',
            pass: hasHumanQuestionInputPrompt(plain),
            detail: 'ask_user rendered a dedicated [PERG] input prompt before the answer',
        },
        {
            id: 'ask-user-single-source',
            pass: askRenderedBySdk && !askRenderedByQuestionPending,
            detail: `ask_user rendered by sdk=${askRenderedBySdk ? 'yes' : 'no'} question.pending=${askRenderedByQuestionPending ? 'yes' : 'no'}`,
        },
        {
            id: 'ask-user-answer',
            pass:
                /Resposta\s+enviada para pergunta pendente/.test(plain) ||
                new RegExp(`resposta=${escapeRegExp(scenario.answerSteps.at(-1)?.answer ?? '')}`, 'iu').test(plain) ||
                scenario.finalAnswerRe.test(plain),
            detail: `human answer was registered for scenario=${scenario.id}`,
        },
        {
            id: 'ask-user-answer-not-assistant-echo',
            pass:
                !new RegExp(
                    `\\[LLM-B\\] Mensagem[\\s\\S]{0,240}\\n\\s*│\\s+${escapeRegExp(scenario.answerSteps.at(-1)?.answer ?? '')}(?:\\s|$)`,
                    'u',
                ).test(plain) &&
                !new RegExp(
                    `\\]\\s+🧠\\s+LLM-B[\\s\\S]{0,240}\\n\\s*│\\s+${escapeRegExp(scenario.answerSteps.at(-1)?.answer ?? '')}(?:\\s|$)`,
                    'u',
                ).test(plain),
            detail: 'human answer was not rendered as an LLM-B authored transcript or live delta',
        },
        ...(scenario.invalidChoiceExpected
            ? [
                  {
                      id: 'ask-user-invalid-choice-feedback',
                      pass:
                          /Resposta não corresponde às opções da pergunta pendente/i.test(plain) ||
                          /Resposta inválida para a pergunta pendente/i.test(plain) ||
                          /invalid_choice/i.test(plain) ||
                          new RegExp(
                              `${escapeRegExp(scenario.answerSteps[0]?.answer ?? '')}[\\s\\S]{0,2400}${escapeRegExp(scenario.askQuestion)}`,
                              'iu',
                          ).test(plain),
                      detail:
                          'choice-only scenario rejected the invalid answer locally or re-opened the question before accepting the valid choice',
                  },
              ]
            : []),
        ...(scenario.recoverableToolErrorExpected
            ? [
                  {
                      id: 'scenario-recoverable-tool-error-observed',
                      pass: scenarioToolLifecycle.some(
                          (tool) =>
                              tool.name === 'exec_command' &&
                              tool.expectedOutcome === 'failure' &&
                              (tool.lifecycle.failed || tool.lifecycle.postToolFailure),
                      ),
                      detail: 'recoverable tool error was observed in structured lifecycle/postToolUse data before successful continuation',
                  },
              ]
            : []),
        {
            id: 'post-ask-final-visible',
            pass: finalRenderedByLiveTurn || finalRenderedByAssistantMessage,
            detail: `post-ask final visible live=${finalRenderedByLiveTurn ? 'yes' : 'no'} assistant.message=${finalRenderedByAssistantMessage ? 'yes' : 'no'}`,
        },
        {
            id: 'no-extra-output-after-post-ask-final',
            pass: !unexpectedPostAskContinuation,
            detail: unexpectedPostAskContinuation
                ? `assistant continued after the final marker · event=${unexpectedPostAskContinuation.event ?? '-'} #${eventPublicId(unexpectedPostAskContinuation) ?? '-'}`
                : 'assistant stopped after the final marker until diagnostic commands',
        },
        {
            id: 'sse-canonical-transcript-events',
            pass:
                Boolean(canonicalTranscriptEvents.deltaAssistant) &&
                Boolean(canonicalTranscriptEvents.askRequested) &&
                Boolean(canonicalTranscriptEvents.askCompleted) &&
                Boolean(canonicalTranscriptEvents.postAskAssistant),
            detail:
                `delta=${formatCanonicalEventSummary(canonicalTranscriptEvents.deltaAssistant)} · ` +
                `ask=${formatCanonicalEventSummary(canonicalTranscriptEvents.askRequested)} · ` +
                `answer=${formatCanonicalEventSummary(canonicalTranscriptEvents.askCompleted)} · ` +
                `postAsk=${formatCanonicalEventSummary(canonicalTranscriptEvents.postAskAssistant)}`,
        },
        {
            id: 'export-sse-correlation',
            pass: Boolean(exportSummary?.ok) && exportSseAskRequested && exportSseAskCompleted && exportSsePostAsk,
            detail:
                `ask=${exportSseAskRequested ? 'matched' : 'missing'} · ` +
                `answer=${exportSseAskCompleted ? 'matched' : 'missing'} · ` +
                `postAsk=${exportSsePostAsk ? 'matched' : 'missing'} · ` +
                `exportEnvelopes=${Array.isArray(exportSummary?.envelopes) ? exportSummary.envelopes.length : 0}`,
        },
        {
            id: 'llm-usage-visible',
            pass:
                /Uso BYOK sem Premium Request/.test(plain) ||
                /Uso BYOK sem pedido premium/.test(plain) ||
                /Telemetria LLM sem Premium Request/.test(plain) ||
                /Telemetria LLM sem pedido premium/.test(plain) ||
                /Última telemetria LLM/.test(plain) ||
                /Premium Request classificada/.test(plain) ||
                /LLM\s+modelo [^\n\r]+(?:\n|\r\n?)\s*Pedido\s+sem pedido premium/iu.test(plain),
            detail: 'llm.usage telemetry surfaced separately from PR with current or legacy labels',
        },
        {
            id: 'sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo(?:=|\s)/.test(plain),
            detail: '/events renderizou a cauda do arquivo SSE público durável',
        },
        {
            id: 'sse-archive-human-source-labels',
            pass:
                /LLM-B via SDK/u.test(beforeRawDiagnosticsPlain) &&
                /pergunta ao operador/u.test(beforeRawDiagnosticsPlain) &&
                /telemetria LLM/u.test(beforeRawDiagnosticsPlain) &&
                /registro export/u.test(beforeRawDiagnosticsPlain) &&
                !/SDK assistant|pergunta humana SDK|agente\/usage|export envelope|Sessão SDK|Hook iniciado|Hook concluído/u.test(
                    beforeRawDiagnosticsPlain,
                ),
            detail:
                '/events default rendered transcript/user/usage/export sources as operator-facing labels before raw diagnostics',
        },
        {
            id: 'sse-archive-default-control-noise-hidden',
            pass:
                !/^\s*(Atividade|Ocupado|Sessão atualizada|Rotina iniciada|Rotina concluída|Streaming|Turno iniciado|Turno concluído)\s{2,}\d{4}-\d{2}-\d{2}T/imu.test(
                    beforeRawDiagnosticsPlain,
                ) &&
                !/^\s*Uso LLM\s{2,}\d{4}-\d{2}-\d{2}T[^\n]*diálogo/imu.test(beforeRawDiagnosticsPlain),
            detail:
                '/events default hides routine activity, lifecycle, hook, turn, streaming and duplicate usage rows before raw diagnostics',
        },
        {
            id: 'sse-archive-human-operational-events',
            pass:
                !/agent error|Info da sessão|terminal turn empty output|Operation cancelled by user|non[_ ]user[_ ]initiated|recoverable_model_call|model_call|errorOccurred/iu.test(
                    beforeRawDiagnosticsPlain,
                ) &&
                (!/Erro do SDK sem mensagem estruturada|erro de provider BYOK/iu.test(beforeRawDiagnosticsPlain) ||
                    /Erro BYOK|falha do provider BYOK/iu.test(beforeRawDiagnosticsPlain)),
            detail:
                '/events default rendered provider failures, cancellations, empty turns, and usage classifications as human operational events',
        },
        {
            id: 'sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw expôs ${archiveRawEvents.length} evento(s) do arquivo SSE`,
        },
        {
            id: 'sse-archive-raw-preview-humanized-intermediate-turn',
            pass:
                !rawPreviewHasLegacyIntermediateTurnCompletion &&
                (!rawPreviewHasIntermediateTurnCompletion || rawPreviewHasHumanIntermediateTurnContinuation),
            detail: rawPreviewHasIntermediateTurnCompletion
                ? '/events --raw preview humanized intermediate SDK tool-only turn_end as request continuation'
                : '/events --raw preview window did not include the intermediate tool-only turn_end',
        },
        {
            id: 'sse-archive-http-overlap',
            pass: sseIds.length === 0 || archiveSseOverlap.length > 0,
            detail: `archiveIds=${archiveIds.slice(0, 8).join(', ') || '-'} · httpIds=${sseIds.slice(0, 8).join(', ') || '-'} · overlap=${archiveSseOverlap.slice(0, 8).join(', ') || '-'}`,
        },
        {
            id: 'no-obvious-duplication',
            pass: !duplicatePathologies.some((pattern) => pattern.test(plain)) && !truncatedTurnEndDuplicate,
            detail: truncatedTurnEndDuplicate
                ? `dialog.turn_end #${truncatedTurnEndDuplicate.turnEndEventId ?? '?'} repeated prefix of assistant.message #${truncatedTurnEndDuplicate.assistantMessageEventId ?? '?'}`
                : 'no known duplicate/pathology markers detected',
        },
        {
            id: 'ux-compact-boot-banner',
            pass:
                /Terminal LLM-B/.test(plain) &&
                /LLM-B pronta/.test(plain) &&
                !/\/workspace \[list\|read\|write\|sync\|mirror\|promote\]/.test(plain),
            detail: 'boot rendered compact banner/brief instead of the full command catalog',
        },
        {
            id: 'ux-no-standalone-boot-box',
            pass: !/┌─ Terminal Permanente LLM-B/u.test(plain),
            detail: 'standalone boot surface avoided the old second box',
        },
        {
            id: 'ux-no-boot-prompt-double-paint',
            pass: !/voc[eê]\[([^\]\n]+)\]›[^\n]*\n\s*voc[eê]\[\1\]›/iu.test(beforeReadyPlain),
            detail: 'boot did not paint the same idle prompt twice before ready',
        },
        {
            id: 'ux-human-tool-names',
            pass:
                /Inten[cç][aã]o\s+capturada/u.test(plain) &&
                /Ferramenta\s+Ler arquivo\s+·\s+lendo arquivo/u.test(plain) &&
                /Conclu[ií]do\s+(?:ok\s+)?Ler arquivo\s+·\s+lendo arquivo conclu[ií]do/u.test(plain),
            detail: 'default tool narration uses human tool names',
        },
        {
            id: 'ux-no-raw-tool-ids-in-default-tool-lines',
            pass: !hasRawInternalIdInDefaultToolNarration(plain),
            detail: hasRawInternalIdInDefaultToolNarration(plain)
                ? 'default tool narration leaked raw tool id/alias'
                : 'default tool narration kept raw ids in diagnostics only',
        },
        {
            id: 'ux-no-durable-waiting-spam',
            pass: !/LLM-B ainda trabalhando|request_user_input ainda executando|chatcmpl-tool-[a-z0-9-]+|ask_user SDK/iu.test(
                beforeRawDiagnosticsPlain,
            ),
            detail: 'durable waiting/tool heartbeat spam, raw ids, and SDK ask_user labels were not printed',
        },
        {
            id: 'ux-no-raw-html-in-public-output',
            pass: !/<\s*(?:a|img|script|iframe|object|embed)\b/iu.test(beforeRawDiagnosticsPlain),
            detail: 'public terminal/export surface escaped raw HTML-like markup from assistant text',
        },
        {
            id: 'ux-no-public-reasoning-tags',
            pass: !publicReasoningTagLeak,
            detail: publicReasoningTagLeak
                ? 'public output exposed thinking/analysis/reasoning tags'
                : 'public output did not expose thinking/analysis/reasoning tags from assistant text',
        },
        {
            id: 'ux-no-generic-tool-failure-copy',
            pass: !/falhou\s+tool\s+·\s+executando tool gen[ée]rica falhou|Tool falhou[\s\S]{0,120}executando tool gen[ée]rica/iu.test(
                beforeRawDiagnosticsPlain,
            ),
            detail: 'default tool failures kept semantic human names instead of generic SDK fallback copy',
        },
        {
            id: 'ux-no-raw-sdk-info-labels',
            pass:
                !/Info SDK|configuration|Disabled tools|model_retry|Response was interrupted due to a server error/iu.test(
                    beforeRawDiagnosticsPlain,
                ) &&
                !/LLM-B sessão · (?:skills|ferramentas|Configura[cç][aã]o)/iu.test(beforeRawDiagnosticsPlain) &&
                !/^\s*T[ií]tulo\s{2,}/imu.test(beforeRawDiagnosticsPlain),
            detail: 'routine SDK session info/title stayed out of the live/default surface and raw SDK labels stayed hidden',
        },
        {
            id: 'ux-compact-byok-error-live-status',
            pass: !/LLM-B\s+erro[\s\S]{0,180}(Erro do SDK|\/byok model|modelo kilo-auto|racioc[ií]nio high|conversa ativa)/iu.test(
                beforeRawDiagnosticsPlain,
            ),
            detail: 'BYOK provider errors stayed compact in the live status line; full action/context remains in durable diagnostics',
        },
        {
            id: 'ux-activity-detail-route-label',
            pass:
                /Mais detalhes\s+\/activity detail/iu.test(beforeRawDiagnosticsPlain) &&
                !/^\s*T[eé]cnico\s+Detalhes t[eé]cnicos ficam em \/activity detail/imu.test(beforeRawDiagnosticsPlain),
            detail: '/activity default exposed a calm detail route instead of the old technical label',
        },
        {
            id: 'ux-activity-post-turn-timeline-operational',
            pass:
                latestActivity40Section.length === 0 ||
                (/Timeline operacional/iu.test(latestActivity40Section) &&
                    !/inicializa[cç][aã]o\s+·|turno\s+·\s+Processando mensagem/iu.test(latestActivity40Section)),
            detail:
                latestActivity40Section.length === 0
                    ? '/activity 40 post-turn section was not present in this scenario'
                    : '/activity 40 post-turn default timeline hid boot and routine message-processing rows',
        },
        {
            id: 'ux-activity-no-redundant-timeline-labels',
            pass:
                latestActivity40Section.length === 0 ||
                !/(?:ferramenta\s+·\s+Ferramenta|pergunta\s+·\s+Pergunta|tarefa\s+·\s+Tarefa|turno\s+·\s+(?:Turno|Inten[cç][aã]o)|sistema\s+·\s+Resposta)/iu.test(
                    latestActivity40Section,
                ),
            detail:
                latestActivity40Section.length === 0
                    ? '/activity 40 post-turn section was not present in this scenario'
                    : '/activity 40 post-turn timeline avoided repeated category labels',
        },
        {
            id: 'ux-events-stable-long-label-column',
            pass:
                !/Tarefa em segundo plano conclu[ií]da\s{2,}\d{4}-\d{2}-\d{2}T/iu.test(beforeRawDiagnosticsPlain) &&
                (/Tarefa em segundo pla…\s+\d{4}-\d{2}-\d{2}T/iu.test(beforeRawDiagnosticsPlain) ||
                    !/Tarefa em segundo plano conclu[ií]da/iu.test(beforeRawDiagnosticsPlain)),
            detail: '/events default kept long event labels from pushing the timestamp column',
        },
        {
            id: 'ux-no-question-ack-task-spam',
            pass: !/Resposta humana entregue ao resolvedor da ferramenta|Pergunta pendente persistida limpa|Tarefa\s+conclu[ií]da\s+·\s+(?:Resposta humana entregue|Pergunta pendente persistida)/iu.test(
                beforeRawDiagnosticsPlain,
            ),
            detail: 'internal ask_user delivery/cleanup acknowledgements did not pollute live output, /activity, or default /events',
        },
        {
            id: 'ux-single-live-status-source',
            pass: !/[⏳⌛] aguardando .*watchdog\//.test(plain),
            detail: 'dialog watchdog did not render a second live-status line when permanent live status is enabled',
        },
        {
            id: 'ux-compact-no-delta-live-status',
            pass:
                !/thinking\/LLM-B trabalhando[\s\S]{0,160}sem delta visível/iu.test(plain) &&
                !/thinking\//iu.test(plain),
            detail: 'no-delta live status stayed semantic/compact instead of repeating the full working label',
        },
        {
            id: 'ux-compact-turn-live-status',
            pass:
                !/turn\/Intenção da LLM-B[\s\S]{0,160}terminal live canonical/iu.test(plain) && !/turn\//iu.test(plain),
            detail: 'turn live status avoided repeating long intent details',
        },
        {
            id: 'ux-no-intermediate-finalizing-before-public-output',
            pass: !/LLM-B\s+finalizando[^\n\r]*(?:\r|\n|\s)+LLM-B\s+pensando\s+·\s+\d+s\s+sem\s+resposta\s+p[uú]blica/iu.test(
                beforeRawDiagnosticsPlain,
            ),
            detail: 'intermediate SDK tool-only turn_end stayed as continuation instead of a finalizing/thinking flicker',
        },
        {
            id: 'ux-no-legacy-post-answer-labels',
            pass: !/(Resposta p[oó]s-pergunta|turno\s+·\s+Processando mensagem)/iu.test(beforeRawDiagnosticsPlain),
            detail: 'post-answer public surface avoided legacy question/reply labels and raw turn-processing copy',
        },
        {
            id: 'ux-no-post-answer-turn-processing-copy',
            pass:
                answerPromptIndex < 0 ||
                !/(Resposta p[oó]s-pergunta|p[oó]s-pergunta|turno\s+·\s+Processando mensagem|Processando mensagem)/iu.test(
                    postAnswerPublicPlain,
                ),
            detail: 'surface after the human answer avoided legacy post-question and raw turn-processing copy',
        },
        {
            id: 'ux-compact-tool-live-status',
            pass: !/tool\/Ferramenta em uso/iu.test(plain) && !/tool\/Executando tool/iu.test(plain),
            detail: 'tool live status used human phase labels instead of raw phase/tool prefixes',
        },
        {
            id: 'ux-tool-live-status-stays-single-line',
            pass: toolLiveStatusFrames.every(
                (frame) =>
                    !frame.includes('\n') &&
                    /·\s+\d+(?:s|m\d{2}s|h\d{2}m)\s*$/u.test(frame) &&
                    !/\b(?:modelo|racioc[ií]nio|conversa ativa)\b/iu.test(frame),
            ),
            detail: 'tool live status stayed one compact operator line without model/runtime tail',
        },
        {
            id: 'ux-no-technical-tool-name-in-live-status',
            pass: !/⟲ LLM-B[^\n\r]*(?:tool\/|ferramenta ·)[^\n\r]*\bexec_command\b/iu.test(plain),
            detail: 'live status did not expose exec_command in the default visual line',
        },
        {
            id: 'ux-intent-label-portuguese',
            pass: /Inten[cç][aã]o\s+capturada/u.test(plain) && !/\[INTENT\]/u.test(plain),
            detail: 'intent blocks use the Portuguese operator-facing label',
        },
        {
            id: 'ux-intent-command-default-human',
            pass:
                /Inten[cç][oõ]es capturadas/iu.test(latestIntentDefaultSection) &&
                /origem (?:SDK|ferramenta de inten[cç][aã]o|terminal|ferramenta|captura)/iu.test(
                    latestIntentDefaultSection,
                ) &&
                !/report_intent|tool\/|toolu_|chatcmpl-tool|origem bruta|patch_file|call_/iu.test(
                    latestIntentDefaultSection,
                ),
            detail: '/intent default rendered captured intents without raw source, tool name, or call identifiers',
        },
        {
            id: 'ux-intent-command-detail-human-envelope',
            pass:
                /detalhe t[eé]cnico/iu.test(latestIntentDetailSection) &&
                /Envelope\s+origem (?:SDK|ferramenta de inten[cç][aã]o|terminal|ferramenta|captura)/iu.test(
                    latestIntentDetailSection,
                ) &&
                /registro\s+(?:local|id interno|[a-z0-9…-]+)/iu.test(latestIntentDetailSection) &&
                !/origem bruta|tool\/report_intent|report_intent_local|toolu_|chatcmpl-tool|patch_file|call_/iu.test(
                    latestIntentDetailSection,
                ),
            detail: '/intent detail kept the technical envelope humanized and compact',
        },
        {
            id: 'ux-compact-ask-live-status',
            pass: !/ASK\/aguardando operador/u.test(plain),
            detail: 'ask live status stayed compact and did not include the old verbose label',
        },
        {
            id: 'ux-question-live-status-does-not-compete-with-input',
            pass:
                !/SIMSIM/u.test(plain) &&
                !/voc[eê]\[[^\n\r]*\[PERG\][^\n\r]*›[^\n\r]*(?:LLM-B aguardando voc[eê]|SIMSIM)/iu.test(plain),
            detail: 'pending-question live status did not repaint inside the human input line',
        },
        {
            id: 'ux-question-wait-surface-human',
            pass:
                questionWaitSurface.length === 0 ||
                (/\[(?:PERGUNTA|PERG)\]|Pergunta ao operador/iu.test(questionWaitSurface) &&
                    !/request_user_input ainda executando|ask_user SDK|chatcmpl-tool-[a-z0-9-]+|toolu_[a-z0-9_-]+|Tool\s+solicitou|Tool\s+(?:conclu[ií]da|falhou)|LLM-B ainda trabalhando/iu.test(
                        questionWaitSurface,
                    )),
            detail:
                questionWaitSurface.length === 0
                    ? 'no dedicated question wait surface was captured for this scenario'
                    : 'human-question wait surface stayed semantic without raw SDK/tool heartbeat noise',
        },
        {
            id: 'ux-no-durable-tool-output-inside-question-prompt',
            pass: !/voc[eê]\[[^\n\r]*\[PERG\][^\n\r]*›[^\n\r]*(?:Ferramenta|Arquivo|Conclu[ií]do|Falhou|Turno)\b/iu.test(
                plain,
            ),
            detail: 'durable tool/file/turn rows did not render inside the pending human-question prompt line',
        },
        {
            id: 'ux-no-durable-output-inside-default-prompt',
            pass: !/voc[eê]\[[^\n\r]*\]›\s{2,}(?:Ferramenta|Arquivo|Conclu[ií]do|Falhou|Turno|Evento|Uso do modelo)\b/iu.test(
                plain,
            ),
            detail: 'durable operational rows did not render inside the default idle prompt line',
        },
        {
            id: 'ux-answer-live-status-stays-single-line',
            pass: !/LLM-B resposta recebida\s+·\s+aguardando LLM-B/iu.test(plain),
            detail: 'post-answer live status stayed compact enough for narrow PTY',
        },
        {
            id: 'ux-turn-file-summary-deduped',
            pass: !/Arquivos\s+LER\s+package\.json\s+·\s+LER\s+package\.json/iu.test(beforeRawDiagnosticsPlain),
            detail: 'turn summary did not repeat the same human file path in one row',
        },
        {
            id: 'ux-turn-file-summary-operation-coverage',
            pass: fileRoundtripSummaryCoverageOk,
            detail: scenarioUsesFileRoundtrip
                ? `file roundtrip summary covered create, move and delete (${fileRoundtripSingleSummaryCoverage ? 'single compact row' : fileRoundtripDistributedSummaryCoverage ? 'distributed compact rows' : 'missing coverage'})`
                : 'scenario does not require file roundtrip operation coverage',
        },
        {
            id: 'ux-command-cwd-not-file-target',
            pass:
                !scenarioUsesExecCommand ||
                (!/Arquivos\s+EXEC\s+\./iu.test(beforeRawDiagnosticsPlain) &&
                    !/Arquivo\s+execu[cç][aã]o\s+·\s+\./iu.test(beforeRawDiagnosticsPlain) &&
                    !/Executar comando\s+·\s+execu[cç][aã]o\s+·\s+\./iu.test(beforeRawDiagnosticsPlain) &&
                    !/Executar comando[\s\S]{0,120}Alvo\s+\./iu.test(beforeRawDiagnosticsPlain)),
            detail: 'exec_command cwd stayed contextual instead of becoming a touched file or replacing the command target',
        },
        {
            id: 'ux-no-raw-hourglass-waiting-prompt',
            pass: !/⏳\s+\[[^\]]+\]/u.test(plain),
            detail: 'waiting prompt avoided the old raw hourglass model/effort tag',
        },
        {
            id: 'ux-live-status-not-input-prompt',
            pass: !/^\s*LLM-B pensando\s*$/imu.test(plain),
            detail: 'live status stayed above the input instead of becoming a standalone prompt line',
        },
        {
            id: 'ux-diagnostic-commands-start-at-prompt',
            pass: !promptlessDiagnosticCommand,
            detail: promptlessDiagnosticCommand
                ? 'a diagnostic command was echoed without the REPL prompt'
                : 'diagnostic commands were echoed from a visible REPL prompt',
        },
        {
            id: 'ux-health-human-tool-stats',
            pass: healthToolStatsUseHumanNames(plain),
            detail: healthToolStatsUseHumanNames(plain)
                ? 'health tool stats used human names in default output'
                : 'health tool stats leaked technical names or was not rendered',
        },
        {
            id: 'ux-human-runtime-vocabulary',
            pass: !/(?:runtime|ambiente), SDK e hub conectados|Agente\s+·\s+runtime\s+·\s+modelo\s+·\s+entrada/iu.test(
                beforeRawDiagnosticsPlain,
            ),
            detail: 'operator-facing usage/health surfaces used ambiente vocabulary instead of runtime vocabulary',
        },
        {
            id: 'ux-human-answer-confirmation',
            pass:
                /Resposta\s+enviada para pergunta pendente\./u.test(plain) &&
                !/\[answer\] Resposta enviada para pergunta pendente \(default\)/u.test(plain),
            detail: 'human answer confirmation avoided default runtime noise',
        },
        {
            id: 'no-prompt-double-render',
            pass: !promptDoubleRender,
            detail: promptDoubleRender ? 'adjacent prompt repaint detected' : 'no adjacent prompt repaint detected',
        },
        {
            id: 'ux-no-ready-prompt-during-active-turn',
            pass: !readyPromptDuringActiveTurn,
            detail: readyPromptDuringActiveTurn
                ? 'idle prompt appeared while the assistant turn was still producing final transcript'
                : 'idle prompt did not appear between tool summary/live status and final transcript',
        },
        {
            id: 'inline-status-rendered',
            pass: inlineStatusRendered,
            detail: inlineStatusRendered
                ? 'TTY status line rendered above the prompt'
                : 'TTY status line above the prompt not detected',
        },
        {
            id: 'no-final-delta-duplication',
            pass: !(finalRenderedByLiveTurn && finalRenderedByAssistantMessage),
            detail: `final rendered live=${finalRenderedByLiveTurn ? 'yes' : 'no'} assistant.message=${finalRenderedByAssistantMessage ? 'yes' : 'no'}`,
        },
        {
            id: 'no-truncated-turn-end-duplication',
            pass: !truncatedTurnEndDuplicate,
            detail: truncatedTurnEndDuplicate
                ? `turn=${truncatedTurnEndDuplicate.turnKey ?? '-'} · dialog.turn_end #${truncatedTurnEndDuplicate.turnEndEventId ?? '?'} chars=${truncatedTurnEndDuplicate.replyChars} covered by assistant.message #${truncatedTurnEndDuplicate.assistantMessageEventId ?? '?'} chars=${truncatedTurnEndDuplicate.contentChars}`
                : 'dialog.turn_end did not render/archive a truncated prefix already covered by assistant.message',
        },
        {
            id: 'no-parallel-task-delta-after-dialog',
            pass:
                !/delta suppressed\/(?:duplicate_suffix|causal_duplicate)\s+·\s+task\.delta/.test(plain) &&
                !(liveDeltaBlockVisible && taskDeltaActivityDuringDialog),
            detail: `dialog.delta is canonical; task.delta activity=${taskDeltaActivityDuringDialog ? 'yes' : 'no'}`,
        },
        {
            id: 'no-terminal-errors',
            pass: /nenhum erro recente/iu.test(plain) && !/\bERROR\b/.test(beforeRawWithoutExpectedScenarioMarkers),
            detail: 'rastreador de erros do terminal permaneceu limpo',
        },
        {
            id: 'clean-quit',
            pass: hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal saiu por /quit com texto humano de encerramento',
        },
        {
            id: 'export-created',
            pass: Boolean(exportSummary?.ok),
            detail: exportSummary?.detail ?? 'conversation export was not inspected',
        },
        {
            id: 'export-transcript',
            pass: Boolean(exportSummary?.hasTranscript),
            detail: 'exported Markdown contains the assistant transcript',
        },
        {
            id: 'export-streaming-diagnostics',
            pass: Boolean(exportSummary?.hasStreamingDiagnostics),
            detail: 'exported Markdown contains streaming/final reconciliation diagnostics',
        },
        {
            id: 'export-envelope',
            pass: Boolean(exportSummary?.hasEnvelope),
            detail: 'exported Markdown contains source/trace envelope data',
        },
        {
            id: 'export-ask-user',
            pass: Boolean(exportSummary?.hasAskUser),
            detail: 'exported Markdown contains the canonical ask_user request',
        },
        {
            id: 'export-ask-user-answer',
            pass: Boolean(exportSummary?.hasAskUserAnswer),
            detail: 'exported Markdown contains the human answer with user authorship',
        },
        {
            id: 'export-post-ask-final',
            pass: Boolean(exportSummary?.hasPostAskFinal),
            detail: 'exported Markdown contains the post-ask assistant final message',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: true, plain }),
    ];
}

function evaluateNoPrOutput(plain, sseSummary) {
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const archiveJsonDump = extractArchiveJsonDump(plain);
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal chegou ao estado pronto',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal executou com superfície interativa REPL/TTY',
        },
        {
            id: 'no-explicit-turn',
            pass: !/\[intervene→turn\]/.test(plain) && !/Processando mensagem/.test(plain),
            detail: 'nenhum turno explícito de LLM foi aberto durante o probe --no-pr',
        },
        {
            id: 'usage-visible',
            pass:
                /Premium Request:|Última (?:Premium Request|telemetria PR) classificada:|GitHub Copilot quota\/PR side-channel:|Histórico\s+Copilot último snapshot|Cobrança\s+GitHub PR/.test(
                    plain,
                ) && /Modo\s+SDK|Modo:\s*sdk=/.test(plain),
            detail: '/usage now renderizou contexto, PR e telemetria de modo SDK',
        },
        {
            id: 'activity-visible',
            pass: /Atividade Atual da LLM-B/.test(plain) && /Streaming público/.test(plain),
            detail: '/activity renderizou seções de atividade e diagnósticos de streaming',
        },
        {
            id: 'sdk-session-main-cockpit-visible',
            pass:
                /Sessão SDK[\s\S]*(Sessões SDK listadas|nenhuma sessão SDK listada)/u.test(plain) &&
                /CommandDefinitions\s+\d+ CommandDefinitions expostos[\s\S]*(?:nenhum comando chamado nesta janela|chamadas? na janela)[\s\S]*\/session sdk (?:commands|events)/u.test(
                    plain,
                ),
            detail: '/session sdk renderizou o cockpit principal com catálogo de CommandDefinitions e estado de comandos no arquivo SSE',
        },
        {
            id: 'sdk-session-command-catalog-visible',
            pass: /Comandos SDK expostos ao Copilot/.test(plain) && /terminal_status/.test(plain),
            detail: '/session sdk commands renderizou o catálogo de CommandDefinitions exposto ao SDK',
        },
        {
            id: 'sdk-session-events-cockpit-visible',
            pass: /Eventos SDK da sessão/.test(plain) && /Registro\s+arquivo|arquivo SSE canônico/.test(plain),
            detail: '/session sdk events renderizou diagnóstico de ciclo de vida/comandos a partir do arquivo SSE canônico',
        },
        {
            id: 'sdk-session-waits-cockpit-visible',
            pass:
                /(?:Waits|Esperas) SDK da sessão/.test(plain) &&
                /perguntas\s+\d+|perguntas=\d+/.test(plain) &&
                /(?:formulários|elicitation)\s+\d+|elicitation=\d+/.test(plain),
            detail: '/session sdk waits renderizou diagnóstico de ask_user/elicitation/permission a partir do arquivo SSE canônico',
        },
        {
            id: 'sdk-session-waits-empty-state-human',
            pass:
                /nenhuma espera SDK arquivada nesta janela/iu.test(plain) &&
                /normal após resume silencioso ou sem ask_user\/elicitation\/permission/iu.test(plain) &&
                /\/sdk waits para pendências vivas/iu.test(plain),
            detail: '/session sdk waits explicou janela vazia do arquivo SSE como normal após resume silencioso e apontou pendências vivas',
        },
        {
            id: 'metrics-visible',
            pass: /Métricas da sessão|Métricas da Sessão/.test(plain) && /Streaming público/.test(plain),
            detail: '/metrics renderizou sessão e contadores de streaming público',
        },
        {
            id: 'sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo(?:=|\s)/.test(plain),
            detail: '/events renderizou a cauda do arquivo SSE público durável sem abrir turno',
        },
        {
            id: 'sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw expôs ${archiveRawEvents.length} evento(s) de controle do arquivo SSE sem abrir turno`,
        },
        {
            id: 'sse-archive-json-parseable',
            pass: Boolean(archiveJsonDump && Array.isArray(archiveJsonDump.entries)),
            detail: `/events --json compact renderizou ${archiveJsonDump?.entries?.length ?? 0} evento(s) estruturado(s) do arquivo SSE sem abrir turno`,
        },
        {
            id: 'events-sources-guidance-visible',
            pass:
                /Fontes do Terminal/u.test(plain) &&
                /\/events --json compact · \/events --raw preview · \/events --raw full/u.test(plain) &&
                /payload público redigido; compacto usa preview e ids de filtro/u.test(plain),
            detail: '/events sources renderizou orientação de formatos, payload redigido e ids de filtro',
        },
        {
            id: 'no-tools-started',
            pass: !/\[TOOL\]/.test(plain) && !/\[DONE\]/.test(plain),
            detail: 'probe não invocou tools',
        },
        {
            id: 'no-terminal-errors',
            pass: /nenhum erro recente/iu.test(plain) && !/\bERROR\b/.test(plain),
            detail: 'rastreador de erros do terminal permaneceu limpo',
        },
        {
            id: 'clean-quit',
            pass: hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal saiu por /quit com texto humano de encerramento',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: false, plain }),
    ];
}

function evaluateByokProbeOutput(plain, sseSummary, { fixture = false } = {}) {
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const byokProfilesRe = /BYOK (?:profiles|perfis)/iu;
    const byokModelsRe = /BYOK (?:models|modelos)/iu;
    const byokRecommendRe = /BYOK (?:recommend|recomenda(?:ç|c)[aã]o)/iu;
    const criteria = [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal chegou ao estado pronto',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal executou com superfície interativa REPL/TTY',
        },
        {
            id: 'no-explicit-turn',
            pass: !/\[intervene→turn\]/.test(plain) && !/Processando mensagem/.test(plain),
            detail: 'BYOK probe did not open an explicit LLM turn',
        },
        {
            id: 'byok-status-visible',
            pass: /BYOK status/.test(plain) && /\.env\.local/.test(plain),
            detail: '/byok rendered the redacted canonical status',
        },
        {
            id: 'byok-env-visible',
            pass: /BYOK env can[oô]nico|BYOK env canônico/u.test(plain) && /COPILOT_BYOK_PROFILES_JSON/.test(plain),
            detail: '/byok env rendered the canonical operator contract',
        },
        {
            id: 'byok-profiles-visible',
            pass: byokProfilesRe.test(plain),
            detail: '/byok profiles rendered configured profile information or the empty-state',
        },
        {
            id: 'byok-providers-visible',
            pass: /BYOK provedores/.test(plain) && /\/byok use |nenhum configurado/iu.test(plain),
            detail: '/byok providers rendered the redacted provider cockpit and operator actions',
        },
        {
            id: 'byok-health-visible',
            pass: /Saúde operacional BYOK/.test(plain),
            detail: '/byok health rendered persisted BYOK operational health with human title',
        },
        {
            id: 'byok-models-visible',
            pass: byokModelsRe.test(plain),
            detail: '/byok models refresh rendered model catalog state without exposing secrets',
        },
        {
            id: 'byok-model-filters-visible',
            pass:
                /BYOK (?:models|modelos)[\s\S]{0,800}filtros[\s\S]{0,120}gratuito[\s\S]{0,120}raciocínio[\s\S]{0,120}modo seguro/iu.test(
                    plain,
                ),
            detail: '/byok models accepted operator filters for free/reasoning/safe discovery',
        },
        {
            id: 'byok-recommend-visible',
            pass:
                byokRecommendRe.test(plain) &&
                /\/byok probe agent(?:\s+profile:[^\s]+)?\s+model:/.test(plain) &&
                /live descartável/.test(plain),
            detail: '/byok recommend rendered ranked operational recommendations with disposable agent probe actions',
        },
        {
            id: 'byok-use-sdk-visible',
            pass: /BYOK desativado no processo atual|SDK Copilot/.test(plain),
            detail: '/byok use sdk returned the process to the SDK-governed mode',
        },
        {
            id: 'byok-no-secret-leak',
            pass: !/codex-fixture-token-never-print/.test(plain),
            detail: 'BYOK probe did not print fixture bearer token',
        },
        {
            id: 'sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo(?:=|\s)/.test(plain),
            detail: '/events renderizou a cauda do arquivo SSE público durável',
        },
        {
            id: 'sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw expôs ${archiveRawEvents.length} evento(s) de controle do arquivo SSE`,
        },
        {
            id: 'no-terminal-errors',
            pass: /nenhum erro recente/iu.test(plain) && !/\bERROR\b/.test(plain),
            detail: 'rastreador de erros do terminal permaneceu limpo',
        },
        {
            id: 'clean-quit',
            pass: hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal saiu por /quit com texto humano de encerramento',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: false, plain }),
    ];
    if (fixture) {
        criteria.splice(
            8,
            0,
            {
                id: 'byok-fixture-profile-visible',
                pass: /codex-fixture/.test(plain) && /metadados owner,purpose|metadados purpose,owner/.test(plain),
                detail: 'fixture profile appeared with redacted metadata keys',
            },
            {
                id: 'byok-fixture-profile-activation',
                pass: /Perfil\s+codex-fixture/iu.test(plain) && /Modelo\s+fixture\/model-a/iu.test(plain),
                detail: '/byok use codex-fixture activated profile model in the current process',
            },
            {
                id: 'byok-fixture-model-list',
                pass: /BYOK (?:models|modelos)[\s\S]{0,800}fixture\/model-a/iu.test(plain) && /fixture\/model-b/.test(plain),
                detail: '/byok models refresh returned fixture model catalog',
            },
            {
                id: 'byok-fixture-remote-discovery',
                pass:
                    /BYOK (?:models|modelos)[\s\S]{0,1200}Fonte\s+provider/iu.test(plain) &&
                    /endpoint\s+http:\/\/127\.0\.0\.1:\d+\/v1\/models/.test(plain) &&
                    /fixture\/model-remote-c/.test(plain),
                detail: 'fixture provider /models endpoint was discovered live and redacted',
            },
            {
                id: 'byok-fixture-model-switch',
                pass: /Modelo\s+fixture\/model-b/iu.test(plain),
                detail: '/byok model switched model inside active BYOK process state',
            },
            {
                id: 'byok-fixture-provider-switch',
                pass:
                    /preset openai-compatible/.test(plain) &&
                    /Modelo\s+fixture\/model-c/iu.test(plain) &&
                    /base http:\/\/127\.0\.0\.1:\d+\/v1/.test(plain),
                detail: '/byok provider switched provider preset/model/baseUrl in the current process',
            },
        );
    }
    return criteria;
}

function evaluateAutoProbeOutput(plain, sseSummary, { profile = 'repo_agent' } = {}) {
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const routeProfile = profile || 'repo_agent';
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal chegou ao estado pronto',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal executou com superfície interativa REPL/TTY',
        },
        {
            id: 'no-explicit-turn',
            pass: !/\[intervene→turn\]/.test(plain) && !/Processando mensagem/.test(plain),
            detail: 'auto probe did not open an explicit LLM turn',
        },
        {
            id: 'gateway-commands-visible',
            pass:
                /model-gateway/i.test(plain) &&
                /npm run model-gateway:/.test(plain) &&
                /\/byok auto doctor/.test(plain),
            detail: '/byok gateway commands rendered canonical package and terminal commands',
        },
        {
            id: 'gateway-operator-ready-visible',
            pass:
                /BYOK model-gateway operator-ready/.test(plain) &&
                /sem\s+chamada\s+a\s+provedor/iu.test(plain) &&
                /Standby\s+\d+/u.test(plain),
            detail: '/byok gateway operator-ready rendered the read-only terminal cockpit',
        },
        {
            id: 'auto-policy-visible',
            pass:
                /BYOK model-gateway auto policy/.test(plain) &&
                /Efetivo\s+(?:ativo|desativado)/u.test(plain) &&
                /troca viva/.test(plain) &&
                /nova sessão/.test(plain),
            detail: '/byok auto policy rendered effective policy and source-independent flags',
        },
        {
            id: 'auto-status-visible',
            pass:
                /BYOK model-gateway auto/i.test(plain) &&
                /seletor (?:runtime|de execução)/u.test(plain) &&
                /ação/.test(plain) &&
                new RegExp(`perfil\\s+${escapeRegExp(routeProfile)}\\b`, 'iu').test(plain),
            detail: '/byok auto status rendered the selected profile decision',
        },
        {
            id: 'auto-alternatives-visible',
            pass: /Alternativas\s+usáveis|Alternativas\s+0\/0|selecionados\s+0\/0/u.test(plain),
            detail: '/byok auto status/doctor rendered fallback candidate summary or an explicit empty state',
        },
        {
            id: 'auto-doctor-visible',
            pass:
                /BYOK model-gateway auto doctor/.test(plain) &&
                /Política\s+ativa/u.test(plain) &&
                /Decisão\s+ok/u.test(plain) &&
                /Registros\s+decisões/u.test(plain),
            detail: '/byok auto doctor rendered policy, decision and ledger cockpit',
        },
        {
            id: 'auto-explain-visible',
            pass:
                /Explicação BYOK auto/u.test(plain) &&
                /decisão atual \+ diagnóstico operacional/u.test(plain) &&
                /BYOK model-gateway auto doctor/u.test(plain),
            detail: '/byok auto explain rendered the automation explanation',
        },
        {
            id: 'auto-gateway-alias-visible',
            pass: /\/byok gateway auto|BYOK model-gateway auto status|model-gateway auto status/i.test(plain),
            detail: '/byok gateway auto alias produced an automation decision surface',
        },
        {
            id: 'auto-apply-visible',
            pass:
                /Auto apply[\s\S]*(?:modelo vivo solicitado|nenhum efeito terminal derivado|nenhum efeito aplicado)/iu.test(
                    plain,
                ) &&
                /Atividade Atual da LLM-B[\s\S]*(?:Troca de modelo solicitada|Pronto)/iu.test(plain) &&
                !/live setModel|set_live_model|effect_not_authorized/iu.test(plain),
            detail: '/byok auto apply rendered a human terminal-effect outcome without raw effect ids',
        },
        {
            id: 'auto-history-visible',
            pass: /BYOK model-gateway auto history/.test(plain),
            detail: '/byok auto history rendered persisted automation decisions or empty state',
        },
        {
            id: 'auto-handoffs-visible',
            pass: /Handoffs BYOK/.test(plain),
            detail: '/byok auto handoffs rendered SDK handoff ledger or empty state',
        },
        {
            id: 'auto-confirmations-visible',
            pass: /Confirmações BYOK/.test(plain),
            detail: '/byok auto confirmations rendered SDK confirmation ledger or empty state',
        },
        {
            id: 'auto-proof-plan-visible',
            pass:
                /Plano de provas BYOK|BYOK (?:model-gateway auto proof plan|plano de provas automáticas)/.test(plain) &&
                (/\/byok probe (?:agent|chat) provider:/u.test(plain) ||
                    /nenhum comando de prova foi derivado das alternativas bloqueadas atuais/iu.test(plain)),
            detail: '/byok auto plan rendered explicit provider/model runtime proof commands or an explicit empty state without provider calls',
        },
        {
            id: 'auto-standby-visible',
            pass:
                /BYOK model-gateway auto standby/.test(plain) &&
                /sem chamada\s+a\s+provedor/iu.test(plain) &&
                ((/Provar\s+\/byok probe/u.test(plain) &&
                    /Novo boot\s+\/session sdk next new/u.test(plain)) ||
                    /nenhuma rota de prontid[aã]o foi derivada do seletor atual/iu.test(plain)),
            detail: '/byok auto standby rendered ready replacement commands or an explicit empty state without provider calls',
        },
        {
            id: 'auto-recovery-fixture-visible',
            pass:
                /Fixture de recuperação BYOK/.test(plain) &&
                /sem\s+chamada\s+a\s+provedor/iu.test(plain) &&
                /Saúde\s+registrada sim|saúde sintética sim/u.test(plain),
            detail: '/byok auto recovery-fixture ran synthetic post-turn recovery and persisted health without provider call',
        },
        {
            id: 'auto-recoveries-visible',
            pass: /Recuperações BYOK/.test(plain) && /limite de taxa|rate-limit/.test(plain),
            detail: '/byok auto recoveries rendered post-turn recovery ledger or empty state',
        },
        {
            id: 'auto-human-default-copy',
            pass:
                !/\b(?:providerCall=nao|liveSetModel=|runtimeSelector=|action=|ledgers:|from=|reason=|live setModel|Modelo SDK:|prepare_new_sdk_session|new_session_not_allowed|manual_intervention|candidate alternative|selected route|new provider)\b/iu.test(
                    plain,
                ) &&
                !/(?:Check|Classe|Sem ação|Bloqueios|Política)\s+.*(?:new session policy|new session requires explicit policy|automation decision|standby routes|terminal boundary|preset operator_manual)/iu.test(
                    plain,
                ),
            detail: 'auto/BYOK control surfaces avoided raw key-value and setModel jargon in default copy',
        },
        {
            id: 'auto-sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo(?:=|\s)/.test(plain),
            detail: '/events renderizou a cauda do arquivo SSE público durável',
        },
        {
            id: 'auto-sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw expôs ${archiveRawEvents.length} evento(s) de controle do arquivo SSE`,
        },
        {
            id: 'no-terminal-errors',
            pass: /nenhum erro recente/iu.test(plain) && !/\bERROR\b/.test(plain),
            detail: 'rastreador de erros do terminal permaneceu limpo',
        },
        {
            id: 'clean-quit',
            pass: hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal saiu por /quit com texto humano de encerramento',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: false, plain }),
    ];
}

function evaluateModelProbeOutput(plain, sseSummary) {
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const defaultSurface = plain.split(/\/events\s+80\s+--raw/iu)[0] ?? plain;
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal chegou ao estado pronto',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal executou com superfície interativa REPL/TTY',
        },
        {
            id: 'no-explicit-turn',
            pass: !/\[intervene→turn\]/.test(plain) && !/Processando mensagem/.test(plain),
            detail: 'model probe did not open an explicit LLM turn',
        },
        {
            id: 'model-current-visible',
            pass: /Modelo ativo\s+·\s+auto/u.test(plain) && /autoridade GitHub Copilot/u.test(plain),
            detail: '/model rendered the current native auto model policy in human language',
        },
        {
            id: 'model-auto-visible',
            pass:
                /Modelo solicitado\s+·\s+auto \(sem troca\)/u.test(plain) &&
                /Auto\s+roteamento nativo do Copilot/u.test(plain),
            detail: '/model auto rendered native routing guidance without BYOK/provider jargon',
        },
        {
            id: 'model-explicit-visible',
            pass:
                /Modelo solicitado\s+·\s+auto → gpt-4\.1-mini/u.test(plain) &&
                /Raciocínio\s+high → off/u.test(plain),
            detail: '/model <id> rendered a local model change and reasoning guidance',
        },
        {
            id: 'model-change-sse-operator-summary',
            pass:
                /"event":"session\.model_changed"/u.test(plain) &&
                /"operatorSummary":"confirmado sem troca: auto \(sem troca\) · origem SDK · \d{4}-\d{2}-\d{2}T/u.test(
                    plain,
                ),
            detail: 'session.model_changed raw SSE carries the canonical operator summary with ISO timestamp',
        },
        {
            id: 'model-events-summary-semantic',
            pass:
                /Modelo confirmado[\s\S]{0,220}confirmado sem troca: auto \(sem troca\)/u.test(plain) &&
                !/Modelo alterado[\s\S]{0,220}modelo auto → auto/u.test(plain),
            detail: '/events summarizes no-op model confirmations without calling them model changes',
        },
        {
            id: 'model-no-byok-blocker',
            pass: !/BYOK está ativo: \/model <id> não troca provider customizado/u.test(plain),
            detail: 'native model probe disabled BYOK so /model could exercise SDK-native switching copy',
        },
        {
            id: 'model-human-default-copy',
            pass: !/\b(?:preferência local=|autoridade=|último efetivo=|Modelo SDK:|model_changed|providerCall=nao|liveSetModel=)\b/iu.test(
                defaultSurface,
            ),
            detail: 'model control surfaces avoided raw key-value and SDK event jargon in default copy',
        },
        {
            id: 'model-sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo(?:=|\s)/.test(plain),
            detail: '/events renderizou a cauda do arquivo SSE público durável durante o probe de modelo',
        },
        {
            id: 'model-sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw expôs ${archiveRawEvents.length} evento(s) de controle do arquivo SSE`,
        },
        {
            id: 'no-terminal-errors',
            pass: /nenhum erro recente/iu.test(plain) && !/\bERROR\b/.test(plain),
            detail: 'rastreador de erros do terminal permaneceu limpo',
        },
        {
            id: 'clean-quit',
            pass: hasHumanTerminalShutdownCopy(plain),
            detail: 'terminal saiu por /quit com texto humano de encerramento',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: false, plain }),
    ];
}

function evaluateByokRealOutput(
    plain,
    secretValues,
    {
        profile,
        altProfile,
        model,
        altModel,
        noPr = false,
        runtimeSelector,
        runtimeRoute,
        requireVisionProbe = false,
        liveScenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID],
    } = {},
) {
    const byokModels = [...new Set([model, altModel].filter((value) => typeof value === 'string' && value.length > 0))];
    const byokModelPrLines = byokModels.flatMap((candidate) => {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return plain.match(new RegExp(`^\\s*\\[PR\\]\\s+modelo=${escaped}\\b.*$`, 'gmu')) ?? [];
    });
    const byokTurnOpened =
        !noPr &&
        (/\[intervene→turn\]/u.test(plain) ||
            /(?:^|\n)\s*│\s+DELTA-CANONICAL-\d/u.test(plain) ||
            liveScenario.askRenderedRe.test(plain));
    const byokUsageClassified =
        /\bclasse=byok_user_message\b/u.test(plain) || /"classification"\s*:\s*"byok_user_message"/u.test(plain);
    const byokAdmissionBlocked =
        /Turno não enviado ao provider BYOK|terminal\.byok\.admission_blocked|resultado:\s+admission-blocked/i.test(
            plain,
        );
    const byokPreflightBlocked = Boolean(findByokRealPreflightProbeFailure(plain));
    const byokProviderBlocked =
        byokAdmissionBlocked ||
        byokPreflightBlocked ||
        /erro de provider BYOK/i.test(plain) ||
        /Erro de sessão BYOK/i.test(plain) ||
        /\[query\]\s+Failed to get response from the AI model/i.test(plain) ||
        /\[cancellation\]\s+Operation cancelled by user/i.test(plain);
    const sessionProbeResidueCounts = extractSdkSessionCockpitProbeResidueCounts(plain);
    const preflightProbeResidueCount = sessionProbeResidueCounts[0];
    const postProbeResidueCount = sessionProbeResidueCounts[1];
    const byokVisionProbeStatus = findByokProbeResultStatus(plain, 'vision');
    const criteria = [
        {
            id: 'byok-real-dotenv-reload',
            pass: /\.env\.local recarregado/.test(plain),
            detail: '/byok reload loaded operator-local BYOK config',
        },
        {
            id: 'byok-real-status-ready',
            pass: /BYOK status/.test(plain) && /enabled:\s+sim/.test(plain) && /ready:\s+sim/.test(plain),
            detail: 'BYOK status reached enabled+ready without printing secrets',
        },
        {
            id: 'byok-real-profile-active',
            pass:
                Boolean(runtimeRoute) ||
                !profile ||
                new RegExp(`profile:\\s+${profile.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain),
            detail: runtimeRoute
                ? `runtime-selector route profile ${runtimeRoute.routeProfile ?? '(auto)'} superseded legacy BYOK profile activation`
                : `active BYOK profile ${profile || '(auto)'} was rendered`,
        },
        {
            id: 'byok-real-runtime-selector-route',
            pass:
                !runtimeSelector?.requested ||
                (runtimeSelector.ok === true &&
                    Boolean(runtimeRoute?.providerId) &&
                    Boolean(runtimeRoute?.providerModel) &&
                    new RegExp(`preset:\\s+${escapeRegExp(runtimeRoute.providerId)}`, 'u').test(plain) &&
                    new RegExp(`model:\\s+${escapeRegExp(runtimeRoute.providerModel)}`, 'u').test(plain)),
            detail: runtimeSelector?.requested
                ? `runtime selector ${runtimeSelector.ok ? 'selected' : 'failed'} route=${runtimeRoute?.providerId ?? '-'}/${runtimeRoute?.providerModel ?? '-'} profile=${runtimeRoute?.routeProfile ?? runtimeSelector.profileId ?? '-'}`
                : 'runtime selector route handoff was not requested for this BYOK live run',
        },
        {
            id: 'byok-real-model-catalog',
            pass: /BYOK models/.test(plain) && !/Nenhum modelo BYOK configurado/.test(plain),
            detail: 'BYOK model catalog command returned a usable catalog or remote/static fallback',
        },
        {
            id: 'byok-real-provider-cockpit',
            pass: /BYOK providers/.test(plain) && /\/byok use /.test(plain),
            detail: 'BYOK provider cockpit showed configured providers and operator actions',
        },
        {
            id: 'byok-real-sdk-session-cockpit',
            pass: /Sessão SDK/.test(plain) && /\/restart reinicia só a conversa/.test(plain),
            detail: 'operator can distinguish SDK session cockpit from conversation restart, hub resume and snapshots',
        },
        {
            id: 'byok-real-binding-cockpit',
            pass: /vínculo BYOK:/u.test(plain) && /preparado:/u.test(plain) && /limite BYOK:/u.test(plain),
            detail: 'BYOK and SDK session cockpits separated prepared selection from live provider binding',
        },
        {
            id: 'byok-real-probe-session-cleanup',
            pass:
                sessionProbeResidueCounts.length >= 2 &&
                preflightProbeResidueCount !== undefined &&
                preflightProbeResidueCount === postProbeResidueCount,
            detail:
                sessionProbeResidueCounts.length >= 2
                    ? `SDK probe-residue count stayed stable around disposable BYOK probes (${preflightProbeResidueCount} -> ${postProbeResidueCount})`
                    : 'SDK session cockpit was not rendered before and after disposable BYOK probes',
        },
        {
            id: 'byok-real-chat-probe',
            pass:
                /BYOK chat probe/.test(plain) && /BYOK agent probe/.test(plain) && /sessão SDK descartável/.test(plain),
            detail: 'BYOK preflight exercised disposable chat and agent probes before the live operator turn',
        },
        {
            id: 'byok-real-route-decision',
            pass:
                /BYOK model route/.test(plain) &&
                (/\bdecision=route-/.test(plain) || /Nenhum candidato encontrado para roteamento/.test(plain)) &&
                /fallback chain|Nenhum modelo passou|Nenhum candidato encontrado para roteamento/.test(plain),
            detail: 'BYOK preflight exercised model-gateway route decision ledger before probes/live promotion',
        },
        {
            id: 'byok-real-streaming-probe',
            pass: byokAdmissionBlocked || /BYOK streaming probe[\s\S]{0,1800}resultado:\s+ok/.test(plain),
            detail: byokAdmissionBlocked
                ? 'BYOK streaming probe was admission-blocked before provider streaming'
                : 'BYOK streaming probe validated assistant.message_delta on a disposable session',
        },
        {
            id: 'byok-real-json-probe',
            pass: byokAdmissionBlocked || /BYOK json probe[\s\S]{0,1800}resultado:\s+ok/.test(plain),
            detail: byokAdmissionBlocked
                ? 'BYOK JSON probe was admission-blocked before provider streaming'
                : 'BYOK JSON probe validated parseable structured output on a disposable session',
        },
        {
            id: 'byok-real-vision-probe',
            pass: byokAdmissionBlocked || byokVisionProbeStatus === 'ok',
            required: requireVisionProbe,
            severity: requireVisionProbe ? 'error' : 'warning',
            detail: byokAdmissionBlocked
                ? 'BYOK vision probe was admission-blocked before provider streaming'
                : byokVisionProbeStatus === 'ok'
                  ? 'BYOK vision probe proved image attachment interpretation on the disposable session'
                  : `BYOK vision probe recorded an explicit non-proving capability result (${byokVisionProbeStatus ?? 'missing'}) without degrading chat admission`,
        },
        {
            id: 'byok-real-shortlist-probe',
            pass:
                /BYOK shortlist agent probe/.test(plain) &&
                (/Shortlist encerrada: ok=\d+\/\d+/.test(plain) ||
                    /Nenhum candidato cabe na shortlist atual/.test(plain)),
            detail: 'BYOK preflight exercised a ranked disposable shortlist probe without mutating the live session',
        },
        {
            id: 'byok-real-chat-probe-ok',
            pass: byokAdmissionBlocked || /BYOK chat probe[\s\S]{0,1400}resultado:\s+ok/.test(plain),
            detail: byokAdmissionBlocked
                ? 'BYOK chat probe was admission-blocked before the provider because its declared budget is too small'
                : 'BYOK chat probe produced a real disposable assistant response',
        },
        {
            id: 'byok-real-agent-probe-ok',
            pass: byokAdmissionBlocked || /BYOK agent probe[\s\S]{0,1800}resultado:\s+ok/.test(plain),
            detail: byokAdmissionBlocked
                ? 'BYOK agent probe was admission-blocked before tool/ask_user because its declared budget is too small'
                : 'BYOK agent probe validated tool calling and ask_user on the disposable session',
        },
        {
            id: 'byok-real-model-filtering',
            pass: /BYOK models[\s\S]{0,1000}filtros=[^\n]*free[^\n]*reasoning[^\n]*safe/.test(plain),
            detail: 'BYOK real probe exercised filtered model discovery',
        },
        {
            id: 'byok-real-recommendation',
            pass:
                /BYOK recommend/.test(plain) &&
                (/ok para uso geral|baixo para turno real|apertado para sessão longa/.test(plain) ||
                    /Nenhum modelo atende aos filtros/.test(plain)),
            detail: 'BYOK recommendation command rendered operational budget guidance',
        },
        {
            id: 'byok-real-model-switch',
            pass:
                !model ||
                new RegExp(`model:\\s+${model.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain) ||
                /BYOK models[\s\S]{0,1200}/.test(plain),
            detail: `BYOK model switch path exercised for ${model || '(profile default)'}`,
        },
        {
            id: 'byok-real-alt-provider-switch',
            pass:
                !altProfile ||
                new RegExp(`profile:\\s+${altProfile.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain),
            detail: altProfile
                ? `alternate BYOK profile ${altProfile} was exercised`
                : 'no alternate usable profile configured',
        },
        {
            id: 'byok-real-alt-model-switch',
            pass:
                !altModel ||
                new RegExp(`model:\\s+${altModel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain) ||
                /BYOK models[\s\S]{0,1200}/.test(plain),
            detail: altModel ? `alternate BYOK model ${altModel} was exercised` : 'no alternate model configured',
        },
        {
            id: 'byok-real-no-secret-leak',
            pass: !hasSecretLeak(plain, secretValues),
            detail: `${secretValues.length} local secret value(s) checked against terminal output`,
        },
        {
            id: 'byok-real-usage-not-pr',
            pass: byokModelPrLines.length === 0,
            detail:
                byokModelPrLines.length > 0
                    ? `BYOK model usage was rendered as PR: ${byokModelPrLines.slice(0, 2).join(' | ')}`
                    : 'BYOK model usage was not rendered as Premium Request',
        },
        {
            id: 'byok-real-usage-classified',
            pass: !byokTurnOpened || byokUsageClassified || byokProviderBlocked,
            detail: byokPreflightBlocked
                ? 'Disposable BYOK probes blocked the live user turn before usage telemetry'
                : byokAdmissionBlocked
                  ? 'BYOK turn never reached provider usage because admission blocked the request envelope'
                  : byokProviderBlocked
                    ? 'BYOK provider aborted before usage telemetry; no Premium Request was inferred'
                    : byokTurnOpened
                      ? `BYOK user-message usage classification observed=${byokUsageClassified ? 'yes' : 'no'}`
                      : 'no BYOK user turn opened in this probe',
        },
        {
            id: 'byok-real-operator-health',
            pass:
                !byokTurnOpened ||
                (byokProviderBlocked ? /chat=failed/i.test(plain) : /chat=ok/i.test(plain) || /chat=\?/i.test(plain)),
            detail: byokProviderBlocked
                ? 'BYOK provider failure was reflected in operator health'
                : 'BYOK provider health cockpit rendered after live turn or stayed unknown before a turn',
        },
        {
            id: 'byok-real-health-command',
            pass: /Saúde operacional BYOK/.test(plain),
            detail: '/byok health was available in the real BYOK diagnostic path',
        },
    ];
    return criteria;
}

function evaluateBlockedOutput(plain, sseSummary, blocker) {
    const blockedByByokProvider =
        blocker?.id === 'byok-provider-turn-failed' || blocker?.id === 'byok-route-no-response';
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal chegou ao estado pronto antes do bloqueio',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal executou com superfície interativa REPL/TTY',
        },
        {
            id: `blocked-by-${blocker.id}`,
            pass: false,
            detail: blocker.detail,
        },
        {
            id: 'sse-connected',
            pass: sseSummary.connected,
            detail: `SSE collector ${sseSummary.connected ? 'connected' : 'did not connect'} before blocker`,
        },
        ...(blockedByByokProvider
            ? [
                  {
                      id: 'byok-provider-panel-visible',
                      pass:
                          /(?:Provider|Rota) BYOK/.test(plain) &&
                          /(?:troque provider\/modelo com \/byok use ou \/byok model|\/byok health)/.test(plain),
                      detail: 'BYOK provider/route failure rendered an actionable operator panel',
                  },
                  {
                      id: 'byok-provider-error-tracked',
                      pass:
                          /Erros rastreados[\s\S]{0,800}(?:terminal\.byok_provider|Erro de provider BYOK|Provider BYOK|Turno sem progresso|Turno vazio|Rota BYOK)/u.test(
                              plain,
                          ) && !/Erros rastreados\s+·\s+0 total\s+·\s+0 no buffer/u.test(plain),
                      detail: '/errors surfaced the operator-visible BYOK provider/route failure',
                  },
              ]
            : []),
        {
            id: 'root-cause-not-ux-duplication',
            pass: true,
            detail: 'scenario criteria skipped because the blocker prevented assistant/tool/ask_user streaming',
        },
    ];
}

async function inspectExportedMarkdown(exportPath, scenario = LIVE_SCENARIOS[DEFAULT_LIVE_SCENARIO_ID]) {
    try {
        const content = await readFile(exportPath, 'utf8');
        const envelopes = [
            ...content.matchAll(
                /^>\s+envelope=([^·\n]+)\s+·\s+trace=([^·\n]+)\s+·\s+turn=([^·\n]+)\s+·\s+evento=([^\n]+)$/gmu,
            ),
        ].map((match) => ({
            source: match[1]?.trim() ?? '',
            traceId: match[2]?.trim() && match[2]?.trim() !== '-' ? match[2].trim() : null,
            turnId: match[3]?.trim() && match[3]?.trim() !== '-' ? match[3].trim() : null,
            eventId: match[4]?.trim() && match[4]?.trim() !== '-' ? match[4].trim() : null,
        }));
        return {
            ok: true,
            detail: `${content.length} chars`,
            hasTranscript: hasRequiredDeltaTail(content) || scenario.askQuestionRe.test(content),
            hasStreamingDiagnostics: /streaming=/.test(content),
            hasEnvelope: /envelope=/.test(content),
            hasAskUser: /ask_user solicitou resposta humana:/iu.test(content) && scenario.askQuestionRe.test(content),
            hasAskUserAnswer: new RegExp(
                `##\\s+(?:👤\\s+)?(?:Usu[aá]rio|Operador)[^\\n]*[\\s\\S]*Resposta ao ask_user:\\s*\\n?\\s*${escapeRegExp(
                    scenario.answerSteps.at(-1)?.answer ?? '',
                )}`,
                'iu',
            ).test(content),
            hasPostAskFinal: scenario.postAskFinalRe.test(content),
            envelopes,
            content,
        };
    } catch (error) {
        return {
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
            hasTranscript: false,
            hasStreamingDiagnostics: false,
            hasEnvelope: false,
            hasAskUser: false,
            hasAskUserAnswer: false,
            hasPostAskFinal: false,
            envelopes: [],
            content: '',
        };
    }
}

function parseSseFrame(frame) {
    const lines = frame.split(/\r?\n/u);
    let event = 'message';
    let id = null;
    const dataLines = [];
    for (const line of lines) {
        if (line.startsWith('event:')) {
            event = line.slice('event:'.length).trim();
        } else if (line.startsWith('id:')) {
            const parsed = Number(line.slice('id:'.length).trim());
            id = Number.isFinite(parsed) ? parsed : null;
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
        }
    }
    const dataRaw = dataLines.join('\n');
    let data = dataRaw;
    if (dataRaw) {
        try {
            data = JSON.parse(dataRaw);
        } catch {
            data = dataRaw;
        }
    }
    return { id, event, data };
}

function startSseCollector({ port = 3009, pathname = '/events' } = {}) {
    let raw = '';
    let buffer = '';
    let connected = false;
    let statusCode = null;
    const errors = [];
    const events = [];

    const req = http.request(
        {
            host: '127.0.0.1',
            port,
            path: pathname,
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
        },
        (res) => {
            statusCode = res.statusCode ?? null;
            connected = statusCode === 200;
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
                buffer += chunk;
                const frames = buffer.split(/\r?\n\r?\n/u);
                buffer = frames.pop() ?? '';
                for (const frame of frames) {
                    if (!frame.trim()) continue;
                    events.push(parseSseFrame(frame));
                }
            });
        },
    );
    req.on('error', (err) => {
        errors.push(err instanceof Error ? err.message : String(err));
    });
    req.end();

    return {
        get raw() {
            return raw;
        },
        events,
        errors,
        close() {
            req.destroy();
        },
        summary() {
            const correlation = summarizeSseEvents(events);
            return {
                connected,
                statusCode,
                eventCount: events.length,
                eventsWithId: events.filter((evt) => Number.isFinite(evt.id)).length,
                eventsWithSource: correlation.sourceEnvelopeEvents.length,
                eventsWithTraceId: correlation.traceEvents.length,
                traceIds: correlation.traceIds,
                errors: [...errors],
                events: [...events],
                raw,
            };
        },
    };
}

async function main() {
    const timeoutMs = Number(readArg('--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
    const postAnswerDelayMs = Number(readArg('--post-answer-delay-ms', String(DEFAULT_POST_ANSWER_DELAY_MS)));
    const postAskContinuationWaitMs = Number(
        readArg('--post-ask-continuation-wait-ms', String(DEFAULT_POST_ASK_CONTINUATION_WAIT_MS)),
    );
    const outDir = path.resolve(ROOT, readArg('--out-dir', `artifacts/terminal-live/${nowStamp()}`));
    const requestedTransport = readArg('--transport', 'pty');
    const dryRun = hasFlag('--dry-run');
    const noPr = hasFlag('--no-pr');
    const sessionCycle = hasFlag('--session-cycle');
    const structuredInputCycle = hasFlag('--structured-input-cycle');
    const menuCycle = hasFlag('--menu-cycle');
    const pickerInteractiveCycle = hasFlag('--picker-interactive-cycle');
    const uxCycle = hasFlag('--ux-cycle');
    const diagnosticUxCycle = hasFlag('--diagnostic-ux-cycle');
    const auditUxCycle = hasFlag('--audit-ux-cycle');
    const operatorUxCycle = hasFlag('--operator-ux-cycle');
    const reuseSdkSession = hasFlag('--reuse-sdk-session');
    const byokProbe = hasFlag('--byok-probe');
    const byokFixture = hasFlag('--byok-fixture');
    const autoProbe = hasFlag('--auto-probe');
    const modelProbe = hasFlag('--model-probe');
    const autoProbeProfile = readArg('--auto-probe-profile', 'repo_agent');
    const byokReal = hasFlag('--byok-real');
    const byokControlProbe = !byokReal && (byokProbe || byokFixture);
    const autoControlProbe = autoProbe && !byokReal && !byokControlProbe;
    const modelControlProbe = modelProbe && !byokReal && !byokControlProbe && !autoControlProbe;
    const liveScenario = readLiveScenario();
    const scenarioKind = liveScenarioKind({
        autoControlProbe,
        modelControlProbe,
        byokControlProbe,
        byokFixture,
        byokReal,
        noPr,
        sessionCycle,
        structuredInputCycle,
        menuCycle,
        pickerInteractiveCycle,
        uxCycle,
        diagnosticUxCycle,
        auditUxCycle,
        operatorUxCycle,
        liveScenario,
    });
    const byokRealProfile = readArg('--byok-real-profile', '');
    const byokRealAltProfile = readArg('--byok-real-alt-profile', '');
    const byokRealModel = readArg('--byok-real-model', '');
    const byokRealAltModel = readArg('--byok-real-alt-model', '');
    const byokRealRuntimeSelectorProfile = readArg('--byok-real-route-profile', '');
    const byokRealRuntimeSelectorFallbackProfiles = runtimeSelectorFallbackProfiles(
        readArg('--byok-real-route-fallback-profiles', ''),
    );
    const byokRealRuntimeSelectorExecute = hasFlag('--byok-real-route-execute') && !dryRun;
    const byokRealRuntimeSelectorAllowProbe = hasFlag('--byok-real-route-allow-probe');
    const byokRealRuntimeSelectorMaxAttempts = Number(readArg('--byok-real-route-max-attempts', '8'));
    const byokRealRuntimeSelectorMaxAttemptsPerProvider = Number(
        readArg('--byok-real-route-max-attempts-per-provider', '4'),
    );
    const byokRealRuntimeSelectorTemporaryFailureCooldownMs = Number(
        readArg('--byok-real-route-temporary-failure-cooldown-ms', '0'),
    );
    const byokRealRuntimeSelectorTimeoutMs = Number(readArg('--byok-real-route-timeout-ms', '45000'));
    const byokRealRuntimeSelectorSelectionPolicy = readArg('--byok-real-route-selection-policy', '');
    const byokRealRequireVisionProbe = hasFlag('--byok-real-require-vision-probe');
    const collectSse = !hasFlag('--no-sse');
    const requestedTerminalPort = readArg('--terminal-port', '');
    const requestedSsePort = readArg('--sse-port', '');
    const preferredPort = Number(requestedTerminalPort || requestedSsePort || '3009');
    const terminalPort =
        requestedTerminalPort || requestedSsePort ? preferredPort : await resolveLiveTerminalPort(preferredPort);
    const ssePort = Number(requestedSsePort || String(terminalPort));
    const startedAt = new Date().toISOString();

    await mkdir(outDir, { recursive: true });
    const rawPath = path.join(outDir, 'terminal.raw.log');
    const plainPath = path.join(outDir, 'terminal.plain.log');
    const exportPath = path.join(outDir, 'conversation-export.md');
    const exportArg = path.relative(ROOT, exportPath).replaceAll(path.sep, '/');
    const sseRawPath = path.join(outDir, 'terminal.sse.log');
    const sseJsonlPath = path.join(outDir, 'terminal.sse.jsonl');
    const jsonPath = path.join(outDir, 'summary.json');
    const mdPath = path.join(outDir, 'summary.md');
    const byokFixtureProvider = byokFixture ? await startByokFixtureProviderServer() : null;
    const byokFixtureBaseUrl = byokFixtureProvider?.baseUrl ?? 'http://127.0.0.1:11434/v1';
    const dotenvEnv = byokReal ? await loadDotenvLocalEnv() : {};
    const realByok = byokReal
        ? buildRealByokRuntime({
              dotenvEnv,
              requestedProfile: byokRealProfile,
              requestedAltProfile: byokRealAltProfile,
              requestedModel: byokRealModel,
              requestedAltModel: byokRealAltModel,
              runtimeSelectorProfile: byokRealRuntimeSelectorProfile,
              runtimeSelectorFallbackProfiles: byokRealRuntimeSelectorFallbackProfiles,
              runtimeSelectorExecute: byokRealRuntimeSelectorExecute,
              runtimeSelectorAllowProbe: byokRealRuntimeSelectorAllowProbe,
              runtimeSelectorMaxAttempts: Number.isFinite(byokRealRuntimeSelectorMaxAttempts)
                  ? byokRealRuntimeSelectorMaxAttempts
                  : 8,
              runtimeSelectorMaxAttemptsPerProvider: Number.isFinite(byokRealRuntimeSelectorMaxAttemptsPerProvider)
                  ? byokRealRuntimeSelectorMaxAttemptsPerProvider
                  : 4,
              runtimeSelectorTemporaryFailureCooldownMs: Number.isFinite(
                  byokRealRuntimeSelectorTemporaryFailureCooldownMs,
              )
                  ? byokRealRuntimeSelectorTemporaryFailureCooldownMs
                  : 0,
              runtimeSelectorTimeoutMs: Number.isFinite(byokRealRuntimeSelectorTimeoutMs)
                  ? byokRealRuntimeSelectorTimeoutMs
                  : 45_000,
              runtimeSelectorSelectionPolicy: byokRealRuntimeSelectorSelectionPolicy,
          })
        : null;
    const secretValues = byokReal
        ? collectSecretValues({ ...process.env, ...dotenvEnv, ...(realByok?.env ?? {}) })
        : [];
    if (byokReal && byokRealRuntimeSelectorProfile && !realByok?.runtimeRoute) {
        const blocker = {
            id: 'byok-runtime-selector-route-unavailable',
            detail: realByok?.runtimeSelector?.error || 'runtime selector did not produce an executable route',
        };
        await writeEarlyBlockedSummary({
            blocker,
            startedAt,
            outDir,
            rawPath,
            plainPath,
            exportPath,
            sseRawPath,
            sseJsonlPath,
            jsonPath,
            mdPath,
            transport: requestedTransport,
            realByok,
            liveScenario,
        });
        console.log(`[terminal-live] summary: ${path.relative(ROOT, mdPath)}`);
        console.error(`[terminal-live] BLOCKED: ${blocker.id}`);
        process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (sessionCycle) {
        const summary = await runSessionCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] session cycle summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (structuredInputCycle) {
        const summary = await runStructuredInputCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(
            `[terminal-live] structured input summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`,
        );
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (menuCycle) {
        const summary = await runMenuCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] menu summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (pickerInteractiveCycle) {
        const summary = await runPickerInteractiveCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(
            `[terminal-live] picker interactive summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`,
        );
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (uxCycle) {
        const summary = await runDefaultUxCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] default ux summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (diagnosticUxCycle) {
        const summary = await runDiagnosticUxCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] diagnostic ux summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (auditUxCycle) {
        const summary = await runAuditUxCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] audit ux summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (operatorUxCycle) {
        const summary = await runOperatorUxCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] operator ux summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (dryRun) {
        const prompt = autoControlProbe
            ? buildAutoProbeCommands({ profile: autoProbeProfile }).join('\n')
            : modelControlProbe
              ? buildModelProbeCommands().join('\n')
              : byokControlProbe
                ? buildByokProbeCommands({ fixtureBaseUrl: byokFixtureBaseUrl }).join('\n')
                : byokReal
                  ? [
                        ...buildByokRealPreflightCommands(realByok ?? {}),
                        ...(noPr ? buildByokRealNoPrDiagnosticCommands() : [buildScenarioPrompt(liveScenario)]),
                    ]
                        .filter(Boolean)
                        .join('\n')
                  : noPr
                    ? buildNoPrProbeCommands().join('\n')
                    : buildScenarioPrompt(liveScenario);
        await writeFile(path.join(outDir, 'prompt.txt'), `${prompt}\n`, 'utf8');
        console.log(
            `[terminal-live] dry-run prompt written to ${path.relative(ROOT, path.join(outDir, 'prompt.txt'))}`,
        );
        await byokFixtureProvider?.close();
        return;
    }

    const shouldForceFreshSdkSession =
        !reuseSdkSession && !noPr && !sessionCycle && !byokControlProbe && !autoControlProbe && !modelControlProbe;
    const sdkSessionBootSelection = await scheduleFreshSdkSessionForCanonicalScenario({
        enabled: shouldForceFreshSdkSession,
    });
    if (!sdkSessionBootSelection.ok) {
        const blocker = {
            id: 'sdk-session-boot-selection-failed',
            detail: `could not schedule a fresh SDK session for canonical live scenario: ${
                sdkSessionBootSelection.reason ?? 'unknown'
            }`,
        };
        await writeEarlyBlockedSummary({
            blocker,
            startedAt,
            outDir,
            rawPath,
            plainPath,
            exportPath,
            sseRawPath,
            sseJsonlPath,
            jsonPath,
            mdPath,
            transport: requestedTransport,
            realByok,
            sdkSessionBootSelection,
            liveScenario,
        });
        console.log(`[terminal-live] summary: ${path.relative(ROOT, mdPath)}`);
        console.error(`[terminal-live] BLOCKED: ${blocker.id}`);
        process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    const canUsePty = requestedTransport === 'pty' && hasCommand('script');
    const transport = canUsePty ? 'pty:script' : 'stdio:headless';
    if (requestedTransport === 'pty' && !canUsePty) {
        console.warn('[terminal-live] comando `script` indisponível; usando stdio headless como fallback diagnóstico.');
    }

    let raw = '';
    let readySent = false;
    let answerSent = false;
    let answerSequenceStarted = false;
    let answerStepIndex = 0;
    let postCommandsSent = false;
    let quitSent = false;
    let scenarioSent = false;
    let scenarioPlainOffset = 0;
    let byokNoPrCanQuit = !(byokReal && noPr);
    let exitCode = null;
    let sseCollector = null;
    let postAskContinuationObserved = false;
    let answerPlainOffset = 0;
    let lastAnswerStepPlainOffset = 0;
    let postAnswerCommandTimer = null;
    let timedOut = false;
    let timeoutStage = 'scenario';
    let timeoutBudgetMs = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    /** @type {string[]} */
    let promptSynchronizedCommands = [];
    /** @type {null | (() => void)} */
    let onPromptSynchronizedCommandsDrained = null;
    let promptSynchronizedCommandOutputOffset = 0;
    let waitingForPromptSynchronizedCommand = false;
    let waitingForPromptBeforeSynchronizedCommand = false;
    let pendingByokLiveProtocolDiagnostics = false;
    let askBeforeDeltasDiagnosticsSent = false;
    let askBeforeDeltasDiagnosticsPendingAfterAnswer = false;
    let askBeforeDeltasAnswerPlainOffset = 0;
    let missingRequiredAskDiagnosticTimer = null;
    let missingRequiredAskRecoverySent = false;
    let missingRequiredAskRecoveryPlainOffset = 0;
    let incompleteExpectedToolRecoverySent = false;
    let forcedKillTimer = null;
    const command = buildTerminalLlmbCommand(canUsePty);

    const child = spawn(command.cmd, command.args, {
        cwd: ROOT,
        env: {
            ...process.env,
            ...dotenvEnv,
            ...(byokFixture ? buildByokFixtureEnv({ baseUrl: byokFixtureBaseUrl }) : {}),
            ...(modelControlProbe ? { COPILOT_BYOK_ENABLED: 'false' } : {}),
            ...(realByok?.env ?? {}),
            COPILOT_MODEL: 'auto',
            COPILOT_REASONING_EFFORT: 'high',
            TERMINAL_DISPLAY_PRESET: process.env.TERMINAL_DISPLAY_PRESET ?? 'default',
            COPILOT_SDK_ENABLED: 'true',
            COPILOT_OPERATIONAL_PROFILE: 'production',
            LLM_B_TERMINAL_PORT: String(terminalPort),
            TERMINAL_SSE_EVENT_ARCHIVE_DIR: path.join(outDir, 'sse-events'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let childClosed = false;
    child.stdin.on('error', (error) => {
        if (error?.code === 'EPIPE') return;
        console.warn(`[terminal-live] stdin error: ${error?.message ?? String(error)}`);
    });
    const write = (line) => {
        if (childClosed || child.stdin.destroyed || child.stdin.writableEnded) return false;
        if (byokReal && noPr && String(line ?? '').trim() === '/quit' && !byokNoPrCanQuit) return false;
        try {
            return child.stdin.write(ensureLine(line));
        } catch (error) {
            if (error?.code !== 'EPIPE') {
                console.warn(`[terminal-live] write failed: ${error?.message ?? String(error)}`);
            }
            return false;
        }
    };
    const sendNextPromptSynchronizedCommand = () => {
        waitingForPromptBeforeSynchronizedCommand = false;
        const next = promptSynchronizedCommands.shift();
        if (!next) {
            waitingForPromptSynchronizedCommand = false;
            const onDrained = onPromptSynchronizedCommandsDrained;
            onPromptSynchronizedCommandsDrained = null;
            onDrained?.();
            return;
        }
        const entry = normalizeLiveCommandEntry(next);
        if (!entry.line.trim()) {
            sendNextPromptSynchronizedCommand();
            return;
        }
        const send = () => {
            waitingForPromptSynchronizedCommand = true;
            promptSynchronizedCommandOutputOffset = stripAnsi(raw).length;
            write(entry.line);
        };
        if (entry.waitBeforeMs > 0) {
            setTimeout(send, entry.waitBeforeMs).unref();
        } else {
            send();
        }
    };
    const startPromptSynchronizedCommandSequence = (commands, onDrained = null) => {
        promptSynchronizedCommands = [...commands];
        onPromptSynchronizedCommandsDrained = onDrained;
        waitingForPromptSynchronizedCommand = false;
        const plain = stripAnsi(raw);
        if (hasReturnedToReplPrompt(plain, Math.max(0, plain.length - 512))) {
            sendNextPromptSynchronizedCommand();
            return;
        }
        waitingForPromptBeforeSynchronizedCommand = true;
        promptSynchronizedCommandOutputOffset = plain.length;
    };
    const scheduleForcedKill = (delayMs = 2_000) => {
        if (forcedKillTimer) return;
        forcedKillTimer = setTimeout(() => child.kill('SIGTERM'), Math.max(0, delayMs));
        forcedKillTimer.unref();
    };
    const startDiagnosticCommandSequenceThenQuit = (diagnostics, { forceKillDelayMs = 10_000 } = {}) => {
        startPromptSynchronizedCommandSequence(diagnostics, () => {
            if (!quitSent) {
                quitSent = true;
                byokNoPrCanQuit = true;
                write('/quit');
            }
        });
        if (timedOut) scheduleForcedKill(forceKillDelayMs);
    };
    const scheduleScenarioTimeoutDiagnostics = () => {
        if (postCommandsSent) return false;
        postCommandsSent = true;
        const diagnostics = [
            '/activity 40',
            '/intent 5',
            '/tools diag',
            '/events 80',
            '/events 120 --raw',
            '/errors 10',
            '/health full',
            `/export ${exportArg}`,
        ];
        if (byokReal) {
            diagnostics.splice(6, 0, '/byok providers', '/byok health', '/byok recommend reasoning safe 8');
        }
        startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: Math.max(30_000, diagnostics.length * 3_000) });
        return true;
    };
    const schedulePostAnswerDiagnostics = (delayMs = postAnswerDelayMs) => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        if (postAnswerCommandTimer) {
            clearTimeout(postAnswerCommandTimer);
            postAnswerCommandTimer = null;
        }
        setTimeout(
            () => {
                const diagnostics = [
                    '/usage now',
                    '/activity 40',
                    '/intent 5',
                    '/intent detail 5',
                    '/tools diag',
                    '/events 60',
                    '/events 100 --raw',
                    '/errors 10',
                    '/health full',
                ];
                if (byokReal) {
                    diagnostics.push('/byok providers', '/byok health', '/byok recommend reasoning safe 8');
                }
                diagnostics.push(`/export ${exportArg}`);
                startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: diagnostics.length * 2_000 });
            },
            Math.max(0, delayMs),
        ).unref();
    };
    const scheduleByokPreflightDiagnostics = () => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        const diagnostics = [
            '/activity 40',
            '/intent 5',
            '/intent detail 5',
            '/byok providers',
            '/byok health',
            '/byok recommend reasoning safe 8',
            '/events 60',
            '/events 100 --raw',
            '/errors 10',
        ];
        sendCommandSequence(write, diagnostics, { delayMs: 450 });
        setTimeout(
            () => {
                if (!quitSent) {
                    quitSent = true;
                    byokNoPrCanQuit = true;
                    write('/quit');
                }
            },
            diagnostics.length * 450 + 1_500,
        ).unref();
        if (timedOut) scheduleForcedKill(diagnostics.length * 450 + 6_500);
    };
    const scheduleByokLiveProtocolDiagnostics = () => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        const diagnostics = [
            '/activity 40',
            '/intent 5',
            '/intent detail 5',
            '/tools diag',
            '/byok providers',
            '/byok health',
            '/byok recommend reasoning safe 8',
            '/events 60',
            '/events 100 --raw',
            '/errors 10',
        ];
        sendCommandSequence(write, diagnostics, { delayMs: 450 });
        setTimeout(
            () => {
                if (!quitSent) {
                    quitSent = true;
                    byokNoPrCanQuit = true;
                    write('/quit');
                }
            },
            diagnostics.length * 450 + 1_500,
        ).unref();
        if (timedOut) scheduleForcedKill(diagnostics.length * 450 + 6_500);
    };
    const sendAskBeforeDeltasDiagnostics = () => {
        const diagnostics = [
            '/activity 40',
            '/intent 5',
            '/intent detail 5',
            '/tools diag',
            '/events 60',
            '/events 100 --raw',
            '/errors 10',
            '/health full',
            `/export ${exportArg}`,
        ];
        startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: diagnostics.length * 2_000 });
    };
    const scheduleAskBeforeDeltasDiagnostics = () => {
        if (postCommandsSent || askBeforeDeltasDiagnosticsSent) return;
        postCommandsSent = true;
        askBeforeDeltasDiagnosticsSent = true;
        console.warn(
            '[terminal-live] cenário canônico: ask_user apareceu antes dos deltas públicos obrigatórios; respondendo a pergunta pendente antes dos diagnósticos.',
        );
        if (!answerSent && liveScenario.answerSteps[0]) {
            answerSequenceStarted = true;
            answerStepIndex = Math.max(answerStepIndex, 1);
            answerSent = true;
            answerPlainOffset = stripAnsi(raw).length;
            lastAnswerStepPlainOffset = answerPlainOffset;
            askBeforeDeltasDiagnosticsPendingAfterAnswer = true;
            askBeforeDeltasAnswerPlainOffset = answerPlainOffset;
            write(liveScenario.answerSteps[0].answer);
            return;
        }
        console.warn('[terminal-live] cenário canônico: coletando diagnósticos após ask_user prematuro.');
        sendAskBeforeDeltasDiagnostics();
    };
    const scheduleMissingRequiredAskDiagnostics = ({ delayMs = DEFAULT_MISSING_REQUIRED_ASK_GRACE_MS } = {}) => {
        if (postCommandsSent || missingRequiredAskDiagnosticTimer) return;
        missingRequiredAskDiagnosticTimer = setTimeout(() => {
            missingRequiredAskDiagnosticTimer = null;
            if (postCommandsSent || answerSent || liveScenario.askRenderedRe.test(stripAnsi(raw))) return;
            if (!missingRequiredAskRecoverySent) {
                missingRequiredAskRecoverySent = true;
                missingRequiredAskRecoveryPlainOffset = stripAnsi(raw).length;
                console.warn(
                    '[terminal-live] cenário canônico: deltas públicos concluídos sem ask_user; enviando continuação controlada.',
                );
                write(buildMissingRequiredAskRecoveryPrompt(liveScenario));
                return;
            }
            postCommandsSent = true;
            console.warn(
                '[terminal-live] cenário canônico: ask_user obrigatório continuou ausente após recuperação; coletando diagnósticos.',
            );
            const diagnostics = [
                '/activity 40',
                '/intent 5',
                '/intent detail 5',
                '/tools diag',
                '/events 60',
                '/events 100 --raw',
                '/errors 10',
                '/health full',
                `/export ${exportArg}`,
            ];
            startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: diagnostics.length * 2_000 });
        }, Math.max(0, delayMs));
        missingRequiredAskDiagnosticTimer.unref();
    };
    const sendIncompleteExpectedToolRecovery = (incomplete) => {
        if (postCommandsSent || answerSent || incompleteExpectedToolRecoverySent || !incomplete) return;
        incompleteExpectedToolRecoverySent = true;
        console.warn(
            `[terminal-live] cenário canônico: tools esperadas incompletas (${incomplete.missing.join(', ')}); enviando continuação controlada.`,
        );
        write(buildIncompleteExpectedToolRecoveryPrompt(liveScenario, incomplete.missing));
    };
    const scheduleIncompleteExpectedToolDiagnostics = (incomplete) => {
        if (postCommandsSent || !incomplete) return;
        postCommandsSent = true;
        console.warn(
            `[terminal-live] cenário canônico: ask_user apareceu com tools obrigatórias incompletas (${incomplete.missing.join(', ')}); coletando diagnósticos sem responder automaticamente.`,
        );
        const diagnostics = [
            '/activity 40',
            '/intent 5',
            '/intent detail 5',
            '/tools diag',
            '/events 80',
            '/events 120 --raw',
            '/errors 10',
            '/health full',
            `/export ${exportArg}`,
        ];
        startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: diagnostics.length * 2_000 });
    };
    const scheduleDivergentAskDiagnostics = (divergentAsk) => {
        if (postCommandsSent || !divergentAsk) return;
        postCommandsSent = true;
        console.warn(
            `[terminal-live] cenário canônico: ask_user divergiu da pergunta esperada; esperado="${divergentAsk.expected}" observado="${divergentAsk.observed}".`,
        );
        const diagnostics = [
            '/activity 40',
            '/intent 5',
            '/tools diag',
            '/events 80',
            '/events 120 --raw',
            '/errors 10',
            '/health full',
            `/export ${exportArg}`,
        ];
        startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: diagnostics.length * 2_000 });
    };
    const invalidChoiceFeedbackRe =
        /Resposta\s+não corresponde às opções da pergunta pendente|Resposta\s+inválida para a pergunta pendente|invalid_choice/iu;
    function handleRunnerTimeout() {
        timedOut = true;
        byokNoPrCanQuit = true;
        const scenarioTailPlain = scenarioSent ? stripAnsi(raw).slice(scenarioPlainOffset) : '';
        const endedBeforeAsk =
            scenarioSent &&
            !answerSent &&
            !postCommandsSent &&
            findAssistantEndedBeforeRequiredAsk(scenarioTailPlain, liveScenario, sseCollector?.events ?? []);
        if (endedBeforeAsk) {
            scheduleMissingRequiredAskDiagnostics({ delayMs: 0 });
            return;
        }
        if (answerSent && !postCommandsSent) {
            schedulePostAnswerDiagnostics(0);
            scheduleForcedKill(Math.max(20_000, postAnswerDelayMs + 12_000));
            return;
        }
        if (scenarioSent && scheduleScenarioTimeoutDiagnostics()) {
            return;
        }
        write('/quit');
        scheduleForcedKill(2_000);
    }
    /**
     * @param {number} delayMs
     * @param {string} stage
     */
    function armRunnerTimeout(delayMs, stage) {
        if (timeout) clearTimeout(timeout);
        timeoutStage = stage;
        timeoutBudgetMs = Math.max(1_000, Math.trunc(delayMs));
        timeout = setTimeout(handleRunnerTimeout, timeoutBudgetMs);
        timeout.unref();
    }
    const sendScenarioAnswerStep = (plain, step) => {
        if (!step) return;
        answerSequenceStarted = true;
        answerStepIndex += 1;
        lastAnswerStepPlainOffset = plain.length;
        const isFinalAnswer = answerStepIndex >= liveScenario.answerSteps.length;
        if (isFinalAnswer) {
            answerSent = true;
            answerPlainOffset = plain.length;
            armRunnerTimeout(
                Math.max(60_000, postAskContinuationWaitMs + postAnswerDelayMs + 30_000),
                'post-ask-continuation',
            );
        }
        setTimeout(() => write(step.answer), Math.max(0, Number(step.delayMs ?? 500))).unref();
    };
    /** @type {NodeJS.Timeout | null} */
    let timeout = null;
    armRunnerTimeout(timeoutBudgetMs, 'scenario');

    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        raw += text;
        process.stdout.write(text);
        const plain = stripAnsi(raw);
        if (
            waitingForPromptBeforeSynchronizedCommand &&
            hasReturnedToReplPrompt(plain, promptSynchronizedCommandOutputOffset)
        ) {
            sendNextPromptSynchronizedCommand();
        }
        if (
            waitingForPromptSynchronizedCommand &&
            hasReturnedToReplPrompt(plain, promptSynchronizedCommandOutputOffset)
        ) {
            sendNextPromptSynchronizedCommand();
        }
        if (
            pendingByokLiveProtocolDiagnostics &&
            !postCommandsSent &&
            hasReturnedToReplPrompt(plain, scenarioPlainOffset)
        ) {
            pendingByokLiveProtocolDiagnostics = false;
            scheduleByokLiveProtocolDiagnostics();
        }
        if (
            askBeforeDeltasDiagnosticsPendingAfterAnswer &&
            hasReturnedToNormalReplPrompt(plain, askBeforeDeltasAnswerPlainOffset)
        ) {
            askBeforeDeltasDiagnosticsPendingAfterAnswer = false;
            console.warn('[terminal-live] cenário canônico: coletando diagnósticos após liberar prompt de pergunta.');
            sendAskBeforeDeltasDiagnostics();
        }
        if (/Modo headless detectado/.test(plain) && !canUsePty && !readySent) {
            console.warn(
                '[terminal-live] terminal entrou em modo headless; comandos REPL não serão exercitados neste transporte.',
            );
        }
        if (!readySent && /LLM-B pronta/.test(plain)) {
            readySent = true;
            if (collectSse) {
                sseCollector = startSseCollector({ port: Number.isFinite(ssePort) ? ssePort : terminalPort });
            }
            if (autoControlProbe) {
                startPromptSynchronizedCommandSequence(buildAutoProbeCommands({ profile: autoProbeProfile }));
                return;
            }
            if (modelControlProbe) {
                startPromptSynchronizedCommandSequence(buildModelProbeCommands());
                return;
            }
            if (byokControlProbe || noPr || byokReal) {
                const commands = byokReal
                    ? [
                          '/usage now',
                          '/activity 12',
                          ...buildByokRealPreflightCommands(realByok ?? {}),
                          ...(noPr ? buildByokRealNoPrDiagnosticCommands() : []),
                      ]
                    : byokControlProbe
                      ? [
                            '/usage now',
                            '/activity 12',
                            ...buildByokProbeCommands({ fixtureBaseUrl: byokFixtureBaseUrl }),
                        ]
                      : ['/usage now', '/activity 12', ...buildNoPrProbeCommands()];
                startPromptSynchronizedCommandSequence(commands, () => {
                    if (byokReal && noPr) {
                        if (!quitSent) {
                            quitSent = true;
                            byokNoPrCanQuit = true;
                            write('/quit');
                        }
                        return;
                    }
                    if (byokReal && !noPr) {
                        if (findByokRealPreflightProbeFailure(stripAnsi(raw))) {
                            scheduleByokPreflightDiagnostics();
                            return;
                        }
                        scenarioPlainOffset = stripAnsi(raw).length;
                        scenarioSent = true;
                        write(buildScenarioPrompt(liveScenario));
                    }
                });
                return;
            }
            startPromptSynchronizedCommandSequence(['/usage now', '/activity 12'], () => {
                scenarioPlainOffset = stripAnsi(raw).length;
                scenarioSent = true;
                write(buildScenarioPrompt(liveScenario));
            });
        }
        if (
            !answerSent &&
            answerStepIndex === 0 &&
            !liveScenario.askRenderedRe.test(plain) &&
            hasHumanQuestionInputPrompt(plain)
        ) {
            const divergentAsk = findDivergentScenarioAsk(plain, liveScenario);
            if (divergentAsk) {
                scheduleDivergentAskDiagnostics(divergentAsk);
                return;
            }
        }
        if (
            !answerSent &&
            answerStepIndex === 0 &&
            liveScenario.askRenderedRe.test(plain) &&
            hasHumanQuestionInputPrompt(plain)
        ) {
            if (findAskBeforeRequiredPublicDeltas(sseCollector?.events ?? [], liveScenario)) {
                scheduleAskBeforeDeltasDiagnostics();
                return;
            }
            const incompleteExpectedTools = findIncompleteExpectedToolChain(sseCollector?.events ?? [], liveScenario);
            if (incompleteExpectedTools) {
                scheduleIncompleteExpectedToolDiagnostics(incompleteExpectedTools);
                return;
            }
            if (missingRequiredAskDiagnosticTimer) {
                clearTimeout(missingRequiredAskDiagnosticTimer);
                missingRequiredAskDiagnosticTimer = null;
            }
            sendScenarioAnswerStep(plain, liveScenario.answerSteps[0]);
        }
        if (
            answerSequenceStarted &&
            !answerSent &&
            answerStepIndex < liveScenario.answerSteps.length &&
            invalidChoiceFeedbackRe.test(plain)
        ) {
            sendScenarioAnswerStep(plain, liveScenario.answerSteps[answerStepIndex]);
        }
        const afterLastAnswerStepPlain = lastAnswerStepPlainOffset > 0 ? plain.slice(lastAnswerStepPlainOffset) : '';
        if (
            answerSequenceStarted &&
            !answerSent &&
            answerStepIndex > 0 &&
            answerStepIndex < liveScenario.answerSteps.length &&
            liveScenario.askRenderedRe.test(afterLastAnswerStepPlain) &&
            hasHumanQuestionInputPrompt(afterLastAnswerStepPlain)
        ) {
            sendScenarioAnswerStep(plain, liveScenario.answerSteps[answerStepIndex]);
        }
        const afterAnswerPlain = answerSent ? plain.slice(answerPlainOffset) : '';
        if (answerSent && !postAskContinuationObserved && liveScenario.postAskFinalRe.test(afterAnswerPlain)) {
            postAskContinuationObserved = true;
        }
        if (postAskContinuationObserved && !postCommandsSent && TURN_SETTLED_AFTER_ASK_RE.test(afterAnswerPlain)) {
            schedulePostAnswerDiagnostics(500);
        }
        if (answerSent && !postCommandsSent && /Resposta\s+enviada para pergunta pendente/.test(plain)) {
            postAnswerCommandTimer = setTimeout(
                () => {
                    schedulePostAnswerDiagnostics(0);
                },
                Math.max(1_000, postAskContinuationWaitMs),
            ).unref();
        }
        const scenarioTailPlain = scenarioSent ? plain.slice(scenarioPlainOffset) : '';
        if (
            scenarioSent &&
            !answerSent &&
            !postCommandsSent &&
            !incompleteExpectedToolRecoverySent &&
            /Turno conclu[ií]do\s+tools executadas; a LLM-B não emitiu síntese pública/iu.test(scenarioTailPlain) &&
            hasReturnedToNormalReplPrompt(plain, scenarioPlainOffset)
        ) {
            sendIncompleteExpectedToolRecovery(findIncompleteExpectedToolChain(sseCollector?.events ?? [], liveScenario));
        }
        if (
            byokReal &&
            !answerSent &&
            !postCommandsSent &&
            findByokRealLiveToolProtocolMiss(scenarioTailPlain, liveScenario)
        ) {
            pendingByokLiveProtocolDiagnostics = true;
        }
        if (
            scenarioSent &&
            !answerSent &&
            !postCommandsSent &&
            (!missingRequiredAskRecoverySent
                ? findAssistantEndedBeforeRequiredAsk(scenarioTailPlain, liveScenario, sseCollector?.events ?? [])
                : findAssistantEndedAfterAskRecoveryWithoutAsk(
                      plain.slice(missingRequiredAskRecoveryPlainOffset),
                      liveScenario,
                  ))
        ) {
            scheduleMissingRequiredAskDiagnostics();
        }
        if (
            !postCommandsSent &&
            (/Erro de sessão \[(?:query|rate_limit)\]|You've hit your rate limit|session\.error|CAPIError|Failed to get response from the AI model|Rota BYOK\s+rota BYOK ficou sem resposta/i.test(
                scenarioTailPlain,
            ) ||
                /erro de provider BYOK|\[cancellation\]\s+Operation cancelled by user|Turno não enviado ao provider BYOK|terminal\.byok\.admission_blocked|Turno\s+(?:terminou\s+)?sem saída pública|Turno vazio/i.test(
                    scenarioTailPlain,
                )) &&
            !(byokReal && noPr) &&
            (!byokReal || scenarioSent)
        ) {
            postCommandsSent = true;
            if (postAnswerCommandTimer) {
                clearTimeout(postAnswerCommandTimer);
                postAnswerCommandTimer = null;
            }
            setTimeout(() => {
                const diagnostics = ['/activity 40', '/tools diag', '/health full'];
                if (byokReal) {
                    diagnostics.push('/byok providers', '/byok health', '/byok recommend reasoning safe 8');
                }
                diagnostics.push('/events 60', '/events 100 --raw', '/errors 10', `/export ${exportArg}`);
                startDiagnosticCommandSequenceThenQuit(diagnostics, { forceKillDelayMs: diagnostics.length * 2_000 });
            }, 1_000).unref();
        }
        if (!quitSent && /(?:^|\n)\s*Exportado\s+/u.test(plain)) {
            quitSent = true;
            byokNoPrCanQuit = true;
            setTimeout(() => write('/quit'), 500).unref();
        }
        if (
            byokReal &&
            noPr &&
            !quitSent &&
            /Métricas da Sessão/.test(plain) &&
            /Eventos SSE/.test(plain) &&
            /Nenhum erro recente/.test(plain)
        ) {
            quitSent = true;
            byokNoPrCanQuit = true;
            setTimeout(() => write('/quit'), 500).unref();
        }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
            childClosed = true;
            resolve(code);
        });
    });
    clearTimeout(timeout);
    if (forcedKillTimer) clearTimeout(forcedKillTimer);
    sseCollector?.close();
    await byokFixtureProvider?.close();

    const plain = stripAnsi(raw);
    const sseSummary = sseCollector?.summary() ?? {
        connected: false,
        statusCode: null,
        eventCount: 0,
        eventsWithId: 0,
        eventsWithSource: 0,
        eventsWithTraceId: 0,
        traceIds: [],
        errors: collectSse ? ['collector-not-started'] : [],
        events: [],
        raw: '',
        disabled: !collectSse,
    };
    const blocker =
        noPr || byokControlProbe || autoControlProbe || modelControlProbe
            ? null
            : detectLiveBlocker(plain, {
                  timedOut,
                  timeoutStage,
                  timeoutBudgetMs,
                  answerSent,
                  postAskContinuationObserved,
                  postCommandsSent,
                  sseEvents: sseSummary.events,
                  liveScenario,
              });
    const evaluateScenarioWithBlocker = shouldEvaluateScenarioDespiteBlocker(blocker);
    const exportSummary =
        noPr || byokControlProbe || autoControlProbe || modelControlProbe || (blocker && !evaluateScenarioWithBlocker)
            ? null
            : await inspectExportedMarkdown(exportPath, liveScenario);
    const baseCriteria = blocker
        ? evaluateScenarioWithBlocker
            ? [
                  ...evaluateOutput(plain, sseSummary, exportSummary, liveScenario),
                  ...(blocker.id === 'assistant-empty-after-user-input'
                      ? [evaluateEmptyAfterUserInputRecoveryVisible(plain)]
                      : []),
                  {
                      id: `blocked-by-${blocker.id}`,
                      pass: false,
                      detail: blocker.detail,
                  },
              ]
            : evaluateBlockedOutput(plain, sseSummary, blocker)
        : autoControlProbe
          ? evaluateAutoProbeOutput(plain, sseSummary, { profile: autoProbeProfile })
          : modelControlProbe
            ? evaluateModelProbeOutput(plain, sseSummary)
            : byokControlProbe
              ? evaluateByokProbeOutput(plain, sseSummary, { fixture: byokFixture })
              : noPr
                ? evaluateNoPrOutput(plain, sseSummary)
                : evaluateOutput(plain, sseSummary, exportSummary, liveScenario);
    const criteria = [
        ...baseCriteria,
        ...(byokReal
            ? evaluateByokRealOutput(plain, secretValues, {
                  ...(realByok ?? {}),
                  noPr,
                  requireVisionProbe: byokRealRequireVisionProbe,
                  liveScenario,
              })
            : []),
    ];
    const durationMs = Date.now() - Date.parse(startedAt);
    const liveHealthRecord = await recordByokLiveProtocolHealth({
        realByok,
        blocker,
        criteria,
        plain,
        startedAt,
        durationMs,
        noPr,
        byokControlProbe,
    });
    const preliminaryLiveScenarioRunRecord = await recordLiveScenarioRunToSqlite({
        criteria,
        startedAt,
        durationMs,
        exitCode,
        blocker,
        scenarioKind,
        outDir,
        mdPath,
        rawPath,
        plainPath,
        sseJsonlPath,
        transport,
    });
    const provisionalCriteria = [
        ...criteria,
        {
            id: 'live-scenario-run-recorded',
            pass: preliminaryLiveScenarioRunRecord.recorded === true,
            detail: preliminaryLiveScenarioRunRecord.recorded
                ? `SQLite live scenario run recorded as ${preliminaryLiveScenarioRunRecord.runId}`
                : `SQLite live scenario run not recorded: ${preliminaryLiveScenarioRunRecord.reason ?? 'unknown'}`,
        },
    ];
    const liveScenarioRunRecord =
        preliminaryLiveScenarioRunRecord.recorded === true
            ? await recordLiveScenarioRunToSqlite({
                  criteria: provisionalCriteria,
                  startedAt,
                  durationMs,
                  exitCode,
                  blocker,
                  scenarioKind,
                  outDir,
                  mdPath,
                  rawPath,
                  plainPath,
                  sseJsonlPath,
                  transport,
              })
            : preliminaryLiveScenarioRunRecord;
    const finalCriteria =
        preliminaryLiveScenarioRunRecord.recorded === true && liveScenarioRunRecord.recorded !== true
            ? [
                  ...criteria,
                  {
                      id: 'live-scenario-run-recorded',
                      pass: false,
                      detail: `SQLite live scenario run final update failed: ${liveScenarioRunRecord.reason ?? 'unknown'}`,
                  },
              ]
            : provisionalCriteria;
    await writeFile(rawPath, raw, 'utf8');
    await writeFile(plainPath, plain, 'utf8');
    await writeFile(sseRawPath, sseSummary.raw, 'utf8');
    await writeFile(
        sseJsonlPath,
        `${sseSummary.events.map((evt) => JSON.stringify(evt)).join('\n')}${sseSummary.events.length ? '\n' : ''}`,
        'utf8',
    );
    await writeFile(
        jsonPath,
        `${JSON.stringify(
            {
                ok: allRequiredCriteriaPassed(finalCriteria),
                requiredOk: allRequiredCriteriaPassed(finalCriteria),
                blocked: Boolean(blocker),
                blocker,
                startedAt,
                durationMs,
                exitCode,
                scenarioKind,
                liveScenario: {
                    id: liveScenario.id,
                    description: liveScenario.description,
                    askQuestion: liveScenario.askQuestion,
                    finalMarker: liveScenario.finalMarker,
                    invalidChoiceExpected: liveScenario.invalidChoiceExpected,
                },
                criteria: finalCriteria,
                sse: sseSummary,
                byokReal: realByok?.redacted ?? null,
                sdkSessionBootSelection,
                liveHealthRecord,
                liveScenarioRunRecord,
                export: exportSummary
                    ? {
                          ok: exportSummary.ok,
                          detail: exportSummary.detail,
                          hasTranscript: exportSummary.hasTranscript,
                          hasStreamingDiagnostics: exportSummary.hasStreamingDiagnostics,
                          hasEnvelope: exportSummary.hasEnvelope,
                          hasAskUser: exportSummary.hasAskUser,
                          hasAskUserAnswer: exportSummary.hasAskUserAnswer,
                          hasPostAskFinal: exportSummary.hasPostAskFinal,
                          path: path.relative(ROOT, exportPath),
                      }
                    : null,
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
    await writeFile(
        mdPath,
        buildReport({
            criteria: finalCriteria,
            durationMs,
            exitCode,
            blocker,
            outputPath: path.relative(ROOT, rawPath),
            plainOutputPath: path.relative(ROOT, plainPath),
            exportPath: noPr || byokProbe || autoProbe ? null : path.relative(ROOT, exportPath),
            exportSummary,
            sseRawPath: path.relative(ROOT, sseRawPath),
            sseJsonlPath: path.relative(ROOT, sseJsonlPath),
            sseSummary,
            startedAt,
            transport,
            liveHealthRecord,
            liveScenarioRunRecord,
            sdkSessionBootSelection,
            liveScenario,
        }),
        'utf8',
    );
    if (realByok) {
        await writeFile(
            path.join(outDir, 'byok.real.redacted.json'),
            `${JSON.stringify(realByok.redacted, null, 2)}\n`,
            'utf8',
        );
    }
    const failed = finalCriteria.filter(isHardCriterionFailure);
    console.log(`[terminal-live] summary: ${path.relative(ROOT, mdPath)}`);
    if (failed.length > 0 || exitCode !== 0) {
        console.error(
            `[terminal-live] ${blocker ? 'BLOCKED' : 'FAIL'}: ${failed.map((criterion) => criterion.id).join(', ') || 'exitCode'}`,
        );
        process.exitCode = 1;
    }
}

function isDirectCliInvocation() {
    const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
    return import.meta.url === entrypoint;
}

if (isDirectCliInvocation()) {
    await main();
}
