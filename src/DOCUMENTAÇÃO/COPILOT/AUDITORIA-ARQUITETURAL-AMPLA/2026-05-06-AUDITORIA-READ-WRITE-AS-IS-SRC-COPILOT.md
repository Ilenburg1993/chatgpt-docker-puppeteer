# Auditoria AS-IS - Read/Write/Search/Scan em `src/copilot`

Data: 2026-05-06  
Escopo primário: `src/copilot/**`  
Escopo de apoio: `.devcontainer/Dockerfile`, `package.json`, `tools/rag/**`, testes Copilot

## 1. Objetivo

Este documento registra a investigação factual do estado atual das capacidades de leitura, escrita,
busca, varredura, parsing, cache, indexação, buffers, persistência e observabilidade relacionadas ao
contexto Copilot.

O objetivo não é iniciar implementação neste corte. O objetivo é criar um mapa confiável para
decidir a arquitetura alvo e o roadmap de implementação de um subsistema de I/O robusto, seguro e
muito rápido.

## 2. Fronteiras avaliadas

Foram avaliadas estas superfícies:

- tools diretas de arquivo: `src/copilot/tools/file/**`;
- tools web: `src/copilot/tools/web-tools.js`;
- shell/git/code/todo/session tools que leem, escrevem, executam busca ou persistem estado;
- SDK workspace/session FS: `src/copilot/sdk/session/session-fs.js` e RPCs de workspace;
- contexto de arquivos para terminal/apresentação: `src/copilot/presentation/files/context.js`;
- persistência SQLite do Copilot: `src/copilot/db/**` e `src/copilot/conversation-hub/**`;
- auditoria JSONL e buffers: `src/copilot/audit/**`, `src/copilot/observability/**`;
- scanner/indexador RAG existente: `tools/rag/**`;
- Dockerfile e toolchain disponíveis no devcontainer;
- dependências diretas e transientes registradas em `package.json` e `package-lock.json`.

## 3. Baseline do ambiente

O Dockerfile canônico usa `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`, ou seja,
Node 24 em Debian Bookworm. A imagem já instala uma base forte para I/O e diagnóstico:

- busca: `ripgrep` (`rg`), `fd`, `fzf`, `grep`;
- inspeção de árvore e tamanho: `tree`, `dust`, `ncdu`, `cloc`;
- texto e estrutura: `jq`, `yq`, `sd`, `bat`, `delta`;
- banco/cache/diagnóstico: `sqlite3`, `redis-tools`, `watchman`, `inotify-tools`;
- benchmark e perfil: `hyperfine`, `time`, `strace`, `ltrace`, `heaptrack`, `gdb`;
- compilação nativa: `build-essential`, `cmake`, `nasm`, `libzstd-dev`, `libssl-dev`;
- Node global: `npm`, `pnpm`, `typescript`, `typescript-language-server`, `jsonc-parser`;
- tuning de runtime: `UV_THREADPOOL_SIZE=16`.

Conclusão factual: não há bloqueio de ambiente para iniciar um subsistema de I/O avançado. A maior
lacuna está na convergência arquitetural e não na falta imediata de ferramentas Unix.

## 4. Dependências Node relevantes já disponíveis

Dependências diretas úteis:

- `better-sqlite3`: persistência local, WAL, FTS5 e índices;
- `p-limit`: concorrência controlada;
- `pino`: logging estruturado;
- `prom-client`: métricas;
- `zod`: contratos e validação;
- `ignore`: leitura de `.gitignore` e regras de exclusão;
- `glob`: globbing moderno, embora em Node 24 exista `fsPromises.glob`;
- `xxhash-wasm`: fingerprint rápido;
- `@babel/parser` e `@babel/traverse`: parsing AST JS/TS;
- `@lancedb/lancedb`: índice vetorial/RAG;
- `node-html-parser` e `turndown`: parsing/conversão HTML.

Dependências transientes presentes, mas não canônicas para consumo direto:

- `lru-cache`;
- `fast-glob`;
- `fdir`;
- `chokidar`;
- `tinybench`.

