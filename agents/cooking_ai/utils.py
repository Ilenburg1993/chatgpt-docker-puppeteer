from typing import List, Dict


def safe_parse_json(maybe_json: str):
    import json
    try:
        return json.loads(maybe_json)
    except Exception:
        return None


def format_ingredients(ings: List[Dict]) -> str:
    lines = []
    for it in ings:
        name = it.get("name")
        amount = it.get("amount", "")
        lines.append(f"{name} — {amount}" if amount else name)
    return "\n".join(lines)
