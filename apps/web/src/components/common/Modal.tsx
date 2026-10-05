import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  /** Optional description id/text for screen readers. */
  description?: string;
  /** Prevent closing via Escape/overlay (e.g. while a request is in flight). */
  disableClose?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Track open modals so nested/stacked modals don't release the scroll lock early.
let openModalCount = 0;
let savedBodyStyle = { overflow: '', paddingRight: '' };

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'md',
  description,
  disableClose = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const disableCloseRef = useRef(disableClose);
  const titleId = useId();
  const descId = useId();

  // Keep latest callbacks without re-running the focus effect (which would steal focus).
  useEffect(() => {
    onCloseRef.current = onClose;
    disableCloseRef.current = disableClose;
  }, [onClose, disableClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    // Move focus into the dialog: first focusable in the body, else the dialog itself.
    const focusables = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const firstBodyFocusable = focusables
      ? Array.from(focusables).find((el) => !el.dataset['modalClose'])
      : undefined;
    (firstBodyFocusable ?? dialog)?.focus();

    // Scroll lock (compensate for scrollbar to avoid layout shift).
    openModalCount += 1;
    const { body } = document;
    if (openModalCount === 1) {
      savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = 'hidden';
      if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!disableCloseRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openModalCount -= 1;
      if (openModalCount === 0) {
        body.style.overflow = savedBodyStyle.overflow;
        body.style.paddingRight = savedBodyStyle.paddingRight;
      }
      // Restore focus to the element that opened the modal.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={() => {
          if (!disableClose) onClose();
        }}
        aria-hidden="true"
      />
      {/* Content */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto ${maxWidthClasses[maxWidth]} rounded-lg bg-white p-6 shadow-xl focus:outline-none`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        aria-describedby={description ? descId : undefined}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          {title && (
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={disableClose}
            data-modal-close="true"
            className="-m-1 ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {description && (
          <p id={descId} className="sr-only">
            {description}
          </p>
        )}
        {/* Body */}
        {children}
      </div>
    </div>,
    document.body,
  );
}
