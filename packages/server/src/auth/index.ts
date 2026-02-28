export {
  createAuthContext,
  jwtProvider,
  customProvider,
  tokenProvider,
  defineRlsPolicy,
  AuthenticationError,
  AuthorizationError,
} from "./auth.js"
export type { AuthContext, AuthProvider, JwtProviderOptions, RlsPolicy } from "./auth.js"

// Zero-Config Auth Providers
export {
  googleAuth,
  githubAuth,
  magicLinkAuth,
  anonymousAuth,
  multiProvider,
  autoDetectProviders,
  zeroConfigAuth,
  generateMagicLinkToken,
} from "./zero-config-providers.js"

export type {
  ZeroConfigProviderOptions,
  GoogleAuthOptions,
  GitHubAuthOptions,
  MagicLinkAuthOptions,
  AnonymousAuthOptions,
  MultiProviderOptions,
  ProviderDetectionResult,
} from "./zero-config-providers.js"
