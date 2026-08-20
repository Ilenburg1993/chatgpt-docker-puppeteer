# tsserver Wrapper Contract

The repository does not use raw `tsserver` JSON over stdio as the user-facing contract.

Instead, it preserves an opt-in wrapper over the native TypeScript 7 LSP with a smaller operation set defined by:

- [`schemas/typing/tsserver-tool-contract.schema.json`](../../../../schemas/typing/tsserver-tool-contract.schema.json)
- [`src/integration/lsp/tsgo-lsp-daemon.mjs`](../../../../src/integration/lsp/tsgo-lsp-daemon.mjs)

Authoritative semantic source:

- `@typescript/native` 7.x
- `tsc --lsp --stdio`
- standard LSP methods mapped by the local compatibility layer

Rule:

- keep the wrapper schema aligned with the daemon;
- keep the skill docs aligned with both;
- do not document operations that do not exist in the daemon dispatch table.
- keep the wrapper disabled by default; editor navigation belongs to the direct TS7 service.
