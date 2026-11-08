// Usage: TOKEN=$(npm run -s fhir:token -- <email>)
// Signs a demo user in and prints only their access token (valid ~1 hour).
import { adminClient, fail, main } from './lib/cli';
import { demoPassword } from './lib/users';

await main(async () => {
  const [email] = process.argv.slice(2);
  if (!email) fail('usage: npm run -s fhir:token -- <email>');
  const { data, error } = await adminClient().auth.signInWithPassword({ email, password: demoPassword() });
  if (error || !data.session) fail(`sign-in failed for ${email}: ${error?.message ?? 'no session'}`);
  console.log(data.session.access_token);
});
