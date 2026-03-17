import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google-oauth';
import { writeAuditLog } from '@/lib/audit';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    // Generate a state parameter for CSRF protection
    const state = randomUUID();

    const authUrl = getAuthUrl(state);

    // Audit log the OAuth initiation
    await writeAuditLog({
      actorType: 'system',
      action: 'oauth_start',
      resourceType: 'oauth_connection',
      details: {
        provider: 'google',
        state,
        scopes: [
          'gmail.readonly',
          'gmail.modify',
          'userinfo.email',
          'userinfo.profile',
        ],
      },
    });

    return NextResponse.json({
      auth_url: authUrl,
      state,
      provider: 'google',
      note: 'Redirect the user to auth_url to begin Google OAuth flow',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';

    await writeAuditLog({
      actorType: 'system',
      action: 'oauth_start_failed',
      resourceType: 'oauth_connection',
      details: { error: message },
    });

    return NextResponse.json(
      { error: 'Failed to generate OAuth URL', detail: message },
      { status: 500 }
    );
  }
}
