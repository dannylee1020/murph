#!/usr/bin/env bash
set -euo pipefail

export MURPH_DISTRIBUTION=team

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_SOURCE" ]]; then
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
fi

DEFAULT_INSTALL_DIR="$HOME/.murph/app"
MURPH_RELEASE_ENV_URL="${MURPH_RELEASE_ENV_URL:-https://murph-agent.com/release.env}"
install_dir="${MURPH_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

is_release_version() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

resolve_release_version() {
  if [[ -n "${MURPH_RELEASE_VERSION:-}" ]]; then
    if ! is_release_version "$MURPH_RELEASE_VERSION"; then
      printf 'MURPH_RELEASE_VERSION must look like v0.1.0.\n' >&2
      exit 1
    fi
    printf '%s\n' "$MURPH_RELEASE_VERSION"
    return
  fi

  local release_env release_version line
  release_env="$(curl -fsSL "$MURPH_RELEASE_ENV_URL")"
  while IFS= read -r line; do
    case "$line" in
      MURPH_RELEASE_VERSION=*)
        release_version="${line#MURPH_RELEASE_VERSION=}"
        ;;
    esac
  done <<< "$release_env"

  if [[ -z "${release_version:-}" ]] || ! is_release_version "$release_version"; then
    printf 'Could not resolve MURPH_RELEASE_VERSION from %s.\n' "$MURPH_RELEASE_ENV_URL" >&2
    exit 1
  fi

  printf '%s\n' "$release_version"
}

resolve_source_archive_url() {
  if [[ -n "${MURPH_SOURCE_ARCHIVE:-}" ]]; then
    printf '%s\n' "$MURPH_SOURCE_ARCHIVE"
    return
  fi

  local release_version
  release_version="$(resolve_release_version)" || exit 1
  printf 'https://github.com/dannylee1020/murph/archive/refs/tags/%s.tar.gz\n' "$release_version"
}

for required in curl tar mktemp; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'Murph needs %s for curl-based installation.\n' "$required" >&2
    exit 1
  fi
done

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-install.XXXXXX")"
archive_file="$tmp_dir/murph.tar.gz"
SOURCE_ARCHIVE_URL="$(resolve_source_archive_url)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

printf 'Installing Murph Team into %s\n' "$install_dir"
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
