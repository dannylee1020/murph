#!/usr/bin/env bash
set -euo pipefail

APP_URL_DEFAULT="http://localhost:5173"
SQLITE_PATH_DEFAULT="data/murph.sqlite"
LOG_FILE=".murph-install.log"
DEFAULT_INSTALL_DIR="$HOME/.murph/app"
CONFIG_PATH_DEFAULT="$HOME/.murph/config.yaml"
SOURCE_ARCHIVE_URL="https://github.com/dannylee1020/murph/archive/refs/heads/main.tar.gz"
BIN_DIR_DEFAULT="$HOME/.local/bin"
MURPH_DEPS_BIN="${MURPH_DEPS_DIR:-$HOME/.murph/deps}/bin"
export PATH="$MURPH_DEPS_BIN:$HOME/.local/bin:$PATH"

force=false
no_start=false
skip_build=false
simple=false
doctor=false
product="${MURPH_DISTRIBUTION:-team}"
original_args=("$@")

have_command() {
  command -v "$1" >/dev/null 2>&1
}

install_entrypoint() {
  if [[ "$product" == "personal" ]]; then
    printf './install-personal.sh\n'
  else
    printf './install.sh\n'
  fi
}

usage() {
  printf 'Usage: %s [--force] [--no-start] [--skip-build] [--simple] [--doctor]\n' "$(install_entrypoint)"
  cat <<'EOF'

Options:
  --force      Regenerate local config and rebuild even when files already exist.
  --no-start   Do not ask to start the server after installation.
  --skip-build Skip npm run build.
  --simple     Skip terminal prompts and finish setup in the browser.
  --doctor     Check the local install and exit.
  -h, --help   Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      force=true
      ;;
    --no-start)
      no_start=true
      ;;
    --skip-build)
      skip_build=true
      ;;
    --simple)
      simple=true
      ;;
    --dev-setup)
      printf '%s\n' '--dev-setup is no longer needed; developer setup is the default.'
      ;;
    --doctor)
      doctor=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ "$product" != "team" && "$product" != "personal" ]]; then
  echo "Invalid product: $product"
  usage
  exit 1
fi
export MURPH_DISTRIBUTION="$product"

