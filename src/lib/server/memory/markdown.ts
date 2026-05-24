import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureMemoryRoot } from '#lib/server/memory/root';
import type { ContextAssembly } from '#lib/types';

export async function writeThreadMemory(context: ContextAssembly): Promise<string> {
  const memoryRoot = await ensureMemoryRoot();
  const dir = path.join(memoryRoot, 'workspaces', context.workspaceId, 'threads');
  const filePath = path.join(dir, `${context.thread.ref.threadTs}.md`);

  const body = [
    `# Thread ${context.thread.ref.threadTs}`,
    '',
    `- Channel: ${context.thread.ref.channelId}`,
    `- Target user: ${context.targetUserId}`,
    '',
    '## Summary',
    '',
    context.summary ?? 'No summary captured.',
    '',
    '## Latest Message',
    '',
    context.thread.latestMessage,
    '',
    '## Unresolved Questions',
    '',
    ...context.unresolvedQuestions.map((question) => `- ${question}`),
    '',
    '## Evidence',
    '',
    `- Grounding: ${context.memory.thread.evidenceStatus?.status ?? 'unknown'}`,
    ...(context.memory.thread.evidenceStatus?.attemptedTools?.length
      ? [`- Attempted: ${context.memory.thread.evidenceStatus.attemptedTools.join(', ')}`]
      : []),
    ...(context.memory.thread.evidenceStatus?.successfulTools ?? []).map((tool) => (
      `- Succeeded: ${tool.name}${tool.summary ? ` ${JSON.stringify(tool.summary)}` : ''}`
    )),
    ...(context.memory.thread.evidenceStatus?.failedTools ?? []).map((tool) => (
      `- Failed: ${tool.name}${tool.error ? ` (${tool.error})` : ''}`
    ))
  ].join('\n');

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, body, 'utf8');

  return filePath;
}
