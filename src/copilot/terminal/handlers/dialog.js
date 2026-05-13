// @ts-check
/**
 * @module copilot/terminal/handlers-dialog
 * @file Adapter fino do terminal para a superfície compartilhada de sessions, memory e hub-health.
 *
 *   A lógica canônica agora vive em `src/copilot/presentation/conversation/hub.js` para que `server` e `terminal`
 *   consumam a mesma SSOT de presentation.
 */

export {
    VALID_HUB_SESSION_STATUS,
    handleDeleteMemory,
    handleHubHealth,
    handleListSessions,
    handleListTurns,
    handleRecallMemories,
    handleStoreMemory,
} from '../../presentation/conversation/index.js';
