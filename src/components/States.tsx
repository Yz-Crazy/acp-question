import { AlertCircle, LoaderCircle, RotateCcw } from "lucide-react";

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return <div className="state-block" role="status"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state-block error-state" role="alert">
      <AlertCircle size={22} />
      <span>{message}</span>
      {retry && <button className="button secondary small" type="button" onClick={retry}><RotateCcw size={15} />重试</button>}
    </div>
  );
}
