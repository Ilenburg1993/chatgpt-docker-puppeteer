// @ts-check
/**
 * @deprecated Onda 5.2 — Implementação canônica em `server/routes/webhooks.js`.
 *   Este stub mantém a interface factory para backward compat com `api/express/index.js`.
 * @module copilot/api/express/webhooks
 */

import { webhooksRouter } from '../../server/routes/webhooks.js';

/**
 * @deprecated Use `webhooksRouter` de `server/routes/webhooks.js` diretamente.
 * @param {*} [_] - ignorado (agent resolvido internamente no modulo canonico)
 * @returns {import('express').Router}
 */
export default function createWebhooksRouter(_) {
    return webhooksRouter;
}

