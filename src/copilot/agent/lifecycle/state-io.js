// @ts-check
/**
 * src/copilot/agent/lifecycle/state-io.js
 *
 * I/O de estado persistido do Always-Alive Agent. Centraliza leitura, escrita e remoção do snapshot
 * `sdk-always-alive.json` em `.github/hooks/state/`.
 *
 * Separado de `session-manager.js` para isolar responsabilidades: este módulo não conhece a lógica de sessão SDK —
 * apenas serializa e desserializa o estado.
 *
 * @module copilot/agent/lifecycle/state-io
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/agent/session/initializer
 */

import { logSwallowed, toError } from '#copilot/core';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DRAIN_WRITES_TIMEOUT_MS, STATE_FILE as _STATE_FILE_ENV } from '../../config/agent.js';
import { safeJsonParse } from '../../core/safe-json.js';
import { AliveAgentStateSchema } from '../../core/schemas.js';
import { withAgentErrorPolicy } from '../error-policy.js';
import { log } from '../ports/observability-port.js';

const ROOT = resolve(import.meta.dirname, '../../');
const STATE_DIR = join(ROOT, '.github', 'hooks', 'state');
// G2-DX-14: STATE_FILE path configurável via AGENT_STATE_FILE env var.
const STATE_FILE = _STATE_FILE_ENV ? resolve(_STATE_FILE_ENV) : join(STATE_DIR, 'sdk-always-alive.json');

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
 * @property {{
 *     kind: import('../types.js').PendingQuestionKind;
 *     askedAt: number;
 *     allowFreeform: boolean;
 *     protocolControlled: boolean;
 *     choices?: string[];
 * } | null} [pendingQuestionMeta]
 *   - Metadados semânticos da pergunta pendente
 *
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
 * @property {boolean} [gracefulShutdown] - F56.1: true se o último shutdown foi graceful (via stop()); false se
 *   crash/reboot
 * @property {number} [lastAskUserAt] - F56.2: timestamp do último ask_user recebido (ms)
 */

// ─── Cache in-process ────────────────────────────────────────────────────────

/**
 * Cache in-process para evitar readFileSync no hot path. Invalidado em `writeState`, `writeStateAsync` e `clearState`.
 *
 * @type {AliveAgentState | null}
 */
let _stateCache = null;

/**
 * Promise compartilhada da leitura assíncrona em voo. Evita múltiplos readers parseando/removendo o mesmo snapshot
 * corrompido durante o boot.
 *
 * @type {Promise<AliveAgentState | null> | null}
 */
let _readStatePromise = null;

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
 * @type {Promise<void>}
 */
let _writeQueue = Promise.resolve();

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lê o estado persistido do agente da sessão em disco.
 *
 * Retorna o cache in-process quando disponível. Se o cache estiver frio, dispara readStateAsync() internamente e
 * retorna null (o cache será populado para a próxima chamada).
 *
 * Acesso síncrono ao cache — use em contextos onde `await` não é possível (construtores, getters). Para hot paths ou
 * primeira leitura, prefira {@link readStateAsync}.
 *
 * @returns {AliveAgentState | null} Estado em cache ou null se indisponível
 */
export function readState() {
    if (_stateCache !== null) return _stateCache;
    if (_readStatePromise === null) {
        // F52: em vez de readFileSync, dispara async load e retorna null
        readStateAsync().catch((e) => logSwallowed(e, 'stateIo.readState.asyncFallback'));
    }
    return null;
}

/**
 * Persiste o estado da sessão em disco (shim síncrono).
 *
 * F52: Delega para writeStateAsync internamente. Atualiza _stateCache imediatamente para manter consistência síncrona,
 * mas a escrita real em disco é async.
 *
 * Shim síncrono — atualiza o cache imediatamente e dispara escrita async em background. Para controle de erro na
 * escrita, prefira {@link writeStateAsync}.
 *
 * @param {Partial<AliveAgentState>} updates - Campos a atualizar
 * @returns {AliveAgentState} Estado completo após a atualização (do cache)
 */
export function writeState(updates) {
    const current = _stateCache ?? _defaultState();
    const next = /** @type {AliveAgentState} */ ({ ...current, ...updates });
    _stateCache = next;
    // Dispara escrita async via mutex serial
    writeStateAsync(updates).catch((e) => logSwallowed(e, 'stateIo.writeState.asyncFallback'));
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
    const resultPromise = _writeQueue
        .then(() => _doWriteState(updates))
        .catch((err) => {
            log('WARN', `[PersistentSession] writeStateAsync retry após falha: ${err?.message ?? err}`);
            return _doWriteState(updates);
        });

    _writeQueue = resultPromise.then(
        () => undefined,
        () => undefined,
    );

    return resultPromise;
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
    const current = (await readStateAsync()) ?? _defaultState();
    const next = /** @type {AliveAgentState} */ ({ ...current, ...updates });
    await writeFile(STATE_FILE, JSON.stringify(next, null, 4), 'utf8');
    _stateCache = next;
    return next;
}

