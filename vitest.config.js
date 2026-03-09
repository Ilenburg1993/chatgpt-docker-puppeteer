import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true, // allow `describe/it` without import if desired
        environment: 'node', // running in Node.js
        include: ['tests/**/*.spec.js'],
        coverage: {
            provider: 'v8', // use v8 coverage (built into Node.js)
            reporter: ['text', 'html'],
        },
        watch: false, // default behaviour; use `vitest` CLI for watch mode
        // by default Vitest will transform ESM sources; project is native ESM
    },
});
