# infra/

**Propósito**: concentrar primitivas técnicas compartilhadas do runtime Copilot local.  
**Status documental**: Canônico de apoio.  
**Público**: mantenedores de I/O, cache, indexação, storage, locks, SSE e adapters internos.  
**Última atualização**: 14 de maio de 2026.

## O que esta pasta contém

- Facades públicas em `public/` para consumidores fora de `infra/`.
- Engine canônica de I/O local em `io-engine.js`, ainda mantida como facade de compatibilidade durante a migração 2.0/2.1.
- Cache L1 em memória, cache L2 SQLite, tiering, health e invalidação coordenada.
- Scanner, parser, prefetch, scope de sessão e índice L2 pesquisável.
- Subdomínios internos baixos em `shared/`, `policy/`, `scan/`, `parse/`, `storage/`, `queue/`, `locks/`,
  `runtime/` e `io/fs/`.
- Locks, storage, queue, webhooks e infraestrutura SSE.

## O que não deve ficar aqui

- Custom tools registradas no SDK; elas pertencem a `tools/`.
- UX de terminal, renderização ou comandos; isso pertence a `terminal/`.
- Fachadas públicas do runtime para HTTP/terminal; isso pertence a `presentation/`.
- Semântica vanilla do SDK; a fonte continua em `sdk/`.

## Entradas principais de I/O

- `public/io.js`: facade pública para leitura, escrita, busca e scan.
- `public/indexing.js`: facade pública para build/search/status do índice L2.
- `public/session.js`: facade pública para escopos de sessão e contexto.
- `public/events.js`: facade pública para telemetria de I/O.
- `public/cache.js`: facade pública para inspeção/invalidação de cache.
- `public/testing.js`: facade pública deliberada para resets em testes.
- `io-engine.js`: engine de leitura/escrita local com locks, metadados e invalidação; ainda é compatibilidade interna larga.
- `io-cache.js`: L1 quente do processo, TTL/fingerprint e invalidação ativa.
- `io-cache-l2-sqlite.js`: L2 blob cache persistente para payloads de leitura.
- `io-index-sqlite.js`: L2 índice persistente com arquivos, FTS, símbolos e imports.
- `io-index-registry.js`: registry lazy do índice e bridge de invalidação.
- `io-observability.js`: canais `diagnostics_channel` para operação, cache, índice, scope e scan.
- `io-prefetch.js`: aquecimento de bytes/texto e read-through context da LLM-B.
- `io-session-scope.js`: escopo de trabalho da LLM-B com prefetch, parser e índice.
- `io-scanner.js`: enumeração canônica de diretórios com ignore/fingerprint.
- `io-parser.js`: parsing JS/TS/JSON/Markdown e cache simbólico.
- `io-health.js`: snapshot agregado de L1/L2/índice/scope para observability.
- `module-map.js`: inventário executável da raiz de `infra/`, com papel, tier, risco e exposição pública.

## Subdomínios internos

- `shared/`: helpers sem dependência de domínio, como leitura tipada de ambiente.
- `policy/`: policies reutilizáveis, incluindo janela de saída para retornos grandes.
- `scan/`: glob, gitignore, fingerprint e batching usados por scanner e prefetch.
- `parse/`: parsers puros de JSON, Markdown, comentários e outline textual.
- `io/fs/`: portas baixas de filesystem usadas para quebrar ciclos entre parser/index/engine.
- `storage/`: JSON store baixo sem dependência de `io-engine.js`.
- `queue/`: implementação modular da fila assíncrona.
- `locks/`: barrels internos de locks em memória e lockfile.
- `runtime/`: envelope rastreável de operação, base para transações e rollback.
- `sse/`: fanout, replay buffer e estado SSE.

## Regras de manutenção

- Consumidores fora de `src/copilot/infra/**` devem importar por `#copilot/infra/public/*` ou pelo barrel raiz de
  compatibilidade quando a API ainda não tiver facade dedicada.
- Tools não importam arquivos folha de `infra/`.
- Toda leitura ou escrita nova em tools/bordas deve partir de uma facade pública; não use `fs.readFile`/`fs.writeFile`
  diretamente em tools ou adapters.
- Módulos baixos (`shared/`, `policy/`, `scan/`, `io/fs/`) não importam `public/`, `io-engine.js`, registry, tools ou
  sessão.
- `parse/` permanece puro: sem `io/`, cache, índice, prefetch ou sessão.
- `storage.js` é apenas facade de compatibilidade; implementação vive em `storage/`.
- L1, L2 blob e L2 índice devem ser invalidados pelo mesmo evento de escrita.
- Prefetch pode aquecer dados, mas não vira fonte de verdade; a verdade segue no filesystem via
  `io-engine`.
- Índice responde descoberta, busca e símbolos; quando estiver vazio ou inadequado, a tool deve cair
  para a engine canônica ou para fallback observável.
- Fingerprints de scan usam `realpath + mtimeMs + size`; hashes mais caros entram apenas quando o
  roadmap/benchmark justificar.
- Chunks persistidos pertencem ao índice L2; o cache L2 blob não deve virar catálogo semântico.
- Limites de volume para a LLM-B devem ser explícitos e observáveis. Quando a operação for potencialmente grande,
  use janela de saída (`maxResults`, `maxBytes`, cursor futuro) e retorne metadados de truncamento sempre que possível.

## Gates arquiteturais

- `tests/unit/copilot/contracts/test_infra_barrel_governance.spec.js`: garante que `module-map.js` cobre todas as
  entradas raiz de `infra/` e que as facades públicas existem.
- `tests/unit/copilot/contracts/test_io_tools_boundary_contracts.spec.js`: impede tools de importarem internals de
  `infra/` fora de `#copilot/infra/public/*`.
- A análise local de ciclos de `src/copilot/infra` deve permanecer em `cycles 0`.

## Operação do índice

Comandos humanos no terminal permanente LLM-B:

- `/index status`: mostra disponibilidade, arquivos, símbolos, imports, chunks e frescor.
- `/index build src/copilot --concurrency 8`: constrói/atualiza o índice L2 de `src/copilot`.
- `/index search "termo"`: busca FTS5 quando o índice está disponível.
- `/index symbol alphaHelper`: consulta símbolos persistidos.
- `/index clear`: limpa o índice local.

Comandos shell equivalentes:

- `npm run copilot:index:status`
- `npm run copilot:index:build`
- `npm run copilot:index -- build src/copilot --ext js --ext md --concurrency 8 --json`
- `npm run copilot:index -- search "termo" --json`

A poda de arquivos removidos é automática em builds completos. Em builds parciais com
`--include`/`--exclude`, a poda é desativada por segurança para não apagar entradas fora da fatia
materializada.

## Links relacionados

- Hub superior: `../README.md`.
- Tools que consomem esta infra: `../tools/file/README.md`.
- Roadmap ativo:
  `../../DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-07-ROADMAP-IO-INTELIGENTE-COMPLETO.md`.
