-- pg_cron jobs. On Supabase this extension is available on the free plan.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule('g4-minutely', '* * * * *',  $$select app_private.cron_minutely()$$);
select cron.schedule('g4-hourly',   '7 * * * *',  $$select app_private.cron_hourly()$$);
-- 18:35 UTC = 00:05 IST
select cron.schedule('g4-daily',    '35 18 * * *', $$select app_private.cron_daily()$$);
