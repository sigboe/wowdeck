exec(open('/home/deck/homebrew/data/wowdeck/hardware-116-pass2/engine.py').read().split('try:\n print(')[0])
try:
 a='830cb200025c';b='c19d0e9c7bc4'
 rpc('wtf.copy',{'installationId':a,'sourceFlavor':'_classic_era_','sourceInstallationId':b});time.sleep(2)
 print('COPY_BYTES', (r/'A/_retail_/WTF/Config.wtf').read_text(),(r/'A/_retail_/WTF/Account/FIXTURE/SavedVariables/Fixture.lua').read_text(),flush=True)
 rpc('wtf.list',{'installationId':a});rpc('wtf.copySources',{'installationId':a})
finally:
 p.stdin.close();p.wait(timeout=3);err.close()