is_murph_checkout() {
  [[ -f package.json && -f install.sh ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"murph"' package.json
}

bootstrap_from_archive() {
  if [[ "${MURPH_BOOTSTRAPPED:-}" == "1" ]]; then
    printf 'Murph installer could not find a valid checkout in %s.\n' "$(pwd)"
    exit 1
  fi

  local install_dir="${MURPH_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
  local archive_url="${MURPH_SOURCE_ARCHIVE:-$SOURCE_ARCHIVE_URL}"
  local tmp_dir archive_file source_dir

  for required in curl tar mktemp; do
    if ! have_command "$required"; then
      printf 'Murph needs %s for curl-based installation.\n' "$required"
      exit 1
    fi
  done

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-install.XXXXXX")"
  archive_file="$tmp_dir/murph.tar.gz"

  cleanup_bootstrap() {
    rm -rf "$tmp_dir"
  }
  trap cleanup_bootstrap EXIT

  printf 'Installing Murph into %s\n' "$install_dir"
  printf 'Downloading %s\n' "$archive_url"
  curl -fsSL "$archive_url" -o "$archive_file"
  tar -xzf "$archive_file" -C "$tmp_dir"

  source_dir=""
  for candidate in "$tmp_dir"/*; do
    if [[ -d "$candidate" ]]; then
      source_dir="$candidate"
      break
    fi
  done
  if [[ -z "$source_dir" || ! -f "$source_dir/package.json" ]]; then
    printf 'Downloaded archive did not contain a Murph source tree.\n'
    exit 1
  fi

  mkdir -p "$install_dir"
  cp -R "$source_dir"/. "$install_dir"/

  printf 'Murph source is ready in %s\n' "$install_dir"
  cd "$install_dir"
  MURPH_BOOTSTRAPPED=1 bash "$(install_entrypoint)" "$@"
  exit $?
}

if ! is_murph_checkout; then
  bootstrap_from_archive "${original_args[@]}"
fi

: > "$LOG_FILE"

section() {
  printf '\n%s\n' "$1"
  printf '%s\n' "----------------------------------------"
}

fail() {
  printf '\nInstall failed: %s\n' "$1"
  printf 'See %s for the full log.\n' "$LOG_FILE"
  exit 1
}

run_logged() {
  "$@" 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

install_dependency_phase() {
  local phase="$1"
  if [[ ! -f scripts/install-deps.sh ]]; then
    fail "scripts/install-deps.sh is missing."
  fi
  run_logged bash scripts/install-deps.sh "$phase" || fail "dependency phase failed: $phase"
}

node_install_help() {
  cat <<'EOF'
Murph needs Node.js 20 or newer.
Node 20 is the CI target and recommended baseline.

Install Node with your normal toolchain, then rerun the installer.

macOS:
  brew install node
  or download the LTS installer from https://nodejs.org/

Linux:
  Use your distro package manager, NodeSource, Volta, asdf, fnm, or nvm.
  Node downloads: https://nodejs.org/

Windows:
  Use WSL for this installer, or follow the manual setup in README.md.
EOF
}

check_node() {
  section "Checking environment"

  if ! have_command node; then
    node_install_help
    fail "Node.js was not found."
  fi

  local version major
  version="$(node --version)"
  major="${version#v}"
  major="${major%%.*}"

  if ! [[ "$major" =~ ^[0-9]+$ ]] || [[ "$major" -lt 20 ]]; then
    node_install_help
    fail "Node.js 20 or newer is required. Found $version."
  fi

  if ! have_command npm; then
    fail "npm was not found. Reinstall Node.js with npm included."
  fi

  printf 'Node: %s\n' "$version"
  printf 'npm: %s\n' "$(npm --version)"
}

env_value() {
  local key="$1"
  local value=""
  if [[ -n "${!key:-}" ]]; then
    printf '%s\n' "${!key}"
    return
  fi
  if [[ -f "$CONFIG_PATH_DEFAULT" ]]; then
    case "$key" in
      MURPH_APP_URL)
        value="$(grep -E '^[[:space:]]+url:' "$CONFIG_PATH_DEFAULT" | head -n 1 | sed -E 's/^[[:space:]]+url:[[:space:]]*//; s/^"//; s/"$//' || true)"
        ;;
      MURPH_SQLITE_PATH)
        value="$(grep -E '^[[:space:]]+sqlitePath:' "$CONFIG_PATH_DEFAULT" | head -n 1 | sed -E 's/^[[:space:]]+sqlitePath:[[:space:]]*//; s/^"//; s/"$//' || true)"
        ;;
      MURPH_DEFAULT_PROVIDER)
        value="$(grep -E '^[[:space:]]+defaultProvider:' "$CONFIG_PATH_DEFAULT" | head -n 1 | sed -E 's/^[[:space:]]+defaultProvider:[[:space:]]*//; s/^"//; s/"$//' || true)"
        ;;
      SLACK_EVENTS_MODE)
        value="$(grep -E '^[[:space:]]+eventsMode:' "$CONFIG_PATH_DEFAULT" | head -n 1 | sed -E 's/^[[:space:]]+eventsMode:[[:space:]]*//; s/^"//; s/"$//' || true)"
        ;;
      SLACK_CLIENT_ID)
        value="$(grep -E '^[[:space:]]+clientId:' "$CONFIG_PATH_DEFAULT" | head -n 1 | sed -E 's/^[[:space:]]+clientId:[[:space:]]*//; s/^"//; s/"$//' || true)"
        ;;
    esac
  fi
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
    return
  fi
  [[ -f "$HOME/.murph/.credentials" ]] || return
  KEY="$key" CREDENTIALS_PATH="$HOME/.murph/.credentials" node <<'NODE'
