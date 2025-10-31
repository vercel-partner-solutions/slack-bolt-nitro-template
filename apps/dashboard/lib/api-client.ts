import { ofetch } from "ofetch";

/**
 * Authenticated API client for communication with the api-server
 * Automatically includes internal API key for authentication
 */
export const apiClient = ofetch.create({
  baseURL: process.env.BACKEND_API_URL,
  headers: {
    Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
  },
  // Retry on 5xx errors
  retry: 2,
  retryDelay: 500,
  // Timeout after 10 seconds
  timeout: 10000,
  onRequestError({ error }) {
    console.error("API request error:", error);
  },
  onResponseError({ response }) {
    console.error("API response error:", response.status, response.statusText);
  },
});

