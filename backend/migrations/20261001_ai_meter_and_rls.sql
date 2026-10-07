-- AI ka teesra meter, aur har table par RLS.
--
-- 1) AI METER
-- leads aur calls par limit pehle se thi; AI chat par nahi. Wahi sabse sasta
-- abuse hai: ek script ek raat me pure mahine ka token bill bana sakti hai.
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS ai_per_day integer DEFAULT 300;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS ai_used    integer DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS ai_total   integer DEFAULT 0;

-- 2) ROW LEVEL SECURITY
-- Backend har query me owner_user_id lagata hai, par wo ek chowkidar hai.
-- RLS har almari par apna taala hai: ek bhoola hua WHERE bhi data leak nahi
-- kara sakta. Backend service-role se judta hai, use RLS rokta nahi — ye
-- doosri parat hai, pehli nahi.
ALTER TABLE user_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sarvam_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE toughtongue_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cloud_data      ENABLE ROW LEVEL SECURITY;

-- auth.uid() Supabase ka logged-in user hai. USING = kya padh sakte ho,
-- WITH CHECK = kya likh sakte ho. Dono chahiye, warna A apni row B ke naam
-- par likh sakta hai.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lead_jobs','lead_records','candidate_jobs','candidate_records',
    'provider_credentials','tenant_limits','subscriptions',
    'sarvam_settings','toughtongue_scenarios'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS own_rows ON %I;
       CREATE POLICY own_rows ON %I FOR ALL TO authenticated
         USING (owner_user_id = auth.uid()::text)
         WITH CHECK (owner_user_id = auth.uid()::text);', t, t);
  END LOOP;
END $$;

-- Ye do apne hi column se judte hain, isliye alag.
DROP POLICY IF EXISTS own_row ON user_accounts;
CREATE POLICY own_row ON user_accounts FOR ALL TO authenticated
  USING (id = auth.uid()::text) WITH CHECK (id = auth.uid()::text);

DROP POLICY IF EXISTS own_row ON user_cloud_data;
CREATE POLICY own_row ON user_cloud_data FOR ALL TO authenticated
  USING (email = auth.jwt()->>'email') WITH CHECK (email = auth.jwt()->>'email');
