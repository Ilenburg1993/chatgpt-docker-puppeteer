Agents Audit — resumo e upgrades aplicados
=========================================

Data: 2026-01-27

Sumário
- Criei dois agentes em `agents/`: `cooking_ai` (CLI, tracing, mock model) e `code_explainer` (CLI, mock model).
- Auditei integração mínima com o repositório e apliquei upgrades não invasivos.

Achados principais
- Makefile original focado em Node/PM2, sem alvos para Python/agents.
- `tests/` continha testes que requeriam `pytest` (não assumido no ambiente). Ajustes feitos para permitir execução direta.
- Tracing adicionado para o `cooking_ai` (`logs/cooking_traces.jsonl`).
- Clientes de modelo criados em modo `mock` por padrão; integração com modelos reais é marcada como TODO e espera `GITHUB_API_KEY`.

Upgrades aplicados
1. Makefile: adicionei targets:
   - `install-python-deps` — instala requirements dos agentes (pip)
   - `run-cooking-agent` — executa `agents/cooking_ai/cli.py`
   - `show-cooking-traces` — visualiza traces via `agents/cooking_ai/show_traces.py`
   - `run-code-explainer` — executa `agents/code_explainer/cli.py`
   - `test-agents` — executa demos e um teste rápido sem depender de `pytest`

2. Tracing: `agents/cooking_ai/tracing.py` grava JSONL em `logs/cooking_traces.jsonl`; viewer `show_traces.py` criado.

3. Tests: ajuste em `tests/test_cooking_agent.py` para permitir execução direta sem `pytest`. Adicionado `tests/test_code_explainer.py` (usa pytest tmp_path when run under pytest but project also has `test-agents` Make target for quick checks).

4. Package / scripts: run scripts added (`agents/*/run.sh`) e `__init__.py` para facilitar imports.

Recomendações / próximos passos
- (Opcional) Adicionar `pytest` e rodar CI: `pip install pytest` e executar `pytest -q`.
- Implementar autenticação e chamadas do provedor de modelo no `model_client.py` / `github_client.py` para usar modelos GitHub.
- Tornar `agents/*/run.sh` executáveis: `chmod +x agents/*/run.sh`.
- Integrar target `run-code-explainer` no CI ou `Makefile` workflow, se desejar rodar automaticamente.

Observações de segurança
- Traces gravam prompts/respostas — cuidado com dados sensíveis. Rotear logs para local seguro ou desabilitar em produção.
