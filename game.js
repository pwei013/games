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
  let best=0,soundEnabled=true,musicEnabled=true,effectsVolume=.75,musicVolume=.42,selectedMode='campaign',pixelRatio=1;
  try {
    selectedMode=localStorage.getItem('stellar-courier-mode-v3')==='endless'?'endless':'campaign';
    best=Math.max(0,Number(localStorage.getItem('stellar-courier-best-v3-'+selectedMode))||0);
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
    if(game.mode==='playing'||game.mode==='paused')return;
    selectedMode=mode==='endless'?'endless':'campaign';savePreference('stellar-courier-mode-v3',selectedMode);
    try{best=Math.max(0,Number(localStorage.getItem('stellar-courier-best-v3-'+selectedMode))||0);}catch(_){best=0;}
    $('best-score').textContent=formatScore(best);
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
  function begin() {
    clearInput();Core.start(game,selectedMode);audio.musicStart({restart:true});closeAudioSettings(); particles = []; floats = []; screenShake = 0; lastSecond = 90; hudCache = '';
    $('overlay').hidden = true; $('stage-caption').hidden = false;
    $('pause-button').disabled = false; $('pause-button').setAttribute('aria-label','暂停游戏');
    $('toast').classList.remove('visible'); sound('start'); updateHUD();
    focusCanvas();
    toast((game.runMode==='endless'?'无尽第 1 波：':'闯关第 1 站：')+'送达 4 箱！'+(touchDevice?'拖动移动，跃迁碎石':'空格冲刺可撞碎陨石'),4);
    announce('航程开始。第一站送达四箱货物。十二秒内连续投递会增加奖励，空格冲刺可以撞碎陨石。');
  }
  function focusCanvas() { try { canvas.focus({preventScroll:true}); } catch (_) { canvas.focus(); } }
  function setPaused(shouldPause) {
    if (shouldPause && game.mode === 'playing') {
      Core.pause(game);audio.musicPause();closeAudioSettings();clearInput();showOverlay('paused');
      $('pause-button').setAttribute('aria-label','继续游戏');
      announce('游戏已暂停。按 P 或 Escape 继续。');
    } else if (!shouldPause && game.mode === 'paused') {
      Core.resume(game);audio.musicStart();clearInput();$('overlay').hidden=true;
      $('pause-button').setAttribute('aria-label','暂停游戏'); audioInit(); focusCanvas(); announce('继续航行。');
    }
    updateHUD();
  }
  function showOverlay(kind) {
    const overlay=$('overlay');$('mode-picker').hidden=kind==='paused';
    overlay.hidden = false; overlay.className = 'overlay ' + (kind === 'over' ? 'game-over' : 'paused');
    $('result-stats').hidden = kind !== 'over'; $('result-detail').hidden = kind !== 'over'; $('restart-button').hidden = kind !== 'paused';
    if (kind === 'paused') {
      $('overlay-kicker').textContent = 'TAKE A LITTLE BREAK';
      $('overlay-title').textContent = '宇宙可以等一等。';
      $('overlay-description').innerHTML = '航程已暂停，你的货物很安全。<br>准备好后，再一起出发。';
      $('start-label').textContent = '继续航行'; $('start-hint').textContent = '按 P / Esc 继续 · 按钮可重新开始';
    } else {
      const isRecord = game.score > best;
      if (isRecord) {
        best = game.score; $('best-score').textContent = formatScore(best);
        try { localStorage.setItem('stellar-courier-best-v3-'+game.runMode,String(best)); } catch (_) {}
      }
      $('overlay-kicker').textContent = isRecord ? 'A NEW PERSONAL BEST' : 'DELIVERY REPORT';
      $('overlay-title').textContent = game.reason === 'victory' ? '十关通关，银河传奇！' : isRecord ? '新纪录，宇宙收到！' : '再来一趟，连得更高。';
      $('overlay-description').innerHTML = game.reason === 'victory' ? '十段航线全部完成，银河认可你的实力。<br>试试无尽模式，挑战更远的纪录！' : game.reason === 'health' ? '护盾耗尽，救援船已接你返航。<br>试试捡护盾道具，用冲刺主动击碎陨石。' : '本关航时已到，第 ' + game.level + ' 站完成 ' + game.levelCargo + ' / ' + Core.levelConfig(game).goal + ' 箱。<br>先保连单，还是满仓冲高分？下一趟由你决定。';
      $('result-score').textContent = game.score.toLocaleString('zh-CN');
      $('result-deliveries').textContent = game.deliveries + ' 单';
      $('result-detail').textContent = (game.runMode==='endless'?'第 '+game.level+' 波 · ':'第 '+game.level+' / 10 关 · ')+'最高 ' + game.maxCombo + ' 连单 · 击碎 ' + game.smashed + ' 颗陨石 · 送达 ' + game.deliveredCargo + ' 箱';
      $('start-label').textContent = '再接一单'; $('start-hint').textContent = '按 Enter 再次出发 · 最高纪录保存在本浏览器';
      $('pause-button').disabled = true;
      announce('航程结束，收入 ' + game.score + ' 分，完成 ' + game.deliveries + ' 次投递。' + (isRecord ? '创造个人新纪录。' : ''));
    }
    // Preserve focus for screen-reader and keyboard users without scrolling the page.
    try { $('start-button').focus({preventScroll:true}); } catch (_) { $('start-button').focus(); }
  }
  function toast(message, duration, danger) {
    $('toast').textContent = message; $('toast').className = 'toast visible' + (danger ? ' danger' : '');
    toastUntil = visualTime + (duration || 2);
  }
  function updateHUD() {
    const remaining=game.runMode==='endless'?Math.floor(game.elapsed):Math.ceil(game.timeLeft), cache = [game.score,game.cargo,game.health,remaining,game.mode,game.level,game.levelCargo,game.combo,game.levelSmashes,game.runMode].join(':');
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
      $('cargo-caption').textContent = game.cargo === 5 ? '满仓！去投递吧' : game.cargo ? '送达后可获得' : '等你装满期待';
      $('cargo-slots').setAttribute('aria-label','货舱 ' + game.cargo + ' / 5');
      Array.from($('cargo-slots').children).forEach((slot,i) => slot.classList.toggle('filled',i < game.cargo));
      const level=Core.levelConfig(game);
      $('level-label').textContent = (game.runMode==='endless'?'第 '+game.level+' 波':game.level+' / 10')+' · '+level.name;
      $('level-goal').textContent=game.reason==='victory'?'全线通关！':'送达 '+game.levelCargo+'/'+level.goal+' 箱'+(level.smashGoal?' · 碎石 '+Math.min(game.levelSmashes,level.smashGoal)+'/'+level.smashGoal:'');
      $('level-fill').style.width = (game.reason === 'victory' ? 100 : game.levelCargo/level.goal*100) + '%';
      $('sector-name').textContent=(game.runMode==='endless'?'无尽 · 第 '+game.level+' 波':'第 '+game.level+' 站')+' / '+level.name;
      $('mission-target').textContent=(game.runMode==='endless'?'本波：送达 ':'本关：送达 ')+level.goal+' 箱'+(level.smashGoal?' + 击碎 '+level.smashGoal+' 颗陨石':'');
      $('flight-tip').textContent=level.lesson;
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
    $('boost-button').disabled = game.mode !== 'playing' || !ready;
    $('boost-title').textContent = !ready ? '充能中 ' + cooldown.toFixed(1) + 's' : '跃迁冲刺';
    $('boost-description').textContent = !ready ? '稍等一下，下一次更快' : '撞碎陨石 +40 · 每 2.4 秒一次';
    $('boost-fill').style.width = ((1-cooldown/Core.BOOST_COOLDOWN)*100) + '%';
    if(game.runMode!=='endless'&&remaining===15&&lastSecond!==15&&game.mode==='playing') toast('最后 15 秒，记得把货送回去！',3);
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
        if (e.cargo === 5) toast('满仓！这一单预计 +' + Core.nextPayout(game).toLocaleString('zh-CN') + ' 分',2.5);
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
      else if (e.type === 'level') { sound('level');flashTime=reducedMotion?0:.6;toast((game.runMode==='endless'?'第 '+e.level+' 波':'第 '+e.level+' 站')+' · '+e.name+'：'+e.lesson,5);announce('进入第'+e.level+'站。'+e.name+'。过关奖励'+e.amount+'分。'); }
      else if (e.type === 'comboLost') { if(game.mode==='playing')toast('连单中断，下一次送达重新开始',1.6); }
      else if(e.type==='over'){audio.musicPause();sound(e.reason==='victory'?'victory':'over');clearInput();showOverlay('over'); }
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
  function boost() { audioInit(); Core.boost(game); processEvents(); updateHUD(); }
  const movementKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'];
  document.addEventListener('keydown',function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (movementKeys.includes(e.code)) { if (game.mode === 'playing') { e.preventDefault(); keys.add(e.code); } return; }
    if (['Space','KeyP','Escape','KeyM','Enter'].includes(e.code)) {
      // Preserve native keyboard activation for focused controls.
      if(e.code==='Escape'&&!$('audio-settings').hidden){e.preventDefault();closeAudioSettings();return;}
      if (e.code === 'Space' && e.target.tagName === 'BUTTON') return;
      if (e.code === 'Enter' && e.target.tagName === 'BUTTON' && e.target !== $('start-button')) return;
      if (e.code !== 'KeyM' || !e.repeat) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'Space') { if (game.mode === 'playing') boost(); }
      else if (e.code === 'KeyP' || e.code === 'Escape') setPaused(game.mode === 'playing');
      else if (e.code === 'KeyM') toggleSound();
      else if (e.code === 'Enter') { if (game.mode === 'ready' || game.mode === 'over') begin(); else if (game.mode === 'paused') setPaused(false); }
    }
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur',function () { clearInput(); if (game.mode === 'playing') setPaused(true); });
  document.addEventListener('visibilitychange',function () { if (document.hidden) { clearInput(); if (game.mode === 'playing') setPaused(true); } });
  function pointFromEvent(e) { const r = canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*game.width/r.width,y:(e.clientY-r.top)*game.height/r.height,id:e.pointerId}; }
  canvas.addEventListener('pointerdown',function (e) {
    if (game.mode !== 'playing' || pointer || e.button > 0) return;
    e.preventDefault(); pointer = pointFromEvent(e); canvas.setPointerCapture(e.pointerId); audioInit();
  });
  canvas.addEventListener('pointermove',function (e) { if (pointer && e.pointerId === pointer.id) { e.preventDefault(); pointer = pointFromEvent(e); } });
  ['pointerup','pointercancel','lostpointercapture'].forEach(name => canvas.addEventListener(name,function (e) { if (pointer && e.pointerId === pointer.id) pointer = null; }));
  $('start-button').addEventListener('click',function () { if (game.mode === 'paused') setPaused(false); else if (game.mode === 'ready' || game.mode === 'over') begin(); });
  $('restart-button').addEventListener('click',begin);
  $('pause-button').addEventListener('click',() => setPaused(game.mode === 'playing'));
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
    if(game.mode==='playing'){Core.step(game,dt,inputVector());processEvents();}
    updateHUD();render(dt);requestAnimationFrame(frame);
  }
  resize();updateSoundButton();selectMode(selectedMode);updateHUD(); requestAnimationFrame(frame);
  // Read-only diagnostics for automated QA; game state cannot be mutated through this API.
  window.StellarCourier = Object.freeze({ snapshot: function () { return {mode:game.mode,runMode:game.runMode,stageElapsed:game.stageElapsed,levelSmashes:game.levelSmashes,mechanics:Core.levelConfig(game).mechanics.slice(),score:game.score,cargo:game.cargo,health:game.health,timeLeft:game.timeLeft,deliveries:game.deliveries,boostCooldown:game.boostCooldown,level:game.level,levelCargo:game.levelCargo,combo:game.combo,comboTime:game.comboTime,maxCombo:game.maxCombo,magnetTime:game.magnetTime,shieldTime:game.shieldTime,slowTime:game.slowTime,smashed:game.smashed,audio:audio.snapshot(),player:{x:game.player.x,y:game.player.y},station:{x:game.station.x,y:game.station.y},width:game.width,height:game.height}; } });
}());
