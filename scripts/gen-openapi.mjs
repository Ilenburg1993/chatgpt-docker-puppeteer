#!/usr/bin/env node
// @ts-check
/**
 * Wrapper de compatibilidade para o gerador canônico.
 *
 * Uso recomendado:
 *
 *     node scripts/generate-openapi.mjs --output src/copilot/server/routes/openapi.json
 *
 * @deprecated Use `scripts/generate-openapi.mjs`.
 */

await import('./generate-openapi.mjs');
