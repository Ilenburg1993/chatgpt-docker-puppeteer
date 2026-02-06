import express from 'express';
const router = express.Router();
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as system from '#infra/system';
import * as doctor from '#core/doctor';
import * as io from '#infra/io';
import * as socketHub from '#server/engine/socket';
import { audit, log } from '#core/logger';
import { ROOT } from '#infra/fs/fs_utils';

/* --------------------------------------------------------------------------
   1. OBSERVABILIDADE DE AGENTES (IPC 2.0)
-------------------------------------------------------------------------- */

/**
 * GET /agents
 * Retorna o inventário em tempo real de todos os robôs homologados no Hub.
 */
router.get('/agents', (req, res) => {
    try {
        const registry = socketHub.getRegistry();

        const agents = registry.map(entry => ({
            robot_id: entry.identity.robot_id,
            instance_id: entry.identity.instance_id,
            status: 'ONLINE',
            last_seen: entry.last_seen,
            capabilities: entry.identity.capabilities,
            metadata: entry.identity.metadata
        }));

        res.json({
            success: true,
            count: agents.length,
            timestamp: Date.now(),
            agents,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_SYSTEM] Falha ao listar agentes: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao acessar o Registry de Agentes.',
            request_id: req.id
        });
    }
});

/**
 * POST /agents/:id/command
 * Despacha um comando IPC 2.0 para um robô específico via Unicast.
 */
router.post('/agents/:id/command', async (req, res) => {
    const { id } = req.params;
    const { command, payload } = req.body;

    if (!command) {
        return res.status(400).json({
            success: false,
            error: "O campo 'command' é obrigatório para execução remota.",
            request_id: req.id
        });
    }

    try {
        // Auditoria obrigatória da intenção de comando administrativo
        await audit('REMOTE_COMMAND', {
            target_robot: id,
            command,
            payload,
            request_id: req.id
        });

        // Tenta enviar via Hub (Roteamento por sala privada agent:ID)
        const msgId = socketHub.sendCommand(command, payload || {}, id);

        if (!msgId) {
            return res.status(404).json({
                success: false,
                error: `Agente ${id} não localizado ou offline.`,
                request_id: req.id
            });
        }

        res.json({
            success: true,
            msg_id: msgId,
            status: 'DISPATCHED',
            target: id,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_SYSTEM] Falha no despacho de comando: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha interna no barramento de comando.',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   2. DIAGNÓSTICO E SAÚDE (DOCTOR)
-------------------------------------------------------------------------- */

/**
 * GET /health
 * Executa o check-up completo (Rede, Disco, DNA, RAM).
 */
router.get('/health', async (req, res) => {
    try {
        const report = await doctor.runFullCheck();
        res.json({
            ...report,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_SYSTEM] Falha no motor de diagnóstico: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao executar diagnóstico de saúde.',
            request_id: req.id
        });
    }
});

/**
 * GET /status
 * Retorna o estado do processo (PM2) do Agente local.
 */
router.get('/status', async (req, res) => {
    try {
        const status = await system.getAgentStatus();
        res.json({
            ...status,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_SYSTEM] Falha ao obter status do processo: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao obter status do processo.',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   3. CONTROLE DE PROCESSO E TRAVAS (INFRA)
-------------------------------------------------------------------------- */

/**
 * POST /control/:action
 * Executa comandos de ciclo de vida: start, stop, restart, kill_daemon.
 */
router.post('/control/:action', async (req, res) => {
    const { action } = req.params;
    try {
        // Proteção: em modo delegated, o server não deve executar comandos de lifecycle
        const authority = req.app?.locals?.authority || process.env.SERVER_AUTHORITY || 'standalone';
        if (String(authority).toLowerCase() === 'delegated') {
            return res.status(403).json({
                success: false,
                error: 'Operation not permitted: server running in delegated mode',
                request_id: req.id
            });
        }
        await audit('PROCESS_CONTROL', { action, source: 'API', request_id: req.id });
        const result = await system.controlAgent(action);
        res.json({
            ...result,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_SYSTEM] Falha na operação ${action}: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: `Falha ao executar comando de processo: ${action}`,
            request_id: req.id
        });
    }
});

/**
 * GET /locks
 * Inspeção de contenção de recursos físicos (.lock na raiz).
 */
router.get('/locks', async (req, res) => {
    try {
        const files = await fs.readdir(ROOT);
        const lockFiles = files.filter(f => f.startsWith('RUNNING_') && f.endsWith('.lock'));

        const locks = await Promise.all(
            lockFiles.map(async f => {
                const content = await io.safeReadJSON(path.join(ROOT, f));
                if (!content) {
                    return null;
                }
                return {
                    target: f.replace('RUNNING_', '').replace('.lock', ''),
                    ...content
                };
            })
        );

        res.json({
            success: true,
            locks: locks.filter(l => l !== null),
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_SYSTEM] Falha ao listar travas: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao listar travas ativas no sistema.',
            request_id: req.id
        });
    }
});

export default router;
