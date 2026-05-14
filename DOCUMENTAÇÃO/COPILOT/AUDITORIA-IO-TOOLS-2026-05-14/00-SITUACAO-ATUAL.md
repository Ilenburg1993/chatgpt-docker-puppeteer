# Situação Atual — IO e Tools

Data: 2026-05-14

## Autoridade da auditoria

Os arquivos externos `IO1.MD` e `IO2.md` foram lidos por completo. Eles foram usados como sinais e hipóteses, não como
autoridade. A autoridade desta rodada é a leitura direta de:

- `src/copilot/infra`
- `src/copilot/tools`
- `src/copilot/core/io-policy.js`
- `src/copilot/core/io-contracts.js`
- testes unitários existentes em `tests/unit/copilot/infra` e `tests/unit/copilot/tools`
- scripts reais em `package.json`

## Resumo

`src/copilot/infra` já contém uma ideia correta: uma engine canônica de I/O, cache L1/L2, índice SQLite/FTS, parser,
scanner, prefetch, escopos de sessão, observabilidade, SSE e webhooks. Isso é a direção certa para uma LLM-B que precisa
ler, buscar, editar, aquecer contexto e navegar símbolos com baixa fricção.

O problema é que a pasta ainda cresceu como uma camada plana. O arquivo `io-engine.js` tem 1855 linhas e mistura leitura,
escrita, diff, patch, busca textual, busca simbólica e integração com índice. O índice importa a engine, a engine importa
o registry do índice, e o parser ainda lê disco via engine. Isso forma um ciclo arquitetural que impede a arquitetura
2.0/2.1 de ser confiável.

`src/copilot/tools` está em estado melhor: há barrel canônico, subdomínios, `module-map.js`, factory única, contract
verifier e separação por categorias. Mesmo assim, ainda não está "livre de debt": algumas tools importam módulos
internos de `infra` diretamente, nem todas as boundaries validam path, e as code-tools estão desalinhadas dos
validadores oficiais atuais.

## Fatos mecânicos confirmados

Inventário do foco principal:

- `src/copilot/infra`: 28 arquivos; 23 JS na raiz/sse; maior arquivo `io-engine.js` com 1855 linhas.
- `src/copilot/tools`: 45 arquivos JS/README; maior arquivo `introspection-tools.js` com 655 linhas.
- ciclo local confirmado por análise estática:
  `io-index-registry.js -> io-index-sqlite.js -> io-engine.js -> io-index-registry.js`.
- parser participa de acoplamento problemático: `io-parser.js` importa `io-engine.js`, e `io-index-sqlite.js` importa
  `io-parser.js`.
- barrel de `tools/index.js` é explicitamente barrel-only e mais maduro que `infra/index.js`.
- `infra/index.js` ainda é um barrel largo sobre arquivos planos, não uma fachada por domínio.

## Achados confirmados em infra

### P0 — busca sem budget hard na engine

`io-engine.js` define `RG_SEARCH_TIMEOUT_MS = undefined` e usa `maxBuffer: 1024 * 1024 * 1024` em `rg`/`grep`.
`maxResults` entra como metadado advisory, mas não corta resultados na engine. As tools de arquivo truncam a saída
depois, porém o default de `FILE_TOOLS_OUTPUT_POLICY` é `Infinity`, então a proteção não existe por padrão.

Impacto: uma LLM-B livre pode disparar busca ampla demais, consumir memória e receber payload gigantesco.

### P0 — lockfile interprocesso não atomico

`lockfile.js` usa `existsSync` seguido de `writeFile`. Entre os dois, dois processos podem adquirir o mesmo lock.
`releaseLock` remove o lock sem verificar ownership.

Impacto: risco de concorrência real entre processos.

### P0 — resource lock usa chave recebida, não recurso canonico

`withIoResourceLock` serializa por string literal. `writeFileAtomic`, `appendTextLocked`, `removePathLocked`,
`copyFileLocked`, `moveFileLocked` e `patchTextLocked` passam caminhos sem uma chave de recurso canonica/realpath.

Impacto: `./a.js`, `/abs/a.js` e symlinks podem escapar do mesmo lock lógico.

### P0 — índice pode gravar parse quebrado como fresh

`indexTextFile` só marca `parseError` quando `parseAndCacheSymbols` lança. Mas `parseFileSymbols` costuma retornar
`parseError` no objeto. Resultado: arquivo com erro de parser pode ir para SQLite como `status='fresh'`.

Impacto: busca simbólica e contexto de sessão podem confiar em índice semanticamente incompleto.

### P1 — parser não é puro

`parseAndCacheSymbols(filePath)` chama `readText(filePath)` e o parser importa `io-engine.js`. O parser deveria ter uma
camada pura `content -> symbols` e outra camada de cache/leitura.

