-- Same API surface rules for the phase-2 functions.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.handle_new_user() from authenticated;

-- Push queue access is for the send-push Edge Function (service role) only.
revoke execute on function public.push_claim(int) from authenticated;
revoke execute on function public.push_drop(text[]) from authenticated;

revoke execute on all functions in schema app_private from public, anon, authenticated;
