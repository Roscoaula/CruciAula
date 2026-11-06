/* CruciAula: dos modalidades en un panel. Evaluación sin feedback y práctica
 * con validación segura de palabras por Firestore. Proyecto independiente. */
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
const state = {activePuzzleId:null, mode:'evaluacion', student: null, words: [], cells: new Map(), selected: null, direction:'h', answers:new Map(), feedback:new Map(), previewEditing:false, validating:false, startedAt:0, interval:null, elapsed:0, running:false};
const STORAGE = 'cruciaula_demo_resultados_v1'; // Conserva las partidas previas.
const PUZZLE_STORAGE = 'cruciaula_demo_crucigramas_v1';
const SAMPLE_ID = 'deportes-ejemplo';
const SAMPLE = {id:SAMPLE_ID,title:'Deportes y periodismo',description:'Básquet, automovilismo y comunicación deportiva',questions:PREGUNTAS};
// El parámetro ?juego= aparece únicamente cuando se escanea el QR del profesor.
const urlParams = new URLSearchParams(window.location.search);
const sharedPuzzleId = (urlParams.get('juego')||'').trim();
const MODES = Object.freeze({EVALUACION:'evaluacion', PRACTICA:'practica'});
const requestedStudentMode = urlParams.get('modo')===MODES.PRACTICA ? MODES.PRACTICA : MODES.EVALUACION;
const modeTitle = mode => mode===MODES.PRACTICA ? 'Modalidad 2 — Práctica con corrección' : 'Modalidad 1 — Evaluación';
// La modalidad evaluación conserva los IDs históricos para no perder entregas.
const attemptId = (puzzleId, uid, mode) => mode===MODES.PRACTICA
  ? `${puzzleId}_practica_${uid}` : `${puzzleId}_${uid}`;
const entryMode = (docId, entry) => docId.endsWith(`_practica_${entry.uid}`) ? MODES.PRACTICA : MODES.EVALUACION;
let teacherMode = MODES.EVALUACION;
let guestPuzzle = null;
let qrGuest = false;
let sharePuzzleId = null;
let authReadyResolve;
const authReady = new Promise(resolve => { authReadyResolve = resolve; });

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
  const [data,records,submissions,solutions]=await Promise.all([
    cloud.db.collection('crucigramas').get(),
    cloud.db.collection('resultados').get(),
    cloud.db.collection('entregas').get(),
    cloud.db.collection('soluciones').get()
  ]);
  if(!isTeacher())return;
  puzzles=data.docs.map(doc=>({...doc.data(),id:doc.id})).sort((a,b)=>a.title.localeCompare(b.title,'es'));
  const keys=new Map(solutions.docs.map(doc=>[doc.id,doc.data().answers||{}]));
  const onlineEntries=submissions.docs.map(doc=>{
    const s=doc.data(),sol=keys.get(s.puzzleId)||{},correctKeys=Object.keys(sol);
    const incorrect=correctKeys.filter(id=>normalize(s.answers?.[id]||'')!==sol[id]).map(id=>({clue:'Pista '+id,given:s.answers?.[id]||'',solution:sol[id]}));
    const start=s.startedAt?.toMillis?.(),end=s.submittedAt?.toMillis?.();
    return {puzzleId:s.puzzleId,mode:entryMode(doc.id,s),name:s.name,course:s.course,answers:s.answers||{},total:correctKeys.length,
      correct:correctKeys.length-incorrect.length,incorrect,
      seconds:Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/1000)):NaN,
      date:new Date(end||Date.now()).toISOString(),at:end||Date.now(),origin:'alumno'};
  }).filter(e=>Number.isFinite(e.seconds));
  cloudEntries=records.docs.map(doc=>({...doc.data(),mode:doc.data().mode||MODES.EVALUACION,origin:'profesor'})).filter(e=>Number.isFinite(e.seconds)).concat(onlineEntries);
  refreshPuzzleSelector();renderTeacher();
  $('#cloud-status').textContent=`Sincronizado · ${puzzles.length} crucigramas y ${cloudEntries.length} resultados.`;
}

