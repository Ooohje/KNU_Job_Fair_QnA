-- ============================================================================
--  강연자 비밀코드 설정
--  '바꿔주세요-강연자-비밀코드' 두 군데를 원하는 코드로 고친 뒤 SQL Editor에서 Run.
--  DB에는 bcrypt 해시만 저장되며, 이 파일은 코드를 적은 상태로 커밋하지 마세요.
-- ============================================================================
insert into public.admin_config (id, passphrase_hash)
values (1, extensions.crypt('바꿔주세요-강연자-비밀코드', extensions.gen_salt('bf', 10)))
on conflict (id) do update
   set passphrase_hash = excluded.passphrase_hash,
       updated_at      = now();

-- 확인용 (true 가 나와야 정상)
select public.verify_passphrase('바꿔주세요-강연자-비밀코드') as ok;
