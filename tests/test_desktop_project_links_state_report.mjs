import test from "node:test";
import assert from "node:assert/strict";
import {
  mountNativeDesktopSurfaceStateReport,
} from "../system/adapters/native/desktop-surface-state-report.mjs";

const projectId="33333333-3333-4333-8333-333333333333";
const spaceId="44444444-4444-4444-8444-444444444444";

test("Native Surface projects only durable explicit Project Catalog cloud links",async()=>{
  const posts=[];
  let timer=null,linkListener=null,unsubscribed=false;
  let snapshot={
    schema:"ordax.project-cloud-links/1",
    persistence:"device",
    links:[{
      localProjectId:"project-7",
      cloudProjectId:projectId,
      spaceId,
      linkedAt:1234,
    }],
  };
  const reader={
    schema:"ordax.project-cloud-links-reader/1",
    getSnapshot(){return snapshot},
    subscribe(listener){
      linkListener=listener;
      return ()=>{unsubscribed=true};
    },
  };
  const win={
    async fetch(path,opts){
      posts.push({path,body:JSON.parse(opts.body)});
      return {status:200};
    },
    setInterval(fn,ms){
      assert.equal(ms,5000);
      timer=fn;
      return 50;
    },
    clearInterval(id){assert.equal(id,50)},
  };
  const reporter=mountNativeDesktopSurfaceStateReport(
    win,
    {getActiveAppId:()=>"system",subscribeRender:()=>()=>{}},
    null,
    reader,
  );
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts.some(x=>x.path==="/__ordax/native/desktop-surface-state"),true);
  const initial=posts.find(x=>x.path==="/__ordax/native/desktop-project-links");
  assert.deepEqual(initial?.body,{
    schema:"ordax.desktop-project-links/1",
    persistence:"device",
    links:[{
      localProjectId:"project-7",
      cloudProjectId:projectId,
      spaceId,
    }],
  },"linkedAt and local filesystem metadata never cross the Runtime boundary");

  snapshot={
    schema:"ordax.project-cloud-links/1",
    persistence:"session",
    links:[{
      localProjectId:"project-7",
      cloudProjectId:projectId,
      spaceId,
      linkedAt:1234,
    }],
  };
  linkListener(snapshot);
  await new Promise(resolve=>setImmediate(resolve));
  const latest=posts.filter(x=>x.path==="/__ordax/native/desktop-project-links").at(-1);
  assert.deepEqual(latest.body,{
    schema:"ordax.desktop-project-links/1",
    persistence:"session",
    links:[],
  },"session fallback must withdraw rather than expose authority");

  const before=posts.length;
  timer();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(posts.length>before,"existing heartbeat timer refreshes both projections");
  reporter.dispose();
  assert.equal(unsubscribed,true);
});

test("Project Cloud Links reader must be the canonical read-only port",()=>{
  const win={fetch(){},setInterval(){return 1},clearInterval(){}};
  const lifecycle={getActiveAppId:()=>null,subscribeRender:()=>()=>{}};
  assert.throws(()=>mountNativeDesktopSurfaceStateReport(
    win,lifecycle,null,{schema:"fake",getSnapshot(){return{}},subscribe(){return()=>{}}},
  ));
  assert.throws(()=>mountNativeDesktopSurfaceStateReport(
    win,lifecycle,null,{
      schema:"ordax.project-cloud-links-reader/1",
      getSnapshot(){return {
        schema:"ordax.project-cloud-links/1",persistence:"device",links:[],
      }},
      subscribe(){return()=>{}},
      link(){},
    },
  ),/must not expose mutation authority/);
});
