/* ==========================================================================
   src/server/api/controllers/dna.js
   Audit Level: 700 — Intelligence & DNA Controller (Traceability Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Gerenciar as configurações mestras e a evolução do genoma
                     de seletores (SADI) com rastreabilidade total.
   Sincronizado com: io.js V700, request_id.js V600, schemas.js V410.
========================================================================== */

const express = require('express');
const router = express.Router();
const path = require('path');

const io = require('../../../infra/io');
const { audit, log } = require('../../../core/logger');
const { ROOT } = require('../../../infra/fs/fs_utils');

// Caminho físico absoluto para o arquivo de configuração mestre
const CONFIG_PATH = path.join(ROOT, 'config.json');

/* --------------------------------------------------------------------------
   1. GESTÃO DE CONFIGURAÇÃO (PARAMÉTRICA)
   Endpoint: /api/config
-------------------------------------------------------------------------- */

/**
 * GET /
 * Recupera as definições de comportamento globais (Timeouts, Delays, etc).
 */
router.get('/', async (req, res) => {
    try {
        const config = await io.safeReadJSON(CONFIG_PATH) || {};
        res.json({
            success: true,
            config,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_DNA] Falha ao ler config.json: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao acessar base de configuração.',
            request_id: req.id
        });
    }
});

/**
 * PUT /
 * Sobrescreve as preferências globais via escrita atômica resiliente.
 */
router.put('/', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Payload de configuração inválido.',
                request_id: req.id
            });
        }

        // Auditoria administrativa da mutação vinculada ao Request ID
        await audit('UPDATE_CONFIG', {
            user: 'GUI',
            request_id: req.id,
            timestamp: new Date().toISOString()
        });

        // Persistência blindada contra quedas de energia/processo
        await io.atomicWrite(CONFIG_PATH, JSON.stringify(req.body, null, 2));

        res.json({
            success: true,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_DNA] Falha ao persistir configuração: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha catastrófica na escrita do arquivo.',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   2. GESTÃO DE GENOMA (PERCEPÇÃO SADI)
   Endpoint: /api/config/dna
-------------------------------------------------------------------------- */

/**
 * GET /dna
 * Recupera o mapa atual de seletores e regras dinâmicas aprendidas.
 */
router.get('/dna', async (req, res) => {
    try {
        const dna = await io.getDna();
        if (!dna) {throw new Error('DNA_NOT_FOUND');}

        res.json({
            success: true,
            dna,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_DNA] Falha ao recuperar DNA: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao acessar o genoma do sistema.',
            request_id: req.id
        });
    }
});

/**
 * PUT /dna
 * Evolui o genoma com validação nativa de integridade (Audit 410).
 */
router.put('/dna', async (req, res) => {
    try {
        await audit('UPDATE_DNA', {
            user: 'GUI',
            request_id: req.id
        });

        // A fachada io.saveDna realiza a validação nativa antes de tocar no disco
        await io.saveDna(req.body);

        res.json({
            success: true,
            request_id: req.id
        });
    } catch (e) {
        log('WARN', `[API_DNA] Evolução de DNA rejeitada: ${e.message}`, req.id);
        res.status(400).json({
            success: false,
            error: `O novo DNA viola o contrato de integridade: ${  e.message}`,
            request_id: req.id
        });
    }
});

module.exports = router;