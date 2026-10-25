'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','audio.js'),'utf8');

function fixture(options = {}) {
  const instances = [], oscillators = [], timers = new Map();
  let nextTimer = 1;
  function parameter() { return { values:[], setValueAtTime(value,time) {this.values.push({value,time});}, exponentialRampToValueAtTime(value,time) {this.values.push({value,time});}, cancelScheduledValues() {} }; }
  class MockContext {
    constructor() {
      if (options.constructError) throw new Error('device not available');
      this.state = options.initialState || 'suspended'; this.currentTime = 1;
      this.destination = {}; this.resumeCalls = 0; this.sampleRate=44100; this.gains=[];
      instances.push(this);
    }
    createGain() { const gain={gain:parameter(),connect(target) {this.target=target;},disconnect() {}};this.gains.push(gain);return gain; }
    createBuffer(channels,length) {const data=new Float32Array(length);return {getChannelData() {return data;}};}
    createBufferSource() {const source={connect() {},disconnect() {},start(time) {this.startedAt=time;},stop(time) {this.stoppedAt=time;}};oscillators.push(source);return source;}
    createBiquadFilter() {return {frequency:parameter(),connect() {},disconnect() {}};}
    createOscillator() {
      const osc = {frequency:parameter(),connect() {},disconnect() {},start(time) {this.startedAt=time;},stop(time) {this.stoppedAt=time;}};
      oscillators.push(osc); return osc;
    }
    resume() {
      this.resumeCalls++;
      if (options.resumeThrows) throw new Error('sync resume blocked');
      if (options.rejectResume) return Promise.reject(new Error('user activation required'));
      if (options.deferResume) return new Promise((resolve,reject) => {this.resolveResume=() => {this.changeState('running');resolve();};this.rejectResume=reject;});
      if (!options.stillSuspended) this.changeState('running');
      return Promise.resolve();
    }
    changeState(value) {this.state=value;if(this.onstatechange)this.onstatechange();}
  }
  const sandbox = {
    console, Promise, Date, Set, Object,
    setTimeout(callback,delay) {const id=nextTimer++;timers.set(id,{callback,delay});return id;},
    clearTimeout(id) {timers.delete(id);}
  };
  if (!options.unsupported) sandbox[options.webkit ? 'webkitAudioContext' : 'AudioContext'] = MockContext;
  vm.runInNewContext(source,sandbox,{filename:'audio.js'});
  const states=[];
  const audio=sandbox.StellarAudio.create({enabled:options.enabled,musicEnabled:options.musicEnabled,musicVolume:options.musicVolume,effectsVolume:options.effectsVolume,onState:state=>states.push(state)});
  function fireTimers(delay) {for(const [id,timer] of [...timers.entries()]){if(delay===undefined || timer.delay===delay){timers.delete(id);timer.callback();}}}
  function advanceMusic(seconds) {for(let i=0;i<Math.ceil(seconds/.05);i++){instances.at(-1).currentTime+=.05;fireTimers(50);for(const source of oscillators){if(source.onended && source.stoppedAt<=instances.at(-1).currentTime){const callback=source.onended;source.onended=null;callback();}}}}
  return {audio,instances,oscillators,states,options,fireTimers,advanceMusic,timerCount:()=>timers.size};
}

