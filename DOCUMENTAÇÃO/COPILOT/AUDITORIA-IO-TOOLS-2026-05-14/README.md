# Auditoria IO e Tools — 2026-05-14

Pacote canônico desta rodada de investigação e roadmap para `src/copilot/infra` e `src/copilot/tools`.

## Ordem de leitura

1. [00-SITUACAO-ATUAL.md](./00-SITUACAO-ATUAL.md)
   - fatos confirmados no código real;
   - leitura crítica das auditorias externas;
   - riscos prioritários de `infra/` e `tools/`.
2. [01-SITUACAO-IDEAL.md](./01-SITUACAO-IDEAL.md)
   - arquitetura alvo 2.0/2.1;
   - regras barrel-first;
   - desenho de liberdade, eficácia e eficiência para LLM-B.
3. [02-ROADMAP-FAIXAS-FASES.md](./02-ROADMAP-FAIXAS-FASES.md)
   - faixas, fases e subfases de transformação;
   - ordem prática de PRs;
   - gates de validação.
4. [03-VALIDADORES-E-EVIDENCIAS.md](./03-VALIDADORES-E-EVIDENCIAS.md)
   - comandos validadores oficiais para esta trilha;
   - inventário de arquivos, ciclos, hotspots e lacunas de teste.
5. [04-STATUS-EXECUCAO-INICIAL.md](./04-STATUS-EXECUCAO-INICIAL.md)
   - transformações já executadas nesta rodada;
   - validadores rodados;
   - pendências para a próxima onda.

## Escopo

- Escopo de trabalho: `src/copilot`.
- Núcleo auditado nesta rodada: `src/copilot/infra` e `src/copilot/tools`.
- Insumos externos lidos integralmente e tratados como suspeitos:
  - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/IO1.MD`
  - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/IO2.md`

## Status executivo

As auditorias externas acertam o diagnóstico macro: `infra/` tem uma fundação útil, mas ainda não está no padrão
arquitetural 2.0/2.1, sofre com monólito de I/O, ciclo ESM, budgets fracos, locks parcialmente frágeis e indexação
semanticamente imprecisa.

A auditoria própria adiciona uma correção importante: `tools/` está realmente mais avançada em barrelização e contratos,
mas ainda tem bypasses diretos de `infra`, ferramentas de index/scope sem validação de path no boundary e validadores
de code-tools apontando para scripts legados. Portanto, a prioridade não é apenas "melhorar infra"; é alinhar
`infra` e `tools` como uma superfície única de capacidades para a LLM-B.

## Status da execução inicial

Faixa 0 iniciada e validada:

- boundary de `workspace_index_*` e `workspace_scope_*` endurecido;
- tools migradas para facades `infra/public/*`;
- code/git/shell validators alinhados e com buffers/timeouts mais seguros;
- search com timeout e janela inicial de resultados;
- índice corrigido para parsear snapshot e respeitar `parseError`;
- locks e lockfile fortalecidos;
- parser/cache/invalidação recursiva corrigidos;
- validadores oficiais verdes em 2026-05-14.
