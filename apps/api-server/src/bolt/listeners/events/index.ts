import type { App } from '@slack/bolt';
import { appHomeOpenedCallback } from './app-home-opened';
import { appUninstalled } from './app-uninstalled';

const register = (app: App) => {
  app.event('app_home_opened', appHomeOpenedCallback);
  app.event('app_uninstalled', appUninstalled);
};

export default { register };
