import pathlib,zipfile
r=pathlib.Path('/home/deck/homebrew/data/wowdeck/hardware-116-pass2');r.mkdir(exist_ok=True)
for n,f in [('A','_retail_'),('B','_classic_era_')]:
 p=r/n/f;(p/'Interface/AddOns').mkdir(parents=True,exist_ok=True);(p/'Data').mkdir();(p/'WTF/Account/FIXTURE/SavedVariables').mkdir(parents=True);(p/'WTF/Config.wtf').write_text('SET fixture "'+n+'"\n');(p/'WTF/Account/FIXTURE/SavedVariables/Fixture.lua').write_text('-- '+n+' data only\n')
with zipfile.ZipFile(r/'valid.zip','w') as z:z.writestr('Hardware116/Hardware116.toc','## Title: Hardware 116\n## Version: 1\n');z.writestr('Hardware116/core.lua','-- fixture\n')
print(r)
