// DOM overlay: HUD, compass, toasts, and the title / pause / win screens.

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="vignette"></div>
      <div class="hud hidden" id="hud">
        <div class="crystal-counter">
          <div class="counter-row"><span class="gem"></span><span id="crystal-count">0 / 10</span></div>
          <div class="progress"><div class="progress-fill" id="crystal-progress"></div></div>
        </div>
        <div class="fps" id="fps">-- FPS</div>
        <div class="compass"><div class="compass-strip" id="compass-strip"></div></div>
        <div class="hints"><b>WASD</b> move &nbsp;·&nbsp; <b>Shift</b> run &nbsp;·&nbsp; <b>Space</b> jump &nbsp;·&nbsp; <b>Mouse</b> look &nbsp;·&nbsp; <b>Esc</b> pause</div>
        <div class="toast" id="toast"></div>
      </div>

      <div class="screen" id="title-screen">
        <h1>FLOATING ISLES</h1>
        <p class="subtitle">A scattered kingdom drifts in the endless sky.<br/>Recover the <b style="color:#8ee7ff">10 lost sky crystals</b> hidden across the islands.</p>
        <button class="btn" id="btn-play">BEGIN THE JOURNEY</button>
        <p class="controls-list"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>Mouse</b> look · <b>Scroll</b> zoom · <b>M</b> mute</p>
      </div>

      <div class="screen hidden" id="pause-screen">
        <h2>PAUSED</h2>
        <button class="btn" id="btn-resume">RESUME</button>
        <p class="controls-list"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>Mouse</b> look · <b>Scroll</b> zoom · <b>M</b> mute</p>
      </div>

      <div class="screen hidden" id="win-screen">
        <h2>THE SKY SHINES AGAIN</h2>
        <p class="subtitle">You recovered every lost crystal. The isles are safe.</p>
        <p class="win-stats" id="win-stats"></p>
        <button class="btn" id="btn-again">EXPLORE AGAIN</button>
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
    const x = -frac * this.stripUnit + 130 - 45 - this.stripUnit / 2;
    this.strip.style.transform = `translateX(${x}px)`;
  }

  toast(msg, ms = 2200) {
    this.toastEl.textContent = msg;
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
