// @ts-check
/**
 * Low-residency ESLint profile for the VS Code language server.
 *
 * The canonical `eslint.config.mjs` intentionally keeps type-aware rules enabled for CLI/CI. Those rules ask
 * typescript-eslint's projectService to build another TypeScript semantic graph, duplicating the editor language service
 * and retaining roughly a gigabyte on this repository. The editor needs fast structural feedback; semantic correctness
 * remains enforced by the canonical lint/typecheck gates.
 *
 * Keep this file as a derivation, not a fork: all canonical rules are inherited first and only type-aware execution is
 * disabled in the final layer.
 */

import tseslint from 'typescript-eslint';
import canonicalConfig from './eslint.config.mjs';

export default tseslint.config(
    ...canonicalConfig,
    {
        name: 'workspace/editor-disable-type-aware',
        files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            parserOptions: {
                project: false,
                projectService: false,
            },
        },
    },
);
