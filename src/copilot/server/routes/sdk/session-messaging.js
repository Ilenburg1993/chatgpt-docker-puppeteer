// @ts-check
/**
 * src/copilot/server/routes/sdk/session-messaging.js
 *
 * Composição das rotas de messaging e capacidades de sessões SDK.
 *
 * @module copilot/server/routes/sdk/session-messaging
 */

import { Router } from 'express';
import { registerSessionCoreRoutes } from './session-core-routes.js';
import { registerSessionRpcRoutes } from './session-rpc-routes.js';
import { registerSessionUiRoutes } from './session-ui-routes.js';
import { registerSessionWorkspaceRoutes } from './session-workspace-routes.js';

const router = Router();

registerSessionCoreRoutes(router);
registerSessionWorkspaceRoutes(router);
registerSessionUiRoutes(router);
registerSessionRpcRoutes(router);

export default router;
