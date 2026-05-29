"use strict";
/* ====== État global ====== */
const ME = window.CURRENT_USER;
const IS_ADMIN = ME.is_admin;
let state = {
  projects: [], tasks: [], users: [], absences: [], alerts: [],
  currentProject: localStorage.getItem('atelier_curproj') || null,
  filterStatus: 'all'
};
let pendingDocItems = [];

/* ====== Helpers ====== */
const $ = id => document.getElementById(id);
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function today(){return new Date().toISOString().slice(0,10);}
function addDays(n){return new Date(Date.now()+n*864e5).toISOString().slice(0,10);}
function daysBetween(a,b){return Math.round((new Date(b)-new Date(a))/864e5);}
function fmtDate(d){if(!d)return '—';const p=d.split('-');return p[2]+'/'+p[1]+'/'+p[0];}
const AVA = ['#e8642f','#f3a712','#2e9e5b','#2f7fd6','#9b59b6','#e0729a','#1aa89a'];
function avaColor(id){let h=0;const s=String(id);for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%AVA.length;return AVA[h];}
function initials(n){return n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();}
function userById(id){return state.users.find(u=>u.id===id);}
function userName(id){const u=userById(id);return u?u.name:'Non assigné';}
function projById(id){return state.projects.find(p=>p.id==id);}
function projTasks(){return state.tasks.filter(t=>t.project_id==state.currentProject);}
const STATUS_LABEL={todo:'À faire',prog:'En cours',done:'Terminé'};
const STATUS_COLOR={todo:'#8a8478',prog:'#2f7fd6',done:'#2e9e5b'};
const PRIO_LABEL={h:'Haute',m:'Moyenne',l:'Basse'};
const PRIO_WEIGHT={h:3,m:2,l:1};
function isLate(t){return t.status!=='done' && t.due_date && t.due_date<today();}
function isAbsentNow(uid){return state.absences.some(a=>a.user_id===uid && a.from_date<=today() && a.to_date>=today());}
function canEditTask(t){return IS_ADMIN || t.assignee_id===ME.id;}

/* ====== API ====== */
async function api(path, opts={}){
  opts.headers = opts.headers || {};
  if(opts.body && typeof opts.body!=='string'){
    opts.headers['Content-Type']='application/json';
    opts.body=JSON.stringify(opts.body);
  }
  const r = await fetch(path, opts);
  if(!r.ok){
    let msg = `Erreur ${r.status}`;
    try{const j=await r.json(); msg = j.detail || msg;}catch{}
    throw new Error(msg);
  }
  return r.status===204 ? null : r.json();
}

async function loadAll(){
  try{
    const [projects, users, absences] = await Promise.all([
      api('/api/projects'), api('/api/users'), api('/api/absences')
    ]);
    state.projects = projects;
    state.users = users;
    state.absences = absences;
    if(!state.currentProject && projects.length) state.currentProject = projects[0].id;
    if(state.currentProject){
      state.tasks = await api('/api/tasks');
      state.alerts = await api('/api/alerts');
    }
    renderAll();
  }catch(e){alert('Erreur de chargement : '+e.message);}
}

/* ====== Render ====== */
function renderAll(){
  renderProjBar();
  renderStats();
  renderDash();
  renderSynth();
  renderTasks();
  renderTeam();
  renderAbsences();
  renderAlerts();
}

function renderProjBar(){
  const sel=$('projSelect');
  if(!state.projects.length){sel.innerHTML='<option value="">Aucun projet</option>';return;}
  sel.innerHTML = state.projects.map(p=>`<option value="${p.id}"${p.id==state.currentProject?' selected':''}>${esc(p.name)}</option>`).join('');
}

function projectProgress(){
  const ts=projTasks();
  if(!ts.length)return {pct:0,done:0,prog:0,todo:0,late:0,total:0};
  let wsum=0,wdone=0;
  ts.forEach(t=>{const w=PRIO_WEIGHT[t.priority]||2;wsum+=w;wdone+=w*((t.progress||0)/100);});
  return {
    pct:Math.round(wdone/wsum*100),
    done:ts.filter(t=>t.status==='done').length,
    prog:ts.filter(t=>t.status==='prog').length,
    todo:ts.filter(t=>t.status==='todo').length,
    late:ts.filter(isLate).length,
    total:ts.length
  };
}
function projectHealth(){
  const ts=projTasks(),late=ts.filter(isLate).length;
  const soon=ts.filter(t=>t.status!=='done'&&t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=3).length;
  if(late>0)return {label:'En difficulté',color:'var(--bad)',ic:'🔴'};
  if(soon>0)return {label:'À surveiller',color:'var(--warn)',ic:'🟠'};
  return {label:'En bonne voie',color:'var(--ok)',ic:'🟢'};
}

function renderStats(){
  const p=projectProgress();
  $('statRow').innerHTML=
    `<div class="stat"><div class="n">${p.total}</div><div class="l">Tâches</div></div>`+
    `<div class="stat accent"><div class="n">${p.prog}</div><div class="l">En cours</div></div>`+
    `<div class="stat"><div class="n">${p.done}</div><div class="l">Terminées</div></div>`+
    `<div class="stat ${p.late?'bad':''}"><div class="n">${p.late}</div><div class="l">En retard</div></div>`+
    `<div class="stat"><div class="n">${p.pct}%</div><div class="l">Avancement</div></div>`;
}

