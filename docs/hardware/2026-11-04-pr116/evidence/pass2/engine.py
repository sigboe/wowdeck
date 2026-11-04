import pathlib,subprocess,os,json,select,time,zipfile,hashlib
r=pathlib.Path('/home/deck/homebrew/data/wowdeck/hardware-116-pass2'); (r/'home').mkdir(exist_ok=True);(r/'engine').mkdir(exist_ok=True)
env=dict(os.environ,HOME=str(r/'home'),WOWDECK_DATA_DIR=str(r/'engine'),WOWDECK_CHILD='1')
err=open(r/'engine.stderr','w');p=subprocess.Popen(['/home/deck/homebrew/plugins/wowdeck/bin/wowdeck-x86_64'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,env=env,text=True,bufsize=1)
seq=0
def rpc(m,a={}):
 global seq
 seq+=1;p.stdin.write(json.dumps(dict(id=seq,method=m,params=a))+'\n');p.stdin.flush();deadline=time.monotonic()+25
 while time.monotonic()<deadline:
  if not select.select([p.stdout],[],[],1)[0]:continue
  line=p.stdout.readline();v=json.loads(line)
  if v.get('id')==seq:
   print(json.dumps(dict(method=m,params=a,answer=v)),flush=True);return v.get('result',{})
 raise RuntimeError('timeout '+m)

try:
 print('EMPTY_SETUP',rpc('installations.list'),flush=True)
 rpc('settings.set',{'settings':{'autoUpdate':False,'checkOnStartup':False,'wtfBackupDir':str(r/'backups')}})
 ids=[]
 for path,ct in [('A/_retail_','retail'),('B/_classic_era_','classic_era')]:
  x=rpc('installations.add',{'path':str(r/path),'clientType':ct});ids.append(x['installations'][0]['id'])
 a,b=ids;rpc('installations.select',{'installationId':a})
 for name in ['rar5-addon.rar','addon.7z','symlink.7z','valid.zip']:
  rpc('addons.inspectArchive',{'path':str(r/name)})
  rpc('addons.install',{'providerId':'File','externalId':str(r/name)})
 rpc('wtf.create',{'installationId':b});time.sleep(1)
 lst=rpc('wtf.list',{'installationId':b});rpc('wtf.copySources',{'installationId':a})
 rpc('wtf.copy',{'installationId':a,'sourceFlavor':'classic_era','sourceInstallationId':b});time.sleep(2)
 print('COPY_BYTES', (r/'A/_retail_/WTF/Config.wtf').read_text(), (r/'A/_retail_/WTF/Account/FIXTURE/SavedVariables/Fixture.lua').read_text(),flush=True)
 rpc('wtf.list',{'installationId':a});rpc('wtf.copySources',{'installationId':a})
 rpc('wtf.import',{'installationId':a,'path':str(r/'upstream-wowup-backup.zip')});rpc('wtf.list',{'installationId':a})
 # Conflict restricted to disposable installation; never follows link to owner files.
 ap=r/'A/_retail_/Interface/AddOns'; import shutil
 shutil.rmtree(ap/'Hardware116');(r/'link-target').mkdir();(r/'link-target/sentinel').write_text('untouched')
 (ap/'Hardware116').symlink_to(r/'link-target',target_is_directory=True)
 rpc('addons.install',{'providerId':'File','externalId':str(r/'valid.zip')});print('LINK_SENTINEL',(r/'link-target/sentinel').read_text(),flush=True)
 (ap/'Hardware116').unlink();rpc('installations.recoveryStatus')
finally:
 p.stdin.close()
 try:p.wait(timeout=3)
 except subprocess.TimeoutExpired:p.terminate();p.wait(timeout=3)
 err.close()
