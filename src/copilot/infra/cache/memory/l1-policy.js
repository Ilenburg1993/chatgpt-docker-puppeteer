// @ts-check
/** Process-level L1 capacity/TTL/stale verification policy. */
import { readEnvIntAtLeast, readEnvPositiveInt } from '#copilot/infra/internal/platform';
export const IO_L1_TTL_MS = readEnvPositiveInt('IO_L1_CACHE_TTL_MS', 60_000);
export const IO_L1_MAX_ENTRIES = readEnvPositiveInt('IO_L1_CACHE_MAX_ENTRIES', 2_000);
export const IO_L1_MAX_BYTES = readEnvPositiveInt('IO_L1_CACHE_MAX_BYTES', 128 * 1024 * 1024);
export const IO_L1_HASH_REVALIDATE_MAX_BYTES = readEnvPositiveInt('IO_L1_HASH_REVALIDATE_MAX_BYTES', 1024 * 1024);
export const IO_L1_STALE_PROBE_INTERVAL_MS = readEnvIntAtLeast('IO_L1_STALE_PROBE_INTERVAL_MS', 2_000, -1);