/**
 * Remove o estado persistido e invalida o cache.
 *
 * Shim síncrono — invalida cache e dispara remoção async em background. Para controle de erro na remoção, prefira
 * {@link clearStateAsync}.
 *
 * @returns {void}
 */
export function clearState() {
    _stateCache = null;
    _readStatePromise = null;
    _stateDirReady = false;
    _writeQueue = Promise.resolve();
    clearStateAsync().catch((e) => logSwallowed(e, 'stateIo.clearState.asyncFallback'));
}

/**
 * F91: Versão async de readState — usa fs/promises.
 *
 * Retorna o cache in-process quando disponível, evitando I/O desnecessário.
 *
 * @returns {Promise<AliveAgentState | null>} Estado persistido ou null se o arquivo não existir
 */
export async function readStateAsync() {
    if (_stateCache !== null) return _stateCache;
    if (_readStatePromise) return _readStatePromise;

    _readStatePromise = (async () => {
        try {
            await stat(STATE_FILE);
        } catch {
            return null;
        }
        try {
            const raw = await readFile(STATE_FILE, 'utf8');
            const parseResult = safeJsonParse(raw, '[PersistentSession/readStateAsync]');
            if (!parseResult.ok) {
                log('WARN', '[PersistentSession] Estado corrompido (JSON inválido) — removendo arquivo e reiniciando.');
                try {
                    await rm(STATE_FILE, { force: true });
                } catch (e) {
                    logSwallowed(e, 'stateIo.readStateAsync.rmCorrupt');
                }
                return null;
            }
            const result = AliveAgentStateSchema.safeParse(parseResult.data);
            if (!result.success) {
                log('WARN', '[PersistentSession] Estado inválido (schema validation failed) — ignorando ficheiro.');
                return null;
            }
            _stateCache = /** @type {AliveAgentState} */ (result.data);
            return _stateCache;
        } catch (e) {
            log(
                'WARN',
                `[PersistentSession] Estado corrompido (${toError(e).message}) — removendo arquivo e reiniciando.`,
            );
            try {
                await rm(STATE_FILE, { force: true });
            } catch (e) {
                logSwallowed(e, 'stateIo.readStateAsync.rmCorruptOuter');
            }
            return null;
        }
    })();

    try {
        return await _readStatePromise;
    } finally {
        _readStatePromise = null;
    }
}

/**
 * F91: Versão async de clearState — usa fs/promises.
 *
 * Remove o estado persistido e invalida o cache. Força uma nova sessão SDK na próxima inicialização.
 *
 * @returns {Promise<void>}
 */
export async function clearStateAsync() {
    try {
        await rm(STATE_FILE, { force: true });
        log('INFO', '[PersistentSession] Estado removido (async) — próxima inicialização criará nova sessão.');
    } catch (e) {
        logSwallowed(e, 'stateIo.clearStateAsync.rm');
    }
    _stateCache = null;
    _readStatePromise = null;
    _stateDirReady = false;
    _writeQueue = Promise.resolve();
}

/**
 * Aguarda que todos os writes assíncronos pendentes sejam concluídos (ou que o timeout expire). BUG-AGENT-006: usar
 * antes de process.exit para garantir que state.json não seja corrompido.
 *
 * @param {number} [timeoutMs=3000] - Timeout máximo em ms. Default is `3000`
 * @returns {Promise<void>}
 */
export async function drainStateWrites(timeoutMs = DRAIN_WRITES_TIMEOUT_MS) {
    await Promise.race([
        _writeQueue.catch((e) => logSwallowed(e, 'stateIo.drainWrites')),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
}

/**
 * Persiste estado usando a policy canônica do `agent`, registrando contexto operacional estruturado.
 *
 * @param {Partial<AliveAgentState>} data - Dados parciais a persistir
 * @param {{ label?: string }} [opts]
 * @returns {Promise<import('../error-policy.js').AgentPolicyResult<AliveAgentState>>}
 */
export async function persistStateWithPolicy(data, opts = {}) {
    const label = opts.label ?? 'state.persist';
    return withAgentErrorPolicy(() => writeStateAsync(data), {
        onError: (error, disposition) => {
            const level = disposition === 'fatal' ? 'ERROR' : 'WARN';
            log(level, `[PersistentSession] ${label}: ${error.message}`);
        },
    });
}

/**
 * Fire-and-forget wrapper: chama `writeStateAsync(data)` e loga warnings em caso de falha.
 *
 * Evita repetir o boilerplate `.catch((e) => log('WARN', ...))` em ~14 call sites.
 *
 * @param {Partial<AliveAgentState>} data - Dados parciais a persistir
 * @param {string} tag - Tag identificadora para o log de warning (ex.: `'[AlwaysAlive] gracefulShutdown'`)
 * @returns {void}
 */
export function persistState(data, tag) {
    void persistStateWithPolicy(data, { label: tag });
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
        model: 'gpt-5-mini',
        pendingQuestion: null,
        pendingQuestionMeta: null,
    };
}
