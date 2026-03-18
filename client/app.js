// WoW Optimizer - Frontend (rewritten from scratch)
var API = window.location.origin + '/api';
var currentChar = null;
var activeSimPoll = null;
var PAWN_MAP = {Str:'Strength',Agi:'Agility',Int:'Intellect',Crit:'CritRating',Haste:'HasteRating',Mastery:'MasteryRating',Vers:'Versatility',AP:'Ap',Wdps:'Dps',WOHdps:'OffHandDps'};
var STAT_COLORS = {Str:'#ffd100',Agi:'#ffd100',Int:'#ffd100',Crit:'#bf616a',Haste:'#ebcb8b',Mastery:'#a335ee',Vers:'#1eff00',AP:'#c4a35a'};
var CLASS_COLORS = {Warrior:'#C79C6E',Paladin:'#F58CBA',Hunter:'#ABD473',Rogue:'#FFF569',Priest:'#FFFFFF','Death Knight':'#C41F3B',Shaman:'#0070DE',Mage:'#69CCF0',Warlock:'#9482C9',Monk:'#00FF96',Druid:'#FF7D0A','Demon Hunter':'#A330C9',Evoker:'#33937F'};
var QUALITY_COLORS = {POOR:'#9d9d9d',COMMON:'#fff',UNCOMMON:'#1eff00',RARE:'#0070dd',EPIC:'#a335ee',LEGENDARY:'#ff8000',ARTIFACT:'#e6cc80'};
var SLOTS = ['head','neck','shoulder','back','chest','wrist','hands','waist','legs','feet','finger1','finger2','trinket1','trinket2','main_hand','off_hand'];

function $(id){return document.getElementById(id)}
function fmt(n){try{return Number(n||0).toLocaleString('it-IT')}catch(e){return String(n)}}
function esc(s){var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML}
async function apiFetch(endpoint,method,body){try{var o={method:method||'GET',headers:{'Content-Type':'application/json'}};if(body)o.body=JSON.stringify(body);var r=await fetch(API+endpoint,o);return await r.json()}catch(e){return{error:e.message}}}
function show(id){var e=$(id);if(e)e.style.display=''}
function hide(id){var e=$(id);if(e)e.style.display='none'}
function setText(id,t){var e=$(id);if(e)e.textContent=t}
function setHtml(id,h){var e=$(id);if(e)e.innerHTML=h}
function setStatus(id,msg,type){var e=$(id);if(e){e.textContent=msg;e.className='status-msg visible '+(type||'info')}}

// NAVIGATION
function navigateTo(page){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});
  var p=$('page-'+page);if(p)p.classList.add('active');
  var n=document.querySelector('[data-page="'+page+'"]');if(n)n.classList.add('active');
  if(page==='simulate'&&currentChar)renderSimPage();
  if(page==='statweights'&&currentChar)loadStatWeights();
}

// SETTINGS
function showSettings(){$('settings-modal').classList.add('visible');loadSettingsValues()}
function hideSettings(){$('settings-modal').classList.remove('visible')}
async function loadSettingsValues(){
  var cfg=await apiFetch('/config');
  if(!cfg||cfg.error)return;
  if($('settSimcPath'))$('settSimcPath').value=cfg.simc_path||'';
  if($('settSimcThreads'))$('settSimcThreads').value=cfg.simc_threads||'4';
  if($('settSimcIterations'))$('settSimcIterations').value=cfg.simc_iterations||'10000';
  if($('settBlizzClientId'))$('settBlizzClientId').value=cfg.blizzard_client_id||'';
  if($('settBlizzRegion'))$('settBlizzRegion').value=cfg.blizzard_region||'eu';
  if(cfg.blizzard_client_id)hide('armoryApiWarning');
}
async function saveSettings(){
  var d={simc_path:$('settSimcPath').value,simc_threads:$('settSimcThreads').value,simc_iterations:$('settSimcIterations').value,blizzard_client_id:$('settBlizzClientId').value,blizzard_client_secret:$('settBlizzClientSecret').value,blizzard_region:$('settBlizzRegion').value};
  var r=await apiFetch('/config','PATCH',d);
  setStatus('settingsSaveStatus',r.error?'Errore: '+r.error:'Salvato!',r.error?'error':'success');
  if(!r.error)setTimeout(hideSettings,800);
}
async function testSimc(){
  setStatus('simcTestStatus','Testing SimC...','info');
  await apiFetch('/config','PATCH',{simc_path:$('settSimcPath').value});
  var r=await apiFetch('/simulate/test-simc','POST');
  setStatus('simcTestStatus',r.ok?'OK: '+r.message:'Errore: '+r.message,r.ok?'success':'error');
}
async function testBlizzard(){
  setStatus('blizzTestStatus','Testing Blizzard API...','info');
  await saveSettings();
  var r=await apiFetch('/config/test-blizzard','POST');
  setStatus('blizzTestStatus',r.ok?'Blizzard API OK':'Errore: '+r.message,r.ok?'success':'error');
}

