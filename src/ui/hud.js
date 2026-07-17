// DOM overlay: HUD, compass, toasts, and the title / pause / win screens.

export class HUD {
  constructor(root) {
    this.root = root;
    const gemSvg = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><defs><linearGradient id="gemg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a5f3ff"/><stop offset="0.6" stop-color="#4f9cff"/><stop offset="1" stop-color="#2b6fd4"/></linearGradient></defs><path fill="url(#gemg)" d="M12 2 20 9.2 12 22 4 9.2Z"/><path fill="rgba(255,255,255,0.5)" d="M12 2 20 9.2H4Z" opacity="0.5"/></svg>`;
    const keys = (list) => list.map(([k, v]) => `<span class="keyhint"><kbd>${k}</kbd>${v}</span>`).join('');
    const controlChips = keys([['WASD', 'move'], ['Shift', 'run'], ['Space', 'jump'], ['Mouse', 'look'], ['Scroll', 'zoom'], ['M', 'mute']]);

    root.innerHTML = `
      <div class="vignette"></div>
      <div class="frame-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

      <div class="hud hidden" id="hud">
        <div class="card crystal-counter">
          <div class="counter-row">${gemSvg}<span id="crystal-count">0 / 10</span><span class="counter-label">crystals</span></div>
          <div class="progress"><div class="progress-fill" id="crystal-progress"></div></div>
        </div>
        <div class="card compass"><div class="compass-strip" id="compass-strip"></div><i class="compass-needle"></i></div>
        <div class="card fps" id="fps">-- FPS</div>
        <div class="hints">${controlChips}</div>
        <div class="toast" id="toast"><span class="toast-gem">${gemSvg}</span><span id="toast-text"></span></div>
      </div>

      <div class="screen" id="title-screen">
        <div class="title-stack">
          <p class="eyebrow">A&nbsp;SKY-KINGDOM&nbsp;ADVENTURE</p>
          <div class="ornament" aria-hidden="true"><i></i><span>✦</span><i></i></div>
          <h1>FLOATING ISLES</h1>
          <p class="subtitle">A scattered kingdom drifts in the endless sky.<br/>Recover the <b>10 lost sky crystals</b> hidden across the islands.</p>
          <button class="btn btn-primary" id="btn-play">Begin the Journey</button>
          <p class="controls-list">${controlChips}</p>
        </div>
        <div class="screen-footer">
          <span>v1.1</span><span class="dot">·</span><span>Three.js</span><span class="dot">·</span><span>models by KayKit</span>
        </div>
      </div>

      <div class="screen hidden" id="pause-screen">
        <div class="panel">
          <h2>Paused</h2>
          <button class="btn btn-primary" id="btn-resume">Resume</button>
          <div class="panel-divider"></div>
          <p class="controls-list">${controlChips}</p>
        </div>
      </div>

      <div class="screen hidden" id="win-screen">
        <div class="win-rays" aria-hidden="true"></div>
        <div class="panel panel-win">
          <div class="ornament" aria-hidden="true"><i></i><span>✦</span><i></i></div>
          <h2>The Sky Shines Again</h2>
          <p class="subtitle">You recovered every lost crystal. The isles are safe.</p>
          <p class="win-stats" id="win-stats"></p>
          <button class="btn btn-primary" id="btn-again">Explore Again</button>
        </div>
      </div>

      <div class="fade-flash" id="fade-flash"></div>
    `;

    this.hud = root.querySelector('#hud');
    this.crystalCount = root.querySelector('#crystal-count');
    this.fpsEl = root.querySelector('#fps');
    this.toastEl = root.querySelector('#toast');
    this.titleScreen = root.querySelector('#title-screen');
    this.pauseScreen = root.querySelector('#pause-screen');
    this.winScreen = root.querySelector('#win-screen');
    this.winStats = root.querySelector('#win-stats');
    this.fadeFlash = root.querySelector('#fade-flash');

    // compass strip: repeated cardinal markers, scrolled by yaw
    const strip = root.querySelector('#compass-strip');
    const marks = ['N', '·', 'E', '·', 'S', '·', 'W', '·'];
    let html = '';
    for (let rep = 0; rep < 4; rep++) {
      for (const m of marks) {
        html += `<span class="${m !== '·' ? 'cardinal' : ''}">${m}</span>`;
      }
    }
    strip.innerHTML = html;
    this.strip = strip;
    this.stripUnit = 90 * marks.length; // px per full revolution

    this._toastTimer = 0;
  }

  onPlay(fn) { this.root.querySelector('#btn-play').addEventListener('click', fn); }
  onResume(fn) { this.root.querySelector('#btn-resume').addEventListener('click', fn); }
  onAgain(fn) { this.root.querySelector('#btn-again').addEventListener('click', fn); }

  show(name) {
    this.titleScreen.classList.toggle('hidden', name !== 'title');
    this.pauseScreen.classList.toggle('hidden', name !== 'pause');
    this.winScreen.classList.toggle('hidden', name !== 'win');
    this.hud.classList.toggle('hidden', name !== 'game');
  }

  setCrystals(n, total) {
    this.crystalCount.textContent = `${n} / ${total}`;
    const fill = this.root.querySelector('#crystal-progress');
    if (fill) fill.style.width = `${(n / total) * 100}%`;
  }

  setFPS(fps) {
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;
    this.fpsEl.style.color = fps >= 50 ? '#9fd8a8' : fps >= 30 ? '#ffd98a' : '#ff9a8a';
  }

  setCompass(yaw) {
    // yaw=π looks toward -Z (north). Map camera yaw to strip offset.
    const frac = ((Math.PI - yaw) / (Math.PI * 2) % 1 + 1) % 1;
    const center = (this.strip.parentElement.clientWidth || 260) / 2;
    const x = -frac * this.stripUnit + center - 45 - this.stripUnit / 2;
    this.strip.style.transform = `translateX(${x}px)`;
  }

  toast(msg, ms = 2200) {
    const text = this.root.querySelector('#toast-text');
    if (text) text.textContent = msg;
    else this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setWinStats(text) {
    this.winStats.textContent = text;
  }

  flash() {
    this.fadeFlash.classList.add('show');
    setTimeout(() => this.fadeFlash.classList.remove('show'), 120);
  }
}
