# Typing, Schema and tsserver Canon

This document is a focused reference for schema layering and the local `tsserver` wrapper.

The normative source of truth for typing and JSDoc governance is:

- [`TYPING_JSDOC_CANON.md`](./TYPING_JSDOC_CANON.md)

Use this file as a subsystem reference, not as a competing canon.

## Camadas de Contrato

- JSDoc: contrato estático direto em arquivos JS
- `.d.ts`: contrato estático compartilhado entre múltiplos módulos
- JSON Schema: contrato de artefatos JSON, relatórios, manifests e envelopes de tooling
- Zod: contrato de validação em runtime
- `ts.server.protocol`: fonte semântica oficial para operações e nomes do universo `tsserver`

## Quando Usar Cada Um

- Use JSDoc para APIs JS-first e contratos locais.
- Use `.d.ts` quando o mesmo tipo for reutilizado entre módulos.
- Use JSON Schema para qualquer JSON persistido/trocado por scripts, CI ou wrappers.
- Use Zod quando a validação precisa executar em runtime.
- Use `ts.server.protocol` como base semântica e documente só a camada wrapper local em schema.

## Exemplos do Repositório

- Relatório JSDoc: `schemas/typing/jsdoc-coverage-report.schema.json`
- Wrapper tsserver: `schemas/typing/tsserver-tool-contract.schema.json`
- Wrapper local: `src/integration/lsp/tsserver-daemon.mjs`
- Contrato auxiliar: `src/integration/lsp/tsserver-contract.d.ts`

## Fontes Oficiais

- TypeScript JSDoc reference
- TSConfig reference
- `checkJs` / `allowJs`
- TypeScript `tsserver` wiki
- `node_modules/typescript/lib/typescript.d.ts` (`ts.server.protocol`)

## Decisão de Fonte de Verdade

- Semântica TypeScript: `tsc` + documentação oficial + `typescript.d.ts`
- Contratos JS públicos: JSDoc + `.d.ts` auxiliar quando necessário
- Artefatos JSON: JSON Schema local e versionado
- Wrapper LSP local: schema local, sempre mapeado ao `ts.server.protocol`

## Related Documents

- [`TYPING_INDEX.md`](./TYPING_INDEX.md)
- [`TYPING_CONTRACT_MATRIX.md`](./TYPING_CONTRACT_MATRIX.md)
