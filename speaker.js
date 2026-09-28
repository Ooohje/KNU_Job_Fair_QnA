// ============================================================================
//  강연자 화면 (admin/index.html)
//  - 미답변이 위, 답변완료는 아래 구역으로 (FLIP 애니메이션으로 실제로 내려간다)
//  - 실시간 구독 + 글자 크기 조절
// ============================================================================
(function () {
  'use strict';

  var el = QnaUI.el, icon = QnaUI.icon, toast = QnaUI.toast, timeAgo = QnaUI.timeAgo, flip = QnaUI.flip;
  var $ = function (id) { return document.getElementById(id); };

  var lock = $('lock');
  var app = $('app');
  var lockForm = $('lock-form');
  var pc = $('pc');
  var pcError = $('pc-error');
  var pcErrorMsg = $('pc-error-msg');
  var lockSubmit = $('lock-submit');
  var pendingList = $('pending-list');
  var answeredList = $('answered-list');
  var divider = $('divider');
  var dividerLabel = $('divider-label');
  var allClear = $('all-clear');
  var emptyBox = $('empty');
  var pendingNum = $('pending-num');
  var totalNum = $('total-num');
  var live = $('live');
  var liveLabel = $('live-label');
  var refreshBtn = $('refresh');

  var items = [];            // 서버 상태
  var nodes = new Map();     // id -> <li> (FLIP 을 위해 노드를 재사용한다)
  var numbers = new Map();   // id -> 'Q3'
  var seen = null;           // 새 질문 강조용
  var subscription = null;

  function configReady() {
    var key = (window.QNA_CONFIG || {}).SUPABASE_ANON_KEY || '';
    return key.length > 40 && key.indexOf('여기에') === -1;
  }

  // ── 글자 크기 --------------------------------------------------------------
  var SCALES = [0.9, 1, 1.15, 1.3, 1.5];
  var scaleIdx = 1;

  function applyScale() {
    document.documentElement.style.setProperty('--reader-scale', String(SCALES[scaleIdx]));
    $('font-out').value = Math.round(SCALES[scaleIdx] * 100) + '%';
    $('font-down').disabled = scaleIdx === 0;
    $('font-up').disabled = scaleIdx === SCALES.length - 1;
    try { localStorage.setItem('qna_reader_scale', String(scaleIdx)); } catch (e) {}
  }

  try {
    var saved = parseInt(localStorage.getItem('qna_reader_scale'), 10);
    if (saved >= 0 && saved < SCALES.length) scaleIdx = saved;
  } catch (e) {}

  $('font-down').addEventListener('click', function () {
    if (scaleIdx > 0) { scaleIdx--; applyScale(); }
  });
  $('font-up').addEventListener('click', function () {
    if (scaleIdx < SCALES.length - 1) { scaleIdx++; applyScale(); }
  });

  // ── 카드 ------------------------------------------------------------------
  function buildCard(q) {
    var li = el('li', 's-card');
    li.dataset.id = q.id;
    return li;
  }

  function fillCard(li, q) {
    li.textContent = '';
    li.classList.toggle('is-answered', q.answered);

    var meta = el('div', 's-card-meta');
    meta.appendChild(el('span', 's-card-no', numbers.get(q.id) || 'Q'));
    var dot = el('span', null, '·');
    dot.setAttribute('aria-hidden', 'true');
    meta.appendChild(dot);
    meta.appendChild(el('span', null, timeAgo(q.answered ? (q.answered_at || q.created_at) : q.created_at)));

    if (q.answered) {
      var wrap = el('span');
      wrap.style.marginLeft = 'auto';
      wrap.appendChild(el('span', 'badge badge-done', '답변완료'));
      meta.appendChild(wrap);
    }
    li.appendChild(meta);
    li.appendChild(el('p', 's-card-body', q.body));

    if (q.answered) {
      var foot = el('div', 's-card-foot');
      var undo = el('button', 'btn btn-ghost');
      undo.type = 'button';
      undo.setAttribute('aria-label', (numbers.get(q.id) || '이 질문') + ' 미답변으로 되돌리기');
      undo.appendChild(icon('undo', 'icon-sm'));
      undo.appendChild(el('span', null, '되돌리기'));
      undo.addEventListener('click', function () { mark(q.id, false); });
      foot.appendChild(undo);
      li.appendChild(foot);
    } else {
      var done = el('button', 'btn btn-primary btn-answer');
      done.type = 'button';
      done.appendChild(icon('check'));
      done.appendChild(el('span', null, '답변 완료'));
      done.addEventListener('click', function () { mark(q.id, true); });
      li.appendChild(done);
    }
  }

  // ── 렌더 ------------------------------------------------------------------
  function assignNumbers() {
    numbers.clear();
    items.slice()
      .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
      .forEach(function (q, i) { numbers.set(q.id, 'Q' + (i + 1)); });
  }

  function render(animate) {
    assignNumbers();

    var play = animate ? flip(Array.from(nodes.values())) : null;
    var ordered = QnaDB.sortForSpeaker(items);
    var alive = new Set();
    var fresh = [];

    ordered.forEach(function (q) {
      alive.add(q.id);
      var li = nodes.get(q.id);
      if (!li) {
        li = buildCard(q);
        nodes.set(q.id, li);
        if (seen && !seen.has(q.id)) fresh.push(li);
      }
      fillCard(li, q);
      var target = q.answered ? answeredList : pendingList;
      target.appendChild(li); // 이미 있는 노드도 이 호출로 제자리로 이동한다
    });

    nodes.forEach(function (li, id) {
      if (!alive.has(id)) {
        if (li.parentNode) li.parentNode.removeChild(li);
        nodes.delete(id);
      }
    });

    var pending = items.filter(function (q) { return !q.answered; }).length;
    var answered = items.length - pending;

    if (pendingNum.textContent !== String(pending) && pending > Number(pendingNum.textContent || 0)) {
      pendingNum.classList.remove('is-bump');
      void pendingNum.offsetWidth;
      pendingNum.classList.add('is-bump');
    }
    pendingNum.textContent = String(pending);
    totalNum.textContent = '/ 전체 ' + items.length;

    divider.hidden = answered === 0;
    dividerLabel.textContent = '답변 완료 (' + answered + ')';
    allClear.hidden = !(pending === 0 && answered > 0);
    emptyBox.hidden = items.length > 0;

    if (play) play();
    fresh.forEach(function (li) {
      li.classList.add('is-new');
      setTimeout(function () { li.classList.remove('is-new'); }, 1000);
    });
    seen = new Set(items.map(function (q) { return q.id; }));
  }

  // ── 답변 완료 / 되돌리기 ----------------------------------------------------
  var busy = new Set();

  async function mark(id, answered) {
    if (busy.has(id)) return;
    busy.add(id);

    var before = items.map(function (q) { return Object.assign({}, q); });

    // 낙관적 업데이트: 누른 즉시 카드가 움직인다
    items = items.map(function (q) {
      if (q.id !== id) return q;
      return Object.assign({}, q, {
        answered: answered,
        answered_at: answered ? (q.answered_at || new Date().toISOString()) : null,
      });
    });
    render(true);

    try {
      await QnaDB.setAnswered(id, answered);
      if (answered) {
        toast((numbers.get(id) || '질문') + ' 답변 완료', {
          actionLabel: '되돌리기',
          onAction: function () { mark(id, false); },
        });
      }
    } catch (err) {
      items = before;
      render(true);
      toast(err.message, { error: true });
      if (err.code === 'unauthorized') showLock();
    } finally {
      busy.delete(id);
    }
  }

  // ── 불러오기 --------------------------------------------------------------
  var loadTimer = null;

  async function load(showSpinner) {
    if (showSpinner) refreshBtn.classList.add('is-spinning');
    try {
      items = await QnaDB.getQuestions();
      render(true);
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      if (showSpinner) setTimeout(function () { refreshBtn.classList.remove('is-spinning'); }, 400);
    }
  }

  function scheduleLoad() {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () { load(false); }, 350);
  }

  refreshBtn.addEventListener('click', function () { load(true); });

  // ── 잠금 / 입장 -----------------------------------------------------------
  function showLock() {
    app.hidden = true;
    lock.hidden = false;
    if (subscription) { subscription.unsubscribe(); subscription = null; }
    setTimeout(function () { pc.focus(); }, 50);
  }

  function enter() {
    lock.hidden = true;
    app.hidden = false;
    applyScale();
    seen = null;
    load(false);
    subscription = QnaDB.subscribe(scheduleLoad, function (status) {
      var online = status === 'connected';
      live.dataset.state = online ? 'live' : 'offline';
      liveLabel.textContent = online ? '실시간' : '연결 중';
    });
  }

  $('pc-toggle').addEventListener('click', function () {
    var show = pc.type === 'password';
    pc.type = show ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(show));
    this.setAttribute('aria-label', show ? '비밀 코드 숨기기' : '비밀 코드 보기');
    pc.focus();
  });

  lockForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!configReady()) {
      pcErrorMsg.textContent = '서버 설정이 아직 끝나지 않았습니다. (config.js 의 anon key 확인)';
      pcError.hidden = false;
      return;
    }

    var code = pc.value;
    if (!code) { pc.focus(); return; }

    pcError.hidden = true;
    pc.removeAttribute('aria-invalid');
    lockSubmit.disabled = true;
    lockSubmit.setAttribute('aria-busy', 'true');
    lockSubmit.textContent = '';
    lockSubmit.appendChild(el('span', 'spinner'));
    lockSubmit.appendChild(el('span', null, '확인 중…'));

    try {
      await QnaDB.login(code);
      pc.value = '';
      enter();
    } catch (err) {
      pcErrorMsg.textContent = err.message;
      pcError.hidden = false;
      pc.setAttribute('aria-invalid', 'true');
      var card = lock.querySelector('.lock-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      pc.focus();
      pc.select();
    } finally {
      lockSubmit.removeAttribute('aria-busy');
      lockSubmit.disabled = false;
      lockSubmit.textContent = '입장하기';
    }
  });

  // ── 전체 초기화 (리허설/테스트 데이터 비우기) ------------------------------
  var resetSheet = $('reset-sheet');

  $('reset').addEventListener('click', function () {
    if (!items.length) {
      toast('삭제할 질문이 없습니다');
      return;
    }
    $('reset-summary').textContent =
      '질문 ' + items.length + '개 (답변 완료 ' +
      items.filter(function (q) { return q.answered; }).length + '개 포함)';
    if (typeof resetSheet.showModal === 'function') resetSheet.showModal();
    else if (window.confirm('질문을 모두 삭제할까요?')) doReset();
  });

  $('reset-cancel').addEventListener('click', function () { resetSheet.close(); });

  $('reset-confirm').addEventListener('click', function () {
    resetSheet.close();
    doReset();
  });

  async function doReset() {
    try {
      var n = await QnaDB.resetAll();
      items = [];
      render(true);
      toast('질문 ' + n + '개를 삭제했습니다');
    } catch (err) {
      toast(err.message, { error: true });
      if (err.code === 'unauthorized') showLock();
      load(false);
    }
  }

  $('logout').addEventListener('click', function () {
    QnaDB.logout();
    items = [];
    nodes.forEach(function (li) { if (li.parentNode) li.parentNode.removeChild(li); });
    nodes.clear();
    showLock();
    toast('강연자 모드에서 나왔습니다');
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !app.hidden) load(false);
  });

  // 상대 시간 갱신
  setInterval(function () { if (!app.hidden && items.length) render(false); }, 30000);

  // ── 시작 ------------------------------------------------------------------
  (async function start() {
    if (!configReady()) { showLock(); return; }
    if (await QnaDB.checkSaved()) enter();
    else showLock();
  })();
})();