function activePuzzle(){return qrGuest ? guestPuzzle : (puzzles.find(p=>p.id===state.activePuzzleId)||puzzles[0])}
function refreshPuzzleSelector(){
  const selector=$('#select-puzzle');const previous=selector.value;selector.replaceChildren();
  puzzles.forEach(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.title;selector.append(option)});
  selector.value=(state.activePuzzleId&&puzzles.some(p=>p.id===state.activePuzzleId)?state.activePuzzleId:(puzzles.some(p=>p.id===previous)?previous:puzzles[0]?.id||''));
  $('#form-student button[type=submit]').disabled=qrGuest ? !guestPuzzle : !puzzles.length;
}

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z]/g,'').toUpperCase();
const key = (r,c) => `${r},${c}`;
const htmlSafe = (s) => String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
const timeLabel = (seconds) => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('on');clearTimeout(toast._tid);toast._tid=setTimeout(()=>el.classList.remove('on'),3600)}
function show(name){
  // La URL general es el área docente; la portada de estudiantes SOLO existe en ?juego=.
  if(name==='home' && !sharedPuzzleId)name=isTeacher()?'teacher':'login';
  if(['teacher','editor'].includes(name)&&!isTeacher())name='login';
  $$('.screen').forEach(e=>e.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
  window.scrollTo({top:0,behavior:'instant'});
}
function finishStartup(){
  // Quitar el protector únicamente después de decidir qué pantalla debe verse.
  document.documentElement.classList.remove('boot-pending');
  $('#startup-splash').hidden=true;
}
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
  // En QR se usa la grilla ya publicada SIN soluciones ni respuestas.
  const puzzle=qrGuest ? {
    ...selected.layout,
    cells:new Map(selected.layout.words.flatMap(w=>Array.from({length:w.length},(_,i)=>[
      key(w.row+(w.dir==='v'?i:0),w.col+(w.dir==='h'?i:0)),true
    ]))),unused:[]
  } : buildCrossword(selected.questions);
  if(!puzzle.words.length){toast('Este crucigrama no tiene palabras para jugar.');return}
  $('#game-title').textContent=selected.title;
  const practice = state.mode===MODES.PRACTICA;
  $('#game-mode-badge').textContent=modeTitle(state.mode);
  $('#game-description').textContent=practice
    ? 'Si una palabra está mal, aparece en rojo. Corregila y avanzá cuando aciertes.'
    : 'Respondé y avanzá sin ver si está bien o mal. La corrección llega al finalizar.';
  $('#board-help').textContent=practice
    ? 'Las respuestas equivocadas se marcan en rojo. Corregilas para avanzar.'
    : 'Podés cambiar tus respuestas antes de entregar. No se muestran aciertos durante el juego.';
  $('#fill-answer').textContent=practice?'Comprobar y seguir →':'Guardar y siguiente →';
  $('#game-note').textContent=practice
    ? 'Se marca en rojo si está mal; las soluciones completas se muestran después de entregar.'
    : 'No se indica si está bien o mal hasta que entregues. Podés volver a una pista y cambiarla.';
  state.words=puzzle.words;state.cells=puzzle.cells;state.rows=puzzle.rows;state.cols=puzzle.cols;
  state.answers=new Map();state.feedback=new Map();state.previewEditing=false;state.validating=false;state.direction='h';state.selected=state.words.find(w=>w.dir==='h')?.id??state.words[0]?.id;
  show('game');startClock();renderBoard();renderClues();selectWord(state.selected);
  if(puzzle.unused.length)console.info('No encajaron estas palabras:',puzzle.unused.join(', '));
}
function getWord(id){return state.words.find(w=>w.id===id)}
function wordKeys(w){return Array.from({length:w.length},(_,i)=>key(w.row+(w.dir==='v'?i:0),w.col+(w.dir==='h'?i:0)))}
function renderBoard(){
  const grid=$('#crossword');grid.style.setProperty('--cols',state.cols);grid.textContent='';
  // En el celular, ajustamos las casillas al ancho disponible y permitimos
  // deslizar una grilla excepcionalmente larga sin perder la pregunta.
  if(window.innerWidth<=700){
    const usableWidth=Math.max(210,window.innerWidth-74);
    const size=Math.max(10,Math.min(27,Math.floor(usableWidth/Math.max(1,state.cols))));
    grid.style.setProperty('--mobile-cell-size',`${size}px`);
  }else grid.style.removeProperty('--mobile-cell-size');
  const nums=new Map();const fills=new Map();
  const active=getWord(state.selected);
  const preview=window.innerWidth<=700 && state.previewEditing && active;
  state.words.forEach(w=>{
    nums.set(key(w.row,w.col),w.number);
    if(preview && w.id===active.id)return;
    const current=state.answers.get(w.id)||'';
    wordKeys(w).forEach((k,i)=>{if(current[i])fills.set(k,current[i])});
  });
  if(preview){
    const typed=normalize($('#clue-answer').value);
    wordKeys(active).forEach((k,i)=>{if(typed[i])fills.set(k,typed[i])});
  }
  const activeKeys=new Set(active?wordKeys(active):[]);
  const incorrectKeys=new Set(active && !preview && state.feedback.get(active.id)==='incorrect' ? wordKeys(active) : []);
  const fragment=document.createDocumentFragment();
  for(let r=0;r<state.rows;r++)for(let c=0;c<state.cols;c++){
    const k=key(r,c),cell=document.createElement('button');cell.type='button';cell.className='cell';
    if(!state.cells.has(k)){cell.classList.add('empty');cell.disabled=true;cell.setAttribute('aria-hidden','true')}
    else {
      if(activeKeys.has(k))cell.classList.add('selected');
      if(incorrectKeys.has(k))cell.classList.add('incorrect');
      if(fills.has(k)){cell.classList.add('filled');cell.appendChild(document.createTextNode(fills.get(k)))}
      if(nums.has(k)){const n=document.createElement('span');n.className='num';n.textContent=nums.get(k);cell.appendChild(n)}
      cell.setAttribute('aria-label',`Casillero fila ${r+1}, columna ${c+1}`);
      cell.addEventListener('click',()=>{
        const options=state.words.filter(w=>wordKeys(w).includes(k));
        const preferred=options.find(w=>w.dir===state.direction)??options[0];
        if(preferred)selectWord(preferred.id,true);
      });
    }
    fragment.append(cell);
  }
  grid.append(fragment);renderProgress();
  // La fila o columna en uso queda centrada dentro de la grilla desplazable.
  if(window.innerWidth<=700 && active){
    const middle=Math.floor((active.length-1)/2);
    const r=active.row+(active.dir==='v'?middle:0);
    const c=active.col+(active.dir==='h'?middle:0);
    const cell=grid.children[r*state.cols+c];
    const scroller=grid.parentElement;
    if(cell && scroller){
      const a=cell.getBoundingClientRect(),b=scroller.getBoundingClientRect();
      scroller.scrollLeft+=(a.left+a.width/2)-(b.left+b.width/2);
      scroller.scrollTop+=(a.top+a.height/2)-(b.top+b.height/2);
    }
  }
}
function renderClues(){
  const horizontal=state.direction==='h';$('#tab-across').classList.toggle('selected',horizontal);$('#tab-down').classList.toggle('selected',!horizontal);
  const clues=$('#clue-list');clues.textContent='';
  state.words.filter(w=>w.dir===state.direction).sort((a,b)=>a.number-b.number).forEach(w=>{
    const item=document.createElement('button');item.type='button';item.className='clue';
    if(state.selected===w.id)item.classList.add('selected');
    if(state.feedback.get(w.id)==='incorrect')item.classList.add('incorrect');
    else if(['correct','answered'].includes(state.feedback.get(w.id)))item.classList.add('answered');
    const n=document.createElement('span');n.textContent=`${w.number}.`;
    const t=document.createElement('span');t.textContent=w.clue;
    item.append(n,t);item.addEventListener('click',()=>selectWord(w.id,true));clues.append(item);
  });
}
function selectWord(id,scrollToAnswer=false){
  const w=getWord(id);if(!w)return;
  state.selected=id;state.direction=w.dir;state.previewEditing=false;
  $('#active-clue-text').textContent=`${w.number}. ${w.clue}`;
  $('#clue-selected-label').textContent=`${w.number}. ${w.dir==='h'?'Horizontal':'Vertical'} · ${w.length} letras`;
  $('#clue-answer').value=state.answers.get(w.id)||'';
  showWordFeedback(state.mode===MODES.PRACTICA && state.feedback.get(w.id)==='incorrect' ? 'incorrect' : '');
  renderClues();renderBoard();
  // Al tocar una casilla o elegir una pista, se acerca la zona de respuesta
  // sin ocultar el tablero que queda fijo arriba durante el juego.
  if(scrollToAnswer && window.innerWidth<=700){
    requestAnimationFrame(()=>$('#active-clue-text').scrollIntoView({block:'start',behavior:'smooth'}));
  }
}
function renderProgress(){
  // El progreso ahora indica respuestas validadas correctamente.
  const answered=state.words.filter(w=>state.feedback.get(w.id)===(state.mode===MODES.PRACTICA?'correct':'answered')).length,total=state.words.length;
  $('#progress-bar').style.width=`${(answered/total)*100||0}%`;
  $('#progress-text').textContent=`${answered}/${total}`;
}
function showWordFeedback(status, message=''){
  const input=$('#clue-answer'),label=$('#answer-feedback');
  input.classList.toggle('is-incorrect',status==='incorrect');
  input.setAttribute('aria-invalid',status==='incorrect'?'true':'false');
  label.classList.toggle('incorrect',status==='incorrect');
  label.textContent=message || (status==='incorrect'?'Respuesta incorrecta. Revisá las letras e intentá otra vez.':'');
}
function nextWordAfter(currentId){
  const ordered=[...state.words].sort((a,b)=>a.number-b.number||a.dir.localeCompare(b.dir));
  const index=ordered.findIndex(w=>w.id===currentId);
  for(let step=1;step<ordered.length;step++){
    const w=ordered[(index+step)%ordered.length];
    if(state.feedback.get(w.id)!==(state.mode===MODES.PRACTICA?'correct':'answered'))return w;
  }
  return null;
}
async function fillAnswer(){
  if(state.validating)return;
  const w=getWord(state.selected);if(!w)return;
  state.previewEditing=false;
  const response=normalize($('#clue-answer').value);
  if(state.mode===MODES.EVALUACION){
    if(!response){toast('Escribí una respuesta o elegí otra pista.');return;}
    // Evaluación: guardar la respuesta sin compararla ni mostrar colores de acierto/error.
    state.answers.set(w.id,response);
    state.feedback.set(w.id,'answered');
    showWordFeedback('');
    const next=nextWordAfter(w.id);
    if(next)selectWord(next.id,true);
    else {renderClues();renderBoard();showWordFeedback('', 'Respuestas cargadas. Revisalas o entregá para ver tu puntaje.');}
    return;
  }
  const typed=$('#clue-answer');
  const fail=()=>{
    state.answers.set(w.id,response);
    state.feedback.set(w.id,'incorrect');
    renderClues();renderBoard();
    showWordFeedback('incorrect');
    typed.focus();
  };
  if(!response || response.length!==w.length){fail();return;}
  state.validating=true;
  const save=$('#fill-answer'),finishButton=$('#finish-game');
  save.disabled=true;finishButton.disabled=true;
  showWordFeedback('', 'Verificando respuesta…');
  try{
    if(qrGuest){
      const user=cloud.auth.currentUser;
      if(!user?.isAnonymous)throw Error('No se pudo identificar al alumno.');
      // Firestore valida la palabra contra el documento privado /soluciones.
      // Una escritura correcta se acepta; una equivocada se rechaza.
      // El alumno NUNCA recibe la respuesta correcta en esta validación.
      const wordId=String(w.id);
      const checkId=`${attemptId(state.activePuzzleId,user.uid,MODES.PRACTICA)}_${wordId}`;
      await cloud.db.collection('verificaciones').doc(checkId).set({
        uid:user.uid,puzzleId:state.activePuzzleId,wordId,answer:response
      });
    }else if(response!==w.answer){
      fail();return;
    }
    state.answers.set(w.id,response);
    state.feedback.set(w.id,'correct');
    showWordFeedback('');
    const next=nextWordAfter(w.id);
    if(next)selectWord(next.id,true);
    else {renderClues();renderBoard();showWordFeedback('', '¡Todas las palabras están correctas! Ya podés finalizar.');}
  }catch(err){
    if(qrGuest && err.code==='permission-denied'){
      // Una respuesta errónea es rechazada por las reglas. Si se instaló
      // solo el JS, una respuesta correcta también se rechazaría:
      // publicar primero las nuevas reglas de Firestore.
      fail();
    }else{
      console.error('Verificación de palabra:',err);
      showWordFeedback('', 'No pudimos verificar esta respuesta. Comprobá tu conexión e intentá otra vez.');
    }
  }finally{
    state.validating=false;
    save.disabled=false;finishButton.disabled=false;
  }
}
async function finish(){
  const total=state.words.length;
  const pending=state.words.filter(w=>!(state.answers.get(w.id)||'').length).length;
  if(pending && !confirm(`Hay ${pending} ${pending===1?'respuesta sin completar':'respuestas sin completar'}. ¿Querés entregar de todos modos?`))return;
  updateClock();
  if(qrGuest){
    const finishButton=$('#finish-game');finishButton.disabled=true;
    try{
      const user=cloud.auth.currentUser;
      if(!user||!user.isAnonymous)throw Error('Abrí el enlace de alumno en una ventana de incógnito.');
      const answers=Object.fromEntries(state.words.map(w=>[String(w.id),state.answers.get(w.id)||'']));
      const entryId=attemptId(state.activePuzzleId,user.uid,state.mode);
      const startSnap=await cloud.db.collection('inicios').doc(entryId).get();
      if(!startSnap.exists)throw Error('No se encontró el inicio de la partida.');
      await cloud.db.collection('entregas').doc(entryId).set({
        puzzleId:state.activePuzzleId,uid:user.uid,
        name:`${state.student.first} ${state.student.last}`,course:state.student.course||'',
        answers,startedAt:startSnap.data().startedAt,
        submittedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      stopClock();
      const solutionsSnap=await cloud.db.collection('soluciones').doc(state.activePuzzleId).get();
      if(!solutionsSnap.exists)throw Error('Se registró tu entrega, pero no se pudieron recuperar las correcciones.');
      const solutions=solutionsSnap.data().answers||{};
      const incorrect=state.words.filter(w=>answers[String(w.id)]!==solutions[String(w.id)]).map(w=>({
        number:w.number,direction:w.dir,clue:w.clue,given:answers[String(w.id)]||'',solution:solutions[String(w.id)]||'(consultar al profesor)'
      }));
      const sentSnap=await cloud.db.collection('entregas').doc(entryId).get();
      const startMs=startSnap.data().startedAt?.toMillis?.();
      const finishMs=sentSnap.data()?.submittedAt?.toMillis?.();
      const serverSeconds=Number.isFinite(startMs)&&Number.isFinite(finishMs)?Math.max(0,Math.floor((finishMs-startMs)/1000)):state.elapsed;
      const entry={puzzleId:state.activePuzzleId,mode:state.mode,name:`${state.student.first} ${state.student.last}`,course:state.student.course,seconds:serverSeconds,
        total,correct:total-incorrect.length,incorrect,at:Date.now(),date:new Date().toISOString()};
      renderRanking(false,entry);show('results');
      // El botón de inicio no ofrece otra partida después de entregar.
      $('#btn-play').disabled=true;
      $('#home-mode').textContent='ACTIVIDAD FINALIZADA · '+modeTitle(requestedStudentMode);
      $('#home-card-detail').textContent='Tu entrega quedó registrada. No podés volver a comenzar esta actividad.';
      toast('¡Entrega guardada online!');
    }catch(err){
      console.error('Entrega de alumno:',err);
      alert(`No se pudo completar la entrega: ${err.message}. Si ya se guardó, no vuelvas a enviarla: avisale a Juan.`);
    }finally{finishButton.disabled=false;}
    return;
  }
  stopClock();
  const incorrect=state.words.filter(w=>state.answers.get(w.id)!==w.answer).map(w=>({
    number:w.number,direction:w.dir,clue:w.clue,given:state.answers.get(w.id)||'',solution:w.answer
  }));
  const correct=total-incorrect.length;
  const entry={puzzleId:state.activePuzzleId,mode:state.mode,name:`${state.student.first} ${state.student.last}`,course:state.student.course,
    seconds:state.elapsed,total,correct,incorrect,date:new Date().toISOString(),at:Date.now()};
  if(isTeacher()){
    try{
      await cloud.db.collection('resultados').add(entry);
      cloudEntries.push(entry);
    }catch(err){console.error(err);toast('No pudimos guardar esta prueba en Firebase. Revisá la conexión.');}
  }else{
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
  // Participan todas las entregas, incluso si hubo respuestas equivocadas.
  const ranking=entries()
    .filter(x=>(x.puzzleId||SAMPLE_ID)===state.activePuzzleId && (x.mode||MODES.EVALUACION)===state.mode && x.total>0 && Number.isFinite(x.seconds))
    .sort(compareResults);
  $('#results-ranking-header').hidden=qrGuest;
  $('#ranking-podium').hidden=qrGuest;
  $('#ranking-rest').hidden=qrGuest;
  $('#results-title').textContent=onlyRanking?(isTeacher()?'Clasificación de pruebas del profesor':'Clasificación local'):'¡Crucigrama entregado!';
  $('#result-name').textContent=onlyRanking?`Actividad: ${activePuzzle()?.title||'Sin título'} · ${isTeacher()?'Pruebas sincronizadas en Firebase.':'Pruebas locales de este navegador.'}`:`${recent.name} · ${recent.course||'Sin comisión'}`;
  $('.stat-grid').style.display=onlyRanking?'none':'grid';$('.result-trophy').textContent=onlyRanking?'🏅':'🏆';
  $('#result-explain').textContent=onlyRanking?'':`Tu resultado fue ${recent.correct}/${recent.total}. El ranking se ordena por aciertos y luego por tiempo.`;
  renderIncorrect(onlyRanking?null:recent);
  if(recent){$('#final-time').textContent=timeLabel(recent.seconds);$('#final-correct').textContent=`${recent.correct}/${recent.total}`;$('#final-percent').textContent=`${Math.round(100*recent.correct/recent.total)}%`;}
  const podium=$('#ranking-podium'),rest=$('#ranking-rest');podium.textContent='';rest.textContent='';
  if(!ranking.length){const msg=document.createElement('p');msg.textContent='Todavía no hay entregas registradas.';msg.className='muted';podium.append(msg);return;}
  ranking.forEach((item,i)=>{
    const card=document.createElement('div');card.className=`rank-card ${['gold','silver','bronze'][i]||''}`;
    if(recent&&item.at===recent.at)card.classList.add('highlight');
    const medal=document.createElement('span');medal.className='rank-medal';medal.textContent=['🥇','🥈','🥉'][i]||`${i+1}.`;
    const name=document.createElement('div');name.innerHTML=`<strong>${htmlSafe(item.name)}</strong><span class="rank-subtitle">${htmlSafe(item.course||'Sin comisión')}</span>`;
    const tm=document.createElement('span');tm.className='rank-time';tm.textContent=timeLabel(item.seconds);
    card.append(medal,name,tm);(i<3?podium:rest).append(card);
  });
}

$('#btn-play').addEventListener('click',()=>{
  if(qrGuest){
    // QR → portada → Jugar → nombre, apellido y comisión → comenzar.
    if(!guestPuzzle){toast('Todavía se está cargando la actividad.');return}
    $('#select-puzzle').replaceChildren(new Option(guestPuzzle.title,guestPuzzle.id));
    $('#shared-activity-info').textContent='Actividad: '+guestPuzzle.title;
    $('#shared-activity-info').hidden=false;
    $('#select-puzzle-label').hidden=true;
    $('#select-puzzle').hidden=true;
    $('#course').required=true;
    $('#course-required-label').textContent='(obligatorio)';
    $('#form-student button[type=submit]').disabled=false;
  }else{
    state.mode=teacherMode;
    refreshPuzzleSelector();
    $('#select-puzzle-label').hidden=false;
    $('#select-puzzle').hidden=false;
    $('#shared-activity-info').hidden=true;
    $('#course').required=false;
    $('#course-required-label').textContent='(opcional en la demo)';
  }
  show('register');
});
$('#nav-home').addEventListener('click',()=>show('home'));
$('#nav-how').addEventListener('click',()=>toast('El QR abre nombre, apellido y curso obligatorios. En Evaluación no se corrige hasta entregar; en Práctica hay corrección roja inmediata.'));
$('#nav-teacher').addEventListener('click',()=>{if(isTeacher()){renderTeacher();show('teacher')}else{show('login');$('#teacher-email').focus()}});
$('#btn-ranking-home').addEventListener('click',()=>{state.activePuzzleId=state.activePuzzleId||puzzles[0]?.id;if(!state.activePuzzleId){toast('No hay crucigramas todavía.');return}renderRanking(true);show('results')});
$$('[data-go="home"]').forEach(el=>el.addEventListener('click',()=>show('home')));
$('#form-student').addEventListener('submit',async e=>{
  e.preventDefault();
  const first=$('#first-name').value.trim(),last=$('#last-name').value.trim(),course=$('#course').value.trim();
  if(!first||!last||(qrGuest&&!course)){toast('Completá nombre, apellido y curso/comisión.');return}
  const submit=$('#form-student button[type=submit]');submit.disabled=true;
  state.student={first,last,course};state.mode=qrGuest?requestedStudentMode:teacherMode;state.activePuzzleId=qrGuest ? guestPuzzle.id : $('#select-puzzle').value;
  try{
    if(qrGuest){
      const user=cloud.auth.currentUser;
      if(!user?.isAnonymous)throw Error('Abrí el QR en otra ventana sin iniciar sesión como profesor.');
      const entryId=attemptId(guestPuzzle.id,user.uid,state.mode);
      const startRef=cloud.db.collection('inicios').doc(entryId);
      const old=await cloud.db.collection('entregas').doc(entryId).get();
      if(old.exists)throw Error('Esta actividad ya fue entregada desde este dispositivo.');
      // Si no hay entrega, el alumno puede comenzar de cero, aun si abrió
      // anteriormente esta actividad. El inicio nuevo se registra en el servidor.
      // Las reglas de Firestore permiten sobrescribir solo su propio inicio,
      // y únicamente mientras NO exista la entrega final.
      await startRef.set({uid:user.uid,puzzleId:guestPuzzle.id,startedAt:firebase.firestore.FieldValue.serverTimestamp()});
    }
    newGame();
  }catch(err){console.error('Inicio de partida:',err);alert('No se pudo comenzar: '+err.message)}
  finally{submit.disabled=false}
});
$('#tab-across').addEventListener('click',()=>{state.direction='h';selectWord(state.words.find(w=>w.dir==='h')?.id,true)});
$('#tab-down').addEventListener('click',()=>{state.direction='v';selectWord(state.words.find(w=>w.dir==='v')?.id,true)});
$('#fill-answer').addEventListener('click',fillAnswer);
$('#clue-answer').addEventListener('input',()=>{if(state.feedback.get(state.selected)==='incorrect')showWordFeedback('');if(window.innerWidth<=700){state.previewEditing=true;renderBoard();}});
$('#clue-answer').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();fillAnswer()}});
$('#clear-answer').addEventListener('click',()=>{
  $('#clue-answer').value='';state.previewEditing=false;
  state.answers.delete(state.selected);state.feedback.delete(state.selected);
  showWordFeedback('');renderClues();renderBoard();$('#clue-answer').focus();
});
$('#finish-game').addEventListener('click',finish);
$('#show-wrong').addEventListener('click',()=>{const p=$('#wrong-answers-panel'),opening=p.hidden;p.hidden=!opening;$('#show-wrong').setAttribute('aria-expanded',String(opening));});
$('#leave-game').addEventListener('click',()=>{
  if(!confirm(qrGuest
    ? 'Si salís sin entregar, se perderán tus respuestas. Podrás volver a empezar desde 00:00. ¿Querés salir?'
    : '¿Querés salir? Se perderá el avance de esta partida.'))return;
  stopClock();state.answers.clear();
  show(qrGuest?'register':'home');
});
$('#back-to-home').addEventListener('click',()=>show('home'));
$('#brand').addEventListener('click',e=>{
  e.preventDefault();
  if(state.running&&!confirm('Si salís sin entregar, perderás tu avance. Podrás volver a comenzar desde cero. ¿Querés salir?'))return;
  stopClock();state.answers.clear();show('home');
});
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
  try{await cloud.auth.signOut();teacherUser=null;show('login');toast('Sesión docente cerrada.');}
  catch(err){toast('No se pudo cerrar sesión. Probá de nuevo.');}
});
if(cloud.ready){
  cloud.auth.onAuthStateChanged(async user=>{
    authPending=false;
    if(authReadyResolve){authReadyResolve();authReadyResolve=null;}
    if(user && user.uid===cloud.TEACHER_UID){
      teacherUser=user;loginMessage('Ingreso autorizado.');
      $('#cloud-status').textContent='Cargando crucigramas online…';
      if(!sharedPuzzleId){
        puzzles=[];refreshPuzzleSelector();renderTeacher();
        show('teacher');finishStartup();
      }
      try{await loadCloud();}catch(err){
        console.error('Error de Firestore:',err);
        $('#cloud-status').textContent='No se pudo sincronizar. Comprobá conexión y reglas de Firestore.';
        toast('Firebase no pudo cargar los crucigramas.');
      }
    }else{
      teacherUser=null;puzzles=[SAMPLE];cloudEntries=[];refreshPuzzleSelector();
      if(user && !user.isAnonymous){await cloud.auth.signOut();loginMessage('Cuenta no autorizada para este panel.',true)}
      else loginMessage('Usá el correo y la contraseña del profesor.');
      if(!sharedPuzzleId){show('login');finishStartup();}
    }
  },error=>{
    authPending=false;
    loginMessage('No se pudo verificar la sesión. Comprobá tu conexión.',true);
    if(!sharedPuzzleId){show('login');finishStartup();}
    if(authReadyResolve){authReadyResolve();authReadyResolve=null;}
  });
}else {
  loginMessage(cloud.reason,true);
  if(!sharedPuzzleId){show('login');finishStartup();}
  if(authReadyResolve){authReadyResolve();authReadyResolve=null;}
}

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
    // Si Juan cambia un crucigrama publicado, invalidamos su QR hasta republicarlo.
    // Esto evita servir una versión vieja con soluciones que ya no corresponden.
    const batch=cloud.db.batch();
    batch.set(cloud.db.collection('crucigramas').doc(id),puzzle);
    if(puzzles[index]?.published){
      batch.set(cloud.db.collection('publicos').doc(id),{published:false},{merge:true});
    }
    await batch.commit();
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
function setTeacherMode(mode){
  if(!Object.values(MODES).includes(mode))return;
  teacherMode=mode;
  for(const candidate of Object.values(MODES)){
    const button=document.querySelector(`[data-teacher-mode="${candidate}"]`);
    button?.classList.toggle('selected',candidate===mode);
    button?.setAttribute('aria-selected',String(candidate===mode));
  }
  $('#teacher-mode-explain').textContent=mode===MODES.PRACTICA
    ? 'Los alumnos ven en rojo lo incorrecto y corrigen hasta acertar. Cada crucigrama tiene un QR propio para practicar.'
    : 'Los alumnos responden sin pistas de acierto o error. Las soluciones aparecen únicamente al entregar.';
  $('#teacher-current-mode').textContent=modeTitle(mode);
  renderTeacher();
}
$$('[data-teacher-mode]').forEach(button=>button.addEventListener('click',()=>setTeacherMode(button.dataset.teacherMode)));
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
    actions.append(teacherButton('✎ Editar',()=>openEditor(p.id)),teacherButton('▶ Probar',()=>{state.mode=teacherMode;state.activePuzzleId=p.id;refreshPuzzleSelector();show('register')},'btn-primary'),teacherButton(p.published?`▦ QR ${teacherMode===MODES.PRACTICA?'Práctica':'Evaluación'}`:'▦ Publicar QR',()=>publishOrShare(p)),teacherButton('Eliminar',async()=>{
      if(!isTeacher())return;
      if(!confirm(`¿Eliminar «${p.title}» de Firebase? Esta acción borrará las preguntas de todos los dispositivos. Los resultados históricos quedarán conservados.`))return;
      try{
        // Quitar el acceso público y el crucigrama docente en una sola operación.
        const batch=cloud.db.batch();
        batch.delete(cloud.db.collection('publicos').doc(p.id));
        batch.delete(cloud.db.collection('crucigramas').doc(p.id));
        await batch.commit();
        puzzles=puzzles.filter(x=>x.id!==p.id);
        if(state.activePuzzleId===p.id)state.activePuzzleId=puzzles[0]?.id||null;
        refreshPuzzleSelector();renderTeacher();toast('Crucigrama eliminado de Firebase.');
      }catch(err){console.error(err);toast('No se pudo eliminar el crucigrama online.');}
    }));
    card.append(emblem,title,description,count,actions);cards.append(card);
  });
  renderTeacherResults();
}
/** Vista docente: reconstruye el tablero con las respuestas realmente entregadas.
 * No hace lecturas públicas ni modifica el ranking o las entregas en Firebase.
 */
