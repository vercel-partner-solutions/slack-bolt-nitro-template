import { Inbound } from '@inboundemail/sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const inbound = new Inbound(process.env.INBOUND_API_KEY || '');

const email = inbound.email.send({
  to: 'slack@inbound.new',
  subject: 'Test Email',
  text: 'This is a test email from the script',
  from: 'ryan@inbound.new',
});

console.log('Email sent:', email);
