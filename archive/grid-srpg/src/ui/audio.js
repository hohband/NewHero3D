// WebAudio 程序合成音频（对应 Godot 版 AudioManager 占位层，D39）
// SFX 为合成音效；BGM 为五声音阶循环。音量/静音存档案 settings。
export class AudioManager {
  constructor(settings) {
    this.ctx = null;
    this.settings = settings;
    this._bgmTimer = null;
    this._bgmStep = 0;
  }

  _ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applySettings(this.settings);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  applySettings(s) {
    this.settings = s;
    if (!this.ctx) return;
    const mute = s.mute ? 0 : 1;
    this.master.gain.value = (s.volume_master ?? 1) * mute;
    this.sfxBus.gain.value = s.volume_sfx ?? 1;
    this.musicBus.gain.value = (s.volume_music ?? 1) * 0.5;
  }

  // 基础合成音
  _tone({ freq = 440, dur = 0.12, type = "square", vol = 0.25, slide = 0, delay = 0 }) {
    const ctx = this._ensureCtx();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  play(name) {
    if (this.settings.mute) return;
    switch (name) {
      case "click": this._tone({ freq: 660, dur: 0.05, type: "sine", vol: 0.15 }); break;
      case "hover": this._tone({ freq: 440, dur: 0.03, type: "sine", vol: 0.08 }); break;
      case "move": this._tone({ freq: 330, dur: 0.06, type: "triangle", vol: 0.12 }); break;
      case "hit": this._tone({ freq: 180, dur: 0.1, type: "square", vol: 0.3, slide: -80 }); break;
      case "crit": this._tone({ freq: 220, dur: 0.16, type: "sawtooth", vol: 0.32, slide: -120 }); break;
      case "dodge": this._tone({ freq: 520, dur: 0.08, type: "sine", vol: 0.15, slide: 200 }); break;
      case "heal": this._tone({ freq: 520, dur: 0.18, type: "sine", vol: 0.2, slide: 260 }); break;
      case "buff": this._tone({ freq: 392, dur: 0.12, type: "triangle", vol: 0.18, slide: 120 }); break;
      case "status": this._tone({ freq: 240, dur: 0.14, type: "sawtooth", vol: 0.2, slide: -60 }); break;
      case "collect": this._tone({ freq: 660, dur: 0.1, type: "sine", vol: 0.22, slide: 220 }); break;
      case "ult":
        this._tone({ freq: 160, dur: 0.3, type: "sawtooth", vol: 0.35, slide: 240 });
        this._tone({ freq: 320, dur: 0.35, type: "square", vol: 0.2, slide: 320, delay: 0.1 });
        break;
      case "win":
        [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, dur: 0.22, type: "triangle", vol: 0.25, delay: i * 0.12 }));
        break;
      case "lose":
        [392, 330, 262, 196].forEach((f, i) => this._tone({ freq: f, dur: 0.28, type: "triangle", vol: 0.22, delay: i * 0.15 }));
        break;
      default: this._tone({}); break;
    }
  }

  // 战斗事件 → 音效（对应 play_event）
  playEvent(e) {
    switch (e.type) {
      case "damage": this.play(e.died ? "crit" : e.crit ? "crit" : e.blocked ? "status" : "hit"); break;
      case "dodge": case "miss": this.play("dodge"); break;
      case "heal": case "hot": case "terrain_heal": this.play("heal"); break;
      case "buff": case "aura": case "bond": this.play("buff"); break;
      case "status": case "dot": case "terrain_dot": this.play("status"); break;
      case "move": this.play("move"); break;
      case "collect": this.play("collect"); break;
      default: break;
    }
  }

  playSkill(skill) {
    if (!skill) return;
    if (skill.type === "ult") this.play("ult");
    else if (skill.range_shape === "diamond") this.play("dodge");
    else this.play("hit");
  }

  // 简易 BGM：五声音阶拨弦循环
  startBgm(mode = "main") {
    this.stopBgm();
    const scale = mode === "battle"
      ? [220, 262, 294, 330, 392, 440]
      : [196, 220, 262, 294, 330, 392];
    const interval = mode === "battle" ? 340 : 520;
    this._bgmTimer = setInterval(() => {
      if (this.settings.mute) return;
      const ctx = this._ensureCtx();
      const f = scale[this._bgmStep % scale.length] * (this._bgmStep % 8 >= 4 ? 2 : 1);
      this._bgmStep += 1 + (this._bgmStep % 3);
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.12, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + interval / 1000 * 1.8);
      osc.connect(gain);
      gain.connect(this.musicBus);
      osc.start(t0);
      osc.stop(t0 + interval / 1000 * 2);
    }, interval);
  }

  stopBgm() {
    if (this._bgmTimer) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
  }
}
