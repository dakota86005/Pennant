/**
 * What a reader sees of rendered markup: the hovers' popups taken out (they are read on hover, not on the page), then
 * the tags, the entities decoded and the spaces collapsed. For the tests that keep jargon out of visible text
 * (AGENTS.md "Writing for the GM").
 */
export function visibleText(html: string): string {
  return html
    .replace(/<span class="tip-pop">[^<]*<\/span>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
