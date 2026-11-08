import type { ComponentPropsWithRef } from "react";

export type SelectProps = ComponentPropsWithRef<"select"> & {
  /** Mark a server/client validation error; pair with aria-describedby. */
  error?: boolean;
  /** Keep the platform picker even on browsers supporting base-select. */
  native?: boolean;
};

// Keep the real select, options and optgroups: names, values, refs, React
// change events, FormData, reset and required validation stay native.
// A placeholder is an ordinary <option value="">, as in existing forms.
// CSS enhances the picker on supported fine-pointer devices; other devices
// keep their platform picker. No extra button, hidden input or ARIA widget.
export function Select({ className = "", error, native = false, ...props }: SelectProps) {
  return (
    <select
      {...props}
      aria-invalid={error ? true : props["aria-invalid"]}
      {...(native && { "data-native-select": "" })}
      className={`mju-select ${className}`.trim()}
    />
  );
}
