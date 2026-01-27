Projeto Cooking AI Agent
=======================

Agente CLI interativo para busca de receitas e extração de ingredientes.

Requisitos
- Python 3.9+
- Dependências em `requirements.txt`

Instalação

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r agents/cooking_ai/requirements.txt
```

Uso

```bash
python agents/cooking_ai/cli.py
```

Configuração de modelo

O projeto inclui um `GithubModelClient` com modo `mock` por padrão. Para integrar um modelo real do GitHub, configure a variável de ambiente `GITHUB_API_KEY` e implemente o método `generate` em `github_client.py` (há instruções inline).

Observação

Este projeto dá um ponto de partida funcional sem chamadas externas.

Tracing
-------

O agente registra prompts e respostas em `logs/cooking_traces.jsonl` dentro do repositório.
Use `agents/cooking_ai/show_traces.py` para visualizar os traces rapidamente.
