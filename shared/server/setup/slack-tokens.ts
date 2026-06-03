const SLACK_APP_TOKEN_PREFIX = 'xapp-';

export function isSlackAppLevelToken(value: string | undefined): boolean {
  return Boolean(value?.trim().startsWith(SLACK_APP_TOKEN_PREFIX));
}

export function slackAppTokenValidationError(fieldLabel = 'Slack app-level token'): string {
  return `${fieldLabel} must start with ${SLACK_APP_TOKEN_PREFIX}. Paste the Socket Mode app-level token here, not the Slack app configuration token.`;
}

export function validateSlackAppLevelToken(value: string | undefined, fieldLabel = 'Slack app-level token'): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || isSlackAppLevelToken(trimmed)) return undefined;
  return slackAppTokenValidationError(fieldLabel);
}

export function validateSlackConfigurationToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return undefined;
  if (isSlackAppLevelToken(trimmed)) {
    return 'That looks like a Slack app-level token. Paste it in the Socket Mode app-level token step, not the Slack app configuration token step.';
  }
  if (trimmed.startsWith('xoxb-')) {
    return 'That looks like a Slack bot token. Paste a Slack app configuration token for manifest setup.';
  }
  if (trimmed.startsWith('xoxp-')) {
    return 'That looks like a Slack user token. Paste a Slack app configuration token for manifest setup.';
  }
  if (trimmed.startsWith('https://hooks.slack.com/')) {
    return 'That looks like a Slack webhook URL. Paste a Slack app configuration token for manifest setup.';
  }
  return undefined;
}
