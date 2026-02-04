import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
    plugins: [vue()],

    // Base path para servir em /dashboard
    base: '/dashboard/',

    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },

    server: {
        port: 5173,
        host: '127.0.0.1', // CRITICAL: VS Code port forwarding does not support IPv6
        strictPort: false,
        // HMR Configuration for DevContainer
        hmr: {
            clientPort: 5173,
            host: 'localhost', // Critical for Windows → Container
        },
        // Watch Configuration for Docker Volumes
        watch: {
            usePolling: true, // Required for Docker volumes
            interval: 100,
        },
        proxy: {
            '/api': {
                target: 'http://localhost:3008',
                changeOrigin: true,
                secure: false,
            },
            '/socket.io': {
                target: 'http://localhost:3008',
                changeOrigin: true,
                ws: true,
            },
        },
    },

    build: {
        outDir: 'dist',
        sourcemap: false,
        minify: 'esbuild',
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vue-vendor': ['vue', 'vue-router', 'pinia'],
                    charts: ['chart.js', 'vue-chartjs', 'd3'],
                    ui: ['element-plus'],
                },
            },
        },
    },
});
