/*
 * CruciAula — Versión 0.4 · Editor docente autenticado y sincronizado con Firebase.
 * El modo alumno / QR aún es una demostración local, no un examen publicado.
 * Independiente de Roscoaula.
 */
'use strict';

const PREGUNTAS = [
  { answer: 'NAISMITH', clue: 'Apellido del profesor que inventó el básquet en 1891.' },
  { answer: 'GINOBILI', clue: 'Apellido del argentino que ganó cuatro campeonatos de la NBA con San Antonio.' },
  { answer: 'CRONICA', clue: 'Género periodístico que narra y contextualiza un acontecimiento.' },
  { answer: 'BASQUET', clue: 'Deporte creado en 1891 en el que se anotan puntos encestando una pelota.' },
  { answer: 'RELATOR', clue: 'Profesional que narra en vivo las acciones de una competencia.' },
  { answer: 'REBOTE', clue: 'Acción de recuperar la pelota después de un lanzamiento fallido.' },
  { answer: 'TRIPLE', clue: 'Lanzamiento convertido desde detrás de la línea de tres puntos.' },
  { answer: 'FANGIO', clue: 'Apellido del argentino que fue cinco veces campeón mundial de Fórmula 1.' },
  { answer: 'RALLY', clue: 'Competencia automovilística de tramos cronometrados sobre distintas superficies.' },
  { answer: 'POLE', clue: 'Nombre del primer lugar de la grilla obtenido en clasificación.' },
  { answer: 'FIBA', clue: 'Siglas de la federación internacional que rige el básquet.' },
  { answer: 'FIA', clue: 'Siglas de la Federación Internacional del Automóvil.' },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {activePuzzleId:null, student: null, words: [], cells: new Map(), selected: null, direction:'h', answers:new Map(), startedAt:0, interval:null, elapsed:0, running:false};
const STORAGE = 'cruciaula_demo_resultados_v1'; // Conserva las partidas previas.
const PUZZLE_STORAGE = 'cruciaula_demo_crucigramas_v1';
const SAMPLE_ID = 'deportes-ejemplo';
const SAMPLE = {id:SAMPLE_ID,title:'Deportes y periodismo',description:'Básquet, automovilismo y comunicación deportiva',questions:PREGUNTAS};
// Sin iniciar sesión se muestra únicamente un crucigrama de DEMO, no el material docente.
let puzzles = [SAMPLE];
let cloudEntries=[];
let teacherUser=null;
let authPending=true;
const cloud=window.CruciAulaCloud || {ready:false,reason:'Firebase no cargó.'};
const isTeacher=()=>Boolean(teacherUser && cloud.ready && teacherUser.uid===cloud.TEACHER_UID);
function saveLocalBackup(){
  try{localStorage.setItem(PUZZLE_STORAGE,JSON.stringify(puzzles));}catch(e){console.warn('No se pudo crear copia local.',e)}
}
function localPuzzles(){
  try{const value=JSON.parse(localStorage.getItem(PUZZLE_STORAGE)||'[]');return Array.isArray(value)?value:[]}
  catch(e){return []}
}
async function loadCloud(){
  if(!isTeacher())return;
  const [data,records]=await Promise.all([
    cloud.db.collection('crucigramas').get(),
    cloud.db.collection('resultados').get()
  ]);
  if(!isTeacher())return;
  puzzles=data.docs.map(doc=>({...doc.data(),id:doc.id})).sort((a,b)=>a.title.localeCompare(b.title,'es'));
  cloudEntries=records.docs.map(doc=>doc.data()).filter(e=>Number.isFinite(e.seconds));
  refreshPuzzleSelector();renderTeacher();
  $('#cloud-status').textContent=`Sincronizado · ${puzzles.length} crucigramas y ${cloudEntries.length} resultados de prueba.`;
}

function activePuzzle(){return puzzles.find(p=>p.id===state.activePuzzleId)||puzzles[0]}
function refreshPuzzleSelector(){
  const selector=$('#select-puzzle');const previous=selector.value;selector.replaceChildren();
  puzzles.forEach(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.title;selector.append(option)});
  selector.value=(state.activePuzzleId&&puzzles.some(p=>p.id===state.activePuzzleId)?state.activePuzzleId:(puzzles.some(p=>p.id===previous)?previous:puzzles[0]?.id||''));
  $('#form-student button[type=submit]').disabled=!puzzles.length;
}

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z]/g,'').toUpperCase();
const key = (r,c) => `${r},${c}`;
const htmlSafe = (s) => String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
const timeLabel = (seconds) => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('on');clearTimeout(toast._tid);toast._tid=setTimeout(()=>el.classList.remove('on'),3600)}
function show(name){if(['teacher','editor'].includes(name)&&!isTeacher())name='login';$$('.screen').forEach(e=>e.classList.remove('active'));$(`#screen-${name}`).classList.add('active');window.scrollTo({top:0,behavior:'instant'});}
function stopClock(){clearInterval(state.interval);state.interval=null;state.running=false}
function updateClock(){state.elapsed=Math.floor((Date.now()-state.startedAt)/1000);$('#timer-text').textContent=timeLabel(state.elapsed)}
function startClock(){stopClock();state.startedAt=Date.now();state.elapsed=0;state.running=true;updateClock();state.interval=setInterval(updateClock,300)}

