import json,os,subprocess,time,urllib.request,urllib.error,zipfile,socket,tempfile,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
archive=root/'exports/Rudra24-AI-Dad-API-Fixed-2026-10-14.zip'
if len(sys.argv)>1:
    app=Path(sys.argv[1]).resolve()
    print('Existing extracted-folder diagnostic; not a cold-install check',flush=True)
else:
    destination=Path(tempfile.mkdtemp(prefix='Dad fresh install ',dir=root/'work'))
    with zipfile.ZipFile(archive) as package:
        # Extraction validates every entry CRC while reading its complete bytes.
        package.extractall(destination)
    app=destination/'Rudra24 AI-Leads'
    print('ZIP CRC/extraction complete; starting bundled runtime',flush=True)
def port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
engine,ui=port(),port()
environment=dict(os.environ,CLAVIS_UI_PORT=str(ui),CLAVIS_ENGINE_PORT=str(engine),CLAVIS_WARM_KOKORO='false')
environment.pop('PYTHONPATH',None);environment.pop('VIRTUAL_ENV',None)
logs=app/'logs';logs.mkdir(exist_ok=True)
processes=[]
try:
    with (logs/'clean-api-test.log').open('wb') as log:
        processes.append(subprocess.Popen(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(app/'scripts/start-backend.ps1'),'-Port',str(engine)],cwd=app,env=environment,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW))
        processes.append(subprocess.Popen([str(app/'runtime/node/node.exe'),str(app/'serve-clavis.js')],cwd=app,env=environment,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW))
        health=None
        started=time.monotonic()
        # Cold Windows imports are scanned on first launch; match the launcher's readiness budget.
        for _ in range(600):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{ui}/health',timeout=2) as response:health=json.load(response)
                if health.get('status')=='healthy' and health.get('services',{}).get('db')=='ok':break
            except (OSError,ValueError):pass
            time.sleep(.5)
        assert health and health.get('status')=='healthy' and health['services']['db']=='ok','Fresh bundled engine did not start; inspect test log'
        print(f'Bundled engine/database ready after {time.monotonic()-started:.1f}s',flush=True)
        request=urllib.request.Request(f'http://127.0.0.1:{ui}/api/credentials',data=b'{"provider":"groq","secret":"test-only-not-a-key"}',method='PUT',headers={'Content-Type':'application/json','Authorization':'Bearer invalid-test-token'})
        try:urllib.request.urlopen(request,timeout=5);raise AssertionError('Unauthenticated save accepted')
        except urllib.error.HTTPError as response:assert response.code==401,response.code
        with urllib.request.urlopen(f'http://127.0.0.1:{ui}/desktop-config.js',timeout=5) as response:assert b'CLAVIS_LOCAL_ENGINE_PROXY=true' in response.read()
        assert not (app/'backend/.venv312').exists(),'Bundled runtime should not need a venv install'
        print('PASS extracted package: portable Node/Python startup, database health, same-origin API 401 and runtime marker; no dependency download')
finally:
    for process in reversed(processes):
        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        process.wait(timeout=10)
