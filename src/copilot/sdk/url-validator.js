// @ts-check
/**
 * src/copilot/sdk/url-validator.js
 *
 * Shim de compatibilidade — re-exporta de `core/security/url-validator.js`.
 * FC-1: SSOT movido para `core/security/` para reuso entre agentes, sdk e tools.
 *
 * @deprecated Importe diretamente de `#copilot/core/security/url-validator`
 * @module copilot/sdk/url-validator
 */

export { validateUrl, validateUrlString } from '#copilot/core/security/url-validator';
