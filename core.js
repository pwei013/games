/* Stellar Courier v3 — deterministic, dependency-free arcade simulation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StellarCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DURATION = 60, CAPACITY = 5, BOOST_COOLDOWN = 2.4, COMBO_WINDOW = 12;
  const VALUES = [0,100,240,450,720,1100];
  const LEVELS = [
    {name:'启航港',goal:4,reward:250,seconds:60,mechanics:[],lesson:'跟随货箱路线，送达绿色投递站。'},
    {name:'磁力货场',goal:6,reward:350,seconds:65,mechanics:['magnet'],lesson:'拾取蓝色磁吸，附近货箱会自动入舱。'},
    {name:'碎石试炼',goal:6,reward:450,seconds:65,smashGoal:3,mechanics:['smash'],lesson:'空格冲刺撞碎 3 颗陨石，同时完成投递。'},
    {name:'警戒雷区',goal:7,reward:550,seconds:70,mechanics:['mines'],lesson:'地雷先亮黄再爆红；等它熄灭，或冲刺穿过。'},
    {name:'跃迁航门',goal:8,reward:650,seconds:70,mechanics:['portals'],lesson:'进入任一蓝色航门，瞬间抵达另一端。'},
    {name:'太阳风带',goal:8,reward:750,seconds:75,mechanics:['wind','portals'],lesson:'风带会推偏飞船；借顺风，逆风时用冲刺。'},
    {name:'巡逻封锁',goal:9,reward:850,seconds:75,mechanics:['drones'],lesson:'红色巡逻机会追踪你，用冲刺反击。'},
    {name:'流动邮港',goal:9,reward:950,seconds:80,mechanics:['moving','wind'],lesson:'投递站开始巡航，预判路线，不要只追尾。'},
    {name:'离子风暴',goal:10,reward:1050,seconds:85,mechanics:['storm','portals'],lesson:'紫色冲击环向外扩散；用冲刺或护盾穿越。'},
    {name:'银河总站',goal:12,reward:1500,seconds:90,mechanics:['mines','drones','moving','storm'],lesson:'综合终局：雷区、追踪机、移动站与冲击环。'}
  ];
  function levelConfig(s) {
    const base=LEVELS[(Math.max(1,s.level)-1)%LEVELS.length];
    return s.runMode==='endless'?Object.assign({},base,{goal:base.goal+Math.min(10,Math.floor((s.level-1)/10)*2)}):base;
  }
  function has(s,mechanic){return levelConfig(s).mechanics.includes(mechanic);}
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function randomSource(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createGame(options) {
    options = options || {};
    const rng = randomSource(options.seed === undefined ? Date.now() : options.seed);
    const s = { width: Math.max(280, options.width || 900), height: Math.max(300, options.height || 600), rng: rng };
    reset(s); return s;
  }
  function reset(s) {
    Object.assign(s, {
      mode:'ready',runMode:s.runMode==='endless'?'endless':'campaign',score:0,cargo:0,health:3,elapsed:0,stageElapsed:0,timeLeft:DURATION,
      deliveries: 0, deliveredCargo: 0, collected: 0, lostCargo: 0, boostCooldown: 0, boostTime: 0,
      invulnerable: 0, deliveryCooldown: 0, reason: '', events: [], items: [], hazards: [], powerups: [],
      combo: 0, comboTime: 0, maxCombo: 0, level: 1, levelCargo: 0, smashed: 0,
      magnetTime:0,shieldTime:0,slowTime:0,powerupTimer:10,powerupIndex:1,levelSmashes:0,mines:[],drones:[],portals:[],portalCooldown:0,stormRadius:-1
    });
    s.player = { x: s.width * .3, y: s.height * .55, r: 12, angle: -.45, dx: 1, dy: 0 };
    s.station = { x: s.width * .78, y: s.height * .33, r: 34, index: 0 };
    // A readable first route gives a useful first action instead of an empty flight.
    const trail = [[.42,.51],[.53,.45],[.65,.38],[.59,.7]];
    for (const point of trail) s.items.push({x:s.width*point[0],y:s.height*point[1],r:11,wait:0,phase:s.rng()*Math.PI*2});
    for (let i = 0; i < 4; i++) s.items.push(newItem(s));
    configureLevel(s);
    for (let i = 0; i < hazardCount(s); i++) s.hazards.push(newHazard(s, i));
  }
  function start(s,runMode) { s.runMode=runMode==='endless'?'endless':'campaign';reset(s);s.mode='playing'; }
  function pause(s) { if (s.mode === 'playing') s.mode = 'paused'; }
  function resume(s) { if (s.mode === 'paused') s.mode = 'playing'; }
  function payout(count) { return VALUES[clamp(Math.floor(Number.isFinite(count) ? count : 0),0,CAPACITY)]; }
  function multiplier(combo) { return 1 + Math.min(4,Math.max(0,combo-1)) * .5; }
  function nextPayout(s) { return Math.round(payout(s.cargo) * multiplier(s.comboTime > 0 ? s.combo + 1 : 1)); }
  function hazardCount(s) { return clamp(Math.round(s.width*s.height/110000)+1+Math.floor((s.level-1)/2),3,s.runMode==='endless'?14:10); }
  function newItem(s) {
    let item;
    for (let i = 0; i < 80; i++) {
      item = { x: 26+s.rng()*(s.width-52), y: 80+s.rng()*(s.height-114), r: 11, wait: 0, phase: s.rng()*Math.PI*2 };
      if (distance(item,s.player)>65 && distance(item,s.station)>60 && s.items.every(other=>distance(item,other)>36)) break;
    }
    return item;
  }
  function newHazard(s, index) {
    const r = 13+s.rng()*12, side = Math.floor(s.rng()*4);
    let x,y;
    if (side===0) { x=-r-10;y=s.rng()*s.height; }
    else if (side===1) { x=s.width+r+10;y=s.rng()*s.height; }
    else if (side===2) { x=s.rng()*s.width;y=-r-10; }
    else { x=s.rng()*s.width;y=s.height+r+10; }
    const angle = Math.atan2(s.height*(.2+s.rng()*.6)-y,s.width*(.2+s.rng()*.6)-x);
    const speed=40+s.rng()*26+Math.min(45,(s.level-1)*5);
    const vertices=[];for(let i=0;i<9;i++)vertices.push(.72+s.rng()*.28);
    return {x,y,r,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,angle:s.rng()*Math.PI*2,
      rotation:(s.rng()-.5)*.9,delay:s.elapsed<1?1.5+(index||0)*.4:.25,vertices};
  }
  function boost(s) {
    if(s.mode!=='playing'||s.boostCooldown>0)return false;
    s.boostTime=.4;s.boostCooldown=BOOST_COOLDOWN;
    s.events.push({type:'boost',x:s.player.x,y:s.player.y});return true;
  }
  function relocateStation(s) {
    if(has(s,'moving'))return;
    s.station.index=(s.station.index+1+Math.floor(s.rng()*3))%4;
    const points=[[.78,.28],[.78,.76],[.22,.76],[.22,.28]];
    s.station.x=clamp(s.width*points[s.station.index][0],48,s.width-48);
    s.station.y=clamp(s.height*points[s.station.index][1],115,s.height-48);
  }
  function finish(s,reason) {
    if(s.mode!=='playing')return;
    s.mode='over';s.reason=reason;s.boostTime=0;
    s.events.push({type:'over',reason,score:s.score});
  }
  function collectPowerup(s,item) {
    if(item.type==='magnet')s.magnetTime=8;
    else if(item.type==='shield')s.shieldTime=6;
    else if(item.type==='slow')s.slowTime=6;
    s.events.push({type:'powerup',power:item.type,x:item.x,y:item.y});
  }
  function configureLevel(s) {
    s.stageElapsed=0;s.timeLeft=s.runMode==='endless'?Infinity:levelConfig(s).seconds;s.levelSmashes=0;s.mines=[];s.drones=[];s.portals=[];s.portalCooldown=0;s.stormRadius=-1;
    if(has(s,'magnet'))s.powerups.push({x:s.width*.45,y:s.height*.65,r:15,type:'magnet',ttl:18});
    if(has(s,'mines'))for(let i=0;i<((s.level-1)%10===3?3:2);i++)s.mines.push({x:s.width*(.28+i*.22),y:s.height*(.48+(i%2)*.22),r:19,phase:i*1.2,wait:0,active:false});
    if(has(s,'portals'))s.portals=[{x:s.width*.16,y:s.height*.52,r:24},{x:s.width*.84,y:s.height*.75,r:24}];
    if(has(s,'drones'))for(let i=0;i<2;i++)s.drones.push({x:s.width*(i?.9:.1),y:s.height*.22,r:16,vx:0,vy:0,wait:1.5});
    if(has(s,'smash'))for(let i=0;i<3;i++){
      const h=newHazard(s);Object.assign(h,{x:s.width*(.28+i*.22),y:s.height*.48,vx:0,vy:0,delay:0,r:24,training:true});s.hazards.push(h);
    }
  }
  function damage(s,x,y) {
    if(s.invulnerable>0||s.boostTime>0||s.shieldTime>0)return false;
    const lost=Math.ceil(s.cargo/2);s.health--;s.cargo-=lost;s.lostCargo+=lost;s.invulnerable=1.8;s.combo=0;s.comboTime=0;
    s.events.push({type:'hit',x,y,lost});if(s.health<=0)finish(s,'health');return true;
  }
  function recordSmash(s,x,y,amount) {
    s.score+=amount;s.smashed++;s.levelSmashes++;s.events.push({type:'smash',x,y,amount});
  }
  function advanceLevel(s) {
    let config=levelConfig(s);
    while(s.mode==='playing'&&s.levelCargo>=config.goal&&s.levelSmashes>=(config.smashGoal||0)) {
      s.levelCargo=Math.min(CAPACITY-1,s.levelCargo-config.goal);s.score+=config.reward;
      if(s.runMode==='campaign'&&s.level===LEVELS.length){
        const timeBonus=Math.ceil(s.timeLeft)*15;s.score+=timeBonus;s.events.push({type:'victory',amount:config.reward+timeBonus});finish(s,'victory');return;
      }
      const reward=config.reward;s.level++;s.health=Math.min(3,s.health+1);s.invulnerable=Math.max(s.invulnerable,2);s.boostCooldown=0;
      s.powerups=[];configureLevel(s);config=levelConfig(s);
      s.events.push({type:'level',level:s.level,amount:reward,name:config.name,lesson:config.lesson});
      if(!has(s,'magnet')){const pickup=newItem(s);s.powerups.push({x:pickup.x,y:pickup.y,r:15,type:s.level%2?'slow':'shield',ttl:14});}
    }
  }
  function stepMechanics(s,dt) {
    const p=s.player;s.portalCooldown=Math.max(0,s.portalCooldown-dt);
    if(has(s,'wind')&&p.y>s.height*.36&&p.y<s.height*.68&&s.boostTime<=0){
      const direction=Math.floor(s.stageElapsed/6)%2? -1:1;
      p.x=clamp(p.x+direction*88*dt,15,s.width-15);
    }
    if(has(s,'moving')){
      const phase=s.stageElapsed*.4;
      s.station.x=s.width*(.5+.29*Math.cos(phase));s.station.y=clamp(s.height*(.53+.24*Math.sin(phase)),115,s.height-48);
    }
    if(s.portalCooldown<=0)for(let i=0;i<s.portals.length;i++)if(distance(p,s.portals[i])<p.r+s.portals[i].r*.7){
      const target=s.portals[1-i];p.x=clamp(target.x+p.dx*32,15,s.width-15);p.y=clamp(target.y+p.dy*32,15,s.height-15);s.portalCooldown=1.4;s.invulnerable=Math.max(s.invulnerable,.6);
      s.events.push({type:'teleport',x:p.x,y:p.y});break;
    }
    for(const mine of s.mines){
      if(mine.wait>0){mine.wait-=dt;continue;}mine.active=(s.stageElapsed+mine.phase)%4>2.4;
      if(distance(p,mine)<p.r+mine.r&&s.boostTime>0){recordSmash(s,mine.x,mine.y,60);mine.wait=5;}
      else if(mine.active&&distance(p,mine)<p.r+33)damage(s,p.x,p.y);
      if(s.mode!=='playing')return;
    }
    for(const drone of s.drones){
      if(drone.wait>0){drone.wait-=dt;continue;}
      const dist=Math.max(1,distance(p,drone)),speed=s.slowTime>0?25:68;
      drone.vx+=( (p.x-drone.x)/dist*speed-drone.vx)*Math.min(1,dt*2);
      drone.vy+=( (p.y-drone.y)/dist*speed-drone.vy)*Math.min(1,dt*2);
      drone.x+=drone.vx*dt;drone.y+=drone.vy*dt;
      if(distance(p,drone)<p.r+drone.r){
        if(s.boostTime>0){recordSmash(s,drone.x,drone.y,80);drone.x=s.rng()<.5?20:s.width-20;drone.y=100;drone.wait=4;}
        else if(s.shieldTime>0){drone.wait=2;s.events.push({type:'deflect',x:drone.x,y:drone.y});}
        else damage(s,p.x,p.y);
      }if(s.mode!=='playing')return;
    }
    if(has(s,'storm')){
      const phase=s.stageElapsed%8;s.stormRadius=phase<1.8?-1:(phase-1.8)*Math.hypot(s.width,s.height)/6;
      if(s.stormRadius>=0&&Math.abs(Math.hypot(p.x-s.width*.5,p.y-s.height*.55)-s.stormRadius)<p.r+7)damage(s,p.x,p.y);
    }
  }
  function step(s,seconds,input) {
    if(s.mode!=='playing')return;
    const dt=clamp(Number.isFinite(seconds)?seconds:0,0,.05);input=input||{};
    s.elapsed+=dt;s.stageElapsed+=dt;s.timeLeft=s.runMode==='endless'?Infinity:Math.max(0,levelConfig(s).seconds-s.stageElapsed);
    for(const key of ['boostCooldown','boostTime','invulnerable','deliveryCooldown','magnetTime','shieldTime','slowTime'])s[key]=Math.max(0,s[key]-dt);
    if(s.comboTime>0){s.comboTime=Math.max(0,s.comboTime-dt);if(!s.comboTime){s.combo=0;s.events.push({type:'comboLost'});}}
    if(s.timeLeft<=0){finish(s,'time');return;}
    let dx=Number.isFinite(input.x)?input.x:0,dy=Number.isFinite(input.y)?input.y:0;
    const length=Math.hypot(dx,dy);if(length>1){dx/=length;dy/=length;}
    if(length>.02){s.player.dx=dx/Math.hypot(dx,dy);s.player.dy=dy/Math.hypot(dx,dy);}
    if(s.boostTime>0){dx=s.player.dx;dy=s.player.dy;}
    const speed=clamp(Math.min(s.width,s.height)*.65,205,340)*(s.boostTime>0?2.5:1-s.cargo*.015);
    const p=s.player;p.x=clamp(p.x+dx*speed*dt,p.r+3,s.width-p.r-3);p.y=clamp(p.y+dy*speed*dt,p.r+3,s.height-p.r-3);
    if(Math.hypot(dx,dy)>.02)p.angle=Math.atan2(dy,dx);
    stepMechanics(s,dt);if(s.mode!=='playing')return;
    s.powerupTimer-=dt;
    if(s.powerupTimer<=0){
      if(s.powerups.length<2){const item=newItem(s);s.powerups.push({x:item.x,y:item.y,r:15,type:['magnet','shield','slow'][s.powerupIndex++%3],ttl:12});}
      s.powerupTimer=10;
    }
    for(let i=s.powerups.length-1;i>=0;i--){const item=s.powerups[i];item.ttl-=dt;
      if(distance(p,item)<p.r+item.r){collectPowerup(s,item);s.powerups.splice(i,1);}
      else if(item.ttl<=0)s.powerups.splice(i,1);
    }
    for(const item of s.items){
      if(item.wait>0){item.wait-=dt;if(item.wait<=0)Object.assign(item,newItem(s));continue;}
      const dist=distance(p,item);
      if(s.magnetTime>0&&s.cargo<CAPACITY&&dist<140&&dist>1){const travel=Math.min(dist,dt*360);item.x+=(p.x-item.x)/dist*travel;item.y+=(p.y-item.y)/dist*travel;}
      if(s.cargo<CAPACITY&&distance(p,item)<p.r+item.r+4){
        s.cargo++;s.collected++;item.wait=1.25;s.events.push({type:'pickup',x:item.x,y:item.y,cargo:s.cargo});
      }
    }
    if(s.cargo&&s.deliveryCooldown<=0&&distance(p,s.station)<p.r+s.station.r){
      s.combo=s.comboTime>0?s.combo+1:1;s.comboTime=COMBO_WINDOW;s.maxCombo=Math.max(s.maxCombo,s.combo);
      const count=s.cargo,amount=Math.round(payout(count)*multiplier(s.combo));
      s.events.push({type:'deliver',x:s.station.x,y:s.station.y,amount,cargo:count,combo:s.combo,multiplier:multiplier(s.combo)});
      s.score+=amount;s.deliveries++;s.deliveredCargo+=count;s.levelCargo+=count;s.cargo=0;s.deliveryCooldown=.65;
      relocateStation(s);advanceLevel(s);if(s.mode!=='playing')return;
    }
    const wanted=hazardCount(s);if(s.hazards.length<wanted)s.hazards.push(newHazard(s));
    for(let i=0;i<s.hazards.length;i++){
      const h=s.hazards[i];if(h.delay>0){h.delay-=dt;continue;}
      const slow=s.slowTime>0?.38:1;h.x+=h.vx*dt*slow;h.y+=h.vy*dt*slow;h.angle+=h.rotation*dt*slow;
      if(h.x< -80||h.x>s.width+80||h.y< -80||h.y>s.height+80){s.hazards[i]=newHazard(s);continue;}
      if(distance(p,h)<p.r+h.r*.8){
        if(s.boostTime>0){recordSmash(s,h.x,h.y,40);s.hazards[i]=newHazard(s);}
        else if(s.shieldTime>0){s.events.push({type:'deflect',x:h.x,y:h.y});s.hazards[i]=newHazard(s);}
        else if(s.invulnerable<=0){
          damage(s,p.x,p.y);if(s.mode!=='playing')break;
        }
      }
    }
    if(s.mode==='playing')advanceLevel(s);
  }
  function resize(s,width,height) {
    const w=Math.max(280,width),h=Math.max(300,height),changed=w!==s.width||h!==s.height;
    const sx=w/s.width,sy=h/s.height;
    [s.player,s.station].concat(s.items,s.hazards,s.powerups,s.mines,s.drones,s.portals).forEach(obj=>{obj.x*=sx;obj.y*=sy;});
    s.width=w;s.height=h;s.player.x=clamp(s.player.x,15,w-15);s.player.y=clamp(s.player.y,15,h-15);
    s.station.x=clamp(s.station.x,48,w-48);s.station.y=clamp(s.station.y,115,h-48);
    const wanted=hazardCount(s);if(s.hazards.length>wanted)s.hazards=s.hazards.filter(h=>h.training).concat(s.hazards.filter(h=>!h.training)).slice(0,wanted);
    while(s.hazards.length<wanted)s.hazards.push(newHazard(s));
    if(changed&&(s.mode==='playing'||s.mode==='paused'))s.invulnerable=Math.max(s.invulnerable,1.5);
  }
  return {createGame,start,pause,resume,step,boost,resize,payout,multiplier,nextPayout,
    DURATION,CAPACITY,BOOST_COOLDOWN,COMBO_WINDOW,LEVELS,levelConfig,has};
}));
