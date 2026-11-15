import { expect, test } from 'bun:test';
import { BrowserOperationEngine } from '../../src/browser/operation-engine.js';
import type { Page } from 'playwright-core';
import type { ActivityIndicator } from '../../src/browser/activity-indicator.js';

const page = () => ({url:()=> 'http://fixture.test/',on:()=>{},off:()=>{}}) as unknown as Page;
const engine = () => new BrowserOperationEngine({run:async (_: Page, fn:()=>Promise<unknown>)=>fn()} as ActivityIndicator,()=>{});

test('nested collectors reuse ownership and failed operations release the queue', async () => {
  const e = engine(); const p = page();
  expect(await e.run(p,()=>e.run(p,async()=>42))).toBe(42);
  await expect(e.run(p,async()=>{throw new Error('failure');})).rejects.toThrow('failure');
  expect(await e.run(p,async()=>7)).toBe(7); expect(e.currentPage).toBeUndefined();
});

test('one page does not block unrelated page operations', async () => {
  const e = engine(); let release!:()=>void; const gate=new Promise<void>(r=>release=r);
  let start!:()=>void;const ready=new Promise<void>(r=>start=r);
  const first=e.run(page(),async()=>{start();await gate;});await ready;
  try {expect(await e.run(page(),async()=>9)).toBe(9);}finally{release();await first;}
});

test('async work outliving its parent cannot reuse released ownership', async () => {
  const e=engine();const p=page();let releaseChild!:()=>void;
  const childGate=new Promise<void>(r=>releaseChild=r);let child!:Promise<number>;
  await e.run(p,async()=>{child=childGate.then(()=>e.run(p,async()=>3));});
  let started!:()=>void;const ready=new Promise<void>(r=>started=r);
  let releaseOwner!:()=>void;const ownerGate=new Promise<void>(r=>releaseOwner=r);
  const owner=e.run(p,async()=>{started();await ownerGate;});await ready;
  let completed=false;child.then(()=>completed=true);releaseChild();
  try{await new Promise(r=>setTimeout(r,20));expect(completed).toBe(false);}finally{releaseOwner();await owner;}
  expect(await child).toBe(3);
});

test('deadline rejects the caller while retaining ownership until work settles', async () => {
  const e=engine();const p=page();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  let nextStarted=false;
  const first=e.run(p,async()=>{await gate;},{timeoutMs:20} as any);
  const outcome=first.then(()=> 'completed',(error)=>error.code);
  const second=e.run(p,async()=>{nextStarted=true;return 9;});
  try{
    expect(await Promise.race([outcome,new Promise(r=>setTimeout(()=>r('no-deadline'),60))])).toBe('OPERATION_TIMEOUT');
    expect(nextStarted).toBe(false);
  }finally{release();await Promise.allSettled([first,second]);}
  expect(await second).toBe(9);
});

test('expired work waiting in the queue never performs its action', async () => {
  const e=engine();const p=page();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const first=e.run(p,async()=>{await gate;});let performed=false;
  const queued=e.run(p,async()=>{performed=true;},{timeoutMs:10} as any);
  try{expect(await Promise.race([queued.then(()=> 'completed',(error)=>error.code),new Promise(r=>setTimeout(()=>r('no-deadline'),40))])).toBe('OPERATION_TIMEOUT');}
  finally{release();await Promise.allSettled([first,queued]);}
  expect(performed).toBe(false);
});

test('a stalled page cannot accumulate unbounded pending operations',async()=>{
 const e=engine();const p=page();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const jobs=[e.run(p,async()=>{await gate;})];
 for(let i=1;i<16;i++)jobs.push(e.run(p,async()=>{}));
 try{await expect(e.run(p,async()=>{})).rejects.toMatchObject({code:'RESOURCE_LIMIT_EXCEEDED'});}
 finally{release();await Promise.allSettled(jobs);}
 expect(await e.run(p,async()=>1)).toBe(1);
});
