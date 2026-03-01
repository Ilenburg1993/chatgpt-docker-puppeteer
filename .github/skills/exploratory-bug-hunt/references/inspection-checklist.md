# Inspection Checklist — Por Arquivo

Use este checklist ao ler cada arquivo na varredura exploratória.

## Metadados do Arquivo

- [ ] Arquivo usa `// @ts-check` ou é `.mjs`?
- [ ] Tem `export` de funções públicas sem JSDoc?
- [ ] Tem `require()` ou `module.exports` (CJS em projeto ESM)?

## C1 — Resource Leaks

- [ ] Cada `setInterval` tem `clearInterval` correspondente em teardown?
- [ ] Cada `setTimeout` crítico tem referência salva para `clearTimeout`?
- [ ] Cada `addEventListener` tem `removeEventListener` correspondente?
- [ ] File handles, streams, conexões abertas têm `.close()` no shutdown?

## C2 — Async e Concorrência

- [ ] `async` callback em `setInterval/setTimeout` tem `.catch()` explícito?
- [ ] Funções `async` são chamadas com `await` onde necessário?
- [ ] Loops periódicos têm guard de reentrância quando necessário?
- [ ] `void fn()` é intencional e documentado?

## C3 — Error Handling

- [ ] Nenhum `catch` vazio ou `catch(() => {})` suprimindo erros relevantes?
- [ ] Erros de I/O (DB, fs, network) logados com contexto?
- [ ] `response.ok` verificado antes de `.json()`?

## C4 — Null/Undefined

- [ ] Acesso a `obj.prop.sub` sem optional chaining onde obj pode ser null?
- [ ] `Array.isArray()` verificado antes de usar métodos de array?
- [ ] Parâmetros obrigatórios validados no início da função?

## C5 — Lógica de Controle

- [ ] Nenhum ternário com ambos os branches iguais?
- [ ] Nenhuma condição impossível (dead code)?
- [ ] Flags de estado têm todos os caminhos de reset?

## C6 — Parsing

- [ ] `JSON.parse()` dentro de `try/catch`?
- [ ] `parseInt()` com radix `10`?
- [ ] Dados externos validados antes do uso?

## C7 — Segurança

- [ ] Sem tokens, senhas ou API keys hardcoded?
- [ ] Logs não expõem dados sensíveis?
- [ ] Template literals em queries SQL protegidas?
- [ ] `path.join()` com inputs externos usa validação?

## C8 — ESM/Node 24

- [ ] Sem `require()` em arquivos `.js`?
- [ ] `import.meta.url` em vez de `__dirname`?
- [ ] Imports têm extensão de arquivo?

## C9 — Performance

- [ ] Sem N+1 queries em loops?
- [ ] `structuredClone` em vez de `JSON.parse(JSON.stringify(x))`?
- [ ] Sem `readFileSync` em hot paths?

## C10 — Completude

- [ ] TODOs não afetam comportamento crítico do caminho feliz?
- [ ] Todos os endpoints HTTP retornam código de status correto?
- [ ] APIs públicas têm JSDoc com @param e @returns?
