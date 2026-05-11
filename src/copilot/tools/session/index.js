// @ts-check
/**
 * Barrel do subdomínio `tools/session`.
 *
 * Mantém compatibilidade durante migração física incremental dos arquivos de sessão.
 *
 * @module copilot/tools/session
 */

export { experimentalRpcTools, setExperimentalSession } from './experimental-rpc-tools.js';
export { sessionRpcTools, setSessionRpc } from './session-rpc-tools.js';
export { sessionTools } from './session-tools.js';
