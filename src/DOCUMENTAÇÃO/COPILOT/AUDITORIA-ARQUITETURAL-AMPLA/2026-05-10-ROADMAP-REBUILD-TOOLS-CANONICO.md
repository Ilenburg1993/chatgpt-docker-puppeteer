# Roadmap Canônico de Rebuild — `src/copilot/tools/`

> **Data**: 2026-05-10
> **Base externa analisada**: `2026-05-10-AUDITORIA-TOOLS.md` (tratada como evidência externa, não fonte de verdade)
> **Status**: Plano mestre ativo (execução incremental)

---

## Objetivo

Reconstruir `src/copilot/tools/` como um subsistema canônico, com:

- fronteiras arquiteturais explícitas;
- observabilidade unificada (sem dupla contagem);
- estado isolável por sessão e testável;
- compatibilidade reversa progressiva;
- **máxima liberdade operacional da LLM-B** por padrão.

---

## Princípios de projeto (obrigatórios)

1. **LLM-B first**: por padrão, sem timeouts bloqueantes por tempo; usar sinais de saúde, watchdogs sem kill cego e circuit-breakers orientados a erro real.
2. **Timeouts são advisory**: quando existirem, servem telemetria/diagnóstico; cancelamento temporal só por política explícita de runtime.
3. **Configuração via ENV sem restrição padrão**: limites ficam configuráveis, com defaults voltados à liberdade.
4. **Evidência > documento externo**: cada item da auditoria externa deve ser validado no código antes da correção.
5. **Correção estrutural > patch ad hoc**: priorizar consolidação de contratos e boundaries.

---

## Resultado da validação inicial (auditoria externa x código real)

> **Nota de evolução**: esta seção captura o snapshot inicial de 2026-05-10. Parte dos itens abaixo já mudou de estado após o hardening e a revalidação de 2026-05-11. Ver `2026-05-11-VALIDACAO-CLAIMS-EXTERNAS-DELTA.md` para o delta pós-estabilização.

### Confirmados na base atual

- Dead code de timeout advisory em `session-rpc-tools` (parametrização ignorada).
- Risco de sobrescrita silenciosa no registry (`registerTool` sem warning).
- Fragilidade do cache de `safeEnv` acoplado a propriedade de função.
- Janela de inconsistência em `request_user_input` (geração de ID antes da checagem de capacidade).
- Ausência de teardown explícito para requests estruturados pendentes ao desmontar sessão.

### Parcialmente verdade / precisa recorte

- “Double wrapping” existe ao nível de logging, mas sem prova automática de double metric em todos os caminhos.
- “Limites Infinity = bug” precisa ser tratado à luz da diretriz LLM-B first (sem bloqueio default); solução deve ser **policy-driven** e não hard-cap cego.

### Falso-positivo identificado

- `bootstrapTools` chama `getAllTools(registry)` do SDK (`#copilot/sdk`), cujo contrato aceita `registry`; não é o `getAllTools()` local de `tools/index.js`.

---

## Arquitetura canônica alvo (v2)

###[A] Camadas

1. **Tools Surface** (`src/copilot/tools/**`): apenas definição de tools e adapters finos.
2. **Capabilities/Ports** (`src/copilot/tools/capabilities/**`): contratos de execução (shell, fs, rpc, policy, input).
3. **Domain Services** (`src/copilot/domain/tools/**`): regras de negócio (todo workflow, policies, resolução de estado).
4. **Infra Providers** (`src/copilot/infra/**`): IO, DB, índice, observabilidade concreta.
5. **SDK Bridge** (`src/copilot/sdk/**`): protocolo e integração com Copilot SDK.

###[B] Regras de dependência

- `tools/*` **não importa** `infra/*` direto (exceto adapters dedicados em `capabilities/providers`).
- `tools/*` conversa com `domain/*` e `capabilities/*`.
- `sdk/*` não depende de detalhes internos de `tools/*` além de contratos públicos.

###[C] Contratos canônicos

- `ToolDefinitionContract`
- `ToolExecutionTelemetryContract`
- `ToolPermissionDecisionContract`
- `UserInputBridgeContract`

---

## Backlog priorizado (execução)

