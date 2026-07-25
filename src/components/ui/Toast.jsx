import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaInfoCircle,
  FaTimesCircle,
} from "react-icons/fa";

const toastConfig = {
  success: {
    container:
      "border-green-200 bg-green-50 text-green-800",
    icon: FaCheckCircle,
  },
  error: {
    container:
      "border-red-200 bg-red-50 text-red-800",
    icon: FaTimesCircle,
  },
  warning: {
    container:
      "border-amber-200 bg-amber-50 text-amber-800",
    icon: FaExclamationTriangle,
  },
  info: {
    container:
      "border-blue-200 bg-blue-50 text-blue-800",
    icon: FaInfoCircle,
  },
};

export default function Toast({
  message,
  type = "info",
  onClose,
}) {
  const config =
    toastConfig[type] || toastConfig.info;

  const Icon = config.icon;

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg ${config.container}`}
    >
      <Icon
        className="mt-0.5 shrink-0 text-lg"
        aria-hidden="true"
      />

      <p className="min-w-0 flex-1 break-words text-sm font-medium">
        {message}
      </p>

      <button
        type="button"
        onClick={onClose}
        className="shrink-0 text-xl leading-none opacity-60 transition hover:opacity-100"
        aria-label="Tutup notifikasi"
      >
        ×
      </button>
    </div>
  );
}