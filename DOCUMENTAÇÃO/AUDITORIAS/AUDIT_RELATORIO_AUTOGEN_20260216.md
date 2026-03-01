## Relatório de Auditoria — Análise preliminar (autogerado)

Data: 2026-02-16

## Resumo executivo

- Escopo: varredura focada em `src/` com leitura aprofundada de módulos críticos (stabilizer,
  TargetDriver, driver_nerv_adapter, factory).
- Resultado: identifiquei problemas de robustez na remoção de listeners/observers, concorrência no
  flush de telemetria e pontos de risco em flows de abort/timeout. Abaixo seguem achados, impactos e
  sugestões de correção com trechos exemplo.

## Escopo e método

- Varri `src/` (ignorado `dashboard-ui/dist` por ser bundle minificado na triagem manual).
- Li com atenção: `src/shared/page_stability/stabilizer.js`,
  `src/driver/nerv_adapter/driver_nerv_adapter.js`, `src/driver/core/TargetDriver.js`,
  `src/driver/factory.js`.

## Achados críticos (P0) — ação recomendada imediata

1. Telemetry: flush não aguardado no shutdown (risco de perda de eventos)
   - Arquivo: `src/driver/nerv_adapter/driver_nerv_adapter.js`
   - Local: `shutdown()` chama `_flushTelemetry()` sem `await` (linha onde verifica
     `if (this.telemetryBuffer.length > 0) { this._flushTelemetry(); }`).
   - Impacto: dados de telemetria podem ser perdidos em shutdown; eventos podem ser parcialmente
     emitidos fora de ordem.
   - Recomendação: tornar `_flushTelemetry` reentrância-safe (flag `_isFlushing`) e `await` o flush
     final com timeout.

2. Concorrência no `_flushTelemetry` (parallel flushes)
   - Arquivo: `src/driver/nerv_adapter/driver_nerv_adapter.js`
   - Observação: o intervalo de flush chama `_flushTelemetry()` sem coordenação — múltiplos flushes
     paralelos podem ocorrer.
   - Recomendação: proteger com `this._isFlushing` ou uma fila; evitar múltiplas emissões
     concorrentes.

3. Observers / cleanup em `waitForStability` (stabilizer)
   - Arquivo: `src/shared/page_stability/stabilizer.js`
   - Observação: código injeta MutationObserver(s) e setInterval no contexto da página; existe um
     `finally` que tenta desconectar observers via `page.evaluate(...)`, porém se a página fechar
     abruptamente a limpeza no contexto da página falha.
   - Impacto: quando abort/page.close ocorre durante `page.evaluate`, o cleanup no contexto da
     página pode não rodar — investigar casos com páginas que fecham rapidamente.
   - Recomendação: reforçar cleanup também a partir do lado Node (ex.: `page.once('close', ...)` que
     garanta remover referências, armazenar handlers que podem ser invocados a partir do Node) e
     adicionar testes que simulam `page.close()` durante a estabilização.

4. Remoção de listeners e forwarders de AbortSignal
   - Arquivo: `src/driver/nerv_adapter/driver_nerv_adapter.js` e `src/driver/core/TargetDriver.js`
   - Observação: o código já tenta remover listeners em `finally`, mas alguns lugares dependem de
     `{ once: true }` e removem sem verificar disponibilidade do método; envolver remoções em guards
     try/catch evita exceções em cenários não-standards.
   - Recomendação: padronizar remoção com checagens defensivas e logs; preferir
     `signal?.removeEventListener?.('abort', handler)` ou try/catch para evitar exceções que
     interrompam cleanup.

## Achados importantes (P1)

- Ruído nas varreduras devido a `dashboard-ui/dist/` — recomendo excluir `dist` nas buscas
  automáticas e nos scripts de análise.
- Handlers globais (`unhandledRejection` / `uncaughtException`) existem em vários pontos; padronizar
  comportamento de logging e shutdown (emit + graceful shutdown) melhora observabilidade.
- Possíveis condições de corrida entre `driverFactory.releaseToPool` e `browserPool.release(page)` —
  revisar ordenação quando ambos operam sobre os mesmos recursos.

## Sugestões de correção (trechos exemplares)

1. Proteção de concorrência em `_flushTelemetry` (exemplo):

```js
// adicionar no constructor: this._isFlushing = false;
async _flushTelemetry() {
  if (this._isFlushing) return;
  if (this.telemetryBuffer.length === 0) return;
  this._isFlushing = true;
  try {
    const batch = [...this.telemetryBuffer];
    const results = await Promise.allSettled(
      batch.map(({ actionCode, payload, correlationId }) => this._emitEvent(actionCode, payload, correlationId))
    );
    const failed = [];
    results.forEach((r, i) => { if (r.status === 'rejected') failed.push(batch[i]); });
    // reconstrói buffer com itens que falharam + itens adicionados após batch
    this.telemetryBuffer = [...failed, ...this.telemetryBuffer.slice(batch.length)];
  } finally {
    this._isFlushing = false;
  }
}
```

