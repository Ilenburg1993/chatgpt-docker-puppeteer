import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        // Precompressed assets for production (served by the server when available)
        compression({
            algorithms: ['brotliCompress', 'gzip'],
            exclude: [/\.(br)$/, /\.(gz)$/]
        }),
        process.env.ANALYZE === 'true'
            ? visualizer({
                open: false,
                filename: 'dist/stats.html',
                gzipSize: true,
                brotliSize: true,
            })
            : null
    ].filter(Boolean),

    // Base path para servir em /dashboard
    base: '/dashboard/',

    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },

    server: {
        port: 5173,
        host: '0.0.0.0', // Docker-compatible: accepts external connections (container → host)
        strictPort: true, // Fail-fast if port occupied (DevContainer expects 5173)
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
        cssCodeSplit: true, // Separate CSS per chunk for better caching
        rollupOptions: {
            output: {
                manualChunks: {
                    // Only libs actually installed (verified in package.json)
                    'vue-vendor': ['vue', 'vue-router', 'pinia'],
                    'charts': ['chart.js'],
                    'ui': ['radix-vue', 'lucide-vue-next', 'class-variance-authority', 'clsx', 'tailwind-merge'],
                    'vis': ['vis-timeline', 'vis-data', 'vis-network'],
                    'utils': ['axios', 'lodash-es', 'date-fns', 'uuid'],
                },
                assetFileNames: (assetInfo) => {
                    const info = assetInfo.name.split('.');
                    const extType = info[info.length - 1];
                    if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(assetInfo.name)) {
                        return `assets/images/[name]-[hash][extname]`;
                    }
                    if (/\.(woff2?|eot|ttf|otf)$/i.test(assetInfo.name)) {
                        return `assets/fonts/[name]-[hash][extname]`;
                    }
                    return `assets/[name]-[hash][extname]`;
                },
            },
        },
    },
});
