-- Sprint 7 role model expansion. Keep this migration separate from policies
-- that reference the new enum labels so PostgreSQL can commit the new values.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'cashier';
