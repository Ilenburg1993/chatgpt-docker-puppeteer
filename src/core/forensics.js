import * as PATHS from '#infra/fs/paths';
import * as io from '#infra/io';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import identityManager from './identity_manager.js';
import { log } from './logger.js';
import { withTimeout } from '#infra/abort_controller_utils';

// NERV instance will be injected via setNERV()
let nervInstance = null;

/**
 * Tempo limite para capturas visuais (5 segundos).
 * Evita que um navegador congelado trave o processo de recuperação do Maestro.
 */
const CAPTURE_TIMEOUT_MS = 5000;

/**
 * Metadados técnicos do dump de erro.
 * @typedef {Object} CrashDumpMeta
 * @property {string} id - ID único do dump.
 * @property {string} robot_id - ID do robô.
 * @property {string} instance_id - ID da instância.
 * @property {string} taskId - ID da tarefa.
 * @property {string} correlation_id - ID de correlação.
 * @property {Object} error - Informações do erro.
 * @property {string} error.message - Mensagem do erro.
 * @property {string} error.stack - Stack trace do erro.
 * @property {string} error.code - Código do erro.
 * @property {Object} context - Contexto da captura.
 * @property {string} context.url - URL da página.
 * @property {string} context.timestamp - Timestamp ISO da captura.
 */

/**
 * Injeta instância do NERV para emissão de eventos (ONDA 2).
 * Side-effects: Modifica estado global nervInstance.
 * Deve ser chamado no boot antes de usar forensics.
 * @param {Object} nerv - Instância do NERV para notificações.
 */
function setNERV(nerv) {
    nervInstance = nerv;
}

/**
 * Cria um pacote de evidências (Dump) de um erro catastrófico.
 * Side-effects: Cria diretório em PATHS.REPORTS, escreve arquivos, emite evento NERV.
 * @param {Object} page - Instância da página Puppeteer.
 * @param {Error} error - Erro que causou o crash.
 * @param {string} [taskId='unknown'] - ID da tarefa relacionada.
 * @param {string} [correlationId='unknown'] - ID de correlação para rastreamento.
 * @returns {Promise<void>}
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
                code: error.code || 'N/A',
            },
            context: {
                url: page && !page.isClosed() ? page.url() : 'PAGE_CLOSED',
                timestamp: new Date().toISOString(),
            },
        };

        // Escrita Atômica: garante que o JSON não seja corrompido se o host cair
        await io.atomicWrite(path.join(folder, 'meta.json'), JSON.stringify(meta, null, 2));

        // 3. EVIDÊNCIAS VISUAIS (Protegidas por Timeout de Corrida)
        // FIXED (P0-1.2): Agora usa withTimeout para garantir cleanup do AbortController
        // Previne operações órfãs que continuam escrevendo no disco após timeout
        if (page && !page.isClosed()) {
            try {
                await withTimeout(
                    () => _captureVisualEvidence(page, folder, correlationId),
                    CAPTURE_TIMEOUT_MS,
                    'BROWSER_CAPTURE_TIMEOUT'
                );
            } catch (err) {
                log('WARN', `[FORENSICS] Captura visual abortada: ${err.message}`, correlationId);
            }
        }

        // 4. NOTIFICAÇÃO IPC 2.0 via NERV (ONDA 2 - Migrado)
        // Evita enviar stack traces gigantescas pelo barramento Socket.io
        if (nervInstance) {
            try {
                await HighLevelNERV.sendEvent(
                    nervInstance,
                    ActorRole.INFRA,
                    ActionCode.FORENSICS_DUMP_CREATED,
                    {
                        dump_id: dumpId,
                        error_summary: error.message.substring(0, 255),
                        path: folder,
                        severity: 'CRITICAL',
                    },
                    correlationId
                );

                log('INFO', `[FORENSICS] Dump criado e notificado via NERV: ${dumpId}`, correlationId);
            } catch (e) {
                log('WARN', `[FORENSICS] Falha ao notificar dump via NERV: ${e.message}`, correlationId);
            }
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
 * Side-effects: Escreve arquivos screenshot.jpg e dom_snapshot.html no folder.
 * @param {Object} page - Instância da página Puppeteer.
 * @param {string} folder - Caminho do diretório para salvar evidências.
 * @param {string} _correlationId - ID de correlação para logs.
 * @returns {Promise<void>}
 * @private
 */
/* global document */
async function _captureVisualEvidence(page, folder, _correlationId) {
    // A. Screenshot (JPEG comprimido para performance)
    await page.screenshot({
        path: path.join(folder, 'screenshot.jpg'),
        quality: 40,
        type: 'jpeg',
    });

    // B. Snapshot do DOM (Legibilidade Preservada)
    // Removemos scripts e iframes, mas mantemos o CSS para análise visual humana.
    const html = await page.evaluate(() => {
        const clone = /** @type {any} */ (document.documentElement.cloneNode(true));
        // Limpeza de elementos ativos que podem quebrar o visualizador offline
        const selectorsToRemove = 'script, iframe, noscript, link[rel="prefetch"], link[rel="preload"]';
        clone.querySelectorAll(selectorsToRemove).forEach(e => e.remove());
        return clone.outerHTML;
    });

    await fs.writeFile(path.join(folder, 'dom_snapshot.html'), html, 'utf-8');
}

export { createCrashDump, setNERV };
