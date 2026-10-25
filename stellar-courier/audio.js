/* Stellar Courier audio: classic-script Web Audio, no assets or network requests.
 * unlock(), play() and test() must be invoked from a click/key/pointer handler for
 * browsers that require user activation. A running AudioContext does not prove
 * that the browser tab, operating system, or remote-desktop stream is audible.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.StellarAudio = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  // frequency, duration, waveform, start delay, gain, optional ending frequency
  const PATTERNS = {
    start: [[392,.14,'triangle',0,.15],[523,.16,'triangle',.09,.15],[784,.28,'sine',.18,.17]],
    test: [[440,.22,'triangle',0,.18],[660,.22,'triangle',.25,.18],[880,.3,'sine',.5,.19]],
    pickup: [[880,.08,'triangle',0,.13],[1320,.13,'sine',.045,.13]],
    deliver: [[131,.35,'sine',0,.14],[523,.2,'triangle',0,.14],[659,.2,'triangle',.075,.14],[784,.2,'triangle',.15,.14],[1047,.32,'sine',.225,.17]],
    boost: [[150,.26,'triangle',0,.15,820],[70,.18,'sine',0,.1,180]],
    hit: [[110,.25,'sawtooth',0,.07,42],[65,.3,'sine',0,.16,35]],
    over: [[392,.3,'triangle',0,.13],[330,.34,'triangle',.19,.13],[262,.5,'sine',.38,.15]],
    powerup: [[659,.15,'triangle',0,.13],[988,.18,'triangle',.08,.13],[1319,.28,'sine',.16,.16]],
    level: [[392,.15,'triangle',0,.13],[523,.15,'triangle',.09,.13],[659,.18,'triangle',.18,.13],[784,.2,'triangle',.27,.13],[1047,.4,'sine',.36,.17]],
    combo: [[784,.12,'triangle',0,.13],[988,.14,'triangle',.06,.13],[1175,.23,'sine',.12,.16]],
    smash: [[210,.16,'triangle',0,.18,65],[90,.18,'sawtooth',0,.055,40]],
    warning: [[660,.1,'triangle',0,.11],[660,.1,'triangle',.17,.11]],
    victory: [[262,.6,'sine',0,.12],[523,.18,'triangle',0,.13],[659,.18,'triangle',.11,.13],[784,.2,'triangle',.22,.13],[1047,.5,'sine',.36,.18],[1319,.45,'sine',.48,.12]]
  };
  const RESUME_TIMEOUT = 2000;

  // Original 16-bar A-minor space theme: melody, changing harmony, bass,
  // arpeggios and electronic percussion. Eight eighth-note ticks per bar.
  const MUSIC_BPM = 108;
  const MUSIC_TICK = 60 / MUSIC_BPM / 2;
  const MUSIC_CHORDS = [[57,60,64],[53,57,60],[55,60,64],[55,59,62]];
  const MUSIC_BASS = [45,41,48,43];
  const MUSIC_MELODY = [
    [69,0,72,76,74,72,71,0], [69,0,72,0,77,76,72,0],
    [67,0,72,76,79,76,74,72], [71,0,74,0,79,77,74,71],
    [72,76,81,0,79,76,74,72], [69,72,77,0,76,72,69,0],
    [67,72,76,79,84,79,76,72], [71,74,79,0,77,74,71,0],
    [81,0,79,76,74,76,72,0], [77,0,76,72,69,72,76,0],
    [79,0,76,72,74,76,79,84], [83,79,77,74,71,74,79,0],
    [81,79,76,0,72,74,76,0], [77,76,72,0,69,72,76,77],
    [79,76,72,0,67,72,74,76], [74,71,67,0,71,74,76,0]
  ];
  const midi = note => 440 * Math.pow(2,(note-69)/12);
  function volume(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0,Math.min(1,number)) : fallback;
  }

  function create(options) {
    options = options || {};
    const Audio = root.AudioContext || root.webkitAudioContext;
    const onState = typeof options.onState === 'function' ? options.onState : function () {};
    let enabled = options.enabled !== false;
    let musicEnabled = options.musicEnabled !== false;
    let effectsVolume = volume(options.effectsVolume,.75), musicVolume = volume(options.musicVolume,.42);
    let context = null, effectsBus = null, musicBus = null, pending = null, noiseBuffer = null;
    let generation = 0, resumeAttempt = 0, notesScheduled = 0, soundsScheduled = 0;
    let musicWanted = false, musicPlaying = false, musicGeneration = 0, musicPromise = null;
    let musicTimer = null, nextMusicTime = 0, musicTick = 0, musicScheduled = 0, musicTicksScheduled = 0;
    let lastError = Audio ? '' : '浏览器不支持 Web Audio，请使用新版 Safari 或 Chrome。';
    const active = new Set(), activeMusic = new Set();

    function snapshot() {
      const state = context ? context.state : (Audio ? 'uninitialized' : 'unsupported');
      return Object.freeze({
        enabled: enabled,
        supported: Boolean(Audio),
        contextState: state,
        ready: enabled && state === 'running',
        unlocking: Boolean(pending),
        lastError: lastError,
        notesScheduled: notesScheduled,
        soundsScheduled: soundsScheduled,
        activeNotes: active.size,
        musicEnabled: musicEnabled,
        musicPlaying: musicPlaying,
        musicVolume: musicVolume,
        effectsVolume: effectsVolume,
        musicScheduled: musicScheduled,
        musicTicksScheduled: musicTicksScheduled,
        activeMusicNotes: activeMusic.size,
        schedulerActive: musicTimer !== null,
        musicTempo: MUSIC_BPM
      });
    }
    function emit() {
      try { onState(snapshot()); } catch (_) { /* Audio must not break the game UI. */ }
    }
    function message(error, fallback) {
      return error && error.message ? fallback + '（' + error.message + '）' : fallback;
    }
    function setBus(bus, value) {
      if (!bus || !context) return;
      try {
        bus.gain.cancelScheduledValues(context.currentTime);
        bus.gain.setValueAtTime(value,context.currentTime);
      } catch (_) { /* The device/context may have closed between calls. */ }
    }
    function cancelNotes(collection) {
      for (const entry of collection) {
        try { entry.source.stop(); } catch (_) {}
        try { entry.source.disconnect(); entry.gain.disconnect(); if(entry.filter)entry.filter.disconnect(); } catch (_) {}
      }
      collection.clear();
    }
    function haltMusic(invalidate) {
      if (invalidate) musicGeneration++;
      if (musicTimer !== null) root.clearTimeout(musicTimer);
      musicTimer = null; musicPlaying = false;
      cancelNotes(activeMusic);
      // Resume from the beginning of the current bar, not a chordless half-bar.
      musicTick = Math.floor(musicTick / 8) * 8;
    }
    function buildContext() {
      if (!Audio) { emit(); return false; }
      if (context && context.state !== 'closed') return true;
      try {
        if (context) context.onstatechange = null;
        cancelNotes(active); haltMusic(false); noiseBuffer = null;
        // Keep construction in the original user-activation call stack.
        context = new Audio();
        effectsBus = context.createGain();
        effectsBus.gain.setValueAtTime(enabled ? effectsVolume*.85 : 0,context.currentTime);
        effectsBus.connect(context.destination);
        musicBus = context.createGain();
        musicBus.gain.setValueAtTime(musicEnabled ? musicVolume*.6 : 0,context.currentTime);
        musicBus.connect(context.destination);
        const owner = context;
        context.onstatechange = function () {
          if (owner !== context) return;
          if (context.state === 'running') lastError = '';
          else if (musicPlaying) haltMusic(true);
          // An interrupted context never starts a hidden duplicate scheduler.
          // The application's next musicStart() user gesture resumes transport.
          emit();
        };
        lastError = '';
        return true;
      } catch (error) {
        context = null; effectsBus = null; musicBus = null;
        lastError = message(error,'音频初始化失败，请再次点击试听');
        emit();
        return false;
      }
    }
    function unlockContext() {
      if (!buildContext()) return Promise.resolve(false);
      if (context.state === 'running') { lastError = ''; emit(); return Promise.resolve(true); }
      if (pending) return pending;
      if (typeof context.resume !== 'function') {
        lastError = '浏览器无法恢复音频，请使用新版 Safari 或 Chrome。';
        emit(); return Promise.resolve(false);
      }
      let resumeResult;
      const attempt = ++resumeAttempt;
      try {
        // Safari can report "interrupted" as well as "suspended". Call resume
        // immediately, not inside a future promise callback, to retain activation.
        resumeResult = context.resume();
      } catch (error) {
        lastError = message(error,'音频尚未解锁，请再次点击试听');
        emit(); return Promise.resolve(false);
      }
      const owner = context;
      let timer;
      const resumed = Promise.resolve(resumeResult).then(function () {
        if (owner !== context || attempt !== resumeAttempt) return false;
        if (owner.state === 'running') { lastError = ''; return true; }
        lastError = '音频仍被浏览器暂停，请回到页面后点击试听。';
        return false;
      }, function (error) {
        if (owner === context && attempt === resumeAttempt) lastError = message(error,'浏览器未允许音频，请再次点击试听');
        return false;
      });
      const timeout = new Promise(function (resolve) {
        timer = root.setTimeout(function () {
          if (owner === context && attempt === resumeAttempt && owner.state !== 'running') lastError = '音频等待解锁，请点击试听重试。';
          resolve(owner === context && owner.state === 'running');
        },RESUME_TIMEOUT);
      });
      const operation = Promise.race([resumed,timeout]).then(function (ok) {
        root.clearTimeout(timer);
        if (pending === operation) pending = null;
        emit();
        return Boolean(ok && owner === context);
      });
      pending = operation;
      emit();
      return operation;
    }
    // Preserve the v2 SFX unlock contract. Music uses the shared context directly,
    // so disabling sound effects can never mute or disable the music bus.
    function unlock() {
      if (!enabled) { emit(); return Promise.resolve(false); }
      return unlockContext().then(function (ok) { return ok && enabled; });
    }
    function trackVoice(source,gain,collection,filter) {
      const entry = {source:source,gain:gain,filter:filter};
      collection.add(entry);
      source.onended = function () {
        collection.delete(entry);
        try { source.disconnect(); gain.disconnect(); if(filter)filter.disconnect(); } catch (_) {}
      };
    }
    function scheduleNote(note,baseTime,isMusic,attack) {
      const owner = context;
      const oscillator = owner.createOscillator(), gain = owner.createGain();
      const start = baseTime + note[3], duration = note[1];
      oscillator.type = note[2];
      oscillator.frequency.setValueAtTime(note[0],start);
      if (note[5]) oscillator.frequency.exponentialRampToValueAtTime(note[5],start + duration);
      gain.gain.setValueAtTime(.0001,start);
      gain.gain.exponentialRampToValueAtTime(note[4],start + (attack || .009));
      gain.gain.exponentialRampToValueAtTime(.0001,start + duration);
      oscillator.connect(gain); gain.connect(isMusic ? musicBus : effectsBus);
      trackVoice(oscillator,gain,isMusic ? activeMusic : active);
      oscillator.start(start); oscillator.stop(start + duration + .025);
      if (isMusic) musicScheduled++; else notesScheduled++;
    }
    function scheduleNoise(at,duration,gainValue,frequency) {
      // Deterministic noise is generated once in memory; no audio files are loaded.
      if (!noiseBuffer) {
        const rate = context.sampleRate || 44100;
        noiseBuffer = context.createBuffer(1,Math.ceil(rate*.24),rate);
        const data = noiseBuffer.getChannelData(0);
        let seed = 19283;
        for(let i=0;i<data.length;i++){seed=(seed*16807)%2147483647;data[i]=(seed/2147483647)*2-1;}
      }
      const source = context.createBufferSource(), gain = context.createGain();
      const filter = context.createBiquadFilter();
      source.buffer = noiseBuffer; filter.type = 'highpass';
      filter.frequency.setValueAtTime(frequency,at);
      source.connect(filter); filter.connect(gain); gain.connect(musicBus);
      gain.gain.setValueAtTime(.0001,at);
      gain.gain.exponentialRampToValueAtTime(gainValue,at+.004);
      gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
      trackVoice(source,gain,activeMusic,filter);
      source.start(at);source.stop(at+duration+.01);musicScheduled++;
    }
    function scheduleMusicTick(tick,at) {
      const bar = Math.floor(tick/8)%16, beat = tick%8, harmony = bar%4;
      const chord = MUSIC_CHORDS[harmony], bass = MUSIC_BASS[harmony];
      const melody = MUSIC_MELODY[bar][beat];
      if (beat===0) {
        chord.forEach(note => scheduleNote([midi(note),MUSIC_TICK*7.6,'triangle',0,.027],at,true,.12));
      }
      if (melody) {
        scheduleNote([midi(melody),MUSIC_TICK*1.55,'triangle',0,.085],at,true,.012);
        if(bar>=8 && beat%2===0) scheduleNote([midi(melody+12),MUSIC_TICK*.75,'sine',0,.023],at,true);
      }
      // The repeating arpeggio changes with each chord, beneath the composed lead.
      const arp = chord[[0,1,2,1,0,2,1,2][beat]] + 12;
      scheduleNote([midi(arp),MUSIC_TICK*.65,'sine',0,beat%2 ? .025 : .019],at,true);
      if ([0,3,4,6].includes(beat)) {
        scheduleNote([midi(bass+(beat===6?7:0)),MUSIC_TICK*(beat===3?.7:1.4),'sine',0,.15],at,true,.015);
      }
      if (beat===0 || beat===4 || (bar>=8 && beat===3)) {
        scheduleNote([118,.16,'sine',0,.18,42],at,true);
      }
      if (beat===2 || beat===6) {
        scheduleNoise(at,.105,.085,1400);
        scheduleNote([165,.09,'triangle',0,.045,75],at,true);
      }
      scheduleNoise(at,.035,beat%2?.031:.018,6500);
      musicTicksScheduled++;
    }
    function pumpMusic() {
      musicTimer = null;
      if (!musicPlaying || !musicWanted || !musicEnabled || !context || context.state!=='running') {
        haltMusic(false); emit(); return;
      }
      try {
        const now = context.currentTime;
        // A throttled tab must never dump seconds of overdue notes all at once.
        if (nextMusicTime < now-.2) {
          const skipped = Math.ceil((now-nextMusicTime)/MUSIC_TICK);
          musicTick = (musicTick+skipped)%128;
          nextMusicTime = now+.02;
        }
        while(nextMusicTime < now+.18) {
          scheduleMusicTick(musicTick,nextMusicTime);
          musicTick = (musicTick+1)%128;
          nextMusicTime += MUSIC_TICK;
        }
        musicTimer = root.setTimeout(pumpMusic,50);
      } catch (error) {
        haltMusic(true);
        lastError = message(error,'背景音乐暂不可用，请关闭后重新开启音乐');
        emit();
      }
    }
    function musicStart(settings) {
      musicWanted = true;
      if (!musicEnabled) { emit(); return Promise.resolve(false); }
      if (musicPlaying && context && context.state==='running') return Promise.resolve(true);
      if (musicPromise) return musicPromise;
      if (settings && settings.restart) musicTick = 0;
      const ticket = musicGeneration;
      const operation = unlockContext().then(function (ready) {
        if (!ready || ticket!==musicGeneration || !musicWanted || !musicEnabled || !context || context.state!=='running') return false;
        if (!musicPlaying) {
          musicPlaying = true; nextMusicTime = context.currentTime+.04;
          pumpMusic(); emit();
        }
        return musicPlaying;
      }).then(function (ok) {
        if (musicPromise===operation) musicPromise=null;
        return ok;
      });
      musicPromise=operation;
      return operation;
    }
    function musicPause() {
      musicWanted = false;
      // Release our reference now so a newer Start may wait on the same audio
      // unlock, with a fresh ticket. The older promise cannot resurrect music.
      musicPromise = null; haltMusic(true); emit();
      return true;
    }
    function setMusicEnabled(value) {
      musicEnabled = Boolean(value);
      setBus(musicBus,musicEnabled ? musicVolume*.6 : 0);
      if (!musicEnabled) { musicPromise=null;haltMusic(true);emit();return Promise.resolve(false); }
      emit();
      return musicWanted ? musicStart() : Promise.resolve(false);
    }
    function setMusicVolume(value) {
      musicVolume = volume(value,musicVolume);
      setBus(musicBus,musicEnabled ? musicVolume*.6 : 0);emit();
      return musicVolume;
    }
    function setEffectsVolume(value) {
      effectsVolume = volume(value,effectsVolume);
      setBus(effectsBus,enabled ? effectsVolume*.85 : 0);emit();
      return effectsVolume;
    }
    function play(kind) {
      if (!enabled || !Object.prototype.hasOwnProperty.call(PATTERNS,kind)) return Promise.resolve(false);
      const ticket = generation, requestedAt = Date.now();
      return unlock().then(function (ready) {
        if (!ready || !enabled || generation !== ticket || !context || context.state !== 'running') return false;
        // Do not play a backlog of old collision/pickup effects after an interruption.
        if (kind !== 'start' && kind !== 'test' && Date.now()-requestedAt > 700) return false;
        try {
          const baseTime = context.currentTime + .008;
          PATTERNS[kind].forEach(function (note) { scheduleNote(note,baseTime,false); });
          soundsScheduled++;
          lastError = ''; emit();
          return true;
        } catch (error) {
          lastError = message(error,'音效暂不可用，请点击试听重试');
          emit(); return false;
        }
      });
    }
    function setEnabled(value) {
      const next = Boolean(value);
      if (next !== enabled) generation++;
      enabled = next;
      setBus(effectsBus,enabled ? effectsVolume*.85 : 0);
      if (!enabled) { cancelNotes(active); emit(); return Promise.resolve(false); }
      emit();
      return unlock();
    }
    function testSound() { return play('test'); }
    return Object.freeze({
      unlock: unlock,
      play: play,
      test: testSound,
      setEnabled: setEnabled,
      musicStart: musicStart,
      musicPause: musicPause,
      setMusicEnabled: setMusicEnabled,
      setMusicVolume: setMusicVolume,
      setEffectsVolume: setEffectsVolume,
      snapshot: snapshot,
      get enabled() { return enabled; }
    });
  }
  return Object.freeze({ create: create });
}));
