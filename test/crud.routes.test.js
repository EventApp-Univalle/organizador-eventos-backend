const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
mock.method(require('../src/tareas.utils'), 'getBogotaDate', () => '2026-10-03');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A=id(1), B=id(2), E=id(3), EMPTY=id(4), FOREIGN=id(5), S=id(6), OLD=id(7), OTHER=id(8), ABSENT=id(9);
let events, subtasks, writes, queries, failure, writeFailure, deleteRace;
function reset() {
  events = [E,EMPTY,FOREIGN].map(i=>({id:i,owner_id:i===FOREIGN?B:A,title:'Evento',type:'Cultural',date:'2026-10-15',time:null,location:null,description:null,is_priority:false,created_at:'2026-10-01T12:00:00Z'}));
  subtasks = [{id:S,event_id:E,title:'Sonido',target_date:'2026-10-10',estimated_hours:1.5},
    {id:OLD,event_id:E,title:'Histórica',target_date:'2026-10-01',estimated_hours:1},
    {id:OTHER,event_id:FOREIGN,title:'Ajena',target_date:'2026-10-11',estimated_hours:1}]
    .map(row=>({...row,created_at:'2026-10-01T12:00:00Z'}));
  writes=[]; queries=[]; failure=null; writeFailure=null; deleteRace=false;
}
const client = {
  auth: { async getUser(token) { return {data:{user:{id:token==='a'?A:B}},error:null};} },
  from(table) {
    const filters=[], greater=[];
    let operation='read', changes, limit=Infinity;
    queries.push({table,filters,greater});
    function execute(single=false) {
      if(failure || (operation!=='read' && writeFailure)) return {data:null,error:failure || writeFailure};
      const rows = table==='events'?events:subtasks;
      const matched = rows.filter(row=>filters.every(([key,value])=>row[key]===value)&&greater.every(([key,value])=>row[key]>value)).slice(0,limit);
      if(operation==='delete' && table==='events' && deleteRace) return {data:null,error:{code:'23503',message:'interno'}};
      if(operation!=='read') {
        writes.push({table,operation,changes,filters:[...filters]});
        if(operation==='update') matched.forEach(row=>Object.assign(row,changes));
        else matched.forEach(row=>rows.splice(rows.indexOf(row),1));
      }
      return {data:single?(matched[0]||null):matched,error:null};
    }
    const query={
      select(){return query;}, eq(key,value){filters.push([key,value]);return query;},
      gt(key,value){greater.push([key,value]);return query;}, limit(value){limit=value;return query;},
      update(value){operation='update';changes=value;return query;}, delete(){operation='delete';return query;},
      async maybeSingle(){return execute(true);}, then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);},
    };
    return query;
  },
};
const sdkPath=require.resolve('../src/supabase');
require.cache[sdkPath]={id:sdkPath,filename:sdkPath,loaded:true,exports:client};
const app=require('../src/app');
let server, base;
before(async()=>{server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
beforeEach(reset);
async function request(method,path,body,token='a') {
  const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
const eventPath=i=>`/api/eventos/${i}`;
const taskPath=(e=E,s=S)=>`${eventPath(e)}/subtareas/${s}`;

test('las cuatro operaciones CRUD requieren Bearer',async()=>{
 for(const [method,path] of [['PATCH',eventPath(E)],['DELETE',eventPath(E)],['PATCH',taskPath()],['DELETE',taskPath()]]) {
  const r=await request(method,path,method==='PATCH'?{title:'Nuevo'}:undefined,null);
  assert.equal(r.status,401);assert.equal(r.body.error.code,'AUTH_REQUIRED');
 }
 assert.equal(queries.length,0);
});
test('PATCH evento parcial normaliza y conserva campos omitidos',async()=>{
 const r=await request('PATCH',eventPath(E),{title:' Nuevo ',isPriority:true,location:null});
 assert.equal(r.status,200);assert.equal(r.body.title,'Nuevo');assert.equal(r.body.isPriority,true);assert.equal(r.body.type,'Cultural');
 assert.equal(events[0].owner_id,A);assert.equal(queries.some(q=>q.table==='subtasks'),false);
 assert.ok(writes[0].filters.some(([k,v])=>k==='owner_id'&&v===A));
});
for(const date of ['2026-10-03','2030-01-01']) test(`PATCH evento fecha válida ${date}`,async()=>{
 subtasks=subtasks.filter(t=>t.event_id!==E);
 const r=await request('PATCH',eventPath(E),{date});assert.equal(r.status,200);assert.equal(r.body.date,date);
});
test('PATCH evento fecha pasada se rechaza sin modificación',async()=>{
 const r=await request('PATCH',eventPath(E),{date:'2026-10-02'});assert.equal(r.status,400);assert.ok(r.body.error.fields.date);assert.equal(writes.length,0);
});
test('PATCH evento rechaza subtarea posterior y conserva ambas fechas',async()=>{
 const r=await request('PATCH',eventPath(E),{date:'2026-10-09'});assert.equal(r.status,400);assert.match(r.body.error.message,/subtareas/);
 assert.equal(events[0].date,'2026-10-15');assert.equal(subtasks[0].target_date,'2026-10-10');assert.equal(writes.length,0);
});
test('PATCH evento acepta subtarea exactamente en nueva fecha',async()=>{
 const r=await request('PATCH',eventPath(E),{date:'2026-10-10'});assert.equal(r.status,200);
});
test('PATCH fecha sin cambios no consulta subtareas',async()=>{
 const r=await request('PATCH',eventPath(E),{date:'2026-10-15',title:'Otro'});assert.equal(r.status,200);assert.equal(queries.some(q=>q.table==='subtasks'),false);
});
for(const method of ['PATCH','DELETE']) test(`${method} evento ajeno e inexistente indistinguibles`,async()=>{
 const a=await request(method,eventPath(FOREIGN),method==='PATCH'?{title:'Otro'}:undefined);
 const b=await request(method,eventPath(ABSENT),method==='PATCH'?{title:'Otro'}:undefined);
 assert.equal(a.status,404);assert.deepEqual(a,b);assert.equal(writes.length,0);
});
test('PATCH evento rechaza campos reservados, desconocidos y body vacío',async()=>{
 for(const body of [JSON.parse('{"__proto__":"no permitido"}'),{},{owner_id:B},{userId:B},{id:E},{createdAt:'x'},{eventId:E},{extra:'x'},{title:''},{date:'2026-02-30'}]) {
  const r=await request('PATCH',eventPath(E),body);assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_ERROR');
 }
 assert.equal(writes.length,0);
});
test('DELETE evento vacío devuelve confirmación y desaparece',async()=>{
 const r=await request('DELETE',eventPath(EMPTY));assert.equal(r.status,200);assert.deepEqual(r.body,{id:EMPTY,deleted:true});assert.equal(events.some(e=>e.id===EMPTY),false);
});
test('DELETE evento con subtareas rechaza sin cascade',async()=>{
 const r=await request('DELETE',eventPath(E));assert.equal(r.status,400);assert.equal(r.body.error.code,'EVENT_HAS_SUBTASKS');assert.equal(writes.length,0);assert.equal(subtasks.length,3);
});
test('DELETE evento controla FK RESTRICT ante inserción concurrente',async()=>{
 deleteRace=true;const r=await request('DELETE',eventPath(EMPTY));assert.equal(r.status,400);assert.equal(r.body.error.code,'EVENT_HAS_SUBTASKS');assert.ok(events.some(e=>e.id===EMPTY));
});
test('PATCH subtarea título parcial y esfuerzo decimal',async()=>{
 const r=await request('PATCH',taskPath(),{title:' Nuevo ',estimatedHours:0.5});assert.equal(r.status,200);assert.equal(r.body.title,'Nuevo');assert.equal(r.body.estimatedHours,0.5);assert.equal(r.body.targetDate,'2026-10-10');
 assert.ok(writes[0].filters.some(([k,v])=>k==='event_id'&&v===E));
});
for(const targetDate of ['2026-10-03','2026-10-15']) test(`PATCH subtarea fecha válida ${targetDate}`,async()=>{
 const r=await request('PATCH',taskPath(),{targetDate});assert.equal(r.status,200);assert.equal(r.body.targetDate,targetDate);
});
for(const targetDate of ['2026-10-02','2026-10-16']) test(`PATCH subtarea rechaza fecha nueva ${targetDate}`,async()=>{
 const r=await request('PATCH',taskPath(),{targetDate});assert.equal(r.status,400);assert.ok(r.body.error.fields.targetDate);assert.equal(writes.length,0);
});
test('PATCH subtarea vencida permite título y esfuerzo sin cambiar fecha',async()=>{
 const r=await request('PATCH',taskPath(E,OLD),{title:'Histórica editada',estimatedHours:2.5});assert.equal(r.status,200);assert.equal(r.body.targetDate,'2026-10-01');assert.equal(r.body.estimatedHours,2.5);
});
test('PATCH subtarea vencida acepta fecha histórica explícita sin cambios',async()=>{
 const r=await request('PATCH',taskPath(E,OLD),{title:'Otro',targetDate:'2026-10-01'});assert.equal(r.status,200);
});
test('PATCH subtarea vencida con otra fecha pasada rechaza',async()=>{
 const r=await request('PATCH',taskPath(E,OLD),{targetDate:'2026-10-02'});assert.equal(r.status,400);assert.equal(writes.length,0);
});
test('PATCH subtarea rechaza campos, body vacío y esfuerzos inválidos',async()=>{
 for(const body of [JSON.parse('{"__proto__":"no permitido"}'),{},{eventId:FOREIGN},{owner_id:B},{userId:B},{id:S},{createdAt:'x'},{extra:'x'},{estimatedHours:0},{estimatedHours:-1},{estimatedHours:'1.5'},{estimatedHours:null}]) {
  const r=await request('PATCH',taskPath(),body);assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_ERROR');
 }
 assert.equal(writes.length,0);
});
for(const method of ['PATCH','DELETE']) {
 test(`${method} subtarea ajena/inexistente dentro de evento propio devuelve mismo 404`,async()=>{
  const a=await request(method,taskPath(E,OTHER),method==='PATCH'?{title:'Otro'}:undefined);
  const b=await request(method,taskPath(E,ABSENT),method==='PATCH'?{title:'Otro'}:undefined);
  assert.equal(a.status,404);assert.equal(a.body.error.code,'SUBTASK_NOT_FOUND');assert.deepEqual(a,b);assert.equal(writes.length,0);
 });
 test(`${method} subtarea de evento ajeno se rechaza primero`,async()=>{
  const r=await request(method,taskPath(FOREIGN,OTHER),method==='PATCH'?{title:'Otro'}:undefined);
  assert.equal(r.status,404);assert.equal(r.body.error.code,'EVENT_NOT_FOUND');assert.equal(queries.some(q=>q.table==='subtasks'),false);
 });
}
test('DELETE subtarea elimina solo la relación correcta',async()=>{
 const r=await request('DELETE',taskPath());assert.equal(r.status,200);assert.deepEqual(r.body,{id:S,deleted:true});assert.equal(subtasks.some(t=>t.id===S),false);assert.equal(subtasks.length,2);
});
test('CRUD controla fallos técnicos sin exponer detalles',async()=>{
 failure={message:'detalle privado'};
 for(const [method,path] of [['PATCH',eventPath(E)],['DELETE',eventPath(E)],['PATCH',taskPath()],['DELETE',taskPath()]]) {
  const r=await request(method,path,method==='PATCH'?{title:'Otro'}:undefined);assert.equal(r.status,500);assert.equal(r.body.error.code,'INTERNAL_ERROR');assert.equal(JSON.stringify(r).includes('detalle privado'),false);
 }
});
test('CRUD valida UUID antes de consultar datos',async()=>{
 for(const path of ['/api/eventos/invalid',taskPath(E,'invalid')]) {
  const r=await request('PATCH',path,{title:'Otro'});assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_ERROR');
 }
 assert.equal(writes.length,0);
});

for (const [method, path] of [['PATCH', eventPath(E)], ['DELETE', eventPath(EMPTY)], ['PATCH', taskPath()], ['DELETE', taskPath()]]) {
  test(`${method} ${path} controla fallo de escritura sin modificar registros`, async () => {
    writeFailure = { message: 'detalle de persistencia privado' };
    const original = JSON.stringify({ events, subtasks });
    const r = await request(method, path, method === 'PATCH' ? { title: 'Otro' } : undefined);
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(r.body).includes('persistencia'), false);
    assert.equal(JSON.stringify({ events, subtasks }), original);
  });
}
