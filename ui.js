// ============================================================================
//  공용 UI 헬퍼 (index / speaker 공용)
//  사용자 입력은 항상 textContent 로만 넣는다. (innerHTML 금지 → XSS 차단)
// ============================================================================
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // 아이콘: styles.css 의 .icon / .icon-sm 크기를 따른다
  var ICONS = {
    check:        ['M5 12.5l4.5 4.5L19 7.5'],
    'check-circle': ['M8 12.3l2.8 2.7L16 9.5', 'circle:12,12,9'],
    alert:        ['circle:12,12,9', 'M12 7.5v5.5M12 16.5v.01'],
    trash:        ['M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3'],
    undo:         ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 010 11H11'],
    refresh:      ['M20 11a8 8 0 10-2.3 5.7', 'M20 4v7h-7'],
    chat:         ['M20 12a8 8 0 01-11.6 7.1L4 20l.9-4.4A8 8 0 1120 12z', 'M8.5 11h.01M12 11h.01M15.5 11h.01'],
    plus:         ['M12 5v14M5 12h14'],
    eye:          ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'circle:12,12,3'],
    'eye-off':    ['M4 4l16 16', 'M9.9 5.9A9.9 9.9 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a19 19 0 01-3 4M6.4 7.7A19 19 0 002.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5'],
    lock:         ['rect:5,10.5,14,10,2.5', 'M8 10.5V7.5a4 4 0 018 0v3'],
    logout:       ['M15 7V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2h7a2 2 0 002-2v-2', 'M18 8l4 4-4 4M22 12H10'],
  };

  function svgIcon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', cls || 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach(function (d) {
      var node;
      if (d.indexOf('circle:') === 0) {
        var c = d.slice(7).split(',');
        node = document.createElementNS(SVG_NS, 'circle');
        node.setAttribute('cx', c[0]); node.setAttribute('cy', c[1]); node.setAttribute('r', c[2]);
      } else if (d.indexOf('rect:') === 0) {
        var r = d.slice(5).split(',');
        node = document.createElementNS(SVG_NS, 'rect');
        node.setAttribute('x', r[0]); node.setAttribute('y', r[1]);
        node.setAttribute('width', r[2]); node.setAttribute('height', r[3]);
        node.setAttribute('rx', r[4]);
      } else {
        node = document.createElementNS(SVG_NS, 'path');
        node.setAttribute('d', d);
      }
      svg.appendChild(node);
    });
    return svg;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // "방금 전" / "12분 전" / "3시간 전" / "9월 28일"
  function timeAgo(iso) {
    var then = new Date(iso).getTime();
    if (!then) return '';
    var sec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (sec < 50) return '방금 전';
    var min = Math.round(sec / 60);
    if (min < 60) return min + '분 전';
    var hour = Math.round(min / 60);
    if (hour < 24) return hour + '시간 전';
    var d = new Date(then);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  // ── 토스트 ────────────────────────────────────────────────────────────────
  function toast(msg, opts) {
    opts = opts || {};
    var region = document.getElementById('toasts');
    if (!region) return null;

    while (region.children.length >= 2) region.removeChild(region.firstChild);

    var box = el('div', 'toast');
    if (opts.error) box.classList.add('is-error');
    box.setAttribute('role', 'status');
    box.appendChild(svgIcon(opts.error ? 'alert' : 'check-circle'));
    box.appendChild(el('span', 'toast-msg', msg));

    if (opts.actionLabel && opts.onAction) {
      var action = el('button', 'toast-action', opts.actionLabel);
      action.type = 'button';
      action.addEventListener('click', function () {
        close();
        opts.onAction();
      });
      box.appendChild(action);
    }

    region.appendChild(box);

    var timer = setTimeout(close, opts.duration || (opts.actionLabel ? 6000 : 3000));
    function close() {
      clearTimeout(timer);
      if (!box.parentNode) return;
      box.classList.add('is-leaving');
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 260);
    }
    return close;
  }

  // ── FLIP: 리스트가 재배치될 때 카드가 실제로 움직이는 애니메이션 ──────────
  // before() 로 위치를 기록하고, DOM 을 바꾼 뒤 play() 를 호출한다.
  function flip(nodes) {
    var first = new Map();
    nodes.forEach(function (n) { first.set(n, n.getBoundingClientRect()); });

    return function play() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      first.forEach(function (box, node) {
        if (!node.isConnected) return;
        var now = node.getBoundingClientRect();
        var dx = box.left - now.left;
        var dy = box.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        node.animate(
          [
            { transform: 'translate(' + dx + 'px,' + dy + 'px)' },
            { transform: 'none' },
          ],
          { duration: 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
        );
      });
    };
  }

  window.QnaUI = {
    el: el,
    icon: svgIcon,
    timeAgo: timeAgo,
    toast: toast,
    flip: flip,
  };
})();
