# Supabase 설정 순서

프로젝트: `riilihjbhbheimjlgibk` (https://supabase.com/dashboard/project/riilihjbhbheimjlgibk)

## 1. 스키마 만들기

1. 대시보드 왼쪽 메뉴 **SQL Editor** → **New query**
2. `supabase/schema.sql` 전체를 붙여넣고 **Run** (Ctrl+Enter)
3. `Success. No rows returned` 이 나오면 완료

만들어지는 것

| 항목 | 내용 |
|---|---|
| `questions` 테이블 | 질문 본문, 기기 토큰 해시, 답변 여부, 시각 |
| `admin_config` 테이블 | 강연자 비밀코드 해시 (API로 읽기 불가) |
| RLS 정책 | **읽기만** 공개. 쓰기·수정·삭제는 아래 함수만 |
| `submit_question` | 질문 등록 + 도배 방지(10초 쿨다운, 기기당 20개) |
| `delete_question` | 토큰이 일치하는 본인 질문만 삭제 |
| `set_answered` | 비밀코드가 맞을 때만 답변완료 토글 |
| `verify_passphrase` | 강연자 로그인 확인 |
| `reset_questions` | 리허설 데이터 전체 삭제 |
| Realtime | `questions` 변경을 강연자 화면에 실시간 전달 |

## 2. 강연자 비밀코드 설정

1. `supabase/set-passphrase.local.sql` 전체를 SQL Editor에 붙여넣고 **Run**
   → 결과가 `ok = true` 면 완료 (현재 코드: `1122`)
2. 코드를 바꾸려면 그 파일의 `'1122'` **두 군데**를 고쳐서 다시 Run

이 파일은 `.gitignore` 에 들어 있어 공개 저장소에 올라가지 않습니다.
저장소에 커밋되는 `supabase/set-passphrase.sql` 은 코드가 비어 있는 템플릿이고,
DB에는 bcrypt 해시만 저장됩니다.

> `1122` 처럼 짧은 코드는 `verify_passphrase` 를 반복 호출하면 맞힐 수 있습니다.
> 강연 전후로만 쓰고, 마음이 바뀌면 위 파일에서 긴 코드로 바꿔 다시 Run 하세요.

## 3. API 키 넣기

1. 대시보드 → **Project Settings** → **API**
2. `Project URL` 과 `anon` `public` 키 복사
3. `config.js` 의 `SUPABASE_ANON_KEY` 에 붙여넣기

> anon 키는 공개되는 키가 맞습니다. GitHub에 올라가도 문제 없습니다.
> 실제 권한은 RLS + 위 함수들이 막습니다. **`service_role` 키는 절대 넣지 마세요.**

## 4. Realtime 확인

**Database** → **Publications** → `supabase_realtime` 에 `questions` 가 포함되어 있는지 확인.
schema.sql이 자동으로 추가하지만, 빠져 있으면 체크박스로 켜면 됩니다.

## 5. 동작 확인 (SQL Editor에서)

```sql
-- 테스트 질문 넣기 (토큰 해시는 64자 아무 값)
select public.submit_question(
  '테스트 질문입니다',
  repeat('a', 64)
);

-- 조회
select id, body, answered, created_at from public.questions order by created_at;

-- 답변완료 토글 (비밀코드를 실제 값으로)
select public.set_answered('위에서-나온-id'::uuid, true, '실제-비밀코드');

-- 테스트 데이터 정리
select public.reset_questions('실제-비밀코드');
```

## 보안 요약

- 청중은 로그인 없이 익명으로 질문 → 서버에는 이름·IP 대신 **랜덤 토큰의 SHA-256 해시**만 남음
- 질문 목록은 누구나 읽을 수 있음 (질문 자체가 익명 공개 콘텐츠라서 문제 없음)
- 남의 질문 삭제 불가: 삭제에는 해시가 아닌 **원본 토큰**이 필요하고, 그건 그 기기에만 있음
- 답변완료 표시·전체삭제는 비밀코드 필요 (bcrypt 비교, DB에서만 검증)

## 데이터 레이어

UI 코드는 `db.js` 의 `window.QnaDB` 만 호출합니다.

```js
await QnaDB.getQuestions();          // 전체 (강연자용, 정렬 완료)
await QnaDB.getMyQuestions();        // 이 기기에서 보낸 질문
await QnaDB.addQuestion(body);       // 질문 등록
await QnaDB.deleteQuestion(id);      // 내 질문 삭제
await QnaDB.setAnswered(id, true);   // 답변완료 / false 되돌리기
await QnaDB.login(passphrase);       // 강연자 로그인
await QnaDB.checkSaved();            // 저장된 비밀코드 유효성
QnaDB.subscribe(onChange, onStatus); // 실시간 변경 구독
```

스크립트 로드 순서:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="db.js"></script>
```
