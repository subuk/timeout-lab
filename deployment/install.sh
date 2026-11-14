#!/usr/bin/env bash
# Run as root on net.krglv.com with the uploaded, locally prepared archive.
set -euo pipefail
archive=${1:?Usage: install.sh /absolute/path/to/tmlab.tar.gz}
site=/var/www/tmlab
config=/etc/nginx/conf.d/tmlab.conf
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release=/var/www/tmlab-releases/$stamp
backup=/var/backups/tmlab/$stamp
stage=$(mktemp -d /var/tmp/tmlab.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
nginx -t
test -f /etc/letsencrypt/live/krglv.com/fullchain.pem
test ! -e "$site" || test -L "$site"
test ! -e "$release"
tar --no-same-owner -xzf "$archive" -C "$stage"
(cd "$stage/dist" && sha256sum -c ../SHA256SUMS)
test -s "$stage/dist/index.html"
test -s "$stage/dist/core.wasm"
install -d -m 0700 "$backup"
if [ -e "$config" ]; then cp -a "$config" "$backup/tmlab.conf"; fi
previous=$(readlink "$site" || true)
printf '%s\n' "$previous" > "$backup/previous-release"
install -d -m 0755 /var/www/tmlab-releases
mv "$stage/dist" "$release"
chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +
restorecon -R "$release"
rollback() {
    if [ -f "$backup/tmlab.conf" ]; then cp -a "$backup/tmlab.conf" "$config"; else rm -f "$config"; fi
    if [ -n "$previous" ]; then
        ln -s "$previous" "$stage/previous"
        mv -Tf "$stage/previous" "$site"
    else
        rm -f "$site"
    fi
    nginx -t && systemctl reload nginx
}
trap 'rollback' ERR
ln -s "$release" "$stage/current"
mv -Tf "$stage/current" "$site"
restorecon "$site"
install -m 0644 "$stage/deployment/tmlab.conf" "$config"
restorecon "$config"
nginx -t
systemctl reload nginx
for attempt in {1..10}; do
    if curl -fsS --resolve tmlab.krglv.com:443:127.0.0.1 https://tmlab.krglv.com/ -o "$stage/served.html" && cmp -s "$stage/served.html" "$release/index.html"; then break; fi
    sleep 1
done
cmp "$stage/served.html" "$release/index.html"
curl -fsS -H 'Host: tmlab.krglv.com' http://127.0.0.1/core.wasm -o "$stage/served.wasm"
cmp "$stage/served.wasm" "$release/core.wasm"
trap - ERR
printf 'Published release: %s\nBackup: %s\n' "$release" "$backup"
