import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().trim().max(254, 'Email is too long').pipe(z.email('Enter a valid email address')),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,20}$/, 'Username must be 3-20 letters, numbers or underscores'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128, 'Password is too long'),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
});

export const normalize = (s: string) => s.trim().toLowerCase();
