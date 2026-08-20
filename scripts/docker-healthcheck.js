#!/usr/bin/env node
// @ts-check
/**
 * Healthcheck script para uso no HEALTHCHECK do Dockerfile de produção.
 *
 * Verifica se o servidor HTTP está respondendo na porta configurada (default: 3008). Retorna exit code 0 se saudável, 1
 * caso contrário.
 *
 * Uso no Dockerfile: HEALTHCHECK CMD node scripts/docker-healthcheck.js
 *
 * @module docker-healthcheck
 * @file scripts/docker-healthcheck.js
 */

import http from 'node:http';

/** @type {number} */
const port = Number(process.env['PORT']) || 3008;

/** @type {http.RequestOptions} */
const options = {
    hostname: '127.0.0.1',
    port,
    path: '/health',
    method: 'GET',
    timeout: 8000,
};

const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
        process.exit(0);
    } else {
        process.stderr.write(`[healthcheck] HTTP ${res.statusCode} from /health — unhealthy\n`);
        process.exit(1);
    }
});

req.on('error', (err) => {
    process.stderr.write(`[healthcheck] Request failed: ${err.message}\n`);
    process.exit(1);
});

req.on('timeout', () => {
    process.stderr.write(`[healthcheck] Request timed out after 8s\n`);
    req.destroy();
    process.exit(1);
});

req.end();
