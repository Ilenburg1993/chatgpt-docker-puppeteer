import { describe, expect, it } from 'vitest';
import {
    parsePrometheusMetrics,
    summarizeCloudflaredMetrics,
} from '../../../../src/copilot/mcp/cloudflare/metrics.js';

describe('mcp/cloudflare/metrics', () => {
    it('parses and summarizes cloudflared Prometheus metrics', () => {
        const samples = parsePrometheusMetrics(`
# HELP build_info Build and version information
# TYPE build_info gauge
build_info{goversion="go1.26.2",revision="2026-05-13-11:24 UTC",version="2026.5.0"} 1
cloudflared_orchestration_config_version 2
cloudflared_config_local_config_pushes 0
cloudflared_config_local_config_pushes_errors 0
cloudflared_rpc_client_latency_secs_count{handler="registration",method="register_connection"} 4
`);

        expect(samples).toHaveLength(5);
        expect(summarizeCloudflaredMetrics(samples)).toMatchObject({
            build: {
                version: '2026.5.0',
                revision: '2026-05-13-11:24 UTC',
                goVersion: 'go1.26.2',
            },
            orchestration: {
                configVersion: 2,
                localConfigPushes: 0,
                localConfigPushErrors: 0,
            },
            connections: {
                registerConnectionCount: 4,
            },
        });
    });
});
