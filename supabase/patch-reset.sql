-- ============================================================================
--  reset_questions 수정본
--  WHERE 절 없는 DELETE 가 막혀서 전체 초기화가 실패하던 문제를 고칩니다.
--  SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (schema.sql 을 다시
--  실행해도 같은 결과입니다)
-- ============================================================================
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

grant execute on function public.reset_questions(text) to anon, authenticated;
