// Owner-only isolated staging review/confirm API. No DB password is required;
// the narrow service-only RPC transport keeps the ledger schema private.
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { isIsolatedAccountingStaging } from '../_shared/accountingStagingGuard.js';
import { createExpenseReviewHandler } from '../_shared/accountingExpenseReview.js';

const projectUrl = Deno.env.get('SUPABASE_URL') || '';
const publishable = Deno.env.get('SUPABASE_ANON_KEY') || '';
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const isolatedProject = projectUrl === 'https://pkgrqalpazhwdcxmthvb.supabase.co';
const trustedOrigins = new Set(isolatedProject ? [
  'https://bunbun-os-git-feature-hpp-actual-8b54a5-bunbunkitchens-projects.vercel.app',
  'https://bunbun-7ceems8s7-bunbunkitchens-projects.vercel.app',
  'http://localhost:5173',
] : []);
const configuredOrigin = Deno.env.get('BUNBUN_ACCOUNTING_ALLOWED_ORIGIN');
if (isolatedProject && configuredOrigin) trustedOrigins.add(configuredOrigin);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const auth = isolatedProject && publishable ? createClient(projectUrl, publishable, options) : null;
const admin = isolatedProject && secret ? createClient(projectUrl, secret, options) : null;

Deno.serve(async request => {
  const allowedOrigin = request.headers.get('Origin') || '';
  const configured = Boolean(auth && admin && trustedOrigins.has(allowedOrigin) && isIsolatedAccountingStaging({
    stageFlag: Deno.env.get('BUNBUN_ACCOUNTING_STAGE') || (isolatedProject ? 'isolated-staging' : ''),
    stagingProjectRef: Deno.env.get('BUNBUN_ACCOUNTING_STAGING_REF') || (isolatedProject ? 'pkgrqalpazhwdcxmthvb' : ''),
    projectUrl, allowedOrigin,
  }));
  return createExpenseReviewHandler({ stageEnabled: configured, allowedOrigin, signingSecret: secret,
    async verifyUserToken(token: string) {
      if (!auth) throw new Error('Unavailable');
      const { data, error } = await auth.auth.getUser(token);
      if (error || !data.user) throw new Error('Unauthorized');
      return { id: data.user.id };
    },
    async loadProfile(id: string) {
      if (!admin) throw new Error('Unavailable');
      const { data, error } = await admin.from('profiles').select('id,role,is_active').eq('id', id).maybeSingle();
      if (error) throw error; return data;
    },
    async loadReview(expenseId: string, actorId: string) {
      if (!admin) throw new Error('Unavailable');
      const { data, error } = await admin.rpc('accounting_expense_service', {
        p_action: 'review', p_payload: { expenseId }, p_actor_id: actorId,
      });
      if (error) throw error; return data;
    },
    async submitReview(review: { action: string }, actorId: string) {
      if (!admin) throw new Error('Unavailable');
      const { data, error } = await admin.rpc('accounting_expense_service', {
        p_action: review.action, p_payload: review, p_actor_id: actorId,
      });
      if (error) throw error; return data;
    },
  })(request);
});
