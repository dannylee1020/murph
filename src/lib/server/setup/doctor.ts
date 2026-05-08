import { existsSync } from 'node:fs';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { getNotionStatus } from '#lib/server/context-sources/notion';

export type SetupCheckStatus = 'ok' | 'warning' | 'action_required' | 'error';

export interface SetupDoctorCheck {
  id: string;
  label: string;
  status: SetupCheckStatus;
  message: string;
  fix?: string;
}

export interface SetupDoctorPayload {
  ok: boolean;
  ready: boolean;
  checks: SetupDoctorCheck[];
  nextStep: 'core' | 'ai' | 'slack_config' | 'slack_oauth' | 'identity' | 'channels' | 'ready';
}

function check(id: string, label: string, status: SetupCheckStatus, message: string, fix?: string): SetupDoctorCheck {
  return { id, label, status, message, fix };
}

export function getSetupDoctor(): SetupDoctorPayload {
  const env = getRuntimeEnv();
  const store = getStore();
  const summary = store.getWorkspaceSummary();
  const workspace = summary.workspace;
  const checks: SetupDoctorCheck[] = [];

  checks.push(
    existsSync('.env')
      ? check('env_file', 'Configuration file', 'ok', '.env exists.')
      : check('env_file', 'Configuration file', 'action_required', '.env is missing.', 'Run ./install.sh or create .env from .env.example.')
  );

  checks.push(
    env.encryptionKey
      ? check('encryption_key', 'Credential encryption', 'ok', 'Encryption key is configured.')
      : check('encryption_key', 'Credential encryption', 'action_required', 'Murph needs an encryption key before storing credentials.', 'Run ./install.sh or set MURPH_ENCRYPTION_KEY.')
  );

  checks.push(
    env.openaiApiKey || env.anthropicApiKey
      ? check('ai_provider', 'AI provider', 'ok', `${env.defaultProvider} is configured.`)
      : check('ai_provider', 'AI provider', 'action_required', 'Add an OpenAI or Anthropic key so Murph can draft replies.', 'Paste a provider key in setup.')
  );

  checks.push(
    env.slackEventsMode === 'socket'
      ? check('slack_events_mode', 'Slack event mode', 'ok', 'Slack is set to Socket Mode.')
      : check('slack_events_mode', 'Slack event mode', 'warning', 'Slack is using HTTP Events mode.', 'Use Socket Mode for local installs.')
  );

  checks.push(
    env.slackEventsMode === 'http' || env.slackAppToken
      ? check('slack_socket', 'Slack Socket Mode', 'ok', env.slackEventsMode === 'http' ? 'Socket Mode is disabled for HTTP mode.' : 'Slack app-level token is configured.')
      : check('slack_socket', 'Slack Socket Mode', 'action_required', 'Add a Slack app-level token with connections:write.', 'Create an app-level token in Slack and paste it as SLACK_APP_TOKEN.')
  );

  checks.push(
    env.slackClientId && env.slackClientSecret
      ? check('slack_oauth_config', 'Slack OAuth app', 'ok', 'Slack OAuth credentials are configured.')
      : check('slack_oauth_config', 'Slack OAuth app', 'action_required', 'Add Slack client ID and client secret before connecting the workspace.', 'Paste values from the Slack app Basic Information page.')
  );

  checks.push(
    workspace?.provider === 'slack'
      ? check('slack_installed', 'Slack workspace', 'ok', `${workspace.name} is connected.`)
      : check('slack_installed', 'Slack workspace', 'action_required', 'Connect a Slack workspace.', 'Use the Connect Slack button after Slack config is ready.')
  );

  checks.push(
    summary.userCount > 0
      ? check('identity', 'User identity', 'ok', 'A Murph user is configured.')
      : check('identity', 'User identity', 'action_required', 'Pick yourself from Slack so Murph knows who to watch for.')
  );

  const notion = getNotionStatus();
  checks.push(
    notion.configured
      ? check('notion', 'Notion', 'ok', 'Notion is configured.')
      : check('notion', 'Notion', 'warning', 'Notion is not connected yet.', 'Add optional sources later from Admin.')
  );

  const nextStep =
    checks.find((entry) => entry.id === 'env_file')?.status !== 'ok' ||
    checks.find((entry) => entry.id === 'encryption_key')?.status !== 'ok'
      ? 'core'
      : checks.find((entry) => entry.id === 'ai_provider')?.status !== 'ok'
        ? 'ai'
        : checks.some((entry) => ['slack_events_mode', 'slack_socket', 'slack_oauth_config'].includes(entry.id) && entry.status !== 'ok')
          ? 'slack_config'
          : checks.find((entry) => entry.id === 'slack_installed')?.status !== 'ok'
            ? 'slack_oauth'
            : checks.find((entry) => entry.id === 'identity')?.status !== 'ok'
              ? 'identity'
              : 'ready';

  return {
    ok: true,
    ready: nextStep === 'ready',
    checks,
    nextStep
  };
}
