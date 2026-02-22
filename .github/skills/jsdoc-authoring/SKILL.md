---
name: jsdoc-authoring
description:
  Crie/revise JSDoc completo e verificável (TypeScript em JS via // @ts-check) assumindo Node.js 24
  + ESM (import/export). Use quando o pedido envolver "adicionar JSDoc", "documentar API", "melhorar
  IntelliSense", "tipar JS sem migrar para TS", ou padronizar contratos (params/returns/throws) em
  módulos ESM do projeto. Rode LINT e NODE CHECK após a tipagem no arquivo.
license: MIT
---

# Skill — JSDoc Authoring (Node 24 + ESM, rigoroso e verificável)

## Objetivo

Gerar JSDoc que:

- documenta **contratos explícitos** (inputs/outputs, invariantes, side-effects)
- melhora IntelliSense e **checagem estática** em `.js` com `// @ts-check`
- respeita o **padrão do projeto: Node.js 24 + ESM** (`import`/`export`)

## Premissas do projeto (obrigatórias)

- **Runtime:** Node.js 24
- **Módulos:** **ESM** (NUNCA sugerir `require`, `module.exports`, `__dirname` clássico)
- **Compatibilidade de tipos:** JSDoc deve funcionar bem com TypeScript em `checkJs`

## Quando invocar (gatilhos)

Invocar quando o usuário pedir ou o contexto exigir:

- “criar/adicionar jsdoc”, “documentar”, “comentar tipos”
- “melhorar IntelliSense / autocomplete”
- “// @ts-check”, “checkJs”, “tipar JavaScript”
- funções com options object (`fn(params = {})`) sem typedef
- payloads genéricos, dedup/idempotência, unidades (ms/bytes), erros implícitos
- exports sem documentação (API pública)

Não invocar quando:

- o usuário quer apenas explicação conceitual sem alterar arquivo
- o arquivo já tem JSDoc consistente e o pedido não é sobre docs/tipos

## Regras obrigatórias (não negociáveis)

1. **Exports primeiro**: todo `export` (named/default) recebe JSDoc completo.
2. **Options object ⇒ typedef**: se a função recebe objeto de opções (`params`, `options`), crie
   `@typedef` com `@property` e use `@param {Type} params`.
3. **Evitar `any`**: use `unknown`, `Record<string, unknown>`, uniões literais, ou genéricos
   (`@template`) quando adequado.
4. **Unidades explícitas**: ms vs s, bytes, etc.
5. **Side-effects explícitos**: DB/FS/HTTP/event emit/mutações.
6. **`@throws` só se real**: declarar apenas quando o fluxo realmente pode lançar (ou quando
   dependências propagam).
7. **Defaults explícitos**: documentar valores default (ex.: `tsMs=Date.now()`).
8. **Não alterar semântica**: mudanças permitidas só para ajudar a tipagem (ex.: `/** @type */`,
   casts pontuais), sem mudar comportamento.
9. **ESM-only**:
   - manter `import`/`export`
   - se precisar de caminho, preferir `import.meta.url` + `fileURLToPath` (quando relevante)
   - nunca orientar `__dirname`/`__filename` sem adaptação ESM

## Procedimento (passo a passo)

### 1) Inventário da API (ESM)

- Liste todos os exports (`export function`, `export class`, `export default`).
- Marque quais são “públicos” vs internos.
- Para cada export, identifique:
  - parâmetros (incluindo defaults)
  - retornos (sync/async)
  - side-effects (I/O, DB, rede, eventos)
  - erros prováveis (validação, I/O, SQL, rede)

### 2) Modelagem de tipos canônicos (no topo do arquivo)

Criar `@typedef` após imports para:

- tipos recorrentes (IDs, enums literais)
- payloads (preferir `unknown` / `Record<string, unknown>`)
- options objects (ex.: `RecordEventParams`)
- tipos de retorno quando ajudam a leitura (`Result`, `DbRow`, etc.)

### 3) Anotar exports (contrato)

Para cada export:

- 1–2 linhas do que faz
- bloco “Semântica” quando houver:
  - side-effect
  - unidades
  - idempotência/dedup
- `@param`, `@returns`, `@throws` (se aplicável)
- `@example` curto apenas se reduzir ambiguidade

### 4) Helpers relevantes (privados)

- Documentar apenas se codificam regra crítica (normalização, dedup, parsing, validação).
- Evitar JSDoc prolixo em helpers triviais.

### 5) Ajustes para `@ts-check` (quando necessário)

- Resolver warnings com:
  - typedefs melhores
  - `/** @type {T} */` em variáveis
  - casts pontuais (`/** @type {T} */ (value)`)
- Não introduzir `any` para “silenciar”.

## Padrões de escrita (JSDoc)

- Preferir `@typedef {object} Name` + `@property`
- Usar `T|null` quando `null` é permitido
- Para payload genérico: `Record<string, unknown> | unknown`
- Async: `@returns {Promise<T>}`
- Se houver eventos (`EventEmitter`), documentar nomes/semântica de eventos no export público

## Formato de entrega (output)

Ao aplicar no arquivo:

- Preferir **diff patch (unified diff)** se o pedido for “corrija/atualize”.
- Caso contrário, devolver o arquivo completo revisado.
- Incluir 3–7 bullets finais:
  - typedefs criados
  - exports documentados
  - micro-ajustes de tipagem (se houver)

## Critérios de aceitação (Definition of Done)

- Todos os exports documentados.
- Options objects tipados com typedef.
- Nenhum `any` novo (salvo justificativa explícita e local).
- Unidades, defaults e side-effects explícitos.
- `@throws` correto (nem ausente quando necessário, nem inventado).
- Nenhuma sugestão/alteração que viole Node 24 + ESM.
