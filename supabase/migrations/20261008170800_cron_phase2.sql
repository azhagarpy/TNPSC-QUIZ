-- Jobs for leagues, Quick Match tidy-up and web push.
create extension if not exists pg_net;

select cron.schedule('g4-minutely-2',    '* * * * *',  $$select app_private.cron_minutely_phase2()$$);
-- Sunday 18:40 UTC = Monday 00:10 IST
select cron.schedule('g4-weekly',        '40 18 * * 0', $$select app_private.cron_weekly()$$);
-- 14:00 UTC = 19:30 IST
select cron.schedule('g4-streak-push',   '0 14 * * *',  $$select app_private.cron_streak_reminders()$$);
