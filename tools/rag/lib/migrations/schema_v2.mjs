// @ts-check
/**
 * Schema Migration Framework for RAG System
 *
 * This module provides the infrastructure for migrating RAG manifests and data
 * between schema versions. It enables the system to evolve while preserving
 * existing indexed data.
 *
 * ## Usage
 *
 * When schema changes are needed:
 * 1. Define a migration function in the MIGRATIONS map below
 * 2. Update SCHEMA_VERSION in contract.mjs
 * 3. The system will automatically apply migrations on manifest load
 *
 * ## Migration Function Signature
 *
 * async function(manifest, paths, db) {
 *   // Modify manifest structure
 *   // Optionally migrate DB data
 *   // Return updated manifest
 * }
 *
 * @example
 * // To add a new field in v2:
 * '1->2': async (manifest) => {
 *   manifest.schema_version = 2;
 *   manifest.new_field = 'default_value';
 *   return manifest;
 * }
 */

/**
 * Registry of all schema migrations
 * Key format: 'fromVersion->toVersion'
 *
 * Each migration receives:
 * - manifest: Current manifest object (will be mutated)
 * - paths: RAG paths object (for file operations if needed)
 * - db: LanceDB connection (null if DB not open yet)
 *
 * Must return: Updated manifest with new schema_version
 */
export const MIGRATIONS = {
    /**
     * Example migration from v1 to v2
     * (Not active - just demonstrates the pattern)
     *
     * Hypothetical changes:
     * - Add 'tags_indexed' boolean to track if tags are in use
     * - Add 'last_query_at' timestamp
     * - Rename 'embedding.base_url_default' to 'embedding.default_base_url'
     */
    // '1->2': async (manifest, paths, db) => {
    //   console.log('[RAG Migration] Migrating schema from v1 to v2...');
    //
    //   // Add new fields
    //   manifest.tags_indexed = false;
    //   manifest.last_query_at = null;
    //
    //   // Rename field (preserve value)
    //   if (manifest.embedding.base_url_default) {
    //     manifest.embedding.default_base_url = manifest.embedding.base_url_default;
    //     delete manifest.embedding.base_url_default;
    //   }
    //
    //   // Update version
    //   manifest.schema_version = 2;
    //
    //   console.log('[RAG Migration] Migration to v2 complete');
    //   return manifest;
    // },
    /**
     * Example migration from v2 to v3
     * (Not active - demonstrates chaining)
     *
     * Hypothetical changes:
     * - Split 'files' map into separate metadata file
     * - Add compression flag
     */
    // '2->3': async (manifest, paths, db) => {
    //   console.log('[RAG Migration] Migrating schema from v2 to v3...');
    //
    //   // Extract files to separate JSON
    //   const filesMetadata = manifest.files;
    //   const metadataPath = path.join(paths.indexDir, 'files_metadata.v3.json');
    //   await fs.writeFile(metadataPath, JSON.stringify(filesMetadata, null, 2), 'utf8');
    //
    //   // Replace with reference
    //   manifest.files_ref = 'files_metadata.v3.json';
    //   delete manifest.files;
    //
    //   // Add new field
    //   manifest.compression_enabled = false;
    //
    //   // Update version
    //   manifest.schema_version = 3;
    //
    //   console.log('[RAG Migration] Migration to v3 complete');
    //   return manifest;
    // }
};

/**
 * Apply migrations to bring manifest from current version to target version
 *
 * Supports both single-step and multi-step migrations:
 * - Direct: v1->v2 via MIGRATIONS['1->2']
 * - Chained: v1->v3 via MIGRATIONS['1->2'] then MIGRATIONS['2->3']
 *
 * @param {Object} manifest - Current manifest object
 * @param {number} targetVersion - Desired schema version
 * @param {Object} paths - RAG paths object
 * @param {Object|null} db - LanceDB connection (optional)
 * @returns {Promise<Object>} Updated manifest
 * @throws {Error} If no migration path exists
 */
export async function migrateManifest(manifest, targetVersion, paths, db = null) {
    const currentVersion = manifest.schema_version;

    if (currentVersion === targetVersion) {
        return manifest; // Already at target version
    }

    if (currentVersion > targetVersion) {
        throw new Error(
            `DOWNGRADE_NOT_SUPPORTED: Cannot downgrade schema from v${currentVersion} to v${targetVersion}.\n` +
                `Downgrades are not supported - please use 'npm run rag:reset -- --yes' and re-index.`
        );
    }

    console.log(`[RAG Migration] Starting migration: v${currentVersion} -> v${targetVersion}`);

    let current = currentVersion;
    let updatedManifest = manifest;

    // Apply migrations sequentially (supports chaining)
    while (current < targetVersion) {
        const nextVersion = current + 1;
        const migrationKey = `${current}->${nextVersion}`;

        if (!MIGRATIONS[migrationKey]) {
            // No migration defined - this is a breaking change
            throw new Error(
                `MIGRATION_NOT_FOUND: No migration defined for ${migrationKey}.\n` +
                    `This is a breaking schema change. You must reset the index:\n` +
                    `  npm run rag:reset -- --yes\n` +
                    `  npm run rag:index\n`
            );
        }

        console.log(`[RAG Migration] Applying migration: ${migrationKey}...`);
        updatedManifest = await MIGRATIONS[migrationKey](updatedManifest, paths, db);

        // Verify migration updated the version
        if (updatedManifest.schema_version !== nextVersion) {
            throw new Error(
                `MIGRATION_ERROR: Migration ${migrationKey} did not update schema_version to ${nextVersion}`
            );
        }

        current = nextVersion;
    }

    console.log(`[RAG Migration] Migration complete: now at v${targetVersion}`);
    return updatedManifest;
}

/**
 * Check if a migration path exists from current to target version
 *
 * @param {number} currentVersion - Current schema version
 * @param {number} targetVersion - Target schema version
 * @returns {boolean} True if migration path exists
 */
export function hasMigrationPath(currentVersion, targetVersion) {
    if (currentVersion === targetVersion) return true;
    if (currentVersion > targetVersion) return false; // Downgrades not supported

    let current = currentVersion;
    while (current < targetVersion) {
        const nextVersion = current + 1;
        const migrationKey = `${current}->${nextVersion}`;
        if (!MIGRATIONS[migrationKey]) {
            return false;
        }
        current = nextVersion;
    }

    return true;
}

/**
 * Get list of migrations that would be applied
 *
 * @param {number} currentVersion - Current schema version
 * @param {number} targetVersion - Target schema version
 * @returns {string[]} Array of migration keys (e.g., ['1->2', '2->3'])
 */
export function getMigrationPath(currentVersion, targetVersion) {
    if (currentVersion === targetVersion) return [];
    if (currentVersion > targetVersion) {
        throw new Error('Downgrades not supported');
    }

    const path = [];
    let current = currentVersion;

    while (current < targetVersion) {
        const nextVersion = current + 1;
        const migrationKey = `${current}->${nextVersion}`;
        path.push(migrationKey);
        current = nextVersion;
    }

    return path;
}
