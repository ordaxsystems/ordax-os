import { Component, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AuraContent } from '../intelligence/aura-content';
import { DesktopContent } from './desktop';
import { WindowResourceLoadError } from './window-resource-error.mjs';

class WindowContentBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean; resourceFailed: boolean }
> {
  state = { failed: false, resourceFailed: false };
  static getDerivedStateFromError(error: unknown) { return { failed: true, resourceFailed: error instanceof WindowResourceLoadError }; }
  render() {
    if (this.state.failed) return <div role="alert">
      <h2>Não foi possível carregar este conteúdo.</h2>
      <p className="service-state">As outras janelas continuam disponíveis.</p>
      {this.state.resourceFailed
        ? <><p className="service-state">O navegador não conseguiu baixar os arquivos necessários. Recarregar a página pode perder rascunhos não salvos.</p><Button variant="outline" onClick={() => window.location.reload()}>Recarregar página</Button></>
        : <><p className="service-state">Tentar novamente reinicia apenas o conteúdo desta janela.</p><Button variant="outline" onClick={this.props.onRetry}>Tentar novamente</Button></>}
    </div>;
    return this.props.children;
  }
}

// Modes/view changes never remount content. Only explicit error recovery does.
export function WindowContent(props: ComponentProps<typeof DesktopContent>) {
  const [attempt, setAttempt] = useState(0);
  const content = props.title === 'Aura' || props.title === 'Inteligência'
    ? <AuraContent initialPrompt={props.initialPrompt}/>
    : <DesktopContent {...props}/>;
  return <WindowContentBoundary key={attempt} onRetry={() => setAttempt(previous => previous + 1)}>
    {content}
  </WindowContentBoundary>;
}
