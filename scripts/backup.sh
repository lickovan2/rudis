#!/usr/bin/env bash
set -euo pipefail
umask 077

data_dir="${DATA_DIR:-/opt/rudis/data}"
backup_dir="${BACKUP_DIR:-/opt/rudis/backups}"
mkdir -p "$backup_dir"
tmp="$(mktemp -d "$backup_dir/.tmp.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT

sqlite3 "$data_dir/rudis.db" ".backup '$tmp/rudis.db'"
test "$(sqlite3 "$tmp/rudis.db" 'PRAGMA integrity_check')" = ok
tar -C "$data_dir" -cf "$tmp/uploads.tar" uploads
(
  cd "$tmp"
  sha256sum rudis.db uploads.tar > SHA256SUMS
)

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_dir/rudis-$stamp.tar.gz"
tar -C "$tmp" -czf "$archive.tmp" rudis.db uploads.tar SHA256SUMS
mv -- "$archive.tmp" "$archive"
find "$backup_dir" -maxdepth 1 -type f -name 'rudis-*.tar.gz' -mtime +14 -delete
echo "Backup created: $archive"
