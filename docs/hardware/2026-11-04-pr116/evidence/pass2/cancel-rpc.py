exec(open('/home/deck/homebrew/data/wowdeck/hardware-116-pass2/engine.py').read().split('try:\n print(')[0].replace("if v.get('id')==seq:", "if v.get('event'): print(json.dumps(v),flush=True)\n  if v.get('id')==seq:"))

try:
 a='830cb200025c';f=r/'A/_retail_/WTF/large-fixture.bin';f.write_bytes(b'fixture-data-only'*1024*1024)
 x=rpc('wtf.create',{'installationId':a});rpc('wtf.cancel',{'jobId':x['jobId']});time.sleep(1);rpc('wtf.list',{'installationId':a});f.unlink()
finally:
 p.stdin.close();p.wait(timeout=3);err.close()
