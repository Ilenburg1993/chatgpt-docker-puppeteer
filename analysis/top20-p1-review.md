# Top P1 Findings — Human Review

Resumo dos itens classificados como P1 (14 entradas). Cada item inclui a origem, motivo, trecho amostra e recomendação.

1. Source: /tmp/actions-check/fetch.log
    - Severity: P1
    - Reason: high-entropy string (API auth failure context)
    - Sample: "runs API HTTP=401\nBad credentials\nAuthentication to GitHub API failed or no access"
    - Entropy: 4.98, Length: 211
    - Recommendation: validar PAT/GITHUB_TOKEN; não é credencial vazada mas indica falha de autenticação.

2. Source: /tmp/actions-check/validate-token.log
    - Severity: P1
    - Reason: high-entropy string (env guidance)
    - Sample: "GITHUB_TOKEN is not set in this environment.\nExport it with: export GITHUB_TOKEN=ghp_xxx"
    - Entropy: 4.93, Length: 127
    - Recommendation: fornecer token seguro para verificação CI; não comitar token.

3. Source: /tmp/detect-secrets-filesystem-1768520899.baseline
    - Severity: P1
    - Reason: detect-secrets runtime traceback (suspicious)
    - Sample: traceback from detect-secrets invocation
    - Entropy: 4.82, Length: 1339
    - Recommendation: inspecionar o contexto do baseline gerado; pode ser falso positivo de execução.

4-7. Source: /tmp/trufflehog-combined-1768521065.json (4 entries)

- Severity: P1
- Reason: high-entropy strings detected by trufflehog (base64-like tokens)
- Samples (short):
    - "gzUt/qt81nXsFGKIFcC3YnfEAx5NkunCfnDlvuBSSFS02bcXu4Lmea0AFIUwbLWxW..."
    - "XBx9AXhXktjUqnepgTiE5flcKIYWi/rme0Eaj+5Y0lftuGBq+jyRu/md4Wnuxqg..."
- Entropy: ~5.45–5.51, Length: 88
- Recommendation: essas entradas apareceram no histórico; correlacionar com arquivos afetados em analysis/triage-detailed.jsonl; priorizar revisão humana e rotação caso estejam ativas.

8. Source: /tmp/vscode-term-logs/collect-1768523121.log
    - Severity: P1
    - Reason: potential sensitive paths and high-entropy content in collected VS Code logs
    - Sample: path list under /home/node/.vscode-server/data/logs/... (large)
    - Entropy: 5.31, Length: 10000
    - Recommendation: revisar logs para segredos e remover artefatos locais; não commitar logs.

9. Source: /tmp/vscode-term-logs/last-collect.log
    - Severity: P1
    - Reason: same as above (collected VS Code logs)
    - Sample: paths and telemetry lines
    - Entropy: 5.31, Length: 10000
    - Recommendation: inspecionar e sanitizar antes de arquivar.

10. Source: /tmp/vscode-term-logs/latest-logs.txt
    - Severity: P1
    - Reason: VS Code logs contain many filenames and potential data
    - Sample: "/home/node/.vscode-server/data/logs/20260115T214857/ptyhost.log ..."
    - Entropy: 4.81, Length: 899
    - Recommendation: revisar trechos com alta entropia; filtrar dados pessoais.

11. Source: /tmp/vscode-term-logs/log-files.txt
    - Severity: P1
    - Reason: index of VS Code pty/log files (suspicious)
    - Sample: list of /home/node/.vscode-server/data/logs entries
    - Entropy: 4.99, Length: 5591
    - Recommendation: remover logs sensíveis e regenerar apenas artefatos necessários.

12. Source: /tmp/vscode-term-logs/pty-files-index.txt
    - Severity: P1
    - Reason: index of pty logs (suspicious)
    - Sample: enumerated ptyhost.log entries
    - Entropy: 4.66, Length: 263
    - Recommendation: revisar e sanitizar antes de qualquer upload/arquivamento.

13. Source: /tmp/vscode-term-logs/pty-files.txt
    - Severity: P1
    - Reason: pty host logs list (suspicious)
    - Sample: repeated ptyhost.log paths
    - Entropy: 4.61, Length: 255
    - Recommendation: inspecionar conteúdo dos pty logs por credenciais acidentais.

14. Source: /tmp/vscode-term-logs/trace-change.txt
    - Severity: P1
    - Reason: settings changes and trace-level logs copied (suspicious)
    - Sample: "Found settings: /home/node/.vscode-server/data/Machine/settings.json\nUpdated /home/node/.vscode-server/data/Machine/settings.json with window.logLevel=trace (jq)"
    - Entropy: 4.92, Length: 685
    - Recommendation: verificar se logs contêm dados sensíveis; evitar configuração trace em ambientes com dados sensíveis.

Next steps suggested:

- Human triage: inspect the listed sources in order and mark whether each finding requires credential rotation.
- If any token is confirmed active, rotate immediately and update stakeholders.
- After triage, proceed with origin history rewrite (we have dry-run artifacts ready).
