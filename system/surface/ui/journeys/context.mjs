/** Read-only selectors over the injected presentation snapshot; no authority or cache. */
export function currentContext(data){
 const space=data.spaces.find(item=>item.id===data.activeSpace)??{id:null,name:'Escolha um Space',icon:'spaces',tone:'slate',profile:'Contexto indisponível',modules:[]};
 const projects=data.projects.filter(item=>item.space===space.id);
 const files=data.files.filter(item=>item.space===space.id);
 return {space,projects,files,project:projects[0]??null};
}

// Foreground is presentation state, never a capability or authorization.
export function foregroundWindow(ui){
 if(ui.presentation!=='desktop')return null;
 return ui.windows.find(win=>win.id===ui.activeWindow&&!win.minimized&&!(win.mode==='compact'&&ui.compactCollapsed))??null;
}
