'use strict';
const {createInterface}=require('node:readline');
const {VisualTestBridge}=require('./bridge.cjs');
// stdin/stdout NDJSON only. There is no listener, no implicit grant or automatic launch.
const bridge=new VisualTestBridge({artifactsDir:process.env.ORDAX_VISUAL_ARTIFACTS});
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
let chain=Promise.resolve();
rl.on('line',line=>{
  chain=chain.then(async()=>{
    let request,id=null;
    try{
      if(line.length>16000)throw Error('Request exceeds bridge limit');
      request=JSON.parse(line);id=request.id??null;
      const result=await bridge.execute(request);
      process.stdout.write(JSON.stringify({id,ok:true,result})+'\n');
    }catch(error){process.stdout.write(JSON.stringify({id,ok:false,error:String(error.message).slice(0,500)})+'\n');}
  });
});
rl.on('close',()=>{
  chain.then(()=>bridge.close()).catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
});
process.on('SIGINT',()=>{rl.close();});
