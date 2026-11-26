import type { ChatMessage } from "@/core/room";

/** Messages from others written after the reader last looked at the chat (times are the host's clock). */
export function unreadCount(chat: ChatMessage[], you: string, seenAt: number): number {
  return chat.filter((m) => m.at > seenAt && m.authorId !== you).length;
}
