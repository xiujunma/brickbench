import { useStore } from 'zustand';
import type { ChatState } from '../../../agent/chat';
import type { AgentLinkState } from '../../../agent/link';
import { agentChat, agentLink } from '../../../app/agent';

export function useAgentLink<T>(selector: (state: AgentLinkState) => T): T {
  return useStore(agentLink.store, selector);
}

export function useAgentChat<T>(selector: (state: ChatState) => T): T {
  return useStore(agentChat.store, selector);
}
