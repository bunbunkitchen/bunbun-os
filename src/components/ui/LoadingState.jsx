export default function LoadingState({
  message = "Memuat data...",
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-700">
      <div className="flex items-center gap-3">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />

        <p className="font-medium">
          {message}
        </p>
      </div>
    </div>
  );
}