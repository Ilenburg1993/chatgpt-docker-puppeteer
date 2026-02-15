---
name: context7-docs-ops
description: Use when tasks require external library or framework documentation, API signatures, version-specific behavior, migration guides, or official usage examples. Prioritize Context7 MCP before generic web search and declare explicit fallback when Context7 is unavailable.
---

# Context7 Docs Ops

## Workflow
1. Identify the target technology and intended version.
2. Query Context7 first for official docs, API references, and migration notes.
3. Build the answer from source-backed data only.
4. State the documentation version used, or the version assumption if the user did not specify one.
5. Include source attribution in the response.

## Defaults
- If user does not provide a version, assume latest stable and state this assumption explicitly.
- Prefer primary docs for the technology over blog posts or tertiary summaries.
- Keep examples aligned with the documented API signatures.

## Guardrails
- Do not invent API signatures, options, return types, or version claims.
- Do not provide unverified examples as factual.
- Prefer explicit uncertainty over confident guessing.

## Fallback
1. If Context7 is unavailable or incomplete, switch to official documentation sites and web search.
2. Clearly state that fallback was used.
3. Keep the same output contract: version context, source attribution, and explicit assumptions.
