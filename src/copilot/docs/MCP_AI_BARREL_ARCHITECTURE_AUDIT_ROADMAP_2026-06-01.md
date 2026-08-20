# MCP and .ai Barrel Architecture Audit/Roadmap

Date: 2026-06-01

## Scope

This audit covers `src/copilot/mcp` and `src/copilot/.ai` after the validation baseline committed as
`de74d007` (`fix(copilot-mcp): stabilize validation baseline`).

The target is to bring MCP closer to the organized import/export architecture already used by areas
such as `src/copilot/tools`, `src/copilot/model-gateway`, `src/copilot/terminal`, and
`src/copilot/agent`: stable public barrels, explicit package import aliases, and direct file imports
only inside a tightly owned subdomain.

## Current State

### `src/copilot/mcp`

- `src/copilot/mcp/index.js` is a CLI entrypoint, not a barrel. This diverges from the rest of
  `src/copilot`, where `index.js` normally exposes the public module surface.
- There are no subdomain barrels for:
  - `adapters`
  - `cloudflare`
  - `connection`
  - `control-plane`
  - `openai`
  - `scripts`
  - `tools`
  - `tools/shared`
- Cross-subdomain imports are direct file imports, for example:
  - tools import `../control-plane/result.js`
  - adapters import `../control-plane/auth.js`
  - cloudflare CLI imports `../registry.js`
  - tests import deep implementation files under `src/copilot/mcp/...`
- `package.json#imports` has no canonical `#copilot/mcp` aliases. Existing aliases cover many
  organized Copilot domains, but MCP currently has to be reached by relative filesystem paths.
- `registry.js` is the composition hotspot. It imports individual tool files directly and therefore
  encodes internal layout details in the top-level MCP registration flow.
- CLI/runtime scripts are mixed with public library modules. Some scripts export testable functions
  and can be included in a scripts barrel, while process entrypoints should remain explicit.

### `src/copilot/.ai`

- `.ai` is not a JavaScript module tree. It is operational memory: audit logs, jobs, quarantine
  payloads, Cloudflare state, MCP OAuth persistence, temporary files, and a small tracked context
  document.
- Git tracks only `.gitkeep` files and `context-pack.md` in this directory. Runtime files are
  ignored by `.gitignore`.
- Since there are no JS/TS modules in `.ai`, a code barrel is not currently applicable. The
  architecture concern here is not import/export routing; it is data ownership, retention,
  redaction, and stable path constants in MCP.

## Ideal State

### MCP Public Surface

`src/copilot/mcp/index.js` should be barrel-only and side-effect free:

```js
export * from './server.js';
export * from './registry.js';
export * from './tool-surface.js';
export * from './adapters/index.js';
export * from './cloudflare/index.js';
export * from './connection/index.js';
export * from './control-plane/index.js';
export * from './openai/index.js';
export * from './scripts/index.js';
export * from './tools/index.js';
```

The process entrypoint should move to `src/copilot/mcp/cli.js`, and npm scripts should call that
file for `stdio`, `http`, and `http2`.

### Subdomain Barrels

Each MCP subdomain should own an explicit barrel:

- `adapters/index.js`: HTTP/1, HTTP/2, stdio, shared transport policy, protocol metrics.
- `cloudflare/index.js`: config, state, remote API, route expressions, metrics, edge
  audit/backup/policy, passthrough plans, origin-request profiles, skip posture, tunnel-origin
  plans. CLI remains an entrypoint and is not exported by default.
- `connection/index.js`: ChatGPT/Claude connector profiles, URL normalization, auth presentation,
  runbooks, HTTP/2-plus connector profile.
- `control-plane/index.js`: annotations, audit, auth, OAuth dev issuer, job runtime, metrics, paths,
  result contracts, smoke state, tool metadata, index auto-build.
- `openai/index.js`: secure tunnel readiness contract. CLI remains an entrypoint.
- `scripts/index.js`: exported script helpers used by tests and tools (`smoke-http`, `oauth-smoke`,
  `latency-benchmark`, `tool-payload-audit`, `run-safe-validation-suite`).
- `tools/index.js`: canonical MCP tool definitions grouped by operational role.
- `tools/shared/index.js`: small shared tool utilities such as Git execution.

### Package Aliases

Add canonical aliases:

- `#copilot/mcp`
- `#copilot/mcp/adapters`
- `#copilot/mcp/cloudflare`
- `#copilot/mcp/connection`
- `#copilot/mcp/control-plane`
- `#copilot/mcp/openai`
- `#copilot/mcp/scripts`
- `#copilot/mcp/tools`
- `#copilot/mcp/tools/shared`

Cross-subdomain imports should use these aliases. Direct relative imports remain acceptable only
within the same subdomain when importing private implementation siblings.

### `.ai` Ownership

`.ai` should remain a runtime data tree, not a code module:

- Keep runtime payloads ignored by Git.
- Keep `.gitkeep` contracts for directories that MCP expects to exist.
- Centralize path constants in MCP control-plane/config modules instead of scattering `.ai` string
  paths.
- Document retention and redaction expectations in MCP docs, not in `.ai` code barrels.

## Roadmap

1. Create the MCP architecture checkpoint.
   - Done by commit `de74d007` and push to `origin/main`.

2. Split MCP entrypoint from barrel.
   - Move CLI behavior from `src/copilot/mcp/index.js` to `src/copilot/mcp/cli.js`.
   - Convert `src/copilot/mcp/index.js` to a side-effect-free public barrel.
   - Update package scripts that launch MCP to call `cli.js`.

3. Add subdomain barrels.
   - Create `index.js` files for all MCP subdomains listed above.
   - Export stable functions/constants/tool definitions explicitly or with local `export *` where
     the module is already an intentional public contract.
   - Keep operational CLIs out of broad barrels unless they expose side-effect-free helpers.

4. Add MCP package aliases.
   - Extend `package.json#imports` with MCP aliases.
   - Prefer aliases for cross-subdomain imports and tests.

5. Rewire internal imports.
   - Update `registry.js` to consume `#copilot/mcp/control-plane` and `#copilot/mcp/tools`.
   - Update adapters, connection, cloudflare, tools, and scripts to import cross-domain contracts
     through aliases.
   - Keep same-subdomain sibling imports direct to avoid unnecessary barrel-induced cycles.

6. Rewire MCP tests.
   - Replace deep `../../../../src/copilot/mcp/...` imports with aliases and subdomain barrels.
   - Preserve direct imports only when a test intentionally exercises a private implementation file.

7. Validate economically.
   - Run `npm run typecheck:strict:src.copilot`.
   - Run `npm run lint:copilot`.
   - Run focused MCP tests, then broaden only if failures indicate cross-domain impact.
   - Run `npm run analyze:circular`.

8. Commit and push the architecture refactor.
   - Use a conventional commit message, likely `refactor(copilot-mcp): add barrel architecture`.

## Acceptance Criteria

- `src/copilot/mcp/index.js` is barrel-only and safe to import.
- MCP process startup goes through `src/copilot/mcp/cli.js`.
- MCP subdomains expose stable `index.js` barrels.
- Cross-subdomain MCP imports use `#copilot/mcp/...` aliases.
- Tests prefer public MCP aliases over deep source paths.
- `.ai` remains runtime data, with path ownership centralized in MCP modules and ignored runtime
  state preserved.
- Strict source typecheck, lint, focused tests, and circularity checks pass.
