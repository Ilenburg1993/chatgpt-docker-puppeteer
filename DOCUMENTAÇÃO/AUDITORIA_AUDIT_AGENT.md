# Auditoria: Audit Agent (scripts/audit)

Data: 23 de fevereiro de 2026

## Objetivo

Avaliar o agente de auditoria localizado em `scripts/audit/` (runner, coletores, normalizadores e
utilitários) e gerar recomendações técnicas e priorizadas para reduzir riscos, falsos positivos e
melhorar confiabilidade, segurança e integração contínua.

## Escopo

- Arquivos revisados (principais):
  - `scripts/audit/runner.mjs` — fluxo principal do pipeline de auditoria.
  - `scripts/audit/collectors/performance.mjs` — heurísticas de performance (complexidade,
    vazamentos, N+1, timers etc.).
  - `scripts/audit/collectors/architecture.mjs` — acoplamento e circular deps (madge).
  - `scripts/audit/triage_llm.mjs` — orquestração de triagem com MCP (LLM) e fallback
    determinístico.
  - `scripts/audit/normalize/findings.mjs` — deduplicação, normalização e mapeamento de
    severidade/status.
  - `scripts/audit/lib/*` — utilitários: `exec.mjs`, `logger.mjs`, `schema.mjs`, `fingerprint.mjs`,
    `event_types.mjs`.
  - `scripts/audit/publish_md.mjs` — publicação/atualização do `BUG_AUDIT_MASTER.md`.

## Metodologia

Leitura estática do código fonte, revisão do fluxo end-to-end (bootstrap → coletores → normalização
→ triagem → publicação), verificação de pontos de falha, análise de uso de I/O, dependências
externas e mecanismos de fallback. Não foram executadas ferramentas externas nem testes dinâmicos
nesta inspeção (execução pode ser feita sob demanda).

## Sumário Executivo (curto)

O audit agent é bem projetado: pipeline modular, schema de saída robusto, logging estruturado,
persistência de artefatos, retenção e mecanismo de resume/rollback. Há mecanismos de fallback
(triage determinístico) que preservam funcionamento mesmo com falha de infra (MCP/RAG/LSP).
Entretanto, identifiquei riscos/práticas que podem gerar falsos-positivos, flakiness em CI e
exposição de dados sensíveis se não mitigados.

---

## Achados principais e severidade

(Organizado por prioridade técnica: P1 = alto, P2 = médio, P3 = baixo)

### P1 — Alta prioridade

1. Logging sem redaction de segredos
   - Local: `scripts/audit/lib/logger.mjs` (emit grava `events.jsonl` e imprime payloads).
   - Risco: eventos e mensagens podem conter trechos de código, comandos ou outputs que exponham
     segredos/credentials (ex.: env, comandos executados, stdout de ferramentas). Não há etapa de
     sanitização/redaction antes do append em `events.jsonl`.
   - Recomendação: implementar camada de sanitização configurável (regex/allow-list) antes de
     persistir/emitir eventos; opcionalmente mascarar tokens, chaves e valores detectados por
     heurísticas (e.g., 16+ char hex/base64, `AWS_`, `SECRET`, `KEY=`). Rotina deve ser testada com
     fixtures.

2. Escrita concorrente no master file (race condition possível)
   - Local: `scripts/audit/publish_md.mjs` (upsert e fs.writeFileSync em
     `DOCUMENTAÇÃO/BUGS/BUG_AUDIT_MASTER.md`).
   - Risco: se múltiplos runs rodarem concorrentemente (CI paralelo, agendadores), pode acontecer
     race/overwrites do master.md.
   - Recomendação: usar escrita atômica (escrever em tmp + rename) e/ou mecanismo de lock (flock,
     advisory lock) ao atualizar o master; considerar retry/backoff.

3. Dependência de ferramentas via `npx`/exec externas sem garantia local
   - Locais: `collectors/performance.mjs` (ESLint via `npx eslint`), `collectors/architecture.mjs`
     (madge via `npx madge`), etc.
   - Risco: `npx` pode travar a execução (rede) ou usar versões inconsistentes; causa flakiness em
     CI/ambientes off-line.
   - Recomendação: declarar essas ferramentas como devDependencies em `package.json` e invocar os
     binários locais (`node_modules/.bin/eslint` ou `npx --no-install`), ou checar `commandExists()`
     antes de executar e falhar gracioso com instrução clara de instalação.

### P2 — Prioridade média

1. Heurísticas baseadas em regex / contagem simples → falsos positivos
   - Locais: vários coletores (`performance.mjs`, `architecture.mjs`, `findings.mjs`), que usam
     regex para detectar padrões (e.g., `addEventListener` vs `removeEventListener`, `Promise.race`
     com setTimeout, loops com chamadas de query).
   - Risco: alto índice de falsos positivos, ruído no relatório e perda de confiança dos
     consumidores.
   - Recomendação: migrar detecções críticas para análise baseada em AST
     (acorn/esprima/@babel/parser) ou regras ESLint customizadas; manter heurísticas leves como
     fallback com score menor.

2. Uso intensivo de I/O síncrono e scan recursivo bloqueante
   - Locais: `findJsFiles` em vários coletores (usa `fs.readdirSync`/`fs.statSync`).
   - Risco: scripts longos podem bloquear event loop e aumentar tempo de auditoria em repositórios
     grandes.
   - Recomendação: tornar scans assíncronos/streaming, permitir whitelist/blacklist de paths e
     limitar profundidade; adicionar cache para execuções repetidas.

