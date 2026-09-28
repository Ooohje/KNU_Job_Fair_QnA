// ============================================================================
//  청중용 화면 (index.html)
// ============================================================================
(function () {
  'use strict';

  var el = QnaUI.el, icon = QnaUI.icon, toast = QnaUI.toast, timeAgo = QnaUI.timeAgo;
  var $ = function (id) { return document.getElementById(id); };

  var compose = $('compose');
  var textarea = $('q-body');
  var counter = $('counter');
  var submitBtn = $('submit-btn');
  var alertBox = $('compose-alert');
  var alertMsg = $('alert-msg');
  var sentCard = $('sent');
  var sentQuote = $('sent-quote');
  var myList = $('my-list');
  var mineEmpty = $('mine-empty');
  var mineNote = $('mine-note');
  var mineCount = $('mine-count');
  var tabAsk = $('tab-ask');
  var tabMine = $('tab-mine');
  var panelAsk = $('panel-ask');
  var panelMine = $('panel-mine');
  var sheet = $('del-sheet');
  var delQuote = $('del-quote');

  var mine = [];
  var pendingDelete = null;

  // ── 설정 확인 --------------------------------------------------------------
  function configReady() {
    var key = (window.QNA_CONFIG || {}).SUPABASE_ANON_KEY || '';
    return key.length > 40 && key.indexOf('여기에') === -1;
  }

  // ── 제목 -------------------------------------------------------------------
  if (window.QNA_CONFIG && QNA_CONFIG.TALK_TITLE) {
    document.title = QNA_CONFIG.TALK_TITLE + ' · 익명 질문';
  }

  // ── 탭 --------------------------------------------------------------------
  function showTab(name) {
    var isAsk = name === 'ask';
    tabAsk.setAttribute('aria-selected', String(isAsk));
    tabMine.setAttribute('aria-selected', String(!isAsk));
    panelAsk.hidden = !isAsk;
    panelMine.hidden = isAsk;
    if (!isAsk) loadMine();
  }

  tabAsk.addEventListener('click', function () { showTab('ask'); });
  tabMine.addEventListener('click', function () { showTab('mine'); });

  [tabAsk, tabMine].forEach(function (tab) {
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var next = tab === tabAsk ? tabMine : tabAsk;
      next.focus();
      showTab(next === tabAsk ? 'ask' : 'mine');
    });
  });

  // ── 작성 ------------------------------------------------------------------
  function syncCounter() {
    var len = textarea.value.length;
    counter.textContent = len + ' / 500';
    counter.classList.toggle('is-near', len >= 450 && len < 500);
    counter.classList.toggle('is-full', len >= 500);
    submitBtn.disabled = textarea.value.trim().length < 2 || submitBtn.getAttribute('aria-busy') === 'true';
  }

  function setBusy(busy) {
    if (busy) {
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.disabled = true;
      submitBtn.textContent = '';
      submitBtn.appendChild(el('span', 'spinner'));
      submitBtn.appendChild(el('span', null, '보내는 중…'));
    } else {
      submitBtn.removeAttribute('aria-busy');
      submitBtn.textContent = '질문 보내기';
      syncCounter();
    }
  }

  function showAlert(msg) {
    alertMsg.textContent = msg;
    alertBox.hidden = false;
    textarea.setAttribute('aria-invalid', 'true');
  }

  function clearAlert() {
    alertBox.hidden = true;
    textarea.removeAttribute('aria-invalid');
  }

  textarea.addEventListener('input', function () {
    clearAlert();
    syncCounter();
  });

  compose.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (submitBtn.disabled) return;
    if (!configReady()) {
      showAlert('서버 설정이 아직 끝나지 않았어요. 강연 진행자에게 알려주세요.');
      return;
    }

    var body = textarea.value.trim();
    clearAlert();
    setBusy(true);
    try {
      var row = await QnaDB.addQuestion(body);
      textarea.value = '';
      setBusy(false);
      sentQuote.textContent = row.body;
      compose.hidden = true;
      sentCard.hidden = false;
      toast('질문이 전달되었습니다');
      loadMine();
    } catch (err) {
      setBusy(false);
      showAlert(err.message);
    }
  });

  $('ask-again').addEventListener('click', function () {
    sentCard.hidden = true;
    compose.hidden = false;
    syncCounter();
    textarea.focus();
  });

  $('goto-mine').addEventListener('click', function () {
    sentCard.hidden = true;
    compose.hidden = false;
    syncCounter();
    showTab('mine');
  });

  $('empty-cta').addEventListener('click', function () { showTab('ask'); });

  // ── 내 질문 ---------------------------------------------------------------
  function questionCard(q) {
    var li = el('li', 'card my-q');
    li.dataset.id = q.id;

    var head = el('div', 'my-q-head');
    var badge = el('span', 'badge ' + (q.answered ? 'badge-done' : 'badge-pending'),
      q.answered ? '답변완료' : '대기중');
    head.appendChild(badge);
    head.appendChild(el('span', 'my-q-time', timeAgo(q.created_at)));

    var del = el('button', 'icon-btn is-danger');
    del.type = 'button';
    del.setAttribute('aria-label', '이 질문 삭제');
    del.appendChild(icon('trash'));
    del.addEventListener('click', function () { openDelete(q); });
    head.appendChild(del);

    li.appendChild(head);
    li.appendChild(el('p', 'my-q-body', q.body));
    return li;
  }

  function renderMine() {
    myList.textContent = '';
    mine.forEach(function (q) { myList.appendChild(questionCard(q)); });
    mineCount.textContent = String(mine.length);
    mineEmpty.hidden = mine.length > 0;
    mineNote.hidden = mine.length === 0;
    myList.hidden = mine.length === 0;
  }

  async function loadMine() {
    if (!configReady()) return;
    try {
      mine = await QnaDB.getMyQuestions();
      renderMine();
    } catch (err) {
      if (!panelMine.hidden) toast(err.message, { error: true });
    }
  }

  // ── 삭제 ------------------------------------------------------------------
  function openDelete(q) {
    pendingDelete = q;
    delQuote.textContent = q.body;
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else if (window.confirm('이 질문을 삭제할까요?')) confirmDelete();
  }

  $('del-cancel').addEventListener('click', function () { sheet.close(); });

  $('del-confirm').addEventListener('click', function () {
    sheet.close();
    confirmDelete();
  });

  async function confirmDelete() {
    var q = pendingDelete;
    pendingDelete = null;
    if (!q) return;

    var card = myList.querySelector('[data-id="' + q.id + '"]');
    if (card) card.classList.add('is-leaving');

    try {
      await QnaDB.deleteQuestion(q.id);
      mine = mine.filter(function (x) { return x.id !== q.id; });
      setTimeout(function () {
        renderMine();
        toast('질문을 삭제했습니다');
      }, 380);
    } catch (err) {
      if (card) card.classList.remove('is-leaving');
      toast(err.message, { error: true });
      loadMine();
    }
  }

  // ── 실시간 반영 (답변완료 배지) --------------------------------------------
  var reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadMine, 400);
  }

  // ── 시작 ------------------------------------------------------------------
  syncCounter();

  if (!configReady()) {
    showAlert('서버 설정이 아직 끝나지 않았어요. (config.js 의 anon key 확인)');
    submitBtn.disabled = true;
  } else {
    loadMine();
    QnaDB.subscribe(scheduleReload);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) loadMine();
    });
  }

  // 상대 시간 갱신
  setInterval(function () {
    if (!panelMine.hidden && mine.length) renderMine();
  }, 30000);
})();
