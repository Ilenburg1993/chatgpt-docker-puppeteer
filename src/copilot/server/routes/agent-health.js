// @ts-check
/**
 * @module copilot/server/routes/agent-health
 * @file Projeções compartilhadas do snapshot de health do agente para rotas HTTP e registries.
 */

export {
    buildAgentModuleHealth,
    buildLegacyAgentHealth,
    getAgentHealthHttpStatus,
    getAgentHealthSnapshotCompat,
} from '../../presentation/runtime-health.js';
