/** Ephemeral pointer guidance, dock scrolling and motion in this study.
 * This helper never selects an app, changes foreground or dispatches to a source.
 */
export function windowAppearance(root){return new Map([...root.querySelectorAll('[data-window]')].map(node=>[node.dataset.window,node.classList.contains('is-compact')?'compact':node.classList.contains('is-expanded')?'expanded':'floating']));}
export function applyWindowAppearance(root,previous){
 for(const node of root.querySelectorAll('[data-window]')){
  const mode=node.classList.contains('is-compact')?'compact':node.classList.contains('is-expanded')?'expanded':'floating';
  const before=previous.get(node.dataset.window);
  if(!before)node.dataset.motion='enter';else if(before!==mode)node.dataset.motion='resize';
 }
}
export function createPresentationFeedback(root,signal){
 let dock=null,scrollLeft=0,scope='',active='',frame=0,hintTarget=null,dismissedTarget=null,dockWidth=0,keyboardTarget=null;
 const observer=new ResizeObserver(()=>{
  if(!dock?.isConnected)return;
  const width=dock.clientWidth;
  if(width!==dockWidth){
   const focused=dock.contains(document.activeElement)?document.activeElement.closest('.md-dock-app'):null;
   reveal(focused??dock.querySelector('.is-active'));
   dockWidth=width;
  }
  queue();
 });
 const tooltipSelector='.md-sidebar [data-tooltip], .md-taskbar [data-tooltip]';
 const hint=()=>root.querySelector('.md-pointer-hint');
 function hideHint(){hintTarget=null;const node=hint();if(node)node.hidden=true;}
 function showHint(target){
  const node=hint();if(!node||target===dismissedTarget||!target?.getClientRects().length||root.querySelector('dialog[open]'))return;
  hintTarget=target;node.textContent=target.dataset.tooltip;node.hidden=false;
  const box=target.getBoundingClientRect(),tip=node.getBoundingClientRect();
  const side=!!target.closest('.md-sidebar');
  const left=side?target.closest('.md-sidebar').getBoundingClientRect().right+10:box.left+(box.width-tip.width)/2;
  const top=side?box.top+(box.height-tip.height)/2:box.top-tip.height-12;
  node.style.left=Math.max(8,Math.min(innerWidth-tip.width-8,left))+'px';
  node.style.top=Math.max(8,Math.min(innerHeight-tip.height-8,top))+'px';
 }
 function measure(){
  if(!dock?.isConnected)return;
  scrollLeft=dock.scrollLeft;
  const start=scrollLeft>2,end=dock.scrollWidth-dock.clientWidth-scrollLeft>2;
  dock.closest('.md-dock-frame').dataset.overflow=start?(end?'both':'start'):(end?'end':'none');
 }
 function queue(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}
 function reveal(button){if(!dock?.isConnected||!button||!dock.contains(button))return;const a=dock.getBoundingClientRect(),b=button.getBoundingClientRect();if(b.left<a.left+12)dock.scrollLeft-=a.left+12-b.left;else if(b.right>a.right-12)dock.scrollLeft+=b.right-a.right+12;measure();}
 function refresh(){
  cancelAnimationFrame(frame);frame=0;hideHint();dismissedTarget=null;keyboardTarget=null;observer.disconnect();
  // The common hint owns these labels; native title would add a second tooltip.
  for(const target of root.querySelectorAll(tooltipSelector))target.removeAttribute('title');
  dock=root.querySelector('.md-dock');
  if(!dock){dockWidth=0;return;}
  const nextScope=[root.dataset.subject,root.dataset.space,root.dataset.presentation].join('/');
  const nextActive=dock.querySelector('.is-active')?.dataset.action??'';
  dock.scrollLeft=scope===nextScope?scrollLeft:0;
  if(nextActive!==active||scope!==nextScope)reveal(dock.querySelector('.is-active'));
  scope=nextScope;active=nextActive;observer.observe(dock);queue();
 }
 function releaseKeyboardScroll(){keyboardTarget=null;if(dock)dock.style.scrollSnapType='';}
 root.addEventListener('scroll',event=>{if(event.target===dock){
  // Native touch inertia can continue after a key event. Keep its newer focus
  // destination visible until another input takes control of scrolling.
  if(keyboardTarget===document.activeElement)reveal(keyboardTarget);
  measure();hideHint();
 }},{capture:true,signal});
 root.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const target=event.target.closest(tooltipSelector);if(target)showHint(target);},{signal});
 root.addEventListener('pointerout',event=>{
  if(hintTarget&&!hintTarget.contains(event.relatedTarget))hideHint();
  if(dismissedTarget?.contains(event.target)&&!dismissedTarget.contains(event.relatedTarget))dismissedTarget=null;
 },{signal});
 root.addEventListener('focusin',event=>{const target=event.target.closest(tooltipSelector);if(target){if(target.matches('.md-dock-app'))reveal(target);showHint(target);}},{signal});
 root.addEventListener('focusout',event=>{hideHint();if(dismissedTarget?.contains(event.target))dismissedTarget=null;if(keyboardTarget?.contains(event.target))releaseKeyboardScroll();},{signal});
 root.addEventListener('pointerdown',()=>{hideHint();releaseKeyboardScroll();},{signal});
 root.addEventListener('wheel',releaseKeyboardScroll,{passive:true,signal});
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&hint()?.hidden===false){dismissedTarget=hintTarget;hideHint();event.preventDefault();return;}
 },{signal});
 root.addEventListener('keydown',event=>{
  const button=event.target.closest('.md-dock-app');if(!dock||!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const buttons=[...dock.querySelectorAll('.md-dock-app')],index=buttons.indexOf(button);
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowLeft'?-1:1)));
  // A pending touch snap must not override a later keyboard destination.
  event.preventDefault();buttons[next].focus({preventScroll:true});keyboardTarget=buttons[next];dock.style.scrollSnapType='none';reveal(keyboardTarget);
 },{signal});
 signal.addEventListener('abort',()=>{cancelAnimationFrame(frame);observer.disconnect();hideHint();dismissedTarget=null;keyboardTarget=null;dock=null;},{once:true});
 return {refresh};
}
