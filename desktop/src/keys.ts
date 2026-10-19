// The public keys the shell trusts for bundles and installers
// (features/desktop-updates.md). The private half of "lwtree-1" lives only
// on the machine that publishes (scripts/make-bundle-key.mjs).

import type { TrustedKeys } from './bundle-format'

export const TRUSTED_KEYS: TrustedKeys = {
  'lwtree-1': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3Q08ZS/GylVvRGv9mqWPUa+DZYqYCnSOWPK9BZ29QWk=
-----END PUBLIC KEY-----
`,
}

/** Where updates come from, unless the build says otherwise (desktop/update.json). */
export const DEFAULT_UPDATE = { url: 'https://xcom.innonova.ch', channel: 'staging' }
