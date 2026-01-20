Title: Missing/Guidance token string found in logs (P1)

Description:
- Source: /tmp/actions-check/validate-token.log
- Severity: P1
- Evidence: "Export it with: export GITHUB_TOKEN=ghp_xxx"

Recommended actions:
1. Ensure tokens are not committed or logged.
2. Provide secure token to CI via repository secrets (do not paste in logs).
3. Rotate any tokens that were accidentally exposed.

Owner: @owner-placeholder
Labels: security, P1, ci
