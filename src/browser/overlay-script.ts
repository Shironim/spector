import { IN_BROWSER_CSS_SELECTOR_FN } from '../utils/selector.js';
import { IN_BROWSER_COMPONENT_DETECTOR_FN } from '../utils/framework-detector.js';
import { BLUEPRINT_LIMITS, IN_BROWSER_BLUEPRINT_EXTRACTOR_FN } from '../analyzers/design-blueprint.js';
import { TOKEN_BUDGETS } from '../constants.js';

export const OVERLAY_ENGINE_SCRIPT = `
(() => {
  if (window.__spectorOverlay && window.__spectorOverlay.__version === 4) return;

  ${IN_BROWSER_CSS_SELECTOR_FN}
  ${IN_BROWSER_COMPONENT_DETECTOR_FN}
  ${IN_BROWSER_BLUEPRINT_EXTRACTOR_FN}

  const UI_PREFIX = 'data-spector-picker';

  const TOKENS = {
    fontUi: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    fontMono: 'monospace',
    toolbarBg: 'rgba(15,23,42,0.96)',
    inputBg: 'rgba(30,41,59,0.95)',
    text: '#f8fafc',
    muted: '#cbd5e1',
    accent: '#0369a1',
    accentBorder: '#38bdf8',
    accentSoft: 'rgba(14,165,233,0.12)',
    warning: '#b45309',
    warningBorder: '#f59e0b',
    warningSoft: 'rgba(245,158,11,0.15)',
    success: '#047857',
    successBright: '#10b981',
    successSoft: 'rgba(16,185,129,0.08)',
    dangerBorder: 'rgba(248,113,113,0.4)',
    dangerText: '#fca5a5',
    borderSubtle: 'rgba(148,163,184,0.35)',
    zMarker: 2147483644,
    zHighlight: 2147483645,
    zOverlay: 2147483646,
    zControl: 2147483647
  };

  function isOverlayEl(el) {
    return Boolean(el && ((el.hasAttribute && el.hasAttribute(UI_PREFIX)) || (el.closest && el.closest('[' + UI_PREFIX + ']'))));
  }

  function showToast(msg, isWarn) {
    const existing = document.querySelector('[' + UI_PREFIX + '="toast"]');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.setAttribute(UI_PREFIX, 'toast');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'z-index:' + TOKENS.zControl,
      'background:' + (isWarn ? TOKENS.warning : TOKENS.success),
      'color:#ffffff',
      'padding:10px 18px',
      'border-radius:10px',
      'font-family:' + TOKENS.fontUi,
      'font-size:13px',
      'font-weight:500',
      'box-shadow:0 10px 25px rgba(0,0,0,0.3)',
      'pointer-events:none'
    ].join(';');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function createPillButton(label, titleText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (titleText) btn.title = titleText;
    return btn;
  }

  function createOverlayBoxes() {
    const highlightBox = document.createElement('div');
    highlightBox.setAttribute(UI_PREFIX, 'highlight');
    highlightBox.setAttribute('aria-hidden', 'true');
    highlightBox.style.cssText = 'position:fixed;pointer-events:none;z-index:' + TOKENS.zHighlight + ';border:2px solid ' + TOKENS.accent + ';background:' + TOKENS.accentSoft + ';border-radius:4px;display:none;box-sizing:border-box;';

    const marqueeBox = document.createElement('div');
    marqueeBox.setAttribute(UI_PREFIX, 'marquee');
    marqueeBox.setAttribute('aria-hidden', 'true');
    marqueeBox.style.cssText = 'position:fixed;pointer-events:none;z-index:' + TOKENS.zOverlay + ';border:2px dashed ' + TOKENS.warningBorder + ';background:' + TOKENS.warningSoft + ';border-radius:4px;display:none;box-sizing:border-box;';

    const badge = document.createElement('div');
    badge.setAttribute(UI_PREFIX, 'badge');
    badge.setAttribute('aria-hidden', 'true');
    badge.style.cssText = 'position:fixed;pointer-events:none;z-index:' + TOKENS.zOverlay + ';background:' + TOKENS.accent + ';color:#ffffff;font-family:' + TOKENS.fontMono + ';font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;display:none;white-space:nowrap;box-shadow:0 4px 6px -1px rgba(0,0,0,0.25);';

    return { highlightBox, marqueeBox, badge };
  }

  function startOverlay(options) {
    const opts = options || {};
    const source = opts.source || 'hotkey';
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 0;
    const includeStyles = opts.includeStyles !== false;
    const maxSubtreeElements = opts.maxSubtreeElements || ${BLUEPRINT_LIMITS.maxSubtreeElements};
    const maxInlineSvgBytes = opts.maxInlineSvgBytes || ${BLUEPRINT_LIMITS.maxInlineSvgBytes};

    if (document.querySelector('[' + UI_PREFIX + '="toolbar"]')) {
      return Promise.resolve({ status: 'cancelled' });
    }

    return new Promise((resolve) => {
      const state = {
        role: opts.role || 'single',
        mode: opts.selectionMode || 'element',
        hoveredTarget: null,
        dragStart: null,
        isDragging: false,
        queuedPins: []
      };

      const markerEls = [];
      const componentHintCache = new WeakMap();
      const listenerController = new AbortController();
      let timerId = null;
      let hoverRafId = 0;
      let pendingPoint = null;

      const pillBaseStyle = 'border:1px solid ' + TOKENS.borderSubtle + ';background:transparent;color:' + TOKENS.muted + ';padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;';
      const pillActiveStyle = 'border:1px solid ' + TOKENS.accentBorder + ';background:' + TOKENS.accent + ';color:#ffffff;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;';

      const toolbar = document.createElement('div');
      toolbar.setAttribute(UI_PREFIX, 'toolbar');
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Spector element picker');
      toolbar.style.cssText = [
        'position:fixed',
        'top:14px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:' + TOKENS.zControl,
        'background:' + TOKENS.toolbarBg,
        'color:' + TOKENS.text,
        'padding:8px 12px',
        'border-radius:12px',
        'font-family:' + TOKENS.fontUi,
        'font-size:12px',
        'box-shadow:0 12px 30px rgba(0,0,0,0.38),0 0 0 1px rgba(255,255,255,0.12)',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'flex-wrap:wrap',
        'max-width:95vw',
        'backdrop-filter:blur(10px)',
        'user-select:none'
      ].join(';');

      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + TOKENS.accentBorder + ';box-shadow:0 0 8px ' + TOKENS.accentBorder + ';flex-shrink:0;';

      const titleLabel = document.createElement('strong');
      titleLabel.textContent = 'Spector';
      titleLabel.style.cssText = 'font-size:12px;margin-right:2px;color:#fff;';

      const roleDefs = [
        { id: 'single', label: 'Single', tip: 'Capture one element and return immediately' },
        { id: 'target', label: 'Target (A)', tip: 'Pin local project element for A/B comparison' },
        { id: 'reference', label: 'Ref (B)', tip: 'Pin reference design element for A/B comparison' },
        { id: 'pin', label: 'Queue', tip: 'Pin multiple items before sending batch' }
      ];
      const roleButtons = {};
      const roleGroup = document.createElement('div');
      roleGroup.style.cssText = 'display:flex;gap:4px;align-items:center;';

      const modeBtn = createPillButton('Element (R)', 'Toggle Element click vs Region drag (R)');
      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.maxLength = 240;
      noteInput.placeholder = 'Note (N)...';
      noteInput.setAttribute('aria-label', 'Quick revision note');
      noteInput.style.cssText = 'background:' + TOKENS.inputBg + ';border:1px solid rgba(148,163,184,0.4);color:' + TOKENS.text + ';border-radius:6px;padding:4px 8px;font-size:11px;width:140px;outline-offset:2px;';

      const doneBtn = createPillButton('', 'Submit queued pins (Enter)');
      doneBtn.style.cssText = 'display:none;border:1px solid ' + TOKENS.successBright + ';background:' + TOKENS.success + ';color:#fff;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;';

      const cancelBtn = createPillButton('Esc', 'Cancel picking (Escape)');
      cancelBtn.style.cssText = 'border:1px solid ' + TOKENS.dangerBorder + ';background:transparent;color:' + TOKENS.dangerText + ';padding:3px 7px;border-radius:6px;font-size:11px;cursor:pointer;';

      const { highlightBox, marqueeBox, badge } = createOverlayBoxes();

      function syncUi() {
        Object.keys(roleButtons).forEach((k) => {
          const active = k === state.role;
          roleButtons[k].style.cssText = active ? pillActiveStyle : pillBaseStyle;
          roleButtons[k].setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        const isRegion = state.mode === 'region';
        modeBtn.textContent = isRegion ? 'Region (Drag)' : 'Element (R)';
        modeBtn.setAttribute('aria-pressed', isRegion ? 'true' : 'false');
        modeBtn.style.cssText = isRegion
          ? 'border:1px solid ' + TOKENS.warningBorder + ';background:' + TOKENS.warning + ';color:#fff;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;'
          : pillBaseStyle;

        if (state.role === 'pin' && state.queuedPins.length > 0) {
          doneBtn.style.display = 'inline-block';
          doneBtn.textContent = 'Send (' + state.queuedPins.length + ')';
        } else {
          doneBtn.style.display = 'none';
        }
      }

      function addPinMarker(rect, indexLabel) {
        const marker = document.createElement('div');
        marker.setAttribute(UI_PREFIX, 'marker');
        marker.setAttribute('aria-hidden', 'true');
        marker.style.cssText = [
          'position:fixed',
          'pointer-events:none',
          'z-index:' + TOKENS.zMarker,
          'left:' + rect.x + 'px',
          'top:' + rect.y + 'px',
          'width:' + rect.width + 'px',
          'height:' + rect.height + 'px',
          'border:2px solid ' + TOKENS.successBright,
          'background:' + TOKENS.successSoft,
          'border-radius:4px',
          'box-sizing:border-box'
        ].join(';');
        const pill = document.createElement('span');
        pill.textContent = indexLabel;
        pill.style.cssText = 'position:absolute;top:-18px;left:0;background:' + TOKENS.successBright + ';color:#fff;font-family:' + TOKENS.fontMono + ';font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;';
        marker.appendChild(pill);
        document.body.appendChild(marker);
        markerEls.push(marker);
      }

      function cleanup() {
        if (timerId) clearTimeout(timerId);
        if (hoverRafId) cancelAnimationFrame(hoverRafId);
        listenerController.abort();
        toolbar.remove();
        highlightBox.remove();
        marqueeBox.remove();
        badge.remove();
        markerEls.forEach((m) => m.remove());
      }

      function resolveComponentHint(target) {
        if (!target) return undefined;
        if (componentHintCache.has(target)) {
          return componentHintCache.get(target);
        }
        const detected = detectFrameworkComponent(target) || undefined;
        componentHintCache.set(target, detected);
        return detected;
      }

      function resolveElementAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || isOverlayEl(el)) return null;
        return el;
      }

      function buildElementPayload(target) {
        const selector = getCssSelector(target);
        const tagName = target.tagName.toLowerCase();
        const frameworkComponent = resolveComponentHint(target);
        const blueprint = extractDesignBlueprint(target, includeStyles, maxSubtreeElements, maxInlineSvgBytes);
        const note = noteInput.value.trim() || undefined;
        return {
          status: 'selected',
          role: state.role,
          pinMode: 'element',
          ...(note ? { note } : {}),
          selector,
          tagName,
          frameworkComponent,
          rect: blueprint.rect,
          computedStyles: blueprint.computedStyles,
          subtreeSummary: blueprint.subtreeSummary,
          assets: blueprint.assets
        };
      }

      function buildRegionPayload(regionRect) {
        const cx = regionRect.x + regionRect.width / 2;
        const cy = regionRect.y + regionRect.height / 2;
        const target = resolveElementAt(cx, cy) || document.body;
        const selector = target ? getCssSelector(target) : 'body';
        const frameworkComponent = resolveComponentHint(target);
        const note = noteInput.value.trim() || undefined;
        const blueprint = target ? extractDesignBlueprint(target, includeStyles, maxSubtreeElements, maxInlineSvgBytes) : {};
        return {
          status: 'selected',
          role: state.role,
          pinMode: 'region',
          ...(note ? { note } : {}),
          selector,
          tagName: 'region',
          frameworkComponent,
          rect: regionRect,
          computedStyles: blueprint.computedStyles,
          subtreeSummary: blueprint.subtreeSummary,
          assets: blueprint.assets
        };
      }

      async function emitPayload(payload) {
        if (source === 'hotkey' && typeof window.__spector_on_element_picked === 'function') {
          try { await window.__spector_on_element_picked(payload); }
          catch {
            showToast('Spector could not collect this selection. Pick it again.', true);
            resolve({ status: 'cancelled' });
            return;
          }
          const label = payload.pins
            ? 'Queued ' + payload.pins.length + ' pins to Spector AI!'
            : payload.role === 'reference'
              ? 'Pinned Reference (B) — switch to Target tab & Alt+P!'
              : payload.role === 'target'
                ? 'Pinned Target (A) — synced to Spector AI!'
                : 'Captured & synced to Spector AI!';
          showToast(label, false);
        }
        resolve(payload);
      }

      function submitQueue() {
        if (state.queuedPins.length === 0) {
          cleanup();
          resolve({ status: 'cancelled' });
          return;
        }
        const batch = state.queuedPins.slice();
        cleanup();
        emitPayload({ status: 'selected', pins: batch });
      }

      function handleCapturedItem(item) {
        if (state.role === 'pin') {
          if (state.queuedPins.length >= ${TOKEN_BUDGETS.MAX_PIN_QUEUE}) {
            showToast('Queue is full. Send these pins before adding more.', true);
            return;
          }
          state.queuedPins.push(item);
          addPinMarker(item.rect, '#' + state.queuedPins.length);
          noteInput.value = '';
          syncUi();
          showToast('Pinned #' + state.queuedPins.length + ' (click more or press Enter / Send)', false);
          return;
        }
        cleanup();
        emitPayload(item);
      }

      function renderHoverHighlight(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        highlightBox.style.display = 'block';
        highlightBox.style.left = rect.left + 'px';
        highlightBox.style.top = rect.top + 'px';
        highlightBox.style.width = rect.width + 'px';
        highlightBox.style.height = rect.height + 'px';

        badge.style.display = 'block';
        const badgeTop = rect.top > 30 ? rect.top - 24 : rect.bottom + 6;
        badge.style.left = Math.max(10, rect.left) + 'px';
        badge.style.top = Math.max(10, badgeTop) + 'px';

        if (el !== state.hoveredTarget) {
          state.hoveredTarget = el;
          const idStr = el.id ? '#' + el.id : '';
          const classStr = el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
            : '';
          const comp = resolveComponentHint(el);
          const compPrefix = comp && comp.componentName ? '[' + comp.componentName + '] ' : '';
          badge.textContent = compPrefix + '<' + el.tagName.toLowerCase() + idStr + classStr + '> (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
        }
      }

      roleDefs.forEach((r) => {
        const btn = createPillButton(r.label, r.tip);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          state.role = r.id;
          syncUi();
        }, { signal: listenerController.signal });
        roleButtons[r.id] = btn;
        roleGroup.appendChild(btn);
      });

      modeBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        state.mode = state.mode === 'element' ? 'region' : 'element';
        highlightBox.style.display = 'none';
        badge.style.display = 'none';
        syncUi();
      }, { signal: listenerController.signal });

      noteInput.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') {
          noteInput.blur();
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          noteInput.blur();
          if (state.role === 'pin' && state.queuedPins.length > 0 && !noteInput.value.trim()) {
            submitQueue();
          }
        }
      }, { signal: listenerController.signal });

      doneBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        submitQueue();
      }, { signal: listenerController.signal });

      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        cleanup();
        resolve({ status: 'cancelled' });
      }, { signal: listenerController.signal });

      toolbar.appendChild(dot);
      toolbar.appendChild(titleLabel);
      toolbar.appendChild(roleGroup);
      toolbar.appendChild(modeBtn);
      toolbar.appendChild(noteInput);
      toolbar.appendChild(doneBtn);
      toolbar.appendChild(cancelBtn);

      document.body.appendChild(toolbar);
      document.body.appendChild(highlightBox);
      document.body.appendChild(marqueeBox);
      document.body.appendChild(badge);
      syncUi();

      function onMouseDown(ev) {
        if (state.mode !== 'region' || isOverlayEl(ev.target)) return;
        ev.preventDefault();
        ev.stopPropagation();
        state.isDragging = true;
        state.dragStart = { x: ev.clientX, y: ev.clientY };
        marqueeBox.style.display = 'block';
        marqueeBox.style.left = state.dragStart.x + 'px';
        marqueeBox.style.top = state.dragStart.y + 'px';
        marqueeBox.style.width = '0px';
        marqueeBox.style.height = '0px';
      }

      function onMouseMove(ev) {
        if (state.mode === 'region') {
          if (!state.isDragging || !state.dragStart) return;
          marqueeBox.style.left = Math.min(state.dragStart.x, ev.clientX) + 'px';
          marqueeBox.style.top = Math.min(state.dragStart.y, ev.clientY) + 'px';
          marqueeBox.style.width = Math.abs(ev.clientX - state.dragStart.x) + 'px';
          marqueeBox.style.height = Math.abs(ev.clientY - state.dragStart.y) + 'px';
          return;
        }

        // Coalesce high-frequency pointer hit-testing and fiber lookups to one update per animation frame.
        pendingPoint = { x: ev.clientX, y: ev.clientY };
        if (hoverRafId) return;
        hoverRafId = requestAnimationFrame(() => {
          hoverRafId = 0;
          if (!pendingPoint || state.mode !== 'element') return;
          const el = resolveElementAt(pendingPoint.x, pendingPoint.y);
          if (el) renderHoverHighlight(el);
        });
      }

      function onMouseUp(ev) {
        if (state.mode !== 'region' || !state.isDragging || !state.dragStart) return;
        ev.preventDefault();
        ev.stopPropagation();
        state.isDragging = false;
        marqueeBox.style.display = 'none';

        const rect = {
          x: Math.round(Math.min(state.dragStart.x, ev.clientX)),
          y: Math.round(Math.min(state.dragStart.y, ev.clientY)),
          width: Math.round(Math.abs(ev.clientX - state.dragStart.x)),
          height: Math.round(Math.abs(ev.clientY - state.dragStart.y))
        };
        state.dragStart = null;
        if (rect.width < 8 || rect.height < 8) return;
        handleCapturedItem(buildRegionPayload(rect));
      }

      function onClick(ev) {
        if (isOverlayEl(ev.target)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        if (state.mode === 'region') return;

        // Resolve synchronously at click coordinates so fast hover+click never races rAF throttling.
        const target = resolveElementAt(ev.clientX, ev.clientY) || state.hoveredTarget;
        if (!target) {
          cleanup();
          resolve({ status: 'cancelled' });
          return;
        }
        handleCapturedItem(buildElementPayload(target));
      }

      function onKeyDown(ev) {
        if (document.activeElement === noteInput) return;
        const hasModifier = ev.ctrlKey || ev.metaKey || ev.altKey;
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          cleanup();
          resolve({ status: 'cancelled' });
        } else if (!hasModifier && (ev.key === 'n' || ev.key === 'N')) {
          ev.preventDefault();
          noteInput.focus();
        } else if (!hasModifier && (ev.key === 'r' || ev.key === 'R')) {
          ev.preventDefault();
          state.mode = state.mode === 'element' ? 'region' : 'element';
          highlightBox.style.display = 'none';
          badge.style.display = 'none';
          syncUi();
        } else if (!hasModifier && ev.key === 'Enter' && state.role === 'pin' && state.queuedPins.length > 0) {
          ev.preventDefault();
          submitQueue();
        }
      }

      const captureOpts = { capture: true, signal: listenerController.signal };
      window.addEventListener('mousemove', onMouseMove, captureOpts);
      window.addEventListener('mousedown', onMouseDown, captureOpts);
      window.addEventListener('mouseup', onMouseUp, captureOpts);
      window.addEventListener('click', onClick, captureOpts);
      window.addEventListener('keydown', onKeyDown, captureOpts);

      if (timeoutMs > 0) {
        timerId = setTimeout(() => {
          cleanup();
          resolve({ status: 'timeout' });
        }, timeoutMs);
      }
    });
  }

  window.__spectorOverlay = {
    __version: 4,
    start: startOverlay
  };
})();
`;

export const HOTKEY_BINDING_SCRIPT = `
(() => {
  ${OVERLAY_ENGINE_SCRIPT}
  if (window.__spector_hotkey_registered) return;
  window.__spector_hotkey_registered = true;

  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__spectorOverlay && typeof window.__spectorOverlay.start === 'function') {
        window.__spectorOverlay.start({ source: 'hotkey', includeStyles: true });
      }
    }
  }, true);
})();
`;