function renderDash(){
  const ts=projTasks();
  $('dashProgress').innerHTML = ts.length===0 ? '<div class="empty">Aucune tâche dans ce projet.</div>' :
    ts.map(t=>`<div style="margin-bottom:14px"><div class="row" style="justify-content:space-between"><strong>${esc(t.title)}</strong><span class="meta">${t.progress||0}%${isLate(t)?' · <span style="color:var(--bad)">retard</span>':''}</span></div><div class="progress"><i style="width:${t.progress||0}%"></i></div></div>`).join('');
  const al = state.alerts;
  $('dashAlerts').innerHTML = al.length ? al.slice(0,5).map(alertHTML).join('') : '<div class="empty">Aucune alerte active 🎉</div>';
}

function renderTasks(){
  const list=projTasks().filter(t=>state.filterStatus==='all'||t.status===state.filterStatus);
  const el=$('taskList');
  if(list.length===0){el.innerHTML='<div class="empty">Aucune tâche. Clique sur « Nouvelle tâche ».</div>';return;}
  el.innerHTML = list.map(t=>{
    const late=isLate(t), st=late?'late':t.status, lbl=late?'En retard':STATUS_LABEL[t.status];
    const assignee=userById(t.assignee_id);
    const canRemind=late && assignee && assignee.email;
    const canEdit=canEditTask(t);
    return `<div class="card"><div class="bar" style="background:${late?'var(--bad)':STATUS_COLOR[t.status]}"></div>
      <div class="row" style="justify-content:space-between"><span class="tag ${st}">${lbl}</span><span class="prio ${t.priority}">● ${PRIO_LABEL[t.priority]}</span></div>
      <h3 style="margin-top:8px">${esc(t.title)}</h3>${t.description?`<div class="meta">${esc(t.description)}</div>`:''}
      <div class="meta">👤 ${esc(userName(t.assignee_id))}${isAbsentNow(t.assignee_id)?' <span class="pill absent">absent</span>':''}</div>
      <div class="meta">📅 ${fmtDate(t.due_date)}</div>
      <div class="progress"><i style="width:${t.progress||0}%"></i></div>
      <div class="row" style="justify-content:flex-end;margin-top:10px">
        ${canRemind?`<button class="btn sm danger" data-remind="${t.id}">✉ Relancer</button>`:''}
        ${canEdit?`<button class="btn sm ghost" data-edit-task="${t.id}">Modifier</button><button class="btn sm ghost" data-del-task="${t.id}">Supprimer</button>`:''}
      </div></div>`;
  }).join('');
}

