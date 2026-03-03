# Contract Layering

Canonical choices in this repository:

- JSDoc: public JS APIs and file-local contracts
- `.d.ts`: shared static contracts reused across modules
- JSON Schema: reports, manifests, CI/tool envelopes
- Zod: runtime validation where executable validation is required
- `ts.server.protocol`: semantic source for tsserver operation names and behavior

The rule is not to collapse these layers into one tool.

Use the smallest correct layer for the specific consumer.
