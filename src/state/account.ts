/**
 * Who is signed in to the site, and whether the site has accounts at all:
 * the desktop app, and a site hosted without the API, have none, and the
 * page then leaves accounts and the gallery out.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Provider, User } from '../core/cloud/protocol';
import type { CloudApi } from './cloudApi';

export type AccountStatus = 'checking' | 'unavailable' | 'ready';

export interface AccountState {
  readonly status: AccountStatus;
  /** Null while signed out. */
  readonly user: User | null;
  /** The ways in the site offers. */
  readonly providers: readonly Provider[];
}

const CHECKING: AccountState = { status: 'checking', user: null, providers: [] };
const UNAVAILABLE: AccountState = { status: 'unavailable', user: null, providers: [] };

export const accountStore = createStore<AccountState>(() => CHECKING);

export function useAccount<T>(selector: (state: AccountState) => T): T {
  return useStore(accountStore, selector);
}

/** Asks the site who is signed in; with `available` false (the desktop app) it does not ask. */
export async function checkAccount(api: CloudApi, available: boolean): Promise<void> {
  if (!available) {
    accountStore.setState(UNAVAILABLE);
    return;
  }
  try {
    const session = await api.session();
    accountStore.setState({ status: 'ready', user: session.user, providers: session.providers });
  } catch {
    // no API: a host that serves the site's files only, or a computer offline
    accountStore.setState(UNAVAILABLE);
  }
}

/** Someone signed in, or no one. */
export function setUser(user: User | null): void {
  accountStore.setState({ user });
}

export function currentUser(): User | null {
  return accountStore.getState().user;
}