test('audio is enabled by default but does not create a context before interaction', () => {
  const f=fixture();assert.equal(f.audio.enabled,true);assert.equal(f.instances.length,0);
  assert.equal(f.audio.snapshot().contextState,'uninitialized');assert.equal(f.audio.snapshot().ready,false);
});
test('start synchronously initiates creation/resume, then waits before scheduling notes', async () => {
  const f=fixture({deferResume:true}),promise=f.audio.play('start');
  assert.equal(f.instances.length,1);assert.equal(f.instances[0].resumeCalls,1);
  assert.equal(f.oscillators.length,0);assert.equal(f.audio.snapshot().unlocking,true);
  f.instances[0].resolveResume();assert.equal(await promise,true);
  assert.equal(f.oscillators.length,3);assert.equal(f.audio.snapshot().notesScheduled,3);
  assert.equal(f.audio.snapshot().ready,true);assert.equal(f.timerCount(),0);
});
test('explicit unlock followed immediately by play shares one pending resume', async () => {
  const f=fixture({deferResume:true}),a=f.audio.unlock(),b=f.audio.play('start');
  assert.equal(f.instances[0].resumeCalls,1);f.instances[0].resolveResume();
  assert.equal(await a,true);assert.equal(await b,true);assert.equal(f.oscillators.length,3);
});
test('Safari webkitAudioContext fallback is supported', async () => {
  const f=fixture({webkit:true});assert.equal(await f.audio.test(),true);
  assert.equal(f.audio.snapshot().notesScheduled,3);
});
test('Safari interrupted state retries resume on the next explicit interaction', async () => {
  const f=fixture();await f.audio.play('start');f.instances[0].changeState('interrupted');
  assert.equal(f.audio.snapshot().ready,false);assert.equal(f.audio.snapshot().contextState,'interrupted');
  assert.equal(await f.audio.test(),true);assert.equal(f.instances[0].resumeCalls,2);assert.equal(f.audio.snapshot().ready,true);
});
test('muted audio neither creates a context nor schedules notes', async () => {
  const f=fixture({enabled:false});assert.equal(await f.audio.play('pickup'),false);assert.equal(await f.audio.unlock(),false);
  assert.equal(f.instances.length,0);assert.equal(f.audio.snapshot().notesScheduled,0);
});
test('muting during asynchronous unlock invalidates the queued start sound', async () => {
  const f=fixture({deferResume:true}),playing=f.audio.play('start');await f.audio.setEnabled(false);
  f.instances[0].resolveResume();assert.equal(await playing,false);assert.equal(f.oscillators.length,0);
});
test('mute cancels active/future notes and enabling can recover audio', async () => {
  const f=fixture();await f.audio.test();assert.equal(f.audio.snapshot().activeNotes,3);
  await f.audio.setEnabled(false);assert.equal(f.audio.snapshot().activeNotes,0);
  assert.equal(await f.audio.play('pickup'),false);await f.audio.setEnabled(true);assert.equal(await f.audio.play('pickup'),true);
});
test('rejected resume is reported without throwing and the next gesture can retry', async () => {
  const f=fixture({rejectResume:true});assert.equal(await f.audio.test(),false);
  assert.match(f.audio.snapshot().lastError,/user activation required/);assert.equal(f.audio.snapshot().unlocking,false);
  f.options.rejectResume=false;assert.equal(await f.audio.test(),true);assert.equal(f.audio.snapshot().lastError,'');
});
test('synchronous resume failure is reported safely', async () => {
  const f=fixture({resumeThrows:true});assert.equal(await f.audio.test(),false);assert.match(f.audio.snapshot().lastError,/sync resume blocked/);
});
test('resume resolving without running state is not claimed as ready', async () => {
  const f=fixture({stillSuspended:true});assert.equal(await f.audio.test(),false);
  assert.equal(f.audio.snapshot().ready,false);assert.ok(f.audio.snapshot().lastError);assert.equal(f.oscillators.length,0);
});
test('a hanging browser unlock times out and permits a later retry', async () => {
  const f=fixture({deferResume:true}),first=f.audio.test();f.fireTimers();assert.equal(await first,false);
  assert.equal(f.audio.snapshot().unlocking,false);assert.ok(f.audio.snapshot().lastError);
  f.options.deferResume=false;assert.equal(await f.audio.test(),true);assert.equal(f.instances[0].resumeCalls,2);
});
test('a closed context is recreated on the next user interaction', async () => {
  const f=fixture();await f.audio.test();f.instances[0].changeState('closed');
  assert.equal(await f.audio.test(),true);assert.equal(f.instances.length,2);assert.equal(f.audio.snapshot().ready,true);
});
test('unsupported browsers and initialization errors remain playable without thrown exceptions', async () => {
  const a=fixture({unsupported:true});assert.equal(await a.audio.test(),false);assert.equal(a.audio.snapshot().supported,false);
  assert.equal(a.audio.snapshot().contextState,'unsupported');assert.ok(a.audio.snapshot().lastError);
  const b=fixture({constructError:true});assert.equal(await b.audio.test(),false);assert.match(b.audio.snapshot().lastError,/device not available/);
});
test('all game sound patterns schedule bounded synthesized effects', async () => {
  const f=fixture();
  for(const kind of ['start','test','pickup','deliver','boost','hit','over','powerup','level','combo','smash','warning','victory']) {
    const before=f.audio.snapshot().notesScheduled;
    assert.equal(await f.audio.play(kind),true,kind);
    assert.ok(f.audio.snapshot().notesScheduled>before,kind);
  }
  assert.equal(await f.audio.play('not-a-sound'),false);
  assert.equal(f.audio.snapshot().soundsScheduled,13);
});
test('snapshot and API are read-only; state notifications carry actual context state', async () => {
  const f=fixture();assert.equal(Object.isFrozen(f.audio),true);assert.equal(Object.isFrozen(f.audio.snapshot()),true);
  await f.audio.test();assert.equal(f.states.at(-1).contextState,'running');assert.equal(f.states.at(-1).notesScheduled,3);
});

