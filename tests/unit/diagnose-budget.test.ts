import { expect, test } from 'bun:test';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { registerDiagnoseTool } from '../../src/tools/diagnose.js';
import { TelemetryStore } from '../../src/browser/telemetry-store.js';

test('diagnostic response budget failure does not drain logs',async()=>{
 const manager=new CdpSessionManager();let large=true;
 const page={url:()=> 'http://fixture.test/',viewportSize:()=>null,evaluate:async()=>({horizontalOverflow:{hasOverflow:false,scrollWidth:100,clientWidth:100,culprits:[]},clippingTraps:[],stackingTraps:[],brokenMedia:[],fontIssues:large?[{family:'x'.repeat(13*1024*1024),status:'error',weight:'400'}]:[]})};
 manager.ensurePage=async()=>page as any;manager.captureMetadata=async()=>({} as any);manager.assertTarget=()=>{};
 manager.runBrowserOperation=(async(fn:()=>Promise<unknown>)=>fn()) as any;
 manager.telemetry.addConsole('error','retained evidence');
 let handler!:Function;
 registerDiagnoseTool({tool:(_name:string,_description:string,_schema:unknown,fn:Function)=>{handler=fn;}} as any,manager);
 const rejected=await handler({});expect(rejected.isError).toBe(true);
 expect(JSON.stringify(rejected)).toContain('RESOURCE_LIMIT_EXCEEDED');
 expect(manager.telemetry.getConsoleLogs('error',false)).toHaveLength(1);
 large=false;expect((await handler({})).isError).not.toBe(true);
 expect(manager.telemetry.getConsoleLogs('error',false)).toHaveLength(0);
});

test('large console messages are marked and do not falsely merge on their clipped prefix',()=>{
 const store=new TelemetryStore();const prefix='x'.repeat(9000);
 store.addConsole('error',prefix+'first');store.addConsole('error',prefix+'other');
 const logs=store.getConsoleLogs('error',false);
 expect(logs).toHaveLength(2);expect(logs[0].text).toHaveLength(8000);
 expect(logs[0].textTruncated).toBe(true);expect(logs[0].originalTextLength).toBe(9005);
});
