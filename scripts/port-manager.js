#!/usr/bin/env node
/**
 * PORT MANAGER - Centralized Port Conflict Detection & Resolution
 *
 * Features:
 * - Detects port conflicts automatically
 * - Resolves conflicts using alternative ports
 * - Shows process info (PID, name) for occupied ports
 * - Generates detailed logs
 * - Can be used standalone or imported as module
 *
 * Usage:
 *   node scripts/port-manager.js check              # Check all ports
 *   node scripts/port-manager.js check 9224         # Check specific port
 *   node scripts/port-manager.js resolve            # Auto-resolve conflicts
 *   node scripts/port-manager.js kill 9224          # Kill process on port
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG_PATH = path.join(__dirname, '../config/ports.json');
const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'port-manager.log');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Load port configuration
let portsConfig;
try {
    portsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (error) {
    console.error('[ERROR] Failed to load ports.json:', error.message);
    process.exit(1);
}

// ============================================================================
// LOGGING
// ============================================================================

function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const _logEntry = {
        timestamp,
        level,
        message,
        ...data
    };

    // Console output
    const color = {
        info: '\x1b[36m', // Cyan
        success: '\x1b[32m', // Green
        warn: '\x1b[33m', // Yellow
        error: '\x1b[31m', // Red
        reset: '\x1b[0m'
    };

    console.log(`${color[level] || ''}[${level.toUpperCase()}] ${message}${color.reset}`);
    if (Object.keys(data).length > 0) {
        console.log('  ', JSON.stringify(data, null, 2));
    }

    // File output
    if (portsConfig.logging?.enabled) {
        const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message} ${JSON.stringify(data)}\n`;
        fs.appendFileSync(LOG_FILE, logLine);
    }
}

// ============================================================================
// PORT CHECKING (Cross-platform)
// ============================================================================

async function checkPort(port) {
    const isWindows = process.platform === 'win32';

    try {
        if (isWindows) {
            // Windows: netstat
            const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`);
            const lines = stdout
                .trim()
                .split('\n')
                .filter(line => line.includes('LISTENING'));

            if (lines.length === 0) {
                return { port, available: true };
            }

            // Extract PID
            const pidMatch = lines[0].match(/\s+(\d+)\s*$/);
            if (!pidMatch) {
                return { port, available: false, pid: null };
            }

            const pid = pidMatch[1];

            // Get process name
            try {
                const { stdout: taskOutput } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`);
                const processName = taskOutput.split(',')[0].replace(/"/g, '').trim();

                return {
                    port,
                    available: false,
                    pid: parseInt(pid),
                    process: processName
                };
            } catch {
                return { port, available: false, pid: parseInt(pid), process: 'Unknown' };
            }
        } else {
            // Linux/Mac: lsof
            const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null || true`);
            const pid = stdout.trim();

            if (!pid) {
                return { port, available: true };
            }

            // Get process name
            try {
                const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null || echo Unknown`);
                const processName = psOutput.trim();

                return {
                    port,
                    available: false,
                    pid: parseInt(pid),
                    process: processName
                };
            } catch {
                return { port, available: false, pid: parseInt(pid), process: 'Unknown' };
            }
        }
    } catch {
        // Port is available (no output from netstat/lsof)
        return { port, available: true };
    }
}

// ============================================================================
// PORT RESOLUTION
// ============================================================================

async function findAvailablePort(primaryPort, alternatives) {
    log('info', `Finding available port (primary: ${primaryPort})`);

    // Check primary first
    const primaryCheck = await checkPort(primaryPort);
    if (primaryCheck.available) {
        log('success', `Primary port ${primaryPort} is available`);
        return primaryPort;
    }

    log('warn', `Primary port ${primaryPort} occupied`, {
        pid: primaryCheck.pid,
        process: primaryCheck.process
    });

    // Try alternatives
    for (const altPort of alternatives) {
        const altCheck = await checkPort(altPort);
        if (altCheck.available) {
            log('success', `Alternative port ${altPort} is available`);
            return altPort;
        }
    }

    // No available ports
    log('error', `No available ports found for ${primaryPort}`);
    return null;
}

// ============================================================================
// KILL PROCESS ON PORT
// ============================================================================

async function killProcessOnPort(port) {
    const portInfo = await checkPort(port);

    if (portInfo.available) {
        log('info', `Port ${port} is already free`);
        return true;
    }

    log('warn', `Killing process on port ${port}`, {
        pid: portInfo.pid,
        process: portInfo.process
    });

    const isWindows = process.platform === 'win32';

    try {
        if (isWindows) {
            await execAsync(`taskkill /PID ${portInfo.pid} /F`);
        } else {
            await execAsync(`kill -9 ${portInfo.pid}`);
        }

        log('success', `Process killed successfully`);

        // Wait a bit and verify
        await new Promise(resolve => setTimeout(resolve, 1000));
        const recheckInfo = await checkPort(port);

        if (recheckInfo.available) {
            log('success', `Port ${port} is now free`);
            return true;
        } else {
            log('error', `Port ${port} still occupied after kill attempt`);
            return false;
        }
    } catch (error) {
        log('error', `Failed to kill process on port ${port}`, { error: error.message });
        return false;
    }
}

// ============================================================================
// CHECK ALL PORTS
// ============================================================================

async function checkAllPorts() {
    log('info', 'Checking all configured ports...');

    const results = {};

    for (const [serviceName, serviceConfig] of Object.entries(portsConfig.ports)) {
        if (serviceName === 'reserved') continue;

        const portInfo = await checkPort(serviceConfig.primary);
        results[serviceName] = {
            port: serviceConfig.primary,
            ...portInfo,
            alternatives: serviceConfig.alternatives
        };
    }

    return results;
}

// ============================================================================
// AUTO-RESOLVE CONFLICTS
// ============================================================================

async function autoResolveConflicts() {
    log('info', 'Auto-resolving port conflicts...');

    const allPorts = await checkAllPorts();
    const resolutions = {};

    for (const [serviceName, portInfo] of Object.entries(allPorts)) {
        if (portInfo.available) {
            resolutions[serviceName] = {
                status: 'ok',
                port: portInfo.port
            };
            continue;
        }

        log('warn', `Conflict detected for ${serviceName}`, {
            port: portInfo.port,
            pid: portInfo.pid,
            process: portInfo.process
        });

        const config = portsConfig.ports[serviceName];
        const availablePort = await findAvailablePort(config.primary, config.alternatives);

        if (availablePort) {
            resolutions[serviceName] = {
                status: 'resolved',
                originalPort: portInfo.port,
                newPort: availablePort,
                conflict: { pid: portInfo.pid, process: portInfo.process }
            };
        } else {
            resolutions[serviceName] = {
                status: 'failed',
                port: portInfo.port,
                conflict: { pid: portInfo.pid, process: portInfo.process }
            };
        }
    }

    return resolutions;
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'check';

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  PORT MANAGER v1.0');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    try {
        switch (command) {
            case 'check': {
                if (args[1]) {
                    // Check specific port
                    const port = parseInt(args[1]);
                    const result = await checkPort(port);
                    console.log(`Port ${port}:`, result);
                } else {
                    // Check all ports
                    const results = await checkAllPorts();
                    console.table(results);
                }
                break;
            }

            case 'resolve': {
                const resolutions = await autoResolveConflicts();
                console.log('');
                console.log('Resolution Results:');
                console.table(resolutions);

                // Generate updated config
                const updatedConfig = { ...portsConfig };
                for (const [serviceName, resolution] of Object.entries(resolutions)) {
                    if (resolution.status === 'resolved') {
                        updatedConfig.ports[serviceName].primary = resolution.newPort;
                    }
                }

                const updatedConfigPath = path.join(__dirname, '../config/ports.resolved.json');
                fs.writeFileSync(updatedConfigPath, JSON.stringify(updatedConfig, null, 2));
                log('success', `Updated configuration saved to: ${updatedConfigPath}`);
                break;
            }

            case 'kill': {
                const port = parseInt(args[1]);
                if (!port) {
                    log('error', 'Port number required: node port-manager.js kill <port>');
                    process.exit(1);
                }
                await killProcessOnPort(port);
                break;
            }

            default:
                log('error', `Unknown command: ${command}`);
                console.log('');
                console.log('Usage:');
                console.log('  node port-manager.js check              # Check all ports');
                console.log('  node port-manager.js check <port>       # Check specific port');
                console.log('  node port-manager.js resolve            # Auto-resolve conflicts');
                console.log('  node port-manager.js kill <port>        # Kill process on port');
                console.log('');
                process.exit(1);
        }

        console.log('');
        log('info', `Logs saved to: ${LOG_FILE}`);
        console.log('');
    } catch (error) {
        log('error', 'Unexpected error', { error: error.message, stack: error.stack });
        process.exit(1);
    }
}

// ============================================================================
// EXPORTS (for use as module)
// ============================================================================

module.exports = {
    checkPort,
    checkAllPorts,
    findAvailablePort,
    killProcessOnPort,
    autoResolveConflicts,
    log
};

// ============================================================================
// RUN CLI
// ============================================================================

if (require.main === module) {
    main().catch(error => {
        console.error('[FATAL ERROR]', error);
        process.exit(1);
    });
}
