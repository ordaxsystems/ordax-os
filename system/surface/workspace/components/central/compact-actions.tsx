import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { DesktopAction } from './desktop-state';
import type { WindowControl } from './window-layer';

type Props = {
  title: string;
  controls: readonly WindowControl[];
  onAction: (action: DesktopAction) => void;
};

// Presentation only: the existing WindowLayer owns controls, focus and dispatch.
export function CompactActions({ title, controls, onAction }: Props) {
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={'Mais ações de ' + title} title="Mais ações"><MoreHorizontal/></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={6} className="compact-actions-menu">{controls.map(control => <DropdownMenuItem key={control.label} onClick={() => onAction(control.action)}><control.icon/>{control.title}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>;
}
