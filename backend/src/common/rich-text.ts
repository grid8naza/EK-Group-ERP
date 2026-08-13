/**
 * Rich text, made safe to store and to render.
 *
 * Circulars and broadcasts carry formatted bodies — bold, lists, the shape a
 * notice needs to be readable. That means storing HTML written by a user and
 * rendering it into somebody else's page, which is a stored cross-site
 * scripting hole unless the HTML is cut down to something that cannot carry
 * behaviour. So every body passes through here on the way IN, once, and what is
 * stored is already safe; nothing downstream has to remember to be careful.
 *
 * The rules are deliberately blunt, because a clever sanitiser is a sanitiser
 * with a bypass in it:
 *
 *   · a fixed allowlist of tags, all of them formatting;
 *   · EVERY attribute dropped — no style, no class, no href, no on*. There is no
 *     javascript: URL to filter if no URL survives at all;
 *   · a tag off the list is dropped but whatever it wrapped is kept, so a body
 *     never loses its words to its markup;
 *   · a stray `<` that begins no tag at all is escaped rather than swallowed
 *     (and a body typed in the editor arrives with its angle brackets already
 *     escaped, so writing "the <table> in the canteen" survives as written);
 *   · tags are balanced on the way out, so a half-written body cannot leave an
 *     open element that swallows the page around it.
 *
 * Links are not on the list. Internal notices link to nothing today, and a link
 * is the one formatting element that carries a destination — worth adding
 * deliberately, with its own scheme check, rather than by leaving `href` in.
 */

/** Formatting tags a body may keep. Everything here is inert. */
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'p',
  'br',
  'div',
  'span',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h3',
  'h4',
  'code',
  'pre',
  'sub',
  'sup',
]);

/** Tags that never close. */
const VOID_TAGS = new Set(['br']);

/**
 * Elements whose CONTENT goes too, not just their tags. Escaping the body of a
 * <script> would leave the code sitting in the notice as text, which is noise;
 * these carry nothing a reader wants.
 */
const DROP_WHOLE =
  /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;

/** Tags that end a line when the HTML is flattened back to plain text. */
const BLOCK_END = /<\/(p|div|li|h[1-6]|blockquote|pre)\s*>/gi;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Escape a run of text so it can never be read as markup.
 *
 * `&` is left alone when it already begins an entity — otherwise every save
 * would double-escape the last one (`&amp;` → `&amp;amp;` → …), and a body
 * would drift a little further from what was typed each time it was edited.
 */
function escapeText(text: string): string {
  return text
    .replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Cut a user-written body down to safe, balanced formatting HTML.
 *
 * Returns '' for an empty body, so "did they write anything" stays a simple
 * check rather than one that has to know about `<p><br></p>`.
 */
export function sanitizeRichText(input: string): string {
  if (!input) return '';

  const html = input.replace(DROP_WHOLE, '').replace(/<!--[\s\S]*?-->/g, '');

  const out: string[] = [];
  const open: string[] = [];
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    out.push(escapeText(html.slice(cursor, match.index)));
    cursor = match.index + match[0].length;

    const name = match[1].toLowerCase();
    const closing = match[0][1] === '/';
    // Not on the list: drop the tag itself, keep whatever it wrapped.
    if (!ALLOWED_TAGS.has(name)) continue;

    if (VOID_TAGS.has(name)) {
      if (!closing) out.push(`<${name}>`);
      continue;
    }

    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue; // a close with no open — drop it
      // Close anything opened inside it first, so the nesting comes out valid
      // however badly it went in.
      while (open.length > at) out.push(`</${open.pop()!}>`);
    } else {
      open.push(name);
      out.push(`<${name}>`);
    }
  }
  out.push(escapeText(html.slice(cursor)));
  while (open.length) out.push(`</${open.pop()!}>`);

  const result = out.join('');
  // A body of nothing but empty formatting — `<p><br></p>` is what an editor
  // somebody clicked into and out of produces — is an empty body. Storing it
  // would put a blank paragraph where the reader should be told there is no
  // text.
  return richTextToPlain(result) === '' ? '' : result;
}

/**
 * The same body as plain text — what searching, list previews and (later)
 * notifications read.
 *
 * Stored beside the HTML rather than worked out per query: `LIKE '%li%'` over
 * markup matches every bulleted notice in the group, and a list preview built
 * from HTML shows people their own tags back.
 */
export function richTextToPlain(html: string): string {
  if (!html) return '';
  const text = html
    .replace(DROP_WHOLE, '')
    .replace(BLOCK_END, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}