Conclusão factual: se alguma dessas transientes virar parte do contrato de `src/copilot`, ela deve
ser promovida para dependência direta. Não se deve importar dependência transiente como se fosse
contrato do projeto.

## 5. Capacidades Node 24+ relevantes ao AS-IS

A documentação oficial consultada para Node 24.15.0 confirma recursos importantes para a próxima
fase:

- `fs/promises` possui `FileHandle`, `opendir`, `glob`, `watch`, `readFile`, `writeFile`, `cp`,
  `statfs` e `mkdtempDisposable`;
- `fs.writeFile` e `FileHandle.writeFile` aceitam opção `flush`, útil para escrita de maior risco;
- `fs.writeFile` aceita `AbortSignal`;
- `stream.pipeline` em `node:stream/promises` aceita `AbortSignal` e propaga abort para streams;
- `buffer.isUtf8()` e `buffer.isAscii()` existem e evitam heurísticas frágeis para texto/binário;
- `perf_hooks` provê `performance.mark()` e `performance.measure()`;
- `diagnostics_channel` é otimizado para baixo overhead quando bem reutilizado;
- `worker_threads.locks` existe em Node 24.5+, mas está experimental;
- `node:sqlite` existe em Node 24, incluindo `DatabaseSync` e `SQLTagStore`, mas ainda está em
  active development.

Conclusão factual: Node 24 já cobre parte do que hoje seria resolvido com libs externas. Mesmo
assim, algumas libs ainda podem ser melhores por maturidade/ecossistema, especialmente
`better-sqlite3`, `stream-json` e uma LRU por bytes.

## 6. Inventário das tools de arquivo

Arquivos principais:

- `src/copilot/tools/file/shared.js`;
- `src/copilot/tools/file/read-tools-io.js`;
- `src/copilot/tools/file/read-tools-search.js`;
- `src/copilot/tools/file/symbol-search-tool.js`;
- `src/copilot/tools/file/write-tools.js`;
- `src/copilot/tools/file/read-tools.js`;
- `src/copilot/tools/file/index.js`.

Tools expostas:

- `read_file_content`;
- `list_directory`;
- `search_in_files`;
- `diff_files`;
- `workspace_symbol_search`;
- `write_file_content`;
- `create_file`;
- `delete_file`;
- `copy_file`;
- `move_file`;
- `patch_file`.

### 6.1 Pontos fortes

- `validatePath()` centraliza containment no workspace e bloqueia segredos.
- `validatePath()` resolve symlinks quando possível antes de validar a fronteira.
- `read_file_content` usa `fs.createReadStream` e limite de bytes.
- `read_file_content` usa `isUtf8` para detectar binário antes de decodificar texto.
- `search_in_files` usa `rg` e fallback para `grep`.
- `diff_files` usa `diff` e fallback em memória.
- `write_file_content`, `create_file` e `patch_file` usam escrita temporária seguida de `rename`.
- Existem limites explícitos: conteúdo de leitura, output de busca, output de diff, tamanho de
  escrita e tamanho de patch.
- Algumas tools já retornam `io` via `buildIoMeta()` e `withIoMeta()`.

### 6.2 Lacunas técnicas

- `core/io-contracts.js` ainda é metadata mínima, não contrato completo de operação.
- A taxonomia de erro de I/O ainda não é canônica.
- Não há engine única de leitura/escrita; cada tool executa I/O diretamente.
- Não há lock canônico por recurso para escrita concorrente em arquivo.
- Escrita atômica não faz `fsync`/`flush` por classe de risco.
- `create_file` com `overwrite=true` e `write_file_content` podem competir entre si sem fila por
  path.
- `copy_file` e `move_file` não passam pelo mesmo envelope de risco de escrita atômica.
- `search_in_files` limita output, mas não possui índice incremental próprio.
- `workspace_symbol_search` não anexa `io` metadata e não compartilha sanitização de output.
- `list_directory` faz `stat` por entrada de modo sequencial em muitos caminhos.
- O filtro glob de `list_directory` é simples demais para padrões reais.
- `diff_files` fallback lê os dois arquivos inteiros em memória.
- `patch_file` lê arquivo completo e reescreve completo, adequado para arquivos pequenos/médios, mas
  não para arquivos grandes.
