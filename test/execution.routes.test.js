const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
process.env.DOTENV_CONFIG_QUIET = 'true';
mock.method(require('../src/tareas.utils'), 'getBogotaDate', () => '2026-10-15');
const { progressOf } = require('../src/execution.utils');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A=id(1), B=id(2), E=id(3), F=id(4), EMPTY=id(5);
let events, tasks, writes, failure, writeFailure, noRow, cap, pageCap, calls;
beforeEach(() => {
  events=[{id:E,owner_id:A,title:'Evento A',date:'2026-10-30'},{id:F,owner_id:B,title:'Privado',date:'2026-10-30'}, {id:EMPTY,owner_id:A,title:'Vacío',date:'2026-10-30'}];
  tasks=[10,11,12,13].map(n=>({id:id(n),event_id:E,title:`Tarea ${n}`,target_date:'2026-10-15',estimated_hours:1,status:'PENDING',execution_note:null,execution_updated_at:null}));
  tasks.push({...tasks[0],id:id(14),event_id:F});
  writes=[]; calls=[]; failure=null; writeFailure=false; noRow=false; cap=6; pageCap=2;
});
const client={ auth:{async getUser(token){return {data:{user:{id:token==='b'?B:A}},error:null};}},from(table){
  let joined=false,start=0,end=Infinity,changes,from,to,insertion,removing=false;const filters=[];calls.push({table,filters});
  function execute(single=false){
    if(failure===table || (changes&&writeFailure))return {data:null,error:{message:'private detail'}};
    if(insertion) {
      const row={id:id(90),...insertion,status:'PENDING',execution_note:null,execution_updated_at:null,created_at:'2026-10-15T12:00:00Z'};
      tasks.push(row);writes.push(insertion);return {data:row,error:null};
    }
    if(table==='users')return {data:{id:filters.find(([key])=>key==='id')?.[1],daily_capacity_hours:cap},error:null};
    let rows=table==='events'?events:tasks;
    if(joined)rows=rows.map(row=>({...row,event:events.find(e=>e.id===row.event_id)}));
    const selected=rows.filter(row=>filters.every(([key,value])=>(key==='event.owner_id'?row.event?.owner_id:row[key])===value)&&(!from||row.target_date>=from)&&(!to||row.target_date<=to));
    if(changes){ writes.push(changes);selected.forEach(row=>Object.assign(row,changes)); }
    if(removing){ writes.push({removed:true});selected.forEach(row=>rows.splice(rows.indexOf(row),1)); }
    return {data:single?(noRow&&changes?null:selected[0]||null):selected.slice(start,Math.min(end+1,start+pageCap)),count:selected.length,error:null};
  }
  const q={select(cols){joined=String(cols).includes('event:');return q;},eq(key,value){filters.push([key,value]);return q;},
    gte(key,value){from=value;return q;},lte(key,value){to=value;return q;},order(){return q;},range(a,b){start=a;end=b;return q;},
    insert(value){insertion=value;return q;},async single(){return execute(true);},delete(){removing=true;return q;},
    update(value){changes=value;return q;},async maybeSingle(){return execute(true);},then(ok,fail){return Promise.resolve(execute()).then(ok,fail);}};return q;
}};
const sdk=require.resolve('../src/supabase');require.cache[sdk]={id:sdk,filename:sdk,loaded:true,exports:client};
// execution.utils was imported for pure tests before installing the mock.
delete require.cache[require.resolve('../src/execution.utils')];
const app=require('../src/app');let server,base;
before(async()=>{server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
async function request(path, body, token='a', method=body===undefined?'GET':'PATCH'){
 const r=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};
}
const execPath=(event=E,task=id(10))=>`/api/eventos/${event}/subtareas/${task}/ejecucion`;
const progress=()=>request(`/api/eventos/${E}/progreso`);
for(const status of ['DONE','POSTPONED','PENDING'])test(`estado ${status} se confirma en una sola actualización sin cambiar planificación`,async()=>{
 const before=structuredClone(tasks[0]); const r=await request(execPath(),{status,executionNote:' Nota logística '});
 assert.equal(r.status,200);assert.equal(r.body.status,status);assert.equal(r.body.executionNote,'Nota logística');assert.ok(r.body.executionUpdatedAt);
 assert.equal(tasks[0].title,before.title);assert.equal(tasks[0].target_date,before.target_date);assert.equal(tasks[0].estimated_hours,before.estimated_hours);assert.equal(writes.length,1);
});
test('nota omitida se conserva, null y texto vacío la limpian explícitamente',async()=>{
 await request(execPath(),{status:'DONE',executionNote:'Confirmado'});
 assert.equal((await request(execPath(),{status:'POSTPONED'})).body.executionNote,'Confirmado');
 assert.equal((await request(execPath(),{status:'DONE',executionNote:null})).body.executionNote,null);
 assert.equal((await request(execPath(),{status:'DONE',executionNote:' '})).body.executionNote,null);
});
test('GET de subtareas relee estado, nota y fecha persistidos, sin truncamiento',async()=>{
 await request(execPath(),{status:'DONE',executionNote:'Finalizado'});
 const r=await request(`/api/eventos/${E}/subtareas`);assert.equal(r.status,200);assert.equal(r.body.length,4);
 assert.equal(r.body.find(t=>t.id===id(10)).executionNote,'Finalizado');assert.equal(r.body[0].status,'DONE');
});
for(const body of [JSON.parse('{"status":"DONE","__proto__":"invalid"}'),{},{status:'COMPLETED'},{status:null},{status:1},{status:'DONE',executionNote:4},{status:'DONE',executionNote:'x'.repeat(2001)},{status:'DONE',owner_id:B},{status:'DONE',targetDate:'2030-01-01'}])test(`validación de ejecución ${JSON.stringify(body).slice(0,65)}`,async()=>{
 const r=await request(execPath(),body);assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_ERROR');assert.equal(writes.length,0);
});
test('Bearer obligatorio en ejecución y ambos endpoints de progreso',async()=>{
 for(const path of [execPath(),`/api/eventos/${E}/progreso`,'/api/progreso']){const r=await request(path,path===execPath()?{status:'DONE'}:undefined,null);assert.equal(r.status,401);}
 assert.equal(calls.length,0);
});
test('B no modifica ni consulta evento A: recurso ajeno e inexistente responden 404',async()=>{
 for(const path of [execPath(),`/api/eventos/${E}/progreso`])assert.equal((await request(path,path===execPath()?{status:'DONE'}:undefined,'b')).status,404);
 assert.equal((await request(execPath(id(99)),{status:'DONE'})).status,404);assert.equal(writes.length,0);
});
test('subtarea de otro evento no puede actualizarse mediante evento propio',async()=>{
 assert.equal((await request(execPath(E,id(14)),{status:'DONE'})).status,404);assert.equal(writes.length,0);
});
test('UUID malformado es 400',async()=>{
 assert.equal((await request('/api/eventos/invalid/progreso')).status,400);
 assert.equal((await request(execPath(E,'invalid'),{status:'DONE'})).status,400);
});
test('fallo de escritura y ausencia de confirmación nunca devuelven éxito',async()=>{
 writeFailure=true;assert.equal((await request(execPath(),{status:'DONE'})).status,500);assert.equal(tasks[0].status,'PENDING');
 writeFailure=false;noRow=true;assert.equal((await request(execPath(),{status:'DONE'})).status,500);
});
test('progreso vacío 0, dos de cuatro 50, todas hechas 100; pospuestas no completan',async()=>{
 assert.equal((await progress()).body.progressPercent,0);
 tasks[0].status=tasks[1].status='DONE';tasks[2].status='POSTPONED';tasks[0].estimated_hours=100;
 let r=await progress();assert.equal(r.status,200);assert.deepEqual(r.body,{eventId:E,eventTitle:'Evento A',doneCount:2,totalCount:4,progressPercent:50});
 tasks.filter(t=>t.event_id===E).forEach(t=>t.status='DONE');assert.equal((await progress()).body.progressPercent,100);
 const empty=await request(`/api/eventos/${EMPTY}/progreso`);assert.equal(empty.body.progressPercent,0);assert.equal(empty.body.totalCount,0);
});
test('cambiar y revertir estado actualiza progreso desde las filas guardadas',async()=>{
 await request(execPath(),{status:'DONE'});assert.equal((await progress()).body.progressPercent,25);
 await request(execPath(),{status:'PENDING'});assert.equal((await progress()).body.progressPercent,0);
});
test('resumen devuelve todos los eventos propios, incluso vacíos, sin N+1',async()=>{
 const r=await request('/api/progreso');assert.equal(r.status,200);assert.equal(r.body.length,2);assert.ok(r.body.every(row=>row.eventId!==F));
 assert.equal(calls.filter(q=>q.table==='events').length,1);assert.equal(calls.filter(q=>q.table==='subtasks').length,2);
 const b=await request('/api/progreso',undefined,'b');assert.deepEqual(b.body.map(e=>e.eventId),[F]);
});
test('progreso pagina más de 500 filas y no acepta análisis incompleto ante fallo',async()=>{
 tasks=Array.from({length:601},(_,n)=>({...tasks[0],id:id(100+n),status:n<300?'DONE':'PENDING'}));pageCap=500;
 const r=await progress();assert.equal(r.body.totalCount,601);assert.equal(r.body.doneCount,300);
 failure='subtasks';assert.equal((await progress()).status,500);assert.equal((await request('/api/progreso')).status,500);
});
test('Hoy mantiene urgencias pendientes y separa hechas y pospuestas, con sus notas',async()=>{
 await request(execPath(),{status:'DONE',executionNote:'Listo'});
 await request(execPath(E,id(11)),{status:'POSTPONED',executionNote:'Esperando proveedor'});
 const r=await request('/api/tareas/hoy');assert.equal(r.status,200);assert.equal(r.body.today.length,2);
 assert.equal(r.body.done[0].executionNote,'Listo');assert.equal(r.body.postponed[0].executionNote,'Esperando proveedor');
 assert.equal(JSON.stringify(r.body).includes(id(14)),false);
});
test('Hechas liberan capacidad, Pospuestas siguen incluidas en impacto',async()=>{
 tasks[0].estimated_hours=20;tasks[0].status='DONE';tasks[1].status='POSTPONED';cap=2;
 const r=await request('/api/configuracion/capacidad');assert.equal(r.status,200);
 assert.equal(r.body.impact.affectedDays[0].plannedHours,3);
 assert.ok(r.body.impact.affectedDays[0].tasks.some(t=>t.subtaskId===id(11)));
 assert.ok(!r.body.impact.affectedDays[0].tasks.some(t=>t.subtaskId===id(10)));
});
test('reactivar Hecha revalida capacidad: 409 no cambia estado ni nota y conserva sugerencias',async()=>{
 tasks[0].status='DONE';tasks[0].estimated_hours=5;cap=6;
 const r=await request(execPath(),{status:'PENDING',executionNote:'Regresa'});assert.equal(r.status,409);
 assert.equal(r.body.error.code,'DAILY_CAPACITY_EXCEEDED');assert.ok(r.body.error.details.suggestions.length);
 assert.equal(tasks[0].status,'DONE');assert.equal(tasks[0].execution_note,null);assert.equal(writes.length,0);
});
test('estado inválido en BD no se convierte en progreso o capacidad aparentemente válidos',async()=>{
 tasks[0].status='UNKNOWN';assert.equal((await progress()).status,500);assert.equal((await request('/api/tareas/hoy')).status,500);
 assert.equal((await request('/api/configuracion/capacidad')).status,500);
});
test('cálculo puro cuenta gestiones, no esfuerzo, y cero nunca produce NaN',()=>{
 assert.deepEqual(progressOf([]),{doneCount:0,totalCount:0,progressPercent:0});
 assert.equal(progressOf([{status:'DONE',estimated_hours:1},{status:'POSTPONED',estimated_hours:100}]).progressPercent,50);
});


test('POST excluye DONE, crea PENDING y actualiza denominador de progreso',async()=>{
 tasks[0].status='DONE';tasks[0].estimated_hours=20;
 const r=await request(`/api/eventos/${E}/subtareas`,{title:'Nueva',targetDate:'2026-10-15',estimatedHours:2},'a','POST');
 assert.equal(r.status,201);assert.equal(r.body.status,'PENDING');assert.equal(r.body.executionNote,null);
 const p=await progress();assert.equal(p.body.totalCount,5);assert.equal(p.body.doneCount,1);
 assert.equal(p.body.progressPercent,20);
});
test('POST cuenta POSTPONED y rechaza sobrecarga sin crear una fila',async()=>{
 tasks[0].status='POSTPONED';tasks[0].estimated_hours=3;cap=6;
 const r=await request(`/api/eventos/${E}/subtareas`,{title:'Nueva',targetDate:'2026-10-15',estimatedHours:1},'a','POST');
 assert.equal(r.status,409);assert.equal(tasks.length,5);assert.equal(writes.length,0);
 assert.ok(r.body.error.details.suggestions.length);
});
test('fallo de carga no permite crear una subtarea sin validar capacidad',async()=>{
 failure='subtasks';const r=await request(`/api/eventos/${E}/subtareas`,{title:'Nueva',targetDate:'2026-10-15',estimatedHours:1},'a','POST');
 assert.equal(r.status,500);assert.equal(writes.length,0);
});
test('editar planificación de DONE no consume capacidad ni cambia el estado',async()=>{
 tasks[0].status='DONE';cap=1;
 const r=await request(`/api/eventos/${E}/subtareas/${id(10)}`,{estimatedHours:12});
 assert.equal(r.status,200);assert.equal(r.body.status,'DONE');assert.equal(r.body.estimatedHours,12);
});
test('DELETE modifica denominador y numerador del progreso persistido',async()=>{
 tasks[0].status='DONE';
 assert.equal((await progress()).body.doneCount,1);
 const removed=await request(`/api/eventos/${E}/subtareas/${id(10)}`,undefined,'a','DELETE');
 assert.equal(removed.status,200);
 const p=await progress();assert.equal(p.body.totalCount,3);assert.equal(p.body.doneCount,0);assert.equal(p.body.progressPercent,0);
});
