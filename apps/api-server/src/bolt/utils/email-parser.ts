import type { InboundWebhookPayload } from '@inboundemail/sdk';
import EmailReplyParser from 'email-reply-parser';
import TurndownService from 'turndown';

/**
 * Email content parser for Slack
 *
 * Converts HTML emails to Slack mrkdwn format and extracts images.
 * Removes quoted text and signatures using email-reply-parser.
 */

interface ParsedEmailContent {
  text: string;
  images: string[];
}

/**
 * Clean HTML by removing non-content elements (style, script, head tags)
 */
function cleanHtmlStructure(html: string): string {
  let cleaned = html;

  // Remove <style> tags and their content
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove <script> tags and their content
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove <head> section entirely
  cleaned = cleaned.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');

  // Remove meta tags
  cleaned = cleaned.replace(/<meta[^>]*>/gi, '');

  return cleaned;
}

/**
 * Remove common email signatures and tracking elements from HTML
 * Uses a cut-at-marker approach for maximum effectiveness
 */
function removeSignaturesFromHtml(html: string): string {
  let cleaned = html;

  // Strategy 1: Cut everything from signature markers onwards
  // Gmail signatures (data-smartmail="gmail_signature") - cut everything after this marker
  const gmailSigMarker = cleaned.indexOf('data-smartmail="gmail_signature"');
  if (gmailSigMarker !== -1) {
    // Find the start of the div containing this attribute
    let divStart = gmailSigMarker;
    while (divStart > 0 && cleaned.substring(divStart, divStart + 4) !== '<div') {
      divStart--;
    }
    
    // Also look for the Gmail signature prefix that comes before (usually <span class="gmail_signature_prefix">-- </span>)
    // Search backwards from divStart to find and remove it
    const beforeSignature = cleaned.substring(0, divStart);
    const prefixMarker = beforeSignature.lastIndexOf('gmail_signature_prefix');
    if (prefixMarker !== -1) {
      // Find the opening tag before the prefix marker
      let prefixStart = prefixMarker;
      while (prefixStart > 0 && cleaned.charAt(prefixStart) !== '<') {
        prefixStart--;
      }
      if (prefixStart > 0) {
        cleaned = cleaned.substring(0, prefixStart);
      }
    } else if (divStart > 0) {
      cleaned = cleaned.substring(0, divStart);
    }
  }

  // WiseStamp signatures - cut from marker
  const wisestampMarker = cleaned.toLowerCase().indexOf('wisestamp');
  if (wisestampMarker !== -1) {
    // Find the previous opening tag
    let tagStart = wisestampMarker;
    while (tagStart > 0 && cleaned.charAt(tagStart) !== '<') {
      tagStart--;
    }
    if (tagStart > 0) {
      cleaned = cleaned.substring(0, tagStart);
    }
  }

  // "Create your own email signature" - cut from here
  const createSigMarker = cleaned.toLowerCase().indexOf('create your own');
  if (createSigMarker !== -1) {
    let tagStart = createSigMarker;
    while (tagStart > 0 && cleaned.charAt(tagStart) !== '<') {
      tagStart--;
    }
    if (tagStart > 0) {
      cleaned = cleaned.substring(0, tagStart);
    }
  }

  // Outlook "Get Outlook" signatures
  const getOutlookMarker = cleaned.toLowerCase().indexOf('get outlook');
  if (getOutlookMarker !== -1) {
    let tagStart = getOutlookMarker;
    while (tagStart > 0 && cleaned.charAt(tagStart) !== '<') {
      tagStart--;
    }
    if (tagStart > 0) {
      cleaned = cleaned.substring(0, tagStart);
    }
  }

  // Strategy 2: Remove tracking pixels and artifacts
  cleaned = cleaned.replace(/<img[^>]*tracy\.srv[^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*alt="__tpx__"[^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*width="1"[^>]*height="1"[^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*height="1"[^>]*width="1"[^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*wisestamp[^>]*>/gi, '');

  // Remove empty tables used for tracking/spacing
  cleaned = cleaned.replace(/<table[^>]*cellspacing="0"[^>]*cellpadding="0"[^>]*>[\s\S]*?<\/table>/gi, '');

  // Strategy 3: Remove common signature separators and everything after
  cleaned = cleaned.replace(/(<br\s*\/?>\s*)*--\s*(<br|<div)[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/(<div[^>]*>\s*)*--\s*<\/div>[\s\S]*$/gi, '');

  // "Sent from" signatures (mobile and Outlook)
  cleaned = cleaned.replace(/<div[^>]*>Sent from my (iPhone|iPad|Android|BlackBerry)[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/Sent from my (iPhone|iPad|Android|BlackBerry).*/gi, '');
  cleaned = cleaned.replace(/<div[^>]*>Sent from (Outlook|Mail)[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/Sent from (Outlook|Mail).*/gi, '');

  // Strategy 4: Clean up excessive empty elements
  cleaned = cleaned.replace(/(<div[^>]*>\s*<\/div>\s*)+/gi, '');
  cleaned = cleaned.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  cleaned = cleaned.replace(/(<div[^>]*>\s*<br\s*\/?>\s*<\/div>)+/gi, '');
  
  // Remove trailing breaks and empty elements at the end
  cleaned = cleaned.replace(/(<br\s*\/?>\s*)+$/gi, '');
  cleaned = cleaned.replace(/(<span[^>]*>\s*<\/span>\s*)+$/gi, '');

  return cleaned.trim();
}

/**
 * Remove blockquote/quoted sections from HTML before extracting images
 * This prevents images from quoted emails (replies) from being included
 */
function removeBlockquotesFromHtml(html: string): string {
  let cleaned = html;

  // Remove blockquote elements (commonly used for quoted replies)
  // This handles both <blockquote> and <blockquote type="cite"> (Apple Mail format)
  cleaned = cleaned.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');

  // Also handle quoted content in divs with cite attributes
  cleaned = cleaned.replace(/<div[^>]*type=["']cite["'][^>]*>[\s\S]*?<\/div>/gi, '');

  return cleaned;
}

/**
 * Extract image URLs from HTML content
 * NOTE: Images within blockquotes/quoted sections are excluded
 */
function extractImagesFromHtml(html: string): string[] {
  // First, remove blockquotes to exclude images from quoted/replied-to emails
  const htmlWithoutQuotes = removeBlockquotesFromHtml(html);

  const images: string[] = [];

  // Simple regex to extract img src URLs
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null = imgRegex.exec(htmlWithoutQuotes);

  while (match !== null) {
    const url = match[1];
    // Only include http/https images (skip data: URIs, relative paths, and tracking pixels)
    if (
      (url.startsWith('http://') || url.startsWith('https://')) &&
      !url.includes('tracy.srv') && // Skip WiseStamp tracking
      !url.includes('tracking') &&
      !url.includes('pixel')
    ) {
      images.push(url);
    }
    match = imgRegex.exec(htmlWithoutQuotes);
  }

  return images;
}

/**
 * Convert HTML to Slack mrkdwn format
 */
function htmlToSlackMrkdwn(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });

  // Custom rule for links: Convert to Slack format <url|text>
  turndownService.addRule('slackLinks', {
    filter: 'a',
    replacement: (content: string, node: Node) => {
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute('href');
      if (!href) return content;

      // Slack link format: <url|text>
      // If link text is the same as URL, just use <url>
      if (content === href) {
        return `<${href}>`;
      }
      return `<${href}|${content}>`;
    },
  });

  // Custom rule to remove images (we handle them separately)
  turndownService.addRule('removeImages', {
    filter: 'img',
    replacement: () => '',
  });

  // Convert HTML to markdown
  let markdown = turndownService.turndown(html);

  // Convert markdown bold (**) to Slack bold (*)
  markdown = markdown.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Clean up excessive newlines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  return markdown.trim();
}

/**
 * Parse email content and return cleaned text with images
 *
 * Priority:
 * 1. cleanedContent.html (converted to mrkdwn)
 * 2. cleanedContent.text (with reply parser)
 * 3. parsedData.textBody (with reply parser)
 */
export function parseEmailContent(email: InboundWebhookPayload['email']): ParsedEmailContent {
  let text = '';
  let images: string[] = [];

  // Try cleanedContent.html first (best for rich formatting)
  if (email.cleanedContent?.html && email.cleanedContent.hasHtml) {
    let html = email.cleanedContent.html;

    console.log('[EMAIL PARSER] 📄 Original HTML content:');
    console.log('='.repeat(80));
    console.log(html);
    console.log('='.repeat(80));

    // Clean HTML structure (remove style, script, head tags)
    html = cleanHtmlStructure(html);

    console.log('[EMAIL PARSER] 🧼 After structure cleanup (removed style/script tags):');
    console.log('='.repeat(80));
    console.log(html);
    console.log('='.repeat(80));

    // Remove signatures from HTML before processing
    html = removeSignaturesFromHtml(html);

    console.log('[EMAIL PARSER] 🧹 After signature removal:');
    console.log('='.repeat(80));
    console.log(html);
    console.log('='.repeat(80));

    // Extract images before converting
    images = extractImagesFromHtml(html);

    // Convert HTML to Slack mrkdwn
    text = htmlToSlackMrkdwn(html);

    console.log('[EMAIL PARSER] 📝 Converted to markdown (before reply parser):');
    console.log('='.repeat(80));
    console.log(text);
    console.log('='.repeat(80));

    // Apply email-reply-parser to remove any remaining quotes
    try {
      const parsed = new EmailReplyParser().read(text);
      text = parsed.getVisibleText().trim();
      console.log('[EMAIL PARSER] ✂️  After reply parser (removed signatures/quotes):');
      console.log('='.repeat(80));
      console.log(text);
      console.log('='.repeat(80));
    } catch (error) {
      // If parser fails, use the converted text as-is
      console.warn('Email reply parser failed on HTML content:', error);
    }

    // Final cleanup: Remove any remaining signature separators
    text = text.replace(/\s*\\?--\s*$/g, ''); // Remove trailing -- or \--
    text = text.replace(/\n{3,}/g, '\n\n'); // Clean up excessive newlines
    text = text.trim();
  }
  // Fall back to cleanedContent.text
  else if (email.cleanedContent?.text && email.cleanedContent.hasText) {
    text = email.cleanedContent.text;

    // Apply email-reply-parser
    try {
      const parsed = new EmailReplyParser().read(text);
      text = parsed.getVisibleText().trim();
    } catch (error) {
      console.warn('Email reply parser failed on cleaned text:', error);
      text = text.trim();
    }

    // Final cleanup
    text = text.replace(/\s*\\?--\s*$/g, '');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
  }
  // Last resort: parsedData.textBody
  else if (email.parsedData?.textBody) {
    text = email.parsedData.textBody;

    // Apply email-reply-parser to strip quotes
    try {
      const parsed = new EmailReplyParser().read(text);
      text = parsed.getVisibleText().trim();
    } catch (error) {
      console.warn('Email reply parser failed on parsed text:', error);
      text = text.trim();
    }

    // Final cleanup
    text = text.replace(/\s*\\?--\s*$/g, '');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
  }
  // Ultimate fallback
  else {
    text = '(No content)';
  }

  return {
    text,
    images,
  };
}