- `validatePath()` chama `realpath` por operação; correto para segurança, mas pode ficar caro em
  loops de listagem/busca se não houver cache de path policy.

## 7. Web read/search

Arquivo principal: `src/copilot/tools/web-tools.js`.

Capacidades:

- `web_fetch_local`;
- `web_search`.

Pontos fortes:

- valida URL com `validateUrl()`;
- bloqueia SSRF e redirects para destinos privados;
- limita rate por minuto em memória;
- usa `AbortController` para timeout;
- limita bytes de resposta no fetch;
- aceita somente `text/*` no fetch;
- filtra resultados de busca por política de URL.

Lacunas:

- rate-limit é por processo, não por sessão, agente, IP lógico ou usuário;
- `web_search` usa fallback HTML com regex, reconhecidamente frágil;
- `web_fetch_local` concatena chunks manualmente sem helper compartilhado;
- não há `io` metadata canônica para web read/search;
- não há cache HTTP, ETag, last-modified ou cache negativo;
- não há política de egress por categoria/domínio além do SSRF básico;
- não há integração com observabilidade de I/O.

## 8. Session FS e workspace RPC

Arquivo principal: `src/copilot/sdk/session/session-fs.js`.

Capacidades:

- provider local com `readFile`, `writeFile`, `appendFile`, `exists`, `stat`, `mkdir`, `readdir`,
  `readdirWithTypes`, `rm`, `rename`;
- isolamento por sessão;
- path traversal bloqueado por normalização de segmentos;
- métricas via `emitSdkOperationMetric()`.

Pontos fortes:

- fronteira do SDK já tem uma API de FS relativamente limpa;
- operações emitem métrica de início, sucesso e falha;
- escrita cria diretórios intermediários quando necessário;
- sessões são isoladas por `sessionId` codificado.

Lacunas:

- `writeFile` e `appendFile` não são atômicos;
- `rename` não possui fallback `EXDEV`;
- não há limite de bytes por operação;
- não há validação de UTF-8/binário;
- não há `AbortSignal` por operação de FS;
- não há lock por recurso;
- não compartilha `validatePath()` nem `core/io-contracts`;
- usa `fs.writeFile` direto, sem política de `flush`/risco;
- observabilidade de SDK e metadata de I/O ainda são universos paralelos.

## 9. Contexto de arquivo para terminal/apresentação

Arquivo principal: `src/copilot/presentation/files/context.js`.

Capacidades:

- extração de referências `@path`;
- leitura de arquivos e diretórios para embedding;
- cache em memória com TTL de 30s;
- limite total de embed de 64 KB;
- conversão de attachments para Markdown.

Pontos fortes:

- cache simples já reduz releituras;
- limites de embed impedem explosão de contexto;
- leitura de diretório ignora binário com heurística de byte nulo;
- testes unitários cobrem cache hit e embedding básico.

Lacunas:

- `pathResolve(filePath)` usa `cwd`, não necessariamente a mesma política de workspace de
  `validatePath()`;
- cache é por TTL e path absoluto, mas não invalida por `mtime`, tamanho ou hash;
- cache não é LRU por bytes, só limpeza parcial por contagem;
- não há proteção contra symlink escapando da raiz de trabalho;
- leitura de diretório faz `stat` em paralelo sem limite de concorrência;
- não há `io` metadata nem eventos de diagnostics;
- binário é detectado de forma diferente das file-tools.

## 10. Persistência SQLite e indexação textual

Arquivos principais:

- `src/copilot/db/sqlite.js`;
- `src/copilot/db/migrations.js`;
- `src/copilot/conversation-hub/store.js`;
- `src/copilot/conversation-hub/store-helpers.js`;
- `src/copilot/conversation-hub/store-queries.js`.

Pontos fortes:

