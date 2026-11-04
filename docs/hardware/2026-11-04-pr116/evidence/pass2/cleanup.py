import pathlib,json,shutil
r=pathlib.Path('/home/deck/homebrew/data/wowdeck/hardware-116-pass2');data=r.parent
before=json.loads((data/'test-backups/2026-11-04-170719-931492/state.json').read_text());after=json.loads((data/'state.json').read_text())
print('original addon IDs retained', {a['id'] for a in before['addons']}.issubset({a['id'] for a in after['addons']}))
print('installation IDs restored', {i['id'] for i in before['installations']}=={i['id'] for i in after['installations']})
for k in ['selectedInstallationId','wtfBackupDir','wtfKeepSnapshots','autoUpdate']:print(k,before['settings'].get(k)==after['settings'].get(k))
print('remaining transaction markers',len(after.get('addonTransactions',[])))
root=pathlib.Path(before['settings']['wtfBackupDir'])
for flavor,name in [('_retail_','wtf_1793813200244.zip'),('_retail_','wtf_1793813046923.zip'),('_classic_era_','wtf_1793813200179.zip')]:print('test backup absent',name,not(root/flavor/name).exists())
shutil.rmtree(r);print('fixture root removed',not r.exists())
