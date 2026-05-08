# infra/

**Propósito**: concentrar primitivas técnicas compartilhadas do runtime Copilot local.  
**Status documental**: Canônico de apoio.  
**Público**: mantenedores de I/O, cache, indexação, storage, locks, SSE e adapters internos.  
**Última atualização**: 7 de maio de 2026.

## O que esta pasta contém

- Engine canônica de I/O local em `io-engine.js`.
- Cache L1 em memória, cache L2 SQLite, tiering, health e invalidação coordenada.
- Scanner, parser, prefetch, scope de sessão e índice L2 pesquisável.
- Locks, storage, queue, webhooks e infraestrutura SSE.

## O que não deve ficar aqui

- Custom tools registradas no SDK; elas pertencem a `tools/`.
- UX de terminal, renderização ou comandos; isso pertence a `terminal/`.
- Fachadas públicas do runtime para HTTP/terminal; isso pertence a `presentation/`.
- Semântica vanilla do SDK; a fonte continua em `sdk/`.

## Entradas principais de I/O

- `io-engine.js`: única porta para leitura/escrita local com locks, metadados e invalidação.
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

## Regras de manutenção

- Toda leitura ou escrita nova deve partir de `io-engine.js`; não use `fs.readFile`/`fs.writeFile`
  diretamente em tools ou bordas.
- L1, L2 blob e L2 índice devem ser invalidados pelo mesmo evento de escrita.
- Prefetch pode aquecer dados, mas não vira fonte de verdade; a verdade segue no filesystem via
  `io-engine`.
- Índice responde descoberta, busca e símbolos; quando estiver vazio ou inadequado, a tool deve cair
  para a engine canônica ou para fallback observável.
- Fingerprints de scan usam `realpath + mtimeMs + size`; hashes mais caros entram apenas quando o
  roadmap/benchmark justificar.
- Chunks persistidos pertencem ao índice L2; o cache L2 blob não deve virar catálogo semântico.
- Limites de volume para a LLM-B são informativos, não bloqueantes. Segurança fica nas policies de
  path e permissões.

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
