/**
 * animations.js  â€“  Centralized Animation Engine
 * Portfolio | Daniel Pauly Retraubun
 *
 *  1. Accessibility Guard   â€“ prefers-reduced-motion: full static fallback
 *  2. Global State          â€“ single mouse/scroll source of truth
 *  3. Core rAF Loop         â€“ ONE tick drives every subsystem
 *  4. Visibility Strategy   â€“ IntersectionObserver with ratio-based reveal
 *  5. Interactive Layer     â€“ CSS variable mouse tracking on cards
 *  6. Spatial Depth         â€“ Lerp parallax orchestrator
 *  7. Custom Cursor         â€“ rAF-driven, no CSS transition on transform
 *  8. Houdini Spotlight     â€“ registered lazily via requestIdleCallback
 *
 * Performance notes:
 *  - All scroll/touch/resize listeners are PASSIVE.
 *  - will-change is set only while the element is being interacted with.
 *  - Houdini worklet is registered during idle time, not blocking load.
 *  - matrix.js canvas is lazily initialised only after page is fully idle.
 */

(function () {
  'use strict';

  /* ============================================================
     1. ACCESSIBILITY GUARD
     ============================================================ */
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function serveStaticVersion() {
    document.querySelectorAll('.reveal').forEach(el => {
      el.style.transition = 'none';
      el.classList.add('visible');
    });
    const style = document.createElement('style');
    style.textContent = 'body,a,button,label,input,select,textarea{cursor:auto!important}';
    document.head.appendChild(style);
    const dot  = document.getElementById('cursor-dot');
    const ring = document.getElementById('cursor-ring');
    if (dot)  dot.style.display  = 'none';
    if (ring) ring.style.display = 'none';
  }

  if (prefersReduced.matches) {
    serveStaticVersion();
    return;
  }
  prefersReduced.addEventListener('change', e => { if (e.matches) serveStaticVersion(); });

  /* ============================================================
     2. GLOBAL STATE
     ============================================================ */
  const state = {
    mouseX:     window.innerWidth  / 2,
    mouseY:     window.innerHeight / 2,
    normX:      0.5,
    normY:      0.5,
    scrollY:    window.scrollY,
    lerpScrollY:window.scrollY,
    ringX:      window.innerWidth  / 2,
    ringY:      window.innerHeight / 2,
    vw:         window.innerWidth,
    vh:         window.innerHeight,
    mouseInView:true,
    // Dirty flags â€“ skip writes when nothing changed
    _prevRingX: -1,
    _prevRingY: -1,
    _prevDotX:  -1,
    _prevDotY:  -1,
  };

  const PASSIVE = { passive: true };

  document.addEventListener('mousemove', e => {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    state.normX  = e.clientX / state.vw;
    state.normY  = e.clientY / state.vh;
  }, PASSIVE);

  document.addEventListener('mouseleave', () => { state.mouseInView = false; }, PASSIVE);
  document.addEventListener('mouseenter', () => { state.mouseInView = true;  }, PASSIVE);

  // Throttle scroll state update â€“ we only need it once per frame anyway
  let _scrollScheduled = false;
  window.addEventListener('scroll', () => {
    if (!_scrollScheduled) {
      _scrollScheduled = true;
      requestAnimationFrame(() => {
        state.scrollY    = window.scrollY;
        _scrollScheduled = false;
      });
    }
  }, PASSIVE);

  window.addEventListener('touchmove', () => { state.scrollY = window.scrollY; }, PASSIVE);

  let _resizeTimer;
  window.addEventListener('resize', () => {
    // Debounce resize â€“ recalculating parallax origins on every pixel is wasteful
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      state.vw = window.innerWidth;
      state.vh = window.innerHeight;
      initParallax(); // Recache origins after layout shift
    }, 150);
  }, PASSIVE);

  /* ============================================================
     LINEAR INTERPOLATION
     ============================================================ */
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ============================================================
     3. CORE rAF LOOP
     ============================================================ */
  function tick() {
    state.lerpScrollY = lerp(state.lerpScrollY, state.scrollY,  0.075);
    state.ringX       = lerp(state.ringX,        state.mouseX, 0.14);
    state.ringY       = lerp(state.ringY,        state.mouseY, 0.14);

    tickCursor();
    tickParallax();
    tickHoudiniSpotlight();
    tickCardTilt();

    requestAnimationFrame(tick);
  }

  /* ============================================================
     4. VISIBILITY STRATEGY  â€“  ratio-driven IntersectionObserver
     ============================================================ */
  function initReveal() {
    const els = document.querySelectorAll('.reveal');

    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('visible'));
      return;
    }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const ratio = entry.intersectionRatio;

        if (entry.isIntersecting) {
          // Physically tie opacity/position to scroll speed via ratio
          entry.target.style.opacity   = ratio;
          entry.target.style.transform = `translateY(${((1 - ratio) * 28).toFixed(1)}px)`;

          if (ratio >= 0.8) {
            entry.target.classList.add('visible');
            // Hand off to CSS â€“ clear inline overrides
            entry.target.style.opacity   = '';
            entry.target.style.transform = '';
            observer.unobserve(entry.target);
          }
        } else if (!entry.target.classList.contains('visible')) {
          entry.target.style.opacity   = '0';
          entry.target.style.transform = 'translateY(28px)';
        }
      });
    }, {
      threshold:   [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      rootMargin:  '0px 0px -40px 0px',
    });

    els.forEach(el => observer.observe(el));
  }

  /* ============================================================
     5. INTERACTIVE LAYER  â€“  CSS variable hover (--mouse-x/y)
     ============================================================ */
  function initCardInteractivity() {
    document.querySelectorAll('.portfolio-card').forEach(card => {
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${((e.clientX - rect.left) / rect.width  * 100).toFixed(1)}%`);
        card.style.setProperty('--mouse-y', `${((e.clientY - rect.top)  / rect.height * 100).toFixed(1)}%`);
        card._tiltTargetX = (((e.clientY - rect.top)  / rect.height) - 0.5) * 12;
        card._tiltTargetY = (((e.clientX - rect.left) / rect.width)  - 0.5) * -12;
        card._tilting     = true;
        // Promote to GPU layer only while interacting
        card.style.willChange = 'transform';
      }, PASSIVE);

      card.addEventListener('mouseleave', () => {
        card._tiltTargetX = 0;
        card._tiltTargetY = 0;
        card._tilting     = false;
        // Demote GPU layer when not needed
        card.style.willChange = 'auto';
      }, PASSIVE);
    });
  }

  /* ============================================================
     TICK â€“ 3-D card tilt via Lerp
     ============================================================ */
  const _tiltCards = [];

  function initCardTiltCache() {
    document.querySelectorAll('.portfolio-card').forEach(c => {
      c._tiltX       = 0;
      c._tiltY       = 0;
      c._tiltTargetX = 0;
      c._tiltTargetY = 0;
      _tiltCards.push(c);
    });
  }

  const _EPS = 0.02; // Skip DOM write below this threshold

  function tickCardTilt() {
    for (let i = 0; i < _tiltCards.length; i++) {
      const card = _tiltCards[i];
      const nx = lerp(card._tiltX, card._tiltTargetX, 0.1);
      const ny = lerp(card._tiltY, card._tiltTargetY, 0.1);

      // Only write when there's visible change
      if (Math.abs(nx - card._tiltX) > _EPS || Math.abs(ny - card._tiltY) > _EPS) {
        card._tiltX = nx;
        card._tiltY = ny;
        card.style.transform = card._tilting
          ? `translateY(-8px) perspective(800px) rotateX(${nx.toFixed(2)}deg) rotateY(${ny.toFixed(2)}deg)`
          : `perspective(800px) rotateX(${nx.toFixed(2)}deg) rotateY(${ny.toFixed(2)}deg)`;
      }
    }
  }

  /* ============================================================
     6. SPATIAL DEPTH  â€“  Lerp parallax orchestrator
     ============================================================ */
  function initParallax() {
    window._parallaxEls = Array.from(document.querySelectorAll('[data-parallax]')).map(el => ({
      el,
      speed:   parseFloat(el.dataset.parallax) || 0.3,
      originY: el.getBoundingClientRect().top + window.scrollY,
    }));
  }

  function tickParallax() {
    if (!window._parallaxEls) return;
    const s = state.lerpScrollY;
    for (let i = 0; i < window._parallaxEls.length; i++) {
      const { el, speed, originY } = window._parallaxEls[i];
      el.style.transform = `translateY(${((s - originY) * speed * 0.35).toFixed(2)}px)`;
    }
  }

  /* ============================================================
     7. CUSTOM CURSOR  â€“  tick-driven, dirty-check to skip writes
     ============================================================ */
  let _dot, _ring;

  function initCursor() {
    _dot  = document.getElementById('cursor-dot');
    _ring = document.getElementById('cursor-ring');
    // Remove CSS transition on transform â€“ rAF handles smoothness
    if (_ring) _ring.style.transition = 'width 0.25s ease, height 0.25s ease, border-color 0.25s ease, opacity 0.15s ease';
  }

  function tickCursor() {
    if (!_dot || !_ring) return;
    const vis = state.mouseInView ? '1' : '0';

    // Dot: only write if position changed by â‰¥ 0.5 px
    if (Math.abs(state.mouseX - state._prevDotX) > 0.5 || Math.abs(state.mouseY - state._prevDotY) > 0.5) {
      _dot.style.transform = `translate(${state.mouseX}px,${state.mouseY}px) translate(-50%,-50%)`;
      state._prevDotX = state.mouseX;
      state._prevDotY = state.mouseY;
    }
    _dot.style.opacity = vis;

    // Ring: only write if moved by â‰¥ 0.3 px
    const rx = state.ringX, ry = state.ringY;
    if (Math.abs(rx - state._prevRingX) > 0.3 || Math.abs(ry - state._prevRingY) > 0.3) {
      _ring.style.transform = `translate(${rx.toFixed(1)}px,${ry.toFixed(1)}px) translate(-50%,-50%)`;
      state._prevRingX = rx;
      state._prevRingY = ry;
    }
    _ring.style.opacity = vis;
  }

  /* ============================================================
     8. HOUDINI SPOTLIGHT  â€“  lazy registration via idle callback
     ============================================================ */
  let _heroSection;

  function initHoudiniSpotlight() {
    _heroSection = document.getElementById('home');
    if (!_heroSection) return;

    // Register worklet during idle time â€“ not blocking load
    const register = () => {
      if (!('paintWorklet' in CSS)) return;
      const code = `registerPaint('hero-spotlight',class{
        static get inputProperties(){return['--hl-x','--hl-y','--hl-color-r','--hl-color-g','--hl-color-b']}
        paint(ctx,size,props){
          const x=(parseFloat(props.get('--hl-x'))||70)/100*size.width;
          const y=(parseFloat(props.get('--hl-y'))||35)/100*size.height;
          const r=parseFloat(props.get('--hl-color-r'))||14;
          const g=parseFloat(props.get('--hl-color-g'))||165;
          const b=parseFloat(props.get('--hl-color-b'))||233;
          const rad=Math.max(size.width,size.height)*0.55;
          const gr=ctx.createRadialGradient(x,y,0,x,y,rad);
          gr.addColorStop(0,\`rgba(\${r},\${g},\${b},0.14)\`);
          gr.addColorStop(0.4,\`rgba(\${r},\${g},\${b},0.06)\`);
          gr.addColorStop(1,\`rgba(\${r},\${g},\${b},0)\`);
          ctx.fillStyle=gr;ctx.fillRect(0,0,size.width,size.height);
        }
      });`;
      const blob = new Blob([code], { type: 'application/javascript' });
      CSS.paintWorklet.addModule(URL.createObjectURL(blob));
    };

    // requestIdleCallback: register when browser has spare time
    if ('requestIdleCallback' in window) {
      requestIdleCallback(register, { timeout: 2000 });
    } else {
      setTimeout(register, 200); // Fallback for Safari
    }
  }

  let _prevNormX = -1, _prevNormY = -1;

  function tickHoudiniSpotlight() {
    if (!_heroSection) return;
    const nx = state.normX, ny = state.normY;
    // Only update when mouse moves meaningfully (avoids constant style mutation)
    if (Math.abs(nx - _prevNormX) > 0.002 || Math.abs(ny - _prevNormY) > 0.002) {
      _heroSection.style.setProperty('--hl-x', (nx * 100).toFixed(1));
      _heroSection.style.setProperty('--hl-y', (ny * 100).toFixed(1));
      _prevNormX = nx;
      _prevNormY = ny;
    }
  }

  /* ============================================================
     CARD SPOTLIGHT STYLE INJECTION (CSS only â€“ no !important hack)
     ============================================================ */
  function injectCardSpotlightStyle() {
    const style = document.createElement('style');
    style.textContent =
      '.portfolio-card::before{background:radial-gradient(circle at var(--mouse-x,50%) var(--mouse-y,50%),rgba(14,165,233,.18) 0%,rgba(99,102,241,.08) 40%,transparent 70%);opacity:1}';
    document.head.appendChild(style);
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    initCursor();
    initReveal();
    initCardInteractivity();
    initCardTiltCache();
    initParallax();
    initHoudiniSpotlight();
    injectCardSpotlightStyle();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
