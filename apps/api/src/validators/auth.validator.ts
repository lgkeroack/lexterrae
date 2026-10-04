import { z } from 'zod';

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required', invalid_type_error: 'Email must be a string' })
    .trim()
    .toLowerCase()
    .email('Must be a valid email address')
    .max(255, 'Email must be 255 characters or fewer'),
  password: z
    .string({ required_error: 'Password is required', invalid_type_error: 'Password must be a string' })
    .min(12, 'Password must be at least 12 characters long')
    .max(128, 'Password must be 128 characters or fewer')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one digit')
    .regex(
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
      'Password must contain at least one special character',
    ),
  displayName: z
    .string({ required_error: 'Display name is required', invalid_type_error: 'Display name must be a string' })
    .trim()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or fewer'),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required', invalid_type_error: 'Email must be a string' })
    .trim()
    .toLowerCase()
    .email('Must be a valid email address'),
  password: z
    .string({ required_error: 'Password is required', invalid_type_error: 'Password must be a string' })
    .min(1, 'Password is required')
    .max(1024, 'Password is too long'),
});

// The refresh token may instead arrive in the httpOnly cookie, so it is optional in the body
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(4096).optional(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(4096).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
