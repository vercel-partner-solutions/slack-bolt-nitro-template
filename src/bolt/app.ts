import { App } from '@slack/bolt';
import { VercelReceiver } from '@vercel/slack-bolt';
import { installationStore } from './installation-store';
import { installer } from './installer';
import registerListeners from './listeners';

const receiver = new VercelReceiver();

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  installationStore,
  receiver,
  deferInitialization: true,
  authorize: installer.authorize,
});

registerListeners(app);

export { app, receiver };
