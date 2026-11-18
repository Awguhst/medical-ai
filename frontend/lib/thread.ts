import type { ChatMessage, Conversation } from "./types";

/**
 * A conversation is a tree: editing a question, or asking for another reply,
 * adds a sibling instead of replacing anything. What the chat shows is one
 * path through that tree, chosen fork by fork.
 */

/** Key under which the children of the conversation's start are recorded. */
export const ROOT = "";

export function parentKey(message: ChatMessage): string {
  return message.parentId ?? ROOT;
}

/** The children of one message (of the start, for ROOT), oldest first. */
export function childrenOf(messages: ChatMessage[], parent: string): ChatMessage[] {
  return messages.filter((m) => parentKey(m) === parent);
}

/**
 * The path on display: from the start, the chosen child at every fork (the
 * newest one where no choice was recorded), down to a leaf.
 */
export function threadOf(conversation: Conversation): ChatMessage[] {
  const thread: ChatMessage[] = [];
  let parent = ROOT;
  for (;;) {
    const children = childrenOf(conversation.messages, parent);
    if (children.length === 0) return thread;
    const chosen = conversation.branches?.[parent];
    const next = children.find((m) => m.id === chosen) ?? children[children.length - 1];
    thread.push(next);
    parent = next.id;
  }
}

/**
 * For every message of the thread that has alternatives, the ids of all the
 * alternatives at that point (itself included), oldest first.
 */
export function siblingsIn(
  conversation: Conversation,
  thread: ChatMessage[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const message of thread) {
    const siblings = childrenOf(conversation.messages, parentKey(message));
    if (siblings.length > 1) map.set(message.id, siblings.map((m) => m.id));
  }
  return map;
}

/** The conversation with `childId` on display under `parent`. */
export function withBranch(conversation: Conversation, parent: string, childId: string): Conversation {
  return { ...conversation, branches: { ...conversation.branches, [parent]: childId } };
}

/** Conversations stored before branching were a plain list: read one as a single chain. */
export function withParents(messages: ChatMessage[]): ChatMessage[] {
  let previous: string | null = null;
  return messages.map((m) => {
    const linked = m.parentId === undefined ? { ...m, parentId: previous } : m;
    previous = linked.id;
    return linked;
  });
}
