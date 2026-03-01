# NERV Integration Checklist — Consolidação

Status: CONCLUIDO (migração canônica aplicada; refinamentos em andamento)

Objetivo

- Confirmar que todo o runtime do repositório utiliza o barramento NERV como fonte da verdade
- Deprecar o fallback baseado em `estado.json` (opt‑in via `ENABLE_STATE_FILE=true`)

O que foi feito

- `src/nerv/discovery.js` implementado (publicação/escuta `SERVER_READY`, fallback opt‑in).
- `src/nerv/adapters/high_level_adapter.js` fornece `makeEnvelope`, `sendEvent`, `sendCommand`,
  `sendAck`.
- `src/server/main.js` delega persistência a `Discovery.publishServerReady` (NERV-first).
- `src/server/engine/lifecycle.js` usa `Discovery.unpublishServerReady()` na limpeza.
- DevContainer hooks (`.devcontainer/scripts`) ajustados para não gravar/ler estado por padrão.
- `ecosystem.config.cjs` anotado com aviso depreciação para `estado.json`.
- Vários documentos atualizados para indicar depreciação e instruir uso de NERV.
- Teste unitário adicionado: `tests/unit/nerv/test_discovery.spec.js` (cobre
  publish/wait/listen/fallback).

Verificações locais rápidas

- Rodar o verificador de padrões proibidos (escopo `src/`):

```bash
npm run check:forbidden
```

- Rodar testes unitários (arquivo de exemplo):

```bash
node --test tests/unit/nerv/test_discovery.spec.js
```

Recomendações para CI e validação

- `check:forbidden` já está integrado no job de dependências no workflow CI
  (.github/workflows/ci.yml).
- A suíte de testes (`npm test`) roda em multiplataforma no job `test` do CI.
- Sugiro monitorar o relatório de ocorrências `estado.json` após a próxima execução do CI para
  capturar consumidores legados remanescentes.

Próximos passos (sugeridos, automatizáveis)

1. Corrigir/atualizar quaisquer scripts restantes que dependam diretamente de `estado.json`
   (converter para `Discovery` ou documentar opt‑in).
2. Executar `npm test` completo no CI e resolver falhas de integração (se houver).
3. Após confirmação de zero consumidores legados, remover `PATHS.STATE` e a lógica de fallback em
   `src/nerv/discovery.js`.
4. Opcional: adicionar um job CI `check:forbidden:repo` que verifica referências a `estado.json`
   fora de `src/` e falha se encontradas (útil como gate antes da remoção final).

Notas

- Backups e `tools/outputs` podem conter referências históricas a `estado.json` — esses arquivos não
  representam código em execução e podem ser preservados.
- Se quiser, eu posso implementar o job `check:forbidden:repo` e/ou automatizar a atualização de
  documentos restantes que mencionam `estado.json`.