- `better-sqlite3` já é dependência direta;
- banco Copilot é isolado de outros bancos;
- pragmas importantes já existem: WAL, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout`,
  `wal_autocheckpoint`, `cache_size`, `temp_store=MEMORY`;
- Conversation Hub usa FTS5 para busca em turnos e memórias;
- há checkpoint WAL periódico;
- writes de turnos são serializados por sessão em `#writeTailsBySession`;
- há retry assíncrono para conflitos de constraint.

Lacunas:

- FTS5 cobre conversas/memórias, não arquivos do workspace;
- não há tabela canônica de índice de arquivo em `copilot.sqlite`;
- não há cache persistente L2 de leitura;
- não há materialização de metadados de arquivo: path, size, mtimeNs, hash, mime, language;
- não há fila de indexação incremental no runtime Copilot;
- consultas SQLite síncronas de `better-sqlite3` podem bloquear event loop se usadas em lote pesado;
- `node:sqlite` foi avaliado como candidato futuro, mas hoje `better-sqlite3` segue mais maduro no
  projeto.

## 11. RAG, scan e fingerprint

Arquivos relevantes:

- `tools/rag/lib/scan.mjs`;
- `tools/rag/lib/fingerprint.mjs`;
- `tools/rag/lib/facade.mjs`;
- `tools/rag/lib/chunking/**`;
- `tools/rag/lib/embeddings/embed_cache.mjs`;
- `tools/rag/lib/storage/lancedb.mjs`.

Pontos fortes:

- scanner respeita allowlist de extensões e denylist de diretórios;
- usa `ignore` para `.gitignore`;
- evita symlinks;
- limita tamanho por arquivo;
- ignora binários;
- calcula fingerprint com SHA-256 e xxHash64;
- possui indexação incremental, chunking, embeddings e LanceDB;
- possui cache LRU de embeddings de query.

Lacunas para `src/copilot`:

- RAG vive fora de `src/copilot`, em `tools/rag`, e não é engine canônica de read/write tools;
- scanner lê arquivo inteiro em memória;
- walk é recursivo e sequencial;
- glob próprio é simples;
- não há integração direta com `core/io-contracts`;
- não há ponte clara entre busca textual rápida de tools e busca semântica RAG;
- os limites e denylist não são compartilhados com `validatePath()` das file-tools;
- cache de embeddings não resolve cache de conteúdo de arquivo.

Conclusão: o RAG contém boas peças para reutilização conceitual, mas não deve ser copiado
diretamente para `src/copilot` sem contrato, limites e ownership claros.

## 12. Auditoria, logs e buffers

Arquivos relevantes:

- `src/copilot/audit/jsonl-writer.js`;
- `src/copilot/audit/pipeline-audit-log.js`;
- `src/copilot/audit/ring-buffer.js`;
- `src/copilot/observability/event-collector.js`;
- `src/copilot/observability/metrics.js`;
- `src/copilot/observability/tool-stats.js`.

Pontos fortes:

- JSONL writer enfileira e faz batch via `setImmediate`;
- rotação por tamanho existe;
- ring buffer possui push O(1);
- pipeline de auditoria tem `flush`;
- observability já tem estrutura de métricas e collectors.

Lacunas:

- `jsonl-writer` não expõe flush explícito nem backpressure para chamador;
- rotação usa apenas `.1`, sem estratégia multi-geração;
- falhas de escrita são engolidas com `logSwallowed`, sem métrica de perda;
- não há taxonomia comum para `io.read`, `io.write`, `io.search`, `io.scan`, `io.parse`, `io.index`;
- não há histogramas p50/p95/p99 por classe de I/O;
- não há canal baixo overhead com `diagnostics_channel`.

## 13. Shell, git e execução

Arquivos relevantes:

- `src/copilot/tools/shell/**`;
- `src/copilot/tools/git/index.js`;
- `src/copilot/bridges/git-bridge*.js`.

Pontos fortes:

- shell tools e git tools já existem como adapters produtivos;
- Dockerfile inclui `git`, `delta`, `gh`, `actionlint`, `hadolint`, `shellcheck`;
- `rg`, `diff`, `grep`, `fd` e `watchman` estão disponíveis para adapters de alta performance.

Lacunas:

