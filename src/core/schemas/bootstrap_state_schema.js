// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { z } from 'zod';
import { TIMESTAMP_SCHEMA } from './shared_types.js';

/**
 * Schema do estado de bootstrap persistido para handoff entre processos/componentes.
 */
const BootstrapStateSchema = z
    .object({
        server_port: z.number().int().min(1).max(65535),
        server_pid: z.number().int().min(1),
        server_started_at: TIMESTAMP_SCHEMA,
        server_version: z.string()['regex'](/^V[0-9]+$/),
        protocol: z.number().int().min(1),
        mode: z.enum(['normal', 'degraded', 'maintenance']),
    })
    ['strict'](); // <-- PROIBIÇÃO DE CAMPOS EXTRAS

export { BootstrapStateSchema };
