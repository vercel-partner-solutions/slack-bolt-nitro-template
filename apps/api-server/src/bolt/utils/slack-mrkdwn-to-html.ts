/**
 * Converts Slack markdown (mrkdwn) to HTML format for email replies
 * 
 * Handles:
 * - Bold: *text* -> <strong>text</strong>
 * - Italic: _text_ -> <em>text</em>
 * - Strikethrough: ~text~ -> <s>text</s>
 * - Code: `code` -> <code>code</code>
 * - Code blocks: ```code``` -> <pre><code>code</code></pre>
 * - Links: <url|text> -> <a href="url">text</a>
 * - Blockquotes: &gt; text -> <blockquote>text</blockquote>
 * - Line breaks and paragraphs
 * 
 * @param slackMarkdown - Slack markdown text to convert
 * @returns HTML formatted string
 */
export function convertSlackMarkdownToHtml(slackMarkdown: string): string {
  if (!slackMarkdown) {
    return '';
  }

  let html = slackMarkdown;

  // Escape HTML entities first to prevent XSS
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Handle code blocks first (```code```)
  html = html.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');

  // Handle inline code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Handle links <url|text> or <url>
  html = html.replace(/&lt;(https?:\/\/[^\|&gt;]+)\|([^&gt;]+)&gt;/g, '<a href="$1">$2</a>');
  html = html.replace(/&lt;(https?:\/\/[^&gt;]+)&gt;/g, '<a href="$1">$1</a>');

  // Handle bold (*text*)
  html = html.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');

  // Handle italic (_text_)
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Handle strikethrough (~text~)
  html = html.replace(/~([^~]+)~/g, '<s>$1</s>');

  // Handle blockquotes (&gt; at start of line)
  html = html.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');

  // Handle line breaks - convert double newlines to paragraphs
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map(para => {
      // Don't wrap pre, blockquote, or empty paragraphs
      if (para.trim().startsWith('<pre>') || 
          para.trim().startsWith('<blockquote>') || 
          para.trim() === '') {
        return para;
      }
      // Replace single newlines with <br> within paragraphs
      const withBreaks = para.replace(/\n/g, '<br>');
      return `<p>${withBreaks}</p>`;
    })
    .filter(p => p.trim() !== '')
    .join('\n');

  return html;
}

