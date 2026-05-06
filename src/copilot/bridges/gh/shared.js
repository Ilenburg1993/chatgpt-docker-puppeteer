// @ts-check
/**
 * src/copilot/bridges/gh/shared.js
 *
 * Helpers internos compartilhados pelos módulos do GitHub CLI bridge.
 *
 * @module copilot/bridges/gh/shared
 * @see EventBus
 */

import { LLM_B_GH_DEFAULT_REPO, LLM_B_GH_TIMEOUT_MS } from '#copilot/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Timeout histórico para chamadas ao gh CLI (ms), mantido apenas como telemetria/advisory. */
const ADVISORY_DEFAULT_TIMEOUT_MS = LLM_B_GH_TIMEOUT_MS;

/** Repo padrão override (ex: "owner/repo"). Auto-detect se vazio. */
const ENV_REPO = LLM_B_GH_DEFAULT_REPO;

/**
 * Executa gh CLI com args, retorna stdout como string.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] Valor informativo; não encerra o comando.
 * @param {boolean} [opts.lenient] - se true, retorna string vazia em caso de erro
 * @returns {Promise<string>}
 */
export async function runGh(args, opts = {}) {
    void (opts.timeoutMs ?? ADVISORY_DEFAULT_TIMEOUT_MS);
    const { stdout } = await execFileAsync('gh', args, {
        maxBuffer: 1024 * 1024 * 1024,
    });
    return stdout.trim();
}

/**
 * Executa gh CLI e parseia saída como JSON.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @returns {Promise<unknown>} Resultado de JSON.parse da saída do `gh` CLI (tipo dinâmico por natureza)
 */
export async function runGhJson(args, opts = {}) {
    const raw = await runGh(args, opts);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Formata data ISO para string legível relativa ou absoluta.
 *
 * @param {string} isoDate
 * @returns {string}
 */
export function fmtDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `há ${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `há ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `há ${days}d`;
    return d.toLocaleDateString('pt-BR');
}

/**
 * Retorna ícone ANSI colorido de status de CI run.
 *
 * @param {string} status
 * @param {string | null} conclusion
 * @returns {string}
 */
export function runIcon(status, conclusion) {
    if (status === 'completed') {
        if (conclusion === 'success') return '✅';
        if (conclusion === 'failure') return '❌';
        if (conclusion === 'cancelled') return '🚫';
        if (conclusion === 'skipped') return '⏭️';
        if (conclusion === 'timed_out') return '⏱️';
        return '⚠️';
    }
    if (status === 'in_progress') return '⏳';
    if (status === 'queued') return '🔲';
    return '❓';
}

/**
 * Extrai args de repo se ENV_REPO estiver definido.
 *
 * @returns {string[]}
 */
export function repoArgs() {
    return ENV_REPO ? ['--repo', ENV_REPO] : [];
}

/**
 * Aplica paginação client-side sobre um array já carregado do gh CLI.
 *
 * @template T
 * @param {T[]} all - Array completo retornado pelo gh CLI
 * @param {{ page: number; pageSize: number }} pager
 * @returns {{ items: T[]; hasMore: boolean; page: number; perPage: number }}
 */
export function slicePage(all, { page, pageSize }) {
    const offset = (page - 1) * pageSize;
    return {
        items: all.slice(offset, offset + pageSize),
        hasMore: all.length > offset + pageSize,
        page,
        perPage: pageSize,
    };
}

/**
 * Calcula o limite de busca para paginação client-side.
 *
 * @param {{ page: number; pageSize: number }} pager
 * @returns {number}
 */
export function calcFetchLimit({ page, pageSize }) {
    return Math.min(pageSize * page + 1, 1000);
}
