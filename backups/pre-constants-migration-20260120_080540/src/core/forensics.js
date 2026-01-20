/* ==========================================================================
   src/core/forensics.js
   Audit Level: 710 — Hardened Sovereign Forensic Engine (Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Capturar evidências técnicas e visuais de falhas críticas
                     com proteção contra travamentos do navegador (Anti-Hang).
   Sincronizado com: paths.js V700, io.js V700, ipc_client.js V600.
========================================================================== */

const fs = require('fs').promises;
const path = require('path');
const { log } = require('./logger');

// Infraestrutura e Shared Kernel
const PATHS = require('../infra/fs/paths');
const io = require('../infra/io');
// TODO [ONDA 2]: Refatorar para usar NERV após DriverNERVAdapter
// const ipc = require('../infra/ipc_client');
const identityManager = require('./identity_manager');
const { ActionCode } = require('../shared/nerv/constants');

/**
 * Tempo limite para capturas visuais (5 segundos).
 * Evita que um navegador congelado trave o processo de recuperação do Maestro.
 */
const CAPTURE_TIMEOUT_MS = 5000;

/**
 * Cria um pacote de evidências (Dump) de um erro catastrófico.
 */
async function createCrashDump(page, error, taskId = 'unknown', correlationId = 'unknown') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Fallbacks seguros caso o erro ocorra antes da inicialização da identidade
    const robotId = identityManager.getRobotId() || 'uninitialized';
    const instanceId = identityManager.getInstanceId() || 'boot-phase';

    const dumpId = `crash_${timestamp}_${taskId}`;
    const folder = path.join(PATHS.REPORTS, dumpId);

    try {
        // 1. PREPARAÇÃO DO AMBIENTE
        await fs.mkdir(folder, { recursive: true });
        log('FATAL', `[FORENSICS] Executando autópsia digital: ${dumpId}`, correlationId);

        // 2. METADADOS TÉCNICOS (Full Context)
        const meta = {
            id: dumpId,
            robot_id: robotId,
            instance_id: instanceId,
            taskId: taskId,
            correlation_id: correlationId,
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code || 'N/A'
            },
            context: {
                url: page && !page.isClosed() ? page.url() : 'PAGE_CLOSED',
                timestamp: new Date().toISOString()
            }
        };

        // Escrita Atômica: garante que o JSON não seja corrompido se o host cair
        await io.atomicWrite(path.join(folder, 'meta.json'), JSON.stringify(meta, null, 2));

        // 3. EVIDÊNCIAS VISUAIS (Protegidas por Timeout de Corrida)
        if (page && !page.isClosed()) {
            await Promise.race([
                _captureVisualEvidence(page, folder, correlationId),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('BROWSER_CAPTURE_TIMEOUT')), CAPTURE_TIMEOUT_MS);
                })
            ]).catch(err => {
                log('WARN', `[FORENSICS] Captura visual abortada: ${err.message}`, correlationId);
            });
        }

        // 4. NOTIFICAÇÃO IPC 2.0 (Com Truncamento de Payload)
        // Evita enviar stack traces gigantescas pelo barramento Socket.io
        // TODO [ONDA 2]: Migrar para NERV.emit()
        // ipc.emitEvent(ActionCode.STALL_DETECTED, {
        //     type: 'FORENSIC_DUMP_READY',
        //     severity: 'CRITICAL',
        //     evidence: {
        //         dump_id: dumpId,
        //         error_summary: error.message.substring(0, 255), // Truncamento de segurança
        //         path: folder
        //     }
        // }, correlationId);
        log('INFO', `[FORENSICS] Dump criado: ${dumpId} - TODO: emitir via NERV`, correlationId);
    } catch (e) {
        // Falha na forense é reportada apenas no log local para não interferir na recuperação
        console.error(`[FORENSICS] Falha crítica no motor de evidências: ${e.message}`);
    }
}

/**
 * Captura Screenshot e Snapshot do DOM de forma inteligente.
 */
async function _captureVisualEvidence(page, folder, correlationId) {
    // A. Screenshot (JPEG comprimido para performance)
    await page.screenshot({
        path: path.join(folder, 'screenshot.jpg'),
        quality: 40,
        type: 'jpeg'
    });

    // B. Snapshot do DOM (Legibilidade Preservada)
    // Removemos scripts e iframes, mas mantemos o CSS para análise visual humana.
    const html = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true);
        // Limpeza de elementos ativos que podem quebrar o visualizador offline
        const selectorsToRemove = 'script, iframe, noscript, link[rel="prefetch"], link[rel="preload"]';
        clone.querySelectorAll(selectorsToRemove).forEach(e => e.remove());
        return clone.outerHTML;
    });

    await fs.writeFile(path.join(folder, 'dom_snapshot.html'), html, 'utf-8');
}

module.exports = { createCrashDump };
