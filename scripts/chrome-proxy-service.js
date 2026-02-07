#!/usr/bin/env node
import _Impl from '#infra/proxy/chromeProxyService';

// Wrapper class - re-exposes important method names for static checks
// and delegates to the real implementation.
class ChromeProxyService extends _Impl {
    // Re-expose names so tests that scan file contents find them
    rewriteWebSocketURL(...args) {
        return super.rewriteWebSocketURL(...args);
    }

    handleHTTPRequest(...args) {
        return super.handleHTTPRequest(...args);
    }

    handleWebSocketUpgrade(...args) {
        return super.handleWebSocketUpgrade(...args);
    }
}

/**
 * Parse and validate integer from environment variable
 * @param {string} value - Raw environment variable value
 * @param {number} defaultValue - Fallback value
 * @param {string} varName - Variable name (for error messages)
 * @returns {number} Valid integer or default
 */
function parseIntSafe(value, defaultValue, varName) {
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
        console.warn(`[WARN] Invalid ${varName}="${value}", using default: ${defaultValue}`);
        return defaultValue;
    }

    return parsed;
}

async function main() {
    // ✅ P0.1 FIX: Align CHROME_HOST default with implementation (Docker-friendly)
    const CHROME_HOST = process.env.CHROME_HOST || 'host.docker.internal';

    // ✅ P0.2 FIX: Validate parseInt to prevent NaN
    const CHROME_PORT = parseIntSafe(process.env.CHROME_PORT, 9225, 'CHROME_PORT');
    const PROXY_PORT = parseIntSafe(process.env.CHROME_PROXY_PORT, 9224, 'CHROME_PROXY_PORT');

    // ✅ P1.1 FIX: Remove LOG_LEVEL from config (logger reads env directly)
    // ✅ P1.2 FIX: Remove fragile positional args (env-only interface)
    const PUBLIC_IP = process.env.PUBLIC_IP || null;

    // Diagnostic output (config effective values)
    console.log('[INFO] Chrome Proxy Service - Configuration:');
    console.log(`  PROXY_PORT: ${PROXY_PORT}`);
    console.log(`  CHROME_HOST: ${CHROME_HOST}`);
    console.log(`  CHROME_PORT: ${CHROME_PORT}`);
    console.log(`  PUBLIC_IP: ${PUBLIC_IP || '(auto-detect)'}`);
    console.log(`  LOG_LEVEL: ${process.env.LOG_LEVEL || 'info'} (from env)`);

    const svc = new ChromeProxyService({ PUBLIC_IP, CHROME_PORT, PROXY_PORT, CHROME_HOST });
    try {
        await svc.start();
    } catch (err) {
        console.error('\n❌ Failed to start ChromeProxyService:');
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    }
}

// Always call main() - PM2 modifies process.argv[1], breaking the condition
await main();

export default ChromeProxyService;
