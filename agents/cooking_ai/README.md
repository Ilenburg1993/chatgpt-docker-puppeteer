# Projeto Cooking AI Agent

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

> A `.venv/` é local ao workspace, é ignorada pelo Git e não deve ser versionada.

Uso

```bash
python agents/cooking_ai/cli.py
```

O agente também pode ser executado como servidor HTTP compartilhado com o comando abaixo; a
interface é a mesma para os dois agentes e pode ser manipulada pelo AI Toolkit Agent Inspector:

```bash
python agents/server.py --server # porta padrão 8087
```

### Depuração com Agent Inspector

Depois de instalar as dependências (incluindo `debugpy` e `agent-dev-cli`), você pode iniciar o
servidor com instrumentação executando:

```bash
python -m debugpy --listen 127.0.0.1:5679 \
  -m agentdev run agents/server.py --verbose --port 8087 -- --server
```

Então abra o inspector (`AI Toolkit → Agent Inspector`) e aponte para o porto 8087. Consulte também
a configuração de VS Code na raiz do repositório (\`.vscode/tasks.json\`, \`.vscode/launch.json\`).

Configuração de modelo

O projeto inclui um `GithubModelClient` com modo `mock` por padrão. Para integrar um modelo real do
GitHub, configure a variável de ambiente `GITHUB_API_KEY` e implemente o método `generate` em
`github_client.py` (há instruções inline).

Observação

Este projeto dá um ponto de partida funcional sem chamadas externas.

## Tracing

O agente registra prompts e respostas em `logs/cooking_traces.jsonl` dentro do repositório. Use
`agents/cooking_ai/show_traces.py` para visualizar os traces rapidamente.
