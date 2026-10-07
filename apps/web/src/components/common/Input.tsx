import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: React.ReactNode;
  /** Element rendered inside the right edge of the input (e.g. a show/hide toggle). */
  endAdornment?: React.ReactNode;
}

export function Input({
  label,
  error,
  helperText,
  endAdornment,
  id,
  className = '',
  required,
  'aria-describedby': ariaDescribedBy,
  ...props
}: InputProps) {
  // useId guarantees uniqueness even when two inputs share a label (e.g. "Title").
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const describedBy =
    [ariaDescribedBy, error ? errorId : helperText ? helperId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          required={required}
          className={`
            block w-full border bg-white px-3 py-2 text-sm
            placeholder:text-gray-400
            focus:outline-none focus:ring-2 focus:ring-offset-0
            disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500
            ${endAdornment ? 'pr-10' : ''}
            ${
              error
                ? 'border-2 border-black text-black focus:ring-accent'
                : 'border-gray-500 text-black focus:border-black focus:ring-accent'
            }
            ${className}
          `.trim()}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">{endAdornment}</div>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm font-bold italic text-black" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={helperId} className="mt-1 text-sm text-gray-500">
          {helperText}
        </p>
      )}
    </div>
  );
}
