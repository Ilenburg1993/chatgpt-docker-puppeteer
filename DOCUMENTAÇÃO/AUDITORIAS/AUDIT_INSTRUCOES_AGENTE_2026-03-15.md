# Auditoria de Governança das Instruções do Agente

**Data**: 2026-03-15 **Escopo**: `.github/AGENTS.md`, `.github/copilot-instructions.md`,
`.github/instructions/*.instructions.md`, hooks de enforcement (`pre-tool-use`, `post-tool-use`,
`agent-stop`, `log-prompt`, `session-start`).

## Parte 1 — Achados (code-audit)

## 1) Redundância documental crítica entre AGENTS, copilot-instructions e protocolo

- **Severidade**: alta
- **Sintoma**: o mesmo conteúdo de lifecycle (SESSION/SECTION/TURN, templates, regras de fechamento)
  aparecia replicado em múltiplos arquivos longos.
- **Risco**: drift de política e manutenção cara; conflito silencioso entre regras textuais.
- **Evidências**:
  - `.github/AGENTS.md` (versão anterior extensa)
  - `.github/copilot-instructions.md` (versão anterior extensa)
  - `.github/instructions/hooks-protocol.instructions.md` (fonte de protocolo)
- **Correção aplicada**:
  - `.github/AGENTS.md` reconstruído para papel tático (templates + playbook curto).
  - `.github/copilot-instructions.md` reconstruído para resumo executivo e mapa arquitetural.
  - `hooks-protocol.instructions.md` reforçado como fonte única de lifecycle.

## 2) Conflito semântico entre protocolo textual e enforcement em hooks

- **Severidade**: alta
- **Sintoma**: o protocolo textual declarava continuidade por A/D/E, mas a validação de autorização
  de TURN invalidava qualquer `askQuestions` não-Template F.
- **Risco**: bloqueios indevidos, loop operacional e inconsistência entre documentação e
  comportamento real.
- **Evidências**:
  - `.github/instructions/hooks-protocol.instructions.md`
  - `.github/hooks/hooks-lib/agent-stop-lib.sh` (função `determine_turn_auth_invalid_reason`)
- **Correção aplicada**:
  - Mantida a invalidação para `ask_template != template_f` no enforcement.
  - Ajustado o texto do protocolo para refletir o comportamento real: A/D/E são continuidade e não
    autorizam fechamento de TURN; Template F permanece no fluxo de fechamento de SESSION.

## 3) Ausência de verificação técnica de leitura dos docs obrigatórios

- **Severidade**: média/alta
- **Sintoma**: existia regra textual de leitura no início/retomada, mas sem comprovação técnica
  consistente no ciclo de TURN.
- **Risco**: agente iniciar trabalho sem contexto mínimo, violando o próprio protocolo.
- **Evidências**:
  - Regras em `hooks-protocol.instructions.md` e docs correlatos sem obrigação técnica explícita de
    leitura no fechamento do TURN.
- **Correção aplicada**:
  - `log-prompt.sh` agora ativa checklist obrigatório no TURN 1 (start/resume).
  - `pre-tool-use.sh` marca cada documento como lido ao detectar `read_file`.
  - `agent-stop-lib.sh` invalida autorização quando há pendências (`required_docs_not_read`).

## Parte 2 — Upgrades estruturais recomendados

## U1) Contrato formal de compliance de instruções

- Criar schema dedicado (ex.: `instruction-compliance.schema.json`) com campos:
  - `required_docs_pending`
  - `required_docs_read_log`
  - `required_docs_status`
  - `required_docs_obligation`
- Benefício: validação automatizável no smoke-test e rastreabilidade explícita.

## U2) Testes de regressão para governança de leitura

- Adicionar cenários no smoke-test para:
  1. TURN 1 sem leitura obrigatória -> bloqueia.
  2. TURN 1 com 3 leituras -> autoriza (desde que demais regras válidas).
  3. Resume inline com checklist reativado.
- Benefício: evita regressões de protocolo em alterações futuras.

## U3) Diagnóstico de instruções carregadas na runtime do editor

- Incluir runbook curto em `DOCUMENTAÇÃO/HOOKS/` com:
  - uso de Diagnostics do chat
  - verificação de referências de instruções na resposta
  - troubleshooting de `applyTo` e settings relevantes.
- Base oficial: docs VS Code de troubleshooting/custom instructions.

## U4) Política de não-duplicação como gate de revisão

- Definir regra de revisão: mudanças de lifecycle devem alterar apenas:
  1. hooks executáveis
  2. `hooks-protocol.instructions.md`
- Demais arquivos devem apontar para essas fontes, sem copiar o texto integral.

## Referências oficiais usadas na auditoria

- GitHub Docs — custom instructions:
  - https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
  - https://docs.github.com/en/copilot/reference/custom-instructions-support
- GitHub Docs — hooks:
  - https://docs.github.com/en/copilot/reference/hooks-configuration
  - https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks
- VS Code Docs:
  - https://code.visualstudio.com/docs/copilot/customization/custom-instructions
  - https://code.visualstudio.com/docs/copilot/customization/hooks
  - https://code.visualstudio.com/docs/copilot/concepts/customization
  - https://code.visualstudio.com/docs/copilot/troubleshooting
