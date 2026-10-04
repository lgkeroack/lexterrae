import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, Circle, AlertCircle } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { PasswordInput } from '../common/PasswordInput';
import { useAuthStore } from '../../stores/authStore';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@lexterrae/shared';
import { getRedirectTarget } from './redirect';

// Mirrors registerSchema in apps/api/src/validators/auth.validator.ts.
const PASSWORD_REQUIREMENTS = [
  {
    label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    test: (p: string) => p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH,
  },
  { label: 'One uppercase letter (A–Z)', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter (a–z)', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One digit (0–9)', test: (p: string) => /\d/.test(p) },
  {
    label: 'One special character (e.g. ! @ # $ %)',
    test: (p: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p),
  },
];

const DISPLAY_NAME_MAX = 100;
const EMAIL_MAX = 255;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'displayName' | 'email' | 'password' | 'confirmPassword';
type FieldErrors = Partial<Record<Field, string>>;

const FIELD_IDS: Record<Field, string> = {
  displayName: 'register-name',
  email: 'register-email',
  password: 'register-password',
  confirmPassword: 'register-confirm',
};

export function RegisterForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { register, isLoading, error: storeError, clearError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (storeError) errorRef.current?.focus();
  }, [storeError]);

  const requirementResults = useMemo(
    () => PASSWORD_REQUIREMENTS.map((r) => ({ label: r.label, met: r.test(password) })),
    [password],
  );
  const allRequirementsMet = requirementResults.every((r) => r.met);
  const metCount = requirementResults.filter((r) => r.met).length;

  const clearFieldError = (field: Field) => {
    if (fieldErrors[field]) setFieldErrors((f) => ({ ...f, [field]: undefined }));
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    const name = displayName.trim();
    const mail = email.trim();
    if (!name) errors.displayName = 'Display name is required.';
    else if (name.length > DISPLAY_NAME_MAX)
      errors.displayName = `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`;
    if (!mail) errors.email = 'Email is required.';
    else if (!EMAIL_RE.test(mail)) errors.email = 'Enter a valid email address.';
    else if (mail.length > EMAIL_MAX)
      errors.email = `Email must be ${EMAIL_MAX} characters or fewer.`;
    if (!password) errors.password = 'Password is required.';
    else if (!allRequirementsMet)
      errors.password = 'Password does not meet all the requirements below.';
    if (!confirmPassword) errors.confirmPassword = 'Please confirm your password.';
    else if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const errors = validate();
    setFieldErrors(errors);
    const firstInvalid = (Object.keys(FIELD_IDS) as Field[]).find((f) => errors[f]);
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    try {
      await register({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
      });
      navigate(getRedirectTarget(location.state), { replace: true });
    } catch {
      // Error message is set by the store
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-busy={isLoading}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Create account</h2>
        <p className="mt-1 text-sm text-gray-600">Get started with Lex Terrae.</p>
      </div>

      {storeError && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 focus:outline-none"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-700">{storeError}</p>
        </div>
      )}

      <Input
        id={FIELD_IDS.displayName}
        label="Display name"
        value={displayName}
        onChange={(e) => {
          setDisplayName(e.target.value);
          clearFieldError('displayName');
        }}
        placeholder="Your name"
        required
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="name"
        autoFocus
        error={fieldErrors.displayName}
      />

      <Input
        id={FIELD_IDS.email}
        label="Email"
        type="email"
        inputMode="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          clearFieldError('email');
        }}
        placeholder="you@example.com"
        required
        maxLength={EMAIL_MAX}
        autoComplete="email"
        error={fieldErrors.email}
      />

      <div>
        <PasswordInput
          id={FIELD_IDS.password}
          label="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearFieldError('password');
          }}
          placeholder="Create a strong password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          aria-describedby="register-password-reqs"
          error={fieldErrors.password}
        />

        {/* Requirements are shown up front so users know the rules before typing. */}
        <div id="register-password-reqs" className="mt-2 rounded-md bg-gray-50 p-3">
          <p className="mb-1.5 text-xs font-medium text-gray-700">
            Password must include:
            <span className="sr-only">
              {' '}
              ({metCount} of {PASSWORD_REQUIREMENTS.length} requirements met)
            </span>
          </p>
          <ul className="space-y-1">
            {requirementResults.map((req) => (
              <li
                key={req.label}
                className={`flex items-center gap-2 text-xs ${req.met ? 'text-green-700' : 'text-gray-600'}`}
              >
                {req.met ? (
                  <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="h-3 w-3 flex-shrink-0 text-gray-400" aria-hidden="true" />
                )}
                <span>
                  {req.label}
                  <span className="sr-only">{req.met ? ' — met' : ' — not yet met'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <PasswordInput
        id={FIELD_IDS.confirmPassword}
        label="Confirm password"
        value={confirmPassword}
        onChange={(e) => {
          setConfirmPassword(e.target.value);
          clearFieldError('confirmPassword');
        }}
        placeholder="Re-enter your password"
        required
        maxLength={PASSWORD_MAX_LENGTH}
        autoComplete="new-password"
        error={
          fieldErrors.confirmPassword ??
          (confirmPassword.length > 0 &&
          confirmPassword !== password.slice(0, confirmPassword.length)
            ? 'Passwords do not match.'
            : undefined)
        }
      />

      <Button type="submit" className="w-full" isLoading={isLoading}>
        {isLoading ? 'Creating account…' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-gray-600">
        Already have an account?{' '}
        <Link
          to="/login"
          state={location.state}
          className="rounded font-medium text-blue-700 hover:text-blue-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