function renderSubmittedCrossword(entry){
  const wrapper=document.createElement('div');wrapper.className='submitted-crossword';
  const heading=document.createElement('h4');heading.textContent=`🧩 Crucigrama entregado por ${entry.name||'Alumno'}`;
  wrapper.append(heading);
  const subtitle=document.createElement('p');subtitle.className='submitted-crossword-subtitle';
  subtitle.textContent=`${entry.course||'Sin curso'} · ${entry.correct}/${entry.total} correctas · ${timeLabel(entry.seconds)} · ${modeTitle(entry.mode||MODES.EVALUACION)}`;
  wrapper.append(subtitle);
  if(!entry.answers || typeof entry.answers!=='object'){
    const empty=document.createElement('p');empty.textContent='Las letras de esta entrega no están disponibles en el registro.';wrapper.append(empty);return wrapper;
  }
  const source=puzzles.find(p=>p.id===entry.puzzleId);
  if(!source?.questions?.length){
    const empty=document.createElement('p');empty.textContent='Este crucigrama ya no está disponible para reconstruir su tablero. El detalle de las respuestas sigue disponible en «Ver».';wrapper.append(empty);return wrapper;
  }
  const layout=buildCrossword(source.questions);
  if(!layout.words?.length){const empty=document.createElement('p');empty.textContent='No se pudo reconstruir la grilla.';wrapper.append(empty);return wrapper;}
  const letters=new Map(),starts=new Map(),markedWrong=new Set(),occupied=new Set();
  for(const w of layout.words){
    const first=key(w.row,w.col);
    starts.set(first,w.number);
    const submitted=normalize(entry.answers[String(w.id)]||'');
    const incorrect=submitted.length>0 && submitted!==w.answer;
    for(let i=0;i<w.length;i++){
      const address=key(w.row+(w.dir==='v'?i:0),w.col+(w.dir==='h'?i:0));
      occupied.add(address);
      // Igual que en el tablero de juego, las palabras cruzadas comparten casillas.
      if(submitted[i])letters.set(address,submitted[i]);
      if(incorrect)markedWrong.add(address);
    }
  }
  const scroll=document.createElement('div');scroll.className='submitted-crossword-scroll';
  scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Tablero entregado');scroll.tabIndex=0;
  const grid=document.createElement('div');grid.className='submitted-crossword-grid';
  grid.style.setProperty('--submitted-cols',String(layout.cols));
  for(let r=0;r<layout.rows;r++)for(let c=0;c<layout.cols;c++){
    const address=key(r,c),cell=document.createElement('div');
    cell.className='submitted-crossword-cell';
    if(!occupied.has(address)){cell.classList.add('is-outside');cell.setAttribute('aria-hidden','true');}
    else {
      if(markedWrong.has(address))cell.classList.add('is-wrong');
      if(!letters.has(address))cell.classList.add('is-unanswered');
      cell.textContent=letters.get(address)||'';
      if(starts.has(address)){
        const number=document.createElement('span');number.className='submitted-crossword-number';
        number.textContent=starts.get(address);cell.append(number);
      }
    }
    grid.append(cell);
  }
  scroll.append(grid);wrapper.append(scroll);
  const legend=document.createElement('p');legend.className='submitted-crossword-legend';
  legend.textContent='Rojo: palabra equivocada · Casillas vacías: letras sin completar. Las letras muestran lo que entregó el alumno.';
  wrapper.append(legend);
  const note=document.createElement('p');note.className='submitted-crossword-note';
  note.textContent='La grilla se reconstruye con la versión actual del crucigrama. Si Juan editó las preguntas después de esta entrega, la distribución podría ser distinta de la original.';
  wrapper.append(note);
  return wrapper;
}

