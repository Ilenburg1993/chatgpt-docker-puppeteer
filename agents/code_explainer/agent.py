import os
from typing import List

from .model_client import MockModelClient
from .prompts import EXPLAIN_PROMPT


class CodeExplainer:
    def __init__(self, client: MockModelClient = None):
        self.client = client or MockModelClient()

    def _read_paths(self, paths: List[str]) -> str:
        parts = []
        for p in paths:
            if os.path.isdir(p):
                # read .py files in directory (non-recursive)
                for fname in sorted(os.listdir(p)):
                    if fname.endswith('.py'):
                        fp = os.path.join(p, fname)
                        try:
                            with open(fp, 'r', encoding='utf8') as f:
                                parts.append(f"# File: {fname}\n" + f.read())
                        except Exception:
                            parts.append(f"# File: {fname}\n<could not read>\n")
            else:
                try:
                    with open(p, 'r', encoding='utf8') as f:
                        parts.append(f"# File: {os.path.basename(p)}\n" + f.read())
                except Exception:
                    parts.append(f"# File: {os.path.basename(p)}\n<could not read>\n")
        return "\n\n".join(parts)

    def explain_code(self, paths: List[str], out_md: str = "code_explanation.md") -> str:
        code_text = self._read_paths(paths)
        prompt = EXPLAIN_PROMPT.replace("{{CODE}}", code_text)
        resp = self.client.generate(prompt)
        # Write markdown output
        with open(out_md, 'w', encoding='utf8') as f:
            f.write(resp)
        return out_md
