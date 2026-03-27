// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import { ARTIFACTS_DIR, RESPONSE_DIR as LEGACY_RESPONSE_DIR } from '#infra/fs/paths';
import { atomicWrite } from '#infra/io';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function _resolveArtifactsRoot() {
    const fromEnv = process.env.MAESTRO_ARTIFACTS_DIR || process.env.ARTIFACTS_DIR || null;
    return path.resolve(fromEnv || ARTIFACTS_DIR);
}

function _responseDir() {
    return path.join(_resolveArtifactsRoot(), 'responses');
}

/** @typedef {any} SaveResponseV2Options */
/**
 * @typedef {object} SaveResponseV2ResponseData
 * @property {any} content
 * @property {any} generation
 * @property {any} validation
 * @property {any} preview
 */
/**
 * Salva resposta em múltiplos formatos
 *
 * @param {string} taskId - Task ID
 * @param {SaveResponseV2ResponseData} responseData - Response V2 data
 * @param {{ attemptId?: string | null; writeLegacyLatest?: boolean }} [opts]
 * @param {SaveResponseV2Options} [opts]
 * @returns {Promise<any>} - { textFile, markdownFile, jsonFile, htmlFile, legacy?: {textFile, markdownFile, jsonFile,
 *   htmlFile} }
 */
async function saveResponseV2(taskId, responseData, opts = {}) {
    try {
        const RESPONSE_DIR = _responseDir();
        // Criar diretório se não existe
        await fs.mkdir(RESPONSE_DIR, { recursive: true });

        const attemptId = opts?.attemptId ? String(opts.attemptId) : null;
        const basePath = attemptId
            ? path.join(RESPONSE_DIR, taskId, attemptId)
            : path.join(RESPONSE_DIR, taskId, 'latest');
        await fs.mkdir(path.dirname(basePath), { recursive: true });

        // Salvar cada formato (atomic writes)
        await Promise.all([
            // 1. Texto plano (compatibilidade V1)
            atomicWrite(`${basePath}.txt`, responseData.content.text, 'utf-8'),

            // 2. Markdown (estruturado)
            atomicWrite(`${basePath}.md`, responseData.content.markdown, 'utf-8'),

            // 3. JSON (dados estruturados + metadata completo)
            atomicWrite(`${basePath}.json`, JSON.stringify(responseData, null, 2), 'utf-8'),

            // 4. HTML (renderizável)
            atomicWrite(`${basePath}.html`, wrapHTML(responseData.content.html, taskId), 'utf-8'),
        ]);

        logger.info(
            `[RESPONSE_STORE_V2] Resposta salva em 4 formatos para task ${taskId}`,
            /** @type {any} */ ({
                textSize: responseData.content.text.length,
                markdownSize: responseData.content.markdown.length,
                htmlSize: responseData.content.html.length,
                codeBlocks: responseData.content.json.codeBlocks?.length || 0,
            }),
        );

        /**
         * @type {{
         *     textFile: string;
         *     markdownFile: string;
         *     jsonFile: string;
         *     htmlFile: string;
         *     legacy?: { textFile: string; markdownFile: string; jsonFile: string; htmlFile: string };
         * }}
         */
        const out = {
            textFile: `${basePath}.txt`,
            markdownFile: `${basePath}.md`,
            jsonFile: `${basePath}.json`,
            htmlFile: `${basePath}.html`,
        };

        // Best-effort legacy mirror (task-scoped) for backwards compatibility.
        const writeLegacyLatest = opts?.writeLegacyLatest !== false;
        if (writeLegacyLatest) {
            try {
                await fs.mkdir(LEGACY_RESPONSE_DIR, { recursive: true });
                const legacyBase = path.join(LEGACY_RESPONSE_DIR, taskId);
                await Promise.all([
                    atomicWrite(`${legacyBase}.txt`, responseData.content.text, 'utf-8'),
                    atomicWrite(`${legacyBase}.md`, responseData.content.markdown, 'utf-8'),
                    atomicWrite(`${legacyBase}.json`, JSON.stringify(responseData, null, 2), 'utf-8'),
                    atomicWrite(`${legacyBase}.html`, wrapHTML(responseData.content.html, taskId), 'utf-8'),
                ]);
                out.legacy = {
                    textFile: `${legacyBase}.txt`,
                    markdownFile: `${legacyBase}.md`,
                    jsonFile: `${legacyBase}.json`,
                    htmlFile: `${legacyBase}.html`,
                };
            } catch (/** @type {any} */ _) {
                /* ignore */
            }
        }

        return out;
    } catch (/** @type {any} */ error) {
        logger.error(
            '[RESPONSE_STORE_V2] Erro ao salvar resposta',
            /** @type {any} */ ({
                taskId,
                error: /** @type {any} */ (error).message,
                stack: /** @type {any} */ (error).stack,
            }),
        );
        throw new Error(`Falha ao salvar resposta V2: ${/** @type {any} */ (error).message}`); // eslint-disable-line preserve-caught-error
    }
}