/** Genera una distribución real de palabras cruzadas sobre una grilla interna. */
function buildCrossword(source){
  const size=43, origin=Math.floor(size/2), placed=[], cells=new Map();
  const within=(r,c)=>r>=1 && c>=1 && r<size-1 && c<size-1;
  const has=(r,c)=>cells.has(key(r,c));
  const mayPlace=(str,row,col,dir,initial=false)=>{
    const dr=dir==='v'?1:0, dc=dir==='h'?1:0;
    const L=str.length;
    if(!within(row,col)||!within(row+dr*(L-1),col+dc*(L-1))) return null;
    if(has(row-dr,col-dc)||has(row+dr*L,col+dc*L))return null;
    let intersections=0;
    for(let i=0;i<L;i++){
      const r=row+dr*i,c=col+dc*i,p=cells.get(key(r,c));
      if(p){
        if(p.ch!==str[i] || p.dirs.has(dir)) return null;
        intersections++;
      }else if(dir==='h' ? has(r-1,c)||has(r+1,c) : has(r,c-1)||has(r,c+1))return null;
    }
    if(!initial&&!intersections)return null;
    return intersections;
  };
  const store=(w,row,col,dir)=>{
    const id=placed.length+1;
    const p={...w,id,row,col,dir,length:w.answer.length};
    placed.push(p);
    for(let i=0;i<w.answer.length;i++){
      const r=row+(dir==='v'?i:0),c=col+(dir==='h'?i:0),k=key(r,c);
      if(!cells.has(k))cells.set(k,{ch:w.answer[i],dirs:new Set([dir])});
      else cells.get(k).dirs.add(dir);
    }
  };
  const items=source.map(item=>({...item,answer:normalize(item.answer)})).filter(x=>x.answer.length>=2).sort((a,b)=>b.answer.length-a.answer.length);
  if(!items.length) return {words:[],cells};
  store(items.shift(),origin,origin-4,'h');
  let remaining=items;
  // Repetimos para rescatar palabras que no podían encajar antes de colocar otras.
  for(let round=0;round<3;round++){
    const failed=[];
    for(const w of remaining){
      let best=null;
      for(const [k,existing] of cells){
        const [r,c]=k.split(',').map(Number);
        for(let i=0;i<w.answer.length;i++){
          if(w.answer[i]!==existing.ch)continue;
          for(const dir of ['h','v']){
            if(existing.dirs.has(dir))continue;
            const row=r-(dir==='v'?i:0),col=c-(dir==='h'?i:0);
            const intersections=mayPlace(w.answer,row,col,dir);
            if(intersections===null)continue;
            const bbox=[...cells.keys()].map(s=>s.split(',').map(Number));
            const rs=bbox.map(x=>x[0]).concat([row,row+(dir==='v'?w.answer.length-1:0)]);
            const cs=bbox.map(x=>x[1]).concat([col,col+(dir==='h'?w.answer.length-1:0)]);
            const area=(Math.max(...rs)-Math.min(...rs)+1)*(Math.max(...cs)-Math.min(...cs)+1);
            const score=intersections*90-area*.12-Math.abs(row-origin)*.08-Math.abs(col-origin)*.08;
            if(!best||score>best.score)best={row,col,dir,score};
          }
        }
      }
      if(best)store(w,best.row,best.col,best.dir);else failed.push(w);
    }
    remaining=failed;
    if(!remaining.length)break;
  }
  // Coordenadas recortadas: sólo las celdas realmente usadas.
  const xs=placed.flatMap(w=>[w.col,w.col+(w.dir==='h'?w.length-1:0)]),ys=placed.flatMap(w=>[w.row,w.row+(w.dir==='v'?w.length-1:0)]);
  const minR=Math.min(...ys),minC=Math.min(...xs);
  const words=placed.map(w=>({...w,row:w.row-minR,col:w.col-minC})).sort((a,b)=>a.row-b.row||a.col-b.col||a.dir.localeCompare(b.dir));
  let num=0,last='';
  for(const w of words){const pos=key(w.row,w.col);if(last!==pos){num++;last=pos;}w.number=num;}
  const used=new Map();for(const w of words)for(let i=0;i<w.length;i++){const r=w.row+(w.dir==='v'?i:0),c=w.col+(w.dir==='h'?i:0);used.set(key(r,c),w.answer[i]);}
  return {words,cells:used,rows:Math.max(...ys)-minR+1,cols:Math.max(...xs)-minC+1,unused:remaining.map(w=>w.answer)};
}

