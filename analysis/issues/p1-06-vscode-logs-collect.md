Title: Review collected VS Code logs for sensitive data (P1)

Description:

- Source: /tmp/vscode-term-logs/collect-1768523121.log
- Severity: P1
- Evidence: list of paths under /home/node/.vscode-server/data/logs/... containing potential user/telemetry data

Recommended actions:

1. Inspect logs for secrets and remove sensitive artifacts.
2. Add `.vscode-server/data/logs/` to workspace exclusions for scans and add to `.gitignore` if necessary.
3. Sanitize or rotate any secrets found.

Owner: @owner-placeholder
Labels: security, P1, logs
