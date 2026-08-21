// @ts-check
/** Canonical rollback/pending filename grammar. */
export const SIDECAR_FILE_PATTERN = /^(\d+)-([a-f0-9]{64})-([0-9a-f-]{36})\.rollback$/;
export const PENDING_FILE_PATTERN = /^\.pending-(\d+)-(\d+)-([0-9a-f-]{36})$/;
