import { forwardRef } from 'react';

const VARIANT_CLASS = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const Button = forwardRef(function Button(
  { variant = 'ghost', size = 'md', className = '', children, ...props },
  ref,
) {
  const cls = ['btn', VARIANT_CLASS[variant] || 'btn-ghost', size !== 'md' && `btn-${size}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} className={cls} {...props}>
      {children}
    </button>
  );
});

export default Button;
