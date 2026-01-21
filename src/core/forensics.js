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
const identityManager = require('./identity_manager');
const { ActionCode, MessageType, ActorRole } = require('../shared/nerv/constants');
const { createEnvelope } = require('../shared/nerv/envelope');

// NERV instance will be injected via setNERV()
let nervInstance = null;

/**
 * Injeta instância do NERV para emissão de eventos (ONDA 2).
 * Deve ser chamado no boot antes de usar forensics.
 */
function setNERV(nerv) {
    nervInstance = nerv;
}

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

        // 4. NOTIFICAÇÃO IPC 2.0 via NERV (ONDA 2 - Migrado)
        // Evita enviar stack traces gigantescas pelo barramento Socket.io
        if (nervInstance) {
            const envelope = createEnvelope({
                actor: ActorRole.INFRA,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.FORENSICS_DUMP_CREATED,
                payload: {
                    dump_id: dumpId,
                    error_summary: error.message.substring(0, 255), // Truncamento de segurança
                    path: folder,
                    severity: 'CRITICAL'
                },
                correlationId: correlationId
            });
            nervInstance.emit(envelope);
            log('INFO', `[FORENSICS] Dump criado e notificado via NERV: ${dumpId}`, correlationId);
        } else {
            log('WARN', `[FORENSICS] Dump criado mas NERV não disponível: ${dumpId}`, correlationId);
        }
    } catch (e) {
        // Falha na forense é reportada apenas no log local para não interferir na recuperação
        console.error(`[FORENSICS] Falha crítica no motor de evidências: ${e.message}`);
    }
}

/**
 * Captura Screenshot e Snapshot do DOM de forma inteligente.
 */
async function _captureVisualEvidence(page, folder, _correlationId) {
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

module.exports = { createCrashDump, setNERV };
