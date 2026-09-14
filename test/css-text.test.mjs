import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDeclarations, formatDeclarations, parseStylesheet, formatStylesheet, stylesheetCss, isSafeSelector, writeRule,
} from '../src/shared/css-text.js';

test('declarations round trip through text', () => {
  const css = formatDeclarations({ 'border-radius': '12px', color: '#fff' });
  assert.equal(css, 'border-radius: 12px;\ncolor: #fff;');
  assert.deepEqual(parseDeclarations(css).properties, { 'border-radius': '12px', color: '#fff' });
});

test('a bad line does not spoil the block', () => {
  // Someone typing five declarations and misspelling one wants the four to land. Refusing
  // the lot would make the editor harder to use without making it any safer.
  const { properties, errors } = parseDeclarations('color: red; nonsense: 3; padding: 4px');
  assert.deepEqual(properties, { color: 'red', padding: '4px' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not an editable property/);
});

test('written CSS is held to exactly the same rules as a widget', () => {
  const { properties, errors } = parseDeclarations('background-image: url(https://evil.example/x);');
  assert.deepEqual(properties, {}, 'text is reach, not permission');
  assert.equal(errors.length, 1);
});

test('!important is not the author’s to give', () => {
  // The editor decides when a rule needs it, from what the site's stylesheets are doing.
  // Taking it from the text would let a declaration outrank the guarantees set after it.
  assert.deepEqual(parseDeclarations('color: red !important;').properties, { color: 'red' });
});

test('a selector is a selector and nothing else', () => {
  assert.ok(isSafeSelector('.card:hover > a::before'));
  assert.ok(isSafeSelector('table tr:nth-child(2n) td'));
  assert.equal(isSafeSelector('.a { } .b'), false, 'cannot close its own rule');
  assert.equal(isSafeSelector('@import url(x)'), false);
  assert.equal(isSafeSelector('[data-webin] *'), false, 'the extension is not a target');
});

test('a stylesheet keeps its rules, its media queries and its complaints', () => {
  const { rules, errors } = parseStylesheet(`
    /* a note */
    .hero h1 { letter-spacing: -0.02em; }
    @media (max-width: 600px) { .card { padding: 8px } }
    [data-webin] { display: none }
  `);

  assert.equal(rules.length, 2);
  assert.equal(rules[0].selector, '.hero h1');
  assert.equal(rules[1].media, '@media (max-width: 600px)');
  assert.equal(errors.length, 1, 'and says what it would not write');
});

test('a rule that is never closed is reported, not guessed at', () => {
  const { rules, errors } = parseStylesheet('.a { color: red;');
  assert.equal(rules.length, 0);
  assert.match(errors[0], /never closed/);
});

test('a media query inside a media query is refused plainly', () => {
  // Legal CSS, and not worth the parser it would take. Half-supporting it would be worse.
  const { rules, errors } = parseStylesheet('@media print { @media (min-width: 10px) { .a { color: red } } }');
  assert.equal(rules.length, 0);
  assert.equal(errors.length, 1);
});

test('injected CSS marks every declaration important', () => {
  // The whole reason to write one of these is to overrule the site. Marking them all keeps
  // ordinary specificity working between the author's own rules, which is what they expect.
  const { rules } = parseStylesheet('.a { color: red } @media print { .b { color: blue } }');
  const css = stylesheetCss(rules);
  assert.match(css, /:is\(\.a\)[^{]*\{ color: red !important; \}/);
  assert.match(css, /@media print \{ :is\(\.b\)[^{]*\{ color: blue !important; \} \}/);
});

test('injected CSS is raised above the theme, and a pseudo-element stays outside', () => {
  // `footer { color: red }` is (0,0,1); the theme's marks are (0,1,0) and (0,2,0) and all
  // `!important`. Typed as written it would lose on every one, the panel would say it was
  // live, and nothing would change. Two attributes nobody has lift it above the theme.
  const { rules } = parseStylesheet('footer { color: red } .card::before { content: "★" } ::selection { color: red } a, b::after { color: blue }');
  const css = stylesheetCss(rules);
  assert.match(css, /^:is\(footer\):not\(\[data-webin-raise\]\):not\(\[data-webin-raise\]\) \{/m);
  assert.match(css, /:is\(\.card\):not\(\[data-webin-raise\]\):not\(\[data-webin-raise\]\)::before \{/);
  assert.match(css, /^::selection \{/m, 'a bare pseudo-element is left alone');
  assert.match(css, /:is\(a\):not[^,]*, :is\(b\):not[^{]*::after \{/, 'each member of a list on its own');
});

test('rules can be written back out as CSS someone could edit', () => {
  const { rules } = parseStylesheet('.a{color:red}');
  assert.equal(formatStylesheet(rules), '.a {\n  color: red;\n}');
});

test('against the site\'s own rule, only what differs is a change', () => {
  // A line left as the site wrote it is still the site's line; so is a line removed. And
  // a line the site wrote that the editor would never write — `font: inherit` — is passed
  // over rather than refused, since nobody asked for it to be written.
  const { properties, errors } = parseDeclarations(
    'color: RED; padding: 3px; margin: 0; font: inherit; behavior: url(x);',
    { base: { color: 'red', padding: '2px', gap: '1px', font: 'inherit' } },
  );
  assert.deepEqual(properties, { padding: '3px', margin: '0' });
  assert.equal(errors.length, 1, 'a changed line is still held to the gate');
  assert.match(errors[0], /behavior/);
});

test('a rule is written into the stylesheet without the rest being touched', () => {
  const start = '/* mine */\n.x{padding:4px}\n';
  const added = writeRule(start, { selector: '.buy', properties: { color: 'red' } });
  assert.equal(added, '/* mine */\n.x{padding:4px}\n\n.buy {\n  color: red;\n}\n',
    'appended, and the comment and the compact rule are exactly as they were');

  const replaced = writeRule(added, { selector: '.buy', properties: { color: 'blue', gap: '1px' } });
  assert.match(replaced, /\.buy \{\n {2}color: blue;\n {2}gap: 1px;\n\}/, 'rewritten in place');
  assert.equal(replaced.indexOf('/* mine */'), 0);
  assert.equal((replaced.match(/\.buy \{/g) ?? []).length, 1, 'one rule, not one per edit');

  const removed = writeRule(replaced, { selector: '.buy', properties: {} });
  assert.equal(removed, '/* mine */\n.x{padding:4px}\n', 'gone, with its blank line');
});

test('a rule added after a half-typed one is still read', () => {
  // Appended after `.b {` it would sit inside the unfinished rule and never be parsed;
  // so it goes in front, and the draft is left exactly as it was.
  const text = writeRule('.b { ', { selector: '.buy', properties: { color: 'red' } });
  assert.equal(text, '.buy {\n  color: red;\n}\n\n.b { ');
  assert.equal(parseStylesheet(text).rules.length, 1);
});

test('a rule inside a breakpoint stays nested, and takes the block with it when it goes', () => {
  let text = writeRule('', { selector: '.card', media: '@media (max-width: 600px)', properties: { padding: '8px' } });
  assert.equal(text, '@media (max-width: 600px) {\n  .card {\n    padding: 8px;\n  }\n}\n');

  // The same breakpoint however it was spaced is the same breakpoint.
  text = writeRule(text, { selector: '.card', media: '@media (max-width:600px)', properties: { padding: '9px' } });
  assert.equal((text.match(/@media/g) ?? []).length, 1);
  assert.match(text, /\n {4}padding: 9px;\n {2}\}/);

  text = writeRule(text, { selector: '.card', media: '@media (max-width: 600px)', properties: {} });
  assert.equal(text, '', 'an emptied media block is not left behind');
});

test('a rule with the same selector at a different breakpoint is a different rule', () => {
  let text = writeRule('', { selector: '.card', properties: { padding: '8px' } });
  text = writeRule(text, { selector: '.card', media: '@media print', properties: { padding: '0' } });
  const { rules } = parseStylesheet(text);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((r) => r.media), [null, '@media print']);
});
