import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, getUserInfo } from '@/lib/google-oauth';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/lib/audit';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  // Handle OAuth denial
  if (error) {
    await writeAuditLog({
      actorType: 'system',
      action: 'oauth_callback_denied',
      resourceType: 'oauth_connection',
      details: { error, state },
    });
    return NextResponse.json(
      { error: 'OAuth was denied by the user', detail: error },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    );
  }

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeCode(code);

    if (!tokens.access_token) {
      throw new Error('No access token returned from Google');
    }

    // 2. Get user info from Google
    const userInfo = await getUserInfo(tokens.access_token);

    if (!userInfo.email) {
      throw new Error('No email returned from Google userinfo');
    }

    // 3. Upsert user in database
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          email: userInfo.email,
          name: userInfo.name || null,
          avatar_url: userInfo.picture || null,
          auth_provider: 'google',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      )
      .select('id, email, name')
      .single();

    if (userError || !user) {
      throw new Error(`Failed to upsert user: ${userError?.message}`);
    }

    // 4. Get the email-automation agent ID
    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('slug', 'email-automation')
      .single();

    if (!agent) {
      throw new Error('Email automation agent not found in database');
    }

    // 5. Store OAuth connection
    const { error: oauthError } = await supabase
      .from('oauth_connections')
      .upsert(
        {
          user_id: user.id,
          agent_id: agent.id,
          provider: 'google',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          scopes: tokens.scope ? tokens.scope.split(' ') : [],
          provider_email: userInfo.email,
          provider_user_id: userInfo.id || null,
          is_valid: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,agent_id,provider' }
      );

    if (oauthError) {
      throw new Error(`Failed to store OAuth tokens: ${oauthError.message}`);
    }

    // 6. Create a session
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const { error: sessionError } = await supabase.from('sessions').insert({
      user_id: user.id,
      agent_id: agent.id,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
    });

    if (sessionError) {
      throw new Error(`Failed to create session: ${sessionError.message}`);
    }

    // 7. Audit log the successful callback
    await writeAuditLog({
      actorType: 'user',
      actorId: user.id,
      action: 'oauth_callback_success',
      resourceType: 'oauth_connection',
      details: {
        provider: 'google',
        provider_email: userInfo.email,
        state,
        has_refresh_token: !!tokens.refresh_token,
        session_token: sessionToken,
      },
    });

    // Return success with session info
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      session: {
        token: sessionToken,
        expires_at: expiresAt.toISOString(),
      },
      oauth: {
        provider: 'google',
        provider_email: userInfo.email,
        has_refresh_token: !!tokens.refresh_token,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';

    await writeAuditLog({
      actorType: 'system',
      action: 'oauth_callback_failed',
      resourceType: 'oauth_connection',
      details: { error: message, state },
    });

    return NextResponse.json(
      { error: 'OAuth callback failed', detail: message },
      { status: 500 }
    );
  }
}
