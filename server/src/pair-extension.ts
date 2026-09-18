import { getLocalSyncToken } from './local-auth.js';

// Explicit user command; normal startup and HTTP responses never print this secret.
process.stdout.write(`${getLocalSyncToken()}\n`);