Impacto: ciclos, testes mais frágeis e indexação por snapshots inconsistentes.

### P1 — invalidação recursiva não tem evento tipado

`invalidateIoCacheSubtree(filePath)` chama hooks apenas com `filePath`. `io-session-scope` só invalida match exato.

Impacto: remover/mover diretórios pode deixar escopos com símbolos de filhos obsoletos.

### P1 — L2 sem budget de bytes e schema de timestamp inconsistente

`io-cache-l2-sqlite.js` usa `mtime_ms INTEGER`/`ctime_ms INTEGER` enquanto o índice usa `REAL`. O L2 limita número de
entradas, mas não bytes totais.

Impacto: risco de erro silencioso no SQLite e crescimento excessivo do cache.

### P1 — scanner cria muitas promises por diretório

`scanDirectory` usa `Promise.all(names.map(...))` por diretório. `p-limit` limita `lstat`, mas não limita a quantidade
de promises alocadas para diretórios enormes.

Impacto: pressão de memória antes do throttle de I/O agir.

### P2 — diff e patch ainda são primitives pobres para LLM-B

`diffText` compara linhas por posição, sem LCS/patience diff. Mutations já retornam hashes/bytes de evidência em partes
críticas e `patchTextLocked` já recebeu `expectedHash` SHA-256 e `dryRun`, mas ainda opera por string exata e sem
rollback token.

Impacto: diffs grandes, contexto ruidoso e mutações pouco reversíveis.

## Achados confirmados em tools

### T0 — file read/write tools tem bons guardrails, mas dependem de infra fraca

`read-tools.js` e `write-tools.js` usam `validatePath`, `withIoMeta`, redaction e truncamento opcional. Isso corrige
parte da crítica externa. O ponto fraco é que elas importam diretamente `../../infra/io-engine.js`,
`../../infra/io-prefetch.js` e `../../infra/io-scanner.js`, furando barrel-first.

### T0 — index/scope tools aceitam paths sem validação no boundary

`workspace_index_build` recebe `directory` e chama `buildIoIndexForDirectory(directory, options)` diretamente.
`workspace_scope_declare` recebe `directory` e passa para `declareScope`. `workspace_scope_refresh` recebe
`modifiedPaths` e chama `refreshScope` sem validar cada path.

Impacto: tools read-only podem aquecer, indexar ou parsear caminho fora do workspace. Como `scanDirectory` e `readText`
não são policy boundary, a validação precisa ocorrer na tool e/ou numa facade pública de infra.

### T1 — code-tools apontam para scripts legados

`run_tests` mapeia `fast`/`unit` para `test:fast` e `all` para `test:all`, mas esses scripts não existem no
`package.json`. O validador real de unidade do Copilot é `test:copilot:unit`; o strict real é
`typecheck:strict:src.copilot`.

Impacto: a LLM-B recebe tools de qualidade com semântica velha, podendo validar a coisa errada.

### T1 — git-tools ainda usam maxBuffer de 1 GiB e timeout advisory

`safeGitArgs` usa `maxBuffer: 1024 * 1024 * 1024` e não passa `timeout` para `execFile`. Em diffs grandes, `git_diff`
pode explodir saída.

### T1 — shell-tools estão melhores, mas allowlist oficial não cobre todos os validadores Copilot

`shell/executor.js` já reduziu `maxBuffer` para 10 MiB, tem policy de output e timeout opcional. Mas a allowlist padrão
de `run_npm_script` não inclui `test:copilot`, `test:copilot:unit`, `test:copilot:integration`,
`test:copilot:regression`, `typecheck:strict:src.copilot`, `lint:src` nem `check:copilot:guardrails`.

Impacto: a tool shell mais segura não consegue rodar os validadores oficiais desta trilha sem configuração externa.

## Estado arquitetural 2.0/2.1

`tools/` está perto do padrão:

- barrel raiz claro;
- barrels por subdomínio;
- factory central;
- inventory (`module-map.js`);
- contract verifier;
- grupos de bootstrap por categoria.

`infra/` ainda não está no padrão:

- flat namespace com muitos `io-*`;
- `index.js` reexporta detalhes internos e omite APIs importantes;
- não há `public/`, `policy/`, `locks/`, `io/fs`, `io/search`, `parse`, `index-store`;
- imports internos dependem de facades altas;
- ciclos ESM ainda existem;
- hooks de invalidação não são eventos tipados.

## Conclusão da situação atual

A base é boa, mas a próxima etapa não pode ser mais crescimento horizontal em arquivos monolíticos. O caminho correto é
uma estabilização imediata de segurança/corretude, seguida de migração por compatibilidade para uma infra em camadas,
barrel-first e acíclica. A LLM-B deve ganhar liberdade por capacidades fortes, paginadas, rastreáveis e reversíveis,
não por bypass direto de helpers internos.
