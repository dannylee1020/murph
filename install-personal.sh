#!/usr/bin/env bash
set -euo pipefail

export MURPH_DISTRIBUTION=personal

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT_SOURCE" ]]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"
  LINK_TARGET="$(readlink "$SCRIPT_SOURCE")"
  if [[ "$LINK_TARGET" == /* ]]; then
    SCRIPT_SOURCE="$LINK_TARGET"
  else
    SCRIPT_SOURCE="$SCRIPT_DIR/$LINK_TARGET"
  fi
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"

if [[ -f "$SCRIPT_DIR/scripts/install-lib.sh" ]]; then
  cd "$SCRIPT_DIR"
  exec bash "$SCRIPT_DIR/scripts/install-lib.sh" "$@"
fi

DEFAULT_INSTALL_DIR="$HOME/.murph/app"
SOURCE_ARCHIVE_URL="${MURPH_SOURCE_ARCHIVE:-https://github.com/dannylee1020/murph/archive/refs/heads/main.tar.gz}"
install_dir="${MURPH_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

for required in curl tar mktemp; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'Murph needs %s for curl-based installation.\n' "$required" >&2
    exit 1
  fi
done

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-install.XXXXXX")"
archive_file="$tmp_dir/murph.tar.gz"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

printf 'Installing Murph Personal into %s\n' "$install_dir"
printf 'Downloading %s\n' "$SOURCE_ARCHIVE_URL"
curl -fsSL "$SOURCE_ARCHIVE_URL" -o "$archive_file"
tar -xzf "$archive_file" -C "$tmp_dir"

source_dir=""
for candidate in "$tmp_dir"/*; do
  if [[ -d "$candidate" ]]; then
    source_dir="$candidate"
    break
  fi
done

if [[ -z "$source_dir" || ! -f "$source_dir/package.json" || ! -f "$source_dir/scripts/install-lib.sh" ]]; then
  printf 'Downloaded archive did not contain a Murph source tree.\n' >&2
  exit 1
fi

mkdir -p "$install_dir"
cp -R "$source_dir"/. "$install_dir"/

cd "$install_dir"
exec bash scripts/install-lib.sh "$@"
