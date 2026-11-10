"""Build standalone device fixtures from the deterministic RPC tests, without bun:test."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
out = root / '.scratch/tsm-device'
out.mkdir(parents=True, exist_ok=True)
support = '''import { isDeepStrictEqual } from "node:util";
const cases: {name:string,run:()=>Promise<void>}[]=[];
export const test:any=(name:string,run:any)=>cases.push({name,run});
test.each=(rows:any[]) => (name:string,run:any)=>rows.forEach(row=>test(name+JSON.stringify(row),()=>run(...row)));
const partial=(a:any,b:any):boolean => b && typeof b==='object' ? (!Array.isArray(b)||Array.isArray(a)&&a.length===b.length) && Object.keys(b).every(k=>partial(a?.[k],b[k])) : isDeepStrictEqual(a,b);
export function expect(actual:any, neg=false):any {
 const check=(ok:boolean,label:string)=>{if(ok===neg)throw Error(label+" assertion failed");};
 return {
 get not(){return expect(actual,!neg)},
 get rejects(){return {async toThrow(message?:string){let error:any;try{await actual}catch(e){error=e}check(!!error && (!message || String(error).includes(message)),"rejects.toThrow")}}},
 toBe(v:any){check(Object.is(actual,v),"toBe")}, toEqual(v:any){check(isDeepStrictEqual(actual,v),"toEqual")},
 toMatchObject(v:any){check(partial(actual,v),"toMatchObject")},
 toContain(v:any){check(actual.includes(v),"toContain")},
 toContainEqual(v:any){check(actual.some((x:any)=>v?.__partial?partial(x,v.__partial):isDeepStrictEqual(x,v)),"toContainEqual")},
 toHaveLength(v:number){check(actual.length===v,"toHaveLength")},
 toBeNull(){check(actual===null,"toBeNull")},toBeUndefined(){check(actual===undefined,"toBeUndefined")},
 toBeDefined(){check(actual!==undefined,"toBeDefined")},toBeTruthy(){check(!!actual,"toBeTruthy")},
 toBeGreaterThan(v:number){check(actual>v,"toBeGreaterThan")},
 toThrow(message?:string){let e:any;try{actual()}catch(x){e=x}check(!!e&&(!message||String(e).includes(message)),"toThrow")}
 };
}
expect.objectContaining=(value:any)=>({__partial:value});
export async function run(){let failed=0;for(const c of cases){try{await c.run();console.log(JSON.stringify({result:"PASS",case:c.name}))}catch(e){failed++;console.error(JSON.stringify({result:"FAIL",case:c.name,error:String(e),stack:(e as Error).stack}))}}process.exit(failed?1:0)}
'''
(out/'support.ts').write_text(support)
files=[]
for name in ['addons','auction','classic','discovery']:
    source=(root/f'backend/tests/tsm-{name}-rpc.test.ts').read_text()
    source=source.replace('from "fflate"', 'from "../../backend/node_modules/fflate"')
    source=source.replace('from "bun:test"','from "./support"')
    source=source.replace('"../src/', '"../../backend/src/')
    source=source.replace('join(import.meta.dir, "fixtures/tsm/', 'join(process.env.TSM_FIXTURES!, "')
    (out/f'{name}.ts').write_text(source)
    files.append(f'import "./{name}";')
(out/'run.ts').write_text('\n'.join(files)+'\nimport {run} from "./support"; await run();\n')
subprocess.run(['bun','build','--compile','--target=bun-linux-x64',str(out/'run.ts'),'--outfile',str(out/'runner')],cwd=root,check=True)
