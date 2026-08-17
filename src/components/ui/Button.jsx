export default function Button({
  children,
  onClick,
  type = "button",
  disabled = false,
  className = "",
}) {
  const isEditButton = className.includes("bg-blue-600");
  const isDeleteButton = className.includes("bg-red-600");

  const normalizedClassName = isEditButton
    ? "!bg-[#E8EDE2] !text-[#5F6F4F] !border !border-[#D5DDCA] hover:!bg-[#DCE4D3] hover:!text-[#4F5F42]"
    : isDeleteButton
      ? "!bg-[#F3E2DF] !text-[#9A625B] !border !border-[#E7CFCA] hover:!bg-[#EAD3CF] hover:!text-[#87534D]"
      : className;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg bg-amber-700 px-4 py-2 font-medium text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 ${normalizedClassName}`}
    >
      {children}
    </button>
  );
}
