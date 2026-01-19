Title: Investigate `Bad credentials` in Actions API (P1)

Description:
- Source: /tmp/actions-check/fetch.log
- Severity: P1
- Evidence: "runs API HTTP=401\nBad credentials\nAuthentication to GitHub API failed or no access"

Recommended actions:
1. Verify PAT/GITHUB_TOKEN validity and scope.
2. Rotate any leaked tokens immediately if confirmed active.
3. Update CI secrets and re-run workflows.

Owner: @owner-placeholder
Labels: security, P1, ci