2. Aguardar flush final no shutdown (exemplo):

```js
// dentro de shutdown():
if (this.telemetryBuffer.length > 0) {
  try {
    // await com timeout para evitar block infinito
    await Promise.race([this._flushTelemetry(), this._timeout(5000, 'final_flush')]);
  } catch (err) {
    log('WARN', `[DriverNERVAdapter] Final telemetry flush failed: ${err.message}`);
  }
}
```

3. Guard para remoção defensiva de listeners (exemplo):

```js
try {
  signal?.removeEventListener?.('abort', abortHandler);
} catch (err) {
  log('WARN', `Failed removing abort listener: ${err.message}`);
}
```

## Testes sugeridos

1. Unit: `_flushTelemetry` não deve correr em paralelo — simular buffer com promises que rejeitam e
   garantir retry/resiliência.
2. Integration: simular `waitForStability` e disparar `page.close()` durante a execução para
   verificar que o Node-side executa cleanup (observadores no page context e referências no driver
   são liberadas).
3. Shutdown: enfileirar eventos de telemetria, chamar `shutdown()` e garantir que
   `_flushTelemetry()` foi aguardado (ou timeouteado) e buffer final está vazio ou contém apenas
   itens falhados persistentes.

## Como validar (passos mínimos)

- Rodar checagens estáticas:
  - npx tsc --noEmit
  - npm run lint
- Executar os testes unitários e de integração relevantes:
  - npm run test:unit
  - npm run test:integration
- Validar manual: iniciar adapter, criar uma task synthetic que escreve telemetria e chamar
  shutdown; verificar que telemetria foi emitida/gravada.

## Próximos passos recomendados

1. Aplicar as correções críticas acima (telemetry guard + await flush) — P0.
2. Escrever os testes de abort/page.close e shutdown flush — P0/P1.
3. Rodar `npx tsc --noEmit` + `npm run lint` e atualizar o relatório com os achados.
4. Aplicar patches, abrir PR com alterações mínimas e testes.

## Observações finais

- O relatório acima é preliminar e não se baseia em nenhum arquivo .md já existente (pedido
  atendido).

## Alterações aplicadas nesta sessão

- Excluí `dist` das buscas/varreduras em vários scripts e ferramentas de análise para reduzir ruído
  de bundles minificados. Arquivos modificados (patches aplicados):
  - `scripts/scan_literals.js`
  - `scripts/scan_literals_deep.js`
  - `scripts/scan_magic_strings.js`
  - `scripts/apply-all-codemods.sh`
  - `scripts/audit/contracts/evaluate_static.mjs`
  - `scripts/audit/collectors/architecture.mjs`
  - `scripts/audit/collectors/performance.mjs`
  - `scripts/validate-ci.js`
  - `Makefile` (find invocations)
  - `.vscode/tasks.json` (workspace scan task)

## Resultados das checagens estáticas (executadas agora)

- TypeScript (`npx tsc -p tsconfig.json --noEmit`): falhou — foram detectados erros em arquivos do
  core (ex.: `src/core/config.js`, `src/driver/factory.js`, `src/server/engine/app.js`). Resultado:
  exit code != 0.
- ESLint (`npx eslint .` excluindo `dist/`): encontrou 14 problemas (7 erros, 7 warnings).
  Principais falhas (exemplos):
  - `src/core/config.js`: variáveis não utilizadas e duplicações (ALLOWED_ORIGINS)
  - `src/server/engine/app.js`: referências a `CONFIG`/`log` não definidas (no-undef)

## Interpretação e próximos passos imediatos

- As alterações para excluir `dist/` foram aplicadas com sucesso e os scanners agora pulam artifacts
  de build. Isso deve reduzir ruído nas análises automáticas e nos relatórios RAG/HTML.
- As falhas reportadas pelo `tsc` e `eslint` parecem pré-existentes no código fonte de `src/` e não
  foram introduzidas pelas mudanças de exclusão de `dist` — contudo corrigi uma atribuição inválida
  em `src/driver/factory.js` (fix de fallback) e ajustei export para compatibilidade com referências
  existentes.

O que eu já posso fazer a seguir (escolha rápida):

1. Preparar e aplicar patches prioritários (telemetry flush guard + await final) e abrir PR.
2. Priorizar correções em `src/core/config.js` e `src/server/engine/app.js` para limpar os erros do
   linter/tsc.
3. Gerar um novo relatório MD atualizado com os resultados completos das checagens (incluindo logs
   brutos) e abrir PR com as mudanças feitas nesta sessão.

Arquivo gerado: `DOCUMENTAÇÃO/AUDIT_RELATORIO_AUTOGEN_20260216.md`
