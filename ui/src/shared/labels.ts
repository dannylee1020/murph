import type { BotRole } from './types';
import { titleCase } from './format';

export function providerLabel(provider: string): string {
    if (provider === 'slack') return 'Slack';
    if (provider === 'discord') return 'Discord';
    return titleCase(provider);
}

export function roleLabel(role: BotRole): string {
    return role === 'personal' ? 'Personal bot' : 'Channel bot';
}

export function roleDescription(role: BotRole): string {
    return role === 'personal'
        ? 'Receives explicit DMs for the represented owner'
        : 'Watches subscribed channels during active sessions';
}
