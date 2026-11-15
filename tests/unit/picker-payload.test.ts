import { expect, test } from 'bun:test';
import { parsePickerPayload } from '../../src/browser/picker-payload.js';

test('browser payloads reject malformed states before evidence collection',()=>{
 for(const payload of [null,{status:'unknown'},{status:'selected'},{status:'selected',selector:'#x',role:'admin'},{status:'selected',pinMode:'region',rect:{x:0,y:0,width:Infinity,height:4}}]){
  expect(()=>parsePickerPayload(payload)).toThrow();
 }
 expect(parsePickerPayload({status:'timeout'})).toEqual({status:'timeout',pins:[]});
 const pin=parsePickerPayload({status:'selected',selector:'#x',computedStyles:{color:'blue'},unexpected:'discarded'}).pins[0];
 expect(pin.role).toBe('single');expect((pin as any).unexpected).toBeUndefined();
});

test('browser payload batches and bytes are bounded',()=>{
 expect(()=>parsePickerPayload({status:'selected',pins:Array.from({length:11},()=>({status:'selected',selector:'#x'}))})).toThrow();
 try{parsePickerPayload({status:'selected',selector:'#x',note:'x'.repeat(600000)});}catch(error:any){expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');}
 const cyclic:any={};cyclic.self=cyclic;expect(()=>parsePickerPayload(cyclic)).toThrow();
});
