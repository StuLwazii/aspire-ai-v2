
-- Clear all existing roles & agents so the next signup becomes the first admin
DELETE FROM public.user_roles;
DELETE FROM public.agents;

-- Ensure the assign_first_user_admin trigger fires on new auth users
DROP TRIGGER IF EXISTS on_auth_user_created_assign_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_admin
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.assign_first_user_admin();
