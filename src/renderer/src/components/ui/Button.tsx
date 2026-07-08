/**
 * 按钮（shadcn/ui 同构：cva 声明变体，样式仍走原型的 .btn 组件类）。
 *
 * 为什么不直接用 Tailwind 工具类重写按钮：原型的按钮有 :active 位移、
 * 禁用态降低不透明度、focus 环等一串细节，样式表里已经逐像素对齐过一遍，
 * 这里只做「变体 → 类名」的映射，避免同一套视觉写两遍。
 */
import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      text: 'btn-text',
    },
    size: {
      md: '',
      lg: 'btn-lg',
    },
  },
  defaultVariants: { variant: 'secondary', size: 'md' },
});

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps): ReactElement {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
}