test('a late rejection from a timed-out resume cannot overwrite a later successful retry', async () => {
  const f=fixture({deferResume:true}),first=f.audio.test();
  const oldReject=f.instances[0].rejectResume;
  f.fireTimers();assert.equal(await first,false);
  f.options.deferResume=false;assert.equal(await f.audio.test(),true);
  oldReject(new Error('stale rejected request'));await Promise.resolve();await Promise.resolve();
  assert.equal(f.audio.snapshot().lastError,'');assert.equal(f.audio.snapshot().ready,true);
});


test('music is configured by default but never starts before the game requests it', async () => {
  const f=fixture();
  assert.equal(f.audio.snapshot().musicEnabled,true);assert.equal(f.audio.snapshot().musicPlaying,false);
  assert.equal(f.audio.snapshot().musicVolume,.42);assert.equal(f.audio.snapshot().effectsVolume,.75);
  await f.audio.test();assert.equal(f.audio.snapshot().musicScheduled,0);assert.equal(f.audio.snapshot().schedulerActive,false);
});
test('music starts with an independent gain bus while sound effects are disabled', async () => {
  const f=fixture({enabled:false});assert.equal(await f.audio.musicStart({restart:true}),true);
  assert.equal(f.audio.snapshot().musicPlaying,true);assert.equal(f.audio.snapshot().schedulerActive,true);
  assert.ok(f.audio.snapshot().musicScheduled>=7);assert.equal(f.audio.snapshot().notesScheduled,0);
  assert.equal(await f.audio.play('pickup'),false);assert.equal(f.instances[0].gains[0].gain.values.at(-1).value,0);
  assert.equal(f.instances[0].gains[1].gain.values.at(-1).value,.42*.6);
});
test('effect mute cancels only effect notes and leaves music running', async () => {
  const f=fixture();await f.audio.musicStart();await f.audio.test();
  const musicNotes=f.audio.snapshot().activeMusicNotes;assert.ok(musicNotes>0);
  await f.audio.setEnabled(false);
  assert.equal(f.audio.snapshot().activeNotes,0);assert.equal(f.audio.snapshot().activeMusicNotes,musicNotes);
  assert.equal(f.audio.snapshot().musicPlaying,true);assert.equal(f.audio.snapshot().schedulerActive,true);
});
test('music pause cancels its notes and timer without canceling sound effects', async () => {
  const f=fixture();await f.audio.musicStart();await f.audio.test();f.audio.musicPause();
  assert.equal(f.audio.snapshot().musicPlaying,false);assert.equal(f.audio.snapshot().schedulerActive,false);
  assert.equal(f.audio.snapshot().activeMusicNotes,0);assert.equal(f.audio.snapshot().activeNotes,3);assert.equal(f.timerCount(),0);
});
test('repeated Music Start clicks never create overlapping schedulers or duplicate first bars', async () => {
  const f=fixture();await f.audio.musicStart();const first=f.audio.snapshot().musicScheduled;
  await Promise.all([f.audio.musicStart(),f.audio.musicStart({restart:true}),f.audio.musicStart()]);
  assert.equal(f.audio.snapshot().musicScheduled,first);assert.equal(f.timerCount(),1);
  f.advanceMusic(2);assert.equal(f.timerCount(),1);assert.ok(f.audio.snapshot().musicScheduled>first);
});
test('music and effects share one pending unlock and begin only when it resolves', async () => {
  const f=fixture({deferResume:true}),music=f.audio.musicStart(),effect=f.audio.play('start');
  assert.equal(f.instances[0].resumeCalls,1);assert.equal(f.oscillators.length,0);
  f.instances[0].resolveResume();assert.equal(await music,true);assert.equal(await effect,true);
  assert.equal(f.audio.snapshot().notesScheduled,3);assert.ok(f.audio.snapshot().musicScheduled>0);assert.equal(f.timerCount(),1);
});
test('pause while unlock is pending prevents late music resurrection', async () => {
  const f=fixture({deferResume:true}),music=f.audio.musicStart();f.audio.musicPause();
  f.instances[0].resolveResume();assert.equal(await music,false);
  assert.equal(f.audio.snapshot().musicPlaying,false);assert.equal(f.audio.snapshot().musicScheduled,0);assert.equal(f.timerCount(),0);
});
test('new Start after pause supersedes the old pending Start without losing the new request', async () => {
  const f=fixture({deferResume:true}),first=f.audio.musicStart();f.audio.musicPause();const second=f.audio.musicStart();
  f.instances[0].resolveResume();assert.equal(await first,false);assert.equal(await second,true);
  assert.equal(f.instances[0].resumeCalls,1);assert.equal(f.timerCount(),1);
});
test('switching music off during pending unlock cancels only the pending music request', async () => {
  const f=fixture({deferResume:true}),music=f.audio.musicStart(),effect=f.audio.play('start');
  await f.audio.setMusicEnabled(false);f.instances[0].resolveResume();
  assert.equal(await music,false);assert.equal(await effect,true);assert.equal(f.audio.snapshot().notesScheduled,3);
  assert.equal(f.audio.snapshot().musicScheduled,0);assert.equal(f.audio.snapshot().schedulerActive,false);
});
test('enabling music in the menu is silent; enabling during a requested game resumes music', async () => {
  const f=fixture({musicEnabled:false});await f.audio.setMusicEnabled(true);
  assert.equal(f.instances.length,0);assert.equal(f.audio.snapshot().musicPlaying,false);
  await f.audio.setMusicEnabled(false);await f.audio.musicStart();assert.equal(f.instances.length,0);
  await f.audio.setMusicEnabled(true);assert.equal(f.audio.snapshot().musicPlaying,true);
  f.audio.musicPause();await f.audio.setMusicEnabled(false);await f.audio.setMusicEnabled(true);
  assert.equal(f.audio.snapshot().musicPlaying,false);
});
test('music and effects volumes clamp independently and honor initial saved values', async () => {
  const f=fixture({musicVolume:.2,effectsVolume:.9});await f.audio.musicStart();
  assert.equal(f.audio.snapshot().musicVolume,.2);assert.equal(f.audio.snapshot().effectsVolume,.9);
  assert.equal(f.audio.setMusicVolume(2),1);assert.equal(f.audio.snapshot().effectsVolume,.9);
  assert.equal(f.audio.setEffectsVolume(-2),0);assert.equal(f.audio.snapshot().musicVolume,1);
  assert.equal(f.audio.setMusicVolume(NaN),1);assert.equal(f.audio.setEffectsVolume('0.45'),.45);
  assert.equal(f.instances[0].gains[0].gain.values.at(-1).value,.45*.85);
  assert.equal(f.instances[0].gains[1].gain.values.at(-1).value,.6);
});
test('suspended/interrupted music stops scheduling and resumes through a fresh gesture', async () => {
  const f=fixture();await f.audio.musicStart();f.instances[0].changeState('interrupted');
  assert.equal(f.audio.snapshot().musicPlaying,false);assert.equal(f.audio.snapshot().schedulerActive,false);
  assert.equal(f.audio.snapshot().activeMusicNotes,0);assert.equal(f.timerCount(),0);
  assert.equal(await f.audio.musicStart(),true);assert.equal(f.instances[0].resumeCalls,2);assert.equal(f.timerCount(),1);
});
test('a closed audio device can rebuild both music and effect buses', async () => {
  const f=fixture();await f.audio.musicStart();f.instances[0].changeState('closed');
  assert.equal(f.audio.snapshot().schedulerActive,false);assert.equal(await f.audio.musicStart(),true);
  assert.equal(f.instances.length,2);assert.equal(f.timerCount(),1);assert.equal(await f.audio.test(),true);
});
test('failed or timed-out music unlock is recoverable and does not leave a scheduler', async () => {
  const f=fixture({deferResume:true}),first=f.audio.musicStart();f.fireTimers(2000);assert.equal(await first,false);
  assert.equal(f.audio.snapshot().schedulerActive,false);f.options.deferResume=false;
  assert.equal(await f.audio.musicStart(),true);assert.equal(f.timerCount(),1);
});
test('multi-bar music has a melody, changing harmonies, bass and percussion rather than a single-note loop', async () => {
  const f=fixture();await f.audio.musicStart();f.advanceMusic(10);
  const frequencies=new Set(f.oscillators.filter(source=>source.frequency).map(source=>source.frequency.values[0].value.toFixed(2)));
  const percussion=f.oscillators.filter(source=>source.buffer);
  assert.ok(frequencies.size>=16);assert.ok(percussion.length>=20);assert.ok(f.audio.snapshot().musicTicksScheduled>=32);
  assert.equal(f.timerCount(),1);assert.ok(f.audio.snapshot().activeMusicNotes<35);
});
test('long timer throttling skips the backlog instead of bursting hundreds of music notes', async () => {
  const f=fixture();await f.audio.musicStart();const before=f.audio.snapshot().musicTicksScheduled;
  f.instances[0].currentTime+=60;f.fireTimers(50);
  assert.ok(f.audio.snapshot().musicTicksScheduled-before<=1);assert.equal(f.timerCount(),1);
});

