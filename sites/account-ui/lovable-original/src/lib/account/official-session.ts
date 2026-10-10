import { useEffect, useState } from 'react';

export type OfficialAccountSession =
  | { status: 'checking' }
  | { status: 'authenticated'; email: string | null }
  | { status: 'anonymous' }
  | { status: 'unavailable' };

/** Presentation adapter ONLY. /auth/session and cookies belong to the OrdaX OS owner. */
export function useOfficialAccountSession(): OfficialAccountSession {
  const [session, setSession] = useState<OfficialAccountSession>({ status: 'checking' });
  useEffect(() => {
    const abort = new AbortController();
    fetch('/auth/session', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error('session-unavailable'); return response.json(); })
      .then(value => {
        if (abort.signal.aborted) return;
        if (!value || typeof value !== 'object' || typeof value.authenticated !== 'boolean') {
          throw new Error('invalid-session-schema');
        }
        if (!value.authenticated) { setSession({ status: 'anonymous' }); return; }
        const email = typeof value.email === 'string' && value.email.length <= 254 ? value.email : null;
        setSession({ status: 'authenticated', email });
      })
      .catch(() => { if (!abort.signal.aborted) setSession({ status: 'unavailable' }); });
    return () => { abort.abort(); setSession({ status: 'checking' }); };
  }, []);
  return session;
}
