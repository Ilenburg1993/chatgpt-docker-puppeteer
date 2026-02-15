# Contrato TS Server (Node 24 + ESM + NodeNext)

## Invariantes obrigatórios
1. `tsconfig.json` é canônico; `jsconfig.json` apenas herda.
2. `module=NodeNext` e `moduleResolution=NodeNext`.
3. Arquivos ESM usam `import/export`; sem `require/module.exports`.
4. Import relativo em ESM com extensão `.js`.
5. `allowJs=true` e `checkJs=true` para cobertura do código JS do projeto.
6. Tipos globais e augmentations em `src/types/**/*.d.ts`.

## Critérios de compatibilidade TS Server
1. Diagnóstico do editor deve ser reproduzível por `tsc -p tsconfig.json`.
2. Mudanças de `paths` no `tsconfig` devem refletir aliases runtime válidos.
3. Símbolos exportados/importados devem resolver sem ambiguidade CJS/ESM.
4. Ajustes em `jsconfig` não podem divergir semântica de `compilerOptions` canônicos.

## Anti-padrões
- Import sem extensão em arquivo ESM NodeNext.
- Tipo implícito em borda de API pública (handlers, adapters, services).
- Cast duplo (`/** @type {any} */ (...)`) para suprimir erro sem causa tratada.
- `@ts-ignore` sem justificativa e sem issue de rastreio.

## Checklist rápido
- `npm run -s typecheck:node`
- `npm run -s lint`
- `npm run -s test:unit`