// v4 owner-lifecycle regression coverage. The audio module is intentionally
// mode-agnostic: the game calls musicStart for active play and musicPause when
// entering upgrade/menu/game-over states or exiting no-time practice.
test('repeated upgrade, practice-exit and game-over pauses are idempotent across many sessions', async () => {
  const f=fixture();
  for(let cycle=0;cycle<12;cycle++) {
    assert.equal(await f.audio.musicStart({restart:true}),true);
    f.advanceMusic(.6);
    for(const transition of ['upgrade','practice-exit','over']) {
      assert.equal(f.audio.musicPause(),true,transition);
      assert.equal(f.audio.snapshot().schedulerActive,false,transition);
      assert.equal(f.audio.snapshot().activeMusicNotes,0,transition);
    }
    const scheduled=f.audio.snapshot().musicScheduled;
    f.advanceMusic(.8);
    assert.equal(f.audio.snapshot().musicScheduled,scheduled);
    assert.equal(f.timerCount(),0);
  }
  assert.equal(f.instances.length,1);
});
test('menu toggles and volume changes cannot resurrect music after a delayed practice unlock', async () => {
  const f=fixture({deferResume:true}),practice=f.audio.musicStart({restart:true});
  f.audio.musicPause();
  await f.audio.setMusicEnabled(false);
  f.audio.setMusicVolume(.9);f.audio.setEffectsVolume(.3);
  assert.equal(await f.audio.setMusicEnabled(true),false);
  f.instances[0].resolveResume();assert.equal(await practice,false);
  assert.equal(f.audio.snapshot().contextState,'running');
  assert.equal(f.audio.snapshot().musicPlaying,false);
  assert.equal(f.audio.snapshot().musicScheduled,0);assert.equal(f.timerCount(),0);
  assert.equal(f.audio.snapshot().musicVolume,.9);assert.equal(f.audio.snapshot().effectsVolume,.3);
});
test('retry after stopping a stage restarts the opening phrase without layering old music', async () => {
  const f=fixture();
  let openingNotes=null;
  for(let retry=0;retry<6;retry++) {
    const beforeVoices=f.oscillators.length;
    assert.equal(await f.audio.musicStart({restart:true}),true);
    const notes=f.oscillators.slice(beforeVoices).filter(source=>source.frequency)
      .map(source=>source.frequency.values[0].value);
    if(openingNotes===null)openingNotes=notes;else assert.deepEqual(notes,openingNotes);
    assert.equal(f.timerCount(),1);
    assert.ok(f.audio.snapshot().activeMusicNotes<12);
    f.advanceMusic(.95+retry*.1);
    f.audio.musicPause();
    assert.equal(f.audio.snapshot().activeMusicNotes,0);assert.equal(f.timerCount(),0);
  }
});
test('audio preview can recover an interrupted context in a paused menu without starting music', async () => {
  const f=fixture();await f.audio.musicStart();f.advanceMusic(.5);f.audio.musicPause();
  const musicBefore=f.audio.snapshot().musicScheduled;
  f.instances[0].changeState('interrupted');
  assert.equal(await f.audio.test(),true);
  await f.audio.setMusicEnabled(false);await f.audio.setMusicEnabled(true);
  f.audio.setMusicVolume(.65);f.audio.setEffectsVolume(.8);
  f.advanceMusic(1);
  assert.equal(f.audio.snapshot().contextState,'running');
  assert.equal(f.audio.snapshot().notesScheduled,3);
  assert.equal(f.audio.snapshot().musicScheduled,musicBefore);
  assert.equal(f.audio.snapshot().musicPlaying,false);assert.equal(f.timerCount(),0);
});
test('a rejected music resume followed by menu exit and a new Start recovers cleanly', async () => {
  const f=fixture({rejectResume:true});
  assert.equal(await f.audio.musicStart({restart:true}),false);
  assert.ok(f.audio.snapshot().lastError);assert.equal(f.audio.snapshot().schedulerActive,false);
  f.audio.musicPause();f.options.rejectResume=false;
  assert.equal(await f.audio.musicStart({restart:true}),true);
  assert.equal(f.instances.length,1);assert.equal(f.instances[0].resumeCalls,2);
  assert.equal(f.audio.snapshot().lastError,'');assert.equal(f.timerCount(),1);
  f.audio.musicPause();assert.equal(f.timerCount(),0);
});
test('rapid practice-to-retry-to-menu transitions cancel every superseded pending music request', async () => {
  const f=fixture({deferResume:true});
  const practice=f.audio.musicStart({restart:true});f.audio.musicPause();
  const retry=f.audio.musicStart({restart:true});f.audio.musicPause();f.audio.musicPause();
  f.instances[0].resolveResume();
  assert.equal(await practice,false);assert.equal(await retry,false);
  assert.equal(f.audio.snapshot().musicScheduled,0);assert.equal(f.timerCount(),0);
  f.options.deferResume=false;
  assert.equal(await f.audio.musicStart({restart:true}),true);
  assert.equal(f.timerCount(),1);assert.equal(f.instances[0].resumeCalls,1);
});
