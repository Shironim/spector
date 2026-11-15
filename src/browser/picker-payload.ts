import { z } from 'zod';
import { TOKEN_BUDGETS } from '../constants.js';
import { SpectorError } from '../utils/mcp-response.js';

const text = z.string().max(4096);
const dimension = z.number().nonnegative();
const rect = z.object({x:z.number(),y:z.number(),width:dimension,height:dimension});
const typography = z.object({role:text,fontFamily:text,fontSize:text,fontWeight:text,lineHeight:text,color:text,count:z.number().int().nonnegative()});
const svg = z.object({ariaLabel:text.optional(),width:dimension,height:dimension,viewBox:text.optional(),markup:text.optional(),truncated:z.boolean().optional()});
const image = z.object({srcPath:text,alt:text.optional(),naturalWidth:dimension,naturalHeight:dimension,renderWidth:dimension,renderHeight:dimension,broken:z.boolean().optional(),aspectMismatch:z.boolean().optional()});
const keyframe = z.object({offset:z.number().nullable().optional(),easing:text.optional(),props:z.record(z.string().max(64),text).refine(v=>Object.keys(v).length<=16)});
const animation = z.object({
  selector:text.optional(),
  type:z.enum(['css-animation','css-transition','waapi']),
  name:text.optional(),
  playState:text.optional(),
  durationMs:z.union([z.number().nonnegative(),z.literal('auto')]),
  delayMs:z.number(),
  iterations:z.union([z.number().nonnegative(),z.literal('Infinity')]),
  easing:text,
  direction:text.optional(),
  fill:text.optional(),
  keyframes:z.array(keyframe).max(8).optional()
});
const pin = z.object({
  status:z.literal('selected'), role:z.enum(['single','target','reference','pin']).default('single'),
  pinMode:z.enum(['element','region']).default('element'), selector:text.optional(),tagName:text.optional(),note:z.string().max(2048).optional(),
  rect:rect.optional(),
  computedStyles:z.record(z.string().max(128),text).refine(value=>Object.keys(value).length<=256).optional(),
  subtreeSummary:z.object({typography:z.array(typography).max(12),surfaces:z.array(text).max(150),radii:z.array(text).max(150),spacingGaps:z.array(text).max(150)}).optional(),
  assets:z.object({svgs:z.object({count:z.number().int().nonnegative(),items:z.array(svg).max(10)}).refine(value=>value.count===value.items.length).optional(),images:z.object({count:z.number().int().nonnegative(),items:z.array(image).max(10)}).refine(value=>value.count===value.items.length).optional()}).optional(),
  animations:z.array(animation).max(8).optional(),
  frameworkComponent:z.object({framework:z.enum(['vue','react','svelte','livewire','inertia','alpine','blade','unknown']),componentName:text.optional(),sourceFile:text.optional(),sourceLine:z.number().int().nonnegative().optional(),props:z.array(text).max(64).optional()}).optional()
}).superRefine((value, context)=>{
  if (value.pinMode==='element' && !value.selector) context.addIssue({code:'custom',message:'Element selection requires a selector.'});
  if (value.pinMode==='region' && (!value.rect || value.rect.width<=0 || value.rect.height<=0)) context.addIssue({code:'custom',message:'Region selection requires a positive rectangle.'});
});
export type BrowserPickedPin = z.infer<typeof pin>;

const result = z.union([
  z.object({status:z.enum(['cancelled','timeout'])}),
  z.object({status:z.literal('selected'),pins:z.array(pin).min(1).max(TOKEN_BUDGETS.MAX_PIN_QUEUE)}),
  pin
]);

export function parsePickerPayload(value: unknown): {status:'selected'|'cancelled'|'timeout';pins:BrowserPickedPin[]} {
  let bytes: number;
  try { bytes=Buffer.byteLength(JSON.stringify(value),'utf8'); }
  catch { throw new SpectorError('INVALID_TOOL_INPUT','Browser picker returned a non-serializable payload.'); }
  if(bytes>TOKEN_BUDGETS.MAX_BROWSER_PAYLOAD_BYTES) throw new SpectorError('RESOURCE_LIMIT_EXCEEDED','Browser picker payload exceeds its byte budget.');
  const parsed=result.safeParse(value);
  if(!parsed.success) throw new SpectorError('INVALID_TOOL_INPUT','Browser picker payload does not match the evidence contract.',
    'Pick a smaller selection, or use spector_picker({ action: "pick", includeStyles: false }) for oversized computed styles.');
  const data=parsed.data;
  if(data.status!=='selected') return {status:data.status,pins:[]};
  return {status:'selected',pins:'pins' in data?data.pins:[data]};
}
