export type LiveConnectionState='idle'|'connecting'|'open'|'stale'|'closed';
export type LiveEnvelope={type?:string;updateType?:string;topic?:string;sequence?:number;timestamp?:string;[key:string]:unknown};
export type LiveClientState={state:LiveConnectionState;connectedAt:number|null;lastMessageAt:number|null;lastSequence:number|null;reconnects:number;missedSequences:number};

type Listener=(payload:LiveEnvelope)=>void;
const listeners=new Map<string,Set<Listener>>();
const stateListeners=new Set<(state:LiveClientState)=>void>();
let socket:WebSocket|null=null,retry=0,stopped=false,heartbeatTimer:number|null=null,reconnectTimer:number|null=null;
let state:LiveClientState={state:'idle',connectedAt:null,lastMessageAt:null,lastSequence:null,reconnects:0,missedSequences:0};
const HEARTBEAT_MS=20_000,STALE_MS=45_000;
const emitState=()=>{const snapshot={...state};for(const fn of stateListeners)fn(snapshot);};
const setState=(next:Partial<LiveClientState>)=>{state={...state,...next};emitState();};
const emit=(topic:string,payload:LiveEnvelope)=>{for(const key of new Set([topic,'*']))for(const fn of listeners.get(key)||[])fn(payload);};
const jitter=(ms:number)=>Math.round(ms*(.8+Math.random()*.4));

function scheduleHeartbeat(){if(heartbeatTimer!==null)clearInterval(heartbeatTimer);heartbeatTimer=window.setInterval(()=>{if(!socket||socket.readyState!==WebSocket.OPEN)return;const age=state.lastMessageAt?Date.now()-state.lastMessageAt:Infinity;if(age>STALE_MS)setState({state:'stale'});try{socket.send(JSON.stringify({type:'ping',timestamp:new Date().toISOString()}));}catch{}},HEARTBEAT_MS);}
function scheduleReconnect(){if(stopped)return;if(reconnectTimer!==null)clearTimeout(reconnectTimer);retry+=1;setState({state:'closed',reconnects:state.reconnects+1});const delay=jitter(Math.min(30_000,1000*(2**Math.min(retry,5))));reconnectTimer=window.setTimeout(connect,delay);}
function onEnvelope(payload:LiveEnvelope){const sequence=Number(payload.sequence);if(Number.isInteger(sequence)){if(state.lastSequence!=null&&sequence>state.lastSequence+1)setState({missedSequences:state.missedSequences+(sequence-state.lastSequence-1)});state.lastSequence=sequence;}setState({lastMessageAt:Date.now(),state:'open'});const topic=String(payload.topic||payload.updateType||payload.type||'message');emit(topic,payload);if(payload.type==='google-cloud-update')emit('google-cloud-update',payload);}
export function connectLive(){if(stopped||typeof window==='undefined'||socket?.readyState===WebSocket.OPEN||socket?.readyState===WebSocket.CONNECTING)return;setState({state:'connecting'});const protocol=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(`${protocol}//${location.host}/api/live`);socket.onopen=()=>{retry=0;setState({state:'open',connectedAt:Date.now(),lastMessageAt:Date.now()});scheduleHeartbeat();};socket.onmessage=event=>{try{onEnvelope(JSON.parse(String(event.data)) as LiveEnvelope);}catch{}};socket.onerror=()=>socket?.close();socket.onclose=scheduleReconnect;}
export function stopLive(){stopped=true;if(heartbeatTimer!==null)clearInterval(heartbeatTimer);if(reconnectTimer!==null)clearTimeout(reconnectTimer);socket?.close(1000,'Client stopping');socket=null;setState({state:'closed'});}
export function subscribeLive(topic:string,listener:Listener){const set=listeners.get(topic)||new Set<Listener>();set.add(listener);listeners.set(topic,set);return()=>{set.delete(listener);if(!set.size)listeners.delete(topic);};}
export function subscribeLiveState(listener:(state:LiveClientState)=>void){stateListeners.add(listener);listener({...state});return()=>stateListeners.delete(listener);}
export function liveState(){return{...state};}
