# Isolated fixture driver

The test bodies are unchanged except for embedded JSON and the assertion import.
The compiled entry imports both generated test modules and calls run.

The adapter used on the Deck:

```typescript
import assert from "node:assert/strict";
const jobs: {name:string,fn:()=>Promise<void>}[]=[];
export function test(name:string,fn:()=>Promise<void>){jobs.push({name,fn});}
function subset(a:any,b:any):boolean{return b && typeof b==="object" ? Object.keys(b).every(k=>subset(a?.[k],b[k])) : Object.is(a,b);}
export function expect(a:any,neg=false):any {
 const check=(ok:boolean)=>assert.ok(neg?!ok:ok,"device fixture assertion");
 return { get not(){return expect(a,!neg)},get rejects(){return {async toThrow(){let threw=false;try{await a}catch{threw=true}check(threw)}}},
 toBe:(b:any)=>check(Object.is(a,b)),toEqual:(b:any)=>{let ok=true;try{assert.deepEqual(a,b)}catch{ok=false}check(ok)},
 toMatchObject:(b:any)=>check(subset(a,b)),toBeDefined:()=>check(a!==undefined),toBeUndefined:()=>check(a===undefined),
 toBeNull:()=>check(a===null),toContain:(b:any)=>check(a.includes(b)),toHaveLength:(b:any)=>check(a.length===b),
 toBeGreaterThan:(b:any)=>check(a>b),toThrow:()=>{let threw=false;try{a()}catch{threw=true}check(threw)}};
}
export async function run(){for(const j of jobs){try{await j.fn();console.log(JSON.stringify({test:j.name,result:"PASS"}))}catch(e){console.error(JSON.stringify({test:j.name,result:"FAIL",error:String(e)}));process.exitCode=1;}}}

```
