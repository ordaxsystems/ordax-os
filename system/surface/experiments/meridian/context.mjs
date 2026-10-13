/** Read-only selectors over the injected presentation snapshot; no authority or cache. */
export function currentContext(data){
 const space=data.spaces.find(item=>item.id===data.activeSpace)??data.spaces[0];
 const projects=data.projects.filter(item=>item.space===space.id);
 const files=data.files.filter(item=>item.space===space.id);
 return {space,projects,files,project:projects[0]??null};
}