function renderTeam(){
  const el=$('teamList');
  if(state.users.length===0){el.innerHTML='<div class="empty">Aucun membre.</div>';return;}
  el.innerHTML=state.users.map(u=>{
    const n=state.tasks.filter(t=>t.assignee_id===u.id && t.status!=='done').length;
    const absent=isAbsentNow(u.id);
    return `<div class="card"><div class="person"><div class="ava" style="background:${avaColor(u.id)}">${initials(u.name)}</div>
      <div style="flex:1"><h3 style="font-size:16px">${esc(u.name)}</h3><div class="meta">${u.role==='admin'?'Administrateur':'Utilisateur'}</div></div></div>
      <div class="meta" style="margin-top:10px">✉ ${esc(u.email)}</div>
      <div class="row" style="margin-top:8px"><span class="pill">${n} tâche(s) active(s)</span>
        ${absent?`<span class="pill absent">Absent aujourd&#39;hui</span>`:`<span class="pill ok">Disponible</span>`}
        ${u.role==='admin'?'<span class="pill admin">Admin</span>':''}
      </div>
      ${IS_ADMIN?`<div class="row" style="justify-content:flex-end;margin-top:10px">
        <button class="btn sm ghost" data-edit-person="${u.id}">Modifier</button>
        ${u.id!==ME.id?`<button class="btn sm ghost" data-del-person="${u.id}">Supprimer</button>`:''}
      </div>`:''}
    </div>`;
  }).join('');
}

function renderAbsences(){
  const el=$('absList');
  if(state.absences.length===0){el.innerHTML='<tr><td colspan="6" class="empty">Aucune absence déclarée.</td></tr>';return;}
  el.innerHTML=state.absences.map(a=>{
    const now=a.from_date<=today() && a.to_date>=today(), future=a.from_date>today();
    const status=now?'<span class="pill absent">En cours</span>':future?'<span class="pill">À venir</span>':'<span class="pill">Passée</span>';
    const canDel=IS_ADMIN || a.user_id===ME.id;
    return `<tr><td>${esc(userName(a.user_id))}</td><td>${esc(a.kind)}</td><td>${fmtDate(a.from_date)}</td><td>${fmtDate(a.to_date)}</td><td>${status}</td><td>${canDel?`<button class="x" data-del-abs="${a.id}">✕</button>`:''}</td></tr>`;
  }).join('');
}

function renderAlerts(){
  const al = state.alerts;
  $('alertList').innerHTML = al.length ? al.map(alertHTML).join('') : '<div class="empty">Aucune alerte active. Tout est sous contrôle 🎉</div>';
  const b=$('alertBadge'); b.textContent=al.length; b.classList.toggle('hidden',al.length===0);
  $('btnAckAll').classList.toggle('hidden', al.length===0);
}
function alertHTML(a){
  const canRemind = a.kind==='late' && a.assignee_email;
  return `<div class="alert ${a.type}"><div class="ic">${a.ic||'⚠'}</div>
    <div class="ri-body"><strong>${esc(a.title)}</strong><div class="meta">${esc(a.msg)}</div></div>
    <div class="row" style="gap:6px">
      ${canRemind?`<button class="btn sm danger" data-remind="${a.task_id}">✉ Relancer</button>`:''}
      <button class="btn sm ghost" data-ack="${a.key}">✓ Acquitter</button>
    </div></div>`;
}

/* ====== Synthèse + Gantt ====== */
function renderSynth(){
  const proj=projById(state.currentProject);
  const c=$('synthContent');
  if(!proj){c.innerHTML='<div class="empty">Aucun projet sélectionné.</div>';return;}
  $('synthTitle').textContent='Synthèse — '+proj.name;
  const pp=projectProgress(), health=projectHealth(), ts=projTasks();
  let html='';
  html+='<div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:18px">';
  html+=`<div class="panel"><div class="l" style="color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:1px">Santé du projet</div><div style="font-family:Fraunces;font-size:24px;font-weight:900;margin-top:6px;color:${health.color}">${health.ic} ${health.label}</div></div>`;
  html+=`<div class="panel"><div class="l" style="color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:1px">Avancement pondéré</div><div style="font-family:Fraunces;font-size:24px;font-weight:900;margin-top:6px">${pp.pct}%</div><div class="progress big"><i style="width:${pp.pct}%"></i></div></div>`;
  html+=`<div class="panel"><div class="l" style="color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:1px">État des tâches</div><div style="margin-top:8px;font-size:13px;line-height:1.7">✅ Terminées : <strong>${pp.done}</strong><br>🔵 En cours : <strong>${pp.prog}</strong><br>⚪ À faire : <strong>${pp.todo}</strong><br>🔴 En retard : <strong>${pp.late}</strong></div></div>`;
  html+='</div>';
  if(proj.description)html+=`<div class="panel" style="margin-bottom:18px"><strong>Description</strong><div class="meta" style="margin-top:6px">${esc(proj.description)}</div></div>`;
  html+=`<div class="panel" style="margin-bottom:18px"><div class="sec-h"><h2 style="font-size:18px">Diagramme de Gantt</h2></div>${buildGantt(ts)}</div>`;
  html+='<div class="panel"><div class="sec-h"><h2 style="font-size:18px">Détail des tâches</h2></div><div style="overflow:auto"><table><thead><tr><th>Tâche</th><th>Responsable</th><th>Priorité</th><th>Début</th><th>Échéance</th><th>Statut</th><th>%</th></tr></thead><tbody>';
  if(!ts.length)html+='<tr><td colspan="7" class="empty">Aucune tâche.</td></tr>';
  ts.forEach(t=>{const late=isLate(t);
    html+=`<tr><td>${esc(t.title)}</td><td>${esc(userName(t.assignee_id))}</td><td>${PRIO_LABEL[t.priority]}</td><td>${fmtDate(t.start_date)}</td><td${late?' style="color:var(--bad);font-weight:700"':''}>${fmtDate(t.due_date)}</td><td>${late?'En retard':STATUS_LABEL[t.status]}</td><td>${t.progress||0}%</td></tr>`;});
  html+='</tbody></table></div></div>';
  c.innerHTML=html;
}
function buildGantt(ts){
  const dated=ts.filter(t=>t.start_date && t.due_date);
  if(!dated.length)return '<div class="empty">Ajoute des dates de début et d\'échéance aux tâches pour afficher le Gantt.</div>';
  let min=dated[0].start_date,max=dated[0].due_date;
  dated.forEach(t=>{if(t.start_date<min)min=t.start_date;if(t.due_date>max)max=t.due_date;});
  const d0=new Date(min),d1=new Date(max);
  const span=Math.max(1,daysBetween(min,max));
  const months=[]; let cur=new Date(d0.getFullYear(),d0.getMonth(),1);
  while(cur<=d1){months.push(new Date(cur));cur.setMonth(cur.getMonth()+1);}
  const MN=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
  let head='<div class="gantt-head"><div class="gantt-label">Tâche</div>';
  months.forEach(m=>{head+=`<div class="gantt-month">${MN[m.getMonth()]} ${String(m.getFullYear()).slice(2)}</div>`;});
  head+='</div>';
  let rows='';
  dated.forEach(t=>{
    const off=daysBetween(min,t.start_date)/span*100;
    const w=Math.max(2,daysBetween(t.start_date,t.due_date)/span*100);
    const cls=isLate(t)?'late':(t.status==='done'?'done':'');
    rows+=`<div class="gantt-row"><div class="gantt-label" title="${esc(t.title)}">${esc(t.title)}</div><div class="gantt-track"><div class="gantt-bar ${cls}" style="left:${off}%;width:${w}%" title="${fmtDate(t.start_date)} → ${fmtDate(t.due_date)}">${t.progress||0}%</div></div></div>`;
  });
  return `<div class="gantt">${head}${rows}</div>`;
}

/* ====== Relance mail ====== */
function remindTask(taskId){
  const t=state.tasks.find(x=>x.id==taskId);
  if(!t)return;
  const u=userById(t.assignee_id);
  if(!u||!u.email){alert("Cette tâche n'a pas de personne avec une adresse email.");return;}
  const proj=projById(t.project_id);
  const d=Math.abs(daysBetween(t.due_date,today()));
  const subject='Relance — tâche en retard : '+t.title;
  const body=`Bonjour ${u.name.split(' ')[0]},\n\nPetit rappel concernant la tâche suivante, actuellement en retard de ${d} jour(s) :\n\n• Tâche : ${t.title}\n${proj?'• Projet : '+proj.name+'\n':''}• Échéance initiale : ${fmtDate(t.due_date)}\n• Priorité : ${PRIO_LABEL[t.priority]}\n• Avancement actuel : ${t.progress||0}%\n\nPeux-tu me faire un point sur l'avancement et une date de livraison réaliste ?\n\nMerci,\n${ME.name}`;
  window.location.href='mailto:'+encodeURIComponent(u.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

/* ====== Navigation ====== */
function tab(name){
  document.querySelectorAll('nav .tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  ['dash','synth','tasks','team','absence','alerts'].forEach(s=>$('sec-'+s).classList.toggle('hidden',s!==name));
}
function openModal(id){fillSelects();$(id).classList.add('show');}
function closeModal(id){$(id).classList.remove('show');}
function fillSelects(){
  // Pour la tâche : assignés = utilisateurs
  $('f_assignee').innerHTML='<option value="">— Non assigné —</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
  $('f_aPerson').innerHTML=state.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
  // Pour les non-admin, l'assigné est verrouillé sur eux-mêmes
  if(!IS_ADMIN){
    $('f_assignee').value=ME.id;
    $('f_assignee').disabled=true;
    if(state.users.find(u=>u.id===ME.id)){
      $('f_aPerson').value=ME.id;
      $('f_aPerson').disabled=true;
    }
  }
}

/* ====== Projets ====== */
async function addProject(){
  const n=prompt('Nom du nouveau projet :');if(!n||!n.trim())return;
  const d=prompt('Description (optionnelle) :')||'';
  try{const p=await api('/api/projects',{method:'POST',body:{name:n.trim(),description:d.trim()}});
    state.currentProject=p.id;localStorage.setItem('atelier_curproj',p.id);
    await loadAll();}catch(e){alert(e.message);}
}
async function editProject(){
  const p=projById(state.currentProject);if(!p)return;
  const n=prompt('Nom du projet :',p.name);if(n===null)return;
  const d=prompt('Description :',p.description||'');
  await api('/api/projects/'+p.id,{method:'PUT',body:{name:n.trim(),description:(d||'').trim()}});
  await loadAll();
}
async function delProject(){
  const p=projById(state.currentProject);if(!p)return;
  if(!confirm('Supprimer le projet « '+p.name+' » et toutes ses tâches ?'))return;
  await api('/api/projects/'+p.id,{method:'DELETE'});
  state.currentProject=null;localStorage.removeItem('atelier_curproj');
  await loadAll();
}

/* ====== Tâches ====== */
function openTask(id){
  if(!state.currentProject){alert('Sélectionne d\'abord un projet.');return;}
  openModal('taskModal');
  if(id){
    const t=state.tasks.find(x=>x.id==id);
    $('taskModalTitle').textContent='Modifier la tâche';
    $('f_taskId').value=t.id;$('f_title').value=t.title;$('f_desc').value=t.description||'';
    $('f_assignee').value=t.assignee_id||'';$('f_prio').value=t.priority;
    $('f_start').value=t.start_date||'';$('f_due').value=t.due_date||'';
    $('f_status').value=t.status;$('f_prog').value=t.progress||0;$('f_progVal').textContent=t.progress||0;
  }else{
    $('taskModalTitle').textContent='Nouvelle tâche';
    $('f_taskId').value='';$('f_title').value='';$('f_desc').value='';
    $('f_assignee').value=IS_ADMIN?'':ME.id;
    $('f_prio').value='m';$('f_start').value=today();$('f_due').value='';
    $('f_status').value='todo';$('f_prog').value=0;$('f_progVal').textContent='0';
  }
}
async function saveTask(){
  const title=$('f_title').value.trim();
  if(!title){alert('Le titre est obligatoire.');return;}
  let prog=parseInt($('f_prog').value,10);if($('f_status').value==='done')prog=100;
  const data={
    title,description:$('f_desc').value.trim(),
    assignee_id: $('f_assignee').value ? parseInt($('f_assignee').value,10) : null,
    priority:$('f_prio').value,
    start_date:$('f_start').value||null,due_date:$('f_due').value||null,
    status:$('f_status').value,progress:prog
  };
  const existId=$('f_taskId').value;
  try{
    if(existId){await api('/api/tasks/'+existId,{method:'PUT',body:data});}
    else{data.project_id=parseInt(state.currentProject,10);await api('/api/tasks',{method:'POST',body:data});}
    closeModal('taskModal');await loadAll();
  }catch(e){alert(e.message);}
}
async function delTask(id){
  if(!confirm('Supprimer cette tâche ?'))return;
  try{await api('/api/tasks/'+id,{method:'DELETE'});await loadAll();}catch(e){alert(e.message);}
}

/* ====== Personnes (utilisateurs) ====== */
function openPerson(id){
  openModal('personModal');
  if(id){
    const u=userById(id);
    $('personModalTitle').textContent='Modifier '+u.name;
    $('f_personId').value=u.id;$('f_name').value=u.name;$('f_email').value=u.email;
    $('f_role').value=u.role;$('f_password').value='';
    $('passwordField').querySelector('label').textContent='Nouveau mot de passe (laisser vide pour ne pas changer)';
  }else{
    $('personModalTitle').textContent='Ajouter une personne';
    $('f_personId').value='';$('f_name').value='';$('f_email').value='';
    $('f_role').value='user';$('f_password').value='';
    $('passwordField').querySelector('label').textContent='Mot de passe (laisser vide pour générer automatiquement)';
  }
}
async function savePerson(){
  const name=$('f_name').value.trim(), email=$('f_email').value.trim();
  if(!name||!email){alert('Nom et email obligatoires.');return;}
  const data={name,email,role:$('f_role').value};
  if($('f_password').value)data.password=$('f_password').value;
  try{
    const existId=$('f_personId').value;
    if(existId){await api('/api/users/'+existId,{method:'PUT',body:data});}
    else{
      const r=await api('/api/users',{method:'POST',body:data});
      if(r.initial_password){
        alert(`Compte créé pour ${r.name}.\n\nIdentifiants à transmettre :\nEmail : ${r.email}\nMot de passe : ${r.initial_password}`);
      }
    }
    closeModal('personModal');await loadAll();
  }catch(e){alert(e.message);}
}
async function delPerson(id){
  if(!confirm('Supprimer cette personne ? Ses tâches seront dé-assignées.'))return;
  try{await api('/api/users/'+id,{method:'DELETE'});await loadAll();}catch(e){alert(e.message);}
}

/* ====== Absences ====== */
function openAbsence(){
  if(state.users.length===0){alert('Aucun utilisateur.');return;}
  openModal('absModal');$('f_aFrom').value=today();$('f_aTo').value=today();
}
async function saveAbsence(){
  const data={user_id:parseInt($('f_aPerson').value,10),kind:$('f_aType').value,
    from_date:$('f_aFrom').value,to_date:$('f_aTo').value};
  if(!data.from_date||!data.to_date){alert('Indique les dates.');return;}
  try{await api('/api/absences',{method:'POST',body:data});closeModal('absModal');await loadAll();}
  catch(e){alert(e.message);}
}
async function delAbsence(id){try{await api('/api/absences/'+id,{method:'DELETE'});await loadAll();}catch(e){alert(e.message);}}

/* ====== Alertes ====== */
async function ackAlert(key){try{await api('/api/alerts/ack',{method:'POST',body:{key}});state.alerts=await api('/api/alerts');renderAll();}catch(e){alert(e.message);}}
async function ackAll(){try{await api('/api/alerts/ack_all',{method:'POST',body:{}});state.alerts=await api('/api/alerts');renderAll();}catch(e){alert(e.message);}}

/* ====== Branding ====== */
async function renameApp(){
  if(!IS_ADMIN)return;
  const cur=$('appName').textContent;
  const n=prompt("Nom de l'application :",cur);
  if(n!==null && n.trim()){
    await api('/api/settings',{method:'PUT',body:{app_name:n.trim()}});
    $('appName').textContent=n.trim();document.title=n.trim();
  }
}
async function changeLogo(e){
  if(!IS_ADMIN)return;
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async()=>{
    await api('/api/settings',{method:'PUT',body:{app_logo:r.result}});
    $('appLogo').innerHTML='<img src="'+r.result+'" alt="logo">';
  };
  r.readAsDataURL(f);e.target.value='';
}

/* ====== Analyse de document (côté serveur pour extraction, côté navigateur pour analyse) ====== */
async function startDocImport(file){
  if(!state.currentProject){alert('Sélectionne d\'abord un projet.');return;}
  openModal('docModal');
  $('docModalTitle').textContent='Analyse : '+file.name;
  $('docBody').innerHTML='<div class="spinner"></div><p style="text-align:center;color:var(--mut)">Lecture du document…</p>';
  $('docActions').innerHTML='';
  try{
    const fd=new FormData();fd.append('file',file);
    const r=await fetch('/api/parse-document',{method:'POST',body:fd});
    if(!r.ok){const j=await r.json();throw new Error(j.detail||'Erreur');}
    const j=await r.json();
    if(!j.text||!j.text.trim())throw new Error('Aucun texte exploitable trouvé.');
    pendingDocItems = analyzeText(j.text);
    renderDocReview();
  }catch(err){
    $('docBody').innerHTML=`<p style="color:var(--bad)"><strong>Impossible d'analyser ce fichier.</strong></p><p class="meta">${esc(err.message)}</p>`;
    $('docActions').innerHTML='<button class="btn ghost" data-close="docModal">Fermer</button>';
  }
}
function analyzeText(text){
  const items=[];const lines=text.split(/\r?\n/);
  const existing=state.users.map(u=>u.name.toLowerCase());
  const roleWords=/(chef|cheffe|d[ée]veloppeu|designer|manager|responsable|lead|architect|testeur|analyste|consultant|ing[ée]nieu|product owner|scrum|directeu|assistant|stagiaire|graphiste|r[ée]dacteu|commercial)/i;
  lines.forEach(ln=>{const l=ln.trim();if(!l||l.length>90)return;
    const em=l.match(/([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/i);
    const m=l.match(/^[-•*\s]*([A-ZÀ-Ü][\wÀ-ÿ'’.-]+(?:\s+[A-ZÀ-Ü][\wÀ-ÿ'’.-]+){1,2})\s*[:\-–—]\s*(.+)$/);
    if(m && roleWords.test(m[2])){
      const nm=m[1].trim(),role=m[2].trim().replace(/\.$/,'');
      if(existing.indexOf(nm.toLowerCase())===-1)items.push({kind:'person',name:nm,role:role.slice(0,60),email:em?em[0]:''});
    }else if(em && roleWords.test(l)){
      const guess=em[1].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      if(existing.indexOf(guess.toLowerCase())===-1)items.push({kind:'person',name:guess,role:(l.match(roleWords)||[''])[0],email:em[0]});
    }
  });
  const actionWords=/(cr[ée]er|d[ée]velopper|r[ée]diger|concevoir|tester|corriger|d[ée]ployer|pr[ée]parer|organiser|planifier|valider|r[ée]viser|impl[ée]menter|mettre en place|finaliser|livrer|analyser|maquette|prototype|int[ée]grer|documenter|configurer|installer|optimiser|envoyer|contacter|relancer|suivre|v[ée]rifier)/i;
  const prioHigh=/(urgent|prioritaire|critique|asap|important|haute priorit[ée]|bloquant)/i;
  const prioLow=/(plus tard|optionnel|si possible|basse priorit[ée]|secondaire)/i;
  function findAssignee(l){
    const all=state.users.concat(items.filter(x=>x.kind==='person').map(x=>({id:'NEW:'+x.name,name:x.name})));
    for(const a of all){const first=a.name.split(' ')[0];if(new RegExp('\\b'+first.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(l))return a;}
    return null;
  }
  function findDue(l){let m=l.match(/(\d{4})-(\d{2})-(\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];
    m=l.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
    if(m){const d=('0'+m[1]).slice(-2),mo=('0'+m[2]).slice(-2);const y=m[3]?(m[3].length===2?'20'+m[3]:m[3]):String(new Date().getFullYear());return y+'-'+mo+'-'+d;}
    return '';
  }
  lines.forEach(ln=>{const l=ln.trim();if(l.length<6||l.length>160)return;
    const isBullet=/^[-•*▪◦·]|^\d+[.)]\s/.test(l);const hasAction=actionWords.test(l);const explicit=/^t[âa]che\s*[:\-]/i.test(l);
    if(!(isBullet&&hasAction)&&!explicit&&!(hasAction&&l.length<100))return;
    const title=l.replace(/^[-•*▪◦·\d.)\s]+/,'').replace(/^t[âa]che\s*[:\-–—]\s*/i,'').trim();if(title.length<4)return;
    const as=findAssignee(l);const prio=prioHigh.test(l)?'h':prioLow.test(l)?'l':'m';
    items.push({kind:'task',title:title.slice(0,120),assigneeRef:as?as.id:'',assigneeName:as?as.name:'',priority:prio,due_date:findDue(l)});
  });
  const seen={};return items.filter(it=>{if(it.kind!=='task')return true;const k=it.title.toLowerCase();if(seen[k])return false;seen[k]=1;return true;});
}
function renderDocReview(){
  const tasks=pendingDocItems.filter(i=>i.kind==='task');
  const people=pendingDocItems.filter(i=>i.kind==='person');
  const body=$('docBody');const proj=projById(state.currentProject);
  if(tasks.length===0&&people.length===0){
    body.innerHTML='<p class="meta">Aucune tâche ni personne détectée.</p>';
    $('docActions').innerHTML='<button class="btn ghost" data-close="docModal">Fermer</button>';return;
  }
  let html=`<p class="meta">Tâches ajoutées au projet <strong>${esc(proj.name)}</strong>.${IS_ADMIN?'':' Toutes les tâches importées te seront assignées.'}</p>`;
  if(people.length && IS_ADMIN){
    html+=`<h3 style="font-size:15px;margin:14px 0 8px">Personnes détectées (${people.length})</h3>`;
    people.forEach((p,i)=>{html+=`<label class="review-item"><input type="checkbox" data-pi="P${i}" checked><div class="ri-body"><span class="ri-tag person">Nouvelle personne</span> <strong>${esc(p.name)}</strong>${p.role?' · '+esc(p.role):''}${p.email?`<div class="meta">✉ ${esc(p.email)}</div>`:''}<div class="meta">Un mot de passe sera généré automatiquement.</div></div></label>`;});
  }
  if(tasks.length){
    html+=`<h3 style="font-size:15px;margin:14px 0 8px">Tâches détectées (${tasks.length})</h3>`;
    tasks.forEach((t,i)=>{const pl={h:'Haute',m:'Moyenne',l:'Basse'}[t.priority];
      html+=`<label class="review-item"><input type="checkbox" data-ti="T${i}" checked><div class="ri-body"><span class="ri-tag">Tâche</span> <strong>${esc(t.title)}</strong><div class="meta">Priorité ${pl}${t.assigneeName?' · 👤 '+esc(t.assigneeName):''}${t.due_date?' · 📅 '+fmtDate(t.due_date):''}</div></div></label>`;});
  }
  body.innerHTML=html;
  $('docActions').innerHTML='<button class="btn ghost" data-close="docModal">Annuler</button><button class="btn primary" id="btnApplyDoc">Ajouter la sélection</button>';
  $('btnApplyDoc').addEventListener('click',applyDocImport);
}
async function applyDocImport(){
  const tasks=pendingDocItems.filter(i=>i.kind==='task');
  const people=pendingDocItems.filter(i=>i.kind==='person');
  const nameToId={};
  if(IS_ADMIN){
    for(let i=0;i<people.length;i++){
      const p=people[i],cb=document.querySelector(`[data-pi="P${i}"]`);
      if(cb&&cb.checked){
        try{const r=await api('/api/users',{method:'POST',body:{name:p.name,email:p.email||p.name.toLowerCase().replace(/\s+/g,'.')+'@exemple.fr',role:'user'}});
          nameToId[p.name]=r.id;}catch(e){console.warn('user create skipped:',e.message);}
      }
    }
  }
  let added=0;
  for(let i=0;i<tasks.length;i++){
    const t=tasks[i],cb=document.querySelector(`[data-ti="T${i}"]`);if(!cb||!cb.checked)continue;
    let assignee=null;
    if(IS_ADMIN){
      if(t.assigneeRef && String(t.assigneeRef).startsWith('NEW:'))assignee=nameToId[t.assigneeName]||null;
      else if(t.assigneeRef)assignee=t.assigneeRef;
    }
    try{
      await api('/api/tasks',{method:'POST',body:{project_id:parseInt(state.currentProject,10),title:t.title,description:'(importé du document)',assignee_id:assignee,priority:t.priority,start_date:today(),due_date:t.due_date||null,status:'todo',progress:0}});
      added++;
    }catch(e){console.warn('task create skipped:',e.message);}
  }
  closeModal('docModal');await loadAll();
  alert(added+' tâche(s) ajoutée(s) ✓');
}

/* ====== Export PDF ====== */
function exportPDF(){
  const proj=projById(state.currentProject);if(!proj){alert('Aucun projet.');return;}
  const pp=projectProgress(),health=projectHealth(),ts=projTasks();
  const w=window.open('','_blank');
  const css='body{font-family:Arial,Helvetica,sans-serif;color:#2b2925;margin:34px;}h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;border-bottom:2px solid #e8642f;padding-bottom:4px;margin-top:26px}.sub{color:#888;margin-bottom:18px}.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:bold;color:#fff;background:'+health.color.replace('var(--bad)','#d6383f').replace('var(--warn)','#d98300').replace('var(--ok)','#2e9e5b')+'}.kpis{display:flex;gap:16px;margin:16px 0}.kpi{flex:1;border:1px solid #e2ddd2;border-radius:10px;padding:14px}.kpi .n{font-size:26px;font-weight:bold}.kpi .l{color:#888;font-size:11px;text-transform:uppercase}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}th,td{border:1px solid #e2ddd2;padding:7px 9px;text-align:left}th{background:#f7f4ee}.bar{height:14px;background:#eceae3;border-radius:7px;overflow:hidden}.bar>i{display:block;height:100%;background:#e8642f}.g{border:1px solid #e2ddd2;border-radius:8px;overflow:hidden;margin-top:8px}.grow{display:flex;border-bottom:1px solid #eee;min-height:26px;align-items:center}.glab{flex:0 0 180px;padding:4px 8px;font-size:11px;border-right:1px solid #eee;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.gtrack{position:relative;flex:1;height:26px}.gbar{position:absolute;top:6px;height:14px;border-radius:4px;background:#e8642f}.gbar.done{background:#2e9e5b}.gbar.late{background:#d6383f}.late{color:#d6383f;font-weight:bold}@media print{button{display:none}}';
  const dated=ts.filter(t=>t.start_date&&t.due_date);
  let ganttHTML='<p style="color:#888">Aucune tâche datée.</p>';
  if(dated.length){
    let min=dated[0].start_date,max=dated[0].due_date;
    dated.forEach(t=>{if(t.start_date<min)min=t.start_date;if(t.due_date>max)max=t.due_date;});
    const span=Math.max(1,daysBetween(min,max));
    ganttHTML='<div class="g">'+dated.map(t=>{
      const off=daysBetween(min,t.start_date)/span*100,wd=Math.max(2,daysBetween(t.start_date,t.due_date)/span*100);
      const cls=isLate(t)?'late':(t.status==='done'?'done':'');
      return `<div class="grow"><div class="glab">${esc(t.title)}</div><div class="gtrack"><div class="gbar ${cls}" style="left:${off}%;width:${wd}%"></div></div></div>`;
    }).join('')+`</div><p style="font-size:11px;color:#888">Période : ${fmtDate(min)} → ${fmtDate(max)}</p>`;
  }
  const rows=ts.map(t=>{const late=isLate(t);
    return `<tr><td>${esc(t.title)}</td><td>${esc(userName(t.assignee_id))}</td><td>${PRIO_LABEL[t.priority]}</td><td>${fmtDate(t.start_date)}</td><td class="${late?'late':''}">${fmtDate(t.due_date)}</td><td>${late?'En retard':STATUS_LABEL[t.status]}</td><td>${t.progress||0}%</td></tr>`;
  }).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(proj.name)} — Synthèse</title><style>${css}</style></head><body><h1>${esc(proj.name)}</h1><div class="sub">Synthèse générée le ${fmtDate(today())}</div><p>Santé du projet : <span class="badge">${health.label}</span></p>${proj.description?`<p><strong>Description :</strong> ${esc(proj.description)}</p>`:''}<div class="kpis"><div class="kpi"><div class="n">${pp.pct}%</div><div class="l">Avancement pondéré</div><div class="bar"><i style="width:${pp.pct}%"></i></div></div><div class="kpi"><div class="n">${pp.done}/${pp.total}</div><div class="l">Tâches terminées</div></div><div class="kpi"><div class="n" style="color:${pp.late?'#d6383f':'#2e9e5b'}">${pp.late}</div><div class="l">En retard</div></div></div><h2>Diagramme de Gantt</h2>${ganttHTML}<h2>Détail des tâches</h2><table><thead><tr><th>Tâche</th><th>Responsable</th><th>Priorité</th><th>Début</th><th>Échéance</th><th>Statut</th><th>%</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:30px"><button onclick="window.print()" style="padding:10px 18px;font-size:14px;background:#e8642f;color:#fff;border:none;border-radius:8px;cursor:pointer">🖨 Imprimer / Enregistrer en PDF</button></p><script>setTimeout(()=>window.print(),500);<\/script></body></html>`;
  w.document.write(html);w.document.close();
}

/* ====== Événements ====== */
document.addEventListener('click',function(e){
  const t=e.target.closest('[data-tab],[data-close],[data-edit-task],[data-del-task],[data-edit-person],[data-del-person],[data-del-abs],[data-remind],[data-ack]');
  if(!t)return;
  if(t.hasAttribute('data-tab'))tab(t.dataset.tab);
  else if(t.hasAttribute('data-close'))closeModal(t.dataset.close);
  else if(t.hasAttribute('data-edit-task'))openTask(t.dataset.editTask);
  else if(t.hasAttribute('data-del-task'))delTask(t.dataset.delTask);
  else if(t.hasAttribute('data-edit-person'))openPerson(t.dataset.editPerson);
  else if(t.hasAttribute('data-del-person'))delPerson(t.dataset.delPerson);
  else if(t.hasAttribute('data-del-abs'))delAbsence(t.dataset.delAbs);
  else if(t.hasAttribute('data-remind'))remindTask(t.dataset.remind);
  else if(t.hasAttribute('data-ack'))ackAlert(t.dataset.ack);
});
document.querySelectorAll('.modal-bg').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show');}));

$('projSelect').addEventListener('change',async function(){
  state.currentProject=parseInt(this.value,10);
  localStorage.setItem('atelier_curproj',state.currentProject);
  state.tasks=await api('/api/tasks?project_id='+state.currentProject);
  state.alerts=await api('/api/alerts?project_id='+state.currentProject);
  renderAll();
});
$('filterStatus').addEventListener('change',function(){state.filterStatus=this.value;renderTasks();});
$('f_prog').addEventListener('input',function(){$('f_progVal').textContent=this.value;});
$('f_status').addEventListener('change',function(){if(this.value==='done'){$('f_prog').value=100;$('f_progVal').textContent='100';}});

if(IS_ADMIN){
  $('btnAddProj').addEventListener('click',addProject);
  $('btnEditProj').addEventListener('click',editProject);
  $('btnDelProj').addEventListener('click',delProject);
  $('btnAddPerson').addEventListener('click',()=>openPerson());
  $('appName').addEventListener('click',renameApp);
  $('appLogo').addEventListener('click',()=>$('logoInput').click());
  $('logoInput').addEventListener('change',changeLogo);
}
$('btnAddTask').addEventListener('click',()=>openTask());
$('btnAddAbs').addEventListener('click',openAbsence);
$('btnSaveTask').addEventListener('click',saveTask);
$('btnSavePerson').addEventListener('click',savePerson);
$('btnSaveAbs').addEventListener('click',saveAbsence);
$('btnAckAll').addEventListener('click',ackAll);
$('btnExportPDF').addEventListener('click',exportPDF);
$('btnImportDoc').addEventListener('click',()=>$('docInput').click());
$('docInput').addEventListener('change',function(e){const f=e.target.files[0];if(f)startDocImport(f);e.target.value='';});

// avatar utilisateur dans la barre du haut
$('meAva').style.background=avaColor(ME.id);
$('meAva').textContent=initials(ME.name);

loadAll();
