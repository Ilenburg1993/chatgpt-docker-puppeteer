// @ts-check
/**
 * Facade pública de escopos de sessão/workspace para LLM-B.
 *
 * @module copilot/infra/public/session
 */

export {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    getScopeSymbolIndex,
    invalidateScopePath,
    listScopes,
    refreshScope,
} from '../io-session-scope.js';
