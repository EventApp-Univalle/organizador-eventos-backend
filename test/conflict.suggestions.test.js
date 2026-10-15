const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only-secret';
mock.method(require('../src/tareas.utils'), 'getBogotaDate', () => '2026-10-14');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A=id(1), B=id(2), E=id(3), OTHER=id(4), FOREIGN=id(5), TASK=id(6), FOREIGN_TASK=id(7);
let events, tasks, writes, queries, limit, pageCap, loadCalls, loadFailureAt, emptyPageAt, badCount, wrongOwner, profileFailure;
const task = (n, date, hours, event=OTHER) => ({ id:id(n), event_id:event, target_date:date, estimated_hours:hours, title:'No debe exponerse' });
beforeEach(() => {
  events = [{ id:E, owner_id:A, date:'2026-10-18' }, { id:OTHER, owner_id:A, date:'2026-10-20' }, { id:FOREIGN, owner_id:B, date:'2026-10-18' }];
  tasks = [task(6,'2026-10-15',2,E), task(7,'2026-10-15',2,FOREIGN), task(8,'2026-10-15',5), task(9,'2026-10-14',24,FOREIGN)];
  writes=[]; queries=[]; limit=6; pageCap=500; loadCalls=0; loadFailureAt=0; emptyPageAt=0; badCount=false; wrongOwner=false; profileFailure=null;
});
const client = {
  auth: { async getUser(token) { return { data:{ user:{ id:token==='b'?B:A } }, error:null }; } },
  from(table) {
    const filters=[]; let joined=false, from, to, start=0, end=Infinity, changes, inserted;
    const queryInfo={table,filters}; queries.push(queryInfo);
    function execute(single) {
      if (table==='users') return { data:{daily_capacity_hours:limit}, error:profileFailure };
      if (joined) {
        loadCalls++;
        if (loadCalls===loadFailureAt) return {data:null,error:{message:'detalle privado'}};
      }
      const source=table==='events'?events:tasks.map(row=>joined?{...row,event:{owner_id:events.find(event=>event.id===row.event_id)?.owner_id}}:row);
      const rows=source.filter(row=>filters.every(([key,value])=>(key==='event.owner_id'?row.event?.owner_id:row[key])===value))
        .filter(row=>(!from||row.target_date>=from)&&(!to||row.target_date<=to)).sort((a,b)=>a.id.localeCompare(b.id));
      if(changes) { writes.push(changes); rows.forEach(row=>Object.assign(row,changes)); }
      let data=rows.slice(start, Math.min(end+1,start+pageCap));
      if(loadCalls===emptyPageAt&&joined) data=[];
      if(wrongOwner&&joined&&data.length) data=[{...data[0],event:{owner_id:B}}];
      return {data:single?(rows[0]||null):data,error:null,count:badCount?undefined:rows.length};
    }
    const query={
      select(columns){joined=String(columns).includes('event:');queryInfo.columns=columns;return query;},
      eq(key,value){filters.push([key,value]);return query;},
      gte(key,value){from=value;return query;},lte(key,value){to=value;return query;},
      order(key,options){assert.equal(key,'id');assert.equal(options.ascending,true);return query;},
      range(a,b){start=a;end=b;return query;},
      update(value){changes=value;return query;},
      insert(value){inserted=value;writes.push({operation:'insert',value});return query;},
      async single(){
        const row={...inserted,id:id(10000+writes.length),created_at:'2026-10-14T12:00:00Z'};
        tasks.push(row);return {data:row,error:null};
      },
      async maybeSingle(){return execute(true);},then(resolve,reject){return Promise.resolve(execute(false)).then(resolve,reject);},
    };return query;
  },
};
const sdkPath=require.resolve('../src/supabase');
require.cache[sdkPath]={id:sdkPath,filename:sdkPath,loaded:true,exports:client};
const app=require('../src/app');
let server,base;
before(async()=>{server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
async function patch(body={estimatedHours:2},token='a',event=E,subtask=TASK) {
  const response=await fetch(`${base}/api/eventos/${event}/subtareas/${subtask}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
const alternatives = result => result.body.error.details.suggestions;

test('5 h ocupadas + 2 h: conserva 409 y propone ajustar a 1 h sin escribir',async()=>{
  const result=await patch();assert.equal(result.status,409);assert.equal(result.body.error.code,'DAILY_CAPACITY_EXCEEDED');
  assert.equal(result.body.error.details.totalHours,7);assert.equal(result.body.error.details.limitHours,6);
  assert.deepEqual(alternatives(result).at(-1),{strategy:'ADJUST_HOURS',targetDate:'2026-10-15',estimatedHours:1});assert.equal(writes.length,0);
});
test('prioriza tres fechas completas ascendentes, excluye fecha pedida e incluye hoy Bogotá',async()=>{
  assert.deepEqual(alternatives(await patch()).filter(s=>s.strategy==='CHANGE_DATE'),[
    {strategy:'CHANGE_DATE',targetDate:'2026-10-14',estimatedHours:2},
    {strategy:'CHANGE_DATE',targetDate:'2026-10-16',estimatedHours:2},
    {strategy:'CHANGE_DATE',targetDate:'2026-10-17',estimatedHours:2},
  ]);
});
test('carga de otros eventos propios contribuye y no expone títulos ni identificadores ajenos',async()=>{
  const result=await patch();assert.equal(result.status,409);
  assert.equal(JSON.stringify(result.body).includes('No debe exponerse'),false);
  assert.ok(queries.filter(q=>q.columns?.includes('event:')).every(q=>q.filters.some(([key,value])=>key==='event.owner_id'&&value===A)));
});
test('la carga B no afecta propuestas A ni puede consultar evento A',async()=>{
  assert.equal(alternatives(await patch())[0].targetDate,'2026-10-14');
  const before=loadCalls;assert.equal((await patch({estimatedHours:2},'b')).status,404);assert.equal(loadCalls,before);
});
test('B consulta su propia carga sin sumar la de A',async()=>{
  tasks=tasks.filter(row=>row.id!==id(9));
  assert.equal((await patch({estimatedHours:6},'b',FOREIGN,FOREIGN_TASK)).status,200);
});
test('igualdad exacta con límite permite guardar y no devuelve sugerencias',async()=>{
  const result=await patch({estimatedHours:1});assert.equal(result.status,200);assert.equal(writes.length,1);assert.equal(result.body.estimatedHours,1);
});
test('fecha límite del evento se incluye como candidata',async()=>{
  events[0].date='2026-10-16';tasks.push(task(10,'2026-10-14',6));
  const dates=alternatives(await patch()).filter(s=>s.strategy==='CHANGE_DATE').map(s=>s.targetDate);
  assert.deepEqual(dates,['2026-10-16']);
});
test('evento vencido nunca propone fecha pasada ni ajuste en fecha histórica',async()=>{
  events[0].date='2026-10-13';
  const result=await patch();assert.equal(result.status,409);assert.deepEqual(alternatives(result),[]);assert.match(result.body.error.details.noSuggestionsReason,/ya pasó/);
});
test('todas las fechas llenas devuelve array vacío y motivo legible',async()=>{
  tasks=tasks.filter(row=>row.id!==id(8));
  for(let day=14;day<=18;day++) tasks.push(task(day,`2026-10-${day}`,6));
  const result=await patch();assert.deepEqual(alternatives(result),[]);assert.ok(result.body.error.details.noSuggestionsReason);
});
test('subtarea editada se excluye de suma y de sugerencias',async()=>{
  const result=await patch({estimatedHours:3});assert.equal(result.body.error.details.totalHours,8);
  assert.equal(alternatives(result).find(s=>s.strategy==='ADJUST_HOURS').estimatedHours,1);
});
test('sugerencia obsoleta se recalcula: segundo 409 y ninguna escritura',async()=>{
  const first=await patch();const suggestion=alternatives(first)[0];
  tasks.push(task(11,suggestion.targetDate,6));
  const second=await patch({targetDate:suggestion.targetDate,estimatedHours:suggestion.estimatedHours});
  assert.equal(second.status,409);assert.equal(second.body.error.details.totalHours,8);assert.equal(writes.length,0);
});
test('reintentar sugerencia válida mantiene título y guarda una sola vez',async()=>{
  const first=await patch({title:'Título pendiente',estimatedHours:2});
  const suggestion=alternatives(first).at(-1);
  const second=await patch({title:'Título pendiente',targetDate:suggestion.targetDate,estimatedHours:suggestion.estimatedHours});
  assert.equal(second.status,200);assert.equal(second.body.title,'Título pendiente');assert.equal(writes.length,1);
});
test('decimales 0.1 + 0.2 + 5.7 equivalen exactamente al límite',async()=>{
  tasks=tasks.filter(row=>row.id!==id(8));tasks.push(task(10,'2026-10-15','0.1'),task(11,'2026-10-15','0.2'));
  assert.equal((await patch({estimatedHours:5.7})).status,200);
});
test('no redondea hacia abajo una sobrecarga de milésimas',async()=>{
  tasks=tasks.filter(row=>row.id!==id(8));tasks.push(task(10,'2026-10-15','5.999'));
  const result=await patch({estimatedHours:0.002});assert.equal(result.status,409);
  assert.equal(result.body.error.details.totalHours,6.001);
  assert.equal(alternatives(result).find(s=>s.strategy==='ADJUST_HOURS').estimatedHours,0.001);
});
test('ajuste decimal propuesto es positivo y factible al reintentar',async()=>{
  tasks=tasks.filter(row=>row.id!==id(8));tasks.push(task(10,'2026-10-15','5.876'));
  const first=await patch();const suggestion=alternatives(first).find(s=>s.strategy==='ADJUST_HOURS');
  assert.ok(suggestion.estimatedHours>0);assert.ok(suggestion.estimatedHours<=0.124);
  assert.equal((await patch({estimatedHours:suggestion.estimatedHours})).status,200);
});
test('precisión numeric larga nunca genera ajuste redondeado por encima de disponible',async()=>{
  tasks=tasks.filter(row=>row.id!==id(8));tasks.push(task(10,'2026-10-15','5.899999999999999985'));
  const suggestion=alternatives(await patch()).find(s=>s.strategy==='ADJUST_HOURS');
  assert.ok(suggestion.estimatedHours<=0.1);assert.equal((await patch({estimatedHours:suggestion.estimatedHours})).status,200);
});
test('límite real distinto del default participa en todas las propuestas',async()=>{
  limit=8;tasks.find(row=>row.id===id(8)).estimated_hours=7;
  const result=await patch();assert.equal(result.body.error.details.limitHours,8);assert.equal(alternatives(result).at(-1).estimatedHours,1);
});
test('estimación mayor que límite no propone fechas que nunca admitirían la tarea',async()=>{
  const result=await patch({estimatedHours:7});assert.ok(alternatives(result).every(s=>s.strategy==='ADJUST_HOURS'));
});
test('paginas superiores a 500 se leen enteras para cálculo y sugerencias',async()=>{
  tasks=tasks.filter(row=>row.id!==id(8));
  for(let n=100;n<701;n++)tasks.push(task(n,'2026-10-15','0.01'));
  const result=await patch({estimatedHours:0.01});assert.equal(result.status,409);assert.equal(result.body.error.details.totalHours,6.02);
  assert.ok(loadCalls>=4);assert.equal(alternatives(result).some(s=>s.strategy==='ADJUST_HOURS'),false);
});
test('límite PostgREST menor a 500 no trunca silenciosamente',async()=>{
  pageCap=1;const result=await patch();assert.equal(result.status,409);assert.ok(loadCalls>=4);assert.equal(alternatives(result).at(-1).estimatedHours,1);
});
test('error leyendo carga devuelve 500 controlado, nunca sugerencias parciales',async()=>{
  loadFailureAt=1;const result=await patch();assert.equal(result.status,500);assert.equal(result.body.error.code,'INTERNAL_ERROR');assert.equal(JSON.stringify(result.body).includes('detalle privado'),false);
});
test('error leyendo segunda página de sugerencias devuelve 500 sin sugerencias',async()=>{
  tasks.push(task(10,'2026-10-16',1));pageCap=1;loadFailureAt=4;
  const result=await patch();assert.equal(result.status,500);assert.equal(result.body.error.details,undefined);assert.equal(writes.length,0);
});
test('página incompleta o conteo ausente produce 500',async()=>{
  emptyPageAt=1;assert.equal((await patch()).status,500);
  emptyPageAt=0;badCount=true;assert.equal((await patch()).status,500);
});
test('datos ajenos inesperados en consulta fallan de forma cerrada',async()=>{
  wrongOwner=true;assert.equal((await patch()).status,500);assert.equal(writes.length,0);
});
test('horas de BD inconsistentes no se convierten silenciosamente en capacidad disponible',async()=>{
  tasks.find(row=>row.id===id(8)).estimated_hours='NaN';assert.equal((await patch()).status,500);assert.equal(writes.length,0);
});


test('fecha alternativa con carga más estimación exactamente igual a límite es válida',async()=>{
  tasks.push(task(10,'2026-10-14',4));
  const suggestion=alternatives(await patch()).find(s=>s.strategy==='CHANGE_DATE'&&s.targetDate==='2026-10-14');
  assert.ok(suggestion);assert.equal((await patch({targetDate:suggestion.targetDate,estimatedHours:suggestion.estimatedHours})).status,200);
});
test('no restringe búsqueda a una ventana arbitraria de siete días',async()=>{
  events[0].date='2026-10-25';
  for(let day=14;day<=21;day++)tasks.push(task(100+day,`2026-10-${day}`,6));
  assert.deepEqual(alternatives(await patch()).filter(s=>s.strategy==='CHANGE_DATE').map(s=>s.targetDate),['2026-10-22','2026-10-23','2026-10-24']);
});
test('capacidad inválida no genera sugerencias con un límite ficticio',async()=>{
  limit='NaN';const result=await patch();assert.equal(result.status,500);assert.equal(result.body.error.code,'INTERNAL_ERROR');assert.equal(writes.length,0);
});


async function post(estimatedHours=2, { event=E, token='a', targetDate='2026-10-15', title='Nueva subtarea' }={}) {
  const response=await fetch(`${base}/api/eventos/${event}/subtareas`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({title,targetDate,estimatedHours})});
  return {status:response.status,body:await response.json()};
}

test('POST: crear 5 h y luego 2 h rechaza B sin INSERT; ajustar B a 1 h crea con 201',async()=>{
  tasks=tasks.filter(row=>row.event_id===FOREIGN);
  assert.equal((await post(5,{title:'A de 5 h'})).status,201);
  const conflict=await post(2,{title:'B de 2 h'});
  assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'DAILY_CAPACITY_EXCEEDED');
  assert.equal(conflict.body.error.details.targetDate,'2026-10-15');assert.equal(conflict.body.error.details.totalHours,7);
  assert.equal(conflict.body.error.details.limitHours,6);
  assert.deepEqual(alternatives(conflict).at(-1),{strategy:'ADJUST_HOURS',targetDate:'2026-10-15',estimatedHours:1});
  assert.equal(tasks.some(row=>row.title==='B de 2 h'),false);assert.equal(writes.length,1);
  const success=await post(1,{title:'B de 1 h'});assert.equal(success.status,201);assert.equal(success.body.estimatedHours,1);
  assert.equal(success.body.eventId,E);assert.ok(success.body.id);assert.ok(success.body.createdAt);assert.equal(writes.length,2);
});
test('POST propone hasta tres fechas válidas y ascendentes conservando estimación',async()=>{
  tasks=tasks.filter(row=>row.id!==TASK);
  const conflict=await post();assert.equal(conflict.status,409);
  assert.deepEqual(alternatives(conflict).filter(s=>s.strategy==='CHANGE_DATE'),[
    {strategy:'CHANGE_DATE',targetDate:'2026-10-14',estimatedHours:2},
    {strategy:'CHANGE_DATE',targetDate:'2026-10-16',estimatedHours:2},
    {strategy:'CHANGE_DATE',targetDate:'2026-10-17',estimatedHours:2},
  ]);assert.equal(writes.length,0);
});
test('POST incluye carga de otros eventos propios, sin excluir ninguna subtarea existente',async()=>{
  const result=await post(1);assert.equal(result.status,409);assert.equal(result.body.error.details.totalHours,8);assert.equal(writes.length,0);
});
test('POST de B no suma carga A; A no puede crear en evento B',async()=>{
  const own=await post(4,{token:'b',event:FOREIGN});assert.equal(own.status,201);
  const count=writes.length;assert.equal((await post(1,{event:FOREIGN})).status,404);assert.equal(writes.length,count);
});
test('POST usa default 6 cuando no existe capacidad personalizada',async()=>{
  tasks=tasks.filter(row=>row.id!==TASK);limit=null;
  const result=await post(2);assert.equal(result.status,409);assert.equal(result.body.error.details.limitHours,6);assert.equal(writes.length,0);
});
test('POST usa capacidad personalizada real en vez del default',async()=>{
  tasks=tasks.filter(row=>row.id!==TASK);limit=8;
  const result=await post(3);assert.equal(result.status,201);assert.equal(result.body.estimatedHours,3);
});
test('POST conserva precisión decimal y acepta igualdad exacta',async()=>{
  tasks=tasks.filter(row=>row.event_id===FOREIGN);tasks.push(task(10,'2026-10-15','0.1'),task(11,'2026-10-15','0.2'));
  assert.equal((await post(5.7)).status,201);assert.equal(writes.length,1);
});
test('POST no redondea sobrecarga pequeña y ofrece ajuste positivo factible',async()=>{
  tasks=tasks.filter(row=>row.event_id===FOREIGN);tasks.push(task(10,'2026-10-15','5.999'));
  const result=await post(0.002);assert.equal(result.status,409);assert.equal(result.body.error.details.totalHours,6.001);
  const suggestion=alternatives(result).find(s=>s.strategy==='ADJUST_HOURS');assert.equal(suggestion.estimatedHours,0.001);
  assert.equal(writes.length,0);assert.equal((await post(suggestion.estimatedHours)).status,201);
});
test('POST sin alternativas devuelve suggestions vacío y motivo; no inserta',async()=>{
  for(let day=14;day<=18;day++)tasks.push(task(100+day,`2026-10-${day}`,6));
  const result=await post();assert.equal(result.status,409);assert.deepEqual(alternatives(result),[]);
  assert.ok(result.body.error.details.noSuggestionsReason);assert.equal(writes.length,0);
});
test('POST falla cerrado cuando no puede consultar capacidad',async()=>{
  profileFailure={message:'detalle privado'};
  const result=await post();assert.equal(result.status,500);assert.equal(result.body.error.code,'INTERNAL_ERROR');assert.equal(writes.length,0);
});
test('POST falla cerrado cuando no puede consultar carga',async()=>{
  loadFailureAt=1;const result=await post();assert.equal(result.status,500);assert.equal(writes.length,0);
});
test('POST falla cerrado si fallan las consultas de sugerencias',async()=>{
  loadFailureAt=2;const result=await post();assert.equal(result.status,500);assert.equal(result.body.error.details,undefined);assert.equal(writes.length,0);
});
test('POST pagina toda la carga antes de permitir o rechazar INSERT',async()=>{
  tasks=tasks.filter(row=>row.event_id===FOREIGN);
  for(let n=100;n<701;n++)tasks.push(task(n,'2026-10-15','0.01'));
  const result=await post(0.01);assert.equal(result.status,409);assert.equal(result.body.error.details.totalHours,6.02);
  assert.ok(loadCalls>=4);assert.equal(writes.length,0);
});
test('POST rechaza también una lectura incompleta por conteo ausente',async()=>{
  badCount=true;assert.equal((await post()).status,500);assert.equal(writes.length,0);
});
test('POST revalida propuestas obsoletas y no crea desde una reserva supuesta',async()=>{
  const first=await post(2);const suggested=alternatives(first).find(s=>s.strategy==='CHANGE_DATE');
  tasks.push(task(400,suggested.targetDate,6));
  const second=await post(suggested.estimatedHours,{targetDate:suggested.targetDate});
  assert.equal(second.status,409);assert.equal(writes.length,0);
});
