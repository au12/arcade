// Server-sent events: every open arcade (the cabinet's attract loop, phones
// on the high score page) hears about new records and achievements live.

export class Hub {
  constructor() {
    this.clients = new Set();
    this.seq = 0;
    this.timer = setInterval(() => this.ping(), 25_000);
    this.timer.unref();
  }

  add(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Nginx (and Nginx Proxy Manager) would otherwise hold events back.
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = { res };
    this.clients.add(client);
    req.on('close', () => this.clients.delete(client));
  }

  send(type, data) {
    this.seq += 1;
    const payload = `id: ${this.seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) {
      try {
        c.res.write(payload);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  ping() {
    for (const c of this.clients) {
      try {
        c.res.write(': keep-alive\n\n');
      } catch {
        this.clients.delete(c);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.clients) {
      try {
        c.res.end();
      } catch {
        /* gone */
      }
    }
    this.clients.clear();
  }
}