function newGame(){
  const selected=activePuzzle();
  if(!selected){toast('Primero hay que crear un crucigrama.');show('home');return}
  state.activePuzzleId=selected.id;
  const puzzle=buildCrossword(selected.questions);
  if(!puzzle.words.length){toast('Este crucigrama no tiene palabras para jugar.');return}
  $('#game-title').textContent=selected.title;
  state.words=puzzle.words;state.cells=puzzle.cells;state.rows=puzzle.rows;state.cols=puzzle.cols;
  state.answers=new Map();state.direction='h';state.selected=state.words.find(w=>w.dir==='h')?.id??state.words[0]?.id;
  show('game');startClock();renderBoard();renderClues();selectWord(state.selected);
  if(puzzle.unused.length)console.info('No encajaron estas palabras:',puzzle.unused.join(', '));
}
function getWord(id){return state.words.find(w=>w.id===id)}
function wordKeys(w){return Array.from({length:w.length},(_,i)=>key(w.row+(w.dir==='v'?i:0),w.col+(w.dir==='h'?i:0)))}
function renderBoard(){
  const grid=$('#crossword');grid.style.setProperty('--cols',state.cols);grid.textContent='';
  const nums=new Map();const fills=new Map();
  state.words.forEach(w=>{nums.set(key(w.row,w.col),w.number);const current=state.answers.get(w.id)||'';wordKeys(w).forEach((k,i)=>{if(current[i])fills.set(k,current[i])})});
  const active=getWord(state.selected);const activeKeys=new Set(active?wordKeys(active):[]);
  const fragment=document.createDocumentFragment();
  for(let r=0;r<state.rows;r++)for(let c=0;c<state.cols;c++){
    const k=key(r,c),cell=document.createElement('button');cell.type='button';cell.className='cell';
    if(!state.cells.has(k)){cell.classList.add('empty');cell.disabled=true;cell.setAttribute('aria-hidden','true')}
    else {
      if(activeKeys.has(k))cell.classList.add('selected');
      if(fills.has(k)){cell.classList.add('filled');cell.appendChild(document.createTextNode(fills.get(k)))}
      if(nums.has(k)){const n=document.createElement('span');n.className='num';n.textContent=nums.get(k);cell.appendChild(n)}
      cell.setAttribute('aria-label',`Casillero fila ${r+1}, columna ${c+1}`);
      cell.addEventListener('click',()=>{
        const options=state.words.filter(w=>wordKeys(w).includes(k));
        const preferred=options.find(w=>w.dir===state.direction)??options[0];
        if(preferred)selectWord(preferred.id);
      });
    }
    fragment.append(cell);
  }
  grid.append(fragment);renderProgress();
}
function renderClues(){
  const horizontal=state.direction==='h';$('#tab-across').classList.toggle('selected',horizontal);$('#tab-down').classList.toggle('selected',!horizontal);
  const clues=$('#clue-list');clues.textContent='';
  state.words.filter(w=>w.dir===state.direction).sort((a,b)=>a.number-b.number).forEach(w=>{
    const item=document.createElement('button');item.type='button';item.className='clue';
    if(state.selected===w.id)item.classList.add('selected');if((state.answers.get(w.id)||'').length>0)item.classList.add('answered');
    const n=document.createElement('span');n.textContent=`${w.number}.`;
    const t=document.createElement('span');t.textContent=w.clue;
    item.append(n,t);item.addEventListener('click',()=>selectWord(w.id));clues.append(item);
  });
}
function selectWord(id){
  const w=getWord(id);if(!w)return;
  state.selected=id;state.direction=w.dir;
  $('#clue-selected-label').textContent=`${w.number}. ${w.dir==='h'?'Horizontal':'Vertical'} · ${w.length} letras`;
  $('#clue-answer').value=state.answers.get(w.id)||'';
  renderClues();renderBoard();
}
function renderProgress(){
  // El progreso representa palabras cargadas, NUNCA palabras correctas.
  const answered=state.words.filter(w=>(state.answers.get(w.id)||'').length>0).length,total=state.words.length;
  $('#progress-bar').style.width=`${(answered/total)*100||0}%`;
  $('#progress-text').textContent=`${answered}/${total}`;
}
function nextWordAfter(currentId){
  const ordered=[...state.words].sort((a,b)=>a.number-b.number||a.dir.localeCompare(b.dir));
  const index=ordered.findIndex(w=>w.id===currentId);
  // Primero saltar a las pendientes, incluso si son de la otra orientación.
  for(let step=1;step<=ordered.length;step++){
    const w=ordered[(index+step)%ordered.length];
    if(!(state.answers.get(w.id)||'').length)return w;
  }
  // Si todas tienen algo escrito, avanzar a la siguiente para poder revisar.
  return ordered[(index+1)%ordered.length];
}
function fillAnswer(){
  const w=getWord(state.selected);if(!w)return;
  const response=normalize($('#clue-answer').value);
  // Guarda el intento sin evaluar ni revelar si es correcto; hasta si tiene otro largo.
  state.answers.set(w.id,response);
  const allFilled=state.words.every(x=>(state.answers.get(x.id)||'').length>0);
  if(!allFilled){
    const next=nextWordAfter(w.id);
    if(next)selectWord(next.id);
  }else{
    renderClues();renderBoard();
    $('#clue-answer').value=response;
  }
  toast(allFilled?'Todas las pistas tienen respuesta. Podés revisar o entregar.':'Respuesta guardada. Seguimos con la siguiente pista.');
}
async function finish(){
  const total=state.words.length;
  const pending=state.words.filter(w=>!(state.answers.get(w.id)||'').length).length;
  if(pending && !confirm(`Hay ${pending} ${pending===1?'respuesta sin completar':'respuestas sin completar'}. ¿Querés entregar de todos modos?`))return;
  // El chequeo de aciertos sucede solamente al ENTREGAR, nunca durante la partida.
  updateClock();stopClock();
  const incorrect=state.words.filter(w=>state.answers.get(w.id)!==w.answer).map(w=>({
    number:w.number,direction:w.dir,clue:w.clue,given:state.answers.get(w.id)||'',solution:w.answer
  }));
  const correct=total-incorrect.length;
  const entry={puzzleId:state.activePuzzleId,name:`${state.student.first} ${state.student.last}`,course:state.student.course,
    seconds:state.elapsed,total,correct,incorrect,date:new Date().toISOString(),at:Date.now()};
  if(isTeacher()){
    try{
      await cloud.db.collection('resultados').add(entry);
      cloudEntries.push(entry);
    }catch(err){console.error(err);toast('No pudimos guardar esta prueba en Firebase. Revisá la conexión.');}
  }else{
    // Alumnos: DEMO local. No guarda nada en Firestore hasta habilitar permisos seguros.
    try{
      const previous=JSON.parse(localStorage.getItem(STORAGE)||'[]');
      previous.push(entry);localStorage.setItem(STORAGE,JSON.stringify(previous.slice(-500)));
    }catch(err){toast('Tu navegador no permitió guardar el resultado.');}
  }
  renderRanking(false,entry);show('results');
}
function renderIncorrect(entry){
  const review=$('#review-section'),panel=$('#wrong-answers-panel'),button=$('#show-wrong');
  review.hidden=!entry;panel.hidden=true;button.setAttribute('aria-expanded','false');
  panel.replaceChildren();
  if(!entry)return;
  const list=entry.incorrect||[];
  button.firstChild.textContent=`📋 Respuestas incorrectas (${list.length}) `;
  if(!list.length){
    const msg=document.createElement('p');msg.className='review-perfect';
    msg.textContent='¡No tuviste respuestas incorrectas! 🎉';panel.append(msg);return;
  }
  for(const question of list){
    const item=document.createElement('div');item.className='review-item';
    const title=document.createElement('strong');
    title.textContent=`${question.number}. ${question.direction==='h'?'Horizontal':'Vertical'} · ${question.clue}`;
    const student=document.createElement('p');student.textContent=`Tu respuesta: ${question.given||'Sin responder'}`;
    const solution=document.createElement('p');solution.className='review-solution';
    solution.textContent=`Respuesta correcta: ${question.solution}`;
    item.append(title,student,solution);panel.append(item);
  }
}
function entries(){if(isTeacher())return cloudEntries;try{return JSON.parse(localStorage.getItem(STORAGE)||'[]').filter(x=>Number.isFinite(x.seconds))}catch{return []}}
function renderRanking(onlyRanking=false,recent=null){
  // Solo los intentos PERFECTOS participan de la carrera por el menor tiempo.
  const bestByStudent=new Map();
  for(const entry of entries().filter(x=>(x.puzzleId||SAMPLE_ID)===state.activePuzzleId && x.total>0 && x.correct===x.total)){
    const studentKey=`${normalize(entry.name)}|${normalize(entry.course)}`;
    const previous=bestByStudent.get(studentKey);
    if(!previous||entry.seconds<previous.seconds)bestByStudent.set(studentKey,entry);
  }
  const ranking=[...bestByStudent.values()].sort((a,b)=>a.seconds-b.seconds||a.at-b.at);
  $('#results-title').textContent=onlyRanking?(isTeacher()?'Clasificación de pruebas del profesor':'Clasificación local'):'¡Crucigrama entregado!';
  $('#result-name').textContent=onlyRanking?`Actividad: ${activePuzzle()?.title||'Sin título'} · ${isTeacher()?'Pruebas sincronizadas en Firebase.':'Pruebas locales de este navegador.'}`:`${recent.name} · ${recent.course||'Sin comisión'}`;
  $('.stat-grid').style.display=onlyRanking?'none':'grid';$('.result-trophy').textContent=onlyRanking?'🏅':'🏆';
  $('#result-explain').textContent=onlyRanking?'':recent.correct===recent.total
    ?'¡Todas las respuestas son correctas! Tu tiempo entra al ranking.'
    :'El tiempo se detuvo al entregar. Para aparecer en el ranking hay que acertar todas las respuestas.';
  renderIncorrect(onlyRanking?null:recent);
  if(recent){$('#final-time').textContent=timeLabel(recent.seconds);$('#final-correct').textContent=`${recent.correct}/${recent.total}`;$('#final-percent').textContent=`${Math.round(100*recent.correct/recent.total)}%`;}
  const podium=$('#ranking-podium'),rest=$('#ranking-rest');podium.textContent='';rest.textContent='';
  if(!ranking.length){const msg=document.createElement('p');msg.textContent='Todavía no hay partidas con todas las respuestas correctas. ¡Podés ser la primera persona!';msg.className='muted';podium.append(msg);return;}
  ranking.forEach((item,i)=>{
    const card=document.createElement('div');card.className=`rank-card ${['gold','silver','bronze'][i]||''}`;
    if(recent&&item.at===recent.at)card.classList.add('highlight');
    const medal=document.createElement('span');medal.className='rank-medal';medal.textContent=['🥇','🥈','🥉'][i]||`${i+1}.`;
    const name=document.createElement('div');name.innerHTML=`<strong>${htmlSafe(item.name)}</strong><span class="rank-subtitle">${htmlSafe(item.course||'Sin comisión')}</span>`;
    const tm=document.createElement('span');tm.className='rank-time';tm.textContent=timeLabel(item.seconds);
    card.append(medal,name,tm);(i<3?podium:rest).append(card);
  });
}

