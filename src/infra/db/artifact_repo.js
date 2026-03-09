// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

function _now() {
    return Date.now();
}

function _makeArtifactId() {
    return `art_${uuidv4()}`;
}

/**
 * @typedef {object} ArtifactInsert
 * @property {string} [id] - ID do artefato (gerado se omitido)
 * @property {string} kind - Tipo do artefato
 * @property {string} mime - MIME type
 * @property {number} size_bytes - Tamanho em bytes
 * @property {string | null} [sha256] - Hash SHA-256
 * @property {string} storage_uri - URI de armazenamento
 * @property {number} [created_at_ms] - Timestamp de criação
 * @property {string | null} [created_by] - ID do criador
 */
/**
 * @param {ArtifactInsert} input
 * @returns {string | null}
 */

function insertArtifact(input) {
    const db = getDb();
    const id = input?.id || _makeArtifactId();
    const createdAtMs = Number.isFinite(Number(input?.created_at_ms)) ? Number(input.created_at_ms) : _now();

    db.prepare(
        `
        INSERT INTO artifacts (
            id, kind, mime, size_bytes, sha256, storage_uri, created_at_ms, created_by
        ) VALUES (
            @id, @kind, @mime, @size_bytes, @sha256, @storage_uri, @created_at_ms, @created_by
        )
    `,
    ).run({
        id,
        kind: String(input.kind),
        mime: String(input.mime || 'text/plain'),
        size_bytes: Number(input.size_bytes) || 0,
        sha256: input.sha256 ? String(input.sha256) : null,
        storage_uri: String(input.storage_uri),
        created_at_ms: createdAtMs,
        created_by: input.created_by ? String(input.created_by) : null,
    });

    return id;
}

/**
 * Função exportada: getArtifactById.
 *
 * @param {any} artifactId
 * @returns {any}
 */
function getArtifactById(artifactId) {
    const db = getDb();
    return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) || null;
}

/**
 * Deletes an artifact record by ID. Returns the number of rows deleted (0 or 1).
 *
 * @param {string} artifactId
 * @returns {number}
 */
function deleteArtifactById(artifactId) {
    const db = getDb();
    const result = db.prepare('DELETE FROM artifacts WHERE id = ?').run(artifactId);
    return result.changes;
}

export { deleteArtifactById, getArtifactById, insertArtifact };