### Fase 0 — Hardening imediato (P0/P1 curtos)

1. Corrigir timeout advisory em `session-rpc-tools` (sem timeout bloqueante).
2. Warning de overwrite no `ToolRegistry`.
3. Trocar cache `safeEnv` para estado privado de módulo.
4. Ajustar `request_user_input` para validar limite antes de emitir `requestId`.
5. Fechar pendências de `request_user_input` no teardown de sessão.

### Fase 1 — Unificação de observabilidade e factory

1. Definir **um único owner** de wrapping/logging/metrics (`sdk/tools/core` ou `tools/tool-factory`, não ambos).
2. Extrair converter Zod→JSON Schema para módulo único compartilhado.
3. Eliminar divergência de naming e padronizar metadados de tool.

### Fase 2 — Estado por sessão e input bridge único

1. Introduzir `ToolSessionContext` (estado por sessão).
2. Migrar `user-input-state` para adapter do fluxo canônico SDK (`session/user-input`).
3. Eliminar singletons mutáveis não necessários por módulo.

### Fase 3 — Boundary enforcement + refactor de domínios

1. Reestruturar `tools/file` em `io/`, `search/`, `scope/` com barrels de compatibilidade.
2. Separar `todo` em `domain`, `repository`, `tools-adapter`.
3. Adicionar lint rules de fronteira (import restrictions + validação em CI).

### Fase 4 — Governança contínua

1. Tool contract tests por categoria.
2. Health-checks granulares por subsistema (`file`, `todo`, `shell`, `registry`, `user-input`).
3. Dashboard de eventos bloqueados e tentativas negadas (observabilidade completa de permissão).

---

## Política de liberdade operacional da LLM-B

- Sem kill por timeout temporal como mecanismo primário.
- Detectar “hanging” por:
  - ausência de progresso observável;
  - watchdog de eventos (heartbeats de execução);
  - sinais de deadlock/state starvation;
  - critérios configuráveis por domínio.
- Timeout temporal só entra como fallback explícito de segurança operacional (opt-in).

---

## Estratégia de migração segura

1. **Compatibilidade reversa por barrels** durante 2 ciclos.
2. Flags internas para ativar nova pipeline gradualmente.
3. Métricas comparativas (antes/depois) sem regressão funcional.
4. Rollback simples por feature flag em pontos críticos.

---

## Critérios de pronto (Done)

- Nenhum P0 aberto validado.
- P1 críticos de estado/observabilidade mitigados.
- Um único fluxo canônico de instrumentação de tools.
- Fluxo único de user-input por sessão.
- Dependências entre camadas com enforcement automático.

---

## Registro de execução (início)

- ✅ Leitura integral e validação inicial da auditoria externa concluídas.
- ✅ Primeiro lote de correções P0/P1 iniciado em código.
- ✅ Lote P1-2 concluído: redução de double-wrapping em `tool-factory` (instrumentação delegada ao SDK).
- ✅ Lote P1-2 concluído: fallback da factory endurecido com normalização de parâmetros no caminho recoverable.
- ✅ Lote P1-2 concluído: `web_search` com tratamento explícito de payload JSON inválido no fallback DDG.
- ✅ Lote P1-2 concluído: isolamento de estado reforçado em `sdk/tools/state` (clones defensivos).
- ✅ Lote P1-2 concluído: boundary enforcement progressivo em `eslint.config.mjs` (modo `warn`) para `tools/`→`infra/db`.
- ✅ 2026-05-11: escopo `src/copilot` revalidado com `typecheck strict`, `eslint` e `npm run test:copilot` verdes.
- ✅ 2026-05-11: branch `main` sincronizada com `origin/main` após push do lote estrutural.
- ✅ 2026-05-11: claims externas revalidadas; parte do material original passou a estado **corrigido**, **obsoleto** ou **ainda ativo** com evidência objetiva (`2026-05-11-VALIDACAO-CLAIMS-EXTERNAS-DELTA.md`).
- 🔄 Próximo: consolidar contracts formais (ToolDefinition/Telemetry/Permission/UserInputBridge), fechar blind spot de denies na observabilidade e decidir a política canônica para limites `Infinity` em file tools.
