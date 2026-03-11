import { useEffect } from "react";
import { X } from "lucide-react";
import { create } from "zustand";

export interface ToastMessage {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  description?: string;
  duration?: number;
}

interface ToastStore {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export function useToast() {
  const { addToast } = useToastStore();
  
  return {
    toast: (options: Omit<ToastMessage, "id">) => addToast(options),
    success: (title: string, description?: string) => addToast({ type: "success", title, description }),
    error: (title: string, description?: string) => addToast({ type: "error", title, description }),
    warning: (title: string, description?: string) => addToast({ type: "warning", title, description }),
    info: (title: string, description?: string) => addToast({ type: "info", title, description }),
  };
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: ToastMessage; onRemove: () => void }) {
  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        onRemove();
      }, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, onRemove]);

  const typeStyles = {
    info: "bg-panel border-primary/30 text-main",
    success: "bg-[#0b1f13] border-green-500/30 text-green-50",
    warning: "bg-[#251b08] border-yellow-500/30 text-yellow-50",
    error: "bg-[#250d11] border-red-500/30 text-red-50",
  };

  return (
    <div 
      className={`relative overflow-hidden rounded-lg border p-4 shadow-lg flex flex-col gap-1 transition-all ${typeStyles[toast.type]}`}
      role="alert"
    >
      <div className="flex justify-between items-start gap-4">
        <h3 className="font-semibold text-sm">{toast.title}</h3>
        <button 
          onClick={onRemove}
          className="text-main/50 hover:text-main transition-colors"
        >
          <X size={16} />
        </button>
      </div>
      {toast.description && (
        <p className="text-sm opacity-80 leading-snug">{toast.description}</p>
      )}
    </div>
  );
}
