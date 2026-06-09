import { describe, expect, it } from 'vitest';
import {
    parsePrometheusMetrics,
    summarizeCloudflaredMetrics,
} from '#copilot/mcp/cloudflare';

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
quic_client_total_connections 4
quic_client_latest_rtt 0.018
quic_client_smoothed_rtt 0.02
quic_client_mtu 1350
quic_client_packet_too_big_dropped 0
`);

        expect(samples).toHaveLength(10);
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
            quic: {
                present: true,
                metricCount: 5,
                totalConnections: 4,
                latestRttMs: 18,
                smoothedRttMs: 20,
                mtu: 1350,
                packetTooBigDropped: 0,
            },
        });
    });
});
