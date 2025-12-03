import { InstallProvider } from '@slack/oauth';
import { installationStore } from './installation-store';

const clientId = process.env.SLACK_CLIENT_ID;
if (!clientId) {
  throw new Error('Missing SLACK_CLIENT_ID environment variable');
}
const clientSecret = process.env.SLACK_CLIENT_SECRET;
if (!clientSecret) {
  throw new Error('Missing SLACK_CLIENT_SECRET environment variable');
}
const stateSecret = process.env.SLACK_STATE_SECRET;
if (!stateSecret) {
  throw new Error('Missing SLACK_STATE_SECRET environment variable');
}

export const installer = new InstallProvider({
  clientId,
  clientSecret,
  stateSecret,
  directInstall: true,
  installationStore,
  installUrlOptions: {
    scopes: ['channels:history', 'chat:write', 'commands'],
  },
});
