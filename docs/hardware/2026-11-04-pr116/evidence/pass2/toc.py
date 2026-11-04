exec(open('/home/deck/homebrew/data/wowdeck/hardware-116-pass2/engine.py').read().split('try:\n print(')[0])

try:
 for name,files in {
 'flavor':{'Foo/Foo.toc':'## Title: Generic\n## Version: 1\n','Foo/Foo-Mainline.toc':'## Title: Mainline\n## Version: 2\n'},
 'other':{'Other/Other-Classic.toc':'## Title: Other Classic\n'},
 'tocdir':{'Dir/Dir.toc/readme.txt':'not a file'},
 'order':{'Zeta/Zeta.toc':'## Title: Zeta\n','Alpha/Alpha.toc':'## Title: Alpha\n'}
 }.items():
  with zipfile.ZipFile(r/(name+'.zip'),'w') as z:
   for path,data in files.items():z.writestr(path,data)
  rpc('addons.inspectArchive',{'path':str(r/(name+'.zip'))})
finally:
 p.stdin.close();p.wait(timeout=3);err.close()
