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
 * @typedef {{
 *   id?: string,
 *   kind: string,
 *   mime: string,
 *   size_bytes: number,
 *   sha256?: string|null,
 *   storage_uri: string,
 *   created_at_ms?: number,
 *   created_by?: string|null,
 * }} ArtifactInsert
  * @returns {object|null}
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
    `
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
 * @returns {object|null}
 */
function getArtifactById(artifactId) {
    const db = getDb();
    return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) || null;
}

/**
 * Deletes an artifact record by ID. Returns the number of rows deleted (0 or 1).
 * @param {string} artifactId
 * @returns {number}
 */
function deleteArtifactById(artifactId) {
    const db = getDb();
    const result = db.prepare('DELETE FROM artifacts WHERE id = ?').run(artifactId);
    return result.changes;
}

export { insertArtifact, getArtifactById, deleteArtifactById };
