---
name: 'JavaScript Guidelines'
description: 'Regras específicas para arquivos JS/TS'
applyTo: '**/*.{js,ts,mjs}'
---

# Convenções JavaScript/TypeScript

- Use `// @ts-check` em módulos JS.
- Valide parâmetros de funções públicas.
- Prefira `const`/`let` em vez de `var`.
- Faça tipagem completa STRICT FULL, com JSDoc completo.
- Evite usar `any` quando possível.
- Utilize interfaces para definir contratos de objetos.
- Documente funções, classes e módulos com comentários JSDoc.
- Adote ESLint e Prettier para manter consistência de estilo.
- Use `async/await` em vez de callbacks quando possível.
- Utilize importações ES6 (`import`/`export`) em lugar de `require`/`module.exports`.
- Configure `strict` no `tsconfig.json` e habilite checagens como `noImplicitAny` e
  `strictNullChecks`.
- Evite `console.log` em código de produção; prefira um logger configurável.
- Mantenha os exports nomeados e evite `default` exports sempre que possível.
- Adote convenções de nomenclatura consistentes (camelCase para variáveis/funções, PascalCase para
  classes/interfaces).
