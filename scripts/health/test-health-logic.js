// @ts-nocheck
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
process.chdir(ROOT);

async function testHealthLogic() {
    console.log('='.repeat(50));
    console.log('TESTANDO LÓGICA DOS HEALTH ENDPOINTS');
    console.log('='.repeat(50));
    console.log('');

    // Test 1: Chrome Health
    console.log('📡 1. Chrome Health Logic');
    try {
        const doctor = await import('#core/doctor').then(m => m.default ?? m);
        const config = await import('../config.json').then(m => m.default ?? m);

        const chrome = await doctor.probeChromeConnection();

        console.log('   ✓ Chrome connection probe:', chrome.connected ? 'CONNECTED' : 'DISCONNECTED');
        console.log(
            '   ✓ Endpoint:',
            chrome.endpoint || `http://${config.CHROME_PROXY_HOST}:${config.CHROME_PROXY_PORT}/json/version`
        );
        console.log('   ✓ Version:', chrome.version || 'N/A');
        console.log('   ✓ Latency:', chrome.latency_ms, 'ms');
        console.log('   ✓ Configured port:', config.CHROME_PROXY_PORT);
        console.log('   ✓ Mode:', config.BROWSER_MODE);
        console.log('');
    } catch (e) {
        console.log('   ✗ Error:', e.message);
        console.log('');
    }

    // Test 2: PM2 Health
    console.log('📡 2. PM2 Health Logic');
    try {
        const system = await import('#infra/system').then(m => m.default ?? m);

        const status = await system.getAgentStatus();

        console.log('   ✓ Agent status:', status.agent);
        console.log('   ✓ Server status:', status.server);

        // Try to list PM2 processes
        try {
            const pm2 = await import('pm2').then(m => m.default ?? m);
            const allProcesses = await new Promise((resolve, reject) => {
                pm2.list((err, list) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(
                            list.map(proc => ({
                                name: proc.name,
                                status: proc.pm2_env.status,
                                pid: proc.pid,
                                memory: Math.floor(proc.monit.memory / 1024 / 1024) + 'MB',
                                cpu: proc.monit.cpu + '%',
                            }))
                        );
                    }
                });
            });

            console.log('   ✓ Total processes:', allProcesses.length);
            console.log('   ✓ Online processes:', allProcesses.filter(p => p.status === 'online').length);
            if (allProcesses.length > 0) {
                console.log('   ✓ Processes:');
                allProcesses.forEach(p => {
                    console.log(`      - ${p.name}: ${p.status} (PID ${p.pid}, ${p.memory}, CPU ${p.cpu})`);
                });
            }
        } catch (listErr) {
            console.log('   ⚠ Cannot list PM2 processes:', listErr.message);
        }
        console.log('');
    } catch (e) {
        console.log('   ✗ Error:', e.message);
        console.log('');
    }

    // Test 3: Disk Health
    console.log('📡 3. Disk Health Logic');
    try {
        const fs = await import('node:fs').then(m => m.default ?? m);
        const { execSync } = await import('node:child_process');

        const getDirSize = dirPath => {
            try {
                if (!fs.existsSync(dirPath)) {
                    return 0;
                }
                const output = execSync(`du -sb "${dirPath}"`, { encoding: 'utf-8' });
                return parseInt(output.split('\t')[0]);
            } catch {
                return 0;
            }
        };

        const countFiles = dirPath => {
            try {
                if (!fs.existsSync(dirPath)) {
                    return 0;
                }
                return fs.readdirSync(dirPath).length;
            } catch {
                return 0;
            }
        };

        const logsSize = getDirSize(path.join(ROOT, 'logs'));
        const queueSize = getDirSize(path.join(ROOT, 'fila'));
        const responsesSize = getDirSize(path.join(ROOT, 'respostas'));
        const totalSize = logsSize + queueSize + responsesSize;

        const logsCount = countFiles(path.join(ROOT, 'logs'));
        const queueCount = countFiles(path.join(ROOT, 'fila'));
        const responsesCount = countFiles(path.join(ROOT, 'respostas'));

        console.log('   ✓ Logs:', Math.floor(logsSize / 1024 / 1024) + 'MB', `(${logsCount} files)`);
        console.log('   ✓ Queue:', Math.floor(queueSize / 1024 / 1024) + 'MB', `(${queueCount} files)`);
        console.log('   ✓ Responses:', Math.floor(responsesSize / 1024 / 1024) + 'MB', `(${responsesCount} files)`);
        console.log('   ✓ Total:', Math.floor(totalSize / 1024 / 1024) + 'MB');

        // Alertas
        const warningThreshold = 500 * 1024 * 1024;
        const criticalThreshold = 1024 * 1024 * 1024;

        if (totalSize > criticalThreshold) {
            console.log('   ⚠ CRITICAL: Disk usage exceeds 1GB!');
        } else if (totalSize > warningThreshold) {
            console.log('   ⚠ WARNING: Disk usage exceeds 500MB');
        } else {
            console.log('   ✓ Disk status: HEALTHY');
        }
        console.log('');
    } catch (e) {
        console.log('   ✗ Error:', e.message);
        console.log('');
    }

    // Test 4: Kernel Health (simplified without NERV)
    console.log('📡 4. Kernel Health Logic (Simplified)');
    try {
        const io = await import('#infra/io').then(m => m.default ?? m);
        const { STATUS_VALUES } = await import('#core/constants/tasks');

        const tasks = await io.loadAllTasks();
        const runningTasks = tasks.filter(t => t.status === STATUS_VALUES.RUNNING).length;

        console.log('   ✓ Total tasks:', tasks.length);
        console.log('   ✓ Running tasks:', runningTasks);
        console.log('   ✓ Kernel state:', runningTasks > 0 ? 'RUNNING' : 'IDLE');
        console.log('');
    } catch (e) {
        console.log('   ✗ Error:', e.message);
        console.log('');
    }

    console.log('='.repeat(50));
    console.log('✓ Health logic tests completed!');
    console.log('='.repeat(50));

    // Força saída do processo (file watcher mantém event loop ativo)
    process.exit(0);
}

testHealthLogic().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
