// Explicit demo composition. This is the only entry point that imports fixtures.
const root=document.getElementById('meridian');
try {
 const [{mountMeridianExperience},{createMeridianDemoSource},lab]=await Promise.all([
  import('/system/surface/experiments/meridian/experience.mjs'),
  import('/system/surface/experiments/meridian/demo/source.mjs'),
  import('/system/surface/experiments/meridian/demo/storyboards.mjs'),
 ]);
 const source=createMeridianDemoSource();
 const params=new URLSearchParams(location.search);
 const experience=mountMeridianExperience(root,source,{presentation:params.get('surface'),material:params.get('material'),route:params.get('area'),journey:params.get('journey'),step:params.get('step'),review:params.get('review')==='1',lab});
 window.addEventListener('pagehide',()=>{experience.destroy();source.destroy();},{once:true});
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
} catch(error) {
 root.replaceChildren();
 const message=document.createElement('div');message.className='preview-start';
 const title=document.createElement('h1');title.textContent='Não foi possível abrir o OrdaX.';
 const detail=document.createElement('p');detail.textContent='Confira sua conexão e tente novamente.';
 const reload=document.createElement('a');reload.href='/';reload.textContent='Tentar novamente';
 message.append(title,detail,reload);root.append(message);
 console.error('Meridian preview could not mount.',error);
}
