// @ts-check

import {
    MCP_LATENCY_CONFIG_DEFAULTS,
    MCP_LATENCY_CONFIG_SCHEMA_VERSION,
    createMcpLatencyRuntimeConfig,
    readMcpLatencyProcessConfig,
} from '#copilot/mcp/public/diagnostics/latency';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('MCP latency process configuration', () => {
    it('captures one immutable diagnostics generation and does not drift after source env mutation', () => {
        /** @type {NodeJS.ProcessEnv} */
        const env = {
            NODE_ENV: 'production',
            COPILOT_MCP_LATENCY_PUBLIC_URL: 'https://latency.example.com/mcp',
            COPILOT_MCP_LATENCY_LOCAL_URL: 'https://127.0.0.1:9443/mcp',
            COPILOT_MCP_LATENCY_SAMPLES: '12',
            COPILOT_MCP_LATENCY_TIMEOUT_MS: '4200',
            COPILOT_MCP_LATENCY_WARMUP_SAMPLES: '2',
            COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_ENABLED: 'true',
            COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_INTERVAL_MS: '120000',
            COPILOT_MCP_ROUND_TRIP_ANALYTICS_MONITOR_ENABLED: 'false',
            COPILOT_MCP_LATENCY_TOOL_AVERAGE_WARN_MS: '850',
            COPILOT_MCP_LATENCY_ERROR_RATE_WARN: '0.01',
        };

        const config = readMcpLatencyProcessConfig(env);
        env.COPILOT_MCP_LATENCY_SAMPLES = '99';
        env.COPILOT_MCP_LATENCY_TOOL_AVERAGE_WARN_MS = '9999';

        assert.equal(config.schemaVersion, MCP_LATENCY_CONFIG_SCHEMA_VERSION);
        assert.equal(config.benchmark.publicMcpUrl, 'https://latency.example.com/mcp');
        assert.equal(config.benchmark.localMcpUrl, 'https://127.0.0.1:9443/mcp');
        assert.equal(config.benchmark.samples, 12);
        assert.equal(config.benchmark.timeoutMs, 4200);
        assert.equal(config.benchmark.warmupSamples, 2);
        assert.equal(config.openAiMonitor.enabled, true);
        assert.equal(config.openAiMonitor.intervalMs, 120000);
        assert.equal(config.roundTripMonitor.enabled, false);
        assert.equal(config.dashboard.toolAverageWarnMs, 850);
        assert.equal(config.dashboard.errorRateWarn, 0.01);

        for (const value of [
            config,
            config.benchmark,
            config.openAiMonitor,
            config.roundTripMonitor,
            config.dashboard,
        ]) {
            assert.equal(Object.isFrozen(value), true);
        }
    });

    it('preserves benchmark fallback semantics and composes topology without importing Cloudflare into the owner', () => {
        const owner = readMcpLatencyProcessConfig({
            NODE_ENV: 'test',
            COPILOT_MCP_LATENCY_SAMPLES: '0',
            COPILOT_MCP_LATENCY_TIMEOUT_MS: '999999',
            COPILOT_MCP_LATENCY_WARMUP_SAMPLES: '-1',
        });
        const runtime = createMcpLatencyRuntimeConfig(owner, {
            localMcpUrl: 'https://127.0.0.1:9443/mcp',
            publicMcpUrl: 'https://mcp.example.com/mcp',
            publicHostname: 'mcp.example.com',
        });

        assert.equal(owner.benchmark.samples, MCP_LATENCY_CONFIG_DEFAULTS.benchmark.samples);
        assert.equal(owner.benchmark.timeoutMs, MCP_LATENCY_CONFIG_DEFAULTS.benchmark.timeoutMs);
        assert.equal(owner.benchmark.warmupSamples, MCP_LATENCY_CONFIG_DEFAULTS.benchmark.warmupSamples);
        assert.equal(owner.openAiMonitor.enabled, false);
        assert.equal(owner.roundTripMonitor.enabled, false);
        assert.equal(runtime.owner, owner);
        assert.equal(runtime.benchmark.publicMcpUrl, 'https://mcp.example.com/mcp');
        assert.equal(runtime.benchmark.localMcpUrl, 'https://127.0.0.1:9443/mcp');
        assert.equal(runtime.benchmark.localOriginServerName, 'mcp.example.com');
        assert.equal(Object.isFrozen(runtime), true);
        assert.equal(Object.isFrozen(runtime.benchmark), true);
    });
});
