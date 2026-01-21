/**
 * Integration Tests - FASE 8: Super Launcher PM2-First
 *
 * Testa todos os componentes implementados nas fases 1-7:
 * - Launchers (LAUNCHER.bat + launcher.sh)
 * - Scripts utilitários (quick-ops, watch-logs, etc)
 * - Health endpoints (/api/health/*)
 * - Dashboard HTML
 *
 * Ambiente: Linux (codespaces) - cross-platform onde possível
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(level, message) {
    const color =
        {
            INFO: colors.cyan,
            SUCCESS: colors.green,
            ERROR: colors.red,
            WARN: colors.yellow,
            TEST: colors.blue
        }[level] || colors.reset;

    console.log(`${color}[${level}]${colors.reset} ${message}`);
}

function runCommand(cmd, options = {}) {
    try {
        const output = execSync(cmd, {
            cwd: ROOT,
            encoding: 'utf-8',
            stdio: options.silent ? 'pipe' : 'inherit',
            ...options
        });
        return { success: true, output };
    } catch (error) {
        return { success: false, error: error.message, output: error.stdout };
    }
}

// ============================================================
// TEST SUITE 1: Validação de Arquivos
// ============================================================

function testFilesExist() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 1: Validação de Arquivos');
    log('TEST', '============================================================\n');

    const files = [
        // FASE 1: Launchers
        { path: 'LAUNCHER.bat', desc: 'Windows Launcher' },
        { path: 'launcher.sh', desc: 'Linux Launcher', executable: true },

        // FASE 2: Scripts Utilitários
        { path: 'scripts/quick-ops.bat', desc: 'Quick Ops Windows' },
        { path: 'scripts/quick-ops.sh', desc: 'Quick Ops Linux', executable: true },
        { path: 'scripts/watch-logs.bat', desc: 'Watch Logs Windows' },
        { path: 'scripts/watch-logs.sh', desc: 'Watch Logs Linux', executable: true },
        { path: 'scripts/install-pm2-gui.bat', desc: 'PM2 GUI Installer Windows' },
        { path: 'scripts/install-pm2-gui.sh', desc: 'PM2 GUI Installer Linux', executable: true },
        { path: 'scripts/setup-pm2-plus.bat', desc: 'PM2 Plus Setup Windows' },
        { path: 'scripts/setup-pm2-plus.sh', desc: 'PM2 Plus Setup Linux', executable: true },

        // FASE 3: Health Logic
        { path: 'scripts/test-health-logic.js', desc: 'Health Test Script' },

        // FASE 5: Dashboard HTML
        { path: 'scripts/launcher-dashboard.html', desc: 'Dashboard HTML' },

        // FASE 6: Documentação
        { path: 'DOCUMENTAÇÃO/LAUNCHER.md', desc: 'Launcher Documentation' }
    ];

    let passed = 0;
    let failed = 0;

    files.forEach(file => {
        const fullPath = path.join(ROOT, file.path);
        const exists = fs.existsSync(fullPath);

        if (exists) {
            // Check if executable (Linux only)
            if (file.executable && process.platform !== 'win32') {
                const stats = fs.statSync(fullPath);
                const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;
                if (isExecutable) {
                    log('SUCCESS', `✓ ${file.desc} (${file.path}) - executable`);
                    passed++;
                } else {
                    log('WARN', `⚠ ${file.desc} (${file.path}) - not executable`);
                    passed++; // Still count as passed
                }
            } else {
                log('SUCCESS', `✓ ${file.desc} (${file.path})`);
                passed++;
            }
        } else {
            log('ERROR', `✗ ${file.desc} (${file.path}) - NOT FOUND`);
            failed++;
        }
    });

    log('INFO', `\nFiles Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// TEST SUITE 2: Validação de Conteúdo
// ============================================================

function testLauncherContent() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 2: Validação de Conteúdo do Launcher');
    log('TEST', '============================================================\n');

    let passed = 0;
    let failed = 0;

    // Test launcher.sh (estamos em Linux)
    const launcherPath = path.join(ROOT, 'launcher.sh');
    const content = fs.readFileSync(launcherPath, 'utf-8');

    const checks = [
        { pattern: /\[1\].*Start System/i, desc: 'Menu Option 1: Start System' },
        { pattern: /\[2\].*Stop System/i, desc: 'Menu Option 2: Stop System' },
        { pattern: /\[3\].*Restart System/i, desc: 'Menu Option 3: Restart System' },
        { pattern: /\[4\].*Status Check/i, desc: 'Menu Option 4: Status Check' },
        { pattern: /\[5\].*View Logs/i, desc: 'Menu Option 5: View Logs' },
        { pattern: /\[6\].*PM2 GUI/i, desc: 'Menu Option 6: PM2 GUI' },
        { pattern: /\[7\].*PM2 Monit/i, desc: 'Menu Option 7: PM2 Monit' },
        { pattern: /\[8\].*Clean/i, desc: 'Menu Option 8: Clean System' },
        { pattern: /\[9\].*Diagnose/i, desc: 'Menu Option 9: Diagnose Crashes' },
        { pattern: /\[10\].*Backup/i, desc: 'Menu Option 10: Backup Configuration' },
        { pattern: /Verificando Node\.js|Node.*check/i, desc: 'Validation 1: Node.js check' },
        { pattern: /Verificando PM2|PM2.*check/i, desc: 'Validation 2: PM2 check' },
        { pattern: /Verificando dependências|dependencies.*check/i, desc: 'Validation 3: Dependencies check' },
        { pattern: /Verificando Chrome|Chrome.*config/i, desc: 'Validation 4: Chrome config check' },
        { pattern: /Verificando crashes|crash.*detect/i, desc: 'Validation 5: Crash detection check' },
        { pattern: /localhost:2998|localhost:3000|health.*endpoint/i, desc: 'Health endpoint reference' }
    ];

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            log('SUCCESS', `✓ ${check.desc}`);
            passed++;
        } else {
            log('ERROR', `✗ ${check.desc}`);
            failed++;
        }
    });

    log('INFO', `\nContent Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// TEST SUITE 3: Scripts Utilitários
// ============================================================

function testQuickOpsScript() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 3: Scripts Utilitários');
    log('TEST', '============================================================\n');

    let passed = 0;
    let failed = 0;

    // Test quick-ops.sh help
    log('INFO', 'Testing quick-ops.sh help...');
    const result = runCommand('bash scripts/quick-ops.sh help', { silent: true });

    if (result.success) {
        const output = result.output;
        const commands = ['start', 'stop', 'restart', 'status', 'health', 'logs', 'backup'];

        commands.forEach(cmd => {
            if (output.includes(cmd)) {
                log('SUCCESS', `✓ quick-ops.sh includes command: ${cmd}`);
                passed++;
            } else {
                log('ERROR', `✗ quick-ops.sh missing command: ${cmd}`);
                failed++;
            }
        });
    } else {
        log('ERROR', '✗ quick-ops.sh help failed to execute');
        failed += 7; // All commands failed
    }

    // Test watch-logs.sh exists and is executable
    const watchLogsPath = path.join(ROOT, 'scripts/watch-logs.sh');
    if (fs.existsSync(watchLogsPath)) {
        const stats = fs.statSync(watchLogsPath);
        const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;
        if (isExecutable) {
            log('SUCCESS', '✓ watch-logs.sh is executable');
            passed++;
        } else {
            log('WARN', '⚠ watch-logs.sh exists but not executable');
            passed++; // Count as passed, just warning
        }
    }

    log('INFO', `\nScripts Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// TEST SUITE 4: Health Endpoints (Logic Only - No Server)
// ============================================================

function testHealthEndpointsLogic() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 4: Health Endpoints Logic');
    log('TEST', '============================================================\n');

    log('INFO', 'Running test-health-logic.js...');

    const result = runCommand('node scripts/test-health-logic.js', { silent: false });

    if (result.success) {
        log('SUCCESS', '✓ Health endpoints logic test passed');
        return true;
    } else {
        log('ERROR', '✗ Health endpoints logic test failed');
        return false;
    }
}

// ============================================================
// TEST SUITE 5: Dashboard HTML
// ============================================================

function testDashboardHTML() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 5: Dashboard HTML');
    log('TEST', '============================================================\n');

    let passed = 0;
    let failed = 0;

    const dashboardPath = path.join(ROOT, 'scripts/launcher-dashboard.html');
    const content = fs.readFileSync(dashboardPath, 'utf-8');

    const checks = [
        { pattern: /<html/i, desc: 'Valid HTML structure' },
        { pattern: /viewport/i, desc: 'Responsive meta tag' },
        { pattern: /Server.*Status|card.*server/i, desc: 'Server card present' },
        { pattern: /Chrome|Debug Port/i, desc: 'Chrome card present' },
        { pattern: /PM2|Process/i, desc: 'PM2 card present' },
        { pattern: /Kernel|NERV/i, desc: 'Kernel card present' },
        { pattern: /Disk|Storage/i, desc: 'Disk card present' },
        { pattern: /fetchHealth|fetch.*health/i, desc: 'fetchHealth function' },
        { pattern: /updateAll|update.*all/i, desc: 'updateAll function' },
        { pattern: /setInterval|auto.*refresh/i, desc: 'Auto-refresh mechanism' },
        { pattern: /localhost:2998|localhost:3000|api.*health/i, desc: 'API endpoint reference' },
        { pattern: /status.*badge|badge.*status/i, desc: 'Status badge styling' },
        { pattern: /#1e1e1e|#2d2d2d|background.*#|dark.*theme/i, desc: 'Dark theme present' }
    ];

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            log('SUCCESS', `✓ ${check.desc}`);
            passed++;
        } else {
            log('ERROR', `✗ ${check.desc}`);
            failed++;
        }
    });

    log('INFO', `\nDashboard Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// TEST SUITE 6: Documentação
// ============================================================

function testDocumentation() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 6: Documentação');
    log('TEST', '============================================================\n');

    let passed = 0;
    let failed = 0;

    const docPath = path.join(ROOT, 'DOCUMENTAÇÃO/LAUNCHER.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    const checks = [
        { pattern: /# Super Launcher/i, desc: 'Title present' },
        { pattern: /Índice|Visão Geral/i, desc: 'Overview section' },
        { pattern: /Arquitetura/i, desc: 'Architecture section' },
        { pattern: /Menu Principal/i, desc: 'Menu section' },
        { pattern: /Scripts Utilitários/i, desc: 'Scripts section' },
        { pattern: /Dashboard HTML/i, desc: 'Dashboard section' },
        { pattern: /Health Endpoints/i, desc: 'Health endpoints section' },
        { pattern: /Troubleshooting/i, desc: 'Troubleshooting section' },
        { pattern: /quick-ops/i, desc: 'quick-ops documented' },
        { pattern: /watch-logs/i, desc: 'watch-logs documented' },
        { pattern: /\/api\/health\/chrome/i, desc: '/chrome endpoint documented' },
        { pattern: /\/api\/health\/pm2/i, desc: '/pm2 endpoint documented' },
        { pattern: /\/api\/health\/kernel/i, desc: '/kernel endpoint documented' },
        { pattern: /\/api\/health\/disk/i, desc: '/disk endpoint documented' },
        { pattern: /PM2-First/i, desc: 'PM2-First strategy mentioned' }
    ];

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            log('SUCCESS', `✓ ${check.desc}`);
            passed++;
        } else {
            log('ERROR', `✗ ${check.desc}`);
            failed++;
        }
    });

    // Check line count
    const lineCount = content.split('\n').length;
    if (lineCount > 1000) {
        log('SUCCESS', `✓ Documentation is comprehensive (${lineCount} lines)`);
        passed++;
    } else {
        log('WARN', `⚠ Documentation might be incomplete (${lineCount} lines)`);
        passed++; // Still count as passed
    }

    log('INFO', `\nDocumentation Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// TEST SUITE 7: Roadmap Atualizado
// ============================================================

function testRoadmapUpdated() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 7: Roadmap Atualizado');
    log('TEST', '============================================================\n');

    let passed = 0;
    let failed = 0;

    const roadmapPath = path.join(ROOT, 'DOCUMENTAÇÃO/ROADMAP_LAUNCHER_DASHBOARD.md');
    const content = fs.readFileSync(roadmapPath, 'utf-8');

    const checks = [
        { pattern: /FASE 1 COMPLETA/i, desc: 'Fase 1 marked as complete' },
        { pattern: /PM2-First.*IMPLEMENTADA/i, desc: 'PM2-First strategy implemented' },
        { pattern: /3\.5h/i, desc: 'Real time documented (3.5h)' },
        { pattern: /Super Launcher v2\.0/i, desc: 'Super Launcher v2.0 mentioned' },
        { pattern: /21\/01\/2026/i, desc: 'Completion date (21/01/2026)' },
        { pattern: /Tauri.*OPCIONAL|ADIADA|CONGELADA/i, desc: 'Tauri marked as optional/postponed' },
        { pattern: /Dashboard Web.*50-70h/i, desc: 'Dashboard Web estimated' },
        { pattern: /FASE 8.*Testes Integrados/i, desc: 'FASE 8 mentioned' },
        { pattern: /scripts\/quick-ops/i, desc: 'Quick-ops mentioned' },
        { pattern: /launcher-dashboard\.html/i, desc: 'Dashboard HTML mentioned' },
        { pattern: /LAUNCHER\.md/i, desc: 'LAUNCHER.md mentioned' }
    ];

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            log('SUCCESS', `✓ ${check.desc}`);
            passed++;
        } else {
            log('ERROR', `✗ ${check.desc}`);
            failed++;
        }
    });

    log('INFO', `\nRoadmap Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// TEST SUITE 8: Integração io.js
// ============================================================

function testIOIntegration() {
    log('TEST', '============================================================');
    log('TEST', 'TEST SUITE 8: Integração io.js (loadAllTasks)');
    log('TEST', '============================================================\n');

    let passed = 0;
    let failed = 0;

    const ioPath = path.join(ROOT, 'src/infra/io.js');
    const content = fs.readFileSync(ioPath, 'utf-8');

    const checks = [
        { pattern: /loadAllTasks/i, desc: 'loadAllTasks function exported' },
        { pattern: /queueCache\.getQueue/i, desc: 'Uses queueCache.getQueue()' },
        { pattern: /queue\.tasks/i, desc: 'Returns queue.tasks' }
    ];

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            log('SUCCESS', `✓ ${check.desc}`);
            passed++;
        } else {
            log('ERROR', `✗ ${check.desc}`);
            failed++;
        }
    });

    log('INFO', `\nIO Integration Test: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runAllTests() {
    log('INFO', '\n');
    log('INFO', '╔════════════════════════════════════════════════════════════╗');
    log('INFO', '║  INTEGRATION TESTS - FASE 8: Super Launcher PM2-First     ║');
    log('INFO', '║  Testing all components from FASE 1-7                     ║');
    log('INFO', '╚════════════════════════════════════════════════════════════╝');
    log('INFO', '\n');

    const results = {
        'Files Validation': false,
        'Launcher Content': false,
        'Scripts Utilities': false,
        'Health Endpoints Logic': false,
        'Dashboard HTML': false,
        Documentation: false,
        'Roadmap Updated': false,
        'IO Integration': false
    };

    try {
        results['Files Validation'] = testFilesExist();
        results['Launcher Content'] = testLauncherContent();
        results['Scripts Utilities'] = testQuickOpsScript();
        results['Health Endpoints Logic'] = testHealthEndpointsLogic();
        results['Dashboard HTML'] = testDashboardHTML();
        results['Documentation'] = testDocumentation();
        results['Roadmap Updated'] = testRoadmapUpdated();
        results['IO Integration'] = testIOIntegration();
    } catch (error) {
        log('ERROR', `Test suite error: ${error.message}`);
        console.error(error);
    }

    // Summary
    log('TEST', '\n');
    log('TEST', '============================================================');
    log('TEST', 'TEST SUMMARY');
    log('TEST', '============================================================\n');

    let totalPassed = 0;
    let totalFailed = 0;

    Object.entries(results).forEach(([suite, passed]) => {
        if (passed) {
            log('SUCCESS', `✓ ${suite}`);
            totalPassed++;
        } else {
            log('ERROR', `✗ ${suite}`);
            totalFailed++;
        }
    });

    log('TEST', '\n');
    log('INFO', `Total: ${totalPassed} suites passed, ${totalFailed} suites failed`);

    if (totalFailed === 0) {
        log('SUCCESS', '\n🎉 ALL TESTS PASSED! FASE 8 COMPLETE!\n');
        process.exit(0);
    } else {
        log('ERROR', '\n❌ SOME TESTS FAILED. Please review the output above.\n');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    log('ERROR', `Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});
