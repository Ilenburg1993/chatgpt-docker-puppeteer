# Grafo Canônico de Dependências do Workspace

O grafo de dependências first-party do workspace é construído por
`scripts/analysis/dependency-graph.mjs` e exposto pela CLI `scripts/analysis/analyze-code-graph.js`.

Esta implementação é deliberadamente independente da API do compilador TypeScript. O parsing
estrutural usa `@babel/parser` sob a policy compartilhada de
`src/copilot/infra/code-analysis/babel-policy.js`; imports são resolvidos com a semântica de módulos
do Node; componentes fortemente conexos são calculados com Tarjan. Dessa forma, análise arquitetural
não cria uma dependência first-party da ilha TS6 mantida somente por compatibilidade de peers
upstream.

## Invariantes

O analisador canônico deve manter as seguintes propriedades:

- JavaScript e TypeScript first-party são analisados pela mesma policy Babel compartilhada com o
  runtime.
- Extensões cobertas: `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` e `.tsx`; declarations
  `.d.ts/.d.mts/.d.cts` não entram no grafo de runtime.
- Imports estáticos, reexports e imports dinâmicos literais reconhecidos pela extração canônica
  participam do grafo.
- Resolução local usa `createRequire(...).resolve`, respeitando ESM/CJS, `package.json` e package
  imports do Node.
- Ciclos são detectados por SCC/Tarjan, inclusive self-loops.
- Falha de parse é **fail-closed**: a CLI sai com código `2` e o audit collector produz finding P1.
- Ciclo solicitado por `--circular` faz a CLI sair com código `1`.
- Resultado limpo sai com código `0`.
- O CI não aceita Madge como fallback. Madge foi retirado porque duplicava responsabilidade e
  reintroduzia TypeScript 5 transitivo.

## Comandos principais

```bash
# Gate canônico do workspace: grafo de src + ciclos
npm run analyze:deps

# Estatísticas de fan-in/fan-out
npm run analyze:graph

# Ciclos
npm run analyze:circular

# Candidatos a módulos órfãos
npm run analyze:orphans

# Eventos NERV literais emit/listen
npm run analyze:nerv

# Visão humana completa
npm run analyze:graph:full

# Exporta JSON e DOT
npm run analyze:graph:export

# Gera DOT e SVG do grafo de src
npm run analyze:deps:graph
```

A CLI também aceita `--root <diretório>` para limitar o scope e `--json-stdout` para consumo
programático:

```bash
node scripts/analysis/analyze-code-graph.js --root src/copilot --circular --json-stdout
```

## Contrato de saída

O payload JSON da CLI usa `schemaVersion: 2` e contém:

- `scopeRoot`: raiz analisada relativa ao workspace;
- `files`: quantidade de arquivos de runtime analisados;
- `edges`: quantidade de arestas first-party resolvidas;
- `cycles`: SCCs circulares;
- `orphans`: candidatos sem fan-in dentro do scope;
- `parseErrors`: arquivos que não puderam ser analisados integralmente;
- `unresolvedLocalImports`: imports relativos ou `#...` que não puderam ser resolvidos;
- `topFanOut` e `topFanIn`: módulos de maior acoplamento;
- `nervEvents`: mapas de emitters/listeners para nomes de evento literais.

Com `--export-json`, `analysis/code-graph.json` acrescenta `dependencies` e `reverseDependencies`.
Com `--export-dot`, `analysis/dependency-graph.dot` contém o grafo Graphviz.

## Semântica dos gates

### Parse errors

Parse error invalida a prova arquitetural. Não é warning. A CLI define exit code `2`;
`scripts/audit/collectors/static.mjs` aceita somente `[0, 1]` como códigos interpretáveis do
depgraph e transforma `parseErrors` em findings `dependency-graph-parse-error` P1. Há teste dedicado
garantindo que exit `2` nunca seja aceito como sucesso.

### Ciclos

