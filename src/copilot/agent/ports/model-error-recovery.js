// @ts-check
/**
 * Compatibilidade para consumidores antigos do port do agent.
 *
 * A politica canonica vive em `sdk/errors.js`, pois descreve semantica de erro do SDK e tambem e usada por `hooks/` sem
 * abrir dependencia ascendente para `agent/`.
 *
 * @module copilot/agent/ports/model-error-recovery
 */

export { decideModelCallAutoFallback, decideModelCallErrorHandling } from '#copilot/sdk/errors';
