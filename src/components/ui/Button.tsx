import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger-outline' | 'text'

type CommonButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  fullWidth?: boolean
}

type IconButtonProps = CommonButtonProps & {
  iconOnly: true
  'aria-label': string
}

type TextButtonProps = CommonButtonProps & {
  iconOnly?: false
}

export type ButtonProps = IconButtonProps | TextButtonProps

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    fullWidth = false,
    iconOnly = false,
    className,
    type = 'button',
    ...props
  },
  ref,
) {
  const classes = [
    'button',
    `button--${variant}`,
    fullWidth ? 'button--full-width' : '',
    iconOnly ? 'button--icon-only' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return <button ref={ref} type={type} className={classes} {...props} />
})
