'use strict';
// Single owner for the Desktop read-only Native observation privacy boundary.
// Contracts/data providers remain in their existing canonical OS modules.
const { timingSafeEqual } = require('node:crypto');
const OBSERVATION_ROUTES=Object.freeze([
  '/__ordax/native/network-status',
  '/__ordax/native/metrics',
  '/__ordax/native/update',
  '/__ordax/native/update-history',
  '/__ordax/desktop/recovery',
  '/__ordax/native/power-status',
  '/__ordax/native/product-runtime-status',
]);
const routes=new Set(OBSERVATION_ROUTES);
const TOKEN=/^[0-9a-f]{64}$/;
const loopback=ip=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';

function createDesktopObservationGrantMiddleware({token}={}) {
  if(typeof token!=='string'||!TOKEN.test(token))
    throw TypeError('Native Desktop observation requires an independent Electron grant');
  const expected=Buffer.from(token,'hex');
  return function nativeObservationGrant(request,response,next){
    const path=String(request.url??'').split('?')[0];
    if(!routes.has(path))return next();
    const supplied=request.headers['x-ordax-observation-token'];
    const provided=typeof supplied==='string'&&TOKEN.test(supplied)
      ? Buffer.from(supplied,'hex') : null;
    const reply=(status)=>{
      response.writeHead(status,{
        'Content-Type':'application/json','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff',
      });
      response.end(JSON.stringify({error:'Native Desktop observation request denied'}));
    };
    if(!loopback(request.socket?.remoteAddress)||!provided||
       !timingSafeEqual(expected,provided))return reply(401);
    if(request.url!==path)return reply(400);
    if(request.method!=='GET')return reply(405);
    next();
  };
}
module.exports={OBSERVATION_ROUTES,createDesktopObservationGrantMiddleware};
