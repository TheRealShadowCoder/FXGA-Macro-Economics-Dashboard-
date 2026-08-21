import { connectLive, stopLive, subscribeLive } from './lib/live-client';

let timer:number|null=null;
let lastRefresh=0;

function publishUpdate(detail:unknown){
  window.dispatchEvent(new CustomEvent('fxga:live-update',{detail}));
}

function compatibilityRefresh(){
  const now=Date.now();
  if(now-lastRefresh<1200)return;
  lastRefresh=now;
  if(timer!==null)clearTimeout(timer);
  timer=window.setTimeout(()=>{
    publishUpdate({type:'compatibility-refresh'});
    // Temporary bridge for legacy views. New views should subscribe to fxga:live-update
    // and invalidate their own state rather than relying on a synthetic click.
    const button=document.querySelector<HTMLButtonElement>('button.refresh');
    if(button&&!button.disabled)button.click();
  },250);
}

if(typeof window!=='undefined'){
  subscribeLive('google-cloud-update',payload=>{
    publishUpdate(payload);
    compatibilityRefresh();
  });
  connectLive();
  window.addEventListener('beforeunload',()=>{
    if(timer!==null)clearTimeout(timer);
    stopLive();
  },{once:true});
}