`--circular` faz qualquer SCC circular resultar em exit code `1`. O collector consegue interpretar
esse resultado e produzir findings de ciclo sem confundir “ciclo encontrado” com “analisador
quebrado”.

### Imports locais não resolvidos

`unresolvedLocalImports` deve ser auditado como integridade do grafo. Um import local não resolvido
significa que a topologia pode estar incompleta mesmo quando não existe ciclo detectado. O gate
operacional deve permanecer em zero.

### Orphans

`orphans` são **candidatos**, não erros automáticos. Entry points, scripts invocados por CLI,
plugins descobertos por convenção e módulos carregados fora do grafo estático podem legitimamente
não ter fan-in. O relatório serve para investigação; não se deve apagar ou mover um módulo apenas
porque aparece nessa lista.

## Estado verificado em 2026-08-20

Na verificação integral de `src` realizada durante a migração TS7:

- arquivos de runtime: **1.685**;
- arestas first-party: **5.131**;
- ciclos: **0**;
- parse errors: **0**;
- imports locais não resolvidos: **0**;
- candidatos a orphan: **101**.

Esses totais são fotografia de uma revisão, não thresholds permanentes. Os invariantes permanentes
são zero parse errors, zero imports locais não resolvidos e zero ciclos no gate canônico.

## Relação com dependency-cruiser

`dependency-cruiser` continua útil como segunda camada de políticas declarativas de fronteira. Ele
não substitui o grafo canônico e o grafo canônico não substitui suas regras de arquitetura.

| Capacidade                          | Grafo canônico Babel/Node         | dependency-cruiser                 |
| ----------------------------------- | --------------------------------- | ---------------------------------- |
| Parser alinhado à policy do runtime | Sim                               | Não é a fonte canônica             |
| Resolução Node/ESM/CJS              | Sim                               | Sim                                |
| SCC/ciclos                          | Tarjan, gate primário             | Regra complementar `no-circular`   |
| NERV emit/listen                    | Sim                               | Não                                |
| Fan-in/fan-out                      | Sim                               | Sim                                |
| Regras declarativas de camada       | Limitado                          | Forte                              |
| Papel                               | Topologia e integridade canônicas | Política arquitetural complementar |

A regra `no-circular` do dependency-cruiser permanece em severidade `error`, fornecendo uma segunda
prova independente contra regressões.

## TS7 e retirada de Madge

A arquitetura atual separa três responsabilidades:

1. `@typescript/native`/TS7 é o compilador e language service canônico;
2. Babel é o parser estrutural first-party para análise de código e grafo;
3. TS6 permanece instalado somente enquanto peers upstream, em especial `typescript-eslint`, ainda o
   exigirem.

Código first-party não pode importar `typescript`, `@typescript/typescript6` nem o antigo
`scripts/analysis/typescript-compat.mjs`. `scripts/ci/check-typescript-baseline.mjs` verifica essa
propriedade em CI. O mesmo gate impede a reintrodução de Madge enquanto sua árvore trouxer
TypeScript 5.

Documentos históricos podem mencionar Madge como evidência de auditorias passadas; isso não
representa uma dependência ativa.

## Limitações conhecidas

- Imports cujo specifier é calculado em runtime não podem ser resolvidos estaticamente com
  segurança.
- O mapa NERV considera nomes literais em `.emit()` e `.on()`; eventos construídos dinamicamente não
  são inferidos.
- A classificação de orphan exige contexto de entry points e discovery dinâmico.
- Pacotes externos não viram nós first-party; o objetivo deste grafo é a topologia interna do scope.

## Fluxo recomendado para mudanças arquiteturais

Antes de uma transformação ampla:

```bash
npm run analyze:deps
npx depcruise --config .dependency-cruiser.mjs src --output-type err
```

Após a alteração, repita os mesmos gates e só aceite o resultado quando parse errors, imports locais
não resolvidos e ciclos estiverem em zero. Para investigação de acoplamento, use
`npm run analyze:graph` ou exporte o JSON/DOT em vez de depender de estatísticas hard-coded em
documentação.
