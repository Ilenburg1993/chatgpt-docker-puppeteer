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

const io = require('@infra/io');
const { audit, log } = require('@core/logger');
const { ROOT } = require('@infra/fs/fs_utils');
const denyIfDelegated = require('../../middleware/deny_if_delegated');

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
        const config = (await io.safeReadJSON(CONFIG_PATH)) || {};
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
router.put('/', denyIfDelegated, async (req, res) => {
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
        if (!dna) {
            throw new Error('DNA_NOT_FOUND');
        }

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
router.put('/dna', denyIfDelegated, async (req, res) => {
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
            error: `O novo DNA viola o contrato de integridade: ${e.message}`,
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   3. DNA V2.0 ADVANCED FEATURES
   Endpoints: /api/config/dna/history, /dna/rollback, /dna/stats, /dna/evolve
-------------------------------------------------------------------------- */

/**
 * GET /dna/history
 * Retorna histórico de backups do DNA (últimas 10 versões).
 *
 * @returns {Array} history - Array de backups com timestamp, version, author
 */
router.get('/dna/history', async (req, res) => {
    try {
        const history = io.getDnaHistory();

        res.json({
            success: true,
            history,
            total: history.length,
            max_capacity: 10,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_DNA] Falha ao recuperar histórico: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao acessar histórico de backups.',
            request_id: req.id
        });
    }
});

/**
 * POST /dna/rollback
 * Restaura DNA para uma versão anterior do backup.
 *
 * @body {number} versionIndex - Index do backup (0 = mais recente)
 */
router.post('/dna/rollback', denyIfDelegated, async (req, res) => {
    try {
        const { versionIndex } = req.body;

        if (typeof versionIndex !== 'number' || versionIndex < 0) {
            return res.status(400).json({
                success: false,
                error: 'versionIndex deve ser um número >= 0',
                request_id: req.id
            });
        }

        await audit('DNA_ROLLBACK', {
            user: 'GUI',
            request_id: req.id,
            version_index: versionIndex
        });

        await io.rollbackDna(versionIndex);

        const dna = await io.getDna();

        res.json({
            success: true,
            message: `DNA restaurado para versão index ${versionIndex}`,
            current_version: dna.version,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_DNA] Falha no rollback: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: `Rollback falhou: ${e.message}`,
            request_id: req.id
        });
    }
});

/**
 * GET /dna/stats
 * Retorna estatísticas de evolução do DNA (session counters).
 *
 * @returns {Object} stats - Evolution counters per domain
 */
router.get('/dna/stats', async (req, res) => {
    try {
        const stats = io.getEvolutionStats();
        const dna = await io.getDna();

        res.json({
            success: true,
            stats: {
                session: stats, // Evolutions this session
                total: dna.evolution_count, // Total evolutions
                version: dna.version,
                domains: Object.keys(dna.targets || {}).length
            },
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_DNA] Falha ao recuperar stats: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao acessar estatísticas de evolução.',
            request_id: req.id
        });
    }
});

/**
 * POST /dna/evolve
 * Trigger manual de evolução DNA via SADI protocol.
 *
 * @body {Object} protocol - SADI protocol (target, selector, confidence, shadowRoot)
 * @body {string} domain - Domain (e.g., 'chatgpt.com')
 * @body {string} intent - Intent (e.g., 'input_box')
 */
router.post('/dna/evolve', denyIfDelegated, async (req, res) => {
    try {
        const { protocol, domain, intent } = req.body;

        if (!protocol || !domain || !intent) {
            return res.status(400).json({
                success: false,
                error: 'protocol, domain e intent são obrigatórios',
                request_id: req.id
            });
        }

        await audit('DNA_MANUAL_EVOLUTION', {
            user: 'GUI',
            request_id: req.id,
            domain,
            intent,
            confidence: protocol.confidence
        });

        const result = await io.evolveWithSadiProtocol(protocol, domain, intent);

        if (result.accepted) {
            res.json({
                success: true,
                message: 'DNA evoluído com sucesso',
                stats: result.stats,
                request_id: req.id
            });
        } else {
            res.status(400).json({
                success: false,
                error: `Evolução rejeitada: ${result.reason}`,
                request_id: req.id
            });
        }
    } catch (e) {
        log('ERROR', `[API_DNA] Falha na evolução manual: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: `Evolução falhou: ${e.message}`,
            request_id: req.id
        });
    }
});

module.exports = router;
