// @ts-check
/**
 * @module copilot/presentation/runtime-file-routing
 * @file Ponte de presentation para a política canônica SDK workspace ↔ FS local.
 *
 *   Bordas de UI/terminal consomem esta superfície em vez de importar `core` diretamente. A decisão permanece única no
 *   core; esta camada só estabiliza o contrato para projections e rotas.
 */

import { decideSdkFsRouting } from '../core/sdk-fs-routing.js';

/**
 * @typedef {import('../core/sdk-fs-routing.js').SdkFsRoutingDecision} SdkFsRoutingDecision
 */

/**
 * Decide o modo operacional recomendado entre workspace SDK e filesystem local.
 *
 * @param {{ canonicalFsReady: boolean; sdkWorkspaceAvailable: boolean }} input
 * @returns {SdkFsRoutingDecision}
 */
export function buildRuntimeSdkFsRoutingProjection(input) {
    return decideSdkFsRouting(input);
}
