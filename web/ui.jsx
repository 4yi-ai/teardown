import React from 'react';
import {Button as BaseButton} from '@base-ui/react/button';

// Composed from the same Base UI primitive used by 4yi's shadcn Button.
export function Button({variant = 'default', className = '', ...props}) {
  return <BaseButton data-slot="button" data-variant={variant} className={className} {...props} />;
}
export function Textarea(props) { return <textarea data-slot="textarea" {...props} />; }
export function Card({children, ...props}) { return <section data-slot="card" {...props}>{children}</section>; }
