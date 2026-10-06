const supabase = require('./supabase');

function deriveUserName(user) {
  return [
    user.user_metadata?.name,
    user.user_metadata?.full_name,
    typeof user.email === 'string' ? user.email.split('@')[0] : null,
    'Usuario',
  ].find((value) => typeof value === 'string' && value.trim()).trim();
}

async function ensureUserProfile(user) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (error || data) return { error };

  // ON CONFLICT DO NOTHING preserves an existing profile in concurrent requests.
  return supabase.from('users').upsert(
    { id: user.id, name: deriveUserName(user) },
    { onConflict: 'id', ignoreDuplicates: true }
  );
}

module.exports = { deriveUserName, ensureUserProfile };
