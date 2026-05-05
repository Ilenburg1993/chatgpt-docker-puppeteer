// @ts-check
/**
 * @module copilot/presentation/dialog-timeout-policy
 * @file Barrel fino da política de timeout adaptativo compartilhada.
 *
 *   Mantido em `presentation/` por compatibilidade com consumidores existentes, mas a implementação canônica agora vive
 *   em `core/dialog-timeout-policy.js` para evitar algoritmos paralelos entre `presentation`, `terminal` e `channel`.
 */

export {
    computeAdaptiveDialogTimeout,
    computeAdaptiveTransportTimeout,
    resolveOptionalDialogTimeout,
    resolveOptionalTransportTimeout,
} from '../core/dialog-timeout-policy.js';
