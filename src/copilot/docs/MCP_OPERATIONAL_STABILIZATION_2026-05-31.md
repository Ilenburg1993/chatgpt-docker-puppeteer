# MCP Operational Stabilization — 2026-05-31

## Current stable baseline

The stable recovery point is the previous operational topology:

- Public connector URL: `https://mcp.aurelin.org/mcp`
- Cloudflare named/permanent tunnel: `workspace-mcp-dev`
- Remote tunnel origin service currently observed as `http://127.0.0.1:3333`
- Local MCP origin started by the project wrapper and logged to `src/copilot/.ai/cloudflare/mcp-http.log`
- `cloudflared` logged to `src/copilot/.ai/cloudflare/cloudflared.log`

The Cloudflare Origin CA certificate is valid and can be used later, but HTTP/2-to-origin must be promoted only after the wrapper, smoke, logs and remote Cloudflare config all agree on the same origin mode.

## Operator rule

Do not use `npm run copilot:mcp:http2` as the normal operating command. It is a foreground/debug command.

Normal operation must go through:

```bash
npm run copilot:mcp:cloudflare:up
npm run copilot:mcp:cloudflare:restart
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:smoke
```

## Recovery commands

Return to the stable HTTP/1 origin:

```bash
unset COPILOT_MCP_CLOUDFLARE_ORIGIN_URL
unset COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME
unset COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN
unset COPILOT_MCP_ORIGIN_TRANSPORT
npm run copilot:mcp:cloudflare:restart
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:smoke
```

If a system-managed `cloudflared` service is also running, avoid running a second foreground `cloudflared tunnel run` at the same time as the project wrapper.

## Required migration criteria before HTTP/2 becomes default

1. `cloudflare:up` and `cloudflare:restart` must print origin runtime details: transport, origin URL, origin server name, public MCP URL, log files and metrics URL.
2. `status` must distinguish configured tunnel state from process state and from direct foreground/manual `cloudflared` state.
3. `smoke` must capture origin protocol telemetry and fail clearly on mismatched mode.
4. Cloudflare remote config must show HTTPS origin before `originRequest.http2Origin=true` is accepted.
5. OAuth smoke must continue to pass with `COPILOT_MCP_AUTH_MODE=oauth` and `COPILOT_MCP_AUTH_ENFORCEMENT=all`.
6. Logs and metrics must be at least as visible as the former HTTP/1 flow.

## Current work-in-progress

The Cloudflare CLI wrapper is being updated to expose an explicit `origin` block in `up/restart` output and to preserve the old detached process/log apparatus. The HTTP/1 path remains the safe rollback until all gates above pass.
