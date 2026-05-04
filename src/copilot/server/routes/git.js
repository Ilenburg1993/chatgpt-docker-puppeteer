// @ts-check
/**
 * @module copilot/server/routes/git
 * @file Router Express para rotas Git/GitHub do servidor copilot.
 *
 *   Rotas: GET /git/status, GET /git/log, GET /gh/issues, GET /gh/prs, GET /gh/ci
 *
 *   Onda 3.1 — L55.6.
 *
 *   src/copilot/server/routes/git.js
 */

import { Router } from 'express';
import {
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
} from '../../presentation/system-metrics.js';
import { createPresentationRoute } from './presentation-route.js';

/**
 * Cria o router de Git/GitHub do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createGitRouter() {
    const router = Router();

    // Git
    router.get('/git/status', createPresentationRoute(handleGitStatus));
    router.get(
        '/git/log',
        createPresentationRoute(handleGitLog, (req) => ({
            n: Number(req.query['n'] ?? 20),
        })),
    );

    // GitHub
    router.get(
        '/gh/issues',
        createPresentationRoute(handleGhIssues, (req) => ({
            state: String(req.query['state'] ?? 'open'),
            limit: Number(req.query['limit'] ?? 15),
        })),
    );
    router.get(
        '/gh/prs',
        createPresentationRoute(handleGhPrs, (req) => ({
            state: String(req.query['state'] ?? 'open'),
            limit: Number(req.query['limit'] ?? 15),
        })),
    );
    router.get(
        '/gh/ci',
        createPresentationRoute(handleGhCi, (req) => ({
            limit: Number(req.query['limit'] ?? 15),
        })),
    );

    return router;
}
