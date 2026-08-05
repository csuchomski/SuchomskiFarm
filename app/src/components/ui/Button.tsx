import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./button.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "filled" | "outline";
  size?: "md" | "sm";
}

export function Button({ children, variant = "outline", size = "md", className = "", ...rest }: ButtonProps) {
  return (
    <button className={`btn btn--${variant} btn--${size} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
