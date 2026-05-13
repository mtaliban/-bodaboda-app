interface Props {
  type: 'success' | 'error' | 'info';
  message: string;
}

const icons = {
  success: '✓',
  error: '✕',
  info: 'i',
};

export default function Alert({ type, message }: Props) {
  return (
    <div className={`alert alert-${type}`} role="alert">
      <span className="alert-icon">{icons[type]}</span>
      <span>{message}</span>
    </div>
  );
}
