Backup Retention Policy
=======================

Scope
-----
This file documents retention and secure storage for remediation backups created during the history rewrite process.

Retention
---------
- Keep `analysis/backups/*` for 180 days by default.
- After 180 days, move bundles to an offline, access-controlled storage (S3 with MFA delete, or internal artifact store).

Access and Encryption
---------------------
- Store backups encrypted at rest (server-side encryption or client-side GPG).
- Limit access to repository owners and security team; audit all downloads.

Deletion
--------
- Deletion of backups requires two approvals: repo owner + security admin.

Notes
-----
- Do not store rotated secrets in backup bundles. Sensitive rotated outputs are saved only in `analysis/rotation-scripts/` with `0600` permissions and should be moved to a secure vault.
