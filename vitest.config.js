import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true, // allow `describe/it` without import if desired
        environment: 'node', // running in Node.js
        include: ['tests/**/*.spec.js'],
        coverage: {
            provider: 'c8', // use the existing c8 dependency for coverage
            reporter: ['text', 'html'],
        },
        watch: false, // default behaviour; use `vitest` CLI for watch mode
        // by default Vitest will transform ESM sources; project is native ESM
    },
});
