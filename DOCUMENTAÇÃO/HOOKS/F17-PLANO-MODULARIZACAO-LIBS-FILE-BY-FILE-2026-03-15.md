# F17 — Modularização orientada por arquivo (hooks automáticos)

**Data**: 2026-03-15 **Escopo**: `.github/hooks/copilot-hooks.json` (9 hooks automáticos)
**Objetivo**: avançar da convergência lib-first (F13→F16) para uma modularização rígida, arquivo por
arquivo, com fronteiras explícitas entre `script principal`, `entry-lib` e `libs compartilhadas`.

## Princípio central da F17

Cada hook automático terá uma fase dedicada, com critérios de extração e governança homogêneos.

- **Script principal**: bootstrap, validações mínimas de contrato, `source` de libs e dispatch
  único.
- **Entry-lib**: orquestração do fluxo de domínio do hook, sem duplicar infra comum.
- **Libs compartilhadas** (`runtime/context/policy/lifecycle/audit/maintenance/testing`):
  utilitários reutilizáveis, operações transversais e helpers de baixo nível.

## Fronteira de responsabilidades (norma F17)

### O que deve ficar no script principal

1. Resolver `HOOK_DIR`/paths essenciais.
2. Validar presença dos arquivos de lib exigidos.
3. `source` de `common.sh` (e `policy.sh` quando aplicável).
4. Verificar existência da função pública canônica.
5. Executar **um dispatch principal** para `run_*_hook`.
6. Retornar `exit $?`.

### O que NÃO deve ficar no script principal

- Regras de domínio (autorização, lifecycle, recovery, métricas).
- Escritas diretas de contexto/auditoria (`jq/sponge` inline).
- Processamento de payload além de validação mínima.
- Branching comportamental complexo.

### O que deve ficar na entry-lib

1. Fluxo principal do hook (sequenciamento de regras).
2. Parsing/normalização de payload (usando helpers compartilhados).
3. Chamada de helpers de domínio e módulos auxiliares.
4. Emissão de eventos/auditoria no ponto correto.
5. Coordenação de fail-open/fail-fast por bloco.

### O que deve ir para libs compartilhadas

- **runtime/**: parsing de input, paths, lock/timeout wrappers.
- **context/**: leitura/escrita transacional de session-context.
- **policy/**: autorização, continuidade, reason codes.
- **lifecycle/**: blocos reutilizáveis start/end/subturn/section.
- **audit/**: serialização e emissão de eventos.
- **maintenance/**: sync/rotate/checkpoint auxiliares.
- **testing/**: fixtures e checks estruturais automatizados.

## Sequência de fases por arquivo (F17.1 → F17.9)

### F17.0 — Preparação canônica (transversal)

- Congelar rubric Script Fino e hard-gates aplicados em F17.
- Definir template de PR por arquivo com checklist fixo.
- Publicar índice de fase por arquivo (`state/f17-file-by-file-modularization-plan.json`).

### F17.1 — `session-start.sh` / `session-start-lib.sh`

- Consolidar script como wrapper estrito.
- Garantir que carga de `session-start-core/aux` seja responsabilidade da entry-lib.
- Externalizar blocos pesados de briefing/analytics para auxiliares reutilizáveis.

### F17.2 — `log-prompt.sh` / `log-prompt-lib.sh`

- Eliminar qualquer regra de turno residual no script.
- Isolar no entry-lib: hash/privacidade, reset de estado de turn, enriquecimento auditável.
- Padronizar dependências com helpers de `context/` e `audit/`.

### F17.3 — `pre-tool-use.sh` / `pre-tool-use-lib.sh`

- Script estritamente bootstrap + dispatch.
- Concentrar no entry-lib o fluxo de guardas pré-ferramenta.
- Extrair validações reaproveitáveis para `policy/` (evitar drift com post/stop).

### F17.4 — `post-tool-use.sh` / `post-tool-use-lib.sh`

- Script estritamente bootstrap + dispatch.
- No entry-lib: classificação de resultado, tratamento de askQuestions e KEY flow.
- Promover blocos comuns com `pre-tool-use` para módulo policy compartilhado.

### F17.5 — `agent-stop.sh` / `agent-stop-lib.sh`

- Manter `agent-stop.sh` estável como entrypoint de referência.
- Decompor internamente `agent-stop-lib.sh` por domínio:
  - `stop-auth`, `stop-block`, `stop-subturn`, `stop-observability`.
- Reduzir acoplamento com `common.sh` via contratos de módulo.

### F17.6 — `subagent-start.sh` / `subagent-start-lib.sh`

- Script mínimo sem lógica de domínio.
- Entry-lib responsável por correlação/session counters e auditoria.
- Reuso de utilitários de lifecycle para evitar duplicação com subagent-stop.

### F17.7 — `subagent-stop.sh` / `subagent-stop-lib.sh`

- Script mínimo sem lógica de domínio.
- Entry-lib centraliza fechamento/correlação/telemetria de subagente.
- Compartilhar contratos de start/stop em helper único de lifecycle/subagent.

### F17.8 — `pre-compact.sh` / `pre-compact-lib.sh`

- Script wrapper puro.
- Entry-lib centraliza checkpoint pré-compactação + metadados de recuperação.
- Extrair persistências para `context/` com política transacional única.

### F17.9 — `session-end.sh` / `session-end-lib.sh`

- Script wrapper puro (já convergindo no fechamento da F14.3).
- Entry-lib coordena close crítico + pós-processamento fail-open.
- Consolidar uso de `session-end-core/aux` e preparar evolução para submódulos.

## Subfases padrão por arquivo (aplicadas em F17.1→F17.9)

1. **A — Delimitação**: mapa linha-a-linha do que fica no script/lib/aux.
2. **B — Extração**: mover blocos de domínio para lib/módulos.
3. **C — Normalização**: dispatch único e contrato de erro padronizado.
4. **D — Validação**: `get_errors` + checks estruturais por arquivo.
5. **E — Sincronização**: atualizar ROADMAP/PLANO/estado JSON da fase.

## Gates de aceite da F17

1. 100% dos scripts automáticos no perfil wrapper (sem regras de domínio inline).
2. 100% das entry-libs com função pública canônica `run_*_hook` e contratos explícitos.
3. Duplicações críticas entre hooks (`pre/post/stop`, `start/end`) reduzidas por extração
   compartilhada.
4. Verificador estrutural capaz de detectar regressão de fronteira script/lib.
5. Documentação e artefatos machine-readable sincronizados por fase.

## Entregáveis obrigatórios

- Documento de plano (este arquivo).
- Atualização de `ROADMAP_MODULARIZACAO_HOOKS_CODE_AUDIT_2026-03-15.md`.
- Atualização de `PLANO-MODULARIZACAO-HOOKS-SYSTEM-CODE-AUDIT.md`.
- Artefato machine-readable: `.github/hooks/state/f17-file-by-file-modularization-plan.json`.

## Ordem de execução recomendada

1. F17.0 (preparação transversal)
2. F17.1 → F17.4 (núcleo start/prompt/policy)
3. F17.6 → F17.8 (subagentes + compactação)
4. F17.9 (encerramento lifecycle)
5. F17.5 (stop interno profundo com janela dedicada)

> Nota: `agent-stop` permanece no final da trilha por risco estrutural mais alto e maior superfície
> de regressão.
