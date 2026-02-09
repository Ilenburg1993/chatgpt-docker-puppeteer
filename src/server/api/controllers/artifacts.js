// @ts-check
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '#core/logger';
import { getArtifactById } from '#infra/db/artifact_repo';
import { _resolveArtifactsRoot, readText, stat as statArtifact } from '#infra/storage/artifact_store';
import { ok, fail } from '../utils/api_envelope.js';

const router = express.Router();

function _isUnderRoot(rootDir, filePath) {
    try {
        const root = path.resolve(rootDir);
        const full = path.resolve(filePath);
        return full === root || full.startsWith(root + path.sep);
    } catch (_) {
        return false;
    }
}

router.get('/:id', async (req, res) => {
    try {
        const artifactId = String(req.params.id);
        const row = getArtifactById(artifactId);
        if (!row) {
            return fail(res, req, 404, { code: 'ARTIFACT_NOT_FOUND', error: 'Artefato não encontrado' });
        }

        const withStat = await statArtifact(artifactId);
        ok(res, req, { artifact: withStat }, {});
    } catch (err) {
        log('ERROR', `[API_ARTIFACTS] metadata failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'ARTIFACT_METADATA_FAILED', error: 'Erro ao recuperar artefato', details: err?.message || String(err) });
    }
});

router.get('/:id/content', async (req, res) => {
    try {
        const artifactId = String(req.params.id);
        const row = getArtifactById(artifactId);
        if (!row) {
            return fail(res, req, 404, { code: 'ARTIFACT_NOT_FOUND', error: 'Artefato não encontrado' });
        }

        const root = _resolveArtifactsRoot();
        const uri = String(row.storage_uri || '');
        if (!uri || !_isUnderRoot(root, uri)) {
            return fail(res, req, 404, { code: 'ARTIFACT_UNAVAILABLE', error: 'Artefato indisponível' });
        }

        let st = null;
        try {
            st = fs.statSync(uri);
        } catch (_) {
            st = null;
        }
        if (!st || !st.isFile()) {
            return fail(res, req, 404, { code: 'ARTIFACT_UNAVAILABLE', error: 'Artefato indisponível' });
        }

        const disposition = req.query.disposition ? String(req.query.disposition) : 'inline';
        const safeDisposition = disposition === 'attachment' ? 'attachment' : 'inline';

        res.setHeader('Content-Type', String(row.mime || 'application/octet-stream'));
        res.setHeader('Content-Length', String(st.size));
        res.setHeader('Content-Disposition', `${safeDisposition}; filename="${artifactId}"`);

        const stream = fs.createReadStream(uri);
        stream.on('error', err => {
            log('WARN', `[API_ARTIFACTS] stream error for ${artifactId}: ${err?.message || String(err)}`, req.id);
            if (!res.headersSent) {
                res.status(500).end();
            } else {
                res.end();
            }
        });
        stream.pipe(res);
    } catch (err) {
        log('ERROR', `[API_ARTIFACTS] content failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'ARTIFACT_CONTENT_FAILED', error: 'Erro ao baixar artefato', details: err?.message || String(err) });
    }
});

router.get('/:id/text', async (req, res) => {
    try {
        const artifactId = String(req.params.id);
        const row = getArtifactById(artifactId);
        if (!row) {
            return fail(res, req, 404, { code: 'ARTIFACT_NOT_FOUND', error: 'Artefato não encontrado' });
        }

        const maxChars = Math.max(1000, Math.min(Number(req.query.max_chars) || 50000, 500000));
        const text = await readText(artifactId);
        if (text === null) {
            return fail(res, req, 404, { code: 'ARTIFACT_UNAVAILABLE', error: 'Artefato indisponível' });
        }

        const truncated = text.length > maxChars;
        ok(
            res,
            req,
            {
                artifact_id: artifactId,
                mime: row.mime,
                text: truncated ? text.slice(0, maxChars) : text,
                text_truncated: truncated,
            },
            { max_chars: maxChars }
        );
    } catch (err) {
        log('ERROR', `[API_ARTIFACTS] text failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'ARTIFACT_TEXT_FAILED', error: 'Erro ao ler artefato', details: err?.message || String(err) });
    }
});

export default router;

