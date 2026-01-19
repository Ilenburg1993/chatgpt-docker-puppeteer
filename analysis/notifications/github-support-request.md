Subject: Request for server-side garbage collection (GC) and removal of dangling objects

Repository: Rajude/chatgpt-docker-puppeteer
Issue: History was rewritten locally and force-pushed to origin to remove `local-login/` and browser profile artifacts from history. Local backups exist in `analysis/backups/`.

Request:
- Please run an aggressive server-side garbage collection / prune to remove any dangling objects related to the old history that were removed via a destructive push. This repository may have had `refs/original/*` or other references that persisted briefly.
- Optionally remove any server-side caches of packfiles associated with those objects.

Notes:
- We have already performed a mirror-based rewrite and forced push from our side, and removed `refs/original/*` where present.
- We can provide bundle backups if required for forensics.

Contact: (repo owner) — single-owner project. Please respond with confirmation and next steps.
