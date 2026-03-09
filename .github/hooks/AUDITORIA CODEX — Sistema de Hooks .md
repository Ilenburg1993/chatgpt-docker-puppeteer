# AUDITORIA COMPLETA — Sistema de Hooks e Ecossistema Associado
**Projeto:** chatgpt-docker-puppeteer
**Data:** 2026-03-09
**Escopo:** `.github/hooks/*`, `.git/hooks/*`, scripts de status/trace e integração com logs/estado
**Tipo:** Auditoria técnica profunda + plano de correção + plano de upgrade massivo

---

## 1. Sumário Executivo

Esta auditoria identificou problemas estruturais relevantes no sistema de hooks, com impacto em:

- confiabilidade do fluxo de automação;
- consistência de estado de sessão;
- precisão de métricas e relatórios;
- segurança e higiene de logs;
- governança de contratos de evento.

### Resultado geral
- **Estado funcional:** parcial (há valor operacional, mas com inconsistências críticas).
- **Risco atual:** **alto** para observabilidade e consistência de sessão.
- **Prioridade imediata:** corrigir contrato de hook de push, crash de relatório diário, unificação de schema de sessão e contrato de eventos.

---

## 2. Escopo e Metodologia

### Escopo auditado
- Hooks locais Git: `.git/hooks/pre-commit`, `.git/hooks/commit-msg`, `.git/hooks/post-commit`.
- Instalação de hooks Git: [install-git-hooks.sh](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/install-git-hooks.sh).
- Hooks Copilot: [copilot-hooks.json](/workspaces/chatgpt-docker-puppeteer/.github/hooks/copilot-hooks.json).
- Scripts operacionais em `.github/hooks/scripts/`.
- Estado e logs: `.github/hooks/state/*`, `.github/hooks/logs/*`.
- Utilitários associados: `scripts/hooks-status.sh`, `scripts/trace-commit.sh`.

### Método
- Inspeção estática de scripts (Bash, jq filters, contrato de eventos).
- Verificação de consistência entre produtores e consumidores de eventos.
- Verificação de schema de estado e compatibilidade cruzada.
- Verificação de robustez operacional (timeouts, lock, rotação, atomicidade).
- Verificação de segurança em logging/redaction.
- Verificação de integridade de relatórios e métricas.

---

## 3. Topologia Atual (Visão Consolidada)

### Entrada de eventos
- Hooks Copilot disparam scripts definidos em [copilot-hooks.json](/workspaces/chatgpt-docker-puppeteer/.github/hooks/copilot-hooks.json).
- Hooks Git locais são instalados por [install-git-hooks.sh](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/install-git-hooks.sh).

### Estado e logs
- Estado de sessão principal: `.github/hooks/state/session-context.json`.
- Log principal: `.github/hooks/logs/audit.jsonl`.
- Logs auxiliares: `tool-metrics.jsonl`, `errors.jsonl`, `findings.jsonl`.
- Artefatos de sessão: `session-briefing.md`, checkpoints, section summaries.

### Processamento e relatórios
- Resumos e analytics via:
  - [generate-daily-report.sh](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-daily-report.sh)
  - [generate-session-summary.sh](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-session-summary.sh)
  - [analytics.sh](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/analytics.sh)
  - [export-metrics.sh](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/export-metrics.sh)

---

## 4. Achados (Bugs, Gaps, Incompletudes)

## 4.1 Críticos

### H-001 — Hook Git de push instalado com nome inválido (`post-push`)
**Severidade:** Crítico
**Tipo:** Bug funcional / integração Git
**Evidência:**
- Instalação de `post-push` em [install-git-hooks.sh:117](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/install-git-hooks.sh:117).
- Script de push documenta `post-push` em [on-git-push.sh:4](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/on-git-push.sh:4).
- Hook nativo esperado pelo Git: `pre-push` (não existe `post-push` padrão).
- Em `.git/hooks` não há `post-push` instalado.
**Impacto:**
- `on-git-push.sh` pode nunca disparar automaticamente.
- `pending_section_after_push` pode não ser atualizado.
- Compliance de fluxo pós-push fica inconsistente.
**Correção proposta:**
- Migrar instalação para `pre-push`.
- Ajustar parsing de stdin do hook `pre-push`.
- Atualizar smoke-test e documentação.

---

### H-002 — Crash do relatório diário por variável não definida (`ERRORS_TODAY`)
**Severidade:** Crítico
**Tipo:** Bug de execução
**Evidência:**
- Uso de `ERRORS_TODAY` em [generate-daily-report.sh:286](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-daily-report.sh:286).
- Variável não inicializada no script com `set -euo pipefail`.
**Impacto:**
- Geração de relatório diário falha.
- Comando de status pode abortar e mascarar diagnóstico.
**Correção proposta:**
- Inicializar e calcular `ERRORS_TODAY` corretamente.
- Adicionar teste de regressão de execução do relatório.

