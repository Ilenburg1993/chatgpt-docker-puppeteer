# Code Explainer Agent

Agente CLI que lê código-fonte (arquivo único ou múltiplos) e gera um arquivo Markdown com uma
explicação técnica detalhada direcionada a outro LLM (linguagem técnica, seções claras).

Instalação

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r agents/code_explainer/requirements.txt
```

> A `.venv/` é local ao workspace, é ignorada pelo Git e não deve ser versionada.

Uso

```bash
python agents/code_explainer/cli.py
```

O script agora também pode ser executado como um servidor HTTP (usado pelo AI Toolkit Agent
Inspector). O modo servidor é ativado com **--server** (e será iniciado automaticamente se nenhum
comando for informado):

```bash
python agents/server.py --server # escuta na porta 8087 por padrão
```

Os endpoints disponíveis são descritos em `agents/server.py` e podem ser acessados via POST com
JSON. Esse modo é especialmente útil ao depurar com `agentdev` (veja a seção "Depuração" abaixo).

Comando principal:

- `explain <path> [out.md]` — gera `out.md` (padrão: `code_explanation.md`).

O cliente de modelo roda em modo `mock` por padrão. Para integrar um modelo real, substitua
`model_client.py` com uma implementação que chame seu provedor.