const { readFileSync } = require('node:fs');
const map = {
  OPENAI_API_KEY: ['openai', 'api_key'],
  ANTHROPIC_API_KEY: ['anthropic', 'api_key'],
  SLACK_APP_TOKEN: ['slack', 'app_token'],
  SLACK_CLIENT_SECRET: ['slack', 'client_secret']
};
const target = map[process.env.KEY];
if (!target) process.exit(0);
try {
  const file = JSON.parse(readFileSync(process.env.CREDENTIALS_PATH, 'utf8'));
  const entry = (file.credentials || []).find((item) => item.provider === target[0] && item.key === target[1] && !item.workspaceId && !item.userId);
  if (entry?.value) process.stdout.write(entry.value);
} catch {}
NODE
}

doctor_check() {
  local label="$1"
  local status="$2"
  local message="$3"
  printf '%-28s %s %s\n' "$label" "$status" "$message"
}

run_doctor() {
  section "Murph install doctor"

  local problems=0
  if [[ -f "$CONFIG_PATH_DEFAULT" ]]; then
    doctor_check "Config file" "ok" "$CONFIG_PATH_DEFAULT"
  else
    doctor_check "Config file" "missing" "run $(install_entrypoint)"
    problems=$((problems + 1))
  fi

  if [[ -f "$HOME/.murph/.credentials" ]]; then
    doctor_check "Credentials file" "ok" "$HOME/.murph/.credentials"
  else
    doctor_check "Credentials file" "warning" "created by murph setup when secrets are saved"
  fi

  if [[ -n "$(env_value OPENAI_API_KEY)" || -n "$(env_value ANTHROPIC_API_KEY)" ]]; then
    doctor_check "AI provider" "ok" "configured"
  else
    doctor_check "AI provider" "missing" "add OpenAI or Anthropic key in setup"
    problems=$((problems + 1))
  fi

  if [[ "$(env_value SLACK_EVENTS_MODE)" == "http" ]]; then
    doctor_check "Slack events" "warning" "HTTP mode needs a public Events URL"
  elif [[ -n "$(env_value SLACK_APP_TOKEN)" ]]; then
    doctor_check "Slack Socket Mode" "ok" "app-level token configured"
  else
    doctor_check "Slack Socket Mode" "missing" "add SLACK_APP_TOKEN"
    problems=$((problems + 1))
  fi

  if [[ -n "$(env_value SLACK_CLIENT_ID)" && -n "$(env_value SLACK_CLIENT_SECRET)" ]]; then
    doctor_check "Slack OAuth" "ok" "client credentials configured"
  else
    doctor_check "Slack OAuth" "missing" "add Slack client ID and secret"
    problems=$((problems + 1))
  fi

  if [[ -d node_modules ]]; then
    doctor_check "Dependencies" "ok" "node_modules present"
  else
    doctor_check "Dependencies" "missing" "run npm install"
    problems=$((problems + 1))
  fi

  if [[ -d dist ]]; then
    doctor_check "Build" "ok" "dist present"
  else
    doctor_check "Build" "missing" "run npm run build"
    problems=$((problems + 1))
  fi

  if [[ "$problems" -gt 0 ]]; then
    printf '\n%s item(s) still need setup.\n' "$problems"
    exit 1
  fi

  printf '\nCore install looks ready.\n'
  exit 0
}

prompt_llm_key() {
  LLM_PROVIDER=""
  LLM_KEY=""

  if [[ ! -t 0 ]]; then
    return
  fi

  printf '\nMurph needs OpenAI or Anthropic to answer messages.\n'
  printf 'You can paste a key now or leave this blank and run murph setup ai later.\n'
  printf 'Choose provider: [1] OpenAI  [2] Anthropic  [enter] Skip: '
  local choice
  read -r choice

  case "$choice" in
    1)
      LLM_PROVIDER="openai"
      ;;
    2)
      LLM_PROVIDER="anthropic"
      ;;
    "")
      return
      ;;
    *)
      printf 'Skipping LLM key setup.\n'
      return
      ;;
  esac

  printf 'Paste API key: '
  read -rs LLM_KEY
  printf '\n'
}

