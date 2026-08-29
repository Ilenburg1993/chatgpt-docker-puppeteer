// @ts-check
/**
 * Low-residency ESLint profile for the VS Code language server.
 *
 * The canonical ESLint configuration is now intentionally syntax/architecture-only and does not construct a TypeScript
 * semantic graph. Type-aware promise safety belongs to the TS7 Oxlint/tsgolint CLI lane, so the editor can reuse the
 * canonical ESLint config directly without a compatibility parser, Project Service, or duplicate semantic residency.
 */

import canonicalConfig from './eslint.config.mjs';

export default canonicalConfig;
