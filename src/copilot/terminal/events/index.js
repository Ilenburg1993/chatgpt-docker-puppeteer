// @ts-check

export { registerTerminalAgentSsePassthrough } from './agent-sse-passthrough.js';
export {
    claimTerminalAssistantTranscript,
    renderTerminalAssistantTranscript,
    __test__ as terminalAssistantTranscriptRendererTestHarness,
} from './assistant-transcript-renderer.js';
export { renderTerminalIntent, __test__ as terminalIntentRendererTestHarness } from './intent-renderer.js';
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
