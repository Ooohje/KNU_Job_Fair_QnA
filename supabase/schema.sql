-- ============================================================================
--  KNU Job Fair 익명 QnA — Supabase 스키마
--  사용법: Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run
--  여러 번 실행해도 안전합니다 (idempotent).
-- ============================================================================

-- 비밀코드 해시(crypt) / 토큰 해시(digest)에 필요
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1) 질문 테이블
--    client_token_hash: 기기 식별용 랜덤 토큰의 SHA-256 해시.
--    원본 토큰은 기기의 localStorage에만 있고 서버에는 해시만 저장한다.
--    → 테이블이 공개로 읽혀도 누구의 질문인지 알 수 없고, 남의 질문도 못 지운다.
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id                uuid        primary key default gen_random_uuid(),
  body              text        not null,
  client_token_hash text        not null,
  answered          boolean     not null default false,
  answered_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint questions_body_len  check (char_length(btrim(body)) between 2 and 500),
  constraint questions_token_len check (char_length(client_token_hash) = 64)
);

create index if not exists questions_sort_idx
  on public.questions (answered, created_at);
create index if not exists questions_token_idx
  on public.questions (client_token_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) 강연자 비밀코드 보관 테이블 (RLS 정책 없음 → API로는 절대 못 읽음)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_config (
  id              smallint    primary key default 1 check (id = 1),
  passphrase_hash text        not null,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) RLS: 읽기만 공개. 쓰기/수정/삭제는 아래 함수를 통해서만 가능.
-- ---------------------------------------------------------------------------
alter table public.questions    enable row level security;
alter table public.admin_config enable row level security;

drop policy if exists "questions_select_all" on public.questions;
create policy "questions_select_all"
  on public.questions for select
  to anon, authenticated
  using (true);
-- insert / update / delete 정책은 의도적으로 만들지 않는다.

-- ---------------------------------------------------------------------------
-- 4) 질문 등록 (도배 방지: 10초 쿨다운 + 기기당 최대 20개)
-- ---------------------------------------------------------------------------
create or replace function public.submit_question(p_body text, p_token_hash text)
returns public.questions
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_row    public.questions;
  v_recent integer;
  v_total  integer;
begin
  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    raise exception 'invalid_token';
  end if;
  if char_length(v_body) < 2 then
    raise exception 'too_short';
  end if;
  v_body := left(v_body, 500);

  select count(*) into v_recent
    from public.questions
   where client_token_hash = p_token_hash
     and created_at > now() - interval '10 seconds';
  if v_recent > 0 then
    raise exception 'too_fast';
  end if;

  select count(*) into v_total
    from public.questions
   where client_token_hash = p_token_hash;
  if v_total >= 20 then
    raise exception 'too_many';
  end if;

  insert into public.questions (body, client_token_hash)
  values (v_body, p_token_hash)
  returning * into v_row;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5) 내 질문 삭제 (원본 토큰을 보내면 서버에서 해시해 비교)
-- ---------------------------------------------------------------------------
create or replace function public.delete_question(p_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_hash text;
begin
  if p_token is null or char_length(p_token) < 8 then
    raise exception 'invalid_token';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  delete from public.questions
   where id = p_id
     and client_token_hash = v_hash;

  return found;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6) 강연자 비밀코드 확인
-- ---------------------------------------------------------------------------
create or replace function public.verify_passphrase(p_passphrase text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_hash text;
begin
  select passphrase_hash into v_hash from public.admin_config where id = 1;
  if v_hash is null then
    raise exception 'passphrase_not_set';
  end if;
  return extensions.crypt(coalesce(p_passphrase, ''), v_hash) = v_hash;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7) 답변 완료 표시 / 되돌리기 (강연자만)
-- ---------------------------------------------------------------------------
create or replace function public.set_answered(p_id uuid, p_answered boolean, p_passphrase text)
returns public.questions
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_row public.questions;
begin
  if not public.verify_passphrase(p_passphrase) then
    raise exception 'unauthorized';
  end if;

  update public.questions
     set answered    = coalesce(p_answered, false),
         answered_at = case when coalesce(p_answered, false)
                            then coalesce(answered_at, now())
                            else null end
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'not_found';
  end if;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8) 전체 초기화 (리허설 후 본 강연 전에 비우기용)
-- ---------------------------------------------------------------------------
create or replace function public.reset_questions(p_passphrase text)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_count integer;
begin
  if not public.verify_passphrase(p_passphrase) then
    raise exception 'unauthorized';
  end if;

  -- WHERE 없는 DELETE 는 안전 모드에서 막히므로 id 를 명시적으로 지운다
  with doomed as (
    select id from public.questions
  ), deleted as (
    delete from public.questions q using doomed d where q.id = d.id returning 1
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 9) 실행 권한
-- ---------------------------------------------------------------------------
grant execute on function public.submit_question(text, text)       to anon, authenticated;
grant execute on function public.delete_question(uuid, text)       to anon, authenticated;
grant execute on function public.verify_passphrase(text)           to anon, authenticated;
grant execute on function public.set_answered(uuid, boolean, text) to anon, authenticated;
grant execute on function public.reset_questions(text)             to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) Realtime (강연자 화면 자동 갱신)
-- ---------------------------------------------------------------------------
alter table public.questions replica identity full;

do $rt$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'questions'
  ) then
    alter publication supabase_realtime add table public.questions;
  end if;
exception when others then
  raise notice 'realtime publication 설정을 건너뜁니다: %', sqlerrm;
end $rt$;
