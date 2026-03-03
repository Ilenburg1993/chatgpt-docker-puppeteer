# tsserver Wrapper Contract

The repository does not use raw `tsserver` JSON over stdio as the user-facing contract.

Instead, it exposes a local wrapper with a smaller operation set defined by:

- [`schemas/typing/tsserver-tool-contract.schema.json`](../../../../schemas/typing/tsserver-tool-contract.schema.json)
- [`src/integration/lsp/tsserver-daemon.mjs`](../../../../src/integration/lsp/tsserver-daemon.mjs)

Authoritative semantic source:

- `node_modules/typescript/lib/typescript.d.ts`
- namespace `ts.server.protocol`
- symbol `CommandTypes`

Rule:

- keep the wrapper schema aligned with the daemon;
- keep the skill docs aligned with both;
- do not document operations that do not exist in the daemon dispatch table.
