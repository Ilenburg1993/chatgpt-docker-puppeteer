/* ==========================================================================
   src/server/engine/app.js
   Audit Level: 100 — Sovereign Express Engine (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Configurar a fábrica de processamento HTTP, gerenciar
                     middlewares de infraestrutura e prover recursos estáticos.
   Sincronizado com: request_id.js V50, router.js V610, main.js V51.
========================================================================== */

const express = require('express');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { ROOT, LOG_DIR } = require('../../infra/fs/fs_utils');

// [P8.3] SECURITY: CORS policy
const cors = require('cors');

// Middlewares de Soberania e Rastreabilidade
const requestId = require('../middleware/request_id');

/**
 * Rate Limiter para proteção contra flood/DoS.
 * Limita cada IP a 100 requests por minuto na API.
 */
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 100, // Limite de 100 requests por janela
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false // Disable `X-RateLimit-*` headers
});

/**
 * Instância do Express Prime.
 * Atua como o pipeline de execução para todas as requisições REST do sistema.
 */
const app = express();

/* --------------------------------------------------------------------------
   1. CAMADA DE SOBERANIA (TRACEABILITY)
   Garante que cada transação HTTP possua um ID único (UUID) desde o início,
   permitindo a correlação de logs entre Dashboard e Server.
-------------------------------------------------------------------------- */
app.use(requestId);

/* --------------------------------------------------------------------------
   1.5. CAMADA DE SEGURANÇA (P8.3 - CORS POLICY)
   Restringe origens permitidas para prevenir CSRF e access não autorizado.
-------------------------------------------------------------------------- */
app.use(
    cors({
        origin: [
            'http://localhost:3008',
            'http://127.0.0.1:3008',
            process.env.DASHBOARD_ORIGIN || 'http://localhost:3008'
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
    })
);

/* --------------------------------------------------------------------------
   2. CAMADA DE PERFORMANCE E INTEGRIDADE DE DADOS
-------------------------------------------------------------------------- */

// Compactação de dados para otimizar o streaming de telemetria massiva
app.use(compression());

// Parsing de JSON com limite de segurança (10MB) para evitar Out-of-Memory (OOM)
// Essencial para suportar injeções de contexto e payloads complexos do IPC 2.0
app.use(express.json({ limit: '10mb' }));

/* --------------------------------------------------------------------------
   3. CAMADA DE RECURSOS FÍSICOS (ESTÁTICOS)
-------------------------------------------------------------------------- */

/**
 * Mission Control Dashboard
 * Interface principal de comando e controle servida a partir da pasta /public.
 */
app.use(express.static(path.join(ROOT, 'public')));

/**
 * Galeria Forense (Crash Dumps)
 * Disponibiliza as evidências visuais (screenshots e snapshots do DOM)
 * capturadas pelo Driver em caso de falha catastrófica.
 */
const crashReportsPath = path.join(LOG_DIR, 'crash_reports');
app.use('/crash_reports', express.static(crashReportsPath));

/* --------------------------------------------------------------------------
   4. CAMADA DE OBSERVABILIDADE (P9.1)
-------------------------------------------------------------------------- */
const hardware = require('../../core/hardware');

// Health endpoint com heap monitoring
app.get('/api/health-metrics', (req, res) => {
    const metrics = hardware.getAllMetrics();
    res.json({
        status: 'ok',
        ...metrics
    });
});

/* --------------------------------------------------------------------------
   NOTAS DE ARQUITETURA
-------------------------------------------------------------------------- */
/**
 * IMPORTANTE: A injeção das rotas dinâmicas (/api/*) e do manipulador global
 * de erros (Error Boundary) NÃO ocorre aqui. Ela é realizada pelo gateway
 * central (router.js) durante a fase de bootstrap no main.js.
 * Isso garante que a fundação (app.js) esteja sólida antes da lógica ser exposta.
 */

module.exports = app;
module.exports.apiLimiter = apiLimiter;