---

## 4.2 Altos

### H-003 — Divergência de schema de sessão (`.session.id` vs `.session_id`)
**Severidade:** Alto
**Tipo:** Inconsistência de contrato
**Evidência:**
- Leitura legada `.session_id` em:
  - [add-task.sh:71](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/add-task.sh:71)
  - [complete-task.sh:37](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/complete-task.sh:37)
  - [resolve-finding.sh:47](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/resolve-finding.sh:47)
  - [reset-auth-violation.sh:41](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/reset-auth-violation.sh:41)
- Schema canônico usa `.session.id` em [session-start.sh:106](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/session-start.sh:106).
**Impacto:**
- Scripts gravam eventos com `session_id` vazio/incorreto.
- Métricas por sessão degradam.
**Correção proposta:**
- Tornar `.session.id` único canônico.
- Remover leituras legadas e adicionar migração defensiva temporária.

---

### H-004 — Contrato de eventos divergente (`toolFailure` legado vs `toolUseFailure` atual)
**Severidade:** Alto
**Tipo:** Bug de analytics
**Evidência:**
- Produtor atual: [tool-use-failure.sh:25](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/tool-use-failure.sh:25) usa `toolUseFailure`.
- Consumidores ainda leem `toolFailure`:
  - [session-start.sh:282](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/session-start.sh:282)
  - [generate-session-summary.sh:43](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-session-summary.sh:43)
**Impacto:**
- Subcontagem de falhas.
- Taxas históricas erradas.
**Correção proposta:**
- Padronizar para `toolUseFailure` e manter compatibilidade temporária dual.
- Criar tabela canônica de eventos.

---

### H-005 — Flood de `session_id_mismatch` e bloqueio de escrita de estado
**Severidade:** Alto
**Tipo:** Bug operacional de sessão
**Evidência:**
- Grande volume de eventos `session_id_mismatch` no `audit.jsonl`.
- Mismatch recorrente entre `expected` e `got` em `pre-tool-use`/`post-tool-use`.
**Impacto:**
- Estado deixa de ser atualizado em turnos reais.
- Métricas e compliance perdem fidelidade.
**Correção proposta:**
- Redesenhar política de reconciliação de sessão.
- Tratar troca legítima de sessão sem bloquear fluxo inteiro.
- Registrar mismatch com metadados mínimos e ação de healing controlada.

---

### H-006 — `reset-auth-violation.sh` atualiza campos legados inexistentes
**Severidade:** Alto
**Tipo:** Bug semântico
**Evidência:**
- Escreve `.consecutive_unauthorized_closes` e `.last_close_authorized` em [reset-auth-violation.sh:62](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/reset-auth-violation.sh:62).
- Campo canônico atual está em `.compliance.*`.
**Impacto:**
- Reset pode aparentar sucesso sem efeito real nos campos usados.
**Correção proposta:**
- Atualizar script para `.compliance.consecutive_unauthorized` e `.compliance.last_turn_authorized`.

---

### H-007 — Ausência de locking transacional em estado/logs críticos
**Severidade:** Alto
**Tipo:** Confiabilidade / concorrência
**Evidência:**
- Múltiplos scripts escrevem mesmo `session-context.json` e `audit.jsonl` sem lock coordenado.
**Impacto:**
- Risco de race condition, lost updates e inconsistência temporal.
**Correção proposta:**
- Introduzir lock de arquivo (`flock`) para seções críticas de escrita.
- Padronizar helper de escrita atômica.

---

## 4.3 Médios

### M-001 — `smoke-test.sh` com validações frágeis e falso senso de cobertura
**Severidade:** Médio
**Tipo:** Gap de qualidade
**Evidência:**
- Valida presença textual de `post-push` em [smoke-test.sh:419](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/smoke-test.sh:419), reforçando contrato inválido.
- Padrão `A && B || C` em checks de schema gera alerta SC2015.
**Impacto:**
- Teste pode “passar” mesmo com comportamento real incorreto.
**Correção proposta:**
- Reescrever cenários de smoke para comportamento efetivo.
- Alinhar checks ao contrato Git correto (`pre-push`).

---

### M-002 — `generate-section-summary.sh` usa ferramentas da sessão inteira
**Severidade:** Médio
**Tipo:** Precisão de métrica
**Evidência:**
- Query de ferramentas filtra por sessão, não por seção:
  - [generate-section-summary.sh:72](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-section-summary.sh:72)
  - [generate-section-summary.sh:77](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-section-summary.sh:77)
**Impacto:**
- Sumário de seção fica inflado e enganoso.
**Correção proposta:**
- Filtrar por janela temporal da seção e/ou `section_id`.

---

