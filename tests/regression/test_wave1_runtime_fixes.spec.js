import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

async function read(relPath) {
    return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

test('wave1: main.js uses invoked Promise in SSOT race', async () => {
    const content = await read('src/main.js');

    assert.match(
        content,
        /Promise\.race\(\[\s*\/\/ Inicialização normal\s*\(async\s*\(\)\s*=>/m,
        'SSOT initialization must use invoked async IIFE'
    );
    assert.doesNotMatch(
        content,
        /Promise\.race\(\[\s*\/\/ Inicialização normal\s*async\s*\(\)\s*=>/m,
        'SSOT initialization must not pass async function reference to Promise.race'
    );
});

test('wave1: main.js stores real shutdown promise', async () => {
    const content = await read('src/main.js');

    assert.match(
        content,
        /_shutdownPromise\s*=\s*\(async\s*\(\)\s*=>/m,
        '_shutdownPromise must be assigned to an invoked async IIFE'
    );
    assert.doesNotMatch(
        content,
        /_shutdownPromise\s*=\s*async\s*\(\)\s*=>/m,
        '_shutdownPromise must not hold an async function reference'
    );
});

test('wave1: server engine uses ESM constants import for TLS options', async () => {
    const content = await read('src/server/engine/server.js');

    assert.match(content, /from 'node:constants'/, 'TLS constants must be imported via ESM');
    assert.doesNotMatch(content, /require\('node:constants'\)/, 'require must not be used in ESM module');
});

test('wave1: persistServerState publishes with nerv instance', async () => {
    const content = await read('src/server/main.js');
    assert.match(
        content,
        /publishServerReady\(nerv,\s*payload\)/,
        'persistServerState must pass the NERV instance to Discovery.publishServerReady'
    );
});

test('wave1: connectExternal performs explicit handshake and exposes sendToClient', async () => {
    const content = await read('src/server/engine/socket.js');

    assert.match(content, /clientSocket\.emit\('handshake:present'/, 'split mode must emit handshake:present');
    assert.match(content, /handshake:authorized/, 'split mode must wait for handshake:authorized');
    assert.match(content, /handshake:rejected/, 'split mode must handle handshake rejection');
    assert.match(content, /sendToClient:\s*\(/, 'connectExternal adapter must expose sendToClient');
});

test('wave1: env bootstrap centralized and duplicate dotenv load removed', async () => {
    const mainContent = await read('src/main.js');
    const serverMainContent = await read('src/server/main.js');
    const configContent = await read('src/core/config.js');
    const envBootstrapContent = await read('src/core/env_bootstrap.js');

    assert.match(mainContent, /env_bootstrap/, 'main.js must import env bootstrap');
    assert.match(serverMainContent, /env_bootstrap/, 'server/main.js must import env bootstrap');
    assert.match(configContent, /env_bootstrap/, 'config.js must import env bootstrap');
    assert.doesNotMatch(mainContent, /dotenv\.config\(/, 'main.js must not call dotenv.config directly');
    assert.doesNotMatch(serverMainContent, /dotenv\.config\(/, 'server/main.js must not call dotenv.config directly');
    assert.match(envBootstrapContent, /override:\s*true/, '.env.local must load with override=true');
});

test('wave1: env validator allows disabled server mode', async () => {
    const content = await read('src/core/env_validator.js');
    assert.match(content, /'disabled'/, 'SERVER_MODE validator must allow disabled');
});

