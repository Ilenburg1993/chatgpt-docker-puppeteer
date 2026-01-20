Subject: Urgent — Potential leaked artifacts found in repository history

Summary

- Action taken: Removed `local-login/`, `local-login/profile/`, `node_modules/`, and `profile/` from git history on the origin via mirror rewrite. Backups preserved in `analysis/backups/`.
- CI artifacts examined (workflow: `.github/workflows/secret-scan-dispatch.yml`) and scanned. No high-confidence API keys or private-key PEM blocks were detected in artifacts. A small set of metadata lines referencing git refs and workflow paths were found; see `analysis/actions-check/secrets-found.txt`.

Why notify

- Although no high-confidence secret values were discovered in the scanned artifacts, repository history rewrites and secret-scan outputs should be validated by credential owners because:
    - Forks or mirrors outside our control may still contain the objects.
    - Private tokens or credentials may exist elsewhere in older commits not covered by this scan.

Immediate recommended actions (for owners)

1. Rotate all personal and machine tokens issued since the earliest affected commit date (safe default):
    - GitHub: Revoke Personal Access Tokens (PATs) and GitHub Apps created around the timeframe. Create new tokens with least privilege.
    - AWS: Rotate any IAM access keys that could have been in repo history. Create new keys and remove old ones.
    - Slack/Discord/API keys: Revoke and recreate.

2. Revoke deploy keys and CI secrets used by this repo until confirmed safe.

3. Confirm no forks or caches hold the objects. If forks exist, contact owners to rewrite or remove sensitive refs.

4. Request host-side GC (if desired): contact GitHub support to request aggressive server-side garbage collection for this repository — helpful if exposed objects persisted on the host.

Actionable checklist and commands

- To rotate a GitHub PAT: https://github.com/settings/tokens — revoke old, create new.
- To list active AWS keys for a user (AWS CLI):

```bash
aws iam list-access-keys --user-name <USER>
```

- To revoke an AWS key:

```bash
aws iam delete-access-key --user-name <USER> --access-key-id <KEYID>
```

- To find any remaining references locally (owners):

```bash
git clone --mirror <repo-url> repo-mirror.git
cd repo-mirror.git
git rev-list --all --objects | cut -d' ' -f2- | grep -E 'local-login/|profile/|node_modules/' -n || true
```

What I prepared for you (in this workspace)

- `analysis/backups/` — bundle backups saved prior to rewrites.
- `analysis/actions-check/` — artifacts and `secrets-found.txt` with scanner hits (metadata lines).
- `analysis/notifications/rotation-draft.md` — this draft you can edit before sending.

Next steps I can perform

- Generate per-owner email/text messages from this draft and open GitHub issues for rotation tasks.
- Attempt to contact GitHub support with a prepared request (requires repo admin privileges).

If you want me to create the per-owner notices and open issues now, confirm and specify any recipients or teams to CC.