### M-003 — Timestamp inconsistente (ISO + epoch + null)
**Severidade:** Médio
**Tipo:** Observabilidade
**Evidência:**
- `audit.jsonl` contém timestamps heterogêneos e eventos sem timestamp efetivo.
**Impacto:**
- Consultas por data e relatórios ficam frágeis.
**Correção proposta:**
- Normalizar para ISO-8601 UTC em todos os eventos.
- Fallback obrigatório para `date -u` quando payload não traz timestamp.

---

### M-004 — Pre-commit em modo apenas informativo
**Severidade:** Médio
**Tipo:** Gap de governança
**Evidência:**
- Hook sempre libera commit (`exit 0`) em `.git/hooks/pre-commit`.
**Impacto:**
- Qualidade depende totalmente de disciplina manual.
**Correção proposta:**
- Tornar política configurável: `warn` vs `enforce`.
- Default recomendado: enforce em CI, warn local opcional.

---

## 4.4 Segurança e Privacidade

### S-001 — Persistência de payloads de diagnóstico pode expor dados sensíveis
**Severidade:** Alto
**Tipo:** Segurança de dados
**Evidência:**
- Arquivos de captura bruta em `.github/hooks/logs/raw-input.jsonl` e `raw-post-input.jsonl`.
- Mesmo com redaction em fluxo principal, histórico bruto pode conter material sensível antigo.
**Impacto:**
- Risco de exposição de conteúdo confidencial em ambiente local.
**Correção proposta:**
- Descontinuar captura bruta por padrão.
- Adotar modo debug explícito com TTL e purge automático.
- Revisar/redigir arquivos já existentes.

---

### S-002 — Redaction por regex insuficiente para payloads complexos
**Severidade:** Médio
**Tipo:** Segurança de logs
**Evidência:**
- Redaction atual em `pre-tool-use.sh` usa regex em string serializada.
**Impacto:**
- Campos sensíveis aninhados podem escapar em formatos não previstos.
**Correção proposta:**
- Redaction estrutural com allowlist de chaves logáveis.
- Drop de campos não necessários por padrão.

---

## 5. Gaps e Incompletudes Estruturais

- Ausência de contrato de evento versionado e central.
- Ausência de biblioteca comum para operações repetidas (timestamp, session_id, writes atômicas, logs).
- Falta de lock global para recursos compartilhados.
- Rotação parcial de logs (foco majoritário em `audit.jsonl`, sem política equivalente para todos os JSONL).
- Documentação parcialmente divergente do comportamento real em alguns fluxos.
- Testes ainda acoplados a presença textual em vez de comportamento observável ponta a ponta.

---

## 6. Plano Consolidado de Correção e Upgrade Massivo

## Fase 0 — Hotfixes imediatos (P0/P1)
**Objetivo:** restaurar estabilidade mínima.

- Corrigir `post-push` para `pre-push` em instalação e smoke-test.
- Corrigir variável `ERRORS_TODAY` em relatório diário.
- Corrigir scripts que leem `.session_id` legado para `.session.id`.
- Corrigir `reset-auth-violation.sh` para campos canônicos.
- Padronizar consumidores para `toolUseFailure`.

**Saída esperada:** fluxo funcional sem crash e sem perdas óbvias de sessão.

---

## Fase 1 — Unificação de contrato (estado + eventos)
**Objetivo:** eliminar dívida semântica.

- Definir `schema_version` em `session-context.json`.
- Definir `events-contract.md` com campos obrigatórios por evento.
- Normalizar timestamp ISO UTC em todos os eventos.
- Adicionar camada de compatibilidade temporária para legado.

**Saída esperada:** dados consistentes e previsíveis para analytics.

---

## Fase 2 — Confiabilidade transacional
**Objetivo:** evitar corrupção por concorrência.

- Implementar lock por arquivo para escrita de `session-context` e JSONLs.
- Encapsular escrita em helper comum (atomic write + fallback + erro observável).
- Revisar scripts de maior concorrência (`pre-tool-use`, `post-tool-use`, `agent-stop`, `session-end`).

**Saída esperada:** integridade de estado e logs sob carga real.

---

## Fase 3 — Segurança de logs
**Objetivo:** minimizar superfície de vazamento.

- Desabilitar raw logs por padrão.
- Implementar redaction estrutural.
- Definir retenção e purge para logs auxiliares.
- Validar ausência de secrets em pipelines de auditoria.

**Saída esperada:** observabilidade útil com menor risco de exposição.

---

## Fase 4 — Testabilidade e governança
**Objetivo:** prevenir regressões.

- Reescrever smoke-test para cenários comportamentais.
- Adicionar testes de integração de contratos (eventos e estado).
- Definir gate CI específico para hooks e contratos.
- Criar checklist de release para mudanças de hook.

**Saída esperada:** alterações seguras e rastreáveis.

---

## 7. Proposta de Refactor Agressivo (Upgrade Massivo)

