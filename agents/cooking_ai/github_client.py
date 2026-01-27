import os
import json
from typing import Optional
from datetime import datetime

from .tracing import trace_event


class GithubModelClient:
    """Wrapper for GitHub model calls.

    By default runs in `mock` mode when `GITHUB_API_KEY` is not set.
    To integrate a real GitHub model, set `GITHUB_API_KEY` and implement
    the `_call_remote_model` method using the provider's API.
    """

    def __init__(self, api_key: Optional[str] = None, model: str = "github-model"):
        self.api_key = api_key or os.getenv("GITHUB_API_KEY")
        self.model = model
        self.mock = not bool(self.api_key)

    def generate(self, prompt: str) -> str:
        if self.mock:
            resp = self._mock_response(prompt)
            # trace the prompt and mock response
            trace_event("generate", prompt=prompt, response=resp, metadata={"mock": True, "model": self.model})
            return resp
        resp = self._call_remote_model(prompt)
        trace_event("generate", prompt=prompt, response=resp, metadata={"mock": False, "model": self.model})
        return resp

    def _mock_response(self, prompt: str) -> str:
        # Simple heuristics-based mock responses for development/testing
        if "search" in prompt.lower() or "receita" in prompt.lower():
            sample = [
                {"title": "Panqueca Simples", "desc": "Panquecas fofas com leite e ovo."},
                {"title": "Macarrão ao Alho e Óleo", "desc": "Rápido, só alho, óleo e massa."},
            ]
            out = json.dumps({"results": sample}, ensure_ascii=False)
            return out
        if "ingredientes" in prompt.lower() or "extrair" in prompt.lower():
            sample = {
                "ingredients": [
                    {"name": "farinha de trigo", "amount": "200g"},
                    {"name": "leite", "amount": "300ml"},
                    {"name": "ovo", "amount": "2"},
                ]
            }
            out = json.dumps(sample, ensure_ascii=False)
            return out
        return json.dumps({"text": "Resposta mock padrão."}, ensure_ascii=False)

    def _call_remote_model(self, prompt: str) -> str:
        # TODO: implement GitHub Models inference API call here.
        # Keep this method minimal and return raw string output from the model.
        raise NotImplementedError("Remote model call is not implemented. Set GITHUB_API_KEY and implement this method.")
