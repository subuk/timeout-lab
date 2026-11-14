importScripts('./wasm_exec.js?v=0c949f4996f9');
let ready=false,paused=false,speed=1;
const command=c=>JSON.parse(self.labCommand(JSON.stringify(c)));
let autoPause=false;
function send(c={type:'snapshot'}){
 const data=command(c);
 if(data.error){postMessage({type:'error',message:data.error,requestId:c.requestId});return;}
 if(c.type==='mode'){paused=true;autoPause=false;}
 if(c.type==='request'){paused=false;autoPause=true;}
 if((c.type==='reset'||c.type==='preset')&&data.manualMode){paused=true;autoPause=false;}
 if(autoPause&&!data.focusRunning){paused=true;autoPause=false;}
 postMessage({type:'snapshot',data,paused,speed,requestId:c.requestId});
}
onmessage=({data})=>{
 if(!ready)return;
 if(data.type==='pause')paused=!paused;
 else if(data.type==='speed')speed=data.value;
 else if(data.type==='step'){paused=true;send({type:'advance',ms:data.ms||1000});return;}
 else {send(data);return;}
 send();
};
(async()=>{try{const go=new Go();const response=await fetch('./core.wasm?v=321277784dd9');if(!response.ok)throw new Error('Failed to load core.wasm');const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),go.importObject);go.run(instance);ready=true;send();setInterval(()=>{send(paused?{type:'snapshot'}:{type:'advance',ms:100*speed});},100);}catch(e){postMessage({type:'error',message:e.message});}})();
