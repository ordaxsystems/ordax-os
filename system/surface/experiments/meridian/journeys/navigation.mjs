/**
 * Pure storyboard navigation for the design lab. These states describe screens,
 * not jobs, accounts, permissions or a domain API. Definitions are injected by
 * the preview composition. Closing a view pauses it; reloading clears it.
 */
export function newStoryboard(definition, entity = '') {
 return {entity, step:definition.start, trail:[], fields:{}, receipt:null, visited:[definition.start], revision:0};
}
export function moveStoryboard(definition, state, target) {
 const screen = definition.screens[state.step];
 if (!screen || !definition.screens[target]) return state;
 const allowed = [screen.next, ...(screen.actions ?? []).map(item=>item.target), ...(screen.conditions ?? []).map(item=>item.target)];
 if (!allowed.includes(target)) return state;
 if (screen.confirm && target === screen.next && state.fields[`confirm:${state.step}`] !== true) return state;
 return {...state,fields:{...state.fields,['confirm:'+target]:false},step:target,receipt:definition.screens[target].result??state.receipt,trail:[...state.trail,state.step],visited:[...new Set([...state.visited,target])],revision:state.revision+1};
}
export function previousStoryboard(state) {
 if (!state.trail.length) return state;
 return {...state,step:state.trail.at(-1),trail:state.trail.slice(0,-1),revision:state.revision+1};
}
export function storyboardKey(kind, subject, space, entity) {
 return JSON.stringify([subject,space,kind,entity]);
}
