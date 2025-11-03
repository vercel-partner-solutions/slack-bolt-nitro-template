/**
 * Type declarations for slack-mrkdwn package
 * 
 * This package converts Slack's mrkdwn format to HTML
 * Package: https://github.com/gooody/slack-mrkdwn
 */
declare module 'slack-mrkdwn' {
  /**
   * Converter for texts from Slack mrkdwn format to HTML
   */
  export class SlackMarkdownConverter {
    /**
     * @param src - Incoming string in the Slack mrkdwn format
     */
    constructor(src: string);

    /**
     * Render HTML elements into a shared container (div) with a class 'slack-markdown'
     * @returns HTML string wrapped in <div class="slack-markdown">
     */
    toHtml(): string;

    /**
     * Render HTML elements without shared container
     * @returns Raw HTML string
     */
    innerHtml(): string;
  }
}

