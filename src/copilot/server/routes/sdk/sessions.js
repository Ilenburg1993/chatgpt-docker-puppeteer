// @ts-check
/**
 * src/copilot/api/express/sessions.js
 *
 * Rotas de gerenciamento de sessões SDK — barrel de composição.
 *
 * Compõe os sub-routers de CRUD e messaging sob autenticação opcional por SDK_API_TOKEN. Montado em /api/sdk/* via
 * sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /sessions/active — Lista sessões ativas no registry
 * - GET /sessions/binding — Expõe o binding canônico entre sessão SDK ativa e hub session
 * - GET /sessions/last — Retorna ID da última sessão modificada
 * - GET /sessions/foreground — Obtém sessionId em foreground
 * - PUT /sessions/foreground/:id — Define sessão em foreground
 * - GET /sessions — Lista todas as sessões (disco + memória)
 * - POST /sessions — Cria nova sessão
 * - GET /sessions/:id — Detalhes de uma sessão
 * - DELETE /sessions/:id — Deleta sessão do disco (irreversível)
 * - POST /sessions/:id/resume — Retoma sessão existente
 * - POST /sessions/:id/disconnect — Desconecta sessão ativa
 * - POST /sessions/:id/send — Envia mensagem (sync ou async)
 * - GET /sessions/:id/stream — SSE stream de eventos da sessão
 * - POST /sessions/:id/model — Altera modelo da sessão ativa
 * - POST /sessions/:id/abort — Aborta processamento em andamento
 * - GET /sessions/:id/messages — Lista histórico de mensagens
 *
 * @module copilot/api/express/sessions
 * @see EventBus
 */

import { SDK_API_TOKEN as _SDK_API_TOKEN } from '#copilot/config';
import { Router } from 'express';
import crudRouter from './session-crud.js';
import messagingRouter from './session-messaging.js';

const router = Router();

// SEC-N06/UPG-N19 (fix): autenticação opcional por token Bearer para SDK routes
// Configurar via variável de ambiente SDK_API_TOKEN. Endpoints são públicos se não configurado.
const SDK_API_TOKEN = _SDK_API_TOKEN;

if (SDK_API_TOKEN) {
    router.use((req, res, next) => {
        const authHeader = req.headers['authorization'] ?? '';
        if (authHeader !== `Bearer ${SDK_API_TOKEN}`) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        return next();
    });
}

// CRUD routes must come first (sessions/active, sessions/last, sessions/foreground
// must appear before :id param routes)
router.use('/', crudRouter);
router.use('/', messagingRouter);

export default router;
