import React from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-accent bg-accent text-white hover:bg-white hover:text-black focus-visible:ring-accent disabled:border-gray-300 disabled:bg-gray-300 disabled:text-white',
  secondary:
    'border border-black bg-white text-black hover:bg-accent hover:text-white focus-visible:ring-accent disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-white',
  danger:
    'border-2 border-black bg-white font-bold uppercase tracking-wider text-black hover:bg-accent hover:text-white focus-visible:ring-accent disabled:border-gray-300 disabled:text-gray-400',
  ghost:
    'border border-transparent bg-transparent text-black underline-offset-4 hover:underline focus-visible:ring-accent disabled:text-gray-400',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={isLoading || undefined}
      className={`
        inline-flex items-center justify-center gap-2 font-medium tracking-wide
        transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `.trim()}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
