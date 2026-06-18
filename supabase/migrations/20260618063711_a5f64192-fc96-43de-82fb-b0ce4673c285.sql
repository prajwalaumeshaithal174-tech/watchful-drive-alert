DROP POLICY IF EXISTS "Public update driver status" ON public.driver_status;
DROP POLICY IF EXISTS "Public write driver status" ON public.driver_status;
REVOKE INSERT, UPDATE ON public.driver_status FROM anon, authenticated;
GRANT ALL ON public.driver_status TO service_role;