/* Browser presentation and input. Uses classic scripts so file:// works on Mac. */
(function () {
  'use strict';
  const Core = window.StellarCore;
  const $ = id => document.getElementById(id);
  const canvas = $('game-canvas'), ctx = canvas.getContext('2d');
  if (!ctx) { $('overlay-description').textContent = '此浏览器暂不支持 Canvas，请使用新版 Safari 或 Chrome。'; $('start-button').disabled = true; return; }
  const stage = $('stage');
  const game = Core.createGame({ width: stage.clientWidth, height: stage.clientHeight });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (touchDevice) $('start-hint').textContent = '拖动航道控制飞船 · 点击跃迁按钮避险';
  const keys = new Set();
  let pointer = null, particles = [], floats = [], stars = [], screenShake = 0, flashTime = 0;
  let previous = 0, visualTime = 0, toastUntil = 0, hudCache = '', lastSecond = 90;
  let unlocked=1,tutorialSeen=false,best=0,soundEnabled=true,musicEnabled=true,effectsVolume=.75,musicVolume=.42,selectedMode='campaign',pixelRatio=1;
  try {
    selectedMode=localStorage.getItem('stellar-courier-mode-v3')==='endless'?'endless':'campaign';
    best=Math.max(0,Number(localStorage.getItem('stellar-courier-best-v4-'+selectedMode))||0);
    unlocked=Math.max(1,Math.min(10,Math.floor(Number(localStorage.getItem('stellar-courier-unlocked-v4'))||1)));
    tutorialSeen=localStorage.getItem('stellar-courier-tutorial-v4')==='seen';
    soundEnabled=localStorage.getItem('stellar-courier-sound-v1')!=='off';
    musicEnabled=localStorage.getItem('stellar-courier-music-v3')!=='off';
    const fx=localStorage.getItem('stellar-courier-effects-volume-v3'),bg=localStorage.getItem('stellar-courier-music-volume-v3');
    if(fx!==null&&Number.isFinite(Number(fx)))effectsVolume=Math.max(0,Math.min(1,Number(fx)));
    if(bg!==null&&Number.isFinite(Number(bg)))musicVolume=Math.max(0,Math.min(1,Number(bg)));
  } catch(_) {}
  game.runMode=selectedMode;
  $('best-score').textContent = formatScore(best);

  function formatScore(score) { return String(Math.floor(score)).padStart(4,'0'); }
  function announce(message) { $('screen-reader-status').textContent = message; }
  const audio = window.StellarAudio.create({enabled:soundEnabled,musicEnabled,musicVolume,effectsVolume,onState:updateSoundButton});
  function audioInit() { return audio.unlock(); }
  function sound(kind) { audio.play(kind); }
  function updateSoundButton(state) {
    state = state || audio.snapshot();
    soundEnabled = state.enabled;
    $('sound-button').classList.toggle('sound-on',soundEnabled);
    $('sound-button').setAttribute('aria-label',soundEnabled ? '关闭音效' : '开启音效');
    $('sound-button').setAttribute('aria-pressed',String(soundEnabled));
    $('sound-label').textContent=soundEnabled?'音效开':'音效关';
    musicEnabled=state.musicEnabled;$('music-label').textContent=musicEnabled?'音乐开':'音乐关';
    $('music-button').setAttribute('aria-pressed',String(musicEnabled));$('music-button').setAttribute('aria-label',musicEnabled?'关闭背景音乐':'开启背景音乐');
    $('music-button').classList.toggle('sound-on',musicEnabled);
    $('sound-button').title = !soundEnabled ? '音效已关闭，点击开启（M）' : state.lastError ? '音频尚未就绪，点击试听重试' : state.contextState === 'running' ? '浏览器音频已就绪（M 静音）' : '音效已开启，点击开始或试听激活';
    $('test-sound-button').classList.toggle('audio-needs-help',!!state.lastError);
  }
  function toggleSound() {
    soundEnabled = !soundEnabled; audio.setEnabled(soundEnabled); updateSoundButton();
    try { localStorage.setItem('stellar-courier-sound-v1',soundEnabled ? 'on' : 'off'); } catch (_) {}
    if(soundEnabled)audio.test();
  }
  async function testSound() {
    soundEnabled = true; audio.setEnabled(true);
    try { localStorage.setItem('stellar-courier-sound-v1','on'); } catch (_) {}
    const result = await audio.test();
    const state = audio.snapshot();
    const message = state.contextState === 'running' && !state.lastError ? '试听音已触发 · 听不到请检查系统音量 / 标签页静音' : '浏览器音频未就绪 · 请再次点击试听，或检查声音权限';
    $('audio-status').textContent = message;
    toast(message,4,!!state.lastError); updateSoundButton();
    return result;
  }
  function savePreference(key,value){try{localStorage.setItem(key,String(value));}catch(_){}}
  function toggleMusic(){musicEnabled=!musicEnabled;audio.setMusicEnabled(musicEnabled);savePreference('stellar-courier-music-v3',musicEnabled?'on':'off');updateSoundButton();}
  function closeAudioSettings(){$('audio-settings').hidden=true;$('audio-settings-button').setAttribute('aria-expanded','false');}
  function selectMode(mode){
    if(!['ready','over'].includes(game.mode))return;
    selectedMode=mode==='endless'?'endless':'campaign';savePreference('stellar-courier-mode-v3',selectedMode);
    try{best=Math.max(0,Number(localStorage.getItem('stellar-courier-best-v4-'+selectedMode))||0);}catch(_){best=0;}
    $('best-score').textContent=formatScore(best);$('record-label').textContent=selectedMode==='campaign'?'全程通关纪录':'无尽正式纪录';
    $('practice-panel').hidden=selectedMode!=='campaign';
    if(game.mode==='over')$('retry-button').hidden=game.reason==='victory'||selectedMode!==game.runMode;
    ['campaign','endless'].forEach(m=>$('mode-'+m).setAttribute('aria-pressed',String(selectedMode===m)));
    if(game.mode==='ready'){
      game.runMode=selectedMode;
      $('overlay-description').innerHTML=selectedMode==='endless'?'没有倒计时，没有终点。<br>不断升级的航线，看看你能坚持到第几波。':'十关逐步解锁雷区、航门、风带与风暴。<br>每关独立倒计时，跟着旋律逐站前进。';
      hudCache='';updateHUD();
    }
  }
  function resize() {
    const rect = stage.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1,2);
    canvas.width = Math.round(rect.width * pixelRatio); canvas.height = Math.round(rect.height * pixelRatio);
    Core.resize(game,rect.width,rect.height);
    pointer = null;
    const rng = seededVisual(41);
    stars = Array.from({length:Math.round(rect.width*rect.height/2500)},() => ({x:rng()*rect.width,y:rng()*rect.height,r:.4+rng()*1.15,a:.15+rng()*.55,phase:rng()*6.28}));
  }
  function seededVisual(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed-1)/2147483646; }; }
  function clearInput() { keys.clear(); pointer = null; }
  function updatePracticeOptions(){
    const previous=Number($('practice-level').value)||1;
    $('practice-level').innerHTML=Core.LEVELS.slice(0,unlocked).map((level,i)=>'<option value="'+(i+1)+'">'+(i+1)+' · '+level.name+'</option>').join('');
    $('practice-level').value=String(Math.min(previous,unlocked));
    $('practice-summary').textContent='关卡练习 · 已解锁 '+unlocked+' / 10';
  }
  function unlockLevel(level){
    if(game.runMode!=='campaign')return;
    unlocked=Math.max(unlocked,Math.min(10,level));savePreference('stellar-courier-unlocked-v4',unlocked);updatePracticeOptions();
  }
  function clearVisuals(){clearInput();particles=[];floats=[];screenShake=0;flashTime=0;hudCache='';$('toast').classList.remove('visible');closeAudioSettings();}
  function focusCanvas(){try{canvas.focus({preventScroll:true});}catch(_){canvas.focus();}}
  function activateState(restartMusic){
    clearInput();$('overlay').hidden=true;$('flow-overlay').hidden=true;
    $('pause-button').disabled=!['playing','tutorial'].includes(game.mode);
    $('pause-button').setAttribute('aria-label','暂停游戏');
    if(game.mode==='playing'){audio.musicStart({restart:!!restartMusic});focusCanvas();}
    else if(game.mode==='tutorial'||game.mode==='upgrade'){audio.musicPause();showFlow();}
    else if(game.mode==='paused'){audio.musicPause();showOverlay('paused');}
    updateHUD();
  }
  function begin(){
    audio.musicPause();clearVisuals();Core.start(game,selectedMode,{tutorialSeen});
    activateState(true);sound('start');
    toast((game.runMode==='endless'?'正式无尽第 1 波：':'正式全程第 1 关：')+'先送达 4 箱，再选择改装。',3.5);
    announce('正式挑战开始。每关完成后选择临时改装。');
  }
  function beginPractice(){
    if(!['ready','over'].includes(game.mode))return;
    const level=Number($('practice-level').value);
    if(!Core.startPractice(game,level,unlocked,{tutorialSeen}))return;
    audio.musicPause();clearVisuals();selectedMode='campaign';activateState(true);sound('start');
    toast('关卡练习：不写全程纪录 · 满盾、完整时间、均衡舱',3);
  }
  function retryCurrent(){
    if(!Core.retryLevel(game))return;
    audio.musicPause();clearVisuals();activateState(true);sound('start');
    toast('本关重试：满盾满时，目标与分数归零；保留本关改装，不计正式纪录',4);
  }
  function goMenu(){
    audio.musicPause();clearVisuals();Core.toMenu(game,selectedMode,{tutorialSeen});
    $('flow-overlay').hidden=true;$('overlay').hidden=false;$('overlay').className='overlay';
    $('result-stats').hidden=true;$('result-detail').hidden=true;$('retry-button').hidden=true;
    $('restart-button').hidden=true;$('menu-button').hidden=true;$('mode-picker').hidden=false;
    $('overlay-kicker').textContent='READY FOR TAKEOFF';$('overlay-title').textContent='银河远征，现在启航。';
    $('start-label').textContent='开始正式挑战';$('start-button').classList.remove('secondary-start');
    $('start-hint').textContent='方向键 / WASD 移动 · 空格冲刺 · Enter 出发';
    $('pause-button').disabled=true;selectMode(selectedMode);updatePracticeOptions();updateHUD();
  }
  function setPaused(shouldPause){
    if(shouldPause&&['playing','tutorial'].includes(game.mode)){
      Core.pause(game);audio.musicPause();closeAudioSettings();clearInput();$('flow-overlay').hidden=true;showOverlay('paused');
      $('pause-button').setAttribute('aria-label','继续游戏');announce('已暂停。');
    }else if(!shouldPause&&game.mode==='paused'){Core.resume(game);activateState(false);announce('继续。');}
    updateHUD();
  }
  function refitInfo(){return Core.REFITS.find(r=>r.id===game.refit)||Core.REFITS[0];}
  function showFlow(){
    $('overlay').hidden=true;$('flow-overlay').hidden=false;audio.musicPause();closeAudioSettings();
    const tutorial=game.mode==='tutorial';$('tutorial-panel').hidden=!tutorial;$('upgrade-options').hidden=tutorial;
    $('flow-kicker').textContent=tutorial?'SAFE FLIGHT SCHOOL':'ONE RUN. ONE BUILD.';
    $('flow-title').textContent=tutorial?'先试一次，不扣时间。':'过关！选择下一关改装';
    $('flow-description').textContent=tutorial?'方向键移动，空格冲刺击碎练习石。不扣盾、不计分；可随时跳过。':'三选一，替换当前改装；仅本局生效。下一站：'+Core.levelConfig(game).name;
    if(!tutorial){
      $('upgrade-options').innerHTML=Core.REFITS.map(r=>'<button type="button" class="upgrade-choice" data-refit="'+r.id+'"><strong>'+r.name+(r.id===game.refit?' · 当前':'')+'</strong><span>'+r.capacity+' 格货舱 · 冲刺 '+r.cooldown+' 秒</span><small>'+r.description+'</small></button>').join('');
      $('upgrade-options').querySelectorAll('button').forEach(button=>button.addEventListener('click',function(){
        if(!Core.chooseUpgrade(game,this.dataset.refit))return;
        processEvents();activateState(false);sound('powerup');
      }));
      $('upgrade-options').querySelector('button').focus({preventScroll:true});
    }else{$('tutorial-canvas').focus({preventScroll:true});syncTutorialUI();}
  }
  function syncTutorialUI(){
    const success=!!(game.tutorial&&game.tutorial.success);
    $('tutorial-boost').hidden=success;$('tutorial-finish').hidden=!success;
    $('tutorial-status').textContent=success?'击碎成功！练习不计入正式碎石目标。':'默认朝右，按空格或下方按钮冲刺';
    $('tutorial-skip').textContent=success?'直接进入本关':'跳过练习，直接开始';
  }
  function leaveTutorial(skip){
    const ok=skip?Core.skipTutorial(game):Core.finishTutorial(game);if(!ok)return;
    tutorialSeen=true;savePreference('stellar-courier-tutorial-v4','seen');processEvents();activateState(false);
  }
  function missingText(){
    const o=Core.objectives(game),parts=[];
    parts.push(o.cargo.done?'送货已完成':'还差 '+o.cargo.remaining+' 箱投递');
    if(o.smash.goal)parts.push(o.smash.done?'碎石已完成':'还差 '+o.smash.remaining+' 颗陨石要冲刺击碎');
    return parts.join('；');
  }
  function showOverlay(kind){
    const over=kind==='over';$('flow-overlay').hidden=true;$('overlay').hidden=false;$('overlay').className='overlay '+(over?'game-over':'paused');
    $('mode-picker').hidden=true;$('practice-panel').hidden=true;
    $('result-stats').hidden=!over;$('result-detail').hidden=!over;$('restart-button').hidden=over;$('menu-button').hidden=false;
    $('retry-button').hidden=!over||game.reason==='victory';$('start-button').classList.toggle('secondary-start',over&&game.reason!=='victory');
    if(!over){
      $('overlay-kicker').textContent='TAKE A LITTLE BREAK';$('overlay-title').textContent='宇宙可以等一等。';
      $('overlay-description').textContent=game.pausedFrom==='tutorial'?'练习已暂停，正式关卡时间没有流逝。':'航程已暂停，货物与目标进度保持不变。';
      $('start-label').textContent='继续';$('start-hint').textContent='P / Esc 继续 · 返回菜单会放弃本次挑战';
    }else{
      const eligible=game.recordEligible&&(game.runMode==='endless'||game.reason==='victory');
      const isRecord=eligible&&game.score>best;
      if(isRecord){best=game.score;$('best-score').textContent=formatScore(best);savePreference('stellar-courier-best-v4-'+game.runMode,best);}
      $('overlay-kicker').textContent=isRecord?'A VERIFIED FULL-RUN RECORD':game.recordEligible?'DELIVERY REPORT':'PRACTICE / CONTINUE · UNRANKED';
      $('overlay-title').textContent=game.reason==='victory'?'十关通关，银河传奇！':'本关未完成，不用从头来。';
      $('overlay-description').innerHTML=game.reason==='victory'?(eligible?'完整全程通关，已具备纪录资格。':'练习 / 续关完成，不写正式全程纪录。'):(game.reason==='health'?'护盾耗尽。':'本关时间到。')+'<br>'+missingText()+'。';
      $('result-score').textContent=game.score.toLocaleString('zh-CN');$('result-deliveries').textContent=game.deliveries+' 单';
      $('result-detail').textContent=(eligible?'正式纪录合格':game.recordEligible?'未完整通关，不写全程纪录':'练习 / 重试不计正式纪录')+' · '+refitInfo().name;
      $('retry-button').textContent='重试本'+(game.runMode==='endless'?'波':'关')+' · 满盾满时';
      $('start-label').textContent='从第一'+(selectedMode==='endless'?'波':'关')+'重新正式挑战';
      $('start-hint').textContent=game.reason==='victory'?'可重开全程或选择已解锁关卡练习':'重试会清零本段分数、目标与连单；保留改装';
      $('pause-button').disabled=true;updatePracticeOptions();
      announce('本次结束。'+missingText()+'。可重试本关或重新挑战。');
    }
    const target=over&&!$('retry-button').hidden?$('retry-button'):$('start-button');target.focus({preventScroll:true});
  }
  function toast(message, duration, danger) {
    $('toast').textContent = message; $('toast').className = 'toast visible' + (danger ? ' danger' : '');
    toastUntil = visualTime + (duration || 2);
  }
  function updateHUD() {
    const remaining=game.runMode==='endless'?Math.floor(game.elapsed):Math.ceil(game.timeLeft), cache = [game.score,game.cargo,game.health,remaining,game.mode,game.level,game.levelCargo,game.combo,game.levelSmashes,game.runMode,game.refit,game.recordEligible].join(':');
    if (cache !== hudCache) {
      hudCache = cache;
      $('score').textContent = formatScore(game.score);
      $('time').textContent = String(Math.floor(remaining/60)).padStart(2,'0') + ':' + String(remaining%60).padStart(2,'0');
      $('time-label').textContent=game.runMode==='endless'?'已飞行':'本关航时';
      $('time').parentElement.classList.toggle('urgent',game.runMode!=='endless'&&remaining<=15);
      const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21 3.8 12.8C-2.5 6.5 5.8-.8 12 6c6.2-6.8 14.5.5 8.2 6.8Z"/></svg>';
      $('health').innerHTML = '<span>' + heart.repeat(Math.max(0,game.health)) + '</span><span class="heart-lost">' + heart.repeat(3-Math.max(0,game.health)) + '</span>';
      $('cargo-count').textContent = game.cargo;
      $('cargo-value').textContent = '+' + Core.nextPayout(game).toLocaleString('zh-CN');
      const capacity=Core.capacity(game);$('cargo-capacity').textContent=capacity;
      $('cargo-caption').textContent=game.cargo===capacity?'满仓！去投递吧':game.cargo?'送达后可获得':'等你装满期待';
      if($('cargo-slots').children.length!==capacity)$('cargo-slots').innerHTML='<span></span>'.repeat(capacity);
      $('cargo-slots').setAttribute('aria-label','货舱 '+game.cargo+' / '+capacity);
      Array.from($('cargo-slots').children).forEach((slot,i) => slot.classList.toggle('filled',i < game.cargo));
      const level=Core.levelConfig(game);
      $('level-label').textContent = (game.runMode==='endless'?'第 '+game.level+' 波':game.level+' / 10')+' · '+level.name;
      const objective=Core.objectives(game);
      const check='<svg class="goal-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
      $('level-goal').innerHTML=(objective.cargo.done?check:'')+'送货 '+objective.cargo.progress+'/'+objective.cargo.goal+' 箱'+(objective.cargo.done?' · 已完成':'');
      $('level-goal').classList.toggle('goal-complete',objective.cargo.done);
      $('smash-goal').hidden=!objective.smash.goal;
      $('smash-goal').innerHTML=(objective.smash.done?check:'')+'碎石 '+objective.smash.progress+'/'+objective.smash.goal+' 颗'+(objective.smash.done?' · 已完成':' · 空格冲刺');
      $('smash-goal').classList.toggle('goal-complete',objective.smash.done);
      $('level-fill').style.width=(objective.cargo.progress/objective.cargo.goal*100)+'%';
      $('run-badge').textContent=(game.recordEligible?(game.runMode==='endless'?'正式无尽':'正式全程'):game.origin==='retry'?'重试 · 不计纪录':'练习 · 不计纪录')+' / '+refitInfo().name;
      $('sector-name').textContent=(game.runMode==='endless'?'无尽 · 第 '+game.level+' 波':'第 '+game.level+' 站')+' / '+level.name;
      $('mission-target').textContent=(game.runMode==='endless'?'本波：送达 ':'本关：送达 ')+level.goal+' 箱'+(level.smashGoal?' + 击碎 '+level.smashGoal+' 颗陨石':'');
      $('flight-tip').textContent=objective.cargo.done&&objective.smash.remaining>0?'送货已完成！接下来只需冲刺碎石，还差 '+objective.smash.remaining+' 颗。':level.lesson;
      $('mission-reward').textContent = game.level === 10 && game.runMode==='campaign' ? '通关 +' + level.reward + ' 分，剩余每秒另奖 15 分。' : '过关 +' + level.reward + ' 分，恢复 1 格护盾。';
    }
    const chaining = game.comboTime > 0;
    $('combo-meter').classList.toggle('chaining',chaining);
    $('combo-label').textContent = chaining ? game.combo + ' 连单 · 下一单 ×' + Core.multiplier(game.combo+1).toFixed(1) : '连单待命';
    $('combo-clock').textContent = chaining ? game.comboTime.toFixed(1) + 's 内送达，保住连单！' : '12 秒内再送一单可加倍';
    $('combo-fill').style.width = (game.comboTime/Core.COMBO_WINDOW*100) + '%';
    const effects = [['magnetTime','磁吸','magnet-color'],['shieldTime','护盾','shield-color'],['slowTime','时缓','slow-color']];
    $('power-status').innerHTML = effects.filter(e=>game[e[0]]>0).map(e=>'<span class="'+e[2]+'">'+e[1]+' '+game[e[0]].toFixed(1)+'s</span>').join('');
    const cooldown = game.boostCooldown, ready = cooldown <= 0;
    $('boost-button').disabled=game.mode!=='playing'||!ready;
    $('boost-button').setAttribute('aria-label','跃迁冲刺，冷却 '+Core.boostCooldown(game)+' 秒');
    $('boost-title').textContent = !ready ? '充能中 ' + cooldown.toFixed(1) + 's' : '跃迁冲刺';
    $('boost-description').textContent = !ready ? '稍等一下，下一次更快' : '撞碎陨石 +40 · 每 '+Core.boostCooldown(game)+' 秒一次';
    $('boost-fill').style.width = ((1-cooldown/Core.boostCooldown(game))*100) + '%';
    if(game.runMode!=='endless'&&remaining===15&&lastSecond!==15&&game.mode==='playing') toast('最后 15 秒：'+missingText(),3);
    lastSecond = remaining;
  }
  function burst(x,y,color,count) {
    if (reducedMotion) count = Math.min(count,4);
    for (let i=0;i<count;i++) {
      const angle = Math.random()*Math.PI*2, speed = 30+Math.random()*120;
      particles.push({x:x,y:y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:.35+Math.random()*.45,max:.8,color:color,r:1+Math.random()*2.5});
    }
  }
  function processEvents() {
    for (const e of game.events) {
      if (e.type === 'pickup') {
        burst(e.x,e.y,'#f6c978',12); sound('pickup');
        if(e.cargo===Core.capacity(game)) toast('满仓！这一单预计 +' + Core.nextPayout(game).toLocaleString('zh-CN') + ' 分',2.5);
      } else if (e.type === 'deliver') {
        burst(e.x,e.y,'#8cf0ce',34); sound('deliver');
        floats.push({x:e.x,y:e.y-30,text:'+'+e.amount,life:1.4,color:'#adffe0'});
        flashTime = reducedMotion ? 0 : .35;
        toast(e.combo > 1 ? e.combo + ' 连单 ×' + e.multiplier.toFixed(1) + '！+' + e.amount + ' 分' : '送达 +' + e.amount + '！12 秒内再送一单加倍',2.8);
        if(e.combo>1)floats.push({x:game.player.x,y:game.player.y-48,text:e.combo+' 连单！',life:1.1,color:'#f6c978'});
      } else if (e.type === 'hit') {
        burst(e.x,e.y,'#ff8296',22); sound('hit'); screenShake = reducedMotion ? 0 : .25;
        toast(e.lost ? '撞到陨石！丢失 '+e.lost+' 箱货物' : '护盾受损！试试空格跃迁躲避',2.5,true);
      } else if (e.type === 'boost') { burst(e.x,e.y,'#83dce9',10); sound('boost'); }
      else if (e.type === 'smash') { burst(e.x,e.y,'#b3a4ff',24); sound('smash');screenShake=reducedMotion?0:.12;floats.push({x:e.x,y:e.y-18,text:'+'+e.amount,life:.8,color:'#bdb0ff'}); }
      else if (e.type === 'deflect') { burst(e.x,e.y,'#8cf0ce',18);sound('powerup'); }
      else if (e.type === 'powerup') { const names={magnet:'磁吸开启 8 秒：附近货箱自动入舱',shield:'护盾开启 6 秒：放心穿过陨石',slow:'时缓开启 6 秒：陨石速度大幅降低'};burst(e.x,e.y,'#9adfff',24);sound('powerup');toast(names[e.power],3);announce(names[e.power]); }
      else if(e.type==='teleport'){burst(e.x,e.y,'#80d5ff',24);sound('boost');}
      else if(e.type==='upgrade'){audio.musicPause();clearInput();unlockLevel(game.level);showFlow();sound('level');}
      else if(e.type==='tutorialSuccess'){sound('smash');syncTutorialUI();announce('练习击碎成功。开始本关或跳过继续。');}
      else if(e.type==='tutorialBoost'){sound('boost');}
      else if (e.type === 'level') { sound('level');flashTime=reducedMotion?0:.6;toast((game.runMode==='endless'?'第 '+e.level+' 波':'第 '+e.level+' 站')+' · '+e.name+'：'+e.lesson,5);announce('进入第'+e.level+'站。'+e.name+'。过关奖励'+e.amount+'分。'); }
      else if (e.type === 'comboLost') { if(game.mode==='playing')toast('连单中断，下一次送达重新开始',1.6); }
      else if(e.type==='over'){audio.musicPause();if(e.reason==='victory')unlockLevel(10);sound(e.reason==='victory'?'victory':'over');clearInput();showOverlay('over'); }
    }
    game.events.length = 0;
  }
  function inputVector() {
    let x = 0, y = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) x--;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x++;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y--;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y++;
    if (!x && !y && pointer) {
      x = pointer.x-game.player.x; y = pointer.y-game.player.y;
      const distance = Math.hypot(x,y);
      if (distance < 4) return {x:0,y:0};
      const strength = Math.min(1,distance/30); x = x/distance*strength; y = y/distance*strength;
    }
    return {x:x,y:y};
  }
  function boost(){audioInit();const teaching=game.mode==='tutorial';const fired=Core.boost(game);if(teaching&&fired)sound('boost');processEvents();updateHUD();}
  const movementKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'];
  document.addEventListener('keydown',function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (movementKeys.includes(e.code)) { if(['playing','tutorial'].includes(game.mode)){e.preventDefault();keys.add(e.code);} return; }
    if (['Space','KeyP','Escape','KeyM','Enter'].includes(e.code)) {
      // Preserve native keyboard activation for focused controls.
      if(e.code==='Escape'&&!$('audio-settings').hidden){e.preventDefault();closeAudioSettings();return;}
      if (e.code === 'Space' && e.target.tagName === 'BUTTON') return;
      if (e.code === 'Enter' && e.target.tagName === 'BUTTON' && e.target !== $('start-button')) return;
      if (e.code !== 'KeyM' || !e.repeat) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'Space') { if(['playing','tutorial'].includes(game.mode))boost(); }
      else if (e.code === 'KeyP' || e.code === 'Escape') setPaused(['playing','tutorial'].includes(game.mode));
      else if (e.code === 'KeyM') toggleSound();
      else if (e.code === 'Enter') { if (game.mode === 'ready' || game.mode === 'over') begin(); else if(game.mode==='paused')setPaused(false);else if(game.mode==='tutorial'){if(game.tutorial.success)leaveTutorial(false);else boost();} }
    }
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur',function () { clearInput(); if(['playing','tutorial'].includes(game.mode))setPaused(true); });
  document.addEventListener('visibilitychange',function () { if (document.hidden) { clearInput(); if(['playing','tutorial'].includes(game.mode))setPaused(true); } });
  function pointFromEvent(e) { const r = canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*game.width/r.width,y:(e.clientY-r.top)*game.height/r.height,id:e.pointerId}; }
  canvas.addEventListener('pointerdown',function (e) {
    if (game.mode !== 'playing' || pointer || e.button > 0) return;
    e.preventDefault(); pointer = pointFromEvent(e); canvas.setPointerCapture(e.pointerId); audioInit();
  });
  canvas.addEventListener('pointermove',function (e) { if (pointer && e.pointerId === pointer.id) { e.preventDefault(); pointer = pointFromEvent(e); } });
  ['pointerup','pointercancel','lostpointercapture'].forEach(name => canvas.addEventListener(name,function (e) { if (pointer && e.pointerId === pointer.id) pointer = null; }));
  $('start-button').addEventListener('click',function () { if (game.mode === 'paused') setPaused(false); else if (game.mode === 'ready' || game.mode === 'over') begin(); });
  $('restart-button').addEventListener('click',function(){if(game.mode==='paused')begin();});
  $('retry-button').addEventListener('click',retryCurrent);$('practice-button').addEventListener('click',beginPractice);
  $('menu-button').addEventListener('click',goMenu);$('flow-menu').addEventListener('click',goMenu);
  $('tutorial-boost').addEventListener('click',boost);$('tutorial-finish').addEventListener('click',()=>leaveTutorial(false));$('tutorial-skip').addEventListener('click',()=>leaveTutorial(true));
  $('pause-button').addEventListener('click',() => setPaused(['playing','tutorial'].includes(game.mode)));
  $('sound-button').addEventListener('click',toggleSound);
  $('test-sound-button').addEventListener('click',testSound);
  $('music-button').addEventListener('click',toggleMusic);
  $('audio-settings-button').addEventListener('click',function(){const open=$('audio-settings').hidden;$('audio-settings').hidden=!open;this.setAttribute('aria-expanded',String(open));});
  document.addEventListener('pointerdown',function(e){if(!$('audio-settings').contains(e.target)&&!$('audio-settings-button').contains(e.target))closeAudioSettings();});
  [['effects',effectsVolume],['music',musicVolume]].forEach(function(pair){const type=pair[0],value=pair[1],input=$(type+'-volume');input.value=value;$(type+'-volume-value').textContent=Math.round(value*100)+'%';input.addEventListener('input',function(){const v=Number(this.value);if(type==='music')audio.setMusicVolume(v);else audio.setEffectsVolume(v);savePreference('stellar-courier-'+type+'-volume-v3',v);$(type+'-volume-value').textContent=Math.round(v*100)+'%';});});
  ['campaign','endless'].forEach(m=>$('mode-'+m).addEventListener('click',()=>selectMode(m)));
  $('boost-button').addEventListener('click',boost);
  window.addEventListener('resize',resize);

  function roundedRect(x,y,w,h,r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function drawBackground(t) {
    const w = game.width,h = game.height;
    ctx.fillStyle = '#0a1220'; ctx.fillRect(0,0,w,h);
    const nebula = ctx.createRadialGradient(w*.73,h*.42,0,w*.73,h*.42,w*.64);
    nebula.addColorStop(0,'#17394355'); nebula.addColorStop(.45,'#172d4140'); nebula.addColorStop(1,'#121b2c00'); ctx.fillStyle=nebula; ctx.fillRect(0,0,w,h);
    const nebula2 = ctx.createRadialGradient(w*.18,h*.86,0,w*.18,h*.86,w*.45);
    nebula2.addColorStop(0,'#33284d44'); nebula2.addColorStop(1,'#181c3500'); ctx.fillStyle=nebula2; ctx.fillRect(0,0,w,h);
    // Quiet navigation grid, circular orbital tracks, and a distant planet.
    ctx.lineWidth=.6; ctx.strokeStyle='#35516b17'; ctx.beginPath();
    for(let x=0;x<w;x+=48){ctx.moveTo(x,0);ctx.lineTo(x,h);} for(let y=0;y<h;y+=48){ctx.moveTo(0,y);ctx.lineTo(w,y);} ctx.stroke();
    ctx.strokeStyle='#54758a13';
    [w*.24,w*.42,w*.65].forEach(r => {ctx.beginPath();ctx.ellipse(w*.78,h*.1,r,r*.68,-.4,0,Math.PI*2);ctx.stroke();});
    const px=w*.94,py=h*.17,pr=Math.min(w,h)*.18;
    const planet=ctx.createRadialGradient(px-pr*.3,py-pr*.4,0,px,py,pr); planet.addColorStop(0,'#2c4b5a33');planet.addColorStop(.8,'#162d3c33');planet.addColorStop(1,'#0c172711');
    ctx.fillStyle=planet;ctx.beginPath();ctx.arc(px,py,pr,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#6f9aa315';ctx.stroke();
    for(const star of stars){const a=star.a*(reducedMotion?.8:.7+.3*Math.sin(t*.7+star.phase));ctx.globalAlpha=a;ctx.fillStyle='#aec5d7';ctx.beginPath();ctx.arc(star.x,star.y,star.r,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    // Sparse cross-shaped navigational stars.
    [[.12,.33],[.67,.81],[.89,.57]].forEach(pos => {const x=w*pos[0],y=h*pos[1];ctx.strokeStyle='#91c6d54d';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke();});
  }
  function drawMechanics(t) {
    const w=game.width,h=game.height;
    if(Core.has(game,'wind')){
      const direction=Math.floor(game.stageElapsed/6)%2?-1:1;
      ctx.fillStyle='#80d5ff09';ctx.fillRect(0,h*.36,w,h*.32);
      ctx.strokeStyle='#80d5ff26';ctx.lineWidth=1;ctx.setLineDash([4,8]);ctx.beginPath();ctx.moveTo(0,h*.36);ctx.lineTo(w,h*.36);ctx.moveTo(0,h*.68);ctx.lineTo(w,h*.68);ctx.stroke();ctx.setLineDash([]);
      for(let x=35;x<w;x+=65){const y=h*.52;ctx.strokeStyle='#80d5ff44';ctx.beginPath();ctx.moveTo(x-direction*10,y);ctx.lineTo(x+direction*10,y);ctx.lineTo(x+direction*4,y-4);ctx.moveTo(x+direction*10,y);ctx.lineTo(x+direction*4,y+4);ctx.stroke();}
    }
    if(Core.has(game,'moving')){ctx.save();ctx.strokeStyle='#8cf0ce22';ctx.setLineDash([2,10]);ctx.beginPath();ctx.ellipse(w*.5,h*.53,w*.29,h*.24,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
    for(let i=0;i<game.portals.length;i++){
      const gate=game.portals[i];ctx.save();ctx.translate(gate.x,gate.y);ctx.rotate(reducedMotion?0:t*.5);ctx.lineWidth=2;ctx.strokeStyle='#80d5ff';ctx.beginPath();ctx.arc(0,0,gate.r,0,Math.PI*1.7);ctx.stroke();ctx.strokeStyle='#b0afff66';ctx.beginPath();ctx.arc(0,0,gate.r-6,0,Math.PI*1.7);ctx.stroke();ctx.restore();ctx.textAlign='center';ctx.font='9px -apple-system,sans-serif';ctx.fillStyle='#8bb7d5';ctx.fillText('航门 '+(i?'B':'A'),gate.x,gate.y+39);
    }
    for(const mine of game.mines){if(mine.wait>0)continue;ctx.save();ctx.translate(mine.x,mine.y);ctx.strokeStyle=mine.active?'#ff8296':'#c4aa62';ctx.fillStyle=mine.active?'#ff829619':'#c4aa6210';ctx.lineWidth=mine.active?2:1;ctx.beginPath();ctx.arc(0,0,mine.active?33:19,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#24303d';ctx.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2?8:14;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=mine.active?'#ff8296':'#e7cc83';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.restore();}
    for(const drone of game.drones){if(drone.wait>0)continue;ctx.save();ctx.translate(drone.x,drone.y);ctx.rotate(Math.atan2(game.player.y-drone.y,game.player.x-drone.x));ctx.fillStyle='#613241';ctx.strokeStyle='#ff8296';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(0,12);ctx.lineTo(-13,6);ctx.lineTo(-8,0);ctx.lineTo(-13,-6);ctx.lineTo(0,-12);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#ffc0cc';ctx.beginPath();ctx.arc(4,0,3,0,Math.PI*2);ctx.fill();ctx.restore();}
    if(Core.has(game,'storm')){
      ctx.save();ctx.translate(w*.5,h*.55);const warning=game.stormRadius<0;ctx.strokeStyle=warning?'#c0a3ff55':'#c0a3ff99';ctx.lineWidth=warning?1:5;ctx.beginPath();ctx.arc(0,0,warning?20:game.stormRadius,0,Math.PI*2);ctx.stroke();if(warning){ctx.fillStyle='#b59dda';ctx.textAlign='center';ctx.font='9px -apple-system,sans-serif';ctx.fillText('风暴蓄能',0,35);}ctx.restore();
    }
  }
  function drawStation(t) {
    const a=game.station, active=game.cargo>0;
    ctx.save();ctx.translate(a.x,a.y);
    const glow=ctx.createRadialGradient(0,0,9,0,0,64);glow.addColorStop(0,active?'#8cf0ce25':'#8cf0ce0c');glow.addColorStop(1,'#8cf0ce00');ctx.fillStyle=glow;ctx.fillRect(-64,-64,128,128);
    ctx.strokeStyle=active?'#8cf0ceaa':'#8cf0ce55';ctx.lineWidth=1;ctx.setLineDash([3,5]);ctx.beginPath();ctx.arc(0,0,a.r+5,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    ctx.save();ctx.rotate(reducedMotion?0:t*.2);ctx.strokeStyle='#8cf0ce99';ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(0,0,a.r-2,i*Math.PI*2/3,i*Math.PI*2/3+1.1);ctx.stroke();}ctx.restore();
    ctx.fillStyle='#173b35';ctx.strokeStyle='#8cf0ce';ctx.lineWidth=1.4;roundedRect(-13,-13,26,26,5);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(0,5);ctx.lineTo(7,-5);ctx.stroke();
    ctx.fillStyle=active?'#b3f7da':'#6eaa98';ctx.textAlign='center';ctx.font='10px -apple-system, BlinkMacSystemFont, sans-serif';ctx.fillText(Core.has(game,'moving')?'移动投递站':'投递站',0,a.r+22);
    if(active){ctx.fillStyle='#638e84';ctx.font='8px -apple-system, sans-serif';ctx.fillText('靠近自动投递',0,a.r+35);}ctx.restore();
  }
  function drawRoute(t) {
    if(!game.cargo && game.mode!=='ready') return;
    const p=game.player,s=game.station;
    ctx.save();ctx.strokeStyle='#8cf0ce22';ctx.lineWidth=1;ctx.setLineDash([3,8]);ctx.lineDashOffset=reducedMotion?0:-t*12;
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(s.x,s.y);ctx.stroke();ctx.restore();
  }
  function drawItem(item,t) {
    if(item.wait>0)return;
    ctx.save();ctx.translate(item.x,item.y+(reducedMotion?0:Math.sin(t*2+item.phase)*2.5));ctx.rotate(Math.sin(item.phase)*.2);
    const glow=ctx.createRadialGradient(0,0,2,0,0,24);glow.addColorStop(0,'#f6c9781c');glow.addColorStop(1,'#f6c97800');ctx.fillStyle=glow;ctx.fillRect(-24,-24,48,48);
    ctx.fillStyle='#514334';ctx.strokeStyle='#e9bc71';ctx.lineWidth=1.3;roundedRect(-8,-8,16,16,2);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#f8d38d';ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(0,-1);ctx.moveTo(-3,4);ctx.lineTo(3,4);ctx.stroke();ctx.restore();
  }
  function drawPowerup(item,t) {
    const color = {magnet:'#80d5ff',shield:'#8cf0ce',slow:'#c0a3ff'}[item.type];
    ctx.save();ctx.translate(item.x,item.y);
    if(item.ttl<3&&!reducedMotion)ctx.globalAlpha=.45+Math.sin(t*9)*.3;
    const glow=ctx.createRadialGradient(0,0,3,0,0,34);glow.addColorStop(0,color+'33');glow.addColorStop(1,color+'00');ctx.fillStyle=glow;ctx.fillRect(-34,-34,68,68);
    ctx.fillStyle='#152738';ctx.strokeStyle=color;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(0,-18);ctx.lineTo(18,0);ctx.lineTo(0,18);ctx.lineTo(-18,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.lineWidth=2;ctx.lineCap='round';ctx.beginPath();
    if(item.type==='magnet'){ctx.moveTo(-6,-6);ctx.lineTo(-6,2);ctx.arc(0,2,6,Math.PI,0,true);ctx.lineTo(6,-6);}
    else if(item.type==='shield'){ctx.moveTo(0,-8);ctx.lineTo(7,-5);ctx.lineTo(6,3);ctx.lineTo(0,9);ctx.lineTo(-6,3);ctx.lineTo(-7,-5);ctx.closePath();}
    else{ctx.arc(0,0,8,0,Math.PI*2);ctx.moveTo(0,-5);ctx.lineTo(0,0);ctx.lineTo(4,2);}ctx.stroke();
    ctx.fillStyle=color;ctx.font='9px -apple-system, sans-serif';ctx.textAlign='center';ctx.fillText({magnet:'磁吸 8s',shield:'护盾 6s',slow:'时缓 6s'}[item.type],0,32);ctx.restore();
  }
  function drawHazard(a) {
    if(a.delay>0)return;
    ctx.save();ctx.translate(a.x,a.y);ctx.rotate(a.angle);ctx.fillStyle=game.slowTime>0?'#272e46':'#29303f';ctx.strokeStyle=game.slowTime>0?'#9c8fc2':game.level===3?'#966b83':'#707e96';ctx.lineWidth=1;
    ctx.beginPath();for(let i=0;i<a.vertices.length;i++){const angle=i/a.vertices.length*Math.PI*2,r=a.r*a.vertices[i];if(!i)ctx.moveTo(Math.cos(angle)*r,Math.sin(angle)*r);else ctx.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);}ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#151e2c';ctx.strokeStyle='#464f62';ctx.beginPath();ctx.ellipse(-a.r*.25,-a.r*.1,a.r*.25,a.r*.18,.5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(a.r*.35,a.r*.21,a.r*.12,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawShip(t) {
    const p=game.player;
    if(game.magnetTime>0){ctx.save();ctx.strokeStyle='#80d5ff22';ctx.lineWidth=1;ctx.setLineDash([3,9]);ctx.beginPath();ctx.arc(p.x,p.y,Math.min(140,game.width*.35),0,Math.PI*2);ctx.stroke();ctx.restore();}
    if(game.shieldTime>0){ctx.save();ctx.fillStyle='#8cf0ce0b';ctx.strokeStyle='#8cf0ceaa';ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(p.x,p.y,30,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
    if(game.invulnerable>0 && Math.floor(t*12)%2===0 && !reducedMotion)ctx.globalAlpha=.48;
    ctx.save();ctx.translate(p.x,p.y+(game.mode==='ready'&&!reducedMotion?Math.sin(t*1.8)*3:0));ctx.rotate(p.angle);
    if(game.boostTime>0){ctx.strokeStyle='#8cf0ceaa';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,0,29,23,0,0,Math.PI*2);ctx.stroke();}
    const moving=game.mode==='playing'&&(keys.size>0||pointer||game.boostTime>0), flame=(moving?18:9)+(reducedMotion?0:Math.sin(t*40)*3);
    ctx.fillStyle=game.boostTime>0?'#a7fff2':'#edb767';ctx.beginPath();ctx.moveTo(-9,-5);ctx.quadraticCurveTo(-15-flame,0,-9,5);ctx.closePath();ctx.fill();
    ctx.fillStyle='#fff1b0';ctx.beginPath();ctx.moveTo(-10,-2.5);ctx.lineTo(-16-flame*.45,0);ctx.lineTo(-10,2.5);ctx.fill();
    ctx.fillStyle='#83d6cc';ctx.strokeStyle='#c8f6e6';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(17,0);ctx.lineTo(-13,-11);ctx.lineTo(-9,0);ctx.lineTo(-13,11);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#e7fbf0';ctx.beginPath();ctx.moveTo(17,0);ctx.lineTo(-9,0);ctx.lineTo(-13,-11);ctx.closePath();ctx.fill();
    ctx.fillStyle='#1b4957';ctx.beginPath();ctx.ellipse(3,0,4.5,3,0,0,Math.PI*2);ctx.fill();ctx.restore();ctx.globalAlpha=1;
    if(game.cargo){for(let i=0;i<game.cargo;i++){const angle=t*.45+i*Math.PI*2/game.cargo;ctx.fillStyle='#f6c978aa';ctx.beginPath();ctx.arc(p.x+Math.cos(angle)*23,p.y+Math.sin(angle)*23,2.2,0,Math.PI*2);ctx.fill();}}
  }
  const idleRocks = [
    {rx:.14,ry:.22,r:23,angle:.4,vertices:[.8,.95,.76,1,.88,.83,.99,.8,.9]},
    {rx:.8,ry:.79,r:28,angle:1.2,vertices:[.8,.9,1,.78,.94,.76,.9,.87,.9]},
    {rx:.43,ry:.83,r:16,angle:2,vertices:[.8,1,.8,.96,.9,.8,1,.75,.9]},
    {rx:.9,ry:.46,r:18,angle:.5,vertices:[1,.8,.9,.85,1,.74,.85,.86,.9]}
  ];
  function renderTutorial(){
    const t=game.tutorial;if(!t)return;const c=$('tutorial-canvas'),g=c.getContext('2d');
    g.clearRect(0,0,320,120);g.fillStyle='#0b1726';g.fillRect(0,0,320,120);
    g.strokeStyle='#5e9a9933';g.setLineDash([3,7]);g.beginPath();g.moveTo(25,60);g.lineTo(290,60);g.stroke();g.setLineDash([]);
    if(!t.success){g.strokeStyle='#b8a1ed';g.fillStyle='#413751';g.beginPath();g.arc(t.target.x,t.target.y,t.target.r||18,0,Math.PI*2);g.fill();g.stroke();}
    const p=t.player;g.save();g.translate(p.x,p.y);g.rotate(p.angle||0);g.fillStyle=t.boostTime>0?'#fff2b0':'#8cf0ce';g.beginPath();g.moveTo(12,0);g.lineTo(-10,-8);g.lineTo(-6,0);g.lineTo(-10,8);g.closePath();g.fill();g.restore();
    g.fillStyle=t.success?'#8cf0ce':'#819bb2';g.font='10px -apple-system,sans-serif';g.textAlign='center';g.fillText(t.success?'练习成功 · 不计正式分数':'练习区 · 正式计时暂停',160,108);
  }
  function render(dt) {
    const t=visualTime;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);drawBackground(t);
    ctx.save();if(screenShake>0&&!reducedMotion){ctx.translate((Math.random()-.5)*5,(Math.random()-.5)*5);screenShake=Math.max(0,screenShake-dt);}
    drawMechanics(t);drawRoute(t);drawStation(t);game.items.forEach(item=>drawItem(item,t));game.powerups.forEach(item=>drawPowerup(item,t));
    if(game.mode==='ready'){idleRocks.forEach(a=>drawHazard(Object.assign({},a,{x:game.width*a.rx,y:game.height*a.ry,angle:a.angle+t*.03,delay:0})));}
    else game.hazards.forEach(drawHazard);
    drawShip(t);
    if(game.mode==='playing'&&game.boostTime>0&&!reducedMotion){particles.push({x:game.player.x,y:game.player.y,vx:-game.player.dx*25,vy:-game.player.dy*25,life:.25,max:.25,color:'#8cf0ce',r:3});}
    particles=particles.filter(p=>p.life>0);for(const p of particles){if(game.mode!=='paused'){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    floats=floats.filter(f=>f.life>0);for(const f of floats){if(game.mode!=='paused'){f.life-=dt;f.y-=dt*22;}ctx.globalAlpha=Math.min(1,Math.max(0,f.life));ctx.fillStyle=f.color;ctx.font='600 23px -apple-system, sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);}ctx.globalAlpha=1;ctx.restore();
    if(flashTime>0){if(game.mode!=='paused')flashTime=Math.max(0,flashTime-dt);ctx.strokeStyle='rgba(140,240,206,'+Math.min(.6,flashTime)+')';ctx.lineWidth=5;ctx.strokeRect(2,2,game.width-4,game.height-4);}
    if(visualTime>toastUntil)$('toast').classList.remove('visible');
  }
  function frame(timestamp) {
    const dt=Math.min((timestamp-previous)/1000 || 0,.05);previous=timestamp;
    if(game.mode!=='paused')visualTime+=dt;
    if(['playing','tutorial'].includes(game.mode)){Core.step(game,dt,inputVector());processEvents();}
    updateHUD();render(dt);if(game.mode==='tutorial'){renderTutorial();syncTutorialUI();}requestAnimationFrame(frame);
  }
  resize();updateSoundButton();updatePracticeOptions();selectMode(selectedMode);updateHUD(); requestAnimationFrame(frame);
  // Read-only diagnostics for automated QA; game state cannot be mutated through this API.
  window.StellarCourier = Object.freeze({ snapshot: function () { return {mode:game.mode,refit:game.refit,capacity:Core.capacity(game),cooldownMax:Core.boostCooldown(game),origin:game.origin,recordEligible:game.recordEligible,unlocked,tutorial:game.tutorial?{success:game.tutorial.success,x:game.tutorial.player.x}:null,objectives:Core.objectives(game),runMode:game.runMode,stageElapsed:game.stageElapsed,levelSmashes:game.levelSmashes,mechanics:Core.levelConfig(game).mechanics.slice(),score:game.score,cargo:game.cargo,health:game.health,timeLeft:game.timeLeft,deliveries:game.deliveries,boostCooldown:game.boostCooldown,level:game.level,levelCargo:game.levelCargo,combo:game.combo,comboTime:game.comboTime,maxCombo:game.maxCombo,magnetTime:game.magnetTime,shieldTime:game.shieldTime,slowTime:game.slowTime,smashed:game.smashed,audio:audio.snapshot(),player:{x:game.player.x,y:game.player.y},station:{x:game.station.x,y:game.station.y},width:game.width,height:game.height}; } });
}());
