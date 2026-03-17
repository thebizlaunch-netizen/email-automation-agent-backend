export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Email Automation Agent API</h1>
      <p>This is the backend API for the TBL Email Automation Agent.</p>
      <h2>Endpoints</h2>
      <ul>
        <li><code>GET /api/health</code> — Health check</li>
        <li><code>GET /api/auth/start</code> — Start Google OAuth flow</li>
        <li><code>GET /api/auth/callback</code> — OAuth callback (Google redirects here)</li>
        <li><code>GET /api/gmail/read</code> — Read Gmail messages (requires session token)</li>
      </ul>
    </div>
  );
}
