import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import * as serverEngine from '#server/engine/server';

async function getFreePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = address.port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function withEnv(tempEnv, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(tempEnv)) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test('server engine falls back to HTTP in dev when FORCE_HTTPS=true and certs are missing', async () => {
    const port = await getFreePort();
    const result = await withEnv(
        {
            NODE_ENV: 'development',
            FORCE_HTTPS: 'true',
            SSL_KEY_PATH: path.join(process.cwd(), 'ssl', 'missing.key'),
            SSL_CERT_PATH: path.join(process.cwd(), 'ssl', 'missing.cert'),
        },
        async () => serverEngine.start(port)
    );

    try {
        assert.equal(result.protocol, 'HTTP');
    } finally {
        await serverEngine.stop(2000);
    }
});

test('server engine starts in HTTPS when FORCE_HTTPS=true and cert files exist', async () => {
    const port = await getFreePort();
    const result = await withEnv(
        {
            NODE_ENV: 'development',
            FORCE_HTTPS: 'true',
            SSL_KEY_PATH: path.join(process.cwd(), 'ssl', 'key.pem'),
            SSL_CERT_PATH: path.join(process.cwd(), 'ssl', 'cert.pem'),
        },
        async () => serverEngine.start(port)
    );

    try {
        assert.equal(result.protocol, 'HTTPS');
    } finally {
        await serverEngine.stop(2000);
    }
});
