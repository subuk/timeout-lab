---
name: timeout-lab-release
description: Package and verify a static Timeout Lab release, deploy to the existing net.krglv.com server, or roll back a release. Use for demo releases, not Sites, DNS migrations, or ordinary documentation changes.
---

# Timeout Lab releases

Work from the project root, three levels above this directory. Read `AGENTS.md`, the current `deployment/install.sh`, `deployment/tmlab.conf`, and the start of `deployment/DEPLOYMENT.txt`. Deploy only within current or previously granted authorization; do not ask again for an already authorized release. Preparing a local archive does not itself publish anything.

## Existing hosting

- Public URL: `https://tmlab.krglv.com/`.
- SSH: `subuk@net.krglv.com`, currently using key authentication; secrets are usually unnecessary.
- Web root: symlink `/var/www/tmlab`; releases: `/var/www/tmlab-releases/<UTC stamp>`.
- Configuration: `/etc/nginx/conf.d/tmlab.conf`; backups: `/var/backups/tmlab/<UTC stamp>`.
- Cloudflare terminates public TLS. The origin supports HTTP/HTTPS and IPv4/IPv6, with nginx using the existing `*.krglv.com` certificate. Do not change DNS/TLS, other vhosts, or shared server settings for static-file updates.
- Do not use Sites hosting or synchronize sources into another repository. Historical `.openai/` metadata does not define current hosting.

## Preparation

1. Run checks appropriate to the change and update the build according to `AGENTS.md`. Do not rerun completed checks when their inputs are unchanged.
2. Create the archive with the helper, which neither builds nor deploys:

   ```sh
   python3 .agents/skills/timeout-lab-release/scripts/artifact.py package /tmp/tmlab-release.tar.gz
   ```

   It includes the generated static `dist` files (including Vite assets), `deployment/tmlab.conf`, and `SHA256SUMS` with paths relative to `dist`. The helper requires the HTML, Worker, Go runtime, WASM, standalone output and Vite JavaScript. Inspect the manifest when changing release contents. Do not archive the entire project, screenshots, AGENTS, skills, `.git`, or secrets.
3. Create a unique remote temporary directory with `ssh -o BatchMode=yes subuk@net.krglv.com 'mktemp -d /tmp/tmlab-update.XXXXXX'`. Save the actual path. Upload the archive and `deployment/install.sh` there with `scp`.

## Installation and verification

Run `sudo bash <remote-temp>/install.sh <remote-temp>/tmlab-release.tar.gz` over SSH using the actual paths. The installer verifies hashes, saves the old configuration and symlink, installs a separate release, checks nginx, performs a graceful reload, and checks the origin. Errors after switching trigger built-in rollback. Do not bypass verification/rollback or hard-restart nginx.

If SSH disconnects, inspect `readlink /var/www/tmlab` and release state before acting; do not blindly repeat installation. If the installer fails, stop deployment, verify restoration, and investigate the cause. Do not make repeated attempts that change shared configuration.

After successful installation:

```sh
python3 .agents/skills/timeout-lab-release/scripts/artifact.py verify https://tmlab.krglv.com/
```

The helper downloads each generated static file with curl and compares SHA-256 against the local build. If the public version differs, distinguish caching from an origin error without changing DNS. One retry is allowed for a transient error after checking its cause. Do not claim a verified release while mismatches remain.

For interface behavior changes, check the deployed scenario in a browser when available. Public-file checks suffice for copy changes. Then update `Current release` and append a concise result/checks/backup entry to `deployment/DEPLOYMENT.txt`. Record only checks actually performed. Remove only your temporary upload files and empty directory; retain releases and backups.

## Rollback

Use on request or to recover from your own broken release. Read the previous path from the appropriate backup's `previous-release` and verify that directory exists. Restore the saved `tmlab.conf` and atomically replace the symlink using the installer's `rollback()` mechanism; run `nginx -t` and gracefully reload. Do not guess the release from its date.

Check the origin and public files against the **restored release**, not the new local `dist`. The `verify` helper compares against local files and is suitable only when they match the release being restored. Record the actual current release in the log. If restoration fails, stop and report the exact state; do not delete available releases.
