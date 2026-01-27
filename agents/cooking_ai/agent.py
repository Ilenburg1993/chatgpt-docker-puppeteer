import json
from typing import List, Dict

from .github_client import GithubModelClient
from .prompts import SEARCH_PROMPT, EXTRACT_PROMPT


class CookingAgent:
    def __init__(self, client: GithubModelClient = None):
        self.client = client or GithubModelClient()

    def search_recipes(self, query: str) -> List[Dict]:
        prompt = SEARCH_PROMPT + "\n\nConsulta: " + query
        raw = self.client.generate(prompt)
        try:
            data = json.loads(raw)
            return data.get("results", [])
        except Exception:
            # Fallback: return raw text as a single result
            return [{"title": query, "desc": raw}]

    def extract_ingredients(self, text: str) -> List[Dict]:
        prompt = EXTRACT_PROMPT + "\n\nTexto:\n" + text
        raw = self.client.generate(prompt)
        try:
            data = json.loads(raw)
            return data.get("ingredients", [])
        except Exception:
            return [{"name": text, "amount": ""}]
