export default {
  async fetch(request) {
    if (request.method === 'GET') {
      return Response.json({ ok: true, service: 'MCR EV Planner Telegram Relay' });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    }

    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let url;
    try {
      url = new URL(process.env.APPS_SCRIPT_WEBHOOK_URL);
      if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
          url.username || url.password || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) ||
          !process.env.APPS_SCRIPT_WEBHOOK_SECRET) throw new Error();
      url.searchParams.set('token', process.env.APPS_SCRIPT_WEBHOOK_SECRET);
      url.hash = '';
    } catch {
      console.error('Relay configuration invalid');
      return Response.json({ ok: false, error: 'Relay configuration invalid' }, { status: 500 });
    }

    let body;
    try {
      body = await request.text();
      const update = JSON.parse(body);
      if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error();
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON update' }, { status: 400 });
    }

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      });
      // Consume the final response; never send its body or redirect headers to Telegram.
      await upstream.text();
      if (!upstream.ok) throw new Error();
      return Response.json({ ok: true });
    } catch {
      console.error('Relay forwarding failed');
      return Response.json({ ok: false, error: 'Upstream forwarding failed' }, { status: 502 });
    }
  }
};
