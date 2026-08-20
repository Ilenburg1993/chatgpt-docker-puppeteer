// @ts-check
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';

// https://vite.dev/config/
/** Reexport público: default. */
export default defineConfig({
    plugins: /** @type {any} */ ([
        vue(),
        // Precompressed assets for production (served by the server when available)
        compression({
            algorithms: ['brotliCompress', 'gzip'],
            exclude: [/\.(br)$/, /\.(gz)$/],
        }),
        process.env['ANALYZE'] === 'true'
            ? visualizer({
                  open: false,
                  filename: 'dist/stats.html',
                  gzipSize: true,
                  brotliSize: true,
              })
            : null,
    ]).filter(Boolean),

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
                manualChunks: (id) => {
                    // Vendor libraries
                    if (id.includes('node_modules')) {
                        if (id.includes('vue') || id.includes('vue-router') || id.includes('pinia')) {
                            return 'vue-vendor';
                        }
                        if (id.includes('chart.js') || id.includes('chartjs')) {
                            return 'charts';
                        }
                        if (id.includes('vis-timeline') || id.includes('vis-data') || id.includes('vis-network')) {
                            return 'vis';
                        }
                        if (
                            id.includes('radix-vue') ||
                            id.includes('lucide-vue-next') ||
                            id.includes('class-variance-authority') ||
                            id.includes('clsx') ||
                            id.includes('tailwind-merge')
                        ) {
                            return 'ui';
                        }
                        if (
                            id.includes('axios') ||
                            id.includes('lodash-es') ||
                            id.includes('date-fns') ||
                            id.includes('uuid')
                        ) {
                            return 'utils';
                        }
                        // Other node_modules go to vendor
                        return 'vendor';
                    }

                    // Application code splitting
                    if (id.includes('/views/')) {
                        // Split each view into its own chunk for better caching
                        const viewName = (id.split('/views/')[1] ?? '').split('.')[0] ?? '';
                        return `view-${viewName.toLowerCase()}`;
                    }

                    if (id.includes('/components/')) {
                        if (id.includes('/charts/') || id.includes('/graphs/')) {
                            return 'charts-components';
                        }
                        if (id.includes('/ui/')) {
                            return 'ui-components';
                        }
                    }
                    return undefined;
                },
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.name ?? 'asset';
                    if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(name)) {
                        return `assets/images/[name]-[hash][extname]`;
                    }
                    if (/\.(woff2?|eot|ttf|otf)$/i.test(name)) {
                        return `assets/fonts/[name]-[hash][extname]`;
                    }
                    return `assets/[name]-[hash][extname]`;
                },
            },
        },
    },
});
