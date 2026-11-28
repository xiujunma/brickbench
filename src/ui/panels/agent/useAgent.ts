import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ChatState } from '../../../agent/chat';
import type { AgentLinkState } from '../../../agent/link';
import { agentChat, agentLink } from '../../../app/agent';

/** A web page's link: it has none, so it stays off. */
const NO_LINK = createStore<AgentLinkState>(() => ({ status: 'off', agent: null, mcpUrl: null }));

export function useAgentLink<T>(selector: (state: AgentLinkState) => T): T {
  return useStore(agentLink?.store ?? NO_LINK, selector);
}

export function useAgentChat<T>(selector: (state: ChatState) => T): T {
  return useStore(agentChat.store, selector);
}
