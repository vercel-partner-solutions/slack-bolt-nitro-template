import { eventHandler, createError } from 'h3';

/**
 * Middleware to validate internal requests from the dashboard
 * Checks for INTERNAL_API_KEY in Authorization header
 */
export const validateInternalRequest = eventHandler(async (event) => {
  const authHeader = event.node.req.headers.authorization;
  const expectedAuth = `Bearer ${process.env.INTERNAL_API_KEY}`;
  
  if (!process.env.INTERNAL_API_KEY) {
    throw createError({
      statusCode: 500,
      message: 'INTERNAL_API_KEY not configured',
    });
  }
  
  if (authHeader !== expectedAuth) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized - Invalid internal API key',
    });
  }
  
  // Valid internal request, proceed
});

