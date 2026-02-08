Rotation Action Plan — single-owner repository

Context

- Repository: Rajude/chatgpt-docker-puppeteer
- Owner: single person (you)
- Backup location: analysis/backups/
- Support request: https://github.com/Rajude/chatgpt-docker-puppeteer/issues/16
- Rotation/notification issue: https://github.com/Rajude/chatgpt-docker-puppeteer/issues/15

Priority (do in order)

1. Revoke any GitHub Personal Access Tokens (PATs) created around the timeframe of the affected commits.
2. Revoke any GitHub App installations or OAuth apps that may have tokens associated with repository access.
3. Rotate AWS IAM access keys that could have been in history (if used).
4. Rotate CI/deployment credentials (GitHub Actions secrets, deploy keys, Docker registries).
5. Rotate any third-party API keys (Slack, Google, Firebase, Twilio, etc.).
6. Rotate DB/connection strings if they were ever stored in repo history or config.

Commands and guidance

- GitHub PAT (manual):
    1. Visit https://github.com/settings/tokens
    2. Revoke tokens you no longer need and create new tokens with minimum scopes.

- Revoke GitHub OAuth apps / GitHub App tokens:
    - Visit https://github.com/settings/applications and remove any unrecognized apps.

- AWS IAM keys (using AWS CLI):
    - List keys for a user:

```bash
aws iam list-access-keys --user-name <USER>
```

- Deactivate then delete a key (rotate safely by creating new first):

```bash
aws iam create-access-key --user-name <USER>
# record new key
aws iam update-access-key --user-name <USER> --access-key-id <OLD_KEY> --status Inactive
# after testing
aws iam delete-access-key --user-name <USER> --access-key-id <OLD_KEY>
```

- GitHub Actions secrets (rotate):
    - In repository: Settings → Secrets and variables → Actions. Replace secrets used by workflows.

- Deploy keys and SSH keys:
    - In repo Settings → Deploy keys: remove and recreate with new keys.

- Docker registry credentials (e.g., Docker Hub/GCR):
    - Revoke tokens in the registry portal and update repo secrets.

- Databases and connection strings:
    - Rotate DB passwords via your DB admin portals and update application secrets.

Verification steps after rotation

- Run secret scanners again against the (cleaned) repo mirror and CI artifacts:
    - Run `gitleaks` locally: `gitleaks detect --source analysis/repo-verify --report-path analysis/actions-check/gitleaks-report.json`
    - Re-run `detect-secrets` baseline and compare.
- Confirm CI runs pass with new secrets.
- Close the support ticket when host confirms server-side GC.

Suggested messages

- For your internal log/PR or issue comment, use the rotation issue URL and add a checklist of steps performed with timestamps.

Record keeping

- For audit, save:
    - `analysis/backups/*` (bundle backups)
    - `analysis/actions-check/*` (artifact scans)
    - `analysis/notifications/*` (drafts and created issue links)

If you want, I can:

- (A) Generate per-credential issue/checklist files in `analysis/notifications/` for you to execute, or
- (B) Attempt to rotate some credentials for you automatically (requires provider-specific API credentials), or
- (C) Mark this rotation workflow as completed and close the notification issue after you confirm rotations.

Repository-side actions performed (agent):

- Date: 2026-01-16 UTC
- Actions:
    - Scanned repository for common token patterns and leak artifacts; findings are placeholders only (no active tokens committed). See `analysis/findings-classified.json` and `analysis/findings-summary.json` for details.
    - Confirmed no repository Actions secrets are present (`gh secret list` returned no secrets).
    - Created scheduled secret-scan workflow: `.github/workflows/secret-scan-schedule.yml`.
    - Applied branch protection on `main` to require secret-scan and related checks.
    - Created release and attached final remediation package; posted checklist comment to issue #15.

Next manual steps required by owner (you):

- Revoke/rotate any external tokens (GitHub PATs, AWS IAM keys, third-party API keys) following the Priority list above.
- After rotating, reply in issue #15 with confirmations and timestamps so I can mark rotation as completed and close the issue.
