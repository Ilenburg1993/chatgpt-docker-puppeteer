// @ts-check
/**
 * src/copilot/agent/state-io.js
 *
 * I/O de estado persistido do Always-Alive Agent. Centraliza leitura, escrita e remoção do snapshot
 * `sdk-always-alive.json` em `.github/hooks/state/`.
 *
 * Separado de `session-manager.js` para isolar responsabilidades: este módulo não conhece a lógica de sessão SDK —
 * apenas serializa e desserializa o estado.
 *
 * @module copilot/agent/state-io
 */

import { log } from '#core/logger';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../');
const STATE_DIR = join(ROOT, '.github', 'hooks', 'state');
const STATE_FILE = join(STATE_DIR, 'sdk-always-alive.json');

// ─── Typedefs ────────────────────────────────────────────────────────────────

/**
 * Snapshot completo do estado persistido do agente entre reinicializações.
 *
 * @typedef {Object} AliveAgentState
 * @property {string} sessionId - ID da sessão SDK ativa
 * @property {number} startedAt - Timestamp de criação da sessão (ms)
 * @property {number} resumedAt - Timestamp da última retomada (ms)
 * @property {number} resumeCount - Número de retomadas bem-sucedidas desde a criação
 * @property {number} sendCount - Total de mensagens enviadas na sessão (tracking externo)
 * @property {string} model - Modelo configurado para esta sessão
 * @property {string | null} pendingQuestion - Texto da pergunta pendente do modelo, ou null
 * @property {boolean} [dialogLoopActive] - Se o dialog loop estava ativo no snapshot
 * @property {boolean} [dialogPaused] - `true` se pause explícito foi emitido via `pauseDialogLoop()`
 * @property {number} [pausedAt] - Timestamp do pause (ms)
 * @property {string} [pendingTurnMessage] - Última mensagem enviada sem resposta confirmada
 * @property {number} [pendingTurnTs] - Timestamp do envio pendente (ms)
 * @property {boolean} [pendingTurnConsumedPR] - Se `assistant.usage` já foi emitido para este turno
 * @property {number} [lastPrConsumedAt] - Timestamp do último PR consumido (ms)
 * @property {string} [lastPrModel] - Modelo que consumiu o último PR
 * @property {number} [lastPrCost] - Custo reportado pelo SDK no último PR
 * @property {any} [lastQuotaSnapshots] - Snapshots de cota do último `assistant.usage`
 */

// ─── Cache in-process ────────────────────────────────────────────────────────

/**
 * Cache in-process para evitar readFileSync no hot path. Invalidado em `writeState`, `writeStateAsync` e `clearState`.
 *
 * @type {AliveAgentState | null}
 */
let _stateCache = null;

/**
 * Flag para evitar chamadas redundantes a `mkdirSync`/`mkdir` após a primeira criação do diretório.
 *
 * @type {boolean}
 */
let _stateDirReady = false;

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lê o estado persistido do agente da sessão em disco.
 *
 * Retorna o cache in-process quando disponível, evitando I/O síncrono no hot path.
 *
 * @returns {AliveAgentState | null} Estado persistido ou null se o arquivo não existir
 */
export function readState() {
    if (_stateCache !== null) return _stateCache;
    if (!existsSync(STATE_FILE)) return null;
    try {
        _stateCache = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        return _stateCache;
    } catch (/** @type {any} */ e) {
        log('WARN', `[PersistentSession] Falha ao ler estado: ${e.message}`);
        return null;
    }
}

/**
 * Persiste o estado da sessão em disco (síncrono).
 *
 * Atualiza `_stateCache` após a escrita para que chamadas subsequentes a `readState()` não precisem de I/O adicional.
 * Preferir `writeStateAsync` em fluxos assíncronos para não bloquear o event loop.
 *
 * @param {Partial<AliveAgentState>} updates - Campos a atualizar no estado atual
 * @returns {AliveAgentState} Estado completo após a atualização
 */
export function writeState(updates) {
    if (!_stateDirReady) {
        mkdirSync(STATE_DIR, { recursive: true });
        _stateDirReady = true;
    }
    const current = readState() ?? _defaultState();
    const next = /** @type {AliveAgentState} */ ({ ...current, ...updates });
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 4), 'utf8');
    _stateCache = next;
    return next;
}

/**
 * Persiste o estado da sessão em disco (assíncrono).
 *
 * Preferir esta versão em handlers de alta frequência para não bloquear o event loop. Atualiza `_stateCache` após a
 * escrita para que chamadas subsequentes a `readState()` não precisem de I/O.
 *
 * @param {Partial<AliveAgentState>} updates - Campos a atualizar no estado atual
 * @returns {Promise<AliveAgentState>}
 */
export async function writeStateAsync(updates) {
    if (!_stateDirReady) {
        await mkdir(STATE_DIR, { recursive: true });
        _stateDirReady = true;
    }
    const current = readState() ?? _defaultState();
    const next = /** @type {AliveAgentState} */ ({ ...current, ...updates });
    await writeFile(STATE_FILE, JSON.stringify(next, null, 4), 'utf8');
    _stateCache = next;
    return next;
}

/**
 * Remove o estado persistido e invalida o cache. Força uma nova sessão SDK na próxima inicialização.
 *
 * @returns {void}
 */
export function clearState() {
    if (existsSync(STATE_FILE)) {
        rmSync(STATE_FILE);
        log('INFO', '[PersistentSession] Estado removido — próxima inicialização criará nova sessão.');
    }
    _stateCache = null;
    _stateDirReady = false;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Retorna o estado padrão para novas sessões.
 *
 * @returns {AliveAgentState}
 */
function _defaultState() {
    return {
        sessionId: '',
        startedAt: Date.now(),
        resumedAt: Date.now(),
        resumeCount: 0,
        sendCount: 0,
        model: 'gpt-4.1',
        pendingQuestion: null,
    };
}
