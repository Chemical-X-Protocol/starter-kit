import React from 'react';

export interface AtomButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'glass';
  ariaLabel?: string;
  children?: React.ReactNode;
}

export const AtomButton: React.FC<AtomButtonProps> = ({
  type = 'button',
  disabled = false,
  ariaLabel,
  variant = 'primary',
  children,
  className = '',
  onClick,
  ...rest
}) => {
  const rootClass = `a-button cursor-pointer ${className}`.trim();

  return (
    <button
      type={type}
      disabled={disabled}
      aria-label={ariaLabel}
      className={rootClass}
      data-variant={variant}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
};

export default AtomButton;
