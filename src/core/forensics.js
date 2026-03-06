// @ts-check - Type checking rigoroso habilitado (arquivo core)
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
/** @type {any} */
let nervInstance = null;

/**
 * Tempo limite para capturas visuais (5 segundos).
 * Evita que um navegador congelado trave o processo de recuperação do Maestro.
 */
const CAPTURE_TIMEOUT_MS = 5000;

/**
 * Metadados técnicos do dump de erro.
 * @typedef {object} CrashDumpMeta
 * @property {string} id - ID único do dump.
 * @property {string} robot_id - ID do robô.
 * @property {string} instance_id - ID da instância.
 * @property {string} taskId - ID da tarefa.
 * @property {string} correlation_id - ID de correlação.
 * @property {object} error - Informações do erro.
 * @property {string} error.message - Mensagem do erro.
 * @property {string} error.stack - Stack trace do erro.
 * @property {string} error.code - Código do erro.
 * @property {object} context - Contexto da captura.
 * @property {string} context.url - URL da página.
 * @property {string} context.timestamp - Timestamp ISO da captura.
 */

/**
 * @typedef {object} SetNERVNerv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Injeta instância do NERV para emissão de eventos (ONDA 2).
 * Side-effects: Modifica estado global nervInstance.
 * Deve ser chamado no boot antes de usar forensics.
 * @param {SetNERVNerv} nerv - Instância do NERV para notificações.
  * @returns {void}
 */
function setNERV(nerv) {
    nervInstance = nerv;
}

/**
 * @typedef {object} CreateCrashDumpPage
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Cria um pacote de evidências (Dump) de um erro catastrófico.
 * Side-effects: Cria diretório em PATHS.REPORTS, escreve arquivos, emite evento NERV.
 * @param {CreateCrashDumpPage} page - Instância da página Puppeteer.
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
                code: (/** @type {any} */ (error)).code || 'N/A',
            },
            context: {
                url: page && !(/** @type {any} */ (page)).isClosed() ? (/** @type {any} */ (page)).url() : 'PAGE_CLOSED',
                timestamp: new Date().toISOString(),
            },
        };

        // Escrita Atômica: garante que o JSON não seja corrompido se o host cair
        await io.atomicWrite(path.join(folder, 'meta.json'), JSON.stringify(meta, null, 2));

        // 3. EVIDÊNCIAS VISUAIS (Protegidas por Timeout de Corrida)
        // FIXED (P0-1.2): Agora usa withTimeout para garantir cleanup do AbortController
        // Previne operações órfãs que continuam escrevendo no disco após timeout
        if (page && !(/** @type {any} */ (page)).isClosed()) {
            try {
                await withTimeout(
                    () => _captureVisualEvidence(page, folder, correlationId),
                    CAPTURE_TIMEOUT_MS,
                    'BROWSER_CAPTURE_TIMEOUT'
                );
            } catch (_rawErr) {
            const err = /** @type {any} */ (_rawErr);
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
            } catch (_rawE) {
            const e = /** @type {any} */ (_rawE);
                log('WARN', `[FORENSICS] Falha ao notificar dump via NERV: ${e.message}`, correlationId);
            }
        } else {
            log('WARN', `[FORENSICS] Dump criado mas NERV não disponível: ${dumpId}`, correlationId);
        }
    } catch (_rawE) {
            const e = /** @type {any} */ (_rawE);
        // Falha na forense é reportada apenas no log local para não interferir na recuperação
        console.error(`[FORENSICS] Falha crítica no motor de evidências: ${e.message}`);
    }
}

/**
 * Captura Screenshot e Snapshot do DOM de forma inteligente.
 * Side-effects: Escreve arquivos screenshot.jpg e dom_snapshot.html no folder.
 * @param {object} page - Instância da página Puppeteer.
 * @param {string} folder - Caminho do diretório para salvar evidências.
 * @param {string} _correlationId - ID de correlação para logs.
 * @returns {Promise<void>}
 * @private
 */
/* global document */
async function _captureVisualEvidence(/** @type {any} */ page, folder, _correlationId) {
    try {
        if (!page || page.isClosed?.()) return;

        // A. Screenshot (JPEG comprimido para performance)
        await page.screenshot({
            path: path.join(folder, 'screenshot.jpg'),
            quality: 40,
            type: 'jpeg',
        });

        // B. Snapshot do DOM (Legibilidade Preservada)
        // Removemos scripts e iframes, mas mantemos o CSS para análise visual humana.
        const html = await page.evaluate(() => {
            const clone = /** @type {Element} */ (document.documentElement.cloneNode(true));
            // Limpeza de elementos ativos que podem quebrar o visualizador offline
            const selectorsToRemove = 'script, iframe, noscript, link[rel="prefetch"], link[rel="preload"]';
            clone.querySelectorAll(selectorsToRemove).forEach(e => e.remove());
            return clone.outerHTML;
        });

        await fs.writeFile(path.join(folder, 'dom_snapshot.html'), html, 'utf-8');
    } catch (_rawErr) {
            const err = /** @type {any} */ (_rawErr);
        log('WARN', `[FORENSICS] Visual capture failed: ${err?.message || String(err)}`, _correlationId);
    }
}

export { createCrashDump, setNERV };
