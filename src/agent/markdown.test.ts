import { describe, expect, it } from 'bun:test';
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown';

/** A compact HTML-like form of parsed markdown, to keep expectations readable. */
function inline(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return node.text;
        case 'code':
          return `<code>${node.text}</code>`;
        case 'strong':
          return `<b>${inline(node.children)}</b>`;
        case 'em':
          return `<i>${inline(node.children)}</i>`;
        case 'link':
          return `<a ${node.href}>${inline(node.children)}</a>`;
      }
    })
    .join('');
}

function blocks(nodes: readonly Block[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'paragraph':
          return `<p>${node.lines.map(inline).join('<br>')}</p>`;
        case 'heading':
          return `<h>${inline(node.children)}</h>`;
        case 'code':
          return `<pre>${node.text}</pre>`;
        case 'rule':
          return '<hr>';
        case 'list': {
          const tag = node.ordered ? `ol${node.start === 1 ? '' : ` ${node.start}`}` : 'ul';
          return `<${tag}>${node.items.map((item) => `<li>${blocks(item)}</li>`).join('')}</${tag.slice(0, 2)}>`;
        }
      }
    })
    .join('');
}

const md = (text: string): string => blocks(parseMarkdown(text));
const line = (text: string): string => inline(parseInline(text));

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(line('a **bold** and *italic* or _also_ with `code`')).toBe('a <b>bold</b> and <i>italic</i> or <i>also</i> with <code>code</code>');
    expect(line('__strong__ too')).toBe('<b>strong</b> too');
  });

  it('reads bold italic', () => {
    expect(line('***both***')).toBe('<b><i>both</i></b>');
    expect(line('**bold with *italic* inside**')).toBe('<b>bold with <i>italic</i> inside</b>');
  });

  it('keeps unmatched or loose markers as they are', () => {
    expect(line('**not closed')).toBe('**not closed');
    expect(line('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(line('a * b')).toBe('a * b');
    expect(line('` lone backtick')).toBe('` lone backtick');
  });

  it('leaves underscores inside words alone', () => {
    expect(line('brick_count and snake_case_name')).toBe('brick_count and snake_case_name');
  });

  it('keeps code spans exactly as written', () => {
    expect(line('`a **b** _c_`')).toBe('<code>a **b** _c_</code>');
    expect(line('``a ` b``')).toBe('<code>a ` b</code>');
    expect(line('` padded `')).toBe('<code>padded</code>');
  });

  it('links only to web addresses', () => {
    expect(line('see [the docs](https://example.com/a_b) now')).toBe('see <a https://example.com/a_b>the docs</a> now');
    expect(line('[**bold** link](http://example.com)')).toBe('<a http://example.com><b>bold</b> link</a>');
    expect(line('[click](javascript:alert(1))')).toBe('[click](javascript:alert(1))');
    expect(line('[file](/etc/passwd)')).toBe('[file](/etc/passwd)');
  });

  it('honours backslash escapes', () => {
    expect(line('\\*not italic\\* and \\`not code\\`')).toBe('*not italic* and `not code`');
    expect(line('a \\ b')).toBe('a \\ b');
  });

  it('skips code spans when looking for the end of bold or italic', () => {
    expect(line('**Use `*args` and `**kwargs` here**')).toBe('<b>Use <code>*args</code> and <code>**kwargs</code> here</b>');
    expect(line('*see `a*b`*')).toBe('<i>see <code>a*b</code></i>');
    // and over escaped markers
    expect(line('**a \\** b**')).toBe('<b>a ** b</b>');
  });

  it('reads emphasis nested only so deep, as text below that', () => {
    // a run of stars before text opens bold after bold, two stars at a time
    expect(depthOf(parseInline(`${'*'.repeat(400)}x`))).toBe(8);
    expect(line(`${'*'.repeat(19_000)}x`)).toEndWith('x');
  });

  it('treats HTML as plain text', () => {
    expect(line('<b>hi</b> <script>x</script>')).toBe('<b>hi</b> <script>x</script>');
    expect(parseInline('<b>hi</b>')).toEqual([{ kind: 'text', text: '<b>hi</b>' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs at blank lines and keeps line breaks inside them', () => {
    expect(md('One.\n\nTwo\nthree.')).toBe('<p>One.</p><p>Two<br>three.</p>');
    expect(md('')).toBe('');
    expect(md('\n\n  \n')).toBe('');
  });

  it('reads the summary lists agents write', () => {
    expect(md('The roof is now grey.\n\n- **Roof:** all 16 roof plates\n- **Fence:** white')).toBe(
      '<p>The roof is now grey.</p><ul><li><p><b>Roof:</b> all 16 roof plates</p></li><li><p><b>Fence:</b> white</p></li></ul>',
    );
  });

  it('starts a list straight after a line of text', () => {
    expect(md('Done:\n* a\n+ b')).toBe('<p>Done:</p><ul><li><p>a</p></li><li><p>b</p></li></ul>');
  });

  it('numbers ordered lists from their first number', () => {
    expect(md('1. one\n2. two')).toBe('<ol><li><p>one</p></li><li><p>two</p></li></ol>');
    expect(md('3) three\n4) four')).toBe('<ol 3><li><p>three</p></li><li><p>four</p></li></ol>');
  });

  it('nests indented lists', () => {
    expect(md('- a\n  - b\n  - c\n- d')).toBe('<ul><li><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></li><li><p>d</p></li></ul>');
    expect(md('1. step\n   - detail')).toBe('<ol><li><p>step</p><ul><li><p>detail</p></li></ul></li></ol>');
  });

  it('keeps a list together across blank lines between its items', () => {
    expect(md('- a\n\n- b\n\nAfter.')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul><p>After.</p>');
  });

  it('continues an item on its following lines', () => {
    expect(md('- first line\n  second line\nlazy line')).toBe('<ul><li><p>first line<br>second line<br>lazy line</p></li></ul>');
  });

  it('keeps an indented paragraph after a blank line in its item', () => {
    expect(md('- first\n\n  second paragraph\n\nAfter.')).toBe('<ul><li><p>first</p><p>second paragraph</p></li></ul><p>After.</p>');
  });

  it('reads tabs as indentation', () => {
    expect(md('- a\n\t- b')).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>');
  });

  it('ends a list where a different kind of list starts', () => {
    expect(md('- a\n1. b')).toBe('<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>');
  });

  it('reads headings and rules', () => {
    expect(md('## Summary ##\nText\n\n---\n\n#not a heading')).toBe('<h>Summary</h><p>Text</p><hr><p>#not a heading</p>');
  });

  it('keeps fenced code exactly, even unclosed', () => {
    expect(md('Run:\n```bash\nbun run agent\n  **as is**\n```\nThen ask.')).toBe('<p>Run:</p><pre>bun run agent\n  **as is**</pre><p>Then ask.</p>');
    expect(md('~~~\nopen')).toBe('<pre>open</pre>');
  });

  it('reads code fenced inside a list item', () => {
    expect(md('- run:\n  ```\n  bun test\n  ```')).toBe('<ul><li><p>run:</p><pre>bun test</pre></li></ul>');
  });

  it('copes with Windows line endings', () => {
    expect(md('a\r\n\r\n- b\r\n- c')).toBe('<p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul>');
  });

  it('nests lists only so deep, reading deeper markers as text', () => {
    const blocks = parseMarkdown('- '.repeat(50_000) + 'x');
    let depth = 0;
    for (let list = blocks[0]; list?.kind === 'list'; list = list.items[0]?.[0]) depth++;
    expect(depth).toBe(8);
  });
});

describe('reading replies from outside the app', () => {
  // replies may hold up to 100,000 characters; each of these took seconds to read before
  const awkward: readonly [string, string][] = [
    ['unmatched stars', '*a '.repeat(33_333)],
    ['unmatched brackets', '[a'.repeat(50_000)],
    ['a heading with a long gap', `# x${' '.repeat(100_000)}# y`],
    ['blank lines inside a list item', `- a${'\n'.repeat(100_000)}  b`],
    ['unmatched backticks', '`a '.repeat(33_333)],
    ['nested list markers', '- '.repeat(50_000)],
    ['a long run of stars', '*'.repeat(100_000)],
  ];
  it.each(awkward)('reads %s in linear time', (_, text) => {
    const start = performance.now();
    parseMarkdown(text);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

/** How deeply emphasis and links nest. */
function depthOf(nodes: readonly Inline[]): number {
  return Math.max(0, ...nodes.map((node) => ('children' in node ? 1 + depthOf(node.children) : 0)));
}
