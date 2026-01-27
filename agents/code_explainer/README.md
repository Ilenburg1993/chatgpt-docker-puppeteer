Code Explainer Agent
====================

Agente CLI que lê código-fonte (arquivo único ou múltiplos) e gera um arquivo Markdown com
uma explicação técnica detalhada direcionada a outro LLM (linguagem técnica, seções claras).

Uso

```bash
python agents/code_explainer/cli.py
```

Comando principal:

- `explain <path> [out.md]` — gera `out.md` (padrão: `code_explanation.md`).

O cliente de modelo roda em modo `mock` por padrão. Para integrar um modelo real, substitua
`model_client.py` com uma implementação que chame seu provedor.