- parte da busca/leitura via shell bypassa a semântica das file-tools;
- output de comandos tem truncamento e auditoria próprios, não necessariamente `io` metadata;
- git diff/status é uma forma de read/search de workspace, mas não participa de um contrato de I/O
  transversal.

## 14. Estado dos testes

Cobertura observada:

- há testes de file-context com cache;
- há testes de session FS;
- há testes de SDK/tools, todo, conversation hub, observability e terminal;
- há testes de file-tools alterados/untracked no working tree atual;
- há scripts `test:copilot`, `test:copilot:unit`, `typecheck:strict:src.copilot` e gates de
  arquitetura.

Lacunas de teste específicas para o plano read/write:

- concorrência de writes no mesmo path;
- atomicidade com crash simulado entre tmp write e rename;
- policy de symlink em read/write/list/search;
- truncamento UTF-8 em fronteira multibyte;
- cache hit/miss por mtime/hash;
- invalidação incremental por rename/delete;
- benchmark de `rg` versus índice SQLite FTS;
- benchmark de `readFile` versus stream para thresholds reais;
- teste de web fetch com redirect SSRF;
- teste de JSON grande e parser streaming.

## 15. Maturidade AS-IS

| Dimensão                             | Maturidade       | Evidência                                                              |
| ------------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| Segurança de path em file-tools      | Boa              | `validatePath()` com realpath e bloqueio de segredos                   |
| Segurança de path fora de file-tools | Parcial          | Session FS e runtime-file-context têm regras próprias                  |
| Escrita atômica                      | Parcial          | Existe nas file-tools e storage JSON, não no Session FS                |
| Concorrência de escrita              | Parcial          | ConversationStore serializa por sessão; arquivos não têm lock canônico |
| Busca textual                        | Boa baseline     | `rg` e FTS5 existem, mas não convergem                                 |
| Indexação de arquivos                | Baixa no Copilot | RAG indexa fora de `src/copilot`, não as file-tools                    |
| Cache                                | Parcial          | caches Map/TTL existem, mas sem LRU por bytes ou L2                    |
| Parsing                              | Parcial          | `safe-json`, Babel no projeto, RAG chunking; sem política única        |
| Observabilidade de I/O               | Parcial          | métricas existem, sem taxonomia I/O                                    |
| Performance previsível               | Média            | bons componentes, pouca orquestração                                   |

## 16. Principais riscos

1. Divergência de política entre file-tools, Session FS, runtime-file-context, shell/git e RAG.
2. Corrida de escrita em arquivos por ausência de lock por path/recurso.
3. Cache stale por TTL sem `mtime/hash`.
4. Latência variável em busca textual por depender de `rg` a cada chamada.
5. Leitura inteira de arquivos grandes em fallback diff, patch e RAG scan.
6. Observabilidade insuficiente para provar regressão ou ganho de performance.
7. Dependência transiente sendo tentadora para import direto.
8. Possível bloqueio de event loop com SQLite síncrono em lotes grandes.

## 17. Conclusão AS-IS

O sistema atual tem bons fundamentos: path validation, limites, atomic write parcial, `rg`, FTS5,
SQLite WAL, cache simples, RAG incremental e tooling de diagnóstico no Dockerfile. A lacuna central
é a ausência de uma malha única de I/O para `src/copilot`.

O próximo passo não é adicionar dependências às cegas. O próximo passo é consolidar:

- contrato canônico;
- engine única;
- locks por recurso;
- cache L1/L2 com invalidação;
- índice textual incremental;
- parsing por threshold;
- observabilidade e SLOs.

## 18. Referências consultadas

- Node.js v24.15.0 File System API: https://nodejs.org/docs/latest-v24.x/api/fs.html
- Node.js v24.15.0 Stream API: https://nodejs.org/docs/latest-v24.x/api/stream.html
- Node.js v24.15.0 Buffer API: https://nodejs.org/docs/latest-v24.x/api/buffer.html
- Node.js v24.15.0 Performance Hooks: https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html
- Node.js v24.15.0 Worker Threads: https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
- Node.js v24.15.0 Diagnostics Channel:
  https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html
- Node.js v24.15.0 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
