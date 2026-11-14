"""Package Vite output as an offline HTML document, including its classic Worker."""
from pathlib import Path
import base64
import hashlib
import json
import re
root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
index = (dist/'index.html').read_text()
worker = (dist/'worker.js').read_text()
# Version Worker dependencies for ordinary static hosting.
for name in ('core.wasm','wasm_exec.js'):
    digest=hashlib.sha256((dist/name).read_bytes()).hexdigest()[:12]
    worker=re.sub(r'\./'+re.escape(name)+r'(?:\?v=[a-f0-9]+)?', './'+name+'?v='+digest,worker)
(dist/'worker.js').write_text(worker)
worker_hash=hashlib.sha256(worker.encode()).hexdigest()[:12]
# A stable runtime URL is injected explicitly instead of rewriting application code.
bootstrap='<script>window.LAB_WORKER_URL="./worker.js?v='+worker_hash+'";</script>'
index=re.sub(r'<script>window.LAB_WORKER_URL=.*?</script>', '',index)
index=index.replace('</head>',bootstrap+'</head>')
(dist/'index.html').write_text(index)
offline=re.sub(r'\?v=[a-f0-9]+','',worker)
offline=re.sub(r'importScripts\(["\']\./wasm_exec.js["\']\);',lambda _: (dist/'wasm_exec.js').read_text(),offline)
wasm=base64.b64encode((dist/'core.wasm').read_bytes()).decode()
offline=re.sub(r'fetch\(["\']\./core.wasm["\']\)',lambda _: 'Promise.resolve({ok:true,arrayBuffer:async()=>Uint8Array.from(atob('+json.dumps(wasm)+'),c=>c.charCodeAt(0)).buffer})',offline)
if 'importScripts(' in offline or re.search(r'\bfetch\(',offline):
    raise RuntimeError('Offline worker still has external dependencies')
embedded='window.LAB_WORKER_URL=URL.createObjectURL(new Blob(['+json.dumps(offline).replace('</','<\\/')+'],{type:"text/javascript"}));'
html=index.replace(bootstrap,'<script>'+embedded+'</script>')
def asset(path):
    resolved=(dist/path.removeprefix('./')).resolve()
    if not resolved.is_relative_to(dist.resolve()): raise ValueError('Asset outside dist')
    return resolved.read_text()
html=re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>',lambda m:'<style>'+asset(m[1])+'</style>',html)
html=re.sub(r'<script\b[^>]*src="([^"]+)"[^>]*></script>',lambda m:'<script type="module">'+asset(m[1]).replace('</script','<\\/script')+'</script>',html)
if re.search(r'<(?:script|link)\b[^>]*(?:src|href)="\./assets/',html): raise RuntimeError('Unpacked frontend asset')
(dist/'standalone.html').write_text(html)
print('Created dist/standalone.html (offline, includes React and WASM)')