$('#btn-play').addEventListener('click',()=>{refreshPuzzleSelector();show('register')});
$('#nav-home').addEventListener('click',()=>show('home'));
$('#nav-how').addEventListener('click',()=>toast('Los QR todavía no están activos: esta es una DEMO local. Al jugar no se revela ningún acierto hasta que entregás. Gana el menor tiempo con todas correctas.'));
$('#nav-teacher').addEventListener('click',()=>{if(isTeacher()){renderTeacher();show('teacher')}else{show('login');$('#teacher-email').focus()}});
$('#btn-ranking-home').addEventListener('click',()=>{state.activePuzzleId=state.activePuzzleId||puzzles[0]?.id;if(!state.activePuzzleId){toast('No hay crucigramas todavía.');return}renderRanking(true);show('results')});
$$('[data-go="home"]').forEach(el=>el.addEventListener('click',()=>show('home')));
$('#form-student').addEventListener('submit',e=>{e.preventDefault();const first=$('#first-name').value.trim(),last=$('#last-name').value.trim(),course=$('#course').value.trim();if(!first||!last){toast('Completá nombre y apellido.');return}state.student={first,last,course};state.activePuzzleId=$('#select-puzzle').value;newGame()});
$('#tab-across').addEventListener('click',()=>{state.direction='h';selectWord(state.words.find(w=>w.dir==='h')?.id)});
$('#tab-down').addEventListener('click',()=>{state.direction='v';selectWord(state.words.find(w=>w.dir==='v')?.id)});
$('#fill-answer').addEventListener('click',fillAnswer);
$('#clue-answer').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();fillAnswer()}});
$('#clear-answer').addEventListener('click',()=>{$('#clue-answer').value='';$('#clue-answer').focus()});
$('#finish-game').addEventListener('click',finish);
$('#show-wrong').addEventListener('click',()=>{const p=$('#wrong-answers-panel'),opening=p.hidden;p.hidden=!opening;$('#show-wrong').setAttribute('aria-expanded',String(opening));});
$('#leave-game').addEventListener('click',()=>{if(confirm('¿Querés salir? Se perderá el avance de esta partida.')){stopClock();show('home')}});
$('#back-to-home').addEventListener('click',()=>show('home'));
$('#play-again').addEventListener('click',()=>{refreshPuzzleSelector();show('register')});
$('#brand').addEventListener('click',e=>{e.preventDefault();if(state.running&& !confirm('¿Salir de la partida en curso?'))return;stopClock();show('home')});
// ---- Panel docente: acceso real Firebase Auth y guardado en Cloud Firestore. ----
function loginMessage(message,isError=false){const status=$('#login-status');status.textContent=message;status.classList.toggle('login-error',isError);}
$('#form-login').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!cloud.ready){loginMessage(cloud.reason,true);return;}
  const button=$('#teacher-login-button');button.disabled=true;loginMessage('Verificando cuenta…');
  try{
    const credential=await cloud.auth.signInWithEmailAndPassword($('#teacher-email').value.trim(),$('#teacher-password').value);
    $('#teacher-password').value='';
    if(credential.user.uid!==cloud.TEACHER_UID){await cloud.auth.signOut();throw Error('Esa cuenta no tiene permiso de profesor.');}
  }catch(error){
    console.error('Inicio de sesión:',error.code||error.message);
    loginMessage(error.message==='Esa cuenta no tiene permiso de profesor.'?error.message:'No se pudo ingresar. Revisá el correo, la contraseña y la conexión.',true);
  }finally{button.disabled=false;}
});
$('#teacher-logout').addEventListener('click',async()=>{
  try{await cloud.auth.signOut();show('home');toast('Sesión docente cerrada.');}
  catch(err){toast('No se pudo cerrar sesión. Probá de nuevo.');}
});
if(cloud.ready){
  cloud.auth.onAuthStateChanged(async user=>{
    authPending=false;
    if(user && user.uid===cloud.TEACHER_UID){
      teacherUser=user;loginMessage('Ingreso autorizado.');
      $('#cloud-status').textContent='Cargando crucigramas online…';
      show('teacher');
      try{await loadCloud();}catch(err){
        console.error('Error de Firestore:',err);
        $('#cloud-status').textContent='No se pudo sincronizar. Comprobá conexión y reglas de Firestore.';
        toast('Firebase no pudo cargar los crucigramas.');
      }
    }else{
      teacherUser=null;puzzles=[SAMPLE];cloudEntries=[];refreshPuzzleSelector();
      if(user){await cloud.auth.signOut();loginMessage('Cuenta no autorizada para este panel.',true)}
      else loginMessage('Usá el correo y la contraseña del profesor.');
      if(['teacher','editor'].some(s=>$('#screen-'+s).classList.contains('active')))show('login');
    }
  },error=>{authPending=false;loginMessage('No se pudo verificar la sesión. Comprobá tu conexión.',true)});
}else loginMessage(cloud.reason,true);