// CHARACTERS
async function loadCharacters(){
  var chars=await apiFetch('/characters');
  if(!chars||chars.error||!chars.length){setHtml('characterList','');show('charactersEmpty');return}
  hide('charactersEmpty');
  setHtml('characterList',chars.map(function(c){
    var cc=CLASS_COLORS[c.class]||'#c9b98a';
    var sel=currentChar&&currentChar.id===c.id?' selected':'';
    return '<div class="character-card'+sel+'" onclick="selectCharacter('+c.id+')">'
      +'<div class="character-card-icon" style="background:'+cc+'">'+esc((c.name||'?')[0])+'</div>'
      +'<div class="character-card-info">'
      +'<div class="character-card-name" style="color:'+cc+'">'+esc(c.name)+'</div>'
      +'<div class="character-card-detail">'+esc(c.spec||'')+' '+esc(c.class||'')+' - '+esc(c.realm||'')+'</div>'
      +'<div class="character-card-ilvl">ilvl '+esc(c.ilvl||'?')+'</div></div>'
      +'<button class="character-card-delete" onclick="event.stopPropagation();deleteChar('+c.id+')">✕</button></div>';
  }).join(''));
}
async function selectCharacter(id){
  var c=await apiFetch('/characters/'+id);if(c.error)return;
  currentChar=c;loadCharacters();renderDashboard();navigateTo('dashboard');
}
async function deleteChar(id){
  if(!confirm('Eliminare?'))return;
  await apiFetch('/characters/'+id,'DELETE');
  if(currentChar&&currentChar.id===id)currentChar=null;
  loadCharacters();
}

// IMPORT
function showSimcImport(){show('panelSimcImport');hide('panelArmoryImport')}
function showArmoryImport(){hide('panelSimcImport');show('panelArmoryImport')}
async function doSimcImport(){
  var s=$('simcInput').value.trim();
  if(!s){setStatus('simcImportStatus','Incolla la stringa /simc','error');return}
  setStatus('simcImportStatus','Importazione...','info');
  var r=await apiFetch('/characters/import-simc','POST',{simcString:s});
  if(r.error){setStatus('simcImportStatus','Errore: '+r.error,'error');return}
  setStatus('simcImportStatus','Importato: '+r.name+' ('+r.class+' '+r.spec+') ilvl '+r.ilvl,'success');
  $('simcInput').value='';loadCharacters();setTimeout(function(){selectCharacter(r.id)},500);
}
async function doArmoryImport(){
  var name=$('armoryName').value.trim();var realm=$('armoryRealm').value;var region=$('armoryRegion').value;
  if(!name||!realm){setStatus('armoryImportStatus','Inserisci nome e seleziona realm','error');return}
  setStatus('armoryImportStatus','Importazione da Blizzard...','info');
  var r=await apiFetch('/characters/import-armory','POST',{name:name,realm:realm,region:region});
  if(r.error){setStatus('armoryImportStatus','Errore: '+r.error,'error');return}
  setStatus('armoryImportStatus','Importato: '+r.name+' ('+r.class+' '+r.spec+') ilvl '+r.ilvl,'success');
  loadCharacters();setTimeout(function(){selectCharacter(r.id)},500);
}

