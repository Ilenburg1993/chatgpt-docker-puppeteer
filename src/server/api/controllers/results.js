// @ts-check
import { log } from '#core/logger';
import { getArtifactById } from '#infra/db/artifact_repo';
import { getAttemptById } from '#infra/db/task_attempt_repo';
import { getTaskById } from '#infra/db/task_repo';
import * as io from '#infra/io';
import { _isUnderRoot, _resolveArtifactsRoot } from '#infra/storage/artifact_store';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

/** Constante/valor exportado: default. */
const router = express.Router();
const fsp = fs.promises;

function _safeId(/** @type {any} */ raw) {
    const id = String(raw || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (id.includes('..')) throw new Error('invalid id');
    return id;
}

function _pickAttemptArtifactId(/** @type {any} */ attempt, /** @type {any} */ ext) {
    if (!attempt || typeof attempt !== 'object') return null;
    if (ext === '.txt') return attempt.response_text_artifact_id || null;
    if (ext === '.md') return attempt.response_md_artifact_id || null;
    if (ext === '.json') return attempt.response_v2_json_artifact_id || null;
    if (ext === '.html') return attempt.response_html_artifact_id || null;
    return attempt.response_text_artifact_id || null;
}

function _contentTypeForExt(/** @type {any} */ ext) {
    if (ext === '.json') return 'application/json; charset=utf-8';
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.md') return 'text/markdown; charset=utf-8';
    return 'text/plain; charset=utf-8';
}

/**
 * GET /api/results/:id Streams the latest (or selected attempt) result content without exposing file paths.
 *
 * Query:
 *
 * - attempt?: correlationId
 * - format?: text|markdown|md|json|html
 * - disposition?: inline|attachment
 */
router.get('/:id', async (req, res) => {
    const requestId = req.id;
    try {
        const taskId = _safeId(req.params.id);
        const attemptIdRaw = req.query?.attempt ? String(req.query.attempt) : null;
        const attemptId = attemptIdRaw ? _safeId(attemptIdRaw) : null;
        const format = req.query?.format ? String(req.query.format).toLowerCase().trim() : 'text';

        const extByFormat = {
            text: '.txt',
            markdown: '.md',
            md: '.md',
            json: '.json',
            html: '.html',
        };
        const ext = /** @type {Record<string, string>} */ (extByFormat)[format] || '.txt';

        const artifactsRoot = _resolveArtifactsRoot();
        const legacyRoot = io.RESPONSE_DIR;

        /** @type {string | null} */
        let filePath = null;

        // Attempt-scoped resolution (preferred)
        if (attemptId) {
            const attempt = getAttemptById(attemptId);
            if (!attempt || attempt.task_id !== taskId) {
                return res.status(404).json({ success: false, error: 'Attempt não encontrado', request_id: requestId });
            }

            const artId = _pickAttemptArtifactId(attempt, ext);
            if (artId) {
                const art = getArtifactById(artId);
                const uri = art?.storage_uri || null;
                if (uri && _isUnderRoot(artifactsRoot, uri)) {
                    filePath = uri;
                }
            }

            if (!filePath) {
                // Predictable attempt-scoped fallback under artifacts root.
                const predicted = path.join(artifactsRoot, 'responses', taskId, `${attemptId}${ext}`);
                if (_isUnderRoot(artifactsRoot, predicted)) {
                    filePath = predicted;
                }
            }
        } else {
            // Latest attempt resolution from SSOT task row (best-effort)
            const task = getTaskById(taskId);
            const storage = /** @type {any} */ (task)?.result_db?.storage || null;
            if (storage) {
                const candidate =
                    ext === '.txt'
                        ? storage.text_file
                        : ext === '.md'
                          ? storage.markdown_file
                          : ext === '.json'
                            ? storage.json_file
                            : storage.html_file;
                if (candidate && (typeof candidate === 'string' || typeof candidate === 'number')) {
                    const p = String(candidate);
                    if (_isUnderRoot(artifactsRoot, p) || _isUnderRoot(legacyRoot, p)) {
                        filePath = p;
                    }
                }
            }
        }

        // Legacy fallback (task-scoped)
        if (!filePath) {
            const legacy = path.join(legacyRoot, `${taskId}.txt`);
            if (_isUnderRoot(legacyRoot, legacy)) {
                filePath = legacy;
            }
        }

        if (!filePath) {
            return res.status(404).json({ success: false, error: 'Resultado indisponível', request_id: requestId });
        }

        if (!(_isUnderRoot(artifactsRoot, filePath) || _isUnderRoot(legacyRoot, filePath))) {
            return res.status(404).json({ success: false, error: 'Resultado indisponível', request_id: requestId });
        }

        try {
            await fsp.access(filePath);
        } catch (/** @type {any} */ _) {
            return res.status(404).json({ success: false, error: 'Resultado indisponível', request_id: requestId });
        }

        const disposition = req.query.disposition ? String(req.query.disposition) : 'inline';
        const safeDisposition = disposition === 'attachment' ? 'attachment' : 'inline';

        res.setHeader('Content-Type', _contentTypeForExt(ext));
        res.setHeader(
            'Content-Disposition',
            `${safeDisposition}; filename="${taskId}${attemptId ? `-${attemptId}` : ''}${ext}"`,
        );

        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            log('ERROR', `[API_RESULTS] stream error for ${taskId}: ${err?.message || String(err)}`, requestId);
            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    error: 'Erro na transmissão do arquivo.',
                    request_id: requestId,
                });
            } else {
                return res.end();
            }
        });
        stream.pipe(res);
        return;
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[API_RESULTS] download failed: ${_e?.message || String(_e)}`, requestId);
        return res
            .status(500)
            .json({ success: false, error: 'Falha no download do resultado.', request_id: requestId });
    }
});

export default router;
