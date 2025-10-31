import { App } from '@slack/bolt';
import { VercelReceiver } from '@vercel/slack-bolt';
import registerListeners from './listeners';
import { installationStore } from './utils/installation-store';
import { validateInstallation } from './middleware/validate-installation';

const receiver = new VercelReceiver();

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  installationStore,
  installerOptions: {
    // We're handling OAuth manually in the dashboard, so disable Bolt's built-in OAuth
    directInstall: true,
  },
  receiver,
  deferInitialization: true,
});

// Validate installations before processing events
app.use(validateInstallation);

registerListeners(app);

export { app, receiver };
