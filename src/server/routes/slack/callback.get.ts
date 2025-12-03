import { defineEventHandler } from 'h3';
import { installer } from '../../../bolt/installer';

export default defineEventHandler(async (event) => {
  const req = event.node.req;
  const res = event.node.res;

  await installer.handleCallback(req, res);
});
