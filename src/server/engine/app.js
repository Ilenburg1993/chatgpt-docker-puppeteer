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
const { ROOT, LOG_DIR } = require('../../infra/fs/fs_utils');

// Middlewares de Soberania e Rastreabilidade
const requestId = require('../middleware/request_id');

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
   NOTAS DE ARQUITETURA
-------------------------------------------------------------------------- */
/**
 * IMPORTANTE: A injeção das rotas dinâmicas (/api/*) e do manipulador global
 * de erros (Error Boundary) NÃO ocorre aqui. Ela é realizada pelo gateway
 * central (router.js) durante a fase de bootstrap no main.js.
 * Isso garante que a fundação (app.js) esteja sólida antes da lógica ser exposta.
 */

module.exports = app;