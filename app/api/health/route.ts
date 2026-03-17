import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Check 1: Supabase connection
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('slug')
      .eq('slug', 'email-automation')
      .single();

    if (error || !data) {
      checks.database = 'FAIL: cannot query agents table';
      healthy = false;
    } else {
      checks.database = 'OK: connected, agent row found';
    }
  } catch (e) {
    checks.database = `FAIL: ${e instanceof Error ? e.message : 'unknown error'}`;
    healthy = false;
  }

  // Check 2: Google OAuth config present
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) {
    checks.google_oauth_config = 'OK: all env vars present';
  } else {
    const missing = [];
    if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
    checks.google_oauth_config = `FAIL: missing ${missing.join(', ')}`;
    healthy = false;
  }

  // Check 3: Supabase config present
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    checks.supabase_config = 'OK: env vars present';
  } else {
    checks.supabase_config = 'FAIL: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY';
    healthy = false;
  }

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      agent: 'email-automation',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
}
