importScripts('./wasm_exec.js?v=0c949f4996f9');
let ready=false,paused=false,speed=1;
const command=c=>JSON.parse(self.labCommand(JSON.stringify(c)));
function send(c={type:'snapshot'}){const data=command(c);if(data.error)postMessage({type:'error',message:data.error});else postMessage({type:'snapshot',data,paused,speed});}
onmessage=({data})=>{if(!ready)return;if(data.type==='pause')paused=!paused;else if(data.type==='speed')speed=data.value;else if(data.type==='step'){paused=true;send({type:'advance',ms:1000});return;}else {send(data);return;}send();};
(async()=>{try{const go=new Go();const response=await fetch('./core.wasm?v=8aacca0a4395');if(!response.ok)throw new Error('Failed to load core.wasm');const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),go.importObject);go.run(instance);ready=true;send();setInterval(()=>{send(paused?{type:'snapshot'}:{type:'advance',ms:100*speed});},100);}catch(e){postMessage({type:'error',message:e.message});}})();
