const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only-secret';
const clock = mock.method(require('../src/tareas.utils'), 'getBogotaDate', () => '2026-10-15');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A=id(1), B=id(2), E=id(3), OTHER=id(4), FOREIGN=id(5);
const empty = { hasOverload:false, affectedDayCount:0, affectedDays:[] };
let profiles,tasks,updates,upserts,queries,readError,updateError,noRow,returnedOverride,loadCalls,pageCap,
  failedPage,emptyPage,invalidCount,changedCount,foreignRow;
function task(n,date,hours,event=E) { return { id:id(n),event_id:event,target_date:date,estimated_hours:hours,title:`Subtarea ${n}` }; }
beforeEach(() => {
  profiles=new Map([[A,{id:A,daily_capacity_hours:6}],[B,{id:B,daily_capacity_hours:6}]]);
  tasks=[task(6,'2026-10-15',2),task(7,'2026-10-15',3,OTHER),task(8,'2026-10-16',2.5),task(9,'2026-10-16',2.5,OTHER),
    task(10,'2026-10-14',99),task(11,'2026-10-15',24,FOREIGN)];
  updates=[];upserts=[];queries=[];readError=null;updateError=null;noRow=false;returnedOverride=undefined;
  loadCalls=0;pageCap=500;failedPage=0;emptyPage=0;invalidCount=false;changedCount=false;foreignRow=false;
  clock.mock.mockImplementation(()=>'2026-10-15');
});
const client={auth:{async getUser(token){return {data:{user:{id:token==='b'?B:A,email:'qa@example.test'}},error:null};}},from(table){
  const filters=[];let start=0,end=Infinity,fromDate,changes;
  queries.push({table,filters});
  function execute(){
    if(table==='users'){
      const userId=filters.find(([key])=>key==='id')?.[1];
      if(changes){
        updates.push({userId,changes});
        if(updateError)return {data:null,error:updateError};
        const row=profiles.get(userId);
        if(row)Object.assign(row,changes);
        return {data:noRow?null:returnedOverride!==undefined?returnedOverride:row,error:null};
      }
      return {data:profiles.get(userId)||null,error:readError};
    }
    loadCalls++;
    if(loadCalls===failedPage)return {data:null,error:{message:'detalle privado'}};
    const owner=row=>row.event_id===FOREIGN?B:A;
    const rows=tasks.filter(row=>row.target_date>=fromDate&&filters.every(([key,value])=>key==='event.owner_id'&&owner(row)===value))
      .sort((a,b)=>a.id.localeCompare(b.id)).map(row=>({...row,event:{owner_id:owner(row)}}));
    let data=loadCalls===emptyPage?[]:rows.slice(start,Math.min(end+1,start+pageCap));
    if(foreignRow&&data.length)data=[{...data[0],event:{owner_id:B}}];
    return {data,count:invalidCount?undefined:rows.length+(changedCount&&loadCalls>1?1:0),error:null};
  }
  const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},
    gte(key,value){assert.equal(key,'target_date');fromDate=value;return query;},
    order(key,options){assert.equal(key,'id');assert.equal(options.ascending,true);return query;},
    range(a,b){start=a;end=b;return query;},update(value){changes=value;return query;},
    async upsert(value){upserts.push(value);if(!profiles.has(value.id))profiles.set(value.id,{...value,daily_capacity_hours:null});return {error:null};},
    async maybeSingle(){return execute();},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);},
  };return query;
}};
const sdk=require.resolve('../src/supabase');require.cache[sdk]={id:sdk,filename:sdk,loaded:true,exports:client};
const app=require('../src/app');let server,base;
before(async()=>{server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
async function request(method='GET',body,token='a'){
  const response=await fetch(`${base}/api/configuracion/capacidad`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
const patch = value => request('PATCH',{dailyLimitHours:value});

test('guardar 4 h con 5 h planificadas advierte exceso 1 y guarda sin alterar tareas',async()=>{
  tasks=tasks.filter(row=>row.id===id(7));tasks[0].estimated_hours=5;const before=structuredClone(tasks);
  const result=await patch(4);assert.equal(result.status,200);assert.equal(result.body.dailyLimitHours,4);
  assert.equal(profiles.get(A).daily_capacity_hours,4);assert.deepEqual(tasks,before);assert.equal(updates.length,1);
  assert.deepEqual(result.body.impact,{hasOverload:true,affectedDayCount:1,affectedDays:[{
    date:'2026-10-15',plannedHours:5,limitHours:4,excessHours:1,
    tasks:[{subtaskId:id(7),eventId:OTHER,title:'Subtarea 7',estimatedHours:5}],
  }]});
});

test('dos subtareas de distintos eventos propios suman y ambas requieren revisión',async()=>{
  const result=await patch(4);const day=result.body.impact.affectedDays[0];
  assert.equal(day.plannedHours,5);assert.equal(day.excessHours,1);
  assert.deepEqual(day.tasks.map(row=>row.subtaskId),[id(6),id(7)]);
  assert.deepEqual(day.tasks.map(row=>row.eventId),[E,OTHER]);
});
test('dos subtareas del mismo evento suman 5 h al guardar límite 4', async () => {
  tasks = [task(6, '2026-10-15', 2), task(7, '2026-10-15', 3)];
  const result = await patch(4);
  assert.equal(result.status, 200);
  const day = result.body.impact.affectedDays[0];
  assert.equal(day.plannedHours, 5);
  assert.equal(day.excessHours, 1);
  assert.equal(day.tasks.length, 2);
  assert.equal(profiles.get(A).daily_capacity_hours, 4);
});
test('devuelve todas las fechas afectadas ascendentes y tareas ordenadas por ID',async()=>{
  tasks.reverse();const result=await patch(4);
  assert.equal(result.body.impact.affectedDayCount,2);
  assert.deepEqual(result.body.impact.affectedDays.map(row=>row.date),['2026-10-15','2026-10-16']);
  assert.deepEqual(result.body.impact.affectedDays[1].tasks.map(row=>row.subtaskId),[id(8),id(9)]);
});
test('A no recibe cargas ni datos privados de B',async()=>{
  const result=await patch(4);const text=JSON.stringify(result.body);
  assert.equal(text.includes(id(11)),false);assert.equal(text.includes(FOREIGN),false);
  assert.ok(queries.filter(q=>q.table==='subtasks').every(q=>q.filters.some(([key,value])=>key==='event.owner_id'&&value===A)));
});
test('B solo recibe su propio impacto y no modifica el perfil A',async()=>{
  const result=await request('PATCH',{dailyLimitHours:4},'b');
  assert.equal(result.status,200);assert.equal(result.body.impact.affectedDayCount,1);
  assert.deepEqual(result.body.impact.affectedDays[0].tasks.map(row=>row.subtaskId),[id(11)]);
  assert.equal(profiles.get(A).daily_capacity_hours,6);assert.equal(profiles.get(B).daily_capacity_hours,4);
});
test('igualdad exacta no advierte sobrecarga',async()=>{
  const result=await patch(5);assert.equal(result.status,200);assert.deepEqual(result.body.impact,empty);
});
test('reducir sin sobrecargas guarda y devuelve cero y lista vacía',async()=>{
  tasks=[];const result=await patch(4);assert.equal(result.status,200);assert.deepEqual(result.body.impact,empty);
});
test('aumentar elimina advertencias y GET posterior lo refleja',async()=>{
  assert.equal((await patch(4)).body.impact.hasOverload,true);
  const result=await patch(8);assert.deepEqual(result.body.impact,empty);
  assert.deepEqual((await request()).body.impact,empty);
});
test('GET posterior recalcula advertencia persistente desde tareas existentes',async()=>{
  const saved=await patch(4);const loaded=await request();assert.deepEqual(loaded.body,saved.body);
  tasks=tasks.filter(row=>row.id!==id(7));
  const afterChange=await request();assert.equal(afterChange.body.impact.affectedDayCount,1);
});
test('histórico se conserva pero no se muestra; hoy está incluido',async()=>{
  const result=await patch(4);
  assert.equal(result.body.impact.affectedDays.some(day=>day.date==='2026-10-14'),false);
  assert.ok(result.body.impact.affectedDays.some(day=>day.date==='2026-10-15'));
  assert.ok(tasks.some(row=>row.id===id(10)));
});
test('cambio de fecha Bogotá excluye el día que pasa a histórico',async()=>{
  await patch(4);clock.mock.mockImplementation(()=>'2026-10-16');
  const result=await request();assert.deepEqual(result.body.impact.affectedDays.map(day=>day.date),['2026-10-16']);
});
test('semántica incluye todas las subtareas: no hay filtro por estado ni prioridad',async()=>{
  await patch(4);
  assert.ok(queries.filter(q=>q.table==='subtasks').every(q=>q.filters.length===1&&q.filters[0][0]==='event.owner_id'));
});
test('sumas decimales exactas no crean exceso por punto flotante',async()=>{
  tasks=[task(20,'2026-10-15','0.1'),task(21,'2026-10-15','0.2'),task(22,'2026-10-15','3.7')];
  const result=await patch(4);assert.deepEqual(result.body.impact,empty);
});
test('exceso decimal pequeño no se redondea a cero',async()=>{
  tasks=[task(20,'2026-10-15','4.001')];const result=await patch(4);
  assert.equal(result.body.impact.affectedDays[0].plannedHours,4.001);assert.equal(result.body.impact.affectedDays[0].excessHours,0.001);
});
test('lee más de 500 tareas sin perder días ni detalles; sin N+1',async()=>{
  tasks=[];
  for(let n=100;n<701;n++)tasks.push(task(n,'2026-10-15','0.01'));
  tasks.push(task(702,'2027-01-01',7));
  const result=await patch(6);assert.equal(result.status,200);assert.equal(result.body.impact.affectedDayCount,2);
  assert.equal(result.body.impact.affectedDays[0].tasks.length,601);
  assert.equal(result.body.impact.affectedDays[0].plannedHours,6.01);
  assert.equal(loadCalls,2);assert.equal(updates.length,1);
});
test('límite PostgREST menor que página solicitada no recorta resultados',async()=>{
  pageCap=1;const result=await patch(4);assert.equal(result.status,200);
  assert.equal(result.body.impact.affectedDayCount,2);assert.equal(loadCalls,4);
});
test('error de página posterior no guarda capacidad ni devuelve análisis parcial',async()=>{
  pageCap=1;failedPage=2;const result=await patch(4);
  assert.equal(result.status,500);assert.equal(result.body.error.code,'INTERNAL_ERROR');
  assert.equal(updates.length,0);assert.equal(upserts.length,0);assert.equal(profiles.get(A).daily_capacity_hours,6);
  assert.equal(result.body.impact,undefined);assert.equal(JSON.stringify(result.body).includes('detalle privado'),false);
});
test('GET con error de consulta no presenta ausencia de sobrecargas',async()=>{
  failedPage=1;const result=await request();assert.equal(result.status,500);assert.equal(result.body.impact,undefined);
});
test('página vacía prematura, conteo ausente y cambio de conteo fallan sin UPDATE',async()=>{
  emptyPage=1;assert.equal((await patch(4)).status,500);
  emptyPage=0;invalidCount=true;assert.equal((await patch(4)).status,500);
  invalidCount=false;changedCount=true;pageCap=1;assert.equal((await patch(4)).status,500);
  assert.equal(updates.length,0);
});
test('sin fila confirmada devuelve 500 aunque UPDATE pudo haberse aplicado',async()=>{
  noRow=true;const result=await patch(4);
  assert.equal(result.status,500);assert.equal(result.body.dailyLimitHours,undefined);assert.equal(result.body.impact,undefined);
  assert.equal(updates.length,1);
  const checked=await request();assert.equal(checked.status,200);assert.equal(checked.body.dailyLimitHours,4);
});
test('fila confirmada nula, ajena o inválida nunca se presenta como guardado exitoso',async()=>{
  for(const row of [{id:A,daily_capacity_hours:null},{id:B,daily_capacity_hours:4},{id:A,daily_capacity_hours:'NaN'}]) {
    returnedOverride=row;const result=await patch(4);assert.equal(result.status,500);assert.equal(result.body.impact,undefined);
  }
});
test('usa la capacidad confirmada en la fila, nunca el borrador como respuesta',async()=>{
  returnedOverride={id:A,daily_capacity_hours:'5'};const result=await patch(4);
  assert.equal(result.status,200);assert.equal(result.body.dailyLimitHours,5);assert.deepEqual(result.body.impact,empty);
});
test('error de persistencia devuelve 500 controlado',async()=>{
  updateError={message:'detalle privado'};const result=await patch(4);
  assert.equal(result.status,500);assert.equal(result.body.error.code,'INTERNAL_ERROR');
  assert.equal(JSON.stringify(result.body).includes('detalle privado'),false);
});
test('GET de usuario nuevo conserva default 6 y calcula impacto sin crear perfil',async()=>{
  profiles.delete(A);const result=await request();assert.equal(result.status,200);
  assert.equal(result.body.dailyLimitHours,6);assert.equal(result.body.isDefault,true);assert.equal(upserts.length,0);
});
test('PATCH de usuario nuevo provisiona perfil y confirma capacidad guardada',async()=>{
  profiles.delete(A);const result=await patch(4);assert.equal(result.status,200);
  assert.equal(result.body.isDefault,false);assert.equal(result.body.dailyLimitHours,4);assert.equal(upserts[0].id,A);
});
test('datos inconsistentes o ajenos no producen un análisis confiable ni guardado',async()=>{
  foreignRow=true;assert.equal((await patch(4)).status,500);foreignRow=false;
  tasks[0].title=null;assert.equal((await patch(4)).status,500);tasks[0].title='Título';
  tasks[0].estimated_hours='NaN';assert.equal((await patch(4)).status,500);assert.equal(updates.length,0);
});
test('GET con capacidad inconsistente devuelve error técnico',async()=>{
  profiles.get(A).daily_capacity_hours='NaN';assert.equal((await request()).status,500);
});
test('lectura de perfil falla sin confirmar guardado ni hacer UPDATE',async()=>{
  readError={message:'privado'};assert.equal((await patch(4)).status,500);assert.equal(updates.length,0);
});
test('validaciones 1 a 24 preceden toda lectura/escritura y conservan precisión',async()=>{
  for(const value of [0,-1,25,'4',null])assert.equal((await patch(value)).status,400);
  assert.equal(queries.length,0);assert.equal(updates.length,0);
  const result=await patch(4.256);assert.equal(result.status,200);assert.equal(result.body.dailyLimitHours,4.26);
});
test('GET y PATCH sin Bearer no consultan ni guardan datos',async()=>{
  assert.equal((await request('GET',undefined,null)).status,401);
  assert.equal((await request('PATCH',{dailyLimitHours:4},null)).status,401);assert.equal(queries.length,0);
});
