
CREATE TABLE public.driver_status (
  driver_id TEXT PRIMARY KEY,
  driver_name TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_status TO anon, authenticated;
GRANT ALL ON public.driver_status TO service_role;

ALTER TABLE public.driver_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read driver status" ON public.driver_status FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write driver status" ON public.driver_status FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Public update driver status" ON public.driver_status FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_status;
ALTER TABLE public.driver_status REPLICA IDENTITY FULL;
