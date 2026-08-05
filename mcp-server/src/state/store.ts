/**
 * Per-session event queues used by wait_for_response / ask_choice.
 */

import {
  appendQueuedEvent,
  drainQueuedEvents,
  type QueuedUserEvent,
} from "./persistence.js";
import { getActiveSessionId, withSessionContext } from "./sessions.js";

export interface UserEvent extends QueuedUserEvent {
  event: string;
  [key: string]: unknown;
}

interface PendingWaiter {
  resolve: (messages: UserEvent[], timedOut: boolean) => void;
  timer: NodeJS.Timeout;
}

export interface WaitForResponseResult {
  messages: UserEvent[];
  timedOut: boolean;
  timeoutSeconds: number;
}

const queues = new Map<string, UserEvent[]>();
const waiters = new Map<string, PendingWaiter>();
const sessionTitles = new Map<string, string>();

function getQueue(sessionId: string): UserEvent[] {
  const existing = queues.get(sessionId);
  if (existing) return existing;
  const next: UserEvent[] = [];
  queues.set(sessionId, next);
  return next;
}

export async function waitForResponseResult(timeoutSeconds = 300, sessionId = getActiveSessionId()): Promise<WaitForResponseResult> {
  return withSessionContext(sessionId, async () => {
    const safeTimeout = Math.max(1, Math.min(Math.floor(timeoutSeconds), 280));
    const persisted = await drainQueuedEvents();
    if (persisted.length > 0) return { messages: persisted as UserEvent[], timedOut: false, timeoutSeconds: safeTimeout };

    const queue = getQueue(sessionId);
    if (queue.length > 0) {
      return { messages: queue.splice(0, queue.length), timedOut: false, timeoutSeconds: safeTimeout };
    }

    return new Promise<WaitForResponseResult>((resolve) => {
      let poller: NodeJS.Timeout | null = null;
      let done = false;

      const finish = (messages: UserEvent[], timedOut: boolean) => {
        if (done) return;
        done = true;
        if (poller) clearInterval(poller);
        waiters.delete(sessionId);
        resolve({ messages, timedOut, timeoutSeconds: safeTimeout });
      };

      const timer = setTimeout(() => {
        const memoryBatch = queue.splice(0, queue.length);
        void drainQueuedEvents()
          .then((persistedBatch) => finish([...memoryBatch, ...(persistedBatch as UserEvent[])], true))
          .catch(() => finish(memoryBatch, true));
      }, safeTimeout * 1000);

      poller = setInterval(() => {
        void drainQueuedEvents()
          .then((persistedBatch) => {
            if (persistedBatch.length === 0) return;
            clearTimeout(timer);
            const memoryBatch = queue.splice(0, queue.length);
            finish([...memoryBatch, ...(persistedBatch as UserEvent[])], false);
          })
          .catch(() => {
            // Let timeout be the fallback.
          });
      }, 250);

      waiters.set(sessionId, { resolve: finish, timer });
    });
  });
}

export async function waitForResponse(timeoutSeconds = 300, sessionId = getActiveSessionId()): Promise<UserEvent[]> {
  return (await waitForResponseResult(timeoutSeconds, sessionId)).messages;
}

export async function drainPendingMessages(sessionId = getActiveSessionId()): Promise<UserEvent[]> {
  return withSessionContext(sessionId, async () => {
    const queue = getQueue(sessionId);
    const memoryBatch = queue.splice(0, queue.length);
    const persistedBatch = await drainQueuedEvents();
    return [...memoryBatch, ...(persistedBatch as UserEvent[])];
  });
}

export async function pushEvent(event: UserEvent, sessionId = getActiveSessionId()): Promise<void> {
  return withSessionContext(sessionId, async () => {
    const queue = getQueue(sessionId);

    const waiter = waiters.get(sessionId);
    if (waiter) {
      queue.push({ ...event, sessionId });
      waiters.delete(sessionId);
      clearTimeout(waiter.timer);
      waiter.resolve(queue.splice(0, queue.length), false);
      return;
    }

    // No active waiter means this is a pending inbox message for a future Agent turn.
    // Persist it only once; do not also keep an in-memory duplicate.
    await appendQueuedEvent({ ...event, sessionId });
  });
}

export function hasPendingWaiter(sessionId = getActiveSessionId()): boolean {
  return waiters.has(sessionId);
}

export function queueLength(sessionId = getActiveSessionId()): number {
  return getQueue(sessionId).length;
}

export function clearSessionRuntimeState(sessionId: string): void {
  const waiter = waiters.get(sessionId);
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve([], false);
    waiters.delete(sessionId);
  }
  queues.delete(sessionId);
  sessionTitles.delete(sessionId);
}

export function setSessionTitle(title: string, sessionId = getActiveSessionId()): void {
  sessionTitles.set(sessionId, title);
}

export function getSessionTitle(sessionId = getActiveSessionId()): string {
  return sessionTitles.get(sessionId) ?? "Untitled session";
}
