import { useState } from 'react';
import { MAX_DISPLAY_NAME, type Provider } from '../../core/cloud/protocol';
import { useAccount } from '../../state/account';
import { useEditor } from '../../state/editorStore';
import { deleteAccount, renameAccount, signIn, signOut } from '../../state/online';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';

const PROVIDER_LABELS: Readonly<Record<Provider, string>> = {
  github: 'Sign in with GitHub',
  google: 'Sign in with Google',
  test: 'Sign in for testing',
};

/** What an account keeps, said where people decide to make one. */
function Privacy() {
  return (
    <p className="account-privacy">
      BrickBench keeps the name and account number GitHub or Google gives it, a cookie that keeps you signed in, and the models you save online. It
      never sees your password or email address. Your models are yours alone until you put one in the gallery, and deleting your account deletes them
      all.
    </p>
  );
}

function SignedOut() {
  const providers = useAccount((s) => s.providers);
  return (
    <div className="account-panel">
      <p className="account-lead">Sign in to keep your models online, open them on any computer, and share them in the gallery.</p>
      {providers.length === 0 ? (
        <p className="account-note">Signing in is not set up on this site.</p>
      ) : (
        <div className="account-providers">
          {providers.map((provider) => (
            <button key={provider} type="button" className="btn btn-outline" onClick={() => signIn(provider)}>
              <Icon name="user" size={16} />
              {PROVIDER_LABELS[provider]}
            </button>
          ))}
        </div>
      )}
      <Privacy />
    </div>
  );
}

function SignedIn({ name, banned }: { readonly name: string; readonly banned: boolean }) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const changed = draft.trim() !== '' && draft.trim() !== name;

  const save = async (): Promise<void> => {
    setBusy(true);
    await renameAccount(draft);
    setBusy(false);
  };

  return (
    <div className="account-panel">
      {banned && <p className="account-note is-warning">A moderator has stopped this account saving, publishing and reporting models. You can still open and delete them.</p>}
      <form
        className="account-name"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) void save();
        }}
      >
        <label htmlFor="account-name">Your name in the gallery</label>
        <div className="account-name-row">
          <input id="account-name" value={draft} maxLength={MAX_DISPLAY_NAME} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="btn btn-outline" disabled={!changed || busy}>
            Save name
          </button>
        </div>
      </form>
      <Privacy />
    </div>
  );
}

/** Signing in, or the signed-in account: its name, signing out and deleting it. */
export function AccountDialog() {
  const isOpen = useEditor((s) => s.dialog === 'account');
  const close = useEditor((s) => s.closeDialog);
  const user = useAccount((s) => s.user);

  const footer = user ? (
    <>
      <button type="button" className="btn btn-danger" onClick={() => void deleteAccount()}>
        <Icon name="trash" size={16} />
        Delete account…
      </button>
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => {
          void signOut();
          close('account');
        }}
      >
        <Icon name="signOut" size={16} />
        Sign out
      </button>
    </>
  ) : undefined;

  return (
    <Dialog id="account" title={user ? 'Your account' : 'Sign in'} open={isOpen} onClose={() => close('account')} footer={footer}>
      {user ? <SignedIn key={user.name} name={user.name} banned={user.banned} /> : <SignedOut />}
    </Dialog>
  );
}
