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
 * @see module:copilot/always-alive
 * @see module:copilot/session-initializer
 */

import { log } from '#copilot/observability/logger';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../');
const STATE_DIR = join(ROOT, '.github', 'hooks', 'state');
// G2-DX-14: STATE_FILE path configurável via AGENT_STATE_FILE env var.
const STATE_FILE = process.env['AGENT_STATE_FILE']
    ? resolve(process.env['AGENT_STATE_FILE'])
    : join(STATE_DIR, 'sdk-always-alive.json');

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
 * @property {Record<string, unknown> | null} [lastQuotaSnapshots] - Snapshots de cota do último `assistant.usage`
 * @property {{ boots?: number; resumesWithPR?: number; resumesZeroPR?: number; totalPR?: number }} [prMetrics] -
 *   Contadores de consumo de Premium Requests do dialog loop
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

/**
 * Mutex serial para `writeStateAsync` — evita race conditions quando múltiplas escritas concorrentes lêem o estado
 * antes que qualquer escrita anterior seja concluída (G1-BUG-05).
 *
 * @type {Promise<AliveAgentState>}
 */
let _writeQueue = Promise.resolve(/** @type {AliveAgentState} */ (/** @type {unknown} */ (null)));

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lê o estado persistido do agente da sessão em disco.
 *
 * Retorna o cache in-process quando disponível, evitando I/O síncrono no hot path.
 *
 * @example
 *     const state = readState();
 *     if (state) console.log(state.sessionId);
 *
 * @returns {AliveAgentState | null} Estado persistido ou null se o arquivo não existir
 */
export function readState() {
    if (_stateCache !== null) return _stateCache;
    if (!existsSync(STATE_FILE)) return null;
    try {
        const raw = readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        // G2-DX-15: validação mínima — rejeitar valores não-objeto para evitar falsos positivos
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            log('WARN', '[PersistentSession] Estado inválido (não é objeto) — ignorando ficheiro.');
            return null;
        }
        _stateCache = /** @type {AliveAgentState} */ (parsed);
        return _stateCache;
    } catch (/** @type {any} */ e) {
        log('WARN', `[PersistentSession] Estado corrompido (${e.message}) — removendo arquivo e reiniciando.`);
        try {
            rmSync(STATE_FILE, { force: true });
        } catch {
            // Ignorar falha de remoção — próxima leitura retornará null via existsSync
        }
        return null;
    }
}

/**
 * Persiste o estado da sessão em disco (síncrono).
 *
 * Atualiza `_stateCache` e reseta `_writeQueue` após a escrita para garantir consistência entre o path síncrono e o
 * mutex serial de `writeStateAsync`. Chamar `writeState()` enquanto há escritas async pendentes na fila as descarta — o
 * arquivo em disco já contém o estado mais recente após retorno desta função.
 *
 * Preferir `writeStateAsync` em fluxos assíncronos para não bloquear o event loop.
 *
 * @example
 *     writeState({ sessionId: 'abc-123', lastActive: Date.now() });
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
    // RACE-AGENT-003 fix: resetar o mutex para que escritas async subsequentes partam do
    // estado que acabou de ser commitado em disco, e não de uma snapshot anterior.
    _writeQueue = Promise.resolve(next);
    return next;
}

/**
 * Persiste o estado da sessão em disco (assíncrono).
 *
 * Preferir esta versão em handlers de alta frequência para não bloquear o event loop. Atualiza `_stateCache` após a
 * escrita para que chamadas subsequentes a `readState()` não precisem de I/O.
 *
 * G1-BUG-05 (fix): escritas são serializadas via mutex interno para evitar race condition quando múltiplas chamadas
 * concorrentes lêem o estado antes de qualquer escrita ser concluída.
 *
 * @param {Partial<AliveAgentState>} updates - Campos a atualizar no estado atual
 * @returns {Promise<AliveAgentState>}
 * @throws {Error} Se a escrita em disco falhar após retry interno
 */
export async function writeStateAsync(updates) {
    _writeQueue = _writeQueue
        .then(() => _doWriteState(updates))
        .catch((/** @type {any} */ err) => {
            log('WARN', `[PersistentSession] writeStateAsync retry após falha: ${err?.message ?? err}`);
            return _doWriteState(updates);
        });
    return _writeQueue;
}

/**
 * Executa efetivamente a escrita assíncrona de estado (chamado dentro do mutex serial).
 *
 * @param {Partial<AliveAgentState>} updates
 * @returns {Promise<AliveAgentState>}
 */
async function _doWriteState(updates) {
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
 * @example
 *     clearState(); // remove state.json e força nova sessão
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
    _writeQueue = Promise.resolve(/** @type {AliveAgentState} */ (/** @type {unknown} */ (null)));
}

/**
 * Aguarda que todos os writes assíncronos pendentes sejam concluídos (ou que o timeout expire). BUG-AGENT-006: usar
 * antes de process.exit para garantir que state.json não seja corrompido.
 *
 * @param {number} [timeoutMs=3000] - Timeout máximo em ms. Default is `3000`
 * @returns {Promise<void>}
 */
export async function drainStateWrites(timeoutMs = 3000) {
    await Promise.race([
        _writeQueue.then(() => undefined).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
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