write_credentials_file() {
  local provider="$1"
  local key="$2"
  [[ -n "$key" ]] || return
  mkdir -p "$HOME/.murph"
  PROVIDER="$provider" API_KEY="$key" CREDENTIALS_PATH="$HOME/.murph/.credentials" node <<'NODE'
const { existsSync, readFileSync, writeFileSync, chmodSync } = require('node:fs');
const path = process.env.CREDENTIALS_PATH;
const provider = process.env.PROVIDER;
const key = process.env.API_KEY;
let file = { version: 1, credentials: [] };
if (existsSync(path)) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed.credentials)) file.credentials = parsed.credentials;
  } catch {}
}
const now = new Date().toISOString();
const existing = file.credentials.find((entry) => entry.provider === provider && entry.key === 'api_key');
const next = { provider, key: 'api_key', value: key, createdAt: existing?.createdAt || now, updatedAt: now };
if (existing) Object.assign(existing, next);
else file.credentials.push(next);
writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
chmodSync(path, 0o600);
NODE
}

write_config_file() {
  local provider="openai"
  local product_mode="channel"
  local bot_role="channel"
  if [[ "$product" == "personal" ]]; then
    product_mode="personal"
    bot_role="personal"
  fi

  if [[ "${LLM_PROVIDER:-}" == "openai" ]]; then
    provider="openai"
    write_credentials_file "openai" "${LLM_KEY:-}"
  elif [[ "${LLM_PROVIDER:-}" == "anthropic" ]]; then
    provider="anthropic"
    write_credentials_file "anthropic" "${LLM_KEY:-}"
  fi

  umask 077
  mkdir -p "$HOME/.murph"
  cat > "$CONFIG_PATH_DEFAULT" <<EOF
app:
  distribution: $product
  productMode: $product_mode
  url: $APP_URL_DEFAULT
  sqlitePath: $SQLITE_PATH_DEFAULT
ai:
  defaultProvider: $provider
channels:
  slack:
    eventsMode: socket
    clientId: ""
  discord:
    clientId: ""
    redirectUri: ""
setup:
  botRoles:
    - $bot_role
EOF
}

configure_config() {
  section "Configuring Murph"

  mkdir -p data
  printf 'Created data/ if it was missing.\n'

  if [[ -f "$CONFIG_PATH_DEFAULT" && "$force" != true ]]; then
    printf 'Config already exists at %s. Leaving it unchanged.\n' "$CONFIG_PATH_DEFAULT"
    return
  fi

  if [[ -f "$CONFIG_PATH_DEFAULT" && "$force" == true ]]; then
    local backup="$CONFIG_PATH_DEFAULT.backup.$(date +%Y%m%d%H%M%S)"
    cp "$CONFIG_PATH_DEFAULT" "$backup"
    printf 'Backed up existing config to %s.\n' "$backup"
  fi

  if [[ "$simple" != true ]]; then
    prompt_llm_key
  fi
  write_config_file
  printf 'Wrote %s. Secrets are stored in ~/.murph/.credentials when provided.\n' "$CONFIG_PATH_DEFAULT"
}

install_dependencies() {
  section "Installing dependencies"

  if [[ -d node_modules && "$force" != true ]]; then
    printf 'node_modules already exists. Running npm install to reconcile packages.\n'
  fi

  if ! run_logged npm install; then
    if grep -qi 'better-sqlite3' "$LOG_FILE"; then
      cat <<'EOF'

npm install failed while building better-sqlite3.

Common fixes:
  macOS:          xcode-select --install
  Debian/Ubuntu:  sudo apt-get install build-essential python3

After installing build tools, rerun the installer.
EOF
    fi
    fail "npm install failed."
  fi
}

build_app() {
  if [[ "$skip_build" == true ]]; then
    section "Skipping build"
    printf 'Skipped npm run build because --skip-build was provided.\n'
    return
  fi

  section "Building Murph"
  run_logged npm run build || fail "npm run build failed."
}

prune_install_payload() {
  section "Pruning install payload"

  if [[ ! -f scripts/prune-install.sh ]]; then
    printf 'scripts/prune-install.sh is missing. Skipping install pruning.\n'
    return
  fi

  run_logged bash scripts/prune-install.sh "$(pwd)" || fail "install pruning failed."
}