/** @typedef {any} LoadResponseV2Options */
/**
 * Carrega resposta (backward compatible)
 *
 * @param {string} taskId - Task ID
 * @param {string} format - Formato desejado ('text', 'markdown', 'json', 'html')
 * @param {{ attemptId?: string | null }} [opts]
 * @param {LoadResponseV2Options} [opts]
 * @returns {Promise<string | object>} - Conteúdo da resposta
 */
async function loadResponseV2(taskId, format, opts = {}) {
    format = format || 'text';

    const RESPONSE_DIR = _responseDir();
    const attemptId = opts?.attemptId ? String(opts.attemptId) : null;
    const basePath = attemptId ? path.join(RESPONSE_DIR, taskId, attemptId) : path.join(RESPONSE_DIR, taskId, 'latest');
    const formatMap = {
        text: `${basePath}.txt`,
        markdown: `${basePath}.md`,
        json: `${basePath}.json`,
        html: `${basePath}.html`,
    };

    const filePath = /** @type {any} */ (formatMap)[format];

    if (!filePath) {
        throw new Error(`Formato inválido: ${format}. Use 'text', 'markdown', 'json' ou 'html'.`);
    }

    try {
        // Carrega formato solicitado
        if (format === 'json') {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        }

        return await fs.readFile(filePath, 'utf-8');
    } catch (/** @type {any} */ err) {
        // Fallback para .txt (compatibilidade V1)
        if (format !== 'text') {
            logger.warn(
                `[RESPONSE_STORE_V2] Formato ${format} não encontrado, fallback para .txt`,
                /** @type {any} */ ({
                    taskId,
                    requestedFormat: format,
                }),
            );
            return await loadResponseV2(taskId, 'text', opts);
        }

        // Arquivo não existe
        logger.error(
            '[RESPONSE_STORE_V2] Resposta não encontrada',
            /** @type {any} */ ({
                taskId,
                format,
                filePath,
            }),
        );
        return /** @type {any} */ (null);
    }
}

/**
 * Lista formatos disponíveis para task
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<string[]>} - Formatos disponíveis
 */
async function listAvailableFormats(taskId) {
    const basePath = path.join(_responseDir(), taskId, 'latest');
    const formats = ['text', 'markdown', 'json', 'html'];
    const available = [];

    for (const format of formats) {
        const filePath = `${basePath}.${format === 'text' ? 'txt' : format}`;
        try {
            await fs.access(filePath);
            available.push(format);
        } catch (/** @type {any} */ err) {
            // Arquivo não existe
        }
    }

    return available;
}

/**
 * Verifica se resposta V2 existe
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<boolean>}
 */
async function responseExists(taskId) {
    const basePath = path.join(_responseDir(), taskId, 'latest');
    const txtPath = `${basePath}.txt`;

    try {
        await fs.access(txtPath);
        return true;
    } catch (/** @type {any} */ err) {
        return false;
    }
}

/**
 * Deleta resposta (todos os formatos)
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<number>} - Número de arquivos deletados
 */
async function deleteResponseV2(taskId) {
    const basePath = path.join(_responseDir(), taskId, 'latest');
    const extensions = ['txt', 'md', 'json', 'html'];
    let deletedCount = 0;

    for (const ext of extensions) {
        const filePath = `${basePath}.${ext}`;
        try {
            await fs.unlink(filePath);
            deletedCount++;
        } catch (/** @type {any} */ err) {
            // Arquivo não existe (ok)
        }
    }

    if (deletedCount > 0) {
        logger.info(
            `[RESPONSE_STORE_V2] Resposta deletada para task ${taskId}`,
            /** @type {any} */ ({
                filesDeleted: deletedCount,
            }),
        );
    }

    return deletedCount;
}

/**
 * Wraps HTML com template completo (renderizável)
 *
 * @private
 * @param {string} htmlContent - HTML snippet
 * @param {string} taskId - Task ID
 * @returns {string} - HTML completo
 */
function wrapHTML(htmlContent, taskId) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Response - ${taskId}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            max-width: 900px;
            margin: 2rem auto;
            padding: 0 2rem;
            color: #333;
        }
        pre {
            background: #f5f5f5;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            background: #f0f0f0;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Monaco', 'Courier New', monospace;
        }
        pre code {
            background: none;
            padding: 0;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1rem 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 0.5rem;
            text-align: left;
        }
        th {
            background: #f0f0f0;
            font-weight: bold;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        .metadata {
            background: #f9f9f9;
            border-left: 4px solid #0066cc;
            padding: 1rem;
            margin: 1rem 0;
            font-size: 0.9rem;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="metadata">
        <strong>Task ID:</strong> ${taskId}<br>
        <strong>Generated:</strong> ${new Date().toISOString()}<br>
        <strong>Format:</strong> Response Capture V2.0
    </div>
    <div class="content">
        ${htmlContent}
    </div>
</body>
</html>`;
}

export { deleteResponseV2, listAvailableFormats, loadResponseV2, responseExists, saveResponseV2 };
