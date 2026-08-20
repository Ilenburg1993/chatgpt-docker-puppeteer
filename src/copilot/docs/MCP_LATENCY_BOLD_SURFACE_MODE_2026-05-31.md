# MCP latency bold surface mode — 2026-05-31

## Finding

The latest benchmark shows the most aggressive latency lever is no longer local CPU: it is the
advertised MCP tool surface and edge transfer behavior.

The connector has 94 tools. The payload audit showed input schemas dominate descriptor size. A
configurable tool-surface mode is the next structural optimization.

## Intended modes

- `COPILOT_MCP_TOOL_SURFACE=full`: existing behavior.
- `COPILOT_MCP_TOOL_SURFACE=latency`: advertise high-utility repo, git, validation, runtime and
  Cloudflare diagnostics while excluding very large batch/index/session families.
- `COPILOT_MCP_TOOL_SURFACE=minimal`: emergency tiny surface for fastest connection and debugging.

## Safety

This should filter only the advertised tool registry, not delete implementation files. Operators can
add back any tool with `COPILOT_MCP_TOOL_SURFACE_INCLUDE` or remove any tool with
`COPILOT_MCP_TOOL_SURFACE_EXCLUDE`.

## Status

The policy module was created in `src/copilot/mcp/tool-surface.js`. The host blocked the small
registry import patch several times, so the module is present but not yet wired into
`getCanonicalMcpTools()` in this run.
