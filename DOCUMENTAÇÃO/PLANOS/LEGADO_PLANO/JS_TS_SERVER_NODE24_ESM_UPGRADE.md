# Consolidação de JavaScript, tsserver e Node 24 ESM

## Objetivo

Este documento define o baseline técnico do repositório para desenvolvimento em JavaScript com
`@ts-check`, `tsserver` e Node 24 ESM. O foco é reduzir sobreposição de configuração, melhorar a
experiência no VS Code, deixar o `typecheck` mais previsível e fixar o papel do Babel como
ferramenta de AST, não como pipeline de compilação do runtime.

## Estado atual do projeto

- O backend roda em Node `>=24` e o repositório usa `"type": "module"`.
- O projeto usa TypeScript como motor de linguagem e checagem sobre JS (`allowJs`, `checkJs`,
  `noEmit`), não como migração ampla para `.ts` nesta rodada.
- O dashboard já usa Vite, e o build principal usa Node nativo com apoio pontual de `esbuild`.
- O uso de Babel é restrito a parsing e traversal AST em automações e tooling.

## Problemas identificados

- Havia sobreposição entre `tsconfig.json` e `jsconfig.json` na raiz, o que aumentava a ambiguidade
  de projeto para o `tsserver`.
- O `typecheck:full` cobria apenas backend e browser, deixando tools/tests/scripts fora do gate
  explícito.
- O VS Code ainda preferia imports relativos, apesar do projeto já usar aliases ESM via
  `package.json#imports`.
- O attach remoto de Docker usava `remoteRoot` incompatível com o caminho real do workspace no
  container.
- A documentação de `strict` estava mais otimista do que a configuração real do projeto.

## Decisões arquiteturais finais

- O repositório passa a operar com topologia **tsconfig-only**.
- `tsconfig.json` vira arquivo-raiz de solução, com referências explícitas.
- O backend principal vive em `tsconfig.node.json`.
- Browser/dashboard vive em `tsconfig.browser.json`.
- Tooling curado e estável vive em `tsconfig.tools.json` nesta primeira rodada.
- A trilha de endurecimento progressivo vive em `tsconfig.strict.json`.
- O baseline continua em JavaScript + JSDoc + `@ts-check`; não há migração ampla para TypeScript
  nesta rodada.

## Nova topologia de configuração

- `tsconfig.base.json`: opções compartilhadas, aliases, `allowJs`, `checkJs` e `noEmit`.
- `tsconfig.node.json`: backend Node 24 + ESM.
- `tsconfig.browser.json`: alvo browser/dashboard.
- `tsconfig.tools.json`: tooling curado (build, env, health, setup e configs) na primeira rodada.
- `tsconfig.strict.json`: trilha opt-in para domínios prioritários.
- `tsconfig.json`: arquivo de solução com `references`.

## Política de tsserver e VS Code

- O VS Code deve usar o TypeScript do workspace (`typescript.tsdk = node_modules/typescript/lib`).
- Os `tsconfig.*.json` são a fonte principal de projeto; `js/ts.implicitProjectConfig.*` fica apenas
  como fallback para arquivos soltos.
- Auto-import passa a favorecer caminhos **non-relative**, para refletir os aliases `#core/*`,
  `#infra/*`, `#server/*`, `#driver/*` e similares.
- `typescript.preferences.importModuleSpecifierEnding` e
  `javascript.preferences.importModuleSpecifierEnding` permanecem em `"js"` para preservar ESM
  explícito.

## Política de debug Node e VS Code

- Launches Node passam a usar `--enable-source-maps` por padrão.
- O attach do container deve mapear `remoteRoot` para `${workspaceFolder}`.
- O auto-attach base do VS Code fica em `onlyWithFlag` para reduzir ruído e evitar acoplamento
  excessivo entre múltiplos processos Node.
- O fluxo do dashboard fica formalizado com um compound de debug que sobe Vite e Chrome juntos.

## Política de Babel

### Decisão

**Babel permanece apenas como ferramental AST. Não é o compilador do runtime deste projeto.**

### O que permanece

- `@babel/parser`
- `@babel/traverse`
- uso de parser `babel` em codemods e análises estruturais

### O que não entra no baseline

- `@babel/core`
- `@babel/preset-env`
- `babel-loader`
- plugins de transform como etapa padrão do backend
- transpile principal do Node via Babel

### Regra operacional

Só reconsiderar Babel como transpiler se houver, ao mesmo tempo:

1. necessidade real de suportar target abaixo de Node 24 no backend, ou
2. sintaxe fora do suporte nativo do target adotado, ou
3. plugin/transform indispensável e inviável em Vite/esbuild/Node nativo.

Na ausência disso:

- manter Node nativo + ESM
- manter Vite e `esbuild` para build
- manter Babel somente para AST, análise e codemod

## Plano de migração por fases

### Fase 1

- substituir a topologia antiga por `tsconfig.base/node/tools/browser/strict`
- remover `jsconfig.json`
- atualizar scripts de `typecheck`
- limitar `tsconfig.tools.json` ao subconjunto de tooling já estável para manter o gate verde

### Fase 2

- alinhar preferências do VS Code com aliases ESM
- expor `typecheck` nas tasks do workspace
- corrigir o debug attach no container

### Fase 3

- usar `tsconfig.strict.json` como trilha incremental para áreas prioritárias
- expandir a zona `strict-ready` sem bloquear o fluxo padrão do projeto

## Validação técnica

Validar, após mudanças estruturais:

- `npm run typecheck:node`
- `npm run typecheck:tools`
- `npm run typecheck:browser`
- `npm run typecheck:full`
- `npm run lint`
- `npm run test:unit`

Validar manualmente no editor:

- ausência de diagnóstico duplicado por projeto sobreposto
- sugestões de auto-import coerentes com aliases `#...`
- attach remoto com breakpoints funcionando no container
- compound de debug do dashboard funcionando

Expansão futura:

- mover tests e ferramentas ainda não tipadas para `tsconfig.tools.json` apenas após saneamento local
- não abrir um gate vermelho massivo nesta rodada

## Rollback

Se a consolidação causar regressão:

1. restaurar `jsconfig.json`
2. reverter `tsconfig.json` ao formato anterior
3. remover os `tsconfig.*.json` auxiliares
4. restaurar scripts antigos de `typecheck`
5. reverter ajustes de `settings.json`, `launch.json` e `tasks.json`

## Links oficiais

- VS Code JavaScript: https://code.visualstudio.com/docs/nodejs/working-with-javascript
- VS Code Node tutorial: https://code.visualstudio.com/docs/nodejs/nodejs-tutorial
- VS Code Node debugging: https://code.visualstudio.com/docs/nodejs/nodejs-debugging
- VS Code jsconfig: https://code.visualstudio.com/docs/languages/jsconfig
- VS Code TypeScript editing: https://code.visualstudio.com/docs/typescript/typescript-editing
- Node packages: https://nodejs.org/api/packages.html
- Node ESM: https://nodejs.org/api/esm.html
- Babel docs: https://babeljs.io/docs/
