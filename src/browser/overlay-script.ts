import { IN_BROWSER_CSS_SELECTOR_FN } from '../utils/selector.js';
import { BLUEPRINT_LIMITS, IN_BROWSER_BLUEPRINT_EXTRACTOR_FN } from '../analyzers/design-blueprint.js';
import { TOKEN_BUDGETS } from '../constants.js';

export const OVERLAY_ENGINE_SCRIPT = `
(() => {
  if (window.__spectorOverlay && window.__spectorOverlay.__version === 5) return;

  ${IN_BROWSER_CSS_SELECTOR_FN}
  ${IN_BROWSER_BLUEPRINT_EXTRACTOR_FN}

  const UI_PREFIX = 'data-spector-picker';

  const TOKENS = {
    fontUi: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    fontMono: 'ui-monospace,SFMono-Regular,Menlo,monospace',
    toolbarBg: 'rgba(15,23,42,0.95)',
    inputBg: 'rgba(30,41,59,0.95)',
    text: '#f8fafc',
    muted: '#94a3b8',
    accent: '#0284c7',
    accentBorder: '#38bdf8',
    accentSoft: 'rgba(14,165,233,0.14)',
    warning: '#b45309',
    warningBorder: '#f59e0b',
    warningSoft: 'rgba(245,158,11,0.15)',
    success: '#047857',
    successBright: '#10b981',
    successSoft: 'rgba(16,185,129,0.10)',
    dangerBorder: 'rgba(248,113,113,0.45)',
    dangerText: '#fca5a5',
    borderSubtle: 'rgba(148,163,184,0.32)',
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
      'padding:10px 16px',
      'border-radius:10px',
      'font-family:' + TOKENS.fontUi,
      'font-size:13px',
      'font-weight:500',
      'box-shadow:0 10px 25px rgba(0,0,0,0.3)',
      'pointer-events:none'
    ].join(';');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function createBtn(label, titleText) {
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
    highlightBox.style.cssText = 'position:fixed;pointer-events:none;z-index:' + TOKENS.zHighlight + ';border:2px solid ' + TOKENS.accentBorder + ';background:' + TOKENS.accentSoft + ';border-radius:4px;display:none;box-sizing:border-box;';

    const marqueeBox = document.createElement('div');
    marqueeBox.setAttribute(UI_PREFIX, 'marquee');
    marqueeBox.setAttribute('aria-hidden', 'true');
    marqueeBox.style.cssText = 'position:fixed;pointer-events:none;z-index:' + TOKENS.zOverlay + ';border:2px dashed ' + TOKENS.warningBorder + ';background:' + TOKENS.warningSoft + ';border-radius:4px;display:none;box-sizing:border-box;';

    const badge = document.createElement('div');
    badge.setAttribute(UI_PREFIX, 'badge');
    badge.setAttribute('aria-hidden', 'true');
    badge.style.cssText = 'position:fixed;pointer-events:none;z-index:' + TOKENS.zOverlay + ';background:' + TOKENS.toolbarBg + ';color:#ffffff;font-family:' + TOKENS.fontMono + ';font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;border:1px solid ' + TOKENS.accentBorder + ';display:none;white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,0.28);';

    return { highlightBox, marqueeBox, badge };
  }

  function formatElementLabel(el, rect) {
    const idStr = el.id ? '#' + el.id : '';
    const classStr = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    return '<' + el.tagName.toLowerCase() + idStr + classStr + '> (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
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
        defaultRole: opts.role || 'single',
        hoveredTarget: null,
        childStack: [],
        pointerDown: null,
        isDragging: false,
        pendingSelection: null,
        queuedPins: []
      };

      const markerEls = [];
      const listenerController = new AbortController();
      let timerId = null;
      let hoverRafId = 0;
      let pendingPoint = null;
      let popoverEl = null;
      let suppressNextClick = false;

      const { highlightBox, marqueeBox, badge } = createOverlayBoxes();

      // Compact single-line HUD pill
      const toolbar = document.createElement('div');
      toolbar.setAttribute(UI_PREFIX, 'toolbar');
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Spector visual picker');
      toolbar.style.cssText = [
        'position:fixed',
        'top:14px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:' + TOKENS.zControl,
        'background:' + TOKENS.toolbarBg,
        'color:' + TOKENS.text,
        'padding:7px 12px',
        'border-radius:999px',
        'font-family:' + TOKENS.fontUi,
        'font-size:12px',
        'box-shadow:0 10px 28px rgba(0,0,0,0.36),0 0 0 1px rgba(255,255,255,0.12)',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'max-width:92vw',
        'backdrop-filter:blur(10px)',
        'user-select:none'
      ].join(';');

      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + TOKENS.accentBorder + ';box-shadow:0 0 8px ' + TOKENS.accentBorder + ';flex-shrink:0;';

      const hintText = document.createElement('span');
      hintText.style.cssText = 'color:' + TOKENS.muted + ';font-size:11.5px;white-space:nowrap;';
      hintText.textContent = 'Click element or drag area · ↑↓ parent/child';

      const sendQueueBtn = createBtn('', 'Send all queued pins');
      sendQueueBtn.style.cssText = 'display:none;border:1px solid ' + TOKENS.successBright + ';background:' + TOKENS.success + ';color:#fff;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;';

      const cancelBtn = createBtn('Esc', 'Cancel picking (Escape)');
      cancelBtn.style.cssText = 'border:1px solid ' + TOKENS.dangerBorder + ';background:transparent;color:' + TOKENS.dangerText + ';padding:2px 8px;border-radius:999px;font-size:11px;cursor:pointer;';

      toolbar.appendChild(dot);
      toolbar.appendChild(hintText);
      toolbar.appendChild(sendQueueBtn);
      toolbar.appendChild(cancelBtn);

      function syncHud() {
        if (state.queuedPins.length > 0) {
          sendQueueBtn.style.display = 'inline-block';
          sendQueueBtn.textContent = 'Send (' + state.queuedPins.length + ')';
        } else {
          sendQueueBtn.style.display = 'none';
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

      function closePopover() {
        if (popoverEl) {
          popoverEl.remove();
          popoverEl = null;
        }
        state.pendingSelection = null;
      }

      function cleanup() {
        if (timerId) clearTimeout(timerId);
        if (hoverRafId) cancelAnimationFrame(hoverRafId);
        listenerController.abort();
        closePopover();
        toolbar.remove();
        highlightBox.remove();
        marqueeBox.remove();
        badge.remove();
        markerEls.forEach((m) => m.remove());
      }

      function resolveElementAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || isOverlayEl(el)) return null;
        return el;
      }

      function buildElementPayload(target, role, note) {
        const selector = getCssSelector(target);
        const tagName = target.tagName.toLowerCase();
        const blueprint = extractDesignBlueprint(target, includeStyles, maxSubtreeElements, maxInlineSvgBytes);
        return {
          status: 'selected',
          role: role || 'single',
          pinMode: 'element',
          ...(note ? { note } : {}),
          selector,
          tagName,
          rect: blueprint.rect,
          computedStyles: blueprint.computedStyles,
          subtreeSummary: blueprint.subtreeSummary,
          assets: blueprint.assets
        };
      }

      function buildRegionPayload(regionRect, role, note) {
        const cx = regionRect.x + regionRect.width / 2;
        const cy = regionRect.y + regionRect.height / 2;
        const target = resolveElementAt(cx, cy) || document.body;
        const selector = target ? getCssSelector(target) : 'body';
        const blueprint = target ? extractDesignBlueprint(target, includeStyles, maxSubtreeElements, maxInlineSvgBytes) : {};
        return {
          status: 'selected',
          role: role || 'single',
          pinMode: 'region',
          ...(note ? { note } : {}),
          selector,
          tagName: 'region',
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
            ? 'Sent ' + payload.pins.length + ' pins to Spector AI!'
            : payload.role === 'reference'
              ? 'Pinned Reference (B) — switch to Target tab & press Alt+P!'
              : payload.role === 'target'
                ? 'Pinned Target (A) — ready for A/B compare in Spector AI!'
                : 'Captured & synced to Spector AI!';
          showToast(label, false);
        }
        resolve(payload);
      }

      function submitQueue(extraItem) {
        const batch = state.queuedPins.slice();
        if (extraItem) batch.push(extraItem);
        if (batch.length === 0) {
          cleanup();
          resolve({ status: 'cancelled' });
          return;
        }
        cleanup();
        emitPayload(batch.length === 1 ? batch[0] : { status: 'selected', pins: batch });
      }

      function renderHoverHighlight(el, locked) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        highlightBox.style.display = 'block';
        highlightBox.style.left = rect.left + 'px';
        highlightBox.style.top = rect.top + 'px';
        highlightBox.style.width = rect.width + 'px';
        highlightBox.style.height = rect.height + 'px';
        highlightBox.style.borderColor = locked ? TOKENS.successBright : TOKENS.accentBorder;
        highlightBox.style.background = locked ? TOKENS.successSoft : TOKENS.accentSoft;

        badge.style.display = 'block';
        const badgeTop = rect.top > 30 ? rect.top - 26 : rect.bottom + 6;
        badge.style.left = Math.max(10, Math.min(window.innerWidth - 260, rect.left)) + 'px';
        badge.style.top = Math.max(10, badgeTop) + 'px';
        badge.textContent = formatElementLabel(el, rect);
      }

      function openAnnotationPopover(selection) {
        closePopover();
        state.pendingSelection = selection;
        badge.style.display = 'none';

        if (selection.kind === 'element' && selection.target) {
          renderHoverHighlight(selection.target, true);
          badge.style.display = 'none';
        } else if (selection.kind === 'region') {
          highlightBox.style.display = 'block';
          highlightBox.style.left = selection.rect.x + 'px';
          highlightBox.style.top = selection.rect.y + 'px';
          highlightBox.style.width = selection.rect.width + 'px';
          highlightBox.style.height = selection.rect.height + 'px';
          highlightBox.style.borderColor = TOKENS.warningBorder;
          highlightBox.style.background = TOKENS.warningSoft;
        }

        let selectedRole = state.defaultRole === 'pin' ? 'single' : state.defaultRole;

        const popover = document.createElement('div');
        popover.setAttribute(UI_PREFIX, 'popover');
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Annotate selection for AI');

        const popWidth = 320;
        const left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, selection.rect.x));
        const spaceBelow = window.innerHeight - (selection.rect.y + selection.rect.height);
        const top = spaceBelow >= 120
          ? Math.min(window.innerHeight - 118, selection.rect.y + selection.rect.height + 8)
          : Math.max(58, selection.rect.y - 114);

        popover.style.cssText = [
          'position:fixed',
          'left:' + left + 'px',
          'top:' + top + 'px',
          'width:' + popWidth + 'px',
          'z-index:' + TOKENS.zControl,
          'background:' + TOKENS.toolbarBg,
          'color:' + TOKENS.text,
          'padding:10px',
          'border-radius:12px',
          'font-family:' + TOKENS.fontUi,
          'font-size:12px',
          'box-shadow:0 16px 36px rgba(0,0,0,0.45),0 0 0 1px rgba(255,255,255,0.14)',
          'backdrop-filter:blur(12px)',
          'display:flex',
          'flex-direction:column',
          'gap:8px',
          'box-sizing:border-box'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';
        const summary = document.createElement('span');
        summary.style.cssText = 'font-family:' + TOKENS.fontMono + ';font-size:11px;color:' + TOKENS.accentBorder + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        summary.textContent = selection.label;
        const dismissBtn = createBtn('×', 'Pick a different element (Esc)');
        dismissBtn.style.cssText = 'border:none;background:transparent;color:' + TOKENS.muted + ';font-size:15px;line-height:1;cursor:pointer;padding:0 4px;';
        header.appendChild(summary);
        header.appendChild(dismissBtn);

        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.maxLength = 240;
        noteInput.placeholder = 'Note for AI (optional) — Enter to send';
        noteInput.setAttribute('aria-label', 'Note for AI');
        noteInput.style.cssText = 'width:100%;box-sizing:border-box;background:' + TOKENS.inputBg + ';border:1px solid ' + TOKENS.borderSubtle + ';color:' + TOKENS.text + ';border-radius:8px;padding:7px 10px;font-size:12px;outline:none;';

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';

        const roleCycle = [
          { id: 'single', label: 'Pin' },
          { id: 'target', label: 'Target A' },
          { id: 'reference', label: 'Ref B' }
        ];
        const roleBtn = createBtn('', 'Click to cycle Pin / Target A / Ref B for A/B compare');
        function syncRoleBtn() {
          const entry = roleCycle.find((r) => r.id === selectedRole) || roleCycle[0];
          roleBtn.textContent = entry.label;
          roleBtn.style.cssText = selectedRole === 'single'
            ? 'border:1px solid ' + TOKENS.borderSubtle + ';background:transparent;color:' + TOKENS.muted + ';padding:4px 8px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;'
            : 'border:1px solid ' + TOKENS.warningBorder + ';background:' + TOKENS.warning + ';color:#fff;padding:4px 8px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;';
        }
        syncRoleBtn();

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;align-items:center;gap:6px;';

        const addMoreBtn = createBtn('+ Pin', 'Add to queue and pick another (Shift+Enter)');
        addMoreBtn.style.cssText = 'border:1px solid ' + TOKENS.borderSubtle + ';background:transparent;color:' + TOKENS.text + ';padding:4px 9px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;';

        const sendBtn = createBtn('Send ↵', 'Send to Spector AI (Enter)');
        sendBtn.style.cssText = 'border:1px solid ' + TOKENS.accentBorder + ';background:' + TOKENS.accent + ';color:#fff;padding:4px 11px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;';

        function buildCurrentPin(roleOverride) {
          const note = noteInput.value.trim() || undefined;
          const role = roleOverride || selectedRole;
          return selection.kind === 'region'
            ? buildRegionPayload(selection.rect, role, note)
            : buildElementPayload(selection.target, role, note);
        }

        function queueCurrentAndContinue() {
          if (state.queuedPins.length >= ${TOKEN_BUDGETS.MAX_PIN_QUEUE}) {
            showToast('Queue is full. Click Send to finish.', true);
            return;
          }
          const item = buildCurrentPin(selectedRole === 'single' ? 'pin' : selectedRole);
          state.queuedPins.push(item);
          addPinMarker(item.rect || selection.rect, '#' + state.queuedPins.length);
          closePopover();
          highlightBox.style.display = 'none';
          syncHud();
        }

        function sendNow() {
          const item = buildCurrentPin();
          submitQueue(item);
        }

        roleBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const idx = roleCycle.findIndex((r) => r.id === selectedRole);
          selectedRole = roleCycle[(idx + 1) % roleCycle.length].id;
          syncRoleBtn();
          noteInput.focus();
        });

        addMoreBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          queueCurrentAndContinue();
        });

        sendBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          sendNow();
        });

        dismissBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          closePopover();
          highlightBox.style.display = 'none';
        });

        noteInput.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Escape') {
            ev.preventDefault();
            closePopover();
            highlightBox.style.display = 'none';
          } else if (ev.key === 'Enter' && ev.shiftKey) {
            ev.preventDefault();
            queueCurrentAndContinue();
          } else if (ev.key === 'Enter') {
            ev.preventDefault();
            sendNow();
          }
        });

        actions.appendChild(addMoreBtn);
        actions.appendChild(sendBtn);
        footer.appendChild(roleBtn);
        footer.appendChild(actions);

        popover.appendChild(header);
        popover.appendChild(noteInput);
        popover.appendChild(footer);
        document.body.appendChild(popover);
        popoverEl = popover;
        noteInput.focus();
      }

      sendQueueBtn.addEventListener('click', (ev) => {
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

      document.body.appendChild(toolbar);
      document.body.appendChild(highlightBox);
      document.body.appendChild(marqueeBox);
      document.body.appendChild(badge);
      syncHud();

      function onMouseDown(ev) {
        if (ev.button !== 0 || isOverlayEl(ev.target)) return;
        if (state.pendingSelection) {
          closePopover();
        }
        ev.preventDefault();
        ev.stopPropagation();
        state.pointerDown = { x: ev.clientX, y: ev.clientY };
        state.isDragging = false;
      }

      function onMouseMove(ev) {
        if (state.pointerDown) {
          const dx = Math.abs(ev.clientX - state.pointerDown.x);
          const dy = Math.abs(ev.clientY - state.pointerDown.y);
          if (!state.isDragging && (dx >= 8 || dy >= 8)) {
            state.isDragging = true;
            highlightBox.style.display = 'none';
            badge.style.display = 'none';
            marqueeBox.style.display = 'block';
          }
          if (state.isDragging) {
            marqueeBox.style.left = Math.min(state.pointerDown.x, ev.clientX) + 'px';
            marqueeBox.style.top = Math.min(state.pointerDown.y, ev.clientY) + 'px';
            marqueeBox.style.width = dx + 'px';
            marqueeBox.style.height = dy + 'px';
            return;
          }
        }

        if (state.pendingSelection || isOverlayEl(ev.target)) return;

        pendingPoint = { x: ev.clientX, y: ev.clientY };
        if (hoverRafId) return;
        hoverRafId = requestAnimationFrame(() => {
          hoverRafId = 0;
          if (!pendingPoint || state.isDragging || state.pendingSelection) return;
          const el = resolveElementAt(pendingPoint.x, pendingPoint.y);
          if (el && el !== state.hoveredTarget) {
            state.hoveredTarget = el;
            state.childStack = [];
            renderHoverHighlight(el, false);
          }
        });
      }

      function onMouseUp(ev) {
        if (!state.pointerDown) return;
        const start = state.pointerDown;
        const wasDragging = state.isDragging;
        state.pointerDown = null;
        state.isDragging = false;
        marqueeBox.style.display = 'none';
        suppressNextClick = true;
        setTimeout(() => { suppressNextClick = false; }, 0);

        ev.preventDefault();
        ev.stopPropagation();

        if (wasDragging) {
          const rect = {
            x: Math.round(Math.min(start.x, ev.clientX)),
            y: Math.round(Math.min(start.y, ev.clientY)),
            width: Math.round(Math.abs(ev.clientX - start.x)),
            height: Math.round(Math.abs(ev.clientY - start.y))
          };
          if (rect.width < 8 || rect.height < 8) return;
          openAnnotationPopover({
            kind: 'region',
            rect,
            label: 'Region (' + rect.width + 'x' + rect.height + ')'
          });
          return;
        }

        const target = state.hoveredTarget || resolveElementAt(ev.clientX, ev.clientY);
        if (!target) return;
        const r = target.getBoundingClientRect();
        openAnnotationPopover({
          kind: 'element',
          target,
          rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
          label: formatElementLabel(target, r)
        });
      }

      function onClick(ev) {
        if (isOverlayEl(ev.target)) return;
        if (suppressNextClick || !state.pendingSelection) {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
        }
      }

      function stepTree(direction) {
        if (!state.hoveredTarget || state.pendingSelection) return;
        if (direction === 'up') {
          const parent = state.hoveredTarget.parentElement;
          if (!parent || parent === document.documentElement || isOverlayEl(parent)) return;
          state.childStack.push(state.hoveredTarget);
          state.hoveredTarget = parent;
          renderHoverHighlight(parent, false);
        } else if (direction === 'down') {
          let nextChild = state.childStack.pop();
          if (!nextChild || !nextChild.isConnected) {
            nextChild = Array.from(state.hoveredTarget.children).find((c) => !isOverlayEl(c));
          }
          if (!nextChild) return;
          state.hoveredTarget = nextChild;
          renderHoverHighlight(nextChild, false);
        }
      }

      function onWheel(ev) {
        if (!ev.shiftKey || state.pendingSelection) return;
        ev.preventDefault();
        ev.stopPropagation();
        stepTree(ev.deltaY < 0 ? 'up' : 'down');
      }

      function onKeyDown(ev) {
        if (popoverEl && popoverEl.contains(document.activeElement)) return;
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          if (state.pendingSelection) {
            closePopover();
            highlightBox.style.display = 'none';
            return;
          }
          cleanup();
          resolve({ status: 'cancelled' });
        } else if (ev.key === 'ArrowUp' && !state.pendingSelection) {
          ev.preventDefault();
          stepTree('up');
        } else if (ev.key === 'ArrowDown' && !state.pendingSelection) {
          ev.preventDefault();
          stepTree('down');
        } else if (ev.key === 'Enter' && !state.pendingSelection && state.queuedPins.length > 0) {
          ev.preventDefault();
          submitQueue();
        }
      }

      const captureOpts = { capture: true, signal: listenerController.signal };
      window.addEventListener('mousemove', onMouseMove, captureOpts);
      window.addEventListener('mousedown', onMouseDown, captureOpts);
      window.addEventListener('mouseup', onMouseUp, captureOpts);
      window.addEventListener('click', onClick, captureOpts);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false, signal: listenerController.signal });
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
    __version: 5,
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
