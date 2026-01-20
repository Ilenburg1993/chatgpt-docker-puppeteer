# Rotation scripts (safe, run locally)

These scripts help you rotate repository-related credentials. They DO NOT store credentials — you run them locally and provide required credentials via your environment or interactive prompts.

Precautions
- Run these scripts on your machine or a secure bastion.
- Never paste long-lived credentials into chat or commit them to the repo.
- Review each script before running.

Scripts
- `rotate_github_actions_secrets.sh` — rotate GitHub Actions secrets by name (uses `gh secret set`). Requires `gh` CLI authenticated as repo owner.
- `rotate_aws_iam_keys.sh` — rotate AWS IAM user access keys (uses `aws` CLI). Requires AWS credentials with IAM permissions.
- `rotate_deploy_key.sh` — generate a new SSH deploy key and replace an existing deploy key via `gh` API. Requires `gh`.
- `post_rotation_verify.sh` — run local secret scanners (gitleaks/detect-secrets) against `analysis/repo-verify` and upload summary to `analysis/actions-check/`.

How to run (example)
1. Inspect the script you plan to run.
2. Authenticate CLIs:
   - `gh auth login` (choose HTTPS, authenticate as repo owner)
   - `aws configure` (or set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in environment)
3. Run (example):
```bash
cd analysis/rotation-scripts
./rotate_github_actions_secrets.sh
```

After rotation
- Update workflows/CI to use new secret names/values if changed.
- Run `./post_rotation_verify.sh` to re-scan the cleaned repo and save reports into `analysis/actions-check/`.
