import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getGmailClient } from '@/lib/google-oauth';
import { writeAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or invalid Authorization header. Use: Bearer <session_token>' },
      { status: 401 }
    );
  }

  const sessionToken = authHeader.replace('Bearer ', '');

  try {
    // 1. Validate session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_id, agent_id, expires_at')
      .eq('session_token', sessionToken)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Invalid or expired session token' },
        { status: 401 }
      );
    }

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'Session has expired. Please re-authenticate.' },
        { status: 401 }
      );
    }

    // 2. Get OAuth tokens for this user + agent
    const { data: oauth, error: oauthError } = await supabase
      .from('oauth_connections')
      .select('access_token, refresh_token, token_expires_at, provider_email')
      .eq('user_id', session.user_id)
      .eq('agent_id', session.agent_id)
      .eq('provider', 'google')
      .eq('is_valid', true)
      .single();

    if (oauthError || !oauth) {
      return NextResponse.json(
        { error: 'No valid Google OAuth connection found. Please re-authenticate.' },
        { status: 401 }
      );
    }

    // 3. Create Gmail client
    const gmail = await getGmailClient(oauth.access_token, oauth.refresh_token);

    // 4. Parse query params
    const maxResults = Math.min(
      parseInt(request.nextUrl.searchParams.get('maxResults') || '20'),
      50
    );
    const query = request.nextUrl.searchParams.get('q') || '';
    const labelIds = request.nextUrl.searchParams.get('labelIds')?.split(',') || ['INBOX'];

    // 5. List messages
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query,
      labelIds,
    });

    const messageIds = listResponse.data.messages || [];

    if (messageIds.length === 0) {
      await writeAuditLog({
        actorType: 'user',
        actorId: session.user_id,
        action: 'gmail_read',
        resourceType: 'email',
        details: { message_count: 0, query, labelIds },
      });

      return NextResponse.json({
        messages: [],
        result_count: 0,
        provider_email: oauth.provider_email,
      });
    }

    // 6. Fetch message details (metadata only for efficiency)
    const messages = await Promise.all(
      messageIds.map(async (msg: any) => {
        if (!msg.id) return null;
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        return {
          id: detail.data.id,
          threadId: detail.data.threadId,
          snippet: detail.data.snippet,
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          labelIds: detail.data.labelIds,
        };
      })
    );

    const validMessages = messages.filter(Boolean);

    // 7. Audit log
    await writeAuditLog({
      actorType: 'user',
      actorId: session.user_id,
      action: 'gmail_read',
      resourceType: 'email',
      details: {
        message_count: validMessages.length,
        query,
        labelIds,
        provider_email: oauth.provider_email,
      },
    });

    return NextResponse.json({
      messages: validMessages,
      result_count: validMessages.length,
      provider_email: oauth.provider_email,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';

    await writeAuditLog({
      actorType: 'system',
      action: 'gmail_read_failed',
      resourceType: 'email',
      details: { error: message },
    });

    // Check if it's a token expiry issue
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return NextResponse.json(
        { error: 'Google token expired. Please re-authenticate.', detail: message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to read Gmail', detail: message },
      { status: 500 }
    );
  }
}
