export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Returned by POST /api/auth/register and /api/auth/login. The refresh token is also set as an
 * httpOnly `lt_refresh` cookie (path /api/auth); /refresh and /logout accept either source.
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken?: string;
}

/** Returned by POST /api/auth/refresh (the refresh token is rotated on every call). */
export interface TokenRefreshResponse {
  accessToken: string;
  refreshToken?: string;
}

/** Returned by GET /api/auth/me. */
export interface CurrentUserResponse {
  user: User;
}
