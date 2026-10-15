export async function readRequestJson(request:Pick<Request,'headers'|'body'>,max=128_000):Promise<unknown>{
 if(Number(request.headers.get('content-length')||0)>max)throw new Error('body_too_large');
 if(!request.body)throw new Error('invalid_json');const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('body_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
}
