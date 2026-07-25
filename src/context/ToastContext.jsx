import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Toast from "../components/ui/Toast";

const ToastContext = createContext(null);

let toastCounter = 0;

export function ToastProvider({
  children,
}) {
  const [toasts, setToasts] =
    useState([]);

  const timeoutIdsRef = useRef(
    new Map()
  );

  const removeToast = useCallback(
    (id) => {
      const timeoutId =
        timeoutIdsRef.current.get(id);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutIdsRef.current.delete(id);
      }

      setToasts((previous) =>
        previous.filter(
          (toast) => toast.id !== id
        )
      );
    },
    []
  );

  const showToast = useCallback(
    ({
      message,
      type = "success",
      duration = 3000,
    }) => {
      if (!message) {
        return null;
      }

      const id = ++toastCounter;

      setToasts((previous) => [
        ...previous,
        {
          id,
          message,
          type,
        },
      ]);

      const timeoutId =
        window.setTimeout(() => {
          removeToast(id);
        }, duration);

      timeoutIdsRef.current.set(
        id,
        timeoutId
      );

      return id;
    },
    [removeToast]
  );

  const success = useCallback(
    (message) =>
      showToast({
        message,
        type: "success",
        duration: 3000,
      }),
    [showToast]
  );

  const error = useCallback(
    (message) =>
      showToast({
        message,
        type: "error",
        duration: 5000,
      }),
    [showToast]
  );

  const warning = useCallback(
    (message) =>
      showToast({
        message,
        type: "warning",
        duration: 4000,
      }),
    [showToast]
  );

  const info = useCallback(
    (message) =>
      showToast({
        message,
        type: "info",
        duration: 3000,
      }),
    [showToast]
  );

  useEffect(() => {
    const timeoutIds =
      timeoutIdsRef.current;

    return () => {
      timeoutIds.forEach(
        (timeoutId) => {
          window.clearTimeout(timeoutId);
        }
      );

      timeoutIds.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      showToast,
      success,
      error,
      warning,
      info,
      removeToast,
    }),
    [
      showToast,
      success,
      error,
      warning,
      info,
      removeToast,
    ]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col gap-3 sm:left-auto sm:right-5 sm:top-5 sm:w-full sm:max-w-sm">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() =>
              removeToast(toast.id)
            }
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context =
    useContext(ToastContext);

  if (!context) {
    throw new Error(
      "useToast harus digunakan di dalam ToastProvider"
    );
  }

  return context;
}