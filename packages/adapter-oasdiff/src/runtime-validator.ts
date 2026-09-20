import type { Diagnostic } from '../../contracts/src/index.js';
import type { LoadedContract } from './load-contract.js';
import type { PayloadDirection } from './direction-projection.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectDirection } from './direction-projection.js';
import { getContractSnapshot,loadContract } from './load-contract.js';
import { inspectSupportedSchema } from './supported-schema.js';
import { isRecord,pointerPart,resolveFragment,unsupported } from './inspect-refs.js';
import { canonicalJson } from '../../core/src/storage/canonical-json.js';
export interface PayloadValidationRequest {contract:LoadedContract;operation_key:string;direction:PayloadDirection;status_code?:number|string;media_type:string;payload:unknown}
export interface PayloadViolation {pointer:string;schema_pointer:string;keyword:string;message:string}
export interface PayloadValidation {supported:boolean;status:'PASS'|'FAIL'|'INCOMPLETE';violations:PayloadViolation[];diagnostics:Diagnostic[]}
export function validatePayload(request:PayloadValidationRequest):PayloadValidation {
  const incomplete=(message:string,diagnostics:Diagnostic[]=[]):PayloadValidation=>({supported:false,status:'INCOMPLETE',violations:[],diagnostics:diagnostics.length?diagnostics:[unsupported('runtime-validator','',message)]});
  const failed=(pointer:string,keyword:string,message:string):PayloadValidation=>({supported:true,status:'FAIL',violations:[{pointer,schema_pointer:'',keyword,message}],diagnostics:[]});
  try{
    if(!['request','response'].includes(request.direction))return incomplete('Unknown validation direction');
    const snapshot=getContractSnapshot(request.contract);if(!snapshot)return incomplete('Contract source identity changed or is unavailable');
    const contract=loadContract(Buffer.from(snapshot.canonical_json),request.contract.source);
    const operation=contract.operations.find(item=>item.key===request.operation_key);if(!operation)return incomplete('Requested operation is absent');
    const capabilities=inspectSupportedSchema(contract,[operation.key]);if(!capabilities.supported)return incomplete('Contract exceeds the supported runtime subset',capabilities.diagnostics);
    const document=contract.document!;
    const fragment=(pointer:string)=>'#'+pointer.split('/').map(encodeURIComponent).join('/');
    const operationValue=resolveFragment(document,fragment(operation.pointer))?.value;if(!isRecord(operationValue))return incomplete('Operation cannot be resolved');
    function dereference(value:unknown,depth=0):Record<string,unknown>|null{
      if(!isRecord(value)||depth>128)return null;
      if(value.$ref===undefined)return value;
      const resolved=resolveFragment(document,value.$ref);return resolved?dereference(resolved.value,depth+1):null;
    }
    let representation:Record<string,unknown>|null;
    if(request.direction==='request'){
      representation=dereference(operationValue.requestBody);
      if(!representation)return incomplete('No supported request-body schema is declared');
      if(request.payload===undefined&&representation.required!==true)return {supported:true,status:'PASS',violations:[],diagnostics:[]};
      if(request.payload===undefined)return failed('','required','Request body is required');
    }else{
      const status=String(request.status_code??'');if(!/^[1-5]\d{2}$/.test(status))return incomplete('Response validation requires a concrete HTTP status');
      const responses=operationValue.responses;if(!isRecord(responses))return incomplete('Response map is missing');
      const selected=responses[status]??responses[status[0]+'XX']??responses.default;
      if(selected===undefined)return failed(`/responses/${status}`,'status','Response status is not declared');
      representation=dereference(selected);if(!representation)return incomplete('Selected response cannot be resolved');
    }
    const media=request.media_type.split(';',1)[0]!.trim().toLowerCase();
    const content=representation.content;if(!isRecord(content))return incomplete('Selected body has no supported content schema');
    const mediaEntry=content[media];if(!isRecord(mediaEntry))return failed(`/content/${pointerPart(media)}`,'media_type','Response or request media type is not declared');
    if(!isRecord(mediaEntry.schema))return incomplete('Selected media type has no explicit schema');
    // Validate lossless JSON without invoking accessors, toJSON, or coercion. The caller retains raw data.
    canonicalJson(request.payload);
    const schema=projectDirection(mediaEntry.schema,document,request.direction);
    const ajv=new Ajv2020({strict:true,allErrors:true,coerceTypes:false,useDefaults:false,removeAdditional:false,ownProperties:true});
    const validate=ajv.compile(schema);
    if(validate(request.payload))return {supported:true,status:'PASS',violations:[],diagnostics:[]};
    return {supported:true,status:'FAIL',violations:(validate.errors??[]).map(error=>({pointer:error.instancePath+(error.keyword==='required'?'/'+pointerPart(String(error.params.missingProperty)):error.keyword==='additionalProperties'?'/'+pointerPart(String(error.params.additionalProperty)):''),schema_pointer:error.schemaPath,keyword:error.keyword,message:error.message??'Schema constraint failed'})),diagnostics:[]};
  }catch{return incomplete('Payload or projected schema is outside the lossless, side-effect-free validation subset');}
}
