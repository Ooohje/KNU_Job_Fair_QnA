// ============================================================================
//  Supabase 접속 설정
//  anon key 는 공개되어도 되는 키입니다. (RLS + RPC 로 권한을 막아둠)
//  Supabase 대시보드 > Project Settings > API 에서 복사해 아래에 붙여넣으세요.
// ============================================================================
window.QNA_CONFIG = {
  SUPABASE_URL: 'https://riilihjbhbheimjlgibk.supabase.co',
  SUPABASE_ANON_KEY: '여기에-anon-public-key-붙여넣기',

  // 청중용 페이지 주소 (qr.html 에서 QR 코드로 만들 주소)
  PUBLIC_URL: 'https://ooohje.github.io/KNU_Job_Fair_QnA/',

  // 화면에 표시할 강연 제목
  TALK_TITLE: '경북대 잡페어 강연 QnA',
};
