// @ts-check

export { registerTerminalAgentSsePassthrough } from './agent-sse-passthrough.js';
export {
    claimTerminalAssistantTranscript,
    isTerminalAssistantTranscriptCovered,
    renderTerminalAssistantTranscript,
    __test__ as terminalAssistantTranscriptRendererTestHarness,
} from './assistant-transcript-renderer.js';
export { renderTerminalIntent, __test__ as terminalIntentRendererTestHarness } from './intent-renderer.js';
export {
    compactTerminalIntentText,
    formatTerminalIntentTechnicalEnvelope,
    humanTerminalIntentRiskLabel,
    humanTerminalIntentSource,
    terminalIntentRiskTheme,
} from './intent-presenter.js';
export {
    EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS,
    EMPTY_AFTER_USER_INPUT_MODEL_COMMAND,
    EMPTY_AFTER_USER_INPUT_RESUME_COMMAND,
    buildEmptyAfterUserInputRecoveryRows,
    compactTerminalRecoveryText,
    summarizeEmptyAfterUserInputRecovery,
} from './dialog-recovery-presenter.js';
export {
    createTaskTranscriptAccumulator,
    getTaskTranscriptKey,
    isInternalTaskTranscriptKey,
} from './task-transcript-accumulator.js';
export {
    TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS,
    TERMINAL_EXPLICIT_AGENT_EVENTS,
    createTerminalHandledAgentEventsSet,
    createTerminalPassthroughAgentEventsSet,
    findTerminalPublicStreamSourcePolicyByEvent,
    listTerminalPublicStreamSourcePolicies,
    listTerminalIgnoredAgentEvents,
} from './event-adapter-events.js';
export {
    setupTerminalEventAdapters,
    setupTerminalHeadlessEventAdapters,
    setupTerminalInteractiveEventAdapters,
} from './event-adapters.js';
export {
    clearTerminalIoActivityProjection,
    readTerminalIoActivityProjection,
    setupTerminalIoActivityEvents,
    __test__ as terminalIoActivityEventsTestHarness,
} from './io-activity-events.js';
export { setupTerminalTaskStreamListeners } from './task-stream-events.js';
