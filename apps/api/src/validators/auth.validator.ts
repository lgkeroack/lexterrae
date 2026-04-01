import { z } from 'zod';

export const googleCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  redirectUri: z.string().url('Redirect URI must be a valid URL'),
});

export type GoogleCallbackInput = z.infer<typeof googleCallbackSchema>;
