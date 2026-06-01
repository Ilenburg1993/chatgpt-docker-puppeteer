# MCP payload latency upgrade — 2026-05-31

## Why

The latest benchmark shows `public.mcp_tools_list` latency is materially affected by the transfer/download phase, not only origin CPU or Cloudflare time-to-first-byte.

Observed pattern:

- local `tools/list` p50: about 9 ms
- public `tools/list` p50: about 278 ms
- public `tools/list` TTFB p50: about 71 ms
- public `tools/list` download p50: about 169 ms
- decoded payload: about 101 KB

`/mcp` must not be Cloudflare-cached because it is POST JSON-RPC and may be authenticated or request-specific. The safe path is to measure transport/framing effects, then compact tool descriptors without reducing tool count.

## Changes

1. Adds latency probes:
   - `public.mcp_tools_list_json_accept`
   - `public.mcp_tools_list_identity_encoding`

2. Adds a local payload audit:
   - `npm run copilot:mcp:tool-payload:audit`

3. Keeps production behavior unchanged:
   - no stateful sessions
   - no `/mcp` cache
   - no tool removal

## Commands

```bash
cd /workspaces/chatgpt-docker-puppeteer

npm run typecheck:strict:src.copilot
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp
npm run lint:copilot

npm run copilot:mcp:tool-payload:audit

COPILOT_MCP_LATENCY_WARMUP_SAMPLES=2 \
COPILOT_MCP_LATENCY_SAMPLES=30 \
npm run copilot:mcp:latency:benchmark
```

## How to interpret

- If `json_accept` is faster, the `Accept: text/event-stream` path is adding framing/proxy overhead.
- If `identity_encoding` is faster, Brotli compression/decompression is not worth it for this response path.
- If both are similar, prioritize compact descriptors and Cloudflare/tunnel transport stability.
