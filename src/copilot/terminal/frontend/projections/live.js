// @ts-check
/**
 * Projection family: live terminal flow.
 *
 * Consolida o estado operacional continuo do terminal a partir de fontes canônicas ja existentes: runtime/status,
 * activity, turn trace, timeline, I/O real e SSE. Este modulo nao executa operacoes; ele apenas projeta a UX.
 */

import { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from '../../../infra/sse/index.js';
import { readTerminalIoActivityProjection } from '../../events/index.js';
import { readTerminalActivityProjection, readTerminalDisplayProjection } from './now.js';
import { readTerminalStatusProjection } from './status.js';
import { readTerminalTimelineProjection } from './timeline.js';

/** @typedef {'offline' | 'paused' | 'waiting-human' | 'active-turn' | 'ready' | 'recovering'} TerminalLiveFlowState */

/**
 * @param {ReturnType<typeof readTerminalStatusProjection>} status
 * @returns {TerminalLiveFlowState}
 */
function resolveLiveFlowState(status) {
    const runtimeStatus = String(status.snap['status'] ?? 'unknown');
    const dialogPaused = Boolean(status.snap['dialogPaused']);
    if (dialogPaused) return 'paused';
    if (!status.dialogLoopActive && runtimeStatus !== 'starting') return 'offline';
    if (status.pendingQuestion && status.pendingQuestionKind !== 'ready') return 'waiting-human';
    if (status.dialogInputChannel.state === 'missing') return 'recovering';
    if (
        status.activity.phase === 'turn' ||
        status.activity.phase === 'thinking' ||
        status.activity.phase === 'streaming' ||
        status.activity.phase === 'tool'
    ) {
        return 'active-turn';
    }
    if (
        status.dialogInputChannel.canAcceptTurn ||
        runtimeStatus === 'waiting_for_input' ||
        status.pendingQuestionKind === 'ready'
    ) {
        return 'ready';
    }
    return 'recovering';
}

/**
 * @param {TerminalLiveFlowState} state
 * @returns {string}
 */
function describeLiveFlowState(state) {
    if (state === 'ready') return 'conversa viva e apta a receber a próxima mensagem';
    if (state === 'active-turn') return 'turno em andamento com eventos live';
    if (state === 'waiting-human') return 'aguardando resposta humana/SDK';
    if (state === 'paused') return 'conversa pausada pelo operador';
    if (state === 'offline') return 'conversa inativa';
    return 'runtime em recuperacao ou transicao';
}

/**
 * @param {{
 *     hubSessionId?: string | null;
 *     injectPort?: number;
 *     runtimeId?: string | null;
 *     limit?: number;
 * }} [input]
 * @returns {{
 *     state: TerminalLiveFlowState;
 *     summary: string;
 *     status: ReturnType<typeof readTerminalStatusProjection>;
 *     activity: ReturnType<typeof readTerminalActivityProjection>;
 *     timeline: ReturnType<typeof readTerminalTimelineProjection>;
 *     display: ReturnType<typeof readTerminalDisplayProjection>;
 *     recentIo: ReturnType<typeof readTerminalIoActivityProjection>;
 *     turnTrace: ReturnType<typeof readTerminalActivityProjection>['turnTrace'];
 *     streamDiagnostics: ReturnType<typeof readTerminalActivityProjection>['streamDiagnostics'];
 *     stream: {
 *         streaming: boolean;
 *         thinking: boolean;
 *         usage: boolean;
 *         toolActivity: boolean;
 *         intent: boolean;
 *     };
 *     sse: {
 *         clients: number;
 *         criticalClients: number;
 *         replayLastId: number;
 *     };
 *     counters: {
 *         toolCount: number;
 *         fileCount: number;
 *         recentIoCount: number;
 *         timelineTurns: number;
 *     };
 * }}
 */
export function readTerminalLiveFlowProjection(input = {}) {
    const limit = Number.isFinite(input.limit) && Number(input.limit) > 0 ? Math.floor(Number(input.limit)) : 6;
    const status = readTerminalStatusProjection({
        hubSessionId: input.hubSessionId ?? null,
        ...(typeof input.injectPort === 'number' ? { injectPort: input.injectPort } : {}),
        runtimeId: input.runtimeId ?? null,
    });
    const activity = readTerminalActivityProjection(limit);
    const timeline = readTerminalTimelineProjection({
        limitPairs: Math.max(1, Math.min(limit, 8)),
        runtimeId: input.runtimeId ?? null,
    });
    const display = readTerminalDisplayProjection();
    const recentIo = readTerminalIoActivityProjection(limit);
    const state = resolveLiveFlowState(status);
    const activeTrace = activity.turnTrace.current ?? activity.turnTrace.recent[0] ?? null;

    return {
        state,
        summary: describeLiveFlowState(state),
        status,
        activity,
        timeline,
        display,
        recentIo,
        turnTrace: activity.turnTrace,
        streamDiagnostics: activity.streamDiagnostics,
        stream: {
            streaming: Boolean(display.streaming),
            thinking: Boolean(display.thinking),
            usage: Boolean(display.usage),
            toolActivity: Boolean(display.tools),
            intent: Boolean(display.intent),
        },
        sse: {
            clients: getSseClients().size,
            criticalClients: getSseCriticalClients().size,
            replayLastId: getTerminalReplayBuffer().lastId,
        },
        counters: {
            toolCount: activeTrace?.toolCount ?? 0,
            fileCount: activeTrace?.fileCount ?? 0,
            recentIoCount: recentIo.length,
            timelineTurns: timeline.turns.length,
        },
    };
}
