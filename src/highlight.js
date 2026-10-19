// DBML syntax highlighting for the editor: turns source text into HTML spans. The editor draws
// this under a transparent textarea, so only colours may differ from the plain text, never widths.
(function (OD) {
  const KEYWORDS = new Set(['table', 'tablegroup', 'tablepartial', 'ref', 'enum', 'project', 'note', 'indexes', 'as', 'records']);
  // Keywords that can open a line inside a block; anything else there is a field (or enum value).
  const BLOCK_KEYWORDS = new Set(['note', 'indexes', 'ref']);
  const SETTINGS = new Set([
    'pk', 'primary', 'key', 'unique', 'not', 'null', 'increment', 'default', 'note', 'ref', 'headercolor', 'color',
    'delete', 'update', 'cascade', 'restrict', 'set', 'no', 'action', 'name', 'type', 'true', 'false',
  ]);

  const TOKEN = new RegExp(
    [
      /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/, // 1 comment
      /('''[\s\S]*?(?:'''|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?)/, // 2 string / quoted name
      /(`[^`]*`?)/, // 3 expression
      /(#[0-9a-fA-F]{3,8}\b)/, // 4 colour
      /(\b\d+(?:\.\d+)?\b)/, // 5 number
      /([A-Za-z_]\w*)/, // 6 word
      /(<>|[<>-])/, // 7 ref operator
      /([[\]{}])/, // 8 bracket
      /(\n)/, // 9 newline
      /([^\S\n]+|.)/, // 10 anything else
    ]
      .map((r) => r.source)
      .join('|'),
    'g',
  );

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (cls, text) => `<span class="hl-${cls}">${esc(text)}</span>`;

  function highlightDbml(src) {
    let out = '';
    let braces = 0;
    let brackets = 0;
    let wordInLine = 0; // words (and quoted names) seen on this line, outside [settings]
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      const [text, comment, string, expr, colour, number, word, op, bracket, newline] = m;
      if (comment) out += span('comment', text);
      else if (string) {
        if (!brackets && braces && !text.startsWith("'''")) wordInLine++;
        out += span(brackets || text.startsWith("'") ? 'string' : wordInLine === 2 ? 'type' : 'name', text);
      } else if (expr) out += span('expr', text);
      else if (colour) out += span('colour', text);
      else if (number) out += span('number', text);
      else if (word) {
        const lower = word.toLowerCase();
        if (brackets) out += SETTINGS.has(lower) ? span('setting', text) : esc(text);
        else {
          wordInLine++;
          const opensBlock = /^\s*[:{[]/.test(src.slice(TOKEN.lastIndex, TOKEN.lastIndex + 40));
          if (!braces) out += KEYWORDS.has(lower) ? span('keyword', text) : esc(text);
          else if (wordInLine === 1 && BLOCK_KEYWORDS.has(lower) && opensBlock) out += span('keyword', text);
          else if (wordInLine === 1) out += span('name', text);
          else if (wordInLine === 2) out += span('type', text);
          else out += esc(text);
        }
      } else if (op) out += span('op', text);
      else if (bracket) {
        if (text === '{') braces++;
        else if (text === '}') braces = Math.max(0, braces - 1);
        else if (text === '[') brackets++;
        else brackets = Math.max(0, brackets - 1);
        out += span('punct', text);
      } else if (newline) {
        wordInLine = 0;
        out += text;
      } else out += esc(text);
    }
    return out;
  }

  OD.highlightDbml = highlightDbml;
})((window.OD = window.OD || {}));
