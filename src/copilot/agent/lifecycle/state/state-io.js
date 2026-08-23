// @ts-check
/**
 * src/copilot/agent/lifecycle/state/state-io.js
 *
 * I/O de estado persistido do Always-Alive Agent. Centraliza leitura, escrita e remoção do snapshot
 * `sdk-always-alive.json` em `.github/hooks/state/`.
 *
 * Separado de `session-manager.js` para isolar responsabilidades: este módulo não conhece a lógica de sessão SDK —
 * apenas serializa e desserializa o estado.
 *
 * @module copilot/agent/lifecycle/state/state-io
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/agent/session/initializer
 */

import { DRAIN_WRITES_TIMEOUT_MS } from '#copilot/config/agent';
import { toError } from '#copilot/infra/public/platform/error';
import { parseJsonResult } from '#copilot/infra/public/platform/json';
import { withAgentErrorPolicy } from '../../error/index.js';
import { log } from '../../ports/logging/index.js';
import { logSwallowed } from '../../ports/logging/swallowed.js';
import { AliveAgentStateSchema } from '../../state/schemas/index.js';
import {
    readStateFileIfExists,
    removeStateFileIfExists,
    resetStateFileIoCache,
    writeStateFileJson,
} from './file/index.js';

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
 * @property {'low' | 'medium' | 'high' | 'xhigh' | undefined} [reasoningEffort] - Nível de reasoning efetivo conhecido;
 *   `undefined` limpa reasoning persistido quando a sessão atual não pode receber `reasoningEffort` do SDK.
 * @property {string | null} pendingQuestion - Texto da pergunta pendente do modelo, ou null
 * @property {{
 *     kind: import('../../types.js').PendingQuestionKind;
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
 * @property {string | null} [pendingTurnMessage] - Última mensagem enviada sem resposta confirmada
 * @property {number | null} [pendingTurnTs] - Timestamp do envio pendente (ms)
 * @property {boolean} [pendingTurnAdditionalModelCallObserved] - Marcador moderno de observação do lifecycle; não é uma
 *   unidade de billing.
 * @property {boolean} [pendingTurnConsumedPR] - Campo legacy preservado apenas para snapshots anteriores ao billing
 *   usage-based; novos eventos não o derivam de `assistant.usage`.
 * @property {number} [lastPrConsumedAt] - Campo legacy: timestamp do último snapshot request-based persistido.
 * @property {string} [lastPrModel] - Campo legacy do modelo request-based.
 * @property {string} [lastPrConfiguredModel] - Campo legacy do modelo configurado.
 * @property {string} [lastPrEffectiveModel] - Campo legacy do modelo efetivo.
 * @property {boolean} [lastPrModelMismatch] - Campo legacy de divergência de modelo.
 * @property {number} [lastPrCost] - Campo legacy de custo reportado pelo SDK antigo.
 * @property {Record<string, unknown> | null} [lastQuotaSnapshots] - Campo legacy de quota request-based.
 * @property {{
 *     boots?: number;
 *     resumesWithAdditionalModelCall?: number;
 *     resumesWithoutAdditionalModelCall?: number;
 *     totalModelCalls?: number;
 *     resumesWithPR?: number;
 *     resumesZeroPR?: number;
 *     totalPR?: number;
 * }} [usageMetrics]
 *   - Métricas canônicas de chamadas de modelo do lifecycle, com aliases legacy no próprio snapshot.
 *
 * @property {Record<string, unknown>} [prMetrics] - Alias persistido legacy de `usageMetrics` para leitores antigos.
 * @property {boolean} [gracefulShutdown] - F56.1: true se o último shutdown foi graceful (via stop()); false se
 *   crash/reboot
 * @property {number} [lastAskUserAt] - F56.2: timestamp do último ask_user recebido (ms)
 * @property {import('../../../config/system-prompt/freshness.js').SystemPromptBindingSnapshot | null} [systemPromptBinding]
 *   Binding persistido do system prompt aplicado à sessão SDK atual
 * @property {{
 *     enabled: true;
 *     profile: string | null;
 *     preset: string | null;
 *     providerType: string | null;
 *     baseUrl: string | null;
 *     model: string;
 * } | null} [byokSessionBinding]
 *   Identidade redigida do provider BYOK que criou/retomou a sessão SDK persistida. Nunca carrega segredos.
 * @property {{
 *     providerId: string;
 *     providerModel: string;
 *     providerType?: string | null;
 *     selectorSyntax?: string | null;
 *     baseUrl?: string | null;
 *     openAICompatibleBaseUrl?: string | null;
 *     openAICompatible?: boolean | null;
 *     wireApi?: string | null;
 *     providerProfile?: string | null;
 *     routeProfile?: string | null;
 *     selectedRouteKey?: string | null;
 *     bindingStrategy?: 'direct' | 'ingress' | 'blocked' | null;
 *     sdkRouteKey?: string | null;
 *     sdkVisibleModel?: string | null;
 *     directRebindReliability?: string | null;
 *     directRebindSupported?: boolean | null;
 *     directRebindReliable?: boolean | null;
 *     directConfigRepresentability?: string | null;
 *     requiredDirectHeaders?: string[];
 *     bindingCapabilities?: Record<string, unknown> | null;
 *     bindingDecision?: Record<string, unknown> | null;
 *     runtimeEvidence?: Record<string, unknown> | null;
 *     requiresIngress?: boolean;
 *     useIngress?: boolean;
 *     modelGatewayIngress?: boolean;
 *     requiresNewSession?: boolean;
 *     updatedAt: number;
 * } | null} [modelGatewayActiveRoute]
 *   Projeção redigida da rota que deve vincular a sessão atual. Credenciais continuam resolvidas por secret refs/env.
 * @property {{
 *     outcome: 'created' | 'resumed';
 *     requestedMode: 'auto' | 'new' | 'resume';
 *     selectedSessionId: string;
 *     resumeCandidateSessionId: string | null;
 *     reason: string;
 *     decidedAt: number;
 * } | null} [sdkSessionBootDecision]
 *   Decisão redigida do initializer para a sessão SDK atual. Explica por que houve resume ou criação sem guardar
 *   credenciais/provider headers.
 * @property {Record<string, Record<string, unknown>>} [sdkSessionLocalMetadata] Metadata local, redigida e por
 *   sessionId, para enriquecer o cockpit sem depender de APIs inexistentes como `session.updateMetadata`.
 * @property {{ mode: 'new'; requestedAt?: number } | { mode: 'resume'; sessionId: string; requestedAt?: number } | null} [nextSdkSessionBoot]
 *   Diretiva efêmera do operador para o próximo boot da sessão SDK; consumida pelo initializer.
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
 * Mutex serial para `writeStateAsync` — evita race conditions quando múltiplas escritas concorrentes lêem o estado
 * antes que qualquer escrita anterior seja concluída (G1-BUG-05).
 *
 * @type {Promise<void>}
 */
let _writeQueue = Promise.resolve();

/** FIX state-io Bug 1: contador de geração — detecta clearState() chamado durante write em voo. */
let _clearGen = 0;
let _pendingClearCount = 0;

/**
 * Enfileira toda mutação persistente para preservar uma ordem total entre write e clear.
 *
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
function enqueueStateMutation(operation) {
    const result = _writeQueue.then(operation);
    _writeQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

function beginStateClear() {
    _stateCache = null;
    _readStatePromise = null;
    resetStateFileIoCache();
    _clearGen += 1;
    _pendingClearCount += 1;
}

/**
 * @returns {Promise<void>}
 */
function enqueueStateClear() {
    return enqueueStateMutation(async () => {
        try {
            await removeStateFileIfExists();
            log('INFO', '[PersistentSession] Estado removido (async) — próxima inicialização criará nova sessão.');
        } catch (e) {
            logSwallowed(e, 'stateIo.clearStateAsync.rm');
        } finally {
            _stateCache = null;
            _readStatePromise = null;
            resetStateFileIoCache();
            _pendingClearCount = Math.max(0, _pendingClearCount - 1);
        }
    });
}

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
 * Persiste o estado da sessão em disco com wrapper síncrono de conveniência.
 *
 * F52: Delega para writeStateAsync internamente. Atualiza _stateCache imediatamente para manter consistência síncrona,
 * mas a escrita real em disco é async.
 *
 * Wrapper síncrono — atualiza o cache imediatamente e dispara escrita async em background. Para controle de erro na
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
    // FIX state-io Bug 2: retry original executava FORA do chain da fila serial (concorrente com próxima escrita).
    // Solução: mover try/retry para dentro do .then() — permanece serializado.
    return enqueueStateMutation(async () => {
        try {
            return await _doWriteState(updates);
        } catch (err) {
            log('WARN', `[PersistentSession] writeStateAsync retry após falha: ${toError(err).message}`);
            return _doWriteState(updates);
        }
    });
}

/**
 * Executa efetivamente a escrita assíncrona de estado (chamado dentro do mutex serial).
 *
 * @param {Partial<AliveAgentState>} updates
 * @returns {Promise<AliveAgentState>}
 */
async function _doWriteState(updates) {
    // FIX state-io Bug 1: capturar geração antes do I/O — se clearState() for chamado durante o write, não restaurar cache stale.
    const genAtStart = _clearGen;
    const current = (await readStateAsync()) ?? _defaultState();
    if (_clearGen !== genAtStart) {
        return _defaultState();
    }
    const next = /** @type {AliveAgentState} */ ({ ...current, ...updates });
    if (_clearGen !== genAtStart) {
        return _defaultState();
    }
    // FIX P0-4 (hardening): revalidar geração logo antes de escrever em disco para evitar persistência stale
    // se clearState() foi chamado após o locking do mutex
    if (_clearGen !== genAtStart) {
        log('INFO', '[PersistentSession] Escrita de estado cancelada — clearState() foi chamado durante a operação.');
        return _defaultState();
    }
    await writeStateFileJson(next);
    // Apenas restaurar cache se nenhuma limpeza ocorreu durante a escrita
    if (_clearGen === genAtStart) {
        _stateCache = next;
    }
    return next;
}

/**
 * Remove o estado persistido e invalida o cache.
 *
 * Wrapper síncrono — invalida cache e dispara remoção async em background. Para controle de erro na remoção, prefira
 * {@link clearStateAsync}.
 *
 * @returns {void}
 */
export function clearState() {
    beginStateClear();
    enqueueStateClear().catch((e) => logSwallowed(e, 'stateIo.clearState.asyncFallback'));
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
    if (_pendingClearCount > 0) return null;
    if (_readStatePromise) return _readStatePromise;

    _readStatePromise = (async () => {
        const raw = await readStateFileIfExists();
        if (raw === null) {
            return null;
        }
        try {
            const parseResult = parseJsonResult(raw, '[PersistentSession/readStateAsync]');
            if (!parseResult.ok) {
                log('WARN', '[PersistentSession] Estado corrompido (JSON inválido) — removendo arquivo e reiniciando.');
                try {
                    await removeStateFileIfExists();
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
                await removeStateFileIfExists();
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
    beginStateClear();
    await enqueueStateClear();
}

/**
 * Aguarda que todos os writes assíncronos pendentes sejam concluídos (ou que o timeout expire). BUG-AGENT-006: usar
 * antes de process.exit para garantir que state.json não seja corrompido.
 *
 * @param {number} [timeoutMs=3000] - Timeout máximo em ms. Default is `3000`
 * @returns {Promise<void>}
 */
export async function drainStateWrites(timeoutMs = DRAIN_WRITES_TIMEOUT_MS) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutHandle = null;
    try {
        await Promise.race([
            _writeQueue.catch((e) => logSwallowed(e, 'stateIo.drainWrites')),
            new Promise((resolve) => {
                timeoutHandle = setTimeout(resolve, timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
        }
    }
}

/**
 * Persiste estado usando a policy canônica do `agent`, registrando contexto operacional estruturado.
 *
 * @param {Partial<AliveAgentState>} data - Dados parciais a persistir
 * @param {{ label?: string }} [opts]
 * @returns {Promise<import('../../error/index.js').AgentPolicyResult<AliveAgentState>>}
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
        model: 'auto',
        pendingQuestion: null,
        pendingQuestionMeta: null,
        systemPromptBinding: null,
    };
}
