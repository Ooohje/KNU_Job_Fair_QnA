// ============================================================================
//  QnA 데이터 레이어 (Supabase)
//  UI 쪽에서는 window.QnaDB 의 함수만 호출합니다.
//
//  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//  <script src="config.js"></script>
//  <script src="db.js"></script>
//  순서로 불러오세요.
// ============================================================================
(function () {
  'use strict';

  var cfg = window.QNA_CONFIG || {};
  var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  // --- 기기 식별 토큰 --------------------------------------------------------
  // 원본 토큰은 이 기기에만 남고, 서버에는 SHA-256 해시만 올라갑니다.
  var TOKEN_KEY = 'qna_client_token';
  var PASS_KEY = 'qna_speaker_pass';

  function getToken() {
    var t = null;
    try { t = localStorage.getItem(TOKEN_KEY); } catch (e) { /* 시크릿 모드 등 */ }
    if (!t) {
      t = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)) +
          '-' + Math.random().toString(36).slice(2);
      try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
    }
    return t;
  }

  var hashCache = null;
  async function getTokenHash() {
    if (hashCache) return hashCache;
    var bytes = new TextEncoder().encode(getToken());
    var buf = await crypto.subtle.digest('SHA-256', bytes);
    hashCache = Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
    return hashCache;
  }

  // --- 정렬 규칙 ------------------------------------------------------------
  // 미답변 먼저(오래된 순) → 답변완료는 아래로(답변한 순)
  function sortForSpeaker(rows) {
    return rows.slice().sort(function (a, b) {
      if (a.answered !== b.answered) return a.answered ? 1 : -1;
      var key = a.answered ? 'answered_at' : 'created_at';
      return new Date(a[key] || a.created_at) - new Date(b[key] || b.created_at);
    });
  }

  function strip(row) {
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      answered: row.answered,
      answered_at: row.answered_at,
    };
  }

  var MESSAGES = {
    too_short: '질문을 2자 이상 입력해 주세요.',
    too_fast: '잠시 후에 다시 보내주세요. (10초 간격)',
    too_many: '한 기기에서 보낼 수 있는 질문 수를 넘었습니다.',
    invalid_token: '기기 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.',
    unauthorized: '비밀코드가 올바르지 않습니다.',
    passphrase_not_set: '강연자 비밀코드가 아직 설정되지 않았습니다.',
    not_found: '이미 삭제된 질문입니다.',
  };

  function toError(err) {
    var raw = (err && (err.message || err.hint || '')) + '';
    for (var key in MESSAGES) {
      if (raw.indexOf(key) !== -1) {
        var e = new Error(MESSAGES[key]);
        e.code = key;
        return e;
      }
    }
    var fallback = new Error('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
    fallback.code = 'network';
    fallback.cause = err;
    return fallback;
  }

  // --- 공개 API -------------------------------------------------------------

  // 전체 질문 (강연자 화면)
  async function getQuestions() {
    var res = await client
      .from('questions')
      .select('id, body, created_at, answered, answered_at')
      .order('created_at', { ascending: true });
    if (res.error) throw toError(res.error);
    return sortForSpeaker(res.data || []);
  }

  // 이 기기에서 보낸 질문 (청중 "내 질문" 탭)
  async function getMyQuestions() {
    var hash = await getTokenHash();
    var res = await client
      .from('questions')
      .select('id, body, created_at, answered, answered_at')
      .eq('client_token_hash', hash)
      .order('created_at', { ascending: false });
    if (res.error) throw toError(res.error);
    return res.data || [];
  }

  // 질문 등록
  async function addQuestion(body) {
    var hash = await getTokenHash();
    var res = await client.rpc('submit_question', { p_body: body, p_token_hash: hash });
    if (res.error) throw toError(res.error);
    return strip(res.data);
  }

  // 내 질문 삭제 (본인 토큰이 일치할 때만 서버에서 삭제)
  async function deleteQuestion(id) {
    var res = await client.rpc('delete_question', { p_id: id, p_token: getToken() });
    if (res.error) throw toError(res.error);
    if (res.data !== true) throw toError(new Error('not_found'));
    return true;
  }

  // 답변 완료 / 되돌리기 (강연자)
  async function setAnswered(id, answered) {
    var res = await client.rpc('set_answered', {
      p_id: id,
      p_answered: !!answered,
      p_passphrase: getPassphrase(),
    });
    if (res.error) throw toError(res.error);
    return strip(res.data);
  }

  // --- 강연자 인증 ----------------------------------------------------------
  function getPassphrase() {
    try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; }
  }

  // 비밀코드 확인 후 기기에 저장 → 다음 접속 때 바로 입장
  async function login(passphrase) {
    var res = await client.rpc('verify_passphrase', { p_passphrase: passphrase });
    if (res.error) throw toError(res.error);
    if (res.data !== true) throw toError(new Error('unauthorized'));
    try { localStorage.setItem(PASS_KEY, passphrase); } catch (e) {}
    return true;
  }

  function isLoggedIn() { return !!getPassphrase(); }

  function logout() {
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
  }

  // 저장된 비밀코드가 아직 유효한지 확인 (강연자 화면 진입 시)
  async function checkSaved() {
    if (!isLoggedIn()) return false;
    try {
      var res = await client.rpc('verify_passphrase', { p_passphrase: getPassphrase() });
      if (res.data === true) return true;
      logout();
      return false;
    } catch (e) {
      return true; // 네트워크 문제면 로그인 화면으로 되돌리지 않음
    }
  }

  // 리허설 데이터 비우기
  async function resetAll() {
    var res = await client.rpc('reset_questions', { p_passphrase: getPassphrase() });
    if (res.error) throw toError(res.error);
    return res.data;
  }

  // --- 실시간 구독 ----------------------------------------------------------
  // onChange() 는 변경이 감지될 때마다 호출됩니다. 목록은 다시 불러오면 됩니다.
  // 반환값의 unsubscribe() 로 해지.
  function subscribe(onChange, onStatus) {
    var ch = client
      .channel('questions-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, function (payload) {
        onChange(payload);
      })
      .subscribe(function (status) {
        if (onStatus) onStatus(status === 'SUBSCRIBED' ? 'connected' : 'connecting');
      });

    return {
      unsubscribe: function () { client.removeChannel(ch); },
    };
  }

  window.QnaDB = {
    getQuestions: getQuestions,
    getMyQuestions: getMyQuestions,
    addQuestion: addQuestion,
    deleteQuestion: deleteQuestion,
    setAnswered: setAnswered,
    login: login,
    logout: logout,
    isLoggedIn: isLoggedIn,
    checkSaved: checkSaved,
    resetAll: resetAll,
    subscribe: subscribe,
    sortForSpeaker: sortForSpeaker,
  };
})();
