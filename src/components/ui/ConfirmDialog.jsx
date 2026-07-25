import Button from "./Button";
import Modal from "../modal/Modal";

export default function ConfirmDialog({
  open,
  title = "Konfirmasi",
  message = "Apakah Anda yakin?",
  confirmText = "Ya, Lanjutkan",
  cancelText = "Batal",
  loading = false,
  tone = "danger",
  onConfirm,
  onCancel,
}) {
  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-amber-700 hover:bg-amber-800";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) {
          onCancel();
        }
      }}
    >
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {title}
        </h2>

        <p className="mt-3 leading-6 text-gray-600">
          {message}
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            onClick={onCancel}
            disabled={loading}
            className="bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            {cancelText}
          </Button>

          <Button
            onClick={onConfirm}
            disabled={loading}
            className={confirmClass}
          >
            {loading
              ? "Memproses..."
              : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}