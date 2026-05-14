// @ts-check
/**
 * Barrel público da borda terminal.
 *
 * @module copilot/terminal
 */

/** @typedef {import('./runtime-root.js').TerminalBootContext} TerminalBootContext */

export {
    TERMINAL_MODULE_LAYOUT,
    buildTerminalModuleScorecard,
    getTerminalModuleDescriptor,
    getTerminalModuleRole,
    listTerminalModulesByRisk,
    listTerminalModulesByRole,
} from './module-map.js';
export {
    createTerminalBootContext,
    runTerminalAliasesPhase,
    runTerminalInitPhase,
    runTerminalReplPhase,
    runTerminalRuntimeConfigPhase,
} from './runtime-root.js';
export {
    buildTerminalStandaloneBannerView,
    printStandaloneBanner,
    registerTerminalShutdownHandlers,
    resetTerminalReflectionLoopForTests,
    rollbackTerminalHttpServerPhase,
    rollbackTerminalPinnedContextPhase,
    rollbackTerminalRuntimeListenersPhase,
    runTerminalConversationHubPhase,
    runTerminalHttpServerPhase,
    runTerminalPinnedContextPhase,
    runTerminalRuntimeListenersPhase,
    startReflectionLoop,
    stopReflectionLoop,
} from './terminal-phases/index.js';
