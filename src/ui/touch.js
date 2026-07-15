// Touch controls for phones/tablets: left-side virtual joystick to move,
// right-side drag to look, pinch to zoom, on-screen jump + pause buttons.
// The joystick is hand-rolled: it appears where the thumb lands, tracks that
// touch by identifier, and feeds an analog vector into the shared input state.

const STICK_RADIUS = 55; // px from center to full deflection

export class TouchControls {
  constructor(root, input, tpCamera, { onPause }) {
    this.input = input;
    this.camera = tpCamera;

    this.container = document.createElement('div');
    this.container.id = 'touch-ui';
    this.container.innerHTML = `
      <div id="joy-zone">
        <div id="joy-base"><div id="joy-thumb"></div></div>
      </div>
      <div id="look-zone"></div>
      <button id="btn-jump" aria-label="Jump">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
      </button>
      <button id="btn-pause-touch" aria-label="Pause">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
      </button>
    `;
    root.appendChild(this.container);

    // --- joystick (left half) ---
    // The base is ALWAYS visible at a fixed spot so players immediately see
    // where to put their thumb; any touch in the left zone steers relative
    // to the base center.
    const zone = this.container.querySelector('#joy-zone');
    this.base = this.container.querySelector('#joy-base');
    this.thumb = this.container.querySelector('#joy-thumb');
    this.stickId = null;

    const baseCenter = () => {
      const r = this.base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const stickMove = (t) => {
      const c = baseCenter();
      let dx = t.clientX - c.x;
      let dy = t.clientY - c.y;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        dx *= STICK_RADIUS / d;
        dy *= STICK_RADIUS / d;
      }
      this.thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      input.moveX = dx / STICK_RADIUS;
      input.moveZ = dy / STICK_RADIUS; // drag up = negative dy = forward
    };
    const stickEnd = () => {
      this.stickId = null;
      this.base.classList.remove('live');
      this.thumb.style.transform = 'translate(0, 0)';
      input.moveX = 0;
      input.moveZ = 0;
    };

    zone.addEventListener('touchstart', (e) => {
      if (this.stickId === null) {
        const t = e.changedTouches[0];
        this.stickId = t.identifier;
        this.base.classList.add('live');
        stickMove(t);
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) stickMove(t);
      }
      e.preventDefault();
    }, { passive: false });
    for (const ev of ['touchend', 'touchcancel']) {
      zone.addEventListener(ev, (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.stickId) stickEnd();
        }
      });
    }

    // --- look + pinch (right half) ---
    const look = this.container.querySelector('#look-zone');
    let lastTouch = null;
    let pinchDist = 0;
    look.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        lastTouch = null;
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
      }
      e.preventDefault();
    }, { passive: false });
    look.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && lastTouch) {
        const t = e.touches[0];
        this.camera.applyLook((t.clientX - lastTouch.x) * 1.7, (t.clientY - lastTouch.y) * 1.7);
        lastTouch = { x: t.clientX, y: t.clientY };
      } else if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (pinchDist > 0) this.camera.zoomBy((pinchDist - d) * 0.03);
        pinchDist = d;
      }
      e.preventDefault();
    }, { passive: false });
    look.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        lastTouch = null;
        pinchDist = 0;
      } else if (e.touches.length === 1) {
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        pinchDist = 0;
      }
    });

    // --- buttons ---
    const jumpBtn = this.container.querySelector('#btn-jump');
    const press = (e) => {
      input.jump = true;
      input.jumpBufferedAt = performance.now();
      jumpBtn.classList.add('pressed');
      e.preventDefault();
    };
    jumpBtn.addEventListener('touchstart', press, { passive: false });
    jumpBtn.addEventListener('mousedown', press);
    jumpBtn.addEventListener('touchend', () => jumpBtn.classList.remove('pressed'));
    jumpBtn.addEventListener('mouseup', () => jumpBtn.classList.remove('pressed'));

    const pauseBtn = this.container.querySelector('#btn-pause-touch');
    pauseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      onPause();
    });

    this.hide();
    window.__touch = this; // test hook
  }

  show() {
    this.container.classList.add('active');
  }

  hide() {
    this.container.classList.remove('active');
    this.input.moveX = 0;
    this.input.moveZ = 0;
  }
}

// Coarse pointer or a real touch screen — also forceable with ?touch for testing.
export function detectMobile() {
  if (new URLSearchParams(location.search).has('touch')) return true;
  return window.matchMedia('(pointer: coarse)').matches
    || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
}
