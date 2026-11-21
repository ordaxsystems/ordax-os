import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Layers3 } from 'lucide-react';
import { deriveAuthorizedSpaces } from '../../../../services/spaces/authorized-view.mjs';
import { meridianHomeContextKey } from '../../../ui/meridian-home-context.mjs';
import { useWebAccount } from './account-context';

// Navigation context only: the Account-owned selection runtime validates the
// current subject and catalog. No local persistence or permission grant.
export function HomeSpacePicker({ onManage }: { onManage: () => void }) {
  const { session, identity, authorized, offline } = useWebAccount();
  const selectId = useId();
  const [error, setError] = useState<string | null>(null);
  const active = authorized.activeSpace;
  const choices = authorized.ready
    ? authorized.visibleSpaces.filter(space => space.state === 'active') : [];

  useEffect(() => { setError(null); }, [identity.state, identity.subjectId, active?.id, offline]);

  function choose(spaceId: string) {
    setError(null);
    // Verify again at the click boundary; UI renders can precede revocation.
    if (session.surface.getSnapshot().connectivity === 'offline') {
      setError('Reconecte para selecionar um Space.');
      return;
    }
    const liveIdentity = session.identity.getSnapshot();
    const live = deriveAuthorizedSpaces(
      liveIdentity, session.spaces.getSnapshot(), session.selection.getSnapshot(),
    );
    // A queued change from an old render must not select or clear a Space in
    // a different account or previously selected Space. The same canonical
    // context key already scopes the entire Web workspace.
    if (!live.ready || !authorized.ready
      || meridianHomeContextKey(liveIdentity, live.activeSpace)
        !== meridianHomeContextKey(identity, active)) {
      setError('O contexto da conta mudou. Atualize seus Spaces para continuar.');
      return;
    }
    try {
      if (spaceId === '') session.selection.clear();
      else {
        const liveSpaces: typeof authorized.visibleSpaces = live.visibleSpaces;
        const match = liveSpaces.find(space => space.id === spaceId && space.state === 'active');
        if (!match) throw new Error('Space no longer authorized');
        session.selection.select(match.id);
      }
    } catch {
      setError('Não foi possível selecionar este Space. Consulte seus Spaces e tente novamente.');
    }
  }

  return <div className="meridian-context meridian-home-space-picker" aria-label="Contexto autorizado desta sessão">
    <Layers3 aria-hidden="true"/>
    <div className="meridian-home-space-picker-body">
      <label htmlFor={selectId}>SEU CONTEXTO</label>
      <select id={selectId} value={active?.id ?? ''} disabled={offline || !authorized.ready || choices.length === 0} onChange={event => choose(event.currentTarget.value)} aria-label="Selecionar Space autorizado">
        <option value="">{offline ? 'Sem conexão' : authorized.ready ? 'Escolher um Space' : 'Consultando Spaces'}</option>
        {choices.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
      </select>
      <small>Seleção nesta página; recarregar exige escolher novamente.</small>
      {error && <small role="alert" className="meridian-home-space-picker-error">{error}</small>}
    </div>
    <button type="button" onClick={onManage} title="Gerenciar meus Spaces" aria-label="Gerenciar meus Spaces"><ArrowUpRight size={17}/></button>
  </div>;
}
