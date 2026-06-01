#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-$(pwd)}"

if [[ ! -f "$APP_DIR/package.json" || ( ! -f "$APP_DIR/app/team/cli/murph" && ! -f "$APP_DIR/app/personal/cli/murph" ) ]]; then
  printf 'Refusing to prune %s: not a Murph app directory.\n' "$APP_DIR" >&2
  exit 1
fi

if [[ -d "$APP_DIR/.git" ]]; then
  printf 'Skipping install pruning for Git checkout: %s\n' "$APP_DIR"
  exit 0
fi

remove_path() {
  local target="$APP_DIR/$1"
  if [[ -e "$target" || -L "$target" ]]; then
    rm -rf "$target"
  fi
}

remove_path ".github"
remove_path "tests"
remove_path "Taskfile.yml"

remove_path "docs/.vitepress"
remove_path "docs/docs"
remove_path "docs/index.md"
remove_path "docs/.gitignore"
remove_path "docs/public/_headers"
remove_path "docs/public/robots.txt"
remove_path "docs/public/img"
remove_path "docs/public/install.sh"
remove_path "docs/public/install-personal.sh"
remove_path "docs/public/architecture-map.html"

printf 'Pruned install-only files from %s.\n' "$APP_DIR"
