import { getStore } from '#app/server/persistence/store';
import type {
  ThreadMemory,
  ThreadEvidenceStatus,
  UserMemory,
  Workspace,
  WorkspaceMemory
} from '#app/types';

export class MemoryService {
  private readonly store = getStore();

  getUserMemory(workspaceId: string, slackUserId: string): UserMemory {
    return this.store.getOrCreateUserMemory(workspaceId, slackUserId);
  }

  writeUserMemory(workspaceId: string, slackUserId: string, next: UserMemory): UserMemory {
    this.store.upsertUserMemory(workspaceId, slackUserId, next);
    return next;
  }

  getWorkspaceMemory(workspaceId: string): WorkspaceMemory {
    return this.store.getOrCreateWorkspaceMemory(workspaceId);
  }

  getThreadMemory(workspaceId: string, channelId: string, threadTs: string, targetUserId?: string): ThreadMemory {
    return this.store.getOrCreateThreadMemory(workspaceId, channelId, threadTs, targetUserId);
  }

  writeThreadSummary(
    workspace: Workspace,
    channelId: string,
    threadTs: string,
    targetUserId?: string,
    summary?: string,
    openQuestions: string[] = [],
    evidenceStatus?: ThreadEvidenceStatus
  ): ThreadMemory {
    const existing = this.getThreadMemory(workspace.id, channelId, threadTs, targetUserId);
    const next: ThreadMemory = {
      ...existing,
      targetUserId: targetUserId ?? existing.targetUserId,
      summary: summary ?? existing.summary,
      openQuestions: openQuestions.length > 0 ? openQuestions : existing.openQuestions,
      evidenceStatus: evidenceStatus ?? existing.evidenceStatus
    };

    this.store.upsertThreadMemory(next);
    return next;
  }

  linkThreadArtifact(
    workspace: Workspace,
    channelId: string,
    threadTs: string,
    artifact: string,
    targetUserId?: string
  ): ThreadMemory {
    const existing = this.getThreadMemory(workspace.id, channelId, threadTs, targetUserId);
    const linkedArtifacts = existing.linkedArtifacts.includes(artifact)
      ? existing.linkedArtifacts
      : [...existing.linkedArtifacts, artifact];
    const next: ThreadMemory = {
      ...existing,
      linkedArtifacts
    };

    this.store.upsertThreadMemory(next);
    return next;
  }
}

let memoryService: MemoryService | null = null;

export function getMemoryService(): MemoryService {
  if (!memoryService) {
    memoryService = new MemoryService();
  }

  return memoryService;
}
