// Ambient sound for the city, generated live with WebAudio (no audio files, no copyright):
// - a calm oud-like melody in maqam Hijaz over a soft drone, with a gentle frame drum
// - a crowd murmur that gets louder as more people live in the city
const HIJAZ = [0, 1, 4, 5, 7, 8, 10, 12]; // D Eb F# G A Bb C D
const ROOT = 146.83; // D3

export class CityAudio {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.population = 0;
  }

  _init() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // reverb from a generated impulse
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.reverb.connect(wet).connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    this.music.connect(this.reverb);

    // drone
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    for (const [f, t] of [[ROOT / 2, 'sawtooth'], [(ROOT / 2) * 1.5, 'sawtooth'], [ROOT / 2 * 1.003, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = t;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(droneGain.gain);
    lfo.start();
    lp.connect(droneGain).connect(this.music);

    // noise buffer (drum + crowd)
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;

    // crowd murmur: a few "voice bands" of filtered noise with wandering loudness
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0;
    this.crowd.connect(this.master);
    this.crowd.connect(this.reverb);
    this.voices = [];
    for (let k = 0; k < 5; k++) {
      const src = ctx.createBufferSource();
      src.buffer = nb;
      src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 350 + k * 260;
      bp.Q.value = 3.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.crowd);
      src.start(0, Math.random() * 2);
      this.voices.push({ g, bp });
    }

    this.nextNote = ctx.currentTime + 0.5;
    this.nextDrum = ctx.currentTime + 1;
    this.degree = 0;
    this.timer = setInterval(() => this._tick(), 100);
  }

  _pluck(freq, t, vel = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.5);
    for (const [type, det, amp] of [['triangle', 0, 1], ['sawtooth', 4, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(f);
      o.start(t);
      o.stop(t + 1.7);
    }
    f.connect(g).connect(this.music);
  }

  _drum(t, low) {
    const ctx = this.ctx;
    if (low) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g).connect(this.music);
      o.start(t);
      o.stop(t + 0.45);
    } else {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      s.connect(bp).connect(g).connect(this.music);
      s.start(t, Math.random());
      s.stop(t + 0.15);
    }
  }

  _tick() {
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.3;
    // melody: a slow random walk on the scale, phrases with rests
    while (this.nextNote < ahead) {
      const t = this.nextNote;
      if (Math.random() < 0.82) {
        this.degree = Math.max(-3, Math.min(10, this.degree + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
        const oct = Math.floor(this.degree / HIJAZ.length);
        const step = HIJAZ[((this.degree % HIJAZ.length) + HIJAZ.length) % HIJAZ.length] + oct * 12;
        const f = ROOT * Math.pow(2, step / 12);
        this._pluck(f, t, 0.7 + Math.random() * 0.3);
        if (Math.random() < 0.18) this._pluck(f, t + 0.12, 0.45); // little tremolo
        if (Math.random() < 0.12) this._pluck(f * 2, t + 0.02, 0.25); // qanun shimmer
      }
      this.nextNote += [0.45, 0.6, 0.9, 0.9, 1.2, 1.8][Math.floor(Math.random() * 6)];
      if (Math.random() < 0.06) this.nextNote += 2.5; // breath between phrases
    }
    // drum: slow dum . tak . (about 50 bpm), soft
    while (this.nextDrum < ahead) {
      this._drum(this.nextDrum, true);
      this._drum(this.nextDrum + 0.6, false);
      if (Math.random() < 0.4) this._drum(this.nextDrum + 0.9, false);
      this.nextDrum += 2.4;
    }
    // crowd: louder with more people
    const n = this.population;
    const level = Math.min(1, Math.log10(n + 1) / 3); // 10 people ≈ 0.35, 100 ≈ 0.67, 1000 = 1
    this.crowd.gain.setTargetAtTime(level * 0.5, ctx.currentTime, 1.5);
    for (const v of this.voices) {
      if (Math.random() < 0.15) v.g.gain.setTargetAtTime(Math.random() < 0.35 ? 0 : Math.random() * 0.6, ctx.currentTime, 0.25);
      if (Math.random() < 0.05) v.bp.frequency.setTargetAtTime(300 + Math.random() * 1300, ctx.currentTime, 0.4);
    }
  }

  setPopulation(n) {
    this.population = n;
  }

  async toggle(force) {
    const want = force ?? !this.on;
    if (want && !this.ctx) this._init();
    if (!this.ctx) return false;
    if (want) await this.ctx.resume();
    this.on = want;
    this.master.gain.setTargetAtTime(want ? 0.8 : 0, this.ctx.currentTime, 0.6);
    return want;
  }
}
