import os
from typing import Optional
import json

class MockModelClient:
    """Simple mock client that returns structured markdown explanation.

    Replace or extend this class to call a real model provider.
    """

    def __init__(self, api_key: Optional[str] = None, model: str = "mock-code-model"):
        self.api_key = api_key or os.getenv("GITHUB_API_KEY")
        self.model = model
        self.mock = True if not self.api_key else False

    def generate(self, prompt: str) -> str:
        if self.mock:
            # Produce a deterministic markdown stub that includes the code preview
            code_snippet = "(código incluso no prompt, omitido na resposta curta)"
            md = f"# Explicação do Código\n\n" \
                 f"**Sumário:** This is a mock explanation generated for testing.\n\n" \
                 f"## Objetivo do Módulo\nUma breve descrição do propósito.\n\n" \
                 f"## Exemplo de Código\n```\n{code_snippet}\n```\n"
            return md
        # TODO: implement real remote call
        raise NotImplementedError("Remote model call not implemented")