// DASHBOARD
function renderDashboard(){
  if(!currentChar){hide('dashboardContent');show('dashboardEmpty');return}
  show('dashboardContent');hide('dashboardEmpty');
  var c=currentChar;
  setText('dashName',c.name||'?');setText('dashClass',c.class||'?');setText('dashSpec',c.spec||'?');
  setText('dashRace',c.race||'?');setText('dashLevel',c.level||'?');setText('dashIlvl',c.ilvl||'?');
  var eq=c.equipment_json||c.equipment||{};
  setHtml('dashGearGrid',SLOTS.map(function(slot){
    var item=eq[slot];
    if(!item||!item.id)return '<div class="gear-slot"><div class="gear-slot-info"><div class="gear-slot-name">'+slot+'</div><div class="gear-slot-item" style="color:var(--text-muted)">Vuoto</div></div></div>';
    var qc=QUALITY_COLORS[item.quality]||'#fff';
    var icon=item.iconUrl||'https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg';
    var meta='<span class="gear-ilvl">'+esc(item.ilvl||'?')+'</span>';
    if(item.enchantName||item.enchantId)meta+=' <span class="badge badge-enchant">E</span>';
    if(item.gemIds&&item.gemIds.length)meta+=' <span class="badge badge-gem">'+item.gemIds.length+'G</span>';
    return '<div class="gear-slot"><img class="gear-slot-icon" src="'+esc(icon)+'" onerror="this.src=\'https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg\'"><div class="gear-slot-info"><div class="gear-slot-name">'+slot+'</div><div class="gear-slot-item" style="color:'+qc+'">'+esc(item.name||'Item #'+item.id)+'</div><div class="gear-slot-meta">'+meta+'</div></div></div>';
  }).join(''));
}

