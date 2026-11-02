-- Sprint 7: Admin manages operational users; Cashier manages income/expense;
-- Owner retains all access. Intended for the staging project only.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY[
    'owner'::public.user_role,
    'admin'::public.user_role,
    'baker'::public.user_role,
    'helper'::public.user_role,
    'cashier'::public.user_role
  ]));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin'::public.user_role
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'cashier'::public.user_role
      AND p.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_cashier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_cashier() TO authenticated;

DROP POLICY IF EXISTS "Owner can update all profiles" ON public.profiles;
CREATE POLICY "Owner can update all profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_owner())
  WITH CHECK (role = ANY (ARRAY[
    'owner'::public.user_role,
    'admin'::public.user_role,
    'baker'::public.user_role,
    'helper'::public.user_role,
    'cashier'::public.user_role
  ]));

DROP POLICY IF EXISTS "Admin can read operational profiles" ON public.profiles;
CREATE POLICY "Admin can read operational profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND role = ANY (ARRAY[
      'baker'::public.user_role,
      'helper'::public.user_role,
      'cashier'::public.user_role
    ])
  );

DROP POLICY IF EXISTS "Admin can update operational profiles" ON public.profiles;
CREATE POLICY "Admin can update operational profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND role = ANY (ARRAY[
      'baker'::public.user_role,
      'helper'::public.user_role,
      'cashier'::public.user_role
    ])
  )
  WITH CHECK (
    public.is_admin()
    AND role = ANY (ARRAY[
      'baker'::public.user_role,
      'helper'::public.user_role,
      'cashier'::public.user_role
    ])
  );

CREATE OR REPLACE FUNCTION public.prevent_last_active_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  other_active_owners integer;
BEGIN
  IF OLD.role = 'owner'::public.user_role
    AND OLD.is_active
    AND (NEW.role <> 'owner'::public.user_role OR NOT NEW.is_active)
  THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(731942081);
    SELECT count(*)
      INTO other_active_owners
      FROM public.profiles p
      WHERE p.id <> OLD.id
        AND p.role = 'owner'::public.user_role
        AND p.is_active = true;
    IF other_active_owners = 0 THEN
      RAISE EXCEPTION 'Tidak dapat menonaktifkan atau menurunkan satu-satunya Owner aktif.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_last_active_owner_removal()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prevent_last_active_owner_removal ON public.profiles;
CREATE TRIGGER prevent_last_active_owner_removal
  BEFORE UPDATE OF role, is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_active_owner_removal();

DROP POLICY IF EXISTS "Cashier can read incomes" ON public.incomes;
CREATE POLICY "Cashier can read incomes"
  ON public.incomes FOR SELECT TO authenticated
  USING (public.is_cashier() AND is_deleted = false);
DROP POLICY IF EXISTS "Cashier can create incomes" ON public.incomes;
CREATE POLICY "Cashier can create incomes"
  ON public.incomes FOR INSERT TO authenticated
  WITH CHECK (public.is_cashier() AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Cashier can update incomes" ON public.incomes;
CREATE POLICY "Cashier can update incomes"
  ON public.incomes FOR UPDATE TO authenticated
  USING (public.is_cashier() AND is_deleted = false)
  WITH CHECK (public.is_cashier() AND updated_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Cashier can read expenses" ON public.expenses;
CREATE POLICY "Cashier can read expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (public.is_cashier() AND is_deleted = false);
DROP POLICY IF EXISTS "Cashier can create expenses" ON public.expenses;
CREATE POLICY "Cashier can create expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (public.is_cashier() AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Cashier can update expenses" ON public.expenses;
CREATE POLICY "Cashier can update expenses"
  ON public.expenses FOR UPDATE TO authenticated
  USING (public.is_cashier() AND is_deleted = false)
  WITH CHECK (public.is_cashier() AND updated_by = (SELECT auth.uid()));

-- Remove broad read access; retain read access for Owner and Baker only.
DROP POLICY IF EXISTS "Authenticated users can view sales" ON public.sales;
CREATE POLICY "Owner and Baker can view sales"
  ON public.sales FOR SELECT TO authenticated
  USING (public.is_owner_or_baker() AND is_deleted = false);
DROP POLICY IF EXISTS "Authenticated users can view sale items" ON public.sale_items;
CREATE POLICY "Owner and Baker can view sale items"
  ON public.sale_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.is_deleted = false
        AND public.is_owner_or_baker()
    )
  );
