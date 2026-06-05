import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { BotRole } from '#app/types';
export { isSlackAppLevelToken } from './slack-tokens.js';

const slackApiBase = process.env.MURPH_SLACK_API_BASE || 'https://slack.com/api';

export interface SlackManifestCredentials {
  appId?: string;
  clientId?: string;
  clientSecret?: string;
  signingSecret?: string;
  appToken?: string;
  teamId?: string;
  teamName?: string;
}

export interface SlackManifestPrepareResult {
  credentials: SlackManifestCredentials;
  updatedExistingApp: boolean;
}

export class SlackManifestApiError extends Error {
  constructor(
    readonly method: string,
    readonly error: string,
    readonly details = ''
  ) {
    super(details ? `${error}: ${details}` : error);
    this.name = 'SlackManifestApiError';
  }
}

function setPath(target: Record<string, unknown>, keys: string[], value: unknown): void {
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const existing = cursor[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function deletePath(target: Record<string, unknown>, keys: string[]): void {
  let cursor: Record<string, unknown> | undefined = target;
  for (const key of keys.slice(0, -1)) {
    const existing = cursor[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      return;
    }
    cursor = existing as Record<string, unknown>;
  }
  delete cursor[keys[keys.length - 1]];
}

function appDir(): string {
  return process.env.MURPH_APP_DIR || process.cwd();
}

function manifestPathForRole(role: BotRole): string {
  const root = appDir();
  const rolePath = path.join(root, 'docs', 'public', 'slack-channel-manifest.yaml');
  if (existsSync(rolePath)) return rolePath;
  return path.join(root, 'docs', 'public', 'slack-manifest.yaml');
}

export function renderSlackManifest(role: BotRole, appUrl: string): Record<string, unknown> {
  const manifestPath = manifestPathForRole(role);
  if (!existsSync(manifestPath)) {
    throw new Error(`Slack ${role} manifest is missing: ${manifestPath}`);
  }

  const manifest = parse(readFileSync(manifestPath, 'utf8')) ?? {};
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Slack ${role} manifest must contain a YAML object.`);
  }

  setPath(manifest as Record<string, unknown>, ['oauth_config', 'redirect_urls'], [`${appUrl}/api/slack/oauth/callback`]);
  deletePath(manifest as Record<string, unknown>, ['settings', 'interactivity', 'request_url']);
  const features = (manifest as Record<string, unknown>).features;
  if (features && typeof features === 'object' && !Array.isArray(features)) {
    const slashCommands = (features as Record<string, unknown>).slash_commands;
    if (Array.isArray(slashCommands)) {
      for (const command of slashCommands) {
        if (command && typeof command === 'object' && !Array.isArray(command)) {
          delete (command as Record<string, unknown>).url;
        }
      }
    }
  }
  setPath(manifest as Record<string, unknown>, ['settings', 'socket_mode_enabled'], true);
  return manifest as Record<string, unknown>;
}

function credentialsFromPayload(payload: Record<string, unknown>, fallbackAppId?: string): SlackManifestCredentials {
  const app = payload.app && typeof payload.app === 'object' && !Array.isArray(payload.app)
    ? payload.app as Record<string, unknown>
    : {};
  const credentials = payload.credentials && typeof payload.credentials === 'object' && !Array.isArray(payload.credentials)
    ? payload.credentials as Record<string, unknown>
    : app.credentials && typeof app.credentials === 'object' && !Array.isArray(app.credentials)
      ? app.credentials as Record<string, unknown>
      : {};

  return {
    appId: stringValue(payload.app_id) || stringValue(payload.appId) || stringValue(app.id) || stringValue(app.app_id) || stringValue(credentials.app_id) || fallbackAppId,
    clientId: stringValue(credentials.client_id) || stringValue(credentials.clientId) || stringValue(app.client_id) || stringValue(payload.client_id),
    clientSecret: stringValue(credentials.client_secret) || stringValue(credentials.clientSecret) || stringValue(app.client_secret) || stringValue(payload.client_secret),
    signingSecret: stringValue(credentials.signing_secret) || stringValue(credentials.signingSecret) || stringValue(app.signing_secret) || stringValue(payload.signing_secret),
    appToken: stringValue(credentials.app_token) || stringValue(credentials.appToken) || stringValue(app.app_token) || stringValue(payload.app_token) || stringValue(payload.appToken),
    teamId: stringValue(payload.team_id) || stringValue(payload.teamId) || stringValue(app.team_id) || stringValue(app.teamId) || stringValue(credentials.team_id),
    teamName: stringValue(payload.team_name) || stringValue(payload.teamName) || stringValue(app.team_name) || stringValue(app.teamName) || stringValue(credentials.team_name)
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function slackManifestApi(method: string, token: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${slackApiBase}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const details = errors
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const row = entry as Record<string, unknown>;
        return stringValue(row.message) || stringValue(row.error) || '';
      })
      .filter(Boolean)
      .join('; ');
    throw new SlackManifestApiError(method, stringValue(payload.error) || `Slack ${method} failed`, details);
  }
  return payload;
}

function slackManifestAppMissing(error: unknown): boolean {
  if (!(error instanceof SlackManifestApiError)) return false;
  const message = `${error.error} ${error.details}`.toLowerCase();
  return ['invalid_app', 'app_not_found', 'not_found', 'notfound', 'no_app', 'unknown_app'].some((marker) => message.includes(marker));
}

async function tryUpdateExistingSlackApp(appId: string | undefined, token: string, manifestBody: string): Promise<SlackManifestCredentials | undefined> {
  if (!appId) return undefined;

  try {
    await slackManifestApi('apps.manifest.export', token, { app_id: appId });
  } catch (error) {
    if (slackManifestAppMissing(error)) {
      return undefined;
    }
    throw error;
  }

  const payload = await slackManifestApi('apps.manifest.update', token, {
    app_id: appId,
    manifest: manifestBody
  });
  return credentialsFromPayload({ ...payload, app_id: appId }, appId);
}

export async function prepareSlackManifestApp(input: {
  role: BotRole;
  appUrl: string;
  configurationToken: string;
  existingAppId?: string;
}): Promise<SlackManifestPrepareResult> {
  const manifestBody = JSON.stringify(renderSlackManifest(input.role, input.appUrl));
  if (input.existingAppId) {
    const updated = await tryUpdateExistingSlackApp(input.existingAppId, input.configurationToken, manifestBody);
    if (updated) {
      return { credentials: updated, updatedExistingApp: true };
    }
    throw new Error(`Slack app ${input.existingAppId} was not found for this configuration token.`);
  }

  const payload = await slackManifestApi('apps.manifest.create', input.configurationToken, { manifest: manifestBody });
  return { credentials: credentialsFromPayload(payload), updatedExistingApp: false };
}
