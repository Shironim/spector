import { expect, test } from 'bun:test';
import { enforceResponseBudget } from '../../src/utils/result-budget.js';
import { PinStore } from '../../src/browser/pin-store.js';

test('response limits count UTF-8 JSON bytes and preserve the exact boundary',()=>{
 const response={content:[{type:'text' as const,text:'界'.repeat(20)}]};
 const bytes=Buffer.byteLength(JSON.stringify(response),'utf8');
 expect(enforceResponseBudget(response,bytes)).toBe(response);
 expect(()=>enforceResponseBudget(response,bytes-1)).toThrow();
 try{enforceResponseBudget(response,bytes-1);}catch(error:any){expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');expect(error.details.bytes).toBe(bytes);}
});

test('metadata-only snapshots omit image copies without deleting cached images',()=>{
 const store=new PinStore();store.add({status:'selected',screenshotBase64:'cached-image'});
 expect(store.getPins(false,false)!.pins[0].screenshotBase64).toBeUndefined();
 expect(store.getPins()!.pins[0].screenshotBase64).toBe('cached-image');
});