let editingId=null;
const editorRows=()=>[...$('#editor-questions').querySelectorAll('.question-row')];
function addQuestionRow(clue='',answer=''){
  const row=document.createElement('div');row.className='question-row';
  const number=document.createElement('span');number.className='question-number';
  const inputClue=document.createElement('input');inputClue.className='clue-field';inputClue.placeholder='Escribí la pista...';inputClue.maxLength=300;inputClue.required=true;inputClue.value=clue;inputClue.setAttribute('aria-label','Pregunta o pista');
  const inputAnswer=document.createElement('input');inputAnswer.className='answer-field';inputAnswer.placeholder='Respuesta';inputAnswer.maxLength=32;inputAnswer.required=true;inputAnswer.value=answer;inputAnswer.setAttribute('aria-label','Respuesta correcta');
  const remove=document.createElement('button');remove.className='delete-question';remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Eliminar pregunta');
  remove.addEventListener('click',()=>{row.remove();renumberQuestions()});
  row.append(number,inputClue,inputAnswer,remove);$('#editor-questions').append(row);renumberQuestions();
}
function renumberQuestions(){editorRows().forEach((row,i)=>row.querySelector('.question-number').textContent=`${i+1}.`)}
function openEditor(id=null){
  if(!isTeacher()){show('login');return}
  const puzzle=puzzles.find(p=>p.id===id);editingId=puzzle?.id||null;
  $('#editor-title').textContent=puzzle?'Editar crucigrama':'Nuevo crucigrama';
  $('#puzzle-title').value=puzzle?.title||'';$('#puzzle-description').value=puzzle?.description||'';
  $('#editor-questions').replaceChildren();
  (puzzle?.questions||[{clue:'',answer:''},{clue:'',answer:''},{clue:'',answer:''}]).forEach(q=>addQuestionRow(q.clue,q.answer));
  show('editor');
}
async function saveEditor(event){
  event.preventDefault();
  if(!isTeacher()){show('login');return}
  const title=$('#puzzle-title').value.trim(),description=$('#puzzle-description').value.trim();
  const questions=editorRows().map(row=>({clue:row.querySelector('.clue-field').value.trim(),answer:row.querySelector('.answer-field').value.trim()}));
  if(title.length<3){toast('El título debe tener al menos 3 letras.');return}
  if(questions.length<2){toast('Agregá al menos 2 preguntas.');return}
  if(questions.some(q=>!q.clue||!q.answer)){toast('Completá las pistas y respuestas de todas las filas.');return}
  if(questions.some(q=>!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+$/.test(q.answer)||normalize(q.answer).length<2||normalize(q.answer).length>32)){
    toast('Las respuestas deben tener entre 2 y 32 letras. No uses números ni símbolos.');return;
  }
  const answers=questions.map(q=>normalize(q.answer));
  if(new Set(answers).size!==answers.length){toast('Hay respuestas repetidas. Cada respuesta debe ser diferente.');return}
  const layout=buildCrossword(questions);
  if(layout.unused.length){
    alert(`No se pudieron cruzar estas palabras: ${layout.unused.join(', ')}.\n\nCambiá alguna respuesta por otra que comparta letras con las demás. No se guardó todavía.`);return;
  }
  // Usa claves únicas para mantener separados crucigramas distintos.
  const id=editingId||`cruci-${Date.now()}-${Math.floor(Math.random()*10000)}`;
  const puzzle={id,title,description,questions};
  const index=puzzles.findIndex(p=>p.id===id);
  if(index>=0 && entries().some(x=>x.puzzleId===id) && !confirm('Este crucigrama ya tiene resultados de prueba. Si cambiás las respuestas, esos puntajes corresponderán a una versión anterior. ¿Guardar de todos modos?'))return;
  const submit=$('#editor-form button[type="submit"]');submit.disabled=true;
  try{
    await cloud.db.collection('crucigramas').doc(id).set(puzzle);
    if(index>=0)puzzles[index]=puzzle;else puzzles.push(puzzle);
    puzzles.sort((a,b)=>a.title.localeCompare(b.title,'es'));
    state.activePuzzleId=id;refreshPuzzleSelector();renderTeacher();show('teacher');
    $('#cloud-status').textContent='Crucigrama guardado en Firebase.';
    toast('¡Guardado en Firebase! Se verá en otros dispositivos con la cuenta de Juan.');
  }catch(err){console.error(err);toast('No se pudo guardar online. No se perdieron los datos del formulario.');}
  finally{submit.disabled=false;}
}
function teacherButton(label,callback,variant='btn-outline'){
  const button=document.createElement('button');button.type='button';button.className=`btn ${variant}`;button.textContent=label;button.addEventListener('click',callback);return button;
}
function renderTeacher(){
  const cards=$('#teacher-puzzles');cards.replaceChildren();
  if(!puzzles.length){const empty=document.createElement('p');empty.className='teacher-empty';empty.textContent='Todavía no hay crucigramas. Creá el primero con el botón violeta.';cards.append(empty)}
  puzzles.forEach(p=>{
    const card=document.createElement('article');card.className='teacher-card';
    const emblem=document.createElement('div');emblem.className='teacher-symbol';emblem.textContent='🧩';
    const title=document.createElement('h3');title.textContent=p.title;
    const description=document.createElement('p');description.textContent=p.description||'Sin descripción';
    const count=document.createElement('span');count.className='teacher-pill';count.textContent=`${p.questions.length} preguntas`;
    const actions=document.createElement('div');actions.className='teacher-card-actions';
    actions.append(teacherButton('✎ Editar',()=>openEditor(p.id)),teacherButton('▶ Probar',()=>{state.activePuzzleId=p.id;refreshPuzzleSelector();show('register')},'btn-primary'),teacherButton('Eliminar',async()=>{
      if(!isTeacher())return;
      if(!confirm(`¿Eliminar «${p.title}» de Firebase? Esta acción borrará las preguntas de todos los dispositivos. Los resultados históricos quedarán conservados.`))return;
      try{
        await cloud.db.collection('crucigramas').doc(p.id).delete();
        puzzles=puzzles.filter(x=>x.id!==p.id);
        if(state.activePuzzleId===p.id)state.activePuzzleId=puzzles[0]?.id||null;
        refreshPuzzleSelector();renderTeacher();toast('Crucigrama eliminado de Firebase.');
      }catch(err){console.error(err);toast('No se pudo eliminar el crucigrama online.');}
    }));
    card.append(emblem,title,description,count,actions);cards.append(card);
  });
  renderTeacherResults();
}
function renderTeacherResults(){
  const target=$('#teacher-results-table');target.replaceChildren();const data=entries().slice().reverse();
  if(!data.length){const msg=document.createElement('p');msg.className='results-summary';msg.textContent='Todavía no hay resultados de prueba. Los resultados de alumnos llegarán al habilitar los QR y el acceso público seguro.';target.append(msg);return}
  const scroll=document.createElement('div');scroll.className='results-scroll';
  const table=document.createElement('table');table.className='local-results-table';
  const thead=document.createElement('thead');const hrow=document.createElement('tr');
  ['Alumno','Crucigrama','Aciertos','Tiempo','Fecha','Detalle'].forEach(t=>{const th=document.createElement('th');th.textContent=t;hrow.append(th)});thead.append(hrow);table.append(thead);
  const body=document.createElement('tbody');
  for(const item of data){
    const row=document.createElement('tr');
    const title=puzzles.find(p=>p.id===(item.puzzleId||SAMPLE_ID))?.title||'Crucigrama anterior';
    const date=item.date?new Date(item.date).toLocaleDateString('es-AR'):'—';
    const texts=[item.name||'—',title,`${item.correct}/${item.total}`,timeLabel(item.seconds),date];
    texts.forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(i===0&&item.course){const small=document.createElement('small');small.textContent=item.course;td.append(small)}row.append(td)});
    const more=document.createElement('td');const details=teacherButton('Ver',()=>{
      const open=detailRow.hidden;detailRow.hidden=!open;details.textContent=open?'Ocultar':'Ver';
    });more.append(details);row.append(more);body.append(row);
    const detailRow=document.createElement('tr');detailRow.hidden=true;const detailCell=document.createElement('td');detailCell.colSpan=6;detailCell.className='teacher-detail';
    const errors=item.incorrect||[];
    if(!errors.length){detailCell.textContent='Todas las respuestas correctas.'}
    else errors.forEach(error=>{const p=document.createElement('p');p.textContent=`${error.clue}: respondió «${error.given||'En blanco'}» · solución «${error.solution}»`;detailCell.append(p)});
    detailRow.append(detailCell);body.append(detailRow);
  }
  table.append(body);scroll.append(table);target.append(scroll);
}
function exportPuzzles(){
  const data={type:'CruciAulaPuzzles',version:1,puzzles};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='CruciAula-mis-crucigramas.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
  toast('Copia descargada. Tus crucigramas siguen guardados en Firebase.');
}
async function importPuzzles(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{
    if(file.size>1024*1024)throw Error('El archivo es demasiado grande.');
    const parsed=JSON.parse(await file.text());
    if(parsed?.type!=='CruciAulaPuzzles'||!Array.isArray(parsed.puzzles))throw Error('No es un archivo de CruciAula.');
    const imported=parsed.puzzles.map(p=>({id:String(p.id),title:String(p.title),description:String(p.description||''),questions:p.questions.map(q=>({clue:String(q.clue),answer:String(q.answer)}))}));
    if(imported.length>150||imported.some(p=>p.id.length>80||p.title.length<3||p.title.length>100||p.questions.length<2||p.questions.length>80||p.questions.some(q=>q.clue.length<1||q.clue.length>300||normalize(q.answer).length<2||normalize(q.answer).length>32)))throw Error('El archivo contiene preguntas o títulos inválidos.');
    if(!confirm(`Se importarán ${imported.length} crucigramas. Los que tengan el mismo identificador reemplazarán a los guardados aquí. ¿Continuar?`))return;
    if(!isTeacher())throw Error('Iniciá sesión con la cuenta docente.');
    const batches=[];for(let i=0;i<imported.length;i+=400){const batch=cloud.db.batch();imported.slice(i,i+400).forEach(p=>batch.set(cloud.db.collection('crucigramas').doc(p.id),p));batches.push(batch)}
    for(const batch of batches)await batch.commit();
    await loadCloud();toast('¡Crucigramas importados y guardados online!');
  }catch(error){alert(`No se pudo importar el archivo. ${error.message}`)}
}
$('#new-puzzle').addEventListener('click',()=>openEditor());
$('#add-question').addEventListener('click',()=>addQuestionRow());
$('#editor-back').addEventListener('click',()=>{renderTeacher();show('teacher')});
$('#cancel-editor').addEventListener('click',()=>{renderTeacher();show('teacher')});
$('#editor-form').addEventListener('submit',saveEditor);
$('#export-puzzles').addEventListener('click',exportPuzzles);
$('#import-file').addEventListener('change',importPuzzles);
$('#recover-local').addEventListener('click',async()=>{
  if(!isTeacher())return;
  const old=localPuzzles();
  if(!old.length){toast('No encontré crucigramas anteriores en este navegador.');return;}
  if(!confirm(`Se encontraron ${old.length} crucigrama(s) de versiones anteriores. ¿Querés subirlos a Firebase?`))return;
  try{
    const valid=old.filter(p=>p?.id&&p?.title&&Array.isArray(p.questions));
    const batches=[];for(let i=0;i<valid.length;i+=400){const batch=cloud.db.batch();valid.slice(i,i+400).forEach(p=>batch.set(cloud.db.collection('crucigramas').doc(String(p.id)),p));batches.push(batch)}
    for(const batch of batches)await batch.commit();
    await loadCloud();toast('¡Crucigramas anteriores recuperados en Firebase!');
  }catch(err){console.error(err);toast('No se pudo recuperar. Descargá una copia de seguridad antes de reintentar.');}
});
refreshPuzzleSelector();
// Ayuda al QA automático sin exponer datos o privilegiar a ningún jugador.
window.CruciAulaDemo={buildCrossword,source:PREGUNTAS,getPuzzles:()=>puzzles};