install_cli() {
  section "Installing CLI"

  local product_cli="app/team/cli/murph"
  if [[ "$product" == "personal" ]]; then
    product_cli="app/personal/cli/murph"
  fi

  if [[ ! -f "$product_cli" ]]; then
    printf '%s is missing. Skipping CLI install.\n' "$product_cli"
    return
  fi

  local bin_dir="${MURPH_BIN_DIR:-$BIN_DIR_DEFAULT}"
  mkdir -p "$bin_dir"
  chmod +x "$product_cli" shared/cli/murph
  cat > "$bin_dir/murph" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export MURPH_APP_DIR="\${MURPH_APP_DIR:-$(pwd)}"
export MURPH_HOME="\${MURPH_HOME:-$HOME/.murph}"
exec "\$MURPH_APP_DIR/$product_cli" "\$@"
EOF
  chmod +x "$bin_dir/murph"
  printf 'Installed Murph %s CLI at %s/murph.\n' "$([[ "$product" == "personal" ]] && printf 'Personal' || printf 'Team')" "$bin_dir"

  case ":$PATH:" in
    *":$bin_dir:"*)
      ;;
    *)
      cat <<EOF
Add Murph to your PATH:
  export PATH="$bin_dir:\$PATH"
EOF
      ;;
  esac
}

print_next_steps() {
  section "Next steps"

  local build_status="Production build ready"
  local product_label="Murph Team"
  if [[ "$product" == "personal" ]]; then
    product_label="Murph Personal"
  fi
  if [[ "$skip_build" == true ]]; then
    build_status="Build skipped; run murph build before murph start"
  fi

  cat <<EOF
Installed:
  - $product_label selected
  - Dependencies installed
  - $build_status
  - ~/.murph/config.yaml present
  - SQLite data directory ready

Agent-ready checklist:
  - Run murph setup to configure AI, Slack/Discord, identity, schedule, and policy.

Local app:
  $APP_URL_DEFAULT

Day-to-day commands:
  murph setup
  murph start
  murph status
  murph doctor
  murph logs -f

Slack app setup:
  App dashboard: https://api.slack.com/apps
  Enable Socket Mode and create an app-level token with connections:write.
  Add Slack credentials through murph setup slack. Secrets are stored in ~/.murph/.credentials.
  OAuth callback for local installs: $APP_URL_DEFAULT/api/slack/oauth/callback
  No Slack Events URL is needed when SLACK_EVENTS_MODE=socket.

Discord app setup:
  App dashboard: https://discord.com/developers/applications
  DISCORD_REDIRECT_URI: <public-origin>/api/discord/oauth/callback

Optional context sources such as Notion, GitHub, Google, Granola, Obsidian, and web search can be added later.
Full configuration reference: ~/.murph/config.yaml and ~/.murph/.credentials
Local health check: murph doctor
Install log: $LOG_FILE
EOF
}

maybe_start() {
  if [[ "$no_start" == true ]]; then
    return
  fi

  if [[ ! -t 0 ]]; then
    return
  fi

  printf '\nRun CLI setup now? [y/N] '
  local answer
  local bin_dir="${MURPH_BIN_DIR:-$BIN_DIR_DEFAULT}"
  read -r answer
  case "$answer" in
    y|Y|yes|YES)
      if [[ -x "$bin_dir/murph" ]]; then
        "$bin_dir/murph" setup --quick
      elif [[ "$product" == "personal" && -x app/personal/cli/murph ]]; then
        app/personal/cli/murph setup --quick
      elif [[ -x app/team/cli/murph ]]; then
        app/team/cli/murph setup --quick
      elif command -v murph >/dev/null 2>&1; then
        murph setup --quick
      else
        printf 'CLI is not available yet. Run: murph setup\n'
      fi
      ;;
    *)
      printf 'Set up later with: murph setup\n'
      ;;
  esac
}

install_dependency_phase pre-req
check_node
if [[ "$doctor" == true ]]; then
  run_doctor
fi
configure_config
install_dependencies
build_app
prune_install_payload
install_cli
install_dependency_phase req
print_next_steps
maybe_start