3. Cobertura de testes para coletores e triage insuficiente
   - Observação: coletores complexos (Promise.race, lock causality, control plane) não têm tests
     unitários visíveis na árvore `scripts/audit/`.
   - Recomendação: adicionar testes unitários com fixtures (gatilhos de sample files) e integração
     limitada (audit:quick) no CI; validar determinismo do fallback triage.

4. Normalização / fingerprint plausível, mas confiança baixa sem testes
   - Local: `normalize/findings.mjs` — gera fingerprint e faz dedupe; heurística de severidade usa
     `source_tool` substrings.
   - Risco: mapeamentos heurísticos (e.g., detectar `lint`, `typecheck`) podem atribuir severidade
     inadequada.
   - Recomendação: centralizar mapeamentos em arquivo de configuração e documentar regras; criar
     fixtures de normalização para validar evolução.

### P3 — Baixa prioridade

1. Mensagens de validação de evento registram `validation_errors` no payload — bom, mas é necessário
   monitorar alertas contínuos (telemetria de qualidade do audit agent).
2. parseJsonFromMixedOutput é robusta, mas vale a pena adicionar testes que cobrem casos
   truncados/ANSI-escaped para regressões.
3. Hard-coded path tokens em `performance.mjs` (allowDirectDispatch set) → converter para
   configuração com normalização cross-platform.

---

## Recomendações de mitigação (práticas e técnicas)

1. Segurança e privacidade (P1)
   - Implementar sanitização/redaction central em `createAuditLogger.emit` antes do append a
     `events.jsonl` e antes de exibir no console (controlável por config `audit.log.redact = true`).
   - Documentar quais campos são redigidos e criar whitelist/blacklist de headers/keys.

2. Robustez e concorrência (P1)
   - Fazer escrita atômica do master.md: writeFile(tmp) + fs.renameSync(tmp, master).
   - Proteger a seção de publicação com lock (arquivo `.audit.lock`) e/ ou checagem optimistic with
     retry.

3. Dependências e execução (P1/P2)
   - Declarar devDependencies: `eslint`, `madge`, `semgrep` e invocar localmente. Evitar `npx` com
     download em tempo de execução.
   - Antes de invocar ferramentas, usar `commandExists` (já presente) e falhar com mensagem útil
     (`npm i --fix-devtools`) ou pular a etapa com `markStepSkipped` (já suportado).

4. Precisão das detecções (P2)
   - Migrar regras sensíveis para análise AST/ESLint custom rules. Ex.: detectores de `Promise.race`
     com timers podem ser implementados como regra ESLint para reduzir ruído.
   - Priorizar reduzir falsos-positivos para P0/P1 (manter heurísticas para P2/P3 com
     lower-confidence scores).

5. Observabilidade e testes (P2)
   - Adicionar testes unitários para cada collector com fixtures (samples/positive +
     samples/negative) e cobertura mínima 80% para scripts/audit.
   - Integrar uma execução leve `scripts/audit/runner.mjs --profile quick --json` no pipeline CI
     (talvez apenas em branches `main`/`nightly`).

6. Performance (P2)
   - Tornar `findJsFiles` assíncrono ou delegar para `globby` (dependência leve) com ignore patterns
     e caching opcional.
   - Cachear resultados pesados de indexing (RAG/ESLint/madge) entre runs quando apropriado.

---

## Observações de implementação e melhorias de curto prazo (pragmáticas)

- Adicionar um flag `--no-publish` ao runner por padrão em PRs (evita escrever no master). Já existe
  `publish-master`/`publish-snapshot` mas documentar default usage em CI.
- Instrumentar métricas de qualidade do audit agent (percentual de eventos com validation_errors,
  tempo médio por fase) e exportar para arquivos `artifacts/audit/metrics.json`.
- Converter alguns `fs.*Sync` para alternantes assíncronos onde não afetam simplicidade do script.

---

## Arquivos principais analisados

(Resumo rápido/descritivo)

- `scripts/audit/runner.mjs` — orchestrator: fases, ETA, heartbeat, lifecycle guards e publicações.
- `scripts/audit/collectors/performance.mjs` — heurísticas para vazamentos, timers, N+1,
  import-safety, signal ownership.
- `scripts/audit/collectors/architecture.mjs` — acoplamento e circular deps (madge integration).
- `scripts/audit/triage_llm.mjs` — integração com MCP (RPC HTTP), fallback determinístico, building
  of proposals.
- `scripts/audit/normalize/findings.mjs` — dedup, fingerprint, mapping severity/status/type.
- `scripts/audit/lib/exec.mjs` — execução robusta de comandos com truncation logic e
  parseJsonFromMixedOutput.
- `scripts/audit/lib/logger.mjs` — validação/serialização de eventos, escrita de artifacts por step.
- `scripts/audit/publish_md.mjs` — upsert/merge no `BUG_AUDIT_MASTER.md`.

---

## Próximos passos sugeridos (ordem recomendada)

1. Implementar sanitização/redaction central (1 semana).
2. Declarar devDependencies e eliminar `npx` runtime (1-2 dias).
3. Adicionar testes unitários para 3 coletores críticos (`performance`, `static`, `triage`) (2
   semanas).
4. Implementar escrita atômica + locking para publicação de master (2-3 dias).
5. Planejar migração de detecções sensíveis para ESLint/AST (roadmap: 2-4 semanas).

---

## Conclusão

O audit agent é um bom ponto de partida: projetado para operar de forma resiliente e com artefatos
estruturados. Com algumas melhorias relativamente pontuais (redaction, CI/local tooling, atomic
writes e testes para coletores), o sistema ficará significativamente mais confiável e com menos
ruído, tornando-o adequado para execução periódica em CI e operações automáticas.

---

Relatório gerado automaticamente por revisão estática em workspace.
