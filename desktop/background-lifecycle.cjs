'use strict';
// Windows Desktop shell presentation lifecycle; the ONE existing Native Host
// continues owning MCP, Aura and the Surface while its window is hidden.
// This is not a service manager, new agent, model runner or permission owner.
function createDesktopBackgroundLifecycle({
  Tray,Menu,icon,window,canContinue,requestQuit,log=()=>{},
}={}){
  if(typeof Tray!=='function'||typeof Menu?.buildFromTemplate!=='function'||
     typeof window?.hide!=='function'||typeof window?.show!=='function'||
     typeof window?.isDestroyed!=='function'||typeof canContinue!=='function'||
     typeof requestQuit!=='function'||typeof log!=='function'||
     !icon||typeof icon.isEmpty!=='function'||icon.isEmpty())
    throw new TypeError('Desktop background lifecycle requires a valid Windows tray and one owning window');

  let disposed=false;
  const tray=new Tray(icon);
  const show=()=>{
    if(disposed||window.isDestroyed())return false;
    if(window.isMinimized?.())window.restore();
    if(!window.isVisible?.())window.show();
    window.focus();
    return true;
  };
  const quit=()=>{
    if(disposed)return;
    requestQuit();
  };
  try{
    tray.setToolTip('OrdaX Desktop — MCP e Aura');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'Abrir OrdaX',click:show},
      {type:'separator'},
      {label:'Encerrar OrdaX',click:quit},
    ]));
    tray.on('double-click',show);
    tray.on('click',show);
  }catch(error){
    // A half-initialized icon must not leave an inaccessible background host.
    try{tray.destroy()}catch{}
    throw error;
  }

  const close=(event)=>{
    if(disposed||!canContinue()||window.isDestroyed())return false;
    // Keep the existing renderer and Native peer transport alive; destroying
    // the window would invalidate Surface grants and kill the Product child.
    if(typeof event?.preventDefault!=='function')return false;
    event.preventDefault();
    window.hide();
    log('Desktop window hidden in tray; OS Native, Aura and MCP remain owned by one process');
    return true;
  };
  const dispose=()=>{
    if(disposed)return;
    disposed=true;
    tray.removeListener('double-click',show);
    tray.removeListener('click',show);
    tray.destroy();
  };
  return Object.freeze({close,show,dispose});
}
module.exports={createDesktopBackgroundLifecycle};
