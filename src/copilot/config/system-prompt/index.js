// @ts-check
/**
 * src/copilot/config/system-prompt/index.js
 *
 * Barrel puro do system prompt modular.
 *
 * @module copilot/config/system-prompt
 */

import { SYSTEM_MESSAGE_SECTIONS, SYSTEM_PROMPT_SECTIONS } from '../sdk-config-port.js';

export { CONTENT as CODE_CHANGE_RULES } from './sections/code-change-rules.js';
export { CONTENT as ENVIRONMENT_CONTEXT } from './sections/environment-context.js';
export { CONTENT as AGENT_GUIDELINES } from './sections/guidelines.js';
export { CONTENT as AGENT_IDENTITY } from './sections/identity.js';
export { CONTENT as LAST_INSTRUCTIONS } from './sections/last-instructions.js';
export { CONTENT as AGENT_TONE } from './sections/tone.js';
export { CONTENT as TOOL_EFFICIENCY } from './sections/tool-efficiency.js';

export {
    applyDeclaredSystemPromptSection,
    buildAlwaysAliveSystemMessage,
    buildAppendSystemMessage,
    buildGuidelinesAppendMessage,
    buildHookContextAppendMessage,
    buildHookContextMessage,
    buildReplaceSystemMessage,
    buildSystemMessage,
} from './builders.js';

export { SYSTEM_MESSAGE_SECTIONS, SYSTEM_PROMPT_SECTIONS };

export { buildSystemPromptBindingSnapshot, evaluateSystemPromptFreshness } from './freshness.js';
export { buildLiveSystemMessage } from './live-builders.js';
export { getMode, readSystemPromptModeState, resetMode, setMode } from './mode.js';
export {
    buildSystemPromptProfile,
    renderSystemPromptProfileBlock,
    SYSTEM_PROMPT_DEFAULT_COLLABORATION_CONTRACT,
    SYSTEM_PROMPT_DEFAULT_ENGINEERING_DOCTRINE,
    SYSTEM_PROMPT_DEFAULT_EVOLUTION_LOOP,
    SYSTEM_PROMPT_DEFAULT_FOCUS_PATHS,
    SYSTEM_PROMPT_DEFAULT_NORTH_STAR,
    SYSTEM_PROMPT_DEFAULT_OBJECTIVE,
    SYSTEM_PROMPT_DEFAULT_PERSONALITY,
} from './profile.js';
export { buildSystemPromptPublicProjection } from './projection.js';
export { getSystemPromptSdkCompatibility, readSessionInstructionSources } from './sdk-introspection.js';
export { SECTIONS, SYSTEM_PROMPT_SECTION_FILES, SYSTEM_PROMPT_SECTION_ORDER } from './sections-registry.js';
export { readSystemPromptStatus, readSystemPromptStatusSync } from './status.js';
export {
    getSystemPromptConfigFilePath,
    normalizeSystemPromptMode,
    normalizeSystemPromptReloadStrategy,
    readResolvedSystemPromptUserConfig,
    readResolvedSystemPromptUserConfigSync,
    readUserAppendContent,
    readUserAppendContentSync,
    SYSTEM_PROMPT_CONFIG_PATH,
    SYSTEM_PROMPT_DEFAULT_MODE,
    SYSTEM_PROMPT_DEFAULT_RELOAD_STRATEGY,
} from './user-config.js';
