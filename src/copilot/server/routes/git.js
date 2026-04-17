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
import { bridgeHandler } from '../handler-bridge.js';

/**
 * Cria o router de Git/GitHub do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createGitRouter() {
    const router = Router();

    // Git
    router.get('/git/status', bridgeHandler(handleGitStatus));
    router.get(
        '/git/log',
        bridgeHandler(handleGitLog, (req) => ({
            n: Number(req.query['n'] ?? 20),
        })),
    );

    // GitHub
    router.get(
        '/gh/issues',
        bridgeHandler(handleGhIssues, (req) => ({
            state: String(req.query['state'] ?? 'open'),
            limit: Number(req.query['limit'] ?? 15),
        })),
    );
    router.get(
        '/gh/prs',
        bridgeHandler(handleGhPrs, (req) => ({
            state: String(req.query['state'] ?? 'open'),
            limit: Number(req.query['limit'] ?? 15),
        })),
    );
    router.get(
        '/gh/ci',
        bridgeHandler(handleGhCi, (req) => ({
            limit: Number(req.query['limit'] ?? 15),
        })),
    );

    return router;
}
