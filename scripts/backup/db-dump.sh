#!/usr/bin/env bash
# seen-readiness-fixes-task.md P5 (PLATFORM-12) -- a database dump that fails
# loudly instead of leaving an empty file behind.
#
#   scripts/backup/db-dump.sh                         # schema of the linked project (staging)
#   scripts/backup/db-dump.sh --project-ref <ref>     # schema of another project (production: run it yourself)
#   BACKUP_PASSPHRASE_FILE=~/.seen-backup-pass scripts/backup/db-dump.sh --data [--project-ref <ref>]
#
# Needs Docker running (the Supabase CLI runs pg_dump in a container; without
# it the CLI prints an error and the old redirect saved that as the "backup").
# Writes to backups/ (git-ignored). A data dump holds customers' personal and
# financial data: it is only ever written encrypted (AES-256, openssl, key
# from BACKUP_PASSPHRASE_FILE), and the plaintext is removed. Every file gets
# a .sha256 next to it.
set -euo pipefail

kind=schema
ref_args=(--linked)
ref_label=linked
while [ $# -gt 0 ]; do
  case "$1" in
    --data) kind=data ;;
    --project-ref) ref_args=(--linked --project-ref "$2"); ref_label="$2"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

root="$(cd "$(dirname "$0")/../.." && pwd)"
out_dir="$root/backups"
mkdir -p "$out_dir"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then run this again (supabase db dump needs it)." >&2
  exit 1
fi
if [ "$kind" = data ]; then
  if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
    echo "A data dump is written encrypted only: set BACKUP_PASSPHRASE_FILE to a file holding the passphrase." >&2
    exit 1
  fi
  command -v openssl >/dev/null || { echo "openssl is needed to encrypt the data dump." >&2; exit 1; }
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/${ref_label}_${kind}_${stamp}.sql"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT

dump_args=("${ref_args[@]}" -f "$tmp")
[ "$kind" = data ] && dump_args+=(--data-only --use-copy)
echo "Dumping the $kind of $ref_label..."
npx supabase db dump "${dump_args[@]}"

node "$root/scripts/backup/verify-dump.mjs" "$tmp" "$kind"

if [ "$kind" = data ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$tmp" -out "$file.enc" -pass "file:$BACKUP_PASSPHRASE_FILE"
  rm -f "$tmp"
  file="$file.enc"
  # Prove the encrypted file opens with the passphrase, before calling it a backup.
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$file" -pass "file:$BACKUP_PASSPHRASE_FILE" | head -c 200 >/dev/null
else
  mv "$tmp" "$file"
fi
trap - EXIT

(cd "$out_dir" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
echo "Backup: $file ($(wc -c < "$file") bytes)"
echo "sha256: $(cut -d' ' -f1 "$file.sha256")"
