#!/usr/bin/env python3
"""Pack the static app, Go runtime and WASM into one offline HTML file."""
from pathlib import Path
import base64
import json
import hashlib
import re

root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
# Version the whole dependency chain, including worker-loaded WASM/runtime.
worker_source = (dist / 'worker.js').read_text()
for name in ('core.wasm', 'wasm_exec.js'):
    version = hashlib.sha256((dist / name).read_bytes()).hexdigest()[:12]
    worker_source = re.sub(r'\./' + re.escape(name) + r'(?:\?v=[a-f0-9]+)?', './' + name + '?v=' + version, worker_source)
(dist / 'worker.js').write_text(worker_source)
worker_version = hashlib.sha256(worker_source.encode()).hexdigest()[:12]
app_source = re.sub(r"new Worker\('\./worker\.js(?:\?v=[a-f0-9]+)?'\)", "new Worker('./worker.js?v=" + worker_version + "')", (dist / 'app.js').read_text())
(dist / 'app.js').write_text(app_source)
# Version entry assets so browser caches cannot retain a previous deployment.
index = (dist / 'index.html').read_text()
for name in ('app.js', 'style.css', 'i18n.js'):
    version = hashlib.sha256((dist / name).read_bytes()).hexdigest()[:12]
    index = re.sub(r'(["\'])' + re.escape(name) + r'(?:\?[^"\']*)?\1',
                   lambda m: m[1] + name + '?v=' + version + m[1], index)
(dist / 'index.html').write_text(index)
wasm = base64.b64encode((dist / 'core.wasm').read_bytes()).decode('ascii')
worker = re.sub(r'\?v=[a-f0-9]+', '', worker_source).replace("importScripts('./wasm_exec.js');", (dist / 'wasm_exec.js').read_text())
worker = worker.replace("const response=await fetch('./core.wasm');if(!response.ok)throw new Error('Failed to load core.wasm');const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),go.importObject);", "const binary=Uint8Array.from(atob(" + json.dumps(wasm) + "),c=>c.charCodeAt(0));const {instance}=await WebAssembly.instantiate(binary,go.importObject);")
bootstrap = 'window.LAB_WORKER_URL=URL.createObjectURL(new Blob([' + json.dumps(worker, ensure_ascii=False).replace('</', '<\\/') + '],{type:"text/javascript"}));'
app = re.sub(r"new Worker\('\./worker\.js(?:\?v=[a-f0-9]+)?'\)", "new Worker(window.LAB_WORKER_URL || './worker.js')", app_source).replace('</script', '<\\/script')
html = re.sub(r'<link rel="stylesheet" href="style\.css(?:\?[^"]*)?">', lambda _: '<style>' + (dist / 'style.css').read_text() + '</style>', index)
html = re.sub(r'<script src="i18n\.js(?:\?[^"]*)?"></script>', lambda _: '<script>' + (dist / 'i18n.js').read_text().replace('</script', '<\\/script') + '</script>', html)
html = re.sub(r'<script type="module" src="app\.js(?:\?[^"]*)?"></script>', lambda _: '<script>' + bootstrap + '</script><script type="module">' + app + '</script>', html)
(dist / 'standalone.html').write_text(html)
print('Created dist/standalone.html (offline, includes WASM)')
