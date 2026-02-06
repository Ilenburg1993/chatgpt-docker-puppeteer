---
description: Testar conectividade do DevContainer com o Ollama (OpenAI-compatible)
---

Valide resolução de DNS e conectividade ao Ollama a partir do DevContainer:

!`echo '[DNS] host.docker.internal' && (getent ahostsv4 host.docker.internal || true) && (getent ahostsv6 host.docker.internal || true)`
!`echo '\n[HTTP] /api/version' && (curl -sS --max-time 2 http://host.docker.internal:11434/api/version || true)`
!`echo '\n[HTTP] /v1/models' && (curl -sS --max-time 2 http://host.docker.internal:11434/v1/models || true)`

Se falhar, rode:

- `ip route | awk '/default/ {print $3}'`
- e teste `curl http://<gateway-ip>:11434/api/version`.