### Arquitetura alvo
- `hooks-lib/common.sh`: utilitários canônicos (log_event, get_session_id, iso_now, with_lock, write_ctx).
- `contracts/hooks/events.schema.json`: contrato formal de eventos.
- `contracts/hooks/session-context.schema.json`: contrato formal de estado.
- `scripts/hooks-verify-contracts.sh`: valida produtores/consumidores.
- `scripts/hooks-replay-test.sh`: replay de fixtures JSON reais para regressão.

### Estratégia de migração
- Rodar dual-write de eventos por curto período (novo + compat legado).
- Congelar adições de novos campos fora do contrato.
- Fazer corte de legado em versão controlada após estabilização.
- Publicar changelog de migração para todos os scripts dependentes.

---

## 8. Plano de Testes (Detalhado)

### Testes obrigatórios
- `bash -n` em todos os scripts de hooks.
- `shellcheck` com baseline sem alertas relevantes.
- Teste de instalação de hooks Git e verificação de arquivos corretos em `.git/hooks`.
- Fluxo completo em sandbox:
  - `sessionStart`
  - `userPromptSubmitted`
  - `preToolUse`/`postToolUse`
  - `agentStop`
  - `sessionEnd`
  - evento de push (`pre-push`)
- Testes de relatório:
  - `generate-daily-report.sh`
  - `generate-session-summary.sh`
  - `analytics.sh`
  - `export-metrics.sh`

### Casos de regressão prioritários
- Sessão sem `sessionStart` seguido de auto-recovery.
- Troca de sessão real sem flood de mismatch.
- Falha de ferramenta refletida corretamente nos relatórios.
- Encerramento com e sem close key.
- Rotação de logs acima dos thresholds.

---

## 9. Critérios de Aceite

- Nenhum crash nos scripts principais.
- Contrato de push Git funcional e verificado.
- Zero leitura de `.session_id` legado nos scripts ativos.
- Eventos e timestamps normalizados.
- Taxa de falhas em relatório coerente com dados reais.
- Mismatch de sessão reduzido a casos realmente excepcionais.
- Smoke e integração aprovados com cenário realista.

---

## 10. Backlog Priorizado (Executivo)

## Prioridade P0
- Corrigir hook de push Git para contrato válido.
- Corrigir crash de relatório diário.
- Corrigir schema de sessão nos scripts legados de tasks/findings/reset.

## Prioridade P1
- Unificar contrato de eventos (`toolUseFailure` e timestamps).
- Mitigar flood de session mismatch com reconciliação robusta.
- Corrigir métricas de sumário por seção.

## Prioridade P2
- Implementar locking transacional.
- Reescrever smoke-test com foco comportamental.
- Hardening de logs e redaction estrutural.

## Prioridade P3
- Formalizar contratos em schema versionado.
- Criar suíte de replay e verificação automática de contratos.
- Consolidar documentação operacional pós-migração.

---

## 11. Riscos e Mitigações

- **Risco:** quebra de compatibilidade em scripts antigos.
  **Mitigação:** dual-read/dual-write temporário e depreciação faseada.

- **Risco:** overhead de lock em hooks frequentes.
  **Mitigação:** lock granular, escopo mínimo e medições de latência.

- **Risco:** perda de dados durante migração de schema.
  **Mitigação:** backup de logs/estado e rollback scriptado.

---

## 12. Conclusão

O sistema atual tem base funcional, mas carrega inconsistências que comprometem confiança operacional.
A combinação de correções imediatas + refactor agressivo por fases resolve bugs críticos, reduz dívida estrutural e estabelece uma plataforma sustentável para evolução dos hooks.

---

## 13. Evidências-Chave (Referências Diretas)

- [install-git-hooks.sh:117](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/install-git-hooks.sh:117)
- [on-git-push.sh:4](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/on-git-push.sh:4)
- [smoke-test.sh:419](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/smoke-test.sh:419)
- [generate-daily-report.sh:286](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-daily-report.sh:286)
- [session-start.sh:282](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/session-start.sh:282)
- [generate-session-summary.sh:43](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-session-summary.sh:43)
- [add-task.sh:71](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/add-task.sh:71)
- [complete-task.sh:37](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/complete-task.sh:37)
- [resolve-finding.sh:47](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/resolve-finding.sh:47)
- [reset-auth-violation.sh:41](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/reset-auth-violation.sh:41)
- [reset-auth-violation.sh:62](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/reset-auth-violation.sh:62)
- [tool-use-failure.sh:25](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/tool-use-failure.sh:25)
- [pre-tool-use.sh:31](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/pre-tool-use.sh:31)
- [post-tool-use.sh:28](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/post-tool-use.sh:28)
- [generate-section-summary.sh:72](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-section-summary.sh:72)
- [generate-section-summary.sh:77](/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/generate-section-summary.sh:77)
