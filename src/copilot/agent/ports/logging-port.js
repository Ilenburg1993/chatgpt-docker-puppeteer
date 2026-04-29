// @ts-check
/**
 * @module copilot/agent/ports/logging-port
 * @file Porta fina de logging do agent.
 *
 *   Mantém módulos do agent desacoplados da topologia concreta de `observability/` quando só precisam registrar logs.
 */

export { log } from '#copilot/observability';
