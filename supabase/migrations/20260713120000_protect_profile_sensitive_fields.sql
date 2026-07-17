-- Prevent ordinary authenticated clients from changing profile fields that
-- control authorization, billing, entitlement, or account authority.

CREATE OR REPLACE FUNCTION public.keepr_profile_sensitive_update_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin');
$$;

CREATE OR REPLACE FUNCTION public.keepr_protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_field text := NULL;
BEGIN
  IF public.keepr_profile_sensitive_update_allowed() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    v_field := 'role';
  ELSIF NEW.plan IS DISTINCT FROM OLD.plan THEN
    v_field := 'plan';
  ELSIF NEW.billing_status IS DISTINCT FROM OLD.billing_status THEN
    v_field := 'billing_status';
  ELSIF NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle THEN
    v_field := 'billing_cycle';
  ELSIF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    v_field := 'stripe_customer_id';
  ELSIF NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
    v_field := 'stripe_subscription_id';
  ELSIF NEW.current_period_end IS DISTINCT FROM OLD.current_period_end THEN
    v_field := 'current_period_end';
  ELSIF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    IF NOT (
      OLD.account_status = 'active'
      AND NEW.account_status = 'deactivated'
      AND NEW.id = OLD.id
      AND OLD.id = auth.uid()
    ) THEN
      v_field := 'account_status';
    END IF;
  END IF;

  IF v_field IS NOT NULL THEN
    RAISE EXCEPTION 'profile_sensitive_field_update_denied'
      USING
        ERRCODE = '42501',
        DETAIL = v_field,
        HINT = 'Use a privileged server-side administrative path for profile authority changes.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keepr_protect_profile_sensitive_fields ON public.profiles;

CREATE TRIGGER trg_keepr_protect_profile_sensitive_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.keepr_protect_profile_sensitive_fields();