// SIMULATION
function renderSimPage(){
  if(!currentChar){hide('simContent');show('simEmpty');return}
  show('simContent');hide('simEmpty');hide('simProgress');hide('simResult');hide('simStatWeightBars');
  $('simResult').classList.remove('visible');
  loadSimHistory();
}
async function runSim(type){
  if(!currentChar)return;
  var ep=type==='stat_weights'?'/simulate/'+currentChar.id+'/stat-weights':'/simulate/'+currentChar.id;
  hide('simResult');hide('simStatWeightBars');show('simProgress');
  $('simResult').classList.remove('visible');
  $('simProgressBar').style.width='5%';setText('simProgressPercent','0%');setText('simProgressStatus','In coda...');
  var r=await apiFetch(ep,'POST');
  if(r.error){setText('simProgressStatus','Errore: '+r.error);return}
  pollSim(r.jobId,type);
}
function pollSim(jobId,type){
  if(activeSimPoll)clearInterval(activeSimPoll);
  activeSimPoll=setInterval(async function(){
    var s=await apiFetch('/simulate/status/'+jobId);if(s.error)return;
    $('simProgressBar').style.width=(s.progress||0)+'%';
    setText('simProgressPercent',(s.progress||0)+'%');
    setText('simProgressStatus',s.status==='running'?'Simulazione in corso...':s.status);
    if(s.status==='done'||s.status==='completed'||s.status==='error'||s.status==='cancelled'){
      clearInterval(activeSimPoll);activeSimPoll=null;
      $('simProgressBar').style.width='100%';
      if(s.status==='error'){setText('simProgressStatus','Errore: '+(s.error_message||''));return}
      if(s.status==='cancelled'){setText('simProgressStatus','Annullata');return}
      var result=await apiFetch('/simulate/result/'+jobId);
      renderSimResult(result,type);loadSimHistory();
    }
  },2000);
}
function renderSimResult(result,type){
  show('simResult');$('simResult').classList.add('visible');
  setText('simDpsValue',fmt(result.dps));
  setText('simDpsType',type==='stat_weights'?'(Stat Weights)':'');
  var durHtml=result.duration_seconds?'Durata: '+result.duration_seconds.toFixed(1)+'s':'';
  if(result.html_report)durHtml+=' <a href="'+esc(window.location.origin+result.html_report)+'" target="_blank" class="btn btn-primary btn-sm" style="margin-left:12px">Report SimC</a>';
  $('simDpsDuration').innerHTML=durHtml;
  // Stat Weights
  var sw=result.stat_weights_json;
  if(sw&&typeof sw==='object'&&Object.keys(sw).length>0){
    show('simStatWeightBars');
    renderStatBars('statWeightBarsContainer',sw);
    renderPawnString(sw);
  }
}
function renderStatBars(containerId,weights){
  var entries=[];var maxW=0;
  Object.keys(weights).forEach(function(key){
    var val=parseFloat(weights[key]);
    if(isNaN(val)||val<=0||key==='AP'||key==='Wdps'||key==='WOHdps')return;
    if(val>maxW)maxW=val;
    entries.push({key:key,val:val,name:PAWN_MAP[key]||key,color:STAT_COLORS[key]||'#c4a35a'});
  });
  entries.sort(function(a,b){return b.val-a.val});
  setHtml(containerId,entries.map(function(e){
    var pct=maxW>0?Math.round(e.val/maxW*100):0;
    return '<div class="stat-bar-row"><div class="stat-bar-label" style="color:'+e.color+'">'+esc(e.name)+'</div><div class="stat-bar-track"><div class="stat-bar-fill" style="width:'+pct+'%;background:'+e.color+'"></div></div><div class="stat-bar-value" style="color:'+e.color+'">'+e.val.toFixed(2)+'</div></div>';
  }).join(''));
}
function renderPawnString(weights){
  if(!currentChar||!weights)return;
  var name=currentChar.name+'-'+(currentChar.spec||'');
  var cls=currentChar.class||'';var spec=currentChar.spec||'';
  var parts=[];
  Object.keys(weights).forEach(function(key){
    var val=parseFloat(weights[key]);
    if(isNaN(val)||val===0||!PAWN_MAP[key])return;
    parts.push(' '+PAWN_MAP[key]+'='+val.toFixed(2));
  });
  var pawn='( Pawn: v1: "'+name+'": Class='+cls+', Spec='+spec+','+parts.join(',')+' )';
  var el=$('statWeightBarsContainer');
  if(el)el.innerHTML+='<div class="card" style="margin-top:16px"><div class="card-header">Pawn Import String</div><input type="text" readonly value="'+esc(pawn)+'" onclick="this.select()" style="font-family:monospace;font-size:11px;margin-bottom:8px"><button class="btn btn-sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(function(){alert(\'Copiato!\')})">Copia</button></div>';
}
async function loadSimHistory(){
  if(!currentChar)return;
  var sims=await apiFetch('/simulate/history/'+currentChar.id);
  if(!sims||!sims.length){hide('simHistoryTable');show('simHistoryEmpty');return}
  show('simHistoryTable');hide('simHistoryEmpty');
  setHtml('simHistoryBody',sims.map(function(s){
    var sc=s.status==='done'||s.status==='completed'?'color:var(--quality-uncommon)':s.status==='error'?'color:var(--red)':'color:var(--text-muted)';
    var rep=s.html_report?'<a href="'+esc(window.location.origin+s.html_report)+'" target="_blank" class="btn btn-sm">Report</a>':'-';
    return '<tr><td>'+esc(new Date(s.created_at).toLocaleString('it-IT'))+'</td><td>'+esc(currentChar.name)+'</td><td>'+esc(s.type)+'</td><td style="font-weight:700;color:var(--quality-uncommon)">'+(s.dps?fmt(s.dps):'-')+'</td><td>'+(s.duration_seconds?s.duration_seconds.toFixed(1)+'s':'-')+'</td><td style="'+sc+'">'+esc(s.status)+'</td><td>'+rep+'</td></tr>';
  }).join(''));
}

// STAT WEIGHTS PAGE
async function loadStatWeights(){
  if(!currentChar){hide('swContent');show('swEmpty');return}
  var sims=await apiFetch('/simulate/history/'+currentChar.id);
  var sw=null;
  if(sims&&sims.length){
    for(var i=0;i<sims.length;i++){
      if(sims[i].type==='stat_weights'&&(sims[i].status==='done'||sims[i].status==='completed')&&sims[i].stat_weights_json){sw=sims[i].stat_weights_json;break}
    }
  }
  if(!sw){hide('swContent');show('swEmpty');return}
  show('swContent');hide('swEmpty');
  renderStatBars('swBarsContainer',sw);
}

// INIT
try{loadSettingsValues();loadCharacters()}catch(e){console.error('Init:',e)}
