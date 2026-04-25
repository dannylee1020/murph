import { EventEmitter } from 'node:events';
import type { AgentRunEventRecord, AgentRunRecord, AuditRecord, AutopilotSession, ReviewItem } from '#lib/types';

export type ControlPlaneEvent =
  | { type: 'session.updated'; session: AutopilotSession }
  | { type: 'queue.updated'; item: ReviewItem }
  | { type: 'audit.created'; audit: AuditRecord }
  | { type: 'briefing.ready'; sessionId: string }
  | { type: 'agent.run.updated'; run: AgentRunRecord }
  | { type: 'agent.run.event'; event: AgentRunEventRecord };

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emitControlPlaneEvent(event: ControlPlaneEvent): void {
  emitter.emit('event', event);
}

export function subscribeControlPlane(listener: (event: ControlPlaneEvent) => void): () => void {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
