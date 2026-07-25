export default function Input({
  type = "text",
  value,
  onChange,
  placeholder = "",
  disabled = false,
  required = false,
  min,
  max,
  step,
  className = "",
  ...rest
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      min={min}
      max={max}
      step={step}
      className={`w-full rounded-lg border border-gray-300 px-4 py-3 outline-none transition focus:border-amber-600 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${className}`}
      {...rest}
    />
  );
}