-- NAVI Capture Phase 3: remove project-default table privileges from the
-- already-created Capture table and restore only the intended API surface.

revoke all on public.capture_sessions from anon;
revoke all on public.capture_sessions from public;
revoke all on public.capture_sessions from authenticated;
grant select, insert, update on public.capture_sessions to authenticated;
