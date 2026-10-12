import { useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { HOME_SHORTCUTS_PREFERENCE_ID, readFavoriteShortcutIds } from '../../../../services/preferences/home-shortcuts.mjs';
import { useWebPreferences } from './preferences-context';
import { favorites } from './config';
import { AppIcon, Panel } from './primitives';

// Both Home and the Apps window consume the same preference; no installed-app state.
export function FavoriteShortcutsPanel({ onOpen, className, showHelp = false }: { onOpen: (name: string) => void; className?: string; showHelp?: boolean }) {
  const { snapshot, persistence, setFavoriteShortcut } = useWebPreferences();
  const selected = new Set(readFavoriteShortcutIds(snapshot[HOME_SHORTCUTS_PREFERENCE_ID]));
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  function edit(button: HTMLButtonElement) { opener.current = button; setEditing(true); }
  return <><Panel className={className} title="Aplicativos favoritos" actionControl={<Button variant="ghost" className="panel-action" aria-label="Editar favoritos" onClick={event => edit(event.currentTarget)}><Pencil/>Editar</Button>}>
    {showHelp && <p className="service-state">Atalhos da interface. A disponibilidade de cada aplicativo depende do host conectado.</p>}
    {selected.size === 0 && <p className="service-state">Nenhum atalho favorito. Adicione os que você usa mais.</p>}
    <div className="favorite-grid">{favorites.filter(item => selected.has(item.id)).map(item => <Button variant="ghost" className="favorite-tile" key={item.id} onClick={() => onOpen(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></Button>)}<Button variant="ghost" className="favorite-tile" aria-label="Adicionar aos favoritos" onClick={event => edit(event.currentTarget)}><Plus className="size-6 text-muted-foreground"/><span>Adicionar</span></Button></div>
    {persistence === 'session-only' && <p className="service-state" role="status">O navegador não permitiu salvar. Suas escolhas valem apenas nesta sessão.</p>}
  </Panel><Dialog open={editing} onOpenChange={setEditing}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected && opener.current.getClientRects().length) opener.current.focus({ preventScroll: true }); }}><DialogHeader><DialogTitle>Atalhos favoritos</DialogTitle><DialogDescription>Escolha os atalhos da sua Central. Isso não instala aplicativos.</DialogDescription></DialogHeader>
    <div className="favorite-choices">{favorites.map(item => <label key={item.id} className="favorite-choice"><input type="checkbox" checked={selected.has(item.id)} onChange={event => setFavoriteShortcut(item.id, event.target.checked)}/><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></label>)}</div>
    <p className="service-state" role="status">{persistence === 'session-only' ? 'Não foi possível salvar neste navegador. As escolhas serão mantidas apenas nesta sessão.' : persistence === 'saved' ? 'Alterações salvas neste navegador.' : 'As escolhas são salvas neste navegador ao marcar ou desmarcar.'}</p>
    <Button onClick={() => setEditing(false)}>Concluir</Button>
  </DialogContent></Dialog></>;
}
