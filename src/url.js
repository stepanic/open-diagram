// Links to DBML files: GitHub, Gist and GitLab page links become their raw files, so a schema
// on GitHub can be opened by its ordinary link. Shared by the app (?url=) and the embed (src).
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

  OD.rawUrl = rawUrl;
})((window.OD = window.OD || {}));
