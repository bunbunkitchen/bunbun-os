-- is_cashier only reads the caller's own profile row, which is already visible
-- through the self-profile policy. It does not need SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.is_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
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

REVOKE ALL ON FUNCTION public.is_cashier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_cashier() TO authenticated;
