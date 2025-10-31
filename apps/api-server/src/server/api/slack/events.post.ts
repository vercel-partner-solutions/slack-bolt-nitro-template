import { createHandler } from '@vercel/slack-bolt';
import { eventHandler, readRawBody, getRequestURL } from 'h3';
import { app, receiver } from '../../../bolt/app';

const handler = createHandler(app, receiver);

export default eventHandler(async (event) => {
  // Get the raw body buffer for signature verification
  const rawBody = await readRawBody(event, false);
  
  // Handle URL verification challenge explicitly before initializing Bolt
  // This prevents initialization errors when Slack verifies the event subscription URL
  if (rawBody) {
    try {
      const bodyText = rawBody.toString('utf-8');
      const body = JSON.parse(bodyText);
      
      // Check if this is a URL verification challenge
      if (body.type === 'url_verification' && body.challenge) {
        console.log('[Events] Handling URL verification challenge');
        return { challenge: body.challenge };
      }
    } catch (error) {
      // If body parsing fails, continue with normal handler
      // This could be a malformed request or non-JSON payload
      console.warn('[Events] Failed to parse request body for URL verification check:', error);
    }
  }
  
  // Get the full URL from the request
  const url = getRequestURL(event);
  
  // Create a Web Request with the raw body
  const request = new Request(url, {
    method: event.node.req.method,
    headers: event.node.req.headers as HeadersInit,
    body: rawBody,
  });
  
  return await handler(request);
});
