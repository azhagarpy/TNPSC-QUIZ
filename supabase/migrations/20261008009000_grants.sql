-- API surface: signed-in players may call the public functions; anonymous
-- visitors may call none. app_private is unreachable from the API entirely.

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.handle_new_user() from authenticated;

revoke all on schema app_private from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
