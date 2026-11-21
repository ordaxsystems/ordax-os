import type { Dispatch } from 'react';
import { Maximize2, Minus, PanelsTopLeft, Expand, X, MoveUpRight } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { WindowState, WindowAction } from '@/lib/web/windows';
export function WindowMenu({ win, dispatch }: { win: WindowState; dispatch: Dispatch<WindowAction> }) {
 return <><DropdownMenuItem onSelect={() => dispatch({ type: 'restore', appId: win.appId })}><MoveUpRight/>Restaurar</DropdownMenuItem><DropdownMenuItem onSelect={() => dispatch({ type: 'compact', appId: win.appId })}><PanelsTopLeft/>Modo compacto</DropdownMenuItem><DropdownMenuItem onSelect={() => dispatch({ type: 'maximize', appId: win.appId })}><Maximize2/>{win.mode === 'maximized' ? 'Retornar ao modo anterior' : 'Maximizar'}</DropdownMenuItem><DropdownMenuItem onSelect={() => dispatch({ type: 'minimize', appId: win.appId })}><Minus/>Minimizar</DropdownMenuItem><DropdownMenuItem onSelect={() => dispatch({ type: 'immersive', appId: win.appId })}><Expand/>{win.mode === 'immersive' ? 'Sair do modo imersivo' : 'Modo imersivo'}</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem onSelect={() => dispatch({ type: 'close', appId: win.appId })}><X/>Fechar</DropdownMenuItem></>;
}
