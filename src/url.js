// Links to DBML files: GitHub, Gist and GitLab page links become their raw files, so a schema
// on GitHub can be opened by its ordinary link. Shared by the app (?url=) and the embed (src).
// Also the #dbml= hash: the text itself, deflated and base64url-encoded, for links and iframes
// that carry a diagram with no server behind it.
(function (OD) {
  function rawUrl(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.searchParams.get('url')) return rawUrl(u.searchParams.get('url')); // a share link of this app
    const p = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'github.com' && (p[2] === 'blob' || p[2] === 'raw') && p.length > 4) {
      return `https://raw.githubusercontent.com/${p[0]}/${p[1]}/${p.slice(3).join('/')}`;
    }
    if (u.hostname === 'gist.github.com' && p.length === 2) return `https://gist.githubusercontent.com/${p[0]}/${p[1]}/raw`;
    const dash = p.indexOf('-');
    if (dash > 1 && p[dash + 1] === 'blob') {
      p[dash + 1] = 'raw';
      return `${u.origin}/${p.join('/')}`;
    }
    u.hash = '';
    return u.href;
  }

  const toB64url = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const through = (data, stream) => new Response(new Blob([data]).stream().pipeThrough(stream));

  // Text → deflate-raw → base64url, and back.
  const pack = async (text) => toB64url(new Uint8Array(await through(text, new CompressionStream('deflate-raw')).arrayBuffer()));
  const unpack = (s) => through(fromB64url(s), new DecompressionStream('deflate-raw')).text();

  // { dbml, src, layout, name, view, detail, algorithm, focus } ↔ 'dbml=…&layout=…'. dbml and
  // layout (positions, { key: {x, y} }) are packed; the rest stay plain. Positions are rounded.
  async function packHash(o) {
    const q = new URLSearchParams();
    if (o.dbml != null) q.set('dbml', await pack(o.dbml));
    if (o.src) q.set('src', o.src);
    if (o.layout && Object.keys(o.layout).length) {
      const pos = {};
      for (const [k, p] of Object.entries(o.layout)) pos[k] = { x: Math.round(p.x), y: Math.round(p.y) };
      q.set('layout', await pack(JSON.stringify(pos)));
    }
    for (const k of ['name', 'view', 'detail', 'algorithm', 'focus']) if (o[k]) q.set(k, o[k]);
    return q.toString().replace(/%2F/g, '/').replace(/%3A/g, ':');
  }

  // Resolves to null when the hash holds neither dbml nor src; throws when it is corrupt.
  async function readHash(hash) {
    const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (!q.get('dbml') && !q.get('src')) return null;
    const o = {};
    for (const k of ['src', 'name', 'view', 'detail', 'algorithm', 'focus']) if (q.get(k)) o[k] = q.get(k);
    if (q.get('dbml')) o.dbml = await unpack(q.get('dbml'));
    if (q.get('layout')) o.layout = JSON.parse(await unpack(q.get('layout')));
    return o;
  }

  OD.rawUrl = rawUrl;
  Object.assign(OD, { pack, unpack, packHash, readHash });
})((window.OD = window.OD || {}));
