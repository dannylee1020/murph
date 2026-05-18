#!/usr/bin/env bash
set -euo pipefail

phase="${1:-all}"
MURPH_HOME="${MURPH_HOME:-$HOME/.murph}"
DEPS_DIR="${MURPH_DEPS_DIR:-$MURPH_HOME/deps}"
BIN_DIR="$DEPS_DIR/bin"
NODE_VERSION="${MURPH_NODE_VERSION:-22.13.1}"

have_command() {
  command -v "$1" >/dev/null 2>&1
}

section() {
  printf '\n%s\n' "$1"
  printf '%s\n' "----------------------------------------"
}

fail() {
  printf 'Dependency install failed: %s\n' "$1" >&2
  exit 1
}

require_bootstrap_tools() {
  local missing=()
  for tool in bash curl tar mktemp uname; do
    if ! have_command "$tool"; then
      missing+=("$tool")
    fi
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    fail "missing bootstrap tool(s): ${missing[*]}"
  fi
}

node_major() {
  local version major
  version="$(node --version 2>/dev/null || true)"
  major="${version#v}"
  major="${major%%.*}"
  if [[ "$major" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$major"
  fi
}

node_ready() {
  have_command node || return 1
  have_command npm || return 1
  local major
  major="$(node_major)"
  [[ -n "$major" && "$major" -ge 20 ]]
}

platform_id() {
  local os arch node_os node_arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) node_os="darwin" ;;
    Linux) node_os="linux" ;;
    *) fail "unsupported OS for automatic Node install: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    arm64|aarch64) node_arch="arm64" ;;
    *) fail "unsupported CPU architecture for automatic Node install: $arch" ;;
  esac

  printf '%s-%s\n' "$node_os" "$node_arch"
}

install_node() {
  if node_ready; then
    printf 'Node pre-req already satisfied: %s\n' "$(node --version)"
    return
  fi

  section "Installing Node pre-req"
  require_bootstrap_tools

  local platform archive_name url tmp_dir node_root
  platform="$(platform_id)"
  archive_name="node-v${NODE_VERSION}-${platform}.tar.xz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${archive_name}"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-node.XXXXXX")"
  node_root="$DEPS_DIR/node"

  mkdir -p "$DEPS_DIR" "$BIN_DIR"
  printf 'Downloading %s\n' "$url"
  curl -fsSL "$url" -o "$tmp_dir/$archive_name"
  rm -rf "$node_root"
  mkdir -p "$node_root"
  tar -xJf "$tmp_dir/$archive_name" -C "$node_root" --strip-components 1

  ln -sf "$node_root/bin/node" "$BIN_DIR/node"
  ln -sf "$node_root/bin/npm" "$BIN_DIR/npm"
  ln -sf "$node_root/bin/npx" "$BIN_DIR/npx"
  if [[ -x "$node_root/bin/corepack" ]]; then
    ln -sf "$node_root/bin/corepack" "$BIN_DIR/corepack"
  fi
  rm -rf "$tmp_dir"

  export PATH="$BIN_DIR:$PATH"
  node_ready || fail "Node was installed but is not usable from $BIN_DIR"
  printf 'Installed Node %s at %s\n' "$(node --version)" "$node_root"
}

install_pre_reqs() {
  section "Checking Murph pre-reqs"
  install_node
}

install_slack_cli() {
  if have_command slack; then
    mkdir -p "$BIN_DIR"
    ln -sf "$(command -v slack)" "$BIN_DIR/slack"
    printf 'Slack CLI setup req already satisfied: %s\n' "$(command -v slack)"
    return
  fi

  section "Installing Slack CLI setup req"
  require_bootstrap_tools
  mkdir -p "$MURPH_HOME" "$BIN_DIR"
  curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash

  for candidate in \
    "$HOME/.slack/bin/slack" \
    "$HOME/.local/bin/slack" \
    "/opt/homebrew/bin/slack" \
    "/usr/local/bin/slack"; do
    if [[ -x "$candidate" ]]; then
      ln -sf "$candidate" "$BIN_DIR/slack"
      break
    fi
  done

  if have_command slack; then
    printf 'Installed Slack CLI: %s\n' "$(command -v slack)"
  elif [[ -x "$BIN_DIR/slack" ]]; then
    printf 'Installed Slack CLI: %s\n' "$BIN_DIR/slack"
  else
    printf 'Slack CLI installer completed, but slack is not on PATH yet. Restart your shell or check ~/.local/bin.\n'
  fi
}

install_setup_reqs() {
  section "Checking Murph setup reqs"
  install_slack_cli

  if ! have_command git; then
    printf 'Warning: git is not installed. Murph can run, but update/development workflows may need it.\n'
  fi
}

case "$phase" in
  pre-req)
    install_pre_reqs
    ;;
  req)
    install_setup_reqs
    ;;
  all)
    install_pre_reqs
    install_setup_reqs
    ;;
  *)
    fail "unknown dependency phase: $phase"
    ;;
esac
