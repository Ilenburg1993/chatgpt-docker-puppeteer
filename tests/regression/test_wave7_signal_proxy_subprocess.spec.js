// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

async function waitForOutput(/** @type {any} */ getOutput, /** @type {any} */ matcher, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const output = getOutput();
        if (matcher.test(output)) {
            return output;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout waiting for output: ${String(matcher)}`);
}

test('wave7: real SIGTERM with inline proxy active triggers single coordinated shutdown', async () => {
    const childScript = `
        import net from 'node:net';

        process.env['LOG_LEVEL'] = 'ERROR';
        process.env['NERV_INTEGRATION'] = 'false';

        const { __mainTestHooks } = await import('#main');
        const ChromeProxyService = (await import('#infra/proxy/chromeProxyService')).default;
        const { shutdown: shutdownDriverFactory } = await import('#driver/factory');

        function getFreePort() {
            return new Promise((resolve, reject) => {
                const server = net.createServer();
                server.once('error', reject);
                server.listen(0, '127.0.0.1', () => {
                    const address = server.address();
                    if (!address || typeof address === 'string') {
                        server.close(() => reject(new Error('Unable to resolve free port')));
                        return;
                    }

                    const { port } = address;
                    server.close(err => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(port);
                    });
                });
            });
        }

        const keepAlive = setInterval(() => {}, 1000);
        let exitCalls = 0;

        __mainTestHooks.cleanupSignalHandlers();
        __mainTestHooks.resetShutdownState();

        const proxyPort = await getFreePort();
        const proxy = new ChromeProxyService({
            PROXY_PORT: proxyPort,
            CHROME_HOST: '127.0.0.1',
            CHROME_PORT: 9225,
            PROXY_BIND: '127.0.0.1',
            ALLOWED_ORIGINS: ['http://localhost:3000'],
            AUTO_HANDLE_SIGNALS: false,
            LOG_LEVEL: 'ERROR'
        });

        let proxyStopCalls = 0;
        const originalStop = proxy.stop.bind(proxy);
        proxy.stop = async () => {
            proxyStopCalls += 1;
            console.log('W7_PROXY_STOP:' + String(proxyStopCalls));
            return originalStop();
        };

        await proxy.start();
        global.chromeProxy = proxy;

        process.exit = code => {
            exitCalls += 1;
            console.log('W7_EXIT:' + String(code) + ':' + String(exitCalls));

            Promise.resolve()
                .then(() => shutdownDriverFactory())
                .catch(() => {})
                .finally(async () => {
                    try {
                        if (global.chromeProxy && typeof global.chromeProxy.stop === 'function') {
                            await global.chromeProxy.stop().catch(() => {});
                            global.chromeProxy = null;
                        }
                    } catch {
                        // ignore
                    }

                    __mainTestHooks.cleanupSignalHandlers();
                    __mainTestHooks.resetShutdownState();
                    clearInterval(keepAlive);
                    process.exitCode = Number(code);
                });
        };

        __mainTestHooks.setupSignalHandlers({});
        console.log('W7_READY:' + String(proxyPort));
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    await waitForOutput(() => stdout, /W7_READY:/, 20000);

    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
        child.kill('SIGINT');
    } catch {
        // child may already be exiting
    }

    const [code, signal] = await Promise.race([
        once(child, 'exit'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting child exit')), 25000)),
    ]);

    assert.equal(signal, null, `subprocess should exit by code, stderr=${stderr}`);
    assert.equal(code, 0, `expected graceful exit code 0, stdout=${stdout}, stderr=${stderr}`);

    const exitMarkers = stdout.match(/W7_EXIT:/g) || [];
    assert.equal(exitMarkers.length, 1, `process.exit should be requested once, stdout=${stdout}`);
    assert.match(stdout, /W7_EXIT:0:1/, `expected success exit marker, stdout=${stdout}`);

    const proxyStopMarkers = stdout.match(/W7_PROXY_STOP:/g) || [];
    assert.equal(proxyStopMarkers.length, 1, `proxy stop should execute once, stdout=${stdout}`);
    assert.match(stdout, /W7_PROXY_STOP:1/, `expected single proxy stop marker, stdout=${stdout}`);
});

test('wave7: SIGUSR2 is wired to canonical shutdown path', async () => {
    const childScript = `
        process.env['LOG_LEVEL'] = 'ERROR';
        const { __mainTestHooks } = await import('#main');
        const { shutdown: shutdownDriverFactory } = await import('#driver/factory');

        const keepAlive = setInterval(() => {}, 1000);
        let exitCalls = 0;

        __mainTestHooks.cleanupSignalHandlers();
        __mainTestHooks.resetShutdownState();

        process.exit = code => {
            exitCalls += 1;
            console.log('W7_SIGUSR2_EXIT:' + String(code) + ':' + String(exitCalls));

            Promise.resolve()
                .then(() => shutdownDriverFactory())
                .catch(() => {})
                .finally(() => {
                    __mainTestHooks.cleanupSignalHandlers();
                    __mainTestHooks.resetShutdownState();
                    clearInterval(keepAlive);
                    process.exitCode = Number(code);
                });
        };

        __mainTestHooks.setupSignalHandlers({});
        console.log('W7_SIGUSR2_READY');
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    await waitForOutput(() => stdout, /W7_SIGUSR2_READY/, 15000);

    child.kill('SIGUSR2');

    const [code, signal] = await Promise.race([
        once(child, 'exit'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting child exit (SIGUSR2)')), 20000)),
    ]);

    assert.equal(signal, null, `subprocess should exit by code, stderr=${stderr}`);
    assert.equal(code, 0, `expected graceful exit code 0, stdout=${stdout}, stderr=${stderr}`);

    const exitMarkers = stdout.match(/W7_SIGUSR2_EXIT:/g) || [];
    assert.equal(exitMarkers.length, 1, `SIGUSR2 shutdown should trigger single exit, stdout=${stdout}`);
    assert.match(stdout, /W7_SIGUSR2_EXIT:0:1/, `expected SIGUSR2 success marker, stdout=${stdout}`);
});