function compareResults(a,b){
  return (Number(b.correct)||0)-(Number(a.correct)||0)
    || (Number(a.seconds)||0)-(Number(b.seconds)||0)
    || (Number(a.at)||0)-(Number(b.at)||0);
}
function renderTeacherResults(){
  const target=$('#teacher-results-table');target.replaceChildren();
  // La lista principal contiene TODAS las entregas del alumnado, incluso incompletas.
  // No se usa .slice(), ni se agrupan alumnos con el mismo nombre: no se pierde ningún registro.
  const submissions=cloudEntries.filter(e=>e.origin==='alumno' && (e.mode||MODES.EVALUACION)===teacherMode && e.total>0 && Number.isFinite(e.seconds));
  const count=$('#teacher-student-count');
  if(count)count.textContent=`${submissions.length} ${submissions.length===1?'entrega':'entregas'} · ${teacherMode==='practica'?'Práctica':'Evaluación'}`;
  if(!submissions.length){
    const empty=document.createElement('p');empty.className='results-summary';
    empty.textContent=`Todavía no hay entregas en ${modeTitle(teacherMode)}. Aparecerán aquí cuando finalicen.`;
    target.append(empty);
  }else{
    const grouped=new Map();
    for(const entry of submissions){
      if(!grouped.has(entry.puzzleId))grouped.set(entry.puzzleId,[]);
      grouped.get(entry.puzzleId).push(entry);
    }
    const orderedGroups=[...grouped].sort(([idA],[idB])=>
      (puzzles.find(p=>p.id===idA)?.title||idA).localeCompare(puzzles.find(p=>p.id===idB)?.title||idB,'es'));
    for(const [puzzleId,records] of orderedGroups){
      const ranked=records.sort(compareResults);
      const section=document.createElement('section');section.className='student-ranking-section';
      const head=document.createElement('div');head.className='student-ranking-heading';
      const h=document.createElement('h3');h.textContent='🏆 '+(puzzles.find(p=>p.id===puzzleId)?.title||'Crucigrama anterior');
      const total=document.createElement('span');total.className='student-ranking-total';
      total.textContent=`${ranked.length} ${ranked.length===1?'entrega':'entregas'}`;
      head.append(h,total);
      const hint=document.createElement('p');hint.className='student-ranking-hint';
      hint.textContent='Orden: más respuestas correctas y, en caso de empate, menor tiempo. Todos los alumnos aparecen en el listado.';
      const scroll=document.createElement('div');scroll.className='results-scroll';
      const table=document.createElement('table');table.className='local-results-table student-ranking-table';
      const header=document.createElement('thead');const headerRow=document.createElement('tr');
      ['Puesto','Alumno','Curso','Aciertos','Tiempo','Respuestas'].forEach(text=>{
        const th=document.createElement('th');th.textContent=text;headerRow.append(th);
      });
      header.append(headerRow);table.append(header);
      const body=document.createElement('tbody');
      ranked.forEach((entry,index)=>{
        const row=document.createElement('tr');
        if(index<3)row.classList.add('podium-row',`podium-rank-${index+1}`);
        const position=document.createElement('td');position.className='podium-position';
        position.textContent=index<3?`${['🥇','🥈','🥉'][index]} ${index+1}.º`:`${index+1}.º`;
        const name=document.createElement('td');name.className='rank-student-name';name.textContent=entry.name||'Sin nombre';
        const course=document.createElement('td');course.textContent=entry.course||'—';
        const score=document.createElement('td');score.className='rank-score';score.textContent=`${entry.correct}/${entry.total}`;
        const time=document.createElement('td');time.className='rank-time';time.textContent=timeLabel(entry.seconds);
        const detailCell=document.createElement('td');
        const detailRow=document.createElement('tr');detailRow.hidden=true;
        const detailContent=document.createElement('td');detailContent.colSpan=6;detailContent.className='teacher-detail';
        const mistakes=entry.incorrect||[];
        if(!mistakes.length)detailContent.textContent='¡Todas las respuestas son correctas!';
        else for(const error of mistakes){
          const p=document.createElement('p');
          p.textContent=`${error.clue}: respondió «${error.given||'En blanco'}» · solución «${error.solution}»`;
          detailContent.append(p);
        }
        detailRow.append(detailContent);
        const button=teacherButton('Ver',()=>{
          const opening=detailRow.hidden;detailRow.hidden=!opening;
          button.textContent=opening?'Ocultar':'Ver';
          button.setAttribute('aria-expanded',String(opening));
        });
        button.classList.add('rank-details-button');button.setAttribute('aria-expanded','false');
        const crosswordRow=document.createElement('tr');crosswordRow.hidden=true;
        const crosswordContent=document.createElement('td');crosswordContent.colSpan=6;crosswordContent.className='teacher-detail';
        crosswordRow.append(crosswordContent);
        const boardButton=teacherButton('Ver crucigrama',()=>{
          const opening=crosswordRow.hidden;
          if(opening && !crosswordContent.hasChildNodes())crosswordContent.append(renderSubmittedCrossword(entry));
          crosswordRow.hidden=!opening;
          boardButton.textContent=opening?'Ocultar crucigrama':'Ver crucigrama';
          boardButton.setAttribute('aria-expanded',String(opening));
        });
        boardButton.classList.add('rank-details-button','rank-board-button');
        boardButton.setAttribute('aria-expanded','false');
        detailCell.classList.add('rank-actions-cell');
        detailCell.append(button,boardButton);
        row.append(position,name,course,score,time,detailCell);
        body.append(row,detailRow,crosswordRow);
      });
      table.append(body);scroll.append(table);section.append(head,hint,scroll);target.append(section);
    }
  }
  const practices=cloudEntries.filter(e=>e.origin!=='alumno' && (e.mode||MODES.EVALUACION)===teacherMode && Number.isFinite(e.seconds));
  if(practices.length){
    const details=document.createElement('details');details.className='practice-history';
    const title=document.createElement('summary');title.textContent=`Pruebas anteriores del profesor (${practices.length})`;
    const list=document.createElement('div');
    practices.sort((a,b)=>(b.at||0)-(a.at||0)).forEach(item=>{
      const p=document.createElement('p');p.textContent=`${item.name||'Prueba'} · ${item.correct}/${item.total} aciertos · ${timeLabel(item.seconds)}`;
      list.append(p);
    });
    details.append(title,list);target.append(details);
  }
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
// Publicación controlada: el documento público NO contiene soluciones.
async function publishOrShare(p){
  if(!isTeacher())return;
  if(!p.published){
    const grid=buildCrossword(p.questions);
    if(grid.unused.length){alert('Faltan palabras para cruzar: '+grid.unused.join(', '));return}
    if(!confirm(`¿Publicar «${p.title}» para que los alumnos entren por QR?`))return;
    const layout={rows:grid.rows,cols:grid.cols,words:grid.words.map(w=>({id:w.id,row:w.row,col:w.col,dir:w.dir,length:w.length,number:w.number,clue:w.clue}))};
    const solutions=Object.fromEntries(grid.words.map(w=>[String(w.id),w.answer]));
    try{
      const batch=cloud.db.batch();
      batch.set(cloud.db.collection('publicos').doc(p.id),{id:p.id,title:p.title,description:p.description||'',published:true,layout});
      batch.set(cloud.db.collection('soluciones').doc(p.id),{answers:solutions});
      batch.update(cloud.db.collection('crucigramas').doc(p.id),{published:true});
      await batch.commit();
      p.published=true;renderTeacher();
    }catch(e){console.error(e);alert('No se pudo publicar: '+e.message);return}
  }
  sharePuzzleId=p.id;
  // Siempre generar QR ONLINE; jamás hacia file:/// en una PC de edición.
  const link=new URL('https://roscoaula.github.io/CruciAula/');
  link.searchParams.set('juego',p.id);
  link.searchParams.set('modo',teacherMode);
  $('#share-mode-title').textContent=modeTitle(teacherMode);
  $('#share-link').value=link.href;
  $('#share-modal').hidden=false;
  const display=$('#share-qr');display.replaceChildren();
  if(window.QRCode){
    new QRCode(display,{text:link.href,width:200,height:200,correctLevel:QRCode.CorrectLevel.M});
  }else{
    display.textContent='No se cargó el generador de QR. Copiá el enlace o volvé a abrir la página con internet.';
  }
}
$('#share-close').addEventListener('click',()=>{$('#share-modal').hidden=true});
$('#share-copy').addEventListener('click',async()=>{
  const link=$('#share-link').value;
  try{await navigator.clipboard.writeText(link);toast('Enlace copiado.')}catch{const input=$('#share-link');input.focus();input.select();toast('Copiá el enlace seleccionado con Ctrl+C.');}
});

// Acceso vía enlace exclusivo de un crucigrama; las pistas se publican SIN respuestas.
async function loadStudentAccess(puzzleId){
  if(!cloud.ready){
    $('#home-mode').textContent='SIN CONEXIÓN';
    $('#home-card-title').textContent='No pudimos conectar Firebase';
    $('#home-card-detail').textContent='Comprobá tu conexión y volvé a abrir el QR.';
    $('#btn-play').disabled=true;
    show('home');finishStartup();return;
  }
  // Seguimos la misma secuencia que el diagnóstico de acceso que pasó las 3 pruebas.
  // Hacemos lecturas DESDE EL SERVIDOR para evitar discrepancias por datos en caché.
  let etapa='autenticación del alumno';
  try{
    const usuario=cloud.auth.currentUser || (await cloud.auth.signInAnonymously()).user;
    if(usuario?.uid===cloud.TEACHER_UID){
      throw Error('El profesor ya tiene sesión iniciada. Abrí el enlace en incógnito para probar como alumno.');
    }
    if(!usuario?.isAnonymous)throw Error('No se pudo habilitar el acceso anónimo.');
    await usuario.getIdToken();
    const leer=async (ref)=>{
      try {return await ref.get({source:'server'});}
      catch(err){
        if(err.code!=='permission-denied')throw err;
        // Un único reintento tras actualizar el token, nunca cambiamos el UID.
        await usuario.getIdToken(true);
        return ref.get({source:'server'});
      }
    };
    etapa='lectura del crucigrama publicado';
    const doc=await leer(cloud.db.collection('publicos').doc(puzzleId));
    if(!doc.exists || doc.data()?.published!==true){
      throw Error('El crucigrama no está publicado o el enlace no corresponde a una actividad disponible.');
    }
    guestPuzzle={...doc.data(),id:doc.id};qrGuest=true;
    state.mode=requestedStudentMode;
    if(!guestPuzzle.layout?.words?.length)throw Error('Este crucigrama no tiene grilla.');
    state.activePuzzleId=guestPuzzle.id;
    etapa='comprobación de entrega anterior';
    const previous=await leer(cloud.db.collection('entregas').doc(attemptId(guestPuzzle.id,usuario.uid,requestedStudentMode)));
    if(previous.exists){
      const sub=previous.data();
      etapa='lectura de corrección de una entrega previa';
      const sol=await leer(cloud.db.collection('soluciones').doc(guestPuzzle.id));
      const words=guestPuzzle.layout.words;
      const correctMap=sol.data()?.answers||{};
      const incorrect=words.filter(w=>normalize(sub.answers?.[String(w.id)]||'')!==correctMap[String(w.id)]).map(w=>({number:w.number,direction:w.dir,clue:w.clue,given:sub.answers?.[String(w.id)]||'',solution:correctMap[String(w.id)]||''}));
      const start=sub.startedAt?.toMillis?.(),end=sub.submittedAt?.toMillis?.();
      state.elapsed=(Number.isFinite(start)&&Number.isFinite(end))?Math.max(0,Math.floor((end-start)/1000)):0;
      const entry={name:sub.name,mode:requestedStudentMode,course:sub.course,total:words.length,correct:words.length-incorrect.length,incorrect,seconds:state.elapsed};
      $('#home-mode').textContent='ACTIVIDAD FINALIZADA · '+modeTitle(requestedStudentMode);
      $('#home-card-title').textContent=guestPuzzle.title;
      $('#home-card-detail').textContent='Ya entregaste esta actividad. Podés revisar tus resultados.';
      $('#home-hint').textContent='Tu entrega ya quedó registrada.';
      $('#btn-play').textContent='✓ Ver mis resultados';
      $('#btn-play').onclick=()=>{renderRanking(false,entry);show('results')};
      $('#btn-ranking-home').hidden=true;
      $('#nav-teacher').hidden=true;
      $('#btn-play').disabled=false;
      show('home');
    }else{
      $('#home-mode').textContent=modeTitle(requestedStudentMode);
      $('#home-card-title').textContent=guestPuzzle.title;
      $('#home-card-detail').textContent=guestPuzzle.description||'¡Bienvenido! Prepará tus conocimientos para completar este crucigrama.';
      $('#home-hint').textContent='Completá nombre, apellido y curso para comenzar. Si salís sin entregar, podrás volver a empezar.';
      $('#btn-play').innerHTML='▶ &nbsp; Jugar <span aria-hidden="true">→</span>';
      $('#btn-play').disabled=false;
      $('#btn-ranking-home').hidden=true;
      $('#nav-teacher').hidden=true;
      $('#select-puzzle').replaceChildren(new Option(guestPuzzle.title,guestPuzzle.id));
      $('#select-puzzle').hidden=true;
      $('#select-puzzle-label').hidden=true;
      $('#shared-activity-info').textContent='Actividad: '+guestPuzzle.title;
      $('#shared-activity-info').hidden=false;
      $('#course').required=true;
      $('#course-required-label').textContent='(obligatorio)';
      // QR → formulario obligatorio directamente. Conservamos la portada violeta como encabezado de la actividad.
      $('#register-mode').textContent=modeTitle(requestedStudentMode);
      $('#register-intro').textContent=requestedStudentMode===MODES.PRACTICA
        ? 'Práctica con corrección: las respuestas incorrectas se marcarán en rojo. El reloj empieza al comenzar.'
        : 'Evaluación: verás las soluciones y tu puntaje solo después de entregar. El reloj empieza al comenzar.';
      show('register');
    }
  }catch(e){console.error('CruciAula QR con modalidades:',etapa,e);
    $('#home-mode').textContent='PROBLEMA AL CARGAR LA ACTIVIDAD';
    $('#home-card-title').textContent='No pudimos abrir el crucigrama';
    $('#home-card-detail').textContent=`Error en ${etapa}: ${e.message}`;
    $('#home-hint').textContent='Si vuelve a aparecer, compartí este mensaje exacto con quien configura CruciAula.';
    $('#btn-play').disabled=true;show('home');
  }finally{finishStartup();}
}
if(sharedPuzzleId){
  $('#home-mode').textContent='CARGANDO ACTIVIDAD';
  $('#home-card-title').textContent='Preparando tu crucigrama…';
  $('#home-card-detail').textContent='Estamos buscando la actividad que compartió tu profesor.';
  $('#home-hint').textContent='No hace falta crear una cuenta para jugar.';
  $('#btn-play').textContent='Cargando…';
  $('#btn-play').disabled=true;
  $('#btn-ranking-home').hidden=true;
  $('#nav-teacher').hidden=true;
  authReady.then(()=>loadStudentAccess(sharedPuzzleId));
}
refreshPuzzleSelector();
// Ayuda al QA automático sin exponer datos o privilegiar a ningún jugador.
window.CruciAulaDemo={buildCrossword,source:PREGUNTAS,getPuzzles:()=>puzzles};

// Ajuste visual al rotar o cambiar el tamaño del teléfono; no altera las entregas.
window.addEventListener('resize',()=>{if($('#screen-game').classList.contains('active') && state.words.length)renderBoard();});
